// ═════════════════════════════════════════════════════════════════════════════
// RACE ORCHESTRATION — מרוץ הפרומפטים
// ═════════════════════════════════════════════════════════════════════════════
//
// The integration layer. Owns the race state machine and binds together the
// subsystems, none of which know about each other:
//
//   trackbuild  → geometry, checkpoints, token spots
//   kartphysics → player KartBody (AI karts get their own inside createAIField)
//   ai          → 7 opponents driving through the SAME physics
//   kartmodel   → visual karts, with garage parts attached
//   camera      → chase cam
//   hud         → DOM overlay, driven by a state snapshot + bus events
//   audio       → entirely bus-driven; this file emits, it never imports audio
//
// The player's race progress is NOT this file's own accumulator: it is a
// `ProgressTracker` from kart/ai.js, the same class the seven opponents use, so
// the child and the field are measured by one instrument from one origin (the
// start/finish line) and "equal progress" means "physically abreast". D64, and
// pinned by tools/spatialtest.mjs.
//
// State machine:  intro → countdown → racing → finished → (results)
//
// `intro` was aspirational until Wave 4 and is now real: it is the pre-race
// welcome card (race/introcard.js), which owns the screen before the countdown
// and contributes a time scale of ZERO to the accumulator, so no fixed step runs
// and the countdown has not started while a child reads it. It is skipped for
// backdrops, autopilot and every harness-driven race — see introCardEnabled().
//
import * as THREE from 'three';
import { bus as appBus } from '../core/bus.js';
import { save } from '../core/save.js';
import { makeRng } from '../core/rng.js';
import { Input } from '../core/input.js';
import { getTrack, gridSlots, TrackSpline } from '../track/trackdef.js';
import { buildTrack } from '../track/trackbuild.js';
import { applyTheme } from '../gfx/sky.js';
import { KartBody, autopilotInput } from '../kart/kartphysics.js';
import { ChaseCamera } from '../kart/camera.js';
import { createKart, createKartLOD } from '../kart/kartmodel.js';
import { createAIField, ProgressTracker } from '../kart/ai.js';
import { ROSTER, nameKey } from '../kart/roster.js';
import { createHUD } from './hud.js';
import { createQuizSystem } from './quiz.js';
import { createIntroCard, introCardEnabled } from './introcard.js';
import { createEffects } from '../gfx/particles.js';
import { firstTokenPopup, shouldShowFirstTokenPopup } from '../garage/garage.js';
import { registerStrings, t } from '../ui/i18n.js';
import { teachingCardReady, noteTeachingCard } from '../ui/style.js';

registerStrings({
  he: {
    'race.go': 'קדימה!', 'race.finish': 'סיימת!', 'race.pos': 'מקום',
  },
  en: { 'race.go': 'GO!', 'race.finish': 'FINISH!', 'race.pos': 'Place' },
});

// ─── CANONICAL PARTS VOCABULARY ─────────────────────────────────────────────
// Three subsystems named the same four slots differently, which silently broke
// the game's core promise: the garage saved {engine,tires,wing,chassis}, but
// applyPartStats() looks up {engine,tyres,frame,turbo}, so every upgrade
// resolved to `undefined` → tier 0 and a better prompt made no difference to how
// the kart drove. The save format is the garage's vocabulary (it is the thing the
// child actually chose); this layer translates outward.
//
//   garage/visual        physics        why
//   engine          →    engine         top speed + acceleration
//   tires           →    tyres          grip + off-road
//   chassis         →    frame          mass + stability
//   wing            →    turbo          downforce reads as boost retention + drift rate
const PARTS_TO_PHYSICS = { engine: 'engine', tires: 'tyres', chassis: 'frame', wing: 'turbo' };

// scoring.js names its tiers as well as numbering them; accept either form so a
// save written by any version resolves to a real tier instead of silently to 0.
const TIER_NAMES = ['scrappy', 'basic', 'tuned', 'pro'];

function tierOf(v) {
  if (typeof v === 'number') return clampTier(v);
  if (typeof v === 'string') {
    const i = TIER_NAMES.indexOf(v);
    return i >= 0 ? i : clampTier(Number(v) || 0);
  }
  if (v && typeof v === 'object') return tierOf(v.tier ?? v.visualTier ?? 0);
  return 0;
}
const clampTier = n => Math.max(0, Math.min(3, Math.round(n) || 0));

/** Garage/save parts → the tier map KartBody's applyPartStats expects. */
export function toPhysicsParts(parts = {}) {
  const out = {};
  for (const [from, to] of Object.entries(PARTS_TO_PHYSICS)) out[to] = tierOf(parts[from]);
  return out;
}

/** Garage/save parts → the tier map createKart().setParts expects. */
export function toVisualParts(parts = {}) {
  const out = {};
  for (const slot of ['engine', 'tires', 'wing', 'chassis']) out[slot] = tierOf(parts[slot]);
  // The exhaust has no garage slot of its own; let it follow the engine so a
  // strong engine upgrade reads as a bigger visual change.
  out.exhaust = out.engine;
  return out;
}

// Finishing payout, 1st → 8th. The how-to-play screen tells a child "every race
// pays out tokens based on where you finish", and until this existed that was
// simply untrue — tokens came only from pickups. It also removes a dead end: a
// player who collected nothing used to reach the garage with a budget of 0, and
// every option card on the teaching screen rendered locked and grey.
// Last place still funds a real ask (the cheapest complete ask costs 4, the most
// precise one 21), so the garage is always playable and precision is always the
// thing you have to choose between.
// Finishing bonus, 1st→8th. Deliberately shallow: the spread between winning and
// coming last is 2 tokens, because the garage budget is the game's teaching device
// and a child who is losing must still be able to afford a specific prompt.
//
// Wave 4 re-measured the whole economy INCLUDING the quiz term that D29's gate
// could not see, and this is one of the three numbers that came down. It came
// down from the TOP only — [6,5,5,4,4,3,3,3] → [5,4,4,3,3,3,3,3] — because the
// player the rebalance is aimed at is the one who WINS while answering well,
// and GAPS' standing instruction for this economy is to raise the floor rather
// than lower the ceiling for the child who is struggling. Last place still pays
// 3, which with the thinned pickups keeps every finishing position above the
// cheapest complete ask (4).
//
// EXPORTED because tests/badges.test.mjs derives its badge thresholds from this
// table and had to scrape it out of this file with a regex — so a rename failed
// at a parse assertion instead of at the thing that actually broke.
export const FINISH_TOKENS = [5, 4, 4, 3, 3, 3, 3, 3];

// How many pickup CLUSTERS a lap offers, out of the eight trackbuild authors.
// A cluster is one row of 3–4 tokens laid across the road just before an apex or
// down a straight; a player driving through it takes the one or two nearest
// their line. Thinning is done HERE, at the source, and not downstream — see the
// block in raceScene() where it is applied. Exported so gates can import it.
//
// This REPLACES D17's `TOKEN_KEEP = 0.42`, a fraction of each track's authored
// spot list, and the reason is the same one D33 hit with its percentage pace
// floor: **a fraction of a list means a different thing on every track.** The
// filter cut across the authored rows rather than between them, so at the same
// setting the three tracks paid completely differently — measured on the built
// game with an engaged driver, race 2 banked 9 pickups where race 1 banked 3,
// and the leftovers were isolated single tokens at whatever lateral offset
// happened to survive the arithmetic. Keeping whole rows, and counting the rows,
// makes the density an absolute quantity: one row a lap, every track, and the
// row still reads as the row the artist laid down.
//
// Wave 4 set this to ONE row, because the quiz term the economy gate could not
// see (D29) turned out to be the biggest one in the wallet: with it counted, a
// winning engaged child banked 35–54 tokens against a 21-token maximum ask. One
// row a lap held the income, but it bought that with the whole lap: a three-lap
// race offered the child the SAME row three times and nothing else, so pickup
// dopamine arrived once a lap, always in the same place.
//
// WAVE 6 SPLITS THE INCOME FROM THE COUNT. The row count and the income were
// only ever the same number because a taken row came back (`respawn = 26`),
// which made "rows on the lap" and "rows paid per race" multiply. They are now
// separate levers: the rows a child SEES is this constant, and the rows a child
// gets PAID for is once each, for the race — see TOKEN_RESPAWN_S below. Three
// rows seen once each pay what one row seen three times paid, so the wallet is
// unchanged while the lap has three pickup moments in three different places
// instead of one moment repeated.
//
// THREE and not four: measured on the built game (three tracks × three seeds,
// winning + fully engaged), a row is worth ~1.5 tokens to a player on the
// racing line, so the lever is worth ~1.5 tokens a row and four rows put a
// 20-token race on the board against a 21-token top ask — recreating exactly
// the failure D39 and D51 flattened the quiz reward to prevent. Three lands
// pickups at 4–6, which is where Wave 4/5 measured them.
export const TOKEN_CLUSTERS_PER_LAP = 3;

// How long a taken token stays taken. INFINITE — for the race, a row you have
// driven through is a row you have collected.
//
// This is the other half of raising TOKEN_CLUSTERS_PER_LAP, and it is what keeps
// the income flat while the count goes up. At the old 26s a row came back inside
// a lap, so income was rows × laps and the only way to hold the wallet down was
// to author one row; now income is rows, full stop, and the count is free to be
// a pacing decision instead of an economic one.
//
// It also removes a thing the child could not see: a row that is there on lap 1,
// gone on lap 2 and back on lap 3 is a rule nobody explained. "You took it, it
// is yours" is one they already know — and a row MISSED on lap 1 is still there
// on laps 2 and 3, so trying a different line through the same corner is the
// thing that pays, which is the lesson the rows are laid down the racing line to
// teach in the first place.
export const TOKEN_RESPAWN_S = Infinity;

// How long the leftovers of a row the player has driven through stay on the
// track before they clear. The ROW, not the token, is the thing a player
// collects — and this constant is what makes that true.
//
// Measured, and this is the whole reason it exists: a row is 3–4 octahedra laid
// ACROSS the road, and a pass takes only the one or two the kart's line actually
// crosses. With per-token retirement alone, lap 2 came back to the same row on a
// slightly different line and took another, and lap 3 another — on `cloud`,
// three rows paid NINE tokens over three laps and put a 23-token race on the
// board against a 21-token top ask. Retiring the row instead lands the same
// three rows at ~4–6, which is where one row a lap measured.
//
// 1.2s and not 0 so nothing is ever snatched out from in front of the child: at
// racing speed that is ~30 m of road, and the row is metres wide — so the
// leftovers wink out well behind the kart, reading as "that row is collected"
// rather than as tokens dodging them.
export const TOKEN_ROW_CLEAR_S = 1.2;

/**
 * Keep `keep` evenly-spaced clusters of the authored spots, whole.
 * The authored list runs cluster by cluster around the lap, so a gap far larger
 * than a road is a cluster boundary — that is the only structure this needs, and
 * it does not care how many tokens the artist put in a row.
 * Exported for the economy gates; pure, so it can be tested without a track.
 */
export function thinTokenSpots(all, keep = TOKEN_CLUSTERS_PER_LAP) {
  if (!all?.length || keep <= 0) return [];
  const CLUSTER_GAP_M = 25;                 // rows are metres apart, clusters ~100m
  const clusters = [[all[0]]];
  for (let i = 1; i < all.length; i++) {
    const prev = all[i - 1], p = all[i];
    const d = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    if (d > CLUSTER_GAP_M) clusters.push([]);
    clusters[clusters.length - 1].push(p);
  }
  if (clusters.length <= keep) return all.slice();
  const step = clusters.length / keep;
  const out = [];
  for (let k = 0; k < keep; k++) out.push(...clusters[Math.floor(k * step)]);
  return out;
}

const COUNTDOWN_S = 3.4;      // 3 · 2 · 1 · GO
const TOKEN_RADIUS = 2.6;     // generous — kids should not have to thread a needle
const COMBO_WINDOW = 2.2;     // seconds to chain a pickup

// ── position toasts: what the child's EYES say, not what the sort says ───────
// `race:position` used to fire the instant the spline-progress order flipped.
// Progress is arc length along the lap, so it flips while the two karts are
// still side by side — and it flips BACK a tenth of a second later, and again,
// through a whole corner. The child got "עקפת! / נעקפת!" flurries about a rival
// they can still see beside them, which is the exact shape of feedback that
// teaches a player to stop believing the HUD.
//
// The fix is hysteresis AT THE EMIT SITE — no new system, no restructuring of
// updatePositions(), and nothing about how the order is computed. A change must
//   (a) HOLD for TOAST_HOLD_S of race time, and
//   (b) open a gap of TOAST_MARGIN_M on the rival it happened against,
// before the child is told about it. Both, because either alone has a hole: a
// hold alone still announces a pass that is 20 cm ahead and about to be undone
// in the next corner, and a margin alone still announces the flicker on a track
// where the two lines diverge for half a second at a chicane.
//
// WHICH NUMBER THE CHILD SEES CHANGE WHEN, decided and stated:
//   • the HUD position NUMBER keeps tracking live (hud.js reads `state.position`
//     every frame). It is a FACT about the current order, it is on screen
//     continuously, and a number that lags its own leaderboard is a bug the
//     child can catch by looking at the karts.
//   • the TOAST is a CLAIM that an event happened. A claim that is retracted a
//     tenth of a second later is worse than a late one, so the claim waits.
// So the number may tick to P3 up to ~0.6s before "עקפת!" appears, and if the
// pass does not stick the number ticks back and nothing was ever claimed.
const TOAST_HOLD_S = 0.6;     // ~a corner's worth of "did that stick?"
const TOAST_MARGIN_M = 3.0;   // just over a kart length — clear daylight

/**
 * The toast decision, extracted so it can be TESTED. It used to live inside the
 * raceScene closure with no way in, which is why nothing ever checked it.
 * Pure: no bus, no THREE, no clock of its own — it is told the time.
 *
 * @param {{holdS?:number, marginM?:number, start?:number}} [opts]
 * @returns {{update(dt:number, live:number, gapM:number):({from:number,to:number}|null),
 *            reset(p:number):void, shown:number, pendingFor:number}}
 *   `update` returns the {from,to} payload to announce, or null for "say nothing
 *   yet". `shown` is the last position the child was actually TOLD about, which
 *   is what `from` must be measured against — using the live order for `from`
 *   would let a suppressed flicker turn the next real pass into a no-op.
 */
export function makePositionToastGate(opts = {}) {
  const holdS = opts.holdS ?? TOAST_HOLD_S;
  const marginM = opts.marginM ?? TOAST_MARGIN_M;
  let shown = opts.start ?? 1;
  let pending = null, held = 0;
  return {
    get shown() { return shown; },
    get pendingFor() { return pending == null ? 0 : held; },
    reset(p) { shown = p; pending = null; held = 0; },
    update(dt, live, gapM) {
      // Back where we started: whatever was building was a flicker, not a pass.
      if (live === shown) { pending = null; held = 0; return null; }
      // A DIFFERENT change from the one that was building restarts the clock —
      // P4→P3→P2 inside the hold window announces P2 once, not P3 then P2.
      if (live !== pending) { pending = live; held = 0; }
      held += dt;
      if (held < holdS || !(Math.abs(gapM) >= marginM)) return null;
      const from = shown;
      shown = live; pending = null; held = 0;
      return { from, to: live };
    },
  };
}

/**
 * @param {object} engine
 * @param {object} opts  { track, racerId, difficulty, laps, parts, seed,
 *                         askedIds, onComplete(result), freeCam, introCard }
 *   introCard — force the pre-race welcome card on/off. Omit for the default,
 *   which is ON for real play and OFF for backdrop / autopilot / harness-driven
 *   races (introcard.js: introCardEnabled).
 *   askedIds — question ids already asked this championship; passed straight to
 *   the quiz system so no question repeats across the three races.
 */
export function raceScene(engine, opts = {}) {
  const trackId = opts.track ?? 0;
  const { def } = getTrack(trackId);
  const laps = opts.laps ?? def.laps ?? 3;
  const difficulty = opts.difficulty ?? 1;
  const seed = opts.seed ?? 12345;
  const rng = makeRng(seed);

  const racer = ROSTER.find(r => r.id === opts.racerId) || ROSTER[0];
  const parts = opts.parts || save.read('parts') || {};

  // ---- world ---------------------------------------------------------------
  const scene = new THREE.Scene();
  const rig = applyTheme(scene, def.theme, engine);
  const track = buildTrack(trackId, engine);
  scene.add(track.group);
  const spline = track.spline;

  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.25, Math.max(900, engine.q.drawDistance * 1.5));
  const chase = new ChaseCamera(camera, { spline, mode: 'chase', seed });

  // ---- karts ---------------------------------------------------------------
  const slots = gridSlots(spline, def, 8);
  const surface = def.theme === 'cloud' ? 'cloud' : def.theme === 'circuit' ? 'grass' : 'sand';

  const player = new KartBody({
    spline, stats: racer.stats, startSlot: slots[0], parts: toPhysicsParts(parts), surface,
  });
  // `sunDir` rakes the fake contact shadow along the sun's ground projection (see
  // blobRake in kartmodel.js). It is passed from HERE and nowhere else: race.js is
  // the composition point that owns both the lighting rig and the karts, and
  // kartmodel is a leaf that must not import gfx/sky.js. It only affects karts that
  // carry a blob (no real shadow); everything that builds a kart without a rig —
  // garage, racer select, menus, every preview — gets the symmetric default.
  const playerMesh = createKart({ racer, parts: toVisualParts(parts), engine, sunDir: rig.sunDir });
  scene.add(playerMesh.group);

  // `playerParts` is what makes the FINALE scale with the child's own garage
  // (Wave 6 item 1d): ai.js reads it on race 3 only and puts the field a tier
  // above the player's engine/turbo, so an upgrade raises the stage instead of
  // trivialising it. Absent, `aiPartTier` behaves exactly as it did in Wave 5.1
  // — which is why every backdrop, preview and harness race is unaffected by
  // omitting it, and why race 3 on a STOCK kart is bit-identical.
  //
  // THIS LINE HAS BEEN LOST ONCE ALREADY (a stale `.tmp/` restore in a shared
  // tree — D45). Without it the whole finale-scaling feature is inert in the
  // built game while every test in `tests/ai.test.mjs` still passes, because
  // that file constructs its own field. `tools/flowtest.mjs` now asserts the
  // built game's `field.partTier` for an upgraded player, so the seam cannot go
  // quiet again. Same `toPhysicsParts(parts)` the player's own body was built
  // from a few lines above; passing the raw save shape would silently resolve
  // every slot to tier 0 (the D24 seam).
  const field = createAIField(spline, def, engine, {
    difficulty, playerRacerId: racer.id, seed, slots, playerSlot: 0, count: 7,
    playerParts: toPhysicsParts(parts),
  });

  // AI visuals. Distant opponents use the cheap LOD so eight karts stay in budget.
  //
  // The opponents buy garage parts on races 2-3 (D33's `aiPartTier`), and half
  // the argument for that change was legibility: the child should SEE the
  // rivals upgrading alongside them, which is what makes the garage read as the
  // thing that matters. That argument was false until this line — every
  // opponent mesh was built with `parts: null`, so they drove tier-1/tier-2
  // hardware and were drawn stock.
  const aiVisualParts = field.partTier ? toVisualParts({
    engine: field.partTier, tires: field.partTier,
    wing: field.partTier, chassis: field.partTier,
  }) : null;
  const aiKarts = [];
  for (const k of fieldKarts(field)) {
    // Rival karts are 95% of the frame's draw calls (D50), so they are built
    // through createKartLOD at EVERY tier — but what that buys differs:
    //   נמוך   weld + the reduced-detail build (`lod: 'low'`)
    //   בינוני/גבוה  weld ONLY — same geometry, same materials, same vertices as
    //          createKart, just merged. Proven lossless: identical triangle,
    //          vertex and material counts, unchanged bounding sphere, and a
    //          gate that matches every world-space vertex and normal against an
    //          unwelded twin. 235 meshes → 61.
    // The player's kart is never welded and never reduced: it is the hero art,
    // it is 3–8 m from the camera every frame, and it is one kart out of eight.
    const cheap = engine.q.propDensity < 0.5;
    const mk = createKartLOD({
      racer: k.racer, parts: aiVisualParts, engine,
      lod: cheap ? 'low' : 'high', merge: true, sunDir: rig.sunDir,
    });
    scene.add(mk.group);
    aiKarts.push({ ...k, mesh: mk });
  }

  // ---- tokens --------------------------------------------------------------
  // Thin the spots the track offers. A full lap of them banked ~30 tokens over three
  // laps against a garage budget of ~17 and a max spend of ~21 — so the budget never
  // bound and the garage's lesson ("precision costs, choose where it is worth it")
  // stopped being true for anyone who raced competently. Thinning at the SOURCE keeps
  // the three on-screen numbers honest with each other: fewer tokens visible on track,
  // fewer collected in the HUD, a smaller wallet in the garage. Capping downstream
  // would have made one of them contradict the others in front of a child.
  // The thinning is TOKEN_CLUSTERS_PER_LAP whole rows — see its comment up top
  // for why counting rows beats keeping a fraction of the authored list.
  const spots = thinTokenSpots(track.tokenSpots || []);
  const tokens = buildTokens(spots, engine, rng);
  if (tokens) scene.add(tokens.group);

  // ---- HUD -----------------------------------------------------------------
  // Backdrop mode: the title/menu screens render a live slice of a race behind
  // their UI. It must be a silent, chrome-less world — no HUD in the overlay, no
  // input capture stealing menu keys, and no engine/collision audio.
  const backdrop = !!opts.backdrop;

  // ── ONE gate for everything this race says out loud ────────────────────────
  // A backdrop race is a moving picture behind a menu, not a race: nothing it
  // does may be heard, banner-ed, scored or saved. Guarding each emit site
  // individually is what left `race:position`, `race:lap`, `race:bestlap`,
  // `race:finallap`, `race:finish` and `race:complete` live behind the title
  // screen — measured on the built game, one sit on the menu produced 123
  // overtake stingers, 2 lap jingles, a final-lap warning and a podium sting,
  // plus a `race:complete` that scenes.js and badges.js recorded as if it were
  // the child's own race. Six guards existed; six more sites had none.
  // Same lesson as D31: the next call site always forgets. So EVERY emission in
  // this scene goes through one funnel that is a no-op while `backdrop` is true
  // — an emit added next wave inherits the guarantee, and there is nothing left
  // to remember.
  // It is a SCOPED BUS rather than a differently-named emitter on purpose: every
  // call site in this file already reads `bus.emit(...)`, and so will the next
  // one someone writes out of habit. There is no second spelling to remember,
  // and no way to reach the real bus from inside this scene by accident.
  // `on`/`off` are untouched — a backdrop still listens, it just never speaks.
  const bus = backdrop ? { ...appBus, emit() { /* a backdrop is seen, not heard */ } } : appBus;

  const hud = backdrop ? null : createHUD(engine, { spline, maxSpeedKmh: 140 });
  hud?.setSpline?.(spline, def.startT ?? 0);

  // ---- quiz boxes ----------------------------------------------------------
  // Educational pickups: driving into one slows time and asks one AI question.
  // Backdrops render the beacons but never open a panel.
  const quiz = createQuizSystem(engine, {
    spline, def, difficulty, rng, mount: engine.ui, enabled: !backdrop,
    // Questions already asked earlier in this championship. scenes.js collects
    // them from `quiz:open` and hands them back so race 2 never repeats race 1.
    askedIds: opts.askedIds,
  });
  if (quiz?.group) scene.add(quiz.group);

  // ---- particles / juice ---------------------------------------------------
  // tokenAuto:false because `token:pickup` carries no position — the auto fallback
  // bursts at the kart's nose, but the sparkle belongs at the token we just took.
  const fx = createEffects(engine, {
    camera, rng, ui: engine.ui,
    screen: !backdrop,          // no vignette/flash behind a menu
    tokenAuto: false,
  });
  if (fx?.group) scene.add(fx.group);

  // ---- race state ----------------------------------------------------------
  const input = backdrop ? null : new Input();
  const S = {
    phase: 'countdown',
    clock: 0,
    raceTime: 0,
    lapTime: 0,
    lap: 1,
    bestLap: null,
    tokenCardDeferrals: 0,   // see the first-token popup's cadence escalation
    tokens: 0,
    quizTokens: 0,
    combo: 0,
    comboT: 0,
    position: 1,
    finished: false,
    finishTime: null,
    wrongWay: false,
    wrongWayT: 0,
    lastCountdownBeat: -1,
    paused: false,
    quizFrozen: false,    // a quiz panel owns the world (question/feedback/3·2·1)
    // laps + fraction past the START/FINISH LINE, monotonic. Seeded with the
    // signed arc offset of the player's grid slot from `def.startT` (a small
    // NEGATIVE number — gridSlots parks the field 4..22 m behind the line), so
    // this shares an origin with every AI driver's own accumulator. Seeding at
    // 0 gave whichever kart started furthest back a permanent free-metres
    // credit in every progress comparison. See D64. Consumers only ever take
    // DIFFERENCES against field.order() progress (finishPlayer's projected
    // times, nearestRival's gap), so the shift is common-mode there; laps come
    // from the checkpoint lapTracker, never from floor(progress).
    // Mirrored from `progressTracker` every step — see the note there.
    progress: TrackSpline.deltaT(player.lapT, def.startT ?? 0),
    cp: 0,                // next checkpoint index
    cpHits: 0,
  };
  // The player's half of the ONE progress accumulator every kart uses. It seeds
  // itself from where the kart is standing (so 0 == on the line) and bounds each
  // step to what the kart could physically have travelled, which is what stops a
  // `closestT` projection snap — a kart running wide across a hairpin — from
  // paying out free metres that never come back. The AI side is the same class,
  // driven from createAIField. See ProgressTracker in kart/ai.js, D64, and the
  // pinning gate tools/spatialtest.mjs.
  const progressTracker = new ProgressTracker(spline, player, def.startT ?? 0);
  // Only the TOAST is hysteretic; `S.position` stays live. See TOAST_HOLD_S.
  const posToast = makePositionToastGate({ start: S.position });
  const CP = track.checkpoints || [];
  const lapTracker = CP.length ? createLapTracker(CP, player.lapT) : null;
  const results = [];     // finish order as karts complete

  chase.snap(player);
  playerMesh.group.position.copy(player.position);
  playerMesh.group.quaternion.copy(player.renderQuaternion);

  // ---- pre-race intro card -------------------------------------------------
  // Every race opens on "ברוכים הבאים אל <track>" plus one הידעתם line. It owns
  // the screen (modal id 'intro') and holds the scene in phase 'intro', which
  // emits ZERO fixed steps — so the countdown has not begun and raceTime/lapTime
  // are 0 while it is up. It returns null if it defers behind another modal, and
  // is off entirely for backdrops, autopilot and harness-driven races.
  //
  // WAVE 6 ITEM 5 — THE CARD MAY ARRIVE ALREADY MOUNTED.
  // Everything above this line is the expensive part of a race: the track mesh,
  // twelve baked textures, the sky, the signage occlusion layout and eight
  // karts. On the FIRST visit to a track in a session none of it is cached, and
  // it blocks the main thread — 2.5-5.5 s headless, ~1.5-2 s on a real laptop
  // (GAPS: "Starting a championship still freezes on the FIRST visit"). Built
  // here, the card could only ever appear AFTER that freeze, so the freeze had
  // nothing in front of it.
  //
  // So scenes.js now raises the card BEFORE calling this function and hands it
  // in as `opts.introCurtain` — same card, same copy, same modal id, same
  // moment in the child's experience; it is simply on screen while the world is
  // built behind it. Two consequences are handled here and nowhere else:
  //   * the curtain arrives UNARMED (introcard.js), because a synchronous build
  //     queues input rather than swallowing it and the first queued key would
  //     dismiss a card that had been readable for zero milliseconds. It is armed
  //     at the end of this function, when there is a race behind it.
  //   * `onSkip` is bound late, because the closure it needs (S, simAcc, input)
  //     does not exist when scenes.js mounts the card.
  // Without a curtain the old path is unchanged, which is what keeps every
  // harness, backdrop and autopilot race identical to before.
  const onIntroSkip = () => {
    S.phase = 'countdown';
    S.clock = 0;
    simAcc = 0;                                  // never bank time across it
    // D12: hand the keyboard back without touching the SET of held keys, so
    // a child already holding accelerate keeps throttle into the countdown.
    if (input) input.enabled = !S.paused && !S.quizFrozen;
  };
  let intro = opts.introCurtain || null;
  if (intro) intro.setOnSkip(onIntroSkip);
  else if (introCardEnabled(opts, engine)) {
    intro = createIntroCard({ track: trackId, mount: engine.ui, onSkip: onIntroSkip });
  }
  if (intro) {
    S.phase = 'intro';
    if (input) { input.enabled = false; input.softReset(); }
  }

  bus.emit('race:begin', { track: def.id, laps, racer: racer.id });

  // A correct quiz answer pays tokens; the quiz applies the boost itself.
  const offQuiz = backdrop ? null : bus.on('quiz:correct', ({ tokens: n }) => { S.tokens += n || 0; S.quizTokens += n || 0; });
  // ── the soft reward for a RECHARGING question box (Wave 5.1) ───────────────
  // A ghosted beacon is visibly not going to ask anything, but driving through
  // one must still feel like touching something rather than like a bug that
  // swallowed a pickup. So it sparkles at the thing you touched, and quiz.js
  // pays the reward that is actually on-lesson: the touch SHAVES time off the
  // recharge, and the child watches the arc jump forward for it.
  //
  // WHAT IT DELIBERATELY DOES NOT PAY IS CURRENCY (round 2). Round 1 paid one
  // token here, and that one line cost the whole pass its point: with every
  // beacon TOUCHED paying a token, beacon income stopped being "how many
  // questions did you answer" and became "how many beacons did you drive
  // through", so RESPAWN_S had to go 26 → 60 to hold a won race under D51's
  // 21-token top ask. Measured, that starved the track: 59 questions over nine
  // engaged races against Wave 4's 69. Currency here buys nothing a child
  // wanted and costs them the boxes. So: sparkle, charge, no wallet, no combo
  // (the combo is the reward for a clean line through a token row, and a
  // ghosted box is not one) and no modal.
  const offSoftToken = backdrop ? null : bus.on('quiz:softToken', ({ x, y, z }) => {
    if (S.phase !== 'racing' || S.finished) return;
    fx?.spawn('token', { x, y, z });
  });
  // Pause: freeze the sim entirely. Input is disabled too so a held key does not
  // accumulate while the overlay is up.
  const offPause = backdrop ? null : bus.on('race:pause', () => setPaused(true));
  const offResume = backdrop ? null : bus.on('race:resume', () => setPaused(false));
  // Mounted mid-race, so the sim must hold while a child reads it.
  function showFirstTokenPopup() {
    setPaused(true);
    const el = firstTokenPopup({ onClose: () => { noteTeachingCard(); setPaused(false); } });
    engine.ui.appendChild(el);
    el.focusButton?.();
  }

  function setPaused(p) {
    S.paused = !!p;
    simAcc = 0;                       // never bank time across a pause
    // Resuming from the pause menu must NOT hand input back if a quiz panel is
    // still frozen underneath it — that was the exact D15 trap (a modal the
    // child is still reading, with the race live behind it). The quiz's own
    // time scale keeps the sim stopped either way; this keeps the keyboard
    // consistent with it.
    if (input) input.enabled = !p && !S.quizFrozen;
    if (p && input) input.softReset();   // keep held keys; see input.js
  }

  // ══════════════════════════════════════════════════════════════════════ loop
  // ── LOOP ───────────────────────────────────────────────────────────────
  // Split into simulate() and update() so the quiz's slow-motion can run FEWER
  // fixed steps per frame rather than shorter ones. Shortening dt would change
  // the physics timestep (kartphysics is tuned for exactly 1/60) and would make
  // lap times dishonest. Race time only advances inside simulate().
  const FIXED = 1 / 60;
  let simAcc = 0;

  function simulate(dt) {
    // The intro card holds the world before the countdown. update() already
    // emits zero steps for it (scale 0); this is the second lock, so a step that
    // arrives by any other route still cannot start the countdown clock.
    if (S.phase === 'intro') return;
    S.clock += dt;

    if (S.phase === 'countdown') {
      const beat = Math.min(3, Math.floor(S.clock / (COUNTDOWN_S / 4)));
      if (beat !== S.lastCountdownBeat) {
        S.lastCountdownBeat = beat;
        bus.emit('race:countdown', { n: 3 - beat });   // 3,2,1 then 0 = GO
      }
      if (S.clock >= COUNTDOWN_S) {
        S.phase = 'racing';
        S.clock = 0;
        bus.emit('race:start');
      }
      return;                       // karts sit still; the world still animates in update()
    }

    const racing = S.phase === 'racing';
    if (racing) { S.raceTime += dt; S.lapTime += dt; }

    // ---- player --------------------------------------------------------
    // After finishing, the kart coasts under AI-ish control so the camera has
    // something sane to watch during the results flourish.
    const cmd = S.finished ? { throttle: 0.35, brake: 0, steer: 0, drift: false, hop: false }
      : opts.autopilot ? autopilotInput(player, spline, { drift: true })
        : (input ? input.sample(dt) : { throttle: 1, brake: 0, steer: 0, drift: false, hop: false });
    player.update(dt, cmd);

    // ---- AI ------------------------------------------------------------
    field.update(dt, player);

    // ---- progress, laps, checkpoints -----------------------------------
    // Committed HERE, after field.update, so the player's progress and every
    // opponent's describe the same instant (the field commits its drivers at the
    // end of its own update). The old guard here dropped a step only when it
    // exceeded 0.3 LAPS (~350 m) — a respawn teleport, but nothing else. Every
    // real projection snap measured (up to +13.67 m of arc for 0.29 m travelled)
    // sailed straight through it. ProgressTracker bounds the step to the kart's
    // own physical displacement instead, and still absorbs the teleport.
    const dM = progressTracker.step(dt, player);
    S.progress = progressTracker.value;
    const d = dM / spline.length;

    if (racing && lapTracker) {
      // Checkpoints must be taken in order — this is what stops a player from
      // reversing over the line to farm laps, and from cutting the infield. The
      // lap itself is credited on the START/FINISH crossing, and nowhere else;
      // see createLapTracker.
      const ev = lapTracker.step(player.lapT);
      S.cp = lapTracker.next;
      S.cpHits = lapTracker.hits;
      if (ev === 'lap') onLapComplete();
    }

    // Wrong-way: sustained negative progress while moving.
    const goingBack = d < -0.00002 && player.speed > 4;
    S.wrongWayT = goingBack ? S.wrongWayT + dt : Math.max(0, S.wrongWayT - dt * 2);
    const ww = S.wrongWayT > 0.7;
    if (ww !== S.wrongWay) { S.wrongWay = ww; bus.emit('race:wrongway', { on: ww }); }

    // ---- tokens --------------------------------------------------------
    if (tokens && racing && !S.finished) {
      const got = tokens.collect(player.position, TOKEN_RADIUS);
      if (got) {
        fx?.spawn('token', got);
        S.combo = S.comboT > 0 ? S.combo + 1 : 1;
        S.comboT = COMBO_WINDOW;
        // Flat 1 per token. The combo still drives the HUD counter and the rising
        // pickup arpeggio — it is juice, not currency. A chain bonus here compounded
        // into a wallet several times the garage's maximum spend, which quietly
        // destroyed the garage's whole lesson ("precision costs — choose where it is
        // worth it") for any child who raced well. See GAPS: token economy.
        S.tokens += 1;
        bus.emit('token:pickup', { tokens: S.tokens, combo: S.combo });
        // The very first token a player ever collects explains what tokens are —
        // the moment the idea is most concrete, because they just picked one up.
        // (A popup is not an emission, so this one keeps its own guard.)
        // …but not on the heels of another teaching card: the intro card, this
        // popup and the first-question-box explainer could all land inside ~90
        // seconds. `teachingCardReady()` defers to the NEXT pickup rather than
        // dropping the card — the save flag is untouched here, so nothing is
        // lost by waiting (ui/style.js).
        //
        // The escalation is the floor under that promise. Measured in Wave 5: a
        // box episode occupies ~5s and then casts a 15s shadow, and token rows
        // are laid along the SAME racing line as the beacons — so pickups
        // correlate with the shadow instead of arriving independently of it, and
        // "defer to the next pickup" once had no next pickup to arrive at (a
        // whole first race finished with the card never shown). It is unreachable
        // on all three tracks today, because the intro card is a curtain that
        // casts no shadow; it exists so a future track that puts a question box
        // before the first pickup degrades to "late" rather than to "never".
        if (!backdrop && shouldShowFirstTokenPopup()) {
          if (teachingCardReady(S.tokenCardDeferrals >= 2 ? 6 : undefined)) {
            S.tokenCardDeferrals = 0;
            showFirstTokenPopup();
          } else S.tokenCardDeferrals++;
        }
      }
      S.comboT = Math.max(0, S.comboT - dt);
      if (S.comboT === 0) S.combo = 0;
    }

    updatePositions(dt);
    driveFeedback(dt);
  }

  function update(dtReal) {
    // Quiz runs ONCE per frame on unscaled time — it owns the slow-motion factor
    // and its own countdown must not slow down along with the world.
    // The pre-race card is a full freeze of the same kind the quiz applies: a
    // time scale of exactly 0, so the accumulator emits no fixed steps at all
    // (D11/D20). The quiz is not ticked while it is up either — its own clocks
    // must not advance behind a panel that owns the screen.
    const scale = S.phase === 'intro' ? 0
      : quiz
        ? quiz.update(dtReal, player, { racing: S.phase === 'racing' && !S.finished })
        : 1;

    // A quiz panel freezes the world outright (scale 0). Treat that stretch the
    // way a pause is treated at the input boundary: `enabled` off so nothing
    // leaks into the frame we resume on, but the SET of physically-held keys is
    // left alone, so a child holding accelerate through a question still has
    // throttle when the 3·2·1 finishes (D12 — this is the same trap the token
    // explainer sprang, and the same mechanism that fixed it).
    const frozen = !!quiz?.frozen;
    if (frozen !== S.quizFrozen) {
      S.quizFrozen = frozen;
      simAcc = 0;                                  // never bank time across it
      if (input && !S.paused) {
        input.enabled = !frozen;
        if (frozen) input.softReset();
      }
    }

    if (!S.paused) {
      simAcc += dtReal * scale;
      let guard = 0;
      while (simAcc >= FIXED && guard++ < 4) { simAcc -= FIXED; simulate(FIXED); }
    }

    // ---- render-only, always on real time so the world never stutters ----
    syncMesh(playerMesh, player, dtReal);
    for (const k of aiKarts) syncMesh(k.mesh, k.body, dtReal);
    track.update(S.phase === 'countdown' ? S.clock : S.raceTime);
    rig.update?.(dtReal, camera);
    tokens?.update(dtReal);
    fx?.update(dtReal, player);
    // Opponents get the continuous families (tyre smoke / surface spray) only.
    for (const k of aiKarts) fx?.emitFor(k.body, dtReal, 0.5);

    if (backdrop) cinematic(dtReal); else chase.update(dtReal, player);
    pushHud();
  }

  // Menu backdrop framing. A chase cam puts one kart dead centre, which is
  // exactly where the logo and the primary button live. Instead we run a slow
  // side-on tracking shot: low, offset, angled across the frame, with the pack
  // in the near-mid ground — which is what makes the reference title plate read
  // as "this is a racing game" before you've read a word.
  const _look = new THREE.Vector3(), _cam = new THREE.Vector3(), _tmp = new THREE.Vector3();
  let cineT = 0;
  function cinematic(dt) {
    cineT += dt;
    // Aim at the centre of the pack rather than at any one kart.
    _look.copy(player.position);
    let n = 1;
    for (const k of aiKarts) { _look.add(k.body.position); n++; }
    _look.multiplyScalar(1 / n);

    const near = spline.closestT(_look);
    const tan = spline.tangentAt(near.t, _tmp);
    const right = tan.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();

    // Sit off to one side and slightly behind, sweeping gently.
    const sway = Math.sin(cineT * 0.16);
    _cam.copy(_look)
      .addScaledVector(right, 13 + sway * 3.5)
      .addScaledVector(tan, -9 - sway * 4)
      .add(new THREE.Vector3(0, 4.6 + sway * 0.5, 0));

    camera.position.lerp(_cam, Math.min(1, dt * 2.2));
    _look.y += 1.1;
    camera.lookAt(_look);
    camera.fov = 46;
    camera.updateProjectionMatrix();
  }

  // ── lap / finish ─────────────────────────────────────────────────────────
  function onLapComplete() {
    const ms = S.lapTime * 1000;
    if (S.bestLap == null || ms < S.bestLap) {
      S.bestLap = ms;
      bus.emit('race:bestlap', { ms });
      // A backdrop must not write the child's save. The scoped bus above makes a
      // backdrop silent, but `save.set` is not an emission and slipped through
      // it: the title, results and garage backdrops all run real laps on track 0
      // and were recording best laps into the profile of a child who had not yet
      // pressed a key. Same family as the Wave-4 finding that a backdrop race was
      // overwriting `window.__LAST_RESULT__`, and as the Wave-3 lesson that a
      // silence measured on a screen secretly running the game is not silence:
      // **a backdrop is seen, not heard, and not remembered.**
      if (!backdrop) {
        const key = def.id;
        const best = save.read('bestLap') || {};
        if (!best[key] || ms < best[key]) save.set({ bestLap: { ...best, [key]: ms } });
      }
    }
    S.lapTime = 0;
    // (S.cp / S.cpHits are mirrored from lapTracker every frame; it resets its
    // own counter on the line crossing that got us here.)

    if (S.lap >= laps) return finishPlayer();

    S.lap++;
    bus.emit('race:lap', { lap: S.lap, totalLaps: laps, lapTimeMs: ms });
    if (S.lap === laps) bus.emit('race:finallap');
  }

  function finishPlayer() {
    if (S.finished) return;
    S.finished = true;
    S.finishTime = S.raceTime;
    S.phase = 'finished';
    if (input) input.enabled = false;
    chase.mode = 'orbit';
    bus.emit('race:finish', { position: S.position });

    // Settle the remaining order deterministically from current progress so the
    // results screen can appear immediately rather than waiting out the AI.
    const order = field.order();
    const standings = [];
    let place = 0;
    for (const row of order) {
      place++;
      const isPlayer = row.isPlayer || !row.racer;
      standings.push({
        racerId: isPlayer ? racer.id : row.racer.id,
        place,
        isPlayer,
        // AI times are projected from the gap in progress at the flag — honest
        // enough for a results table and avoids simulating a dead race out.
        timeMs: isPlayer ? S.finishTime * 1000
          : (S.finishTime + (S.progress - row.progress) * estLapSeconds()) * 1000,
      });
    }
    const myPlace = standings.find(s => s.isPlayer)?.place ?? S.position;
    const finishBonus = FINISH_TOKENS[Math.max(0, Math.min(FINISH_TOKENS.length - 1, myPlace - 1))];
    const result = {
      track: def.id, trackIndex: trackId, laps,
      place: myPlace,
      timeMs: S.finishTime * 1000,
      bestLapMs: S.bestLap,
      tokens: S.tokens + finishBonus,
      tokensCollected: S.tokens,
      tokensFromQuiz: S.quizTokens,
      tokensFromPickups: S.tokens - S.quizTokens,
      tokensFinishBonus: finishBonus,
      finishBonus,
      standings,
    };
    // Read by the economy gate. NOT written by a backdrop race: the title,
    // results and garage screens each run a live autopilot race behind their UI,
    // those races finish too, and one of them silently overwrote the player's
    // own result — the gate then measured a menu backdrop (0 pickups, nobody
    // answering questions) and called it the child's race.
    if (!backdrop && typeof window !== 'undefined') window.__LAST_RESULT__ = result;
    setTimeout(() => {
      bus.emit('race:complete', result);
      opts.onComplete?.(result);
    }, 2200);
  }

  function estLapSeconds() {
    return S.bestLap ? S.bestLap / 1000 : (S.raceTime / Math.max(1, S.lap));
  }

  function updatePositions(dt = FIXED) {
    const order = field.order();
    let p = 1;
    for (const row of order) {
      if (row.isPlayer || !row.racer) break;
      p++;
    }
    // `order()` is sorted best-first; find the player's index directly.
    const idx = order.findIndex(r => r.isPlayer || !r.racer);
    const np = (idx >= 0 ? idx : order.length) + 1;
    // The NUMBER is live (see TOAST_HOLD_S): it is a fact, and hud.js reads it
    // off the state every frame.
    const wasShown = posToast.shown;
    S.position = np;
    if (S.finished) { posToast.reset(np); return; }
    // The gap the change happened ACROSS: the rival the player has just swapped
    // with is the neighbour on the side the change went. Progress is in laps, so
    // × the lap length gives metres — the unit the margin is written in.
    let gapM = Infinity;
    if (np !== wasShown && idx >= 0) {
      const meP = order[idx].progress;
      const rival = order[np < wasShown ? idx + 1 : idx - 1];
      if (rival) gapM = Math.abs(meP - rival.progress) * spline.length;
    }
    const say = posToast.update(dt, np, gapM);
    if (say) bus.emit('race:position', say);
    void p;
  }

  // ── feedback: turn physics state changes into bus events ────────────────
  const prev = { drifting: false, tier: -1, boosting: false, boostSeq: 0, wallHit: false, kartHit: false, offTrack: false };
  function driveFeedback(dt) {
    void dt;
    if (backdrop) return;   // a menu backdrop must never make engine noise
    if (player.drifting !== prev.drifting) {
      prev.drifting = player.drifting;
      bus.emit(player.drifting ? 'drift:start' : 'drift:end', { tier: player.driftTier });
    }
    if (player.drifting) bus.emit('drift:charge', { charge: player.driftCharge01 });
    if (player.driftTier !== prev.tier) {
      if (player.driftTier > prev.tier && player.driftTier > 0) bus.emit('drift:tier', { tier: player.driftTier });
      prev.tier = player.driftTier;
    }
    // Watch the boost SEQUENCE, not the `boosting` rising edge, and read the
    // tier off the body's recorded provenance rather than off `driftTier`.
    // Three bugs lived in the two lines this replaces (D35):
    //   • `_releaseDrift()` zeroes `driftTier` in the same call that starts the
    //     boost, so every drift:boost the game has ever emitted carried tier 0;
    //   • quiz.js calls `applyBoost()` on a correct answer, raising the same
    //     edge, so quiz turbos were indistinguishable from drifts;
    //   • an edge on `boosting` cannot see a release that lands while a
    //     previous boost is still running — chained corners, i.e. exactly the
    //     skill the drift reward exists to celebrate, emitted nothing.
    //   • and the `last*` fields alone still lose a boost: they record only the
    //     MOST RECENT one, so a quiz turbo (applied from quiz.update()) landing
    //     in the same 16ms frame as a drift release (applied inside simulate())
    //     overwrites the release's provenance and the drift is reported as
    //     'external'. Forced same-frame: 19 real releases, 0 counted. So drain
    //     the body's boost log — every boost of the frame, oldest first, each
    //     with its own tier/source — rather than polling one counter.
    const boosts = player.drainBoosts?.();
    if (boosts && boosts.length) {
      for (const b of boosts) {
        prev.boostSeq = b.seq;
        bus.emit('drift:boost', { tier: b.tier, source: b.source });
      }
      chase.shake(0.35, 0.25);   // ONE shake per frame, however many boosts drained
    } else if (player.boostSeq !== prev.boostSeq) {
      // Safety net for a body that has no log (stubs, older mocks, the AI
      // bodies a future gate might hand in): the pre-drain behaviour exactly.
      prev.boostSeq = player.boostSeq;
      bus.emit('drift:boost', { tier: player.lastBoostTier, source: player.lastBoostSource });
      chase.shake(0.35, 0.25);
    }
    prev.boosting = player.boosting;
    if (player.wallHit && !prev.wallHit) { bus.emit('kart:collide', { kind: 'wall', speed: player.speed }); chase.shake(0.6, 0.3); }
    prev.wallHit = !!player.wallHit;
    if (player.kartHit && !prev.kartHit) { bus.emit('kart:collide', { kind: 'kart', speed: player.speed }); chase.shake(0.3, 0.2); }
    prev.kartHit = !!player.kartHit;
    if (player.offTrack !== prev.offTrack) {
      prev.offTrack = player.offTrack;
      bus.emit('surface:change', { surface: player.offTrack ? player.surfaceKind : 'asphalt' });
    }
    bus.emit('kart:engine', {
      rpm01: Math.min(1, player.speed / Math.max(1, player.p?.topSpeed || 24)),
      load: player.throttleApplied ?? 1,
      boosting: player.boosting,
      surface: player.offTrack ? player.surfaceKind : 'asphalt',
    });
  }

  // ── mesh sync ────────────────────────────────────────────────────────────
  const _v = new THREE.Vector3();
  function syncMesh(mk, body, dt) {
    if (!mk?.group) return;
    mk.group.position.copy(body.position);
    mk.group.position.y += body.hopOffset || 0;
    mk.group.quaternion.copy(body.renderQuaternion);
    mk.update?.(dt, {
      steer: body.steerAngle ? body.steerAngle / 0.6 : 0,
      speed01: body.speed01 ?? 0,
      speed: body.speed01 ?? 0,
      drifting: body.drifting,
      driftDir: body.driftDir,
      driftCharge01: body.driftCharge01 ?? 0,
      driftLean: body.driftLean ?? 0,
      airborne: body.airborne,
      boost: body.boosting ? 1 : 0,
      boosting: body.boosting,
      landingSquash: body.landingSquash ?? 0,
    });
    void _v;
  }

  // ── HUD snapshot ─────────────────────────────────────────────────────────
  const kartRows = [];
  function pushHud() {
    if (!hud) return;
    kartRows.length = 0;
    kartRows.push({ t: player.lapT, lateral: player.lateral, color: racer.color, isPlayer: true });
    for (const k of aiKarts) kartRows.push({ t: k.body.lapT, lateral: k.body.lateral, color: k.racer.color, isPlayer: false });

    const rival = nearestRival();
    hud.update({
      lap: Math.min(S.lap, laps), totalLaps: laps,
      position: S.position, totalRacers: 8,
      raceTimeMs: S.raceTime * 1000, lapTimeMs: S.lapTime * 1000, bestLapMs: S.bestLap,
      speed: player.speed, speed01: player.speed01,
      tokens: S.tokens, comboCount: S.combo,
      driftTier: player.driftTier, driftCharge01: player.driftCharge01, drifting: player.drifting,
      boosting: player.boosting, offTrack: player.offTrack,
      wrongWay: S.wrongWay, isFinalLap: S.lap === laps, finished: S.finished,
      rivalNameKey: rival?.nameKey, rivalColor: rival?.color, rivalGapMs: rival?.gapMs,
      karts: kartRows,
    });
  }

  function nearestRival() {
    const order = field.order();
    const idx = order.findIndex(r => r.isPlayer || !r.racer);
    if (idx < 0) return null;
    const other = order[idx - 1] || order[idx + 1];
    if (!other?.racer) return null;
    const ahead = !!order[idx - 1];
    const dProg = Math.abs(other.progress - S.progress);
    const gapS = dProg * estLapSeconds();
    // Pass the i18n KEY, not nameHe. Hard-coding the Hebrew name put a Hebrew
    // string inside the English HUD's LTR run, where it rendered as garbage
    // ("'TIT" for טיפה). hud.js resolves rivalNameKey in the active language.
    return {
      nameKey: nameKey(other.racer.id),
      color: other.racer.color,
      gapMs: (ahead ? 1 : -1) * gapS * 1000,
    };
  }

  // The world behind the curtain exists now, so the card may be dismissed — but
  // NOT on this task. The build above blocked the main thread, and a blocked
  // thread queues input rather than dropping it; that queue is drained before
  // the next rendering opportunity. Arming here, synchronously, would arm the
  // card a moment BEFORE the child's queued keypress arrives, and the latch
  // would swallow nothing at all (measured — see introcard.js's `arm()` note).
  // Two animation frames is strictly after every queued event. A card this scene
  // created itself was armed from birth, so this costs it nothing.
  // The timer is a backstop, not a second mechanism: a page that is producing no
  // animation frames at all (a background tab, a rasteriser under heavy load)
  // would otherwise leave the card permanently unarmed, which is the one failure
  // worse than the freeze. It cannot arm early — queued input is delivered the
  // moment the build ends, long before any 300 ms timer. `arm()` is idempotent.
  if (intro && !intro.armed) {
    const armOnce = () => intro.arm();
    requestAnimationFrame(() => requestAnimationFrame(armOnce));
    setTimeout(armOnce, 300);
  }

  // ══════════════════════════════════════════════════════════════════ scene API
  return {
    scene, camera,
    update,
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); chase.resize?.(w, h); hud?.resize?.(w); },
    // Exposed for the pause overlay and the debug harness.
    get state() { return S; },
    // `quiz` is exposed so a gate can open/inspect a question directly instead
    // of driving an autopilot lap until a beacon happens to fire (which cost
    // tools/modaltest.mjs ~40s per check and made the freeze untestable).
    // `intro` is exposed for the same reason `quiz` is: a gate must be able to
    // ask whether the card is up, and skip it, without synthesising input.
    player, field, track, hud, input, chase, quiz, intro,
    playerMesh, aiKarts,   // exposed for the automated P0 gates (orientation, steering)
    setPaused,
    dispose() {
      offQuiz?.(); offSoftToken?.(); offPause?.(); offResume?.();
      intro?.dispose();          // also releases the 'intro' modal id
      quiz?.dispose();
      fx?.dispose();
      input?.dispose();
      hud?.dispose();
      tokens?.dispose();
      for (const k of aiKarts) k.mesh.dispose?.();
      playerMesh.dispose?.();
      field.dispose?.();
      track.dispose();
      rig.dispose?.();
      scene.clear();
    },
  };
}

// ── LAP / FINISH DETECTION ──────────────────────────────────────────────────
// Item 13: the lap used to be credited EARLY — visibly before the chequered
// line and the gantry, which trackbuild anchors at `def.startT` exactly. Two
// independent causes, both here, neither in the artwork:
//
//   1. The lap fired on the LAST checkpoint, not on the line. The old code
//      incremented `cp` and then asked `cp === 0 && cpHits >= CP.length`, which
//      is true the instant checkpoint 15 of 16 is taken — a full 1/16 of a lap
//      (~46–66m depending on the track) before the flag.
//   2. Checkpoints were taken on PROXIMITY (`|deltaT| < 0.02`), so each one,
//      the line included, fired 0.02 of a lap early — another ~15–21m.
//
// Both are replaced by a crossing test: a checkpoint is taken at the frame the
// kart's lap fraction passes THROUGH it going forward, and the lap is credited
// on the crossing of checkpoint 0 — which is `startT`, which is where the line
// is drawn. Residual error is one fixed step of travel (≤0.6m at top speed),
// against ~60–85m before. Pinned by tests/finishline.test.mjs.
//
// Ordering is still enforced (no reversing over the line to farm laps, no
// cutting the infield): only the next expected checkpoint is armed, and a lap
// is credited only if every one of the others was taken since the last line
// crossing.
//
/**
 * @param {number[]} checkpoints  ordered lap fractions; [0] IS the start/finish line
 * @param {number}   startLapT    the kart's lap fraction right now (grid position)
 * @returns {{step:Function, next:number, hits:number}} step(lapT) → ''|'cp'|'lap'
 */
export function createLapTracker(checkpoints, startLapT = 0) {
  const CP = checkpoints;
  let next = 0;                                   // index of the armed checkpoint
  let hits = 0;                                   // non-line checkpoints since the line
  let prevD = TrackSpline.deltaT(startLapT, CP[0]);

  return {
    get next() { return next; },
    get hits() { return hits; },
    step(lapT) {
      const d = TrackSpline.deltaT(lapT, CP[next]);
      // Forward crossing only, and only a plausible one: a respawn teleports the
      // lap fraction, and `deltaT` wraps, so a jump is never a crossing.
      const crossed = prevD < 0 && d >= 0 && (d - prevD) < 0.25;
      prevD = d;
      if (!crossed) return '';
      const wasLine = next === 0;
      next = (next + 1) % CP.length;
      prevD = TrackSpline.deltaT(lapT, CP[next]);  // re-arm against the new target
      if (!wasLine) { hits++; return 'cp'; }
      // Crossing the line: a lap only if the whole lap was actually driven.
      // (The first crossing of a race is the start, with hits === 0.)
      const full = hits >= CP.length - 1;
      hits = 0;
      return full ? 'lap' : 'cp';
    },
  };
}

// ── helpers ────────────────────────────────────────────────────────────────
function fieldKarts(field) {
  // createAIField keeps its karts private; order() gives us the racers, but we
  // need the bodies too. It exposes them via order() rows' driver.body.
  return field.order().filter(r => r.racer && r.driver)
    .map(r => ({ racer: r.racer, body: r.driver.body, driver: r.driver }));
}

/**
 * Glowing AI tokens — the game's currency. One InstancedMesh, so 40+ pickups
 * cost a single draw call.
 */
function buildTokens(spots, engine, rng) {
  if (!spots?.length) return null;
  const n = spots.length;
  const geo = new THREE.OctahedronGeometry(0.62, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd66b, emissive: 0xffb020, emissiveIntensity: 1.6,
    roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.95,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.add(mesh);

  // Which ROW each token belongs to. Same rule thinTokenSpots uses to find the
  // rows in the first place — a gap far larger than a road is a row boundary —
  // because the row is now the unit the economy is counted in and two different
  // opinions about where a row starts would be a silent seam.
  let row = 0;
  const items = spots.map((p, i) => {
    if (i > 0) {
      const q = spots[i - 1];
      if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) > 25) row++;
    }
    return {
      pos: p.clone ? p.clone() : new THREE.Vector3(p.x, p.y, p.z),
      phase: rng() * Math.PI * 2, alive: true, respawn: 0, i, row,
    };
  });
  // Rows that have been driven through and are about to clear. See TOKEN_ROW_CLEAR_S.
  const rowClearing = new Map();

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3();
  let time = 0;

  function write() {
    for (const it of items) {
      const s = it.alive ? 1 : 0.0001;
      pos.copy(it.pos); pos.y += 1.0 + Math.sin(time * 2 + it.phase) * 0.18;
      q.setFromAxisAngle(up, time * 1.6 + it.phase);
      sc.set(s, s, s);
      m.compose(pos, q, sc);
      mesh.setMatrixAt(it.i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  write();

  return {
    group,
    update(dt) {
      time += dt;
      for (const it of items) {
        if (!it.alive) { it.respawn -= dt; if (it.respawn <= 0) it.alive = true; }
      }
      // A row the player has driven through is a row they have collected: what
      // their line touched is theirs, and the leftovers clear a beat later, once
      // the kart is well past. Nothing is snatched from in front of the child —
      // at racing speed TOKEN_ROW_CLEAR_S is ~30 m of road behind them.
      if (rowClearing.size) {
        for (const [r, left] of rowClearing) {
          const t2 = left - dt;
          if (t2 > 0) { rowClearing.set(r, t2); continue; }
          rowClearing.delete(r);
          for (const it of items) {
            if (it.row === r && it.alive) { it.alive = false; it.respawn = TOKEN_RESPAWN_S; }
          }
        }
      }
      write();
    },
    /** @returns {THREE.Vector3|null} the taken token's position, so the pickup
     *  sparkle can be spawned where the token actually was rather than at the kart. */
    collect(p, radius) {
      const r2 = radius * radius;
      for (const it of items) {
        if (!it.alive) continue;
        const dx = p.x - it.pos.x, dy = p.y - it.pos.y, dz = p.z - it.pos.z;
        if (dx * dx + dy * dy * 0.4 + dz * dz < r2) {
          // Taken is taken, for the race — TOKEN_RESPAWN_S is Infinity. See its
          // comment: this is what lets the lap carry TOKEN_CLUSTERS_PER_LAP rows
          // of pickup moments without the wallet growing by the same factor.
          // (`Infinity - dt` is still Infinity and never reaches 0, so the
          // countdown in update() needs no special case.)
          it.alive = false; it.respawn = TOKEN_RESPAWN_S;
          // …and the ROW is what was collected, not the one octahedron. See
          // TOKEN_ROW_CLEAR_S: without this the row is still worth three or four
          // tokens to a player who comes back on the next lap on a slightly
          // different line — measured, exactly what happened — and the count of
          // rows and the size of the wallet go back to being the same number.
          if (!rowClearing.has(it.row)) rowClearing.set(it.row, TOKEN_ROW_CLEAR_S);
          return it.pos;
        }
      }
      return null;
    },
    dispose() { geo.dispose(); mat.dispose(); mesh.dispose(); },
  };
}

// ── preview ────────────────────────────────────────────────────────────────
// Previews drive the player on autopilot — headless capture has no keyboard, and
// a stationary player kart tells a critic nothing about how the game looks racing.
export function preview(engine) {
  return raceScene(engine, { track: 0, difficulty: 1, seed: 4242, autopilot: true });
}
export function previewCountdown(engine) {
  return raceScene(engine, { track: 0, difficulty: 1, seed: 4242, autopilot: true });
}
export function previewMidRace(engine) {
  const s = raceScene(engine, { track: 0, difficulty: 1, seed: 4242, autopilot: true });
  for (let i = 0; i < 60 * 12; i++) s.update(1 / 60);   // past the countdown, into the pack
  return s;
}

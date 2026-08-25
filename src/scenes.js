// Scene registry + championship bookkeeping. LEAD-OWNED.
//
// NAVIGATION CONTRACT (discovered by the end-to-end flow test, not assumed):
// menus.js navigates itself via `engine.goto(name, opts)` using the names
// 'menu' | 'select' | 'race' | 'garage'. So the registry must use exactly those
// names, and this file's job is to (a) fill in the opts each scene needs from
// saved progress, and (b) keep the championship ledger. Scenes never import each
// other; everything they need arrives through opts.
import { bus } from './core/bus.js';
import { attachPauseControl } from './ui/pause.js';
import { save } from './core/save.js';
import { engine } from './core/engine.js';
import { raceScene } from './race/race.js';
import { createIntroCard, introCardEnabled } from './race/introcard.js';
import { garageScene, freePlayScene, setKartPreviewMounter } from './garage/garage.js';
import { sentenceText } from './garage/prompts.js';
import {
  titleScene, racerSelectScene, resultsScene, podiumScene, setBackdrop,
  setSelectKartMounter, setSelectEnvironment, attachHomeControl,
} from './ui/menus.js';
import { createKart, makeKartEnvironment } from './kart/kartmodel.js';
import { ROSTER } from './kart/roster.js';
import { TRACKS } from './track/trackdef.js';
import { getLang } from './ui/i18n.js';
import { costOf } from './garage/prompts.js';
import { collectionScene } from './ui/collection.js';
import { startBadgeTracker } from './core/badges.js';

// Points per finishing place, 1st → 8th.
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

// Cheapest complete ask in the garage: one part (4) plus the free option in each
// of the other three rows. Below this the screen has nothing the child can press.
const MIN_GARAGE_BUDGET = 4;

// ── cross-module wiring ────────────────────────────────────────────────────
// The garage and podium both want a real kart rendered inside them, but neither
// may import kartmodel (they would stop being independently previewable). They
// expose a mounter seam; we fill it here.
//
// `racerId` and `parts` default to the PLAYER's, which is right for the garage
// and wrong everywhere else: the podium shows three different racers, and the
// two opponents own no garage parts. Any caller rendering somebody else's kart
// must therefore pass both explicitly — see SCENES.podium.
function makeKartFor(o = {}) {
  const racer = ROSTER.find(r => r.id === (o.racerId || save.read('racerId'))) || ROSTER[0];
  return createKart({
    racer, parts: o.parts ?? save.read('parts'), engine,
    // Undefined leaves createKart on its own engine.q-derived defaults.
    lod: o.lod, shadows: o.shadows,
  });
}

setKartPreviewMounter((container3D, o = {}) => {
  const kart = makeKartFor(o);
  container3D.add(kart.group);
  return kart;
});

// Racer select: eight live karts, one per card. Same seam, same reason (menus.js
// must not import kartmodel or it stops rendering standalone under
// tools/preview.mjs) — but here the racerId is ALWAYS explicit and the name is
// written from the racer createKart actually resolved, never from the id we were
// handed. Eight cards quietly wearing the player's kart is the exact failure
// makeKartFor's save-backed default invites, and tools/selecttest.mjs reads
// these names back off the scene graph to prove it did not happen.
// Nothing on this screen casts or receives a shadow, so shadow casting is off.
setSelectKartMounter((holder, o = {}) => {
  const kart = makeKartFor({ ...o, parts: o.parts || {}, shadows: false });
  kart.group.name = 'kart:' + kart.racer.id;
  holder.add(kart.group);
  return kart;
});
setSelectEnvironment(makeKartEnvironment);

// ── the route home, for the screens that do not build their own ────────────
// menus.js screens all carry a back button or a "to the menu" action; the garage
// does not, and answered no key either, so a child who opened it from the home
// menu was locked inside until they had finished a four-step prompt. The control
// belongs to the navigation layer rather than to garage.js — it is mounted into
// engine.ui, which garage.js never touches, and torn down with the scene.
function withHomeControl(scene, eng) {
  const home = attachHomeControl({ engine: eng, escape: true });
  const disposeScene = scene.dispose.bind(scene);
  scene.dispose = () => { home.dispose(); disposeScene(); };
  return scene;
}

/** Track id or index → the name shown to the player, in the current language. */
function trackNameOf(which) {
  const def = typeof which === 'number' ? TRACKS[which]
    : TRACKS.find(tr => tr.id === which);
  if (!def) return '';
  return getLang() === 'en' ? (def.nameEn || def.nameHe) : (def.nameHe || def.nameEn);
}

// ── championship ledger ────────────────────────────────────────────────────
const races = () => save.read('results') || [];
const nextRaceIndex = () => Math.min(TRACKS.length - 1, Number(save.read('championshipRace')) || 0);
const championshipDone = () => (Number(save.read('championshipRace')) || 0) >= TRACKS.length;
/** A championship is "in progress or finished" once its first race is on the books. */
const hasChampionshipSave = () =>
  (Number(save.read('championshipRace')) || 0) > 0 || races().filter(Boolean).length > 0;
/**
 * The player's racer id, GUARANTEED to be a roster member.
 *
 * This used to fall back to ROSTER[0] only when the saved id was falsy, so a
 * saved id that is merely UNKNOWN (an edited localStorage, a racer renamed
 * between versions) sailed through and matched nothing: `totalPoints()` then
 * produced eight rows with `isPlayer:false`, `standings.find(s => s.isPlayer)`
 * was undefined, and the podium's `|| standings[0]` fallback crowned whoever
 * happened to be leading — congratulating them by name, highlighting no row,
 * printing "your total points 0" beside a table of 21s and 22s, and awarding
 * them the certificate. Validating membership here is what makes the canonical
 * shape's "isPlayer is true for exactly one entry" (D19) actually true; every
 * consumer downstream depends on it and none of them can restore it.
 */
const playerRacerId = () => {
  const saved = save.read('racerId');
  return ROSTER.some(r => r.id === saved) ? saved : ROSTER[0].id;
};

// ── the quiz's cross-race memory ───────────────────────────────────────────
// `quizdata.questionsForDifficulty(difficulty, exclude)` can filter out
// already-seen questions, and race.js forwards an `askedIds` opt into the quiz
// system — but nothing was ever SETTING it, so the parameter was inert and race
// 2 could re-ask race 1's questions. The ledger is the only layer that outlives
// a single race, so the memory belongs here.
//
// Ids are harvested from the finished scene's own `quiz.askedIds` rather than by
// subscribing to `quiz:open`, deliberately: the title-screen backdrop is a real
// raceScene and would otherwise pour its questions into the championship's
// memory from the menu. Cleared by resetChampionship() in menus.js.
const askedQuestionIds = () => {
  const v = save.read('championshipAsked');
  return Array.isArray(v) ? v.filter(id => typeof id === 'string') : [];
};

function rememberAskedIds(ids) {
  if (!ids?.length) return;
  const merged = new Set(askedQuestionIds());
  for (const id of ids) if (typeof id === 'string') merged.add(id);
  save.set({ championshipAsked: [...merged] });
}
const racerDisplayName = r =>
  (getLang() === 'en' ? (r?.nameEn || r?.nameHe) : (r?.nameHe || r?.nameEn)) || '';

/**
 * CANONICAL CHAMPIONSHIP STANDINGS SHAPE — one shape, defined here, read
 * verbatim by the podium (table AND header) and the certificate. It used to be
 * `{racerId, points, racer}` with the name nested one level down and no place at
 * all, so the podium's flat reads rendered "undefined" and its header recomputed
 * the player's position by itself and disagreed with its own table.
 *
 * Every entry is:
 *   {
 *     place,      // 1..8, final and unambiguous — the tie-break below decides it
 *     racerId,    // roster id
 *     racer,      // the roster row (colours, stats)
 *     name,       // display name, already resolved for the current language
 *     points,     // championship points
 *     wins,       // number of race wins (1st places)
 *     bestFinal,  // finishing place in the LAST race run (99 if they did not run)
 *     isPlayer,   // true for exactly one entry
 *   }
 * The array is sorted best → worst, so `standings[i].place === i + 1` always.
 *
 * TIE-BREAK (compareStandings, below): points, then race wins, then the final
 * race's finishing place, and if all three are level the PLAYER takes the higher
 * spot. Anything that needs "where did the player come" must read
 * `standings.find(s => s.isPlayer).place` — never recompute it.
 */
export function compareStandings(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (a.bestFinal !== b.bestFinal) return a.bestFinal - b.bestFinal;
  if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
  return 0;   // still level: roster order, via the stable sort
}

export function totalPoints() {
  const run = races().filter(Boolean);
  const playerId = playerRacerId();
  const acc = new Map(ROSTER.map(r => [r.id, { points: 0, wins: 0, bestFinal: 99 }]));

  for (const race of run) {
    for (const s of race.standings || []) {
      const e = acc.get(s.racerId);
      if (!e) continue;
      e.points += POINTS[s.place - 1] || 0;
      if (s.place === 1) e.wins++;
    }
  }
  // "Best final-race place" is literally the last race on the books, so a dead
  // heat is broken by who was quicker when it mattered most.
  for (const s of run[run.length - 1]?.standings || []) {
    const e = acc.get(s.racerId);
    if (e) e.bestFinal = s.place || 99;
  }

  const rows = [...acc.entries()].map(([racerId, e]) => {
    const racer = ROSTER.find(r => r.id === racerId);
    return {
      racerId, racer, name: racerDisplayName(racer),
      points: e.points, wins: e.wins, bestFinal: e.bestFinal,
      isPlayer: racerId === playerId,
    };
  });
  rows.sort(compareStandings);
  rows.forEach((r, i) => { r.place = i + 1; });
  return rows;
}

// race.js announces a finish BOTH on the bus and through onComplete. The bus
// handler at the bottom of this file fires first, so its "not recorded yet"
// guard always passed and onComplete then recorded the same race a second time —
// every race paid its tokens twice (the results sheet said 12, the wallet said
// 24). Dedupe on the result object itself: whichever path arrives first wins.
const recorded = new WeakSet();

function recordRace(result) {
  if (!result || recorded.has(result)) return;
  recorded.add(result);
  const list = races().slice();
  list[result.trackIndex] = {
    trackIndex: result.trackIndex, track: result.track, place: result.place,
    timeMs: result.timeMs, bestLapMs: result.bestLapMs, standings: result.standings,
  };
  save.set({
    results: list,
    tokens: (save.read('tokens') || 0) + (result.tokens || 0),
    championshipRace: Math.max(Number(save.read('championshipRace')) || 0, result.trackIndex + 1),
  });
}

// The title backdrop is a live slice of the oasis track — the reference title art
// works because you can see the game happening behind the logo.
setBackdrop(() => {
  const s = raceScene(engine, { track: 0, difficulty: 1, seed: 99, autopilot: true, backdrop: true });
  for (let i = 0; i < 60 * 7; i++) s.update(1 / 60);   // settle into a moving pack
  return s;
});

// ── scenes ─────────────────────────────────────────────────────────────────
// ── האוסף שלי — the badge/glossary tracker ─────────────────────────────────
// Started once, here, at module load rather than inside a scene: badges are
// earned DURING a race and the tracker must already be subscribed to the bus
// when the first token is collected, not from the next time the collection
// screen happens to be opened. It is bus-driven and stateless between events,
// so starting it early costs nothing and starting it late loses badges.
startBadgeTracker();

// ── WAVE 6 ITEM 5: the intro card is the mask for the first-visit build ─────
// A track a session has not seen yet costs one big synchronous block to build —
// twelve baked textures, the sky, the signage occlusion layout, eight karts.
// Measured on the built game before this change (tools/transitiontest.mjs, cold
// lap, headless SwiftShader): racer select -> race 3913 ms, championship start
// on a new theme 5460 ms, the third track 2485 ms; roughly 1.5-2 s of it on a
// real mid-range laptop. GAPS logged it as the last of the four freezes the
// player reported, and explicitly REJECTED the fix that was proposed for it —
// prebaking a track on idle frames, which is a new system rather than a cache.
//
// The cheap fix is that the game already has a full curtain for exactly this
// moment and was raising it a second too late. The pre-race card owns the whole
// screen, freezes the world (phase 'intro', time scale 0) and is shown before
// every race anyway. Built inside raceScene() it could only appear AFTER the
// build; raised here it appears BEFORE it, and the child spends the freeze
// reading the same card they were going to read.
//
// Two details make it honest rather than a trick:
//   * the double rAF. Mounting the element is not showing it — without a real
//     paint between the mount and the build, the browser coalesces both into one
//     frame and the child sees the freeze with nothing on top of it. Two frames
//     is one to lay it out and one to present it.
//   * `armed: false`. The build blocks the main thread, and a blocked thread
//     QUEUES input rather than dropping it, so every key a child pressed during
//     those two seconds is delivered the instant the build returns. An armed
//     card would be dismissed by the first of them, unread. race.js arms it once
//     there is a race behind it (introcard.js).
//
// Nothing about the card the child sees changes: same copy, same modal id, same
// place in the sequence. And nothing about the harness paths changes either —
// `introCardEnabled` is false for backdrops, autopilot and `engine._headless`,
// so gates and screenshots keep paying the cost in the open, where it is
// measurable.
let liveCurtain = null;
async function raiseIntroCurtain(eng, o, trackIndex) {
  if (!introCardEnabled(o, eng)) return null;
  // Retire our OWN previous curtain first. A child double-tapping "לזינוק!"
  // starts a second `goto` while the first is still building, and `engine.goto`
  // only clears the modal registry when it has an active scene to leave — the
  // first call already forgot its scene before awaiting. So without this the
  // second `createIntroCard` sees the FIRST curtain's own 'intro' id, defers,
  // returns null, and the second race builds with no curtain at all: a bare
  // two-second freeze plus a silently skipped welcome. Measured; kids double-tap
  // buttons. The scene that owns the retired card is the one `goto`'s ticket
  // check is about to throw away.
  liveCurtain?.dispose();
  liveCurtain = null;
  const card = createIntroCard({ track: trackIndex, mount: eng.ui, armed: false });
  if (!card) return null;                       // deferred behind another modal
  liveCurtain = card;
  // Mounting is not showing. Without a real paint between the mount and the
  // build, the browser coalesces both into one frame and the child sees the
  // freeze with nothing on top of it — a mutant that skips this line passes
  // every DOM-level assertion while showing a frozen title screen. Two frames:
  // one to lay it out, one to present it.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return card;
}

export const SCENES = {
  menu: (eng, o) => titleScene(eng, o),

  // The collection screen brings its own route home and its own backdrop, so
  // unlike the garage it needs no withHomeControl() wrapper here.
  collection: (eng, o = {}) => collectionScene(eng, o),

  // The screen opens on whoever the child last drove. menus.js reads `racerId`
  // out of opts and never touches the save itself (it must stay previewable in
  // isolation), so filling it in is this layer's job — same pattern as every
  // other scene here. Without it, coming back from a race always reset the
  // highlight to ניצוץ, which reads as "the game forgot who I am".
  select: (eng, o = {}) => racerSelectScene(eng, {
    ...o,
    racerId: o.racerId ?? (o.fresh ? undefined : save.read('racerId')),
  }),

  race: async (eng, o = {}) => {
    // Clamp: a caller that asks for race 4 of a 3-race championship (the old
    // "continue" button did exactly that once the ledger was full) used to index
    // past TRACKS and boot a scene with no track — a black screen with no way out.
    const trackIndex = Math.max(0, Math.min(TRACKS.length - 1, o.track ?? nextRaceIndex()));
    if (o.racerId) save.set({ racerId: o.racerId });
    // WAVE 6 ITEM 5 — raise the curtain BEFORE the world is built behind it.
    // See raiseIntroCurtain() below and the block in race.js. This is the reason
    // the factory is async: the curtain has to be given a frame to paint before
    // `raceScene()` takes the main thread for a second and a half.
    const curtain = await raiseIntroCurtain(eng, o, trackIndex);
    let s;
    try {
      s = raceScene(eng, {
      ...o,
      introCurtain: curtain,
      track: trackIndex,
      racerId: o.racerId || save.read('racerId') || ROSTER[0].id,
      // Difficulty escalates across the championship: gentle → challenging.
      difficulty: o.difficulty ?? (1 + trackIndex),
      parts: o.parts ?? save.read('parts'),
      // Everything this championship has already asked, so the quiz can draw
      // around it. quizdata falls back to the full pool if excluding would
      // leave fewer than MIN_POOL questions, so this can never starve a race.
      askedIds: o.askedIds ?? askedQuestionIds(),
      onComplete(result) {
        // Bank the questions before the ledger moves on, so race 2's draw sees
        // race 1's. Harvested from the scene rather than the result object
        // because a race can be replayed and only the finished run counts.
        rememberAskedIds(s?.quiz?.askedIds);
        recordRace(result);
        engine.goto('results', { ...result, isChampionship: true });
      },
      });
    } catch (e) {
      // A curtain with no race behind it is a screen a child cannot leave.
      curtain?.dispose();
      throw e;
    }

    // Escape → pause. The freeze needs all three of engine.paused, a wrapped
    // scene.update (because the capture harness calls update directly and never
    // sees engine.paused), and the scene's own setPaused. The controller owns that.
    const pause = attachPauseControl({
      engine: eng, scene: s,
      canPause: () => !s.state?.finished,
      onQuit: () => engine.goto('menu'),
    });
    const disposeScene = s.dispose.bind(s);
    s.dispose = () => { pause.dispose(); disposeScene(); };
    return s;
  },

  results: (eng, o = {}) => resultsScene(eng, {
    ...o,
    // The results header reads "<track> · you finished Nth". race.js only knows
    // the track id, so the display name is resolved here, in the layer that owns
    // the track table.
    trackName: o.trackName ?? trackNameOf(o.trackIndex ?? o.track),
    // Deliberately FALSE. With isChampionship:true the results screen's secondary
    // button routes straight to the next race, which lets a child skip the garage
    // — i.e. skip the entire educational core of the game. Setting it false makes
    // that button an honest "back to menu", leaving the garage as the only way
    // forward. The garage itself redirects to the podium once every race is run,
    // so no dead end is introduced.
    isChampionship: false,
  }),

  // Doubles as the championship gate: once every race is run, the "garage"
  // destination becomes the podium.
  garage: (eng, o = {}) => {
    if (championshipDone()) return SCENES.podium(eng, o);
    const visit = nextRaceIndex() + 1;          // 1, 2 or 3
    return withHomeControl(garageScene(eng, {
      ...o,
      visit,
      // The parts the child already owns. Without this the garage's "before"
      // column is a hard-coded 52/48/50/50 while the kart rendered beside it
      // wears the real upgrades (the mounter reads save directly) — so from
      // visit 2 the picture and the numbers described different karts, and a
      // tier-3 fit over an owned tier-2 promised the whole stat row instead of
      // the difference.
      ownedParts: save.read('parts') || {},
      // Floor the budget at the cost of the cheapest complete ask (one part,
      // free options elsewhere). Race payouts already guarantee more than this,
      // but a garage that opens with every card greyed out is the single worst
      // failure this game has — the teaching screen becomes unreachable — so it
      // is worth one line of insurance.
      tokens: Math.max(MIN_GARAGE_BUDGET, save.read('tokens') || 0),
      // garage.js calls onDone(result, gain) — the SECOND argument is the token
      // reward the reveal screen just promised ("הרווחת N טוקנים"), not the
      // amount spent. This used to be read as `spent` and subtracted, so the
      // economy ran backwards: writing a better prompt earned a bigger number on
      // screen and then took MORE tokens away, while the ask's actual cost was
      // never charged at all. Cost comes from the selection; the reward is added.
      onDone(part, gain) {
        // Persist the built part and the token spend, then head to the next race.
        // scoring.js returns `slotKey` + `visualTier`; store the tier number
        // under the garage's own slot vocabulary (see race.js PARTS_TO_PHYSICS).
        const parts = { ...(save.read('parts') || {}) };
        // Store the NUMERIC tier. scoring.js also exposes `visualTier`, but that
        // is a name ('scrappy'|'basic'|'tuned'|'pro'); persisting the name makes
        // both the physics and the model coerce it to tier 0, so the upgrade
        // silently does nothing.
        const slot = part?.slotKey || part?.slot;
        if (slot) parts[slot] = Math.max(0, Math.min(3, Number(part.tier) || 0));

        // Remember the best prompt of the run, in the child's own words — the
        // certificate quotes it back at them, and that is the thing that makes the
        // award feel personal rather than like a form.
        const score = Number(part?.score) || 0;
        const prev = save.read('bestPrompt');
        if (!prev || score > (prev.score || 0)) {
          let text = '';
          try { text = sentenceText(part?.selection || part?.sel || {}, getLang()); } catch { /* keep empty */ }
          if (text) save.set({ bestPrompt: { text, score } });
        }
        const spent = Number.isFinite(part?.cost) ? part.cost : costOf(part?.selection || {});
        save.set({
          parts,
          tokens: Math.max(0, (save.read('tokens') || 0) - spent + (Number(gain) || 0)),
        });
        engine.goto('race', { track: nextRaceIndex() });
      },
    }), eng);
  },

  // The home menu's garage entry. Two different screens hide behind one button:
  //   • no championship save  → the SANDBOX (unlimited practice tokens, nothing
  //     persisted) — a child who has never raced still gets to meet Boreg.
  //   • a championship exists → the REAL garage: the actual kart, the actual
  //     wallet, upgrades that persist. A player mid-championship who opened this
  //     from home used to land in the sandbox, spend a prompt, and find their
  //     wallet and their kart untouched.
  // Once every race is run, SCENES.garage forwards to the podium, so the
  // end-of-championship rule still holds through this door too.
  freeplay: (eng, o = {}) => {
    if (hasChampionshipSave()) {
      const { freePlay, ...rest } = o;   // strip the sandbox flag: this is the real thing
      void freePlay;
      return SCENES.garage(eng, rest);
    }
    return withHomeControl(
      freePlayScene(eng, {
        ...o,
        // Same reason as the championship garage: the sandbox should compare
        // against the kart the child actually owns, not a notional stock one.
        ownedParts: save.read('parts') || {},
        onExit: () => engine.goto('menu'),
      }), eng);
  },

  podium: (eng, o = {}) => {
    // The podium is where a championship is banked. Counted exactly once per
    // ledger (the child can revisit the podium as often as they like), and
    // `championshipCounted` is cleared by resetChampionship() in ui/menus.js.
    const standings = totalPoints();
    const me = standings.find(s => s.isPlayer);
    if (championshipDone() && !save.read('championshipCounted')) {
      const championship = (Number(save.read('championshipsDone')) || 0) + 1;
      save.set({ championshipsDone: championship, championshipCounted: true });
      // The championship badges (finish one, win one) have no other way to know
      // a season ended. Emitted INSIDE the once-per-ledger guard, so revisiting
      // the podium — which a child may do freely — cannot re-award anything.
      // Standings are computed above so the event can carry the real result.
      bus.emit('championship:complete', {
        place: me?.place ?? 0,
        points: me?.points ?? 0,
        races: races().filter(Boolean).length,
        championship,
      });
    }
    const scene = podiumScene(eng, {
      ...o,
      standings,
      races: races(),
      bestPrompt: save.read('bestPrompt') || null,
      championship: Math.max(1, Number(save.read('championshipsDone')) || 1),
      totalPoints: me?.points ?? 0,
    });

    // Real karts on the three steps. Each step gets ITS OWN racer — the mounter
    // defaults to the player, which put three copies of the player's kart on the
    // podium — and only the player's step wears the player's garage parts, since
    // the opponents never visit the garage.
    const myParts = save.read('parts') || {};
    const karts = [];
    for (const entry of standings.slice(0, 3)) {
      const kart = makeKartFor({ racerId: entry.racerId, parts: entry.isPlayer ? myParts : {} });
      // The kart model is -Z forward (D9); the podium steps face the camera at +Z.
      kart.group.name = 'kart:' + entry.racerId;   // read back by the flow gate
      kart.group.rotation.y = Math.PI + (entry.place === 1 ? 0 : (entry.place === 3 ? 0.30 : -0.30));
      // The real model is wider than the block placeholder was; 0.78 keeps all
      // four wheels on a 2.3m step instead of hanging over the edge.
      kart.group.scale.setScalar(0.78);
      if (scene.mountKartOnPodium?.(entry.place, kart.group)) karts.push(kart);
      else kart.dispose?.();
    }
    const disposeScene = scene.dispose.bind(scene);
    scene.dispose = () => {
      for (const k of karts) { try { k.dispose?.(); } catch (e) { console.error(e); } }
      disposeScene();
    };
    return scene;
  },
};

// Keep the ledger honest even if a scene emits completion without the callback.
// recordRace() is idempotent per result object, so this is a safety net rather
// than a second payout.
bus.on('race:complete', r => recordRace(r));

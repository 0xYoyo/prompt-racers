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
import { garageScene, freePlayScene, setKartPreviewMounter } from './garage/garage.js';
import { sentenceText } from './garage/prompts.js';
import {
  titleScene, racerSelectScene, resultsScene, podiumScene, setBackdrop,
} from './ui/menus.js';
import { createKart } from './kart/kartmodel.js';
import { ROSTER } from './kart/roster.js';
import { TRACKS } from './track/trackdef.js';
import { getLang } from './ui/i18n.js';
import { costOf } from './garage/prompts.js';

// Points per finishing place, 1st → 8th.
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

// Cheapest complete ask in the garage: one part (4) plus the free option in each
// of the other three rows. Below this the screen has nothing the child can press.
const MIN_GARAGE_BUDGET = 4;

// ── cross-module wiring ────────────────────────────────────────────────────
// The garage and podium both want a real kart rendered inside them, but neither
// may import kartmodel (they would stop being independently previewable). They
// expose a mounter seam; we fill it here.
setKartPreviewMounter((container3D, o = {}) => {
  const racer = ROSTER.find(r => r.id === (o.racerId || save.read('racerId'))) || ROSTER[0];
  const kart = createKart({ racer, parts: o.parts ?? save.read('parts'), engine });
  container3D.add(kart.group);
  return kart;
});

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

export function totalPoints() {
  const totals = new Map(ROSTER.map(r => [r.id, 0]));
  for (const race of races()) {
    for (const s of race?.standings || []) {
      totals.set(s.racerId, (totals.get(s.racerId) || 0) + (POINTS[s.place - 1] || 0));
    }
  }
  return [...totals.entries()]
    .map(([racerId, points]) => ({ racerId, points, racer: ROSTER.find(r => r.id === racerId) }))
    .sort((a, b) => b.points - a.points);
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
export const SCENES = {
  menu: (eng, o) => titleScene(eng, o),

  select: (eng, o) => racerSelectScene(eng, o),

  race: (eng, o = {}) => {
    const trackIndex = o.track ?? nextRaceIndex();
    if (o.racerId) save.set({ racerId: o.racerId });
    const s = raceScene(eng, {
      ...o,
      track: trackIndex,
      racerId: o.racerId || save.read('racerId') || ROSTER[0].id,
      // Difficulty escalates across the championship: gentle → challenging.
      difficulty: o.difficulty ?? (1 + trackIndex),
      parts: o.parts ?? save.read('parts'),
      onComplete(result) {
        recordRace(result);
        engine.goto('results', { ...result, isChampionship: true });
      },
    });

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
    return garageScene(eng, {
      ...o,
      visit,
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
    });
  },

  // Sandbox garage reachable from the home menu ("המוסך של בורג"): unlimited
  // practice tokens, nothing persisted to the championship.
  freeplay: (eng, o = {}) => freePlayScene(eng, { ...o, onExit: () => engine.goto('menu') }),

  podium: (eng, o = {}) => podiumScene(eng, {
    ...o,
    standings: totalPoints(),
    races: races(),
    bestPrompt: save.read('bestPrompt') || null,
    championship: (Number(save.read('championshipsDone')) || 0) + 1,
  }),
};

// Keep the ledger honest even if a scene emits completion without the callback.
// recordRace() is idempotent per result object, so this is a safety net rather
// than a second payout.
bus.on('race:complete', r => recordRace(r));

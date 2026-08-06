// Fairness gate for src/kart/ai.js — the never-lapped guarantee.
//
//   node tests/ai.test.mjs          the gate (5 seeds x 20 races, ~10s)
//   node tests/ai.test.mjs full     + the pace sweep that finds the lapping edge
//
// WHAT THIS FILE PROTECTS
// -----------------------
// A struggling child must never be lapped and must always have karts on screen.
// That guarantee is delivered by ONE mechanism: the rubber band's hold-back
// floor, which lets an opponent that is up the road ease off by up to 17%.
// Wave 1 scaled that floor down with difficulty, which left race 3 with 9.4% of
// authority and put a 70%-pace player 1.04 laps down on `cloud` — lapped, alone
// on track, the exact outcome the band exists to prevent. The floor is now
// difficulty-independent (the ceiling still is not) and this file pins it.
//
// METHODOLOGY — deliberately the same as the GAPS.md measurement, so the
// numbers here are comparable with the ones measured in the built game:
//   * the player is the game's own `autopilotInput` (drift on) driving a real
//     KartBody, with `topSpeed` and `accelPower` scaled by `pace`. 100% is a
//     clean, quick kid; 85% is the common struggling case; 70% is a 30% deficit.
//   * 3 laps from the grid, 7 AI opponents, collisions on, the real difficulty
//     mapping race N -> difficulty N that scenes.js uses.
//   * "laps behind" is measured at the instant the WINNER crosses the line —
//     >= 1.00 means the player has been lapped.
// Headless is slightly kinder than the built game (no token traffic, no start
// jostle): where this harness measured 0.78, the built game measured 1.04. The
// thresholds below carry that offset as margin.
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { createAIField, BAND_CATCH, BAND_HOLD } from '../src/kart/ai.js';

const DT = 1 / 60;
const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : 'inf');
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

let failures = 0;
const assert = (ok, msg) => {
  if (!ok) { failures++; console.log('  ✗ FAIL: ' + msg); } else console.log('  ✓ ' + msg);
};

// The championship as scenes.js wires it: race N -> track N, difficulty N.
const RACES = [
  { n: 1, track: 'oasis', difficulty: 1 },
  { n: 2, track: 'circuit', difficulty: 2 },
  { n: 3, track: 'cloud', difficulty: 3 },
];
const SEEDS = [3, 11, 19, 41, 57];

/**
 * One headless 3-lap race.
 * @returns {{pos, lapsBehind, gap, bandMin, bandMax, lonely, time}}
 */
function race({ track, difficulty, pace, seed, laps = 3, maxTime = 900 }) {
  const { def, spline } = getTrack(track);
  const slots = gridSlots(spline, def, 8);
  const racer = ROSTER[0];
  const surface = def?.theme === 'cloud' ? 'cloud' : def?.theme === 'circuit' ? 'grass' : 'sand';
  const player = new KartBody({ spline, stats: racer.stats, startSlot: slots[0], surface });
  // The pace knob: a slower kart, not a handicapped brain. Exactly what the
  // built-game measurement did.
  player.p.topSpeed *= pace;
  player.p.accelPower *= pace;

  const field = createAIField(spline, def, null, {
    difficulty, playerRacerId: racer.id, slots, playerSlot: 0, seed,
  });

  const toLine = ((def.startT - player.lapT) + 1) % 1;
  const finishAt = toLine + laps;
  const finish = new Array(field.drivers.length + 1).fill(null);
  let t = 0, prevT = player.lapT, pProg = 0, lapsBehind = null;
  // "Alone on track", measured along the road rather than as the crow flies:
  // the worst moment of the race, in laps, between the player and the nearest
  // opponent in the running order. Euclidean distance lies on a folded circuit
  // (a kart half a lap up the road can be 30m away across a hairpin).
  let worstLonely = 0;

  while (t < maxTime && finish.some(x => x == null)) {
    player.update(DT, autopilotInput(player, spline, { drift: true }));
    pProg += TrackSpline.deltaT(player.lapT, prevT);
    prevT = player.lapT;
    field.update(DT, { body: player, progress: pProg });
    t += DT;

    let near = 1e9;
    for (const d of field.drivers) near = Math.min(near, Math.abs(d.progress - pProg));
    if (near > worstLonely) worstLonely = near;

    const prog = [pProg, ...field.drivers.map(d => d.progress)];
    for (let i = 0; i < prog.length; i++) {
      if (finish[i] == null && prog[i] >= finishAt) {
        finish[i] = t;
        if (lapsBehind == null) lapsBehind = finishAt - pProg;   // winner crossed
      }
    }
  }
  const order = finish.map((v, i) => [v == null ? Infinity : v, i]).sort((a, b) => a[0] - b[0]);
  const tel = field.telemetry();
  field.dispose();
  return {
    pos: order.findIndex(o => o[1] === 0) + 1,
    lapsBehind: lapsBehind ?? 0,
    gap: (finish[0] ?? Infinity) - order[0][0],
    bandMin: tel.bandMin, bandMax: tel.bandMax,
    lonely: worstLonely, time: t,
  };
}

const sweep = (pace) => RACES.map(R => ({
  R, runs: SEEDS.map(seed => race({ track: R.track, difficulty: R.difficulty, pace, seed })),
}));

// ---------------------------------------------------------------------------
console.log('\n=== PACE x RACE: finishing position and laps behind the winner ===');
console.log(pad('pace', 7) + RACES.map(R => padL(`race ${R.n} (${R.track} d${R.difficulty})`, 38)).join(''));
const results = {};
let worstLapsBehind = 0, worstLonely = 0, bandLo = 1, bandHi = 1;
for (const pace of [1.00, 0.85, 0.70]) {
  const cols = sweep(pace);
  results[pace] = cols;
  const cells = cols.map(({ runs }) => {
    const p = runs.map(r => r.pos);
    const lb = runs.map(r => r.lapsBehind);
    for (const r of runs) {
      bandLo = Math.min(bandLo, r.bandMin); bandHi = Math.max(bandHi, r.bandMax);
      if (pace <= 0.70) { worstLapsBehind = Math.max(worstLapsBehind, r.lapsBehind); worstLonely = Math.max(worstLonely, r.lonely); }
    }
    const pr = Math.min(...p) === Math.max(...p) ? `${p[0]}` : `${Math.min(...p)}-${Math.max(...p)}`;
    return padL(`${pr}   ${lb.map(x => f(x)).join(' ')}`, 38);
  });
  console.log(pad(f(pace * 100, 0) + '%', 7) + cells.join(''));
}
console.log(pad('', 7) + RACES.map(() => padL('pos   laps behind, one per seed', 38)).join(''));

// --- 1. the guarantee -------------------------------------------------------
console.log('\n=== 1. NEVER LAPPED (the guarantee) ===');
for (const { R, runs } of results[0.70]) {
  const lb = runs.map(r => r.lapsBehind);
  // Budget 0.72, not 1.00. Headless is measurably kinder than the built game —
  // the same case measured 0.78 here and 1.04 in the real thing — so the gate
  // keeps ~0.28 laps of that offset in hand. If this ever creeps past 0.72,
  // the built game is close to lapping a child even if this file still passes.
  assert(Math.max(...lb) < 0.72,
    `race ${R.n} (${R.track} d${R.difficulty}): 70%-pace player stays on the lead lap ` +
    `(worst ${f(Math.max(...lb))} laps behind, budget 0.72)`);
}
// Not being lapped is the guarantee; not being ALONE is what it is for. At the
// floor the field can only ease off so far, so the honest promise at 70% is
// "there is always somebody within half a lap" — before the fix the nearest
// opponent on race 3 got 0.67 laps up the road, which is a child driving round
// an empty track.
assert(worstLonely < 0.50,
  `70%-pace player always has an opponent within half a lap (worst ${f(worstLonely)} laps to the nearest kart)`);
{
  const l85 = results[0.85].flatMap(({ runs }) => runs.map(r => r.lonely));
  assert(Math.max(...l85) < 0.20,
    `85%-pace player is always in traffic (worst ${f(Math.max(...l85))} laps to the nearest kart)`);
}

// --- 2. a strong player still wins -----------------------------------------
console.log('\n=== 2. A 100% PLAYER STILL WINS ALL THREE ===');
for (const { R, runs } of results[1.00]) {
  const wins = runs.filter(r => r.pos === 1).length;
  assert(wins === runs.length,
    `race ${R.n} (${R.track} d${R.difficulty}): 100%-pace player wins ${wins}/${runs.length} seeds`);
}

// --- 3. the championship still escalates ------------------------------------
console.log('\n=== 3. THE 85% CURVE IS AN ESCALATION, NOT A WALL ===');
{
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const places = results[0.85].map(({ runs }) => mean(runs.map(r => r.pos)));
  console.log(`  championship (oasis d1 -> circuit d2 -> cloud d3), mean place: ${places.map(p => f(p, 1)).join('  ->  ')}`);
  console.log(`  laps behind:                                                   ${results[0.85].map(({ runs }) => f(mean(runs.map(r => r.lapsBehind)))).join('     ->     ')}`);
  // The championship changes track AND difficulty at once, and the tracks are
  // not equally hard, so the difficulty ladder is measured on ONE track — the
  // same isolation GAPS.md used when it re-measured per race.
  const ladder = [1, 2, 3].map(d => mean(SEEDS.map(seed => race({ track: 'oasis', difficulty: d, pace: 0.85, seed }).pos)));
  console.log(`  difficulty ladder on oasis alone, mean place: ${ladder.map(p => f(p, 1)).join('  ->  ')}`);
  assert(ladder[0] <= 5, `difficulty 1 at 85% is gentle (mean place ${f(ladder[0], 1)} <= 5)`);
  assert(ladder[1] >= ladder[0] + 0.5 && ladder[2] >= ladder[1] + 0.5,
    'each difficulty step is a visible step down the order for a struggling player');
  assert(ladder[2] - ladder[0] >= 2,
    `difficulty 3 at 85% is meaningfully harder than difficulty 1 (${f(ladder[0], 1)} -> ${f(ladder[2], 1)})`);
  const lb = results[0.85].flatMap(({ runs }) => runs.map(r => r.lapsBehind));
  assert(Math.max(...lb) < 0.5, `an 85% player is never close to lapped (worst ${f(Math.max(...lb))} laps)`);
}

// --- 4. the band stays inside its hard bound --------------------------------
console.log('\n=== 4. THE BAND IS STILL HARD-BOUNDED ===');
console.log(`  measured band multiplier over ${3 * RACES.length * SEEDS.length} races: ${f(bandLo, 4)} .. ${f(bandHi, 4)}`);
console.log(`  declared: [1 - BAND_HOLD, 1 + BAND_CATCH] = [${f(1 - BAND_HOLD, 3)}, ${f(1 + BAND_CATCH, 3)}]`);
assert(bandLo >= 1 - BAND_HOLD - 1e-6 && bandHi <= 1 + BAND_CATCH + 1e-6,
  'every band sample lies inside the declared bound');
assert(BAND_CATCH <= 0.075 && BAND_HOLD <= 0.170,
  `the bound itself has not been widened (catch ${f(BAND_CATCH, 3)} <= 0.075, hold ${f(BAND_HOLD, 3)} <= 0.170)`);

// --- 5. Wave-1 AI behaviour is intact ---------------------------------------
// The floor only ever fires when the player is BEHIND, so difficulty 1 (where
// the old scaling was a no-op) must be untouched, and the opponents must still
// drive like themselves: distinct corner-entry speeds, distinct drift usage,
// distinct error rates.
console.log('\n=== 5. WAVE-1 AI BEHAVIOUR (personalities, drift, lap times) ===');
{
  const { def, spline } = getTrack('oasis');
  const slots = gridSlots(spline, def, 8);
  const field = createAIField(spline, def, null, {
    difficulty: 2, playerRacerId: ROSTER[0].id, slots, playerSlot: 0, seed: 31,
  });
  const start = field.drivers.map(d => d.progress);
  let t = 0;
  while (t < 180 && field.drivers.some((d, i) => d.progress - start[i] < 3)) { field.update(DT, null); t += DT; }
  const tel = field.telemetry();
  const by = {};
  for (const d of tel.drivers) by[d.personality] = d;
  console.log(pad('persona', 12) + padL('lap', 8) + padL('entry', 8) + padL('drift%', 9) + padL('mistakes', 10));
  for (const d of tel.drivers) {
    console.log(pad(d.personality, 12) + padL(f(tel.time / d.progress, 2), 8) + padL(f(d.cornerEntry, 2), 8) +
      padL(f(100 * d.driftTime / tel.time, 1), 9) + padL(d.mistakes, 10));
  }
  const lap = d => tel.time / d.progress;
  assert(Math.min(...tel.drivers.map(lap)) > 40 && Math.max(...tel.drivers.map(lap)) < 75,
    `AI lap times are still in the Wave-1 window (${f(Math.min(...tel.drivers.map(lap)))}..${f(Math.max(...tel.drivers.map(lap)))}s)`);
  assert(by.aggressive.cornerEntry > by.steady.cornerEntry,
    `the late braker still carries more speed into corners (${f(by.aggressive.cornerEntry)} > ${f(by.steady.cornerEntry)})`);
  assert(by.drifter.driftTime > by.steady.driftTime,
    `the drifter still drifts more than the metronome (${f(by.drifter.driftTime)}s > ${f(by.steady.driftTime)}s)`);
  assert(by.erratic.mistakes > by.steady.mistakes * 2,
    `the erratic driver still makes far more mistakes (${by.erratic.mistakes} vs ${by.steady.mistakes})`);
  assert(by.blocker.blockTime > 5, `the blocker still defends (${f(by.blocker.blockTime, 1)}s of blocking)`);
  const driftPct = tel.drivers.map(d => 100 * d.driftTime / tel.time);
  assert(Math.min(...driftPct) > 40, `every opponent still drifts most of the lap (min ${f(Math.min(...driftPct), 1)}%)`);
  field.dispose();
}

// --- optional: where the lapping edge actually is ---------------------------
if (process.argv.includes('full')) {
  console.log('\n=== PACE SWEEP: laps behind vs player pace (mean over all seeds) ===');
  const paces = [0.85, 0.75, 0.70, 0.65, 0.60, 0.55];
  console.log(pad('race', 22) + paces.map(p => padL(f(p * 100, 0) + '%', 8)).join(''));
  for (const R of RACES) {
    const row = paces.map(p => {
      const m = SEEDS.map(s => race({ track: R.track, difficulty: R.difficulty, pace: p, seed: s }).lapsBehind)
        .reduce((a, b) => a + b, 0) / SEEDS.length;
      return padL(f(m) + (m >= 1 ? '*' : ' '), 8);
    });
    console.log(pad(`race ${R.n} ${R.track} d${R.difficulty}`, 22) + row.join(''));
  }
  console.log('  (* = lapped)');
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);

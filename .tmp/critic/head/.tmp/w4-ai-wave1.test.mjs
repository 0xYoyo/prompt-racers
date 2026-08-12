// Balance + fairness gate for src/kart/ai.js.
//
//   node tests/ai.test.mjs          the gate (5 seeds x ~30 races, ~15s)
//   node tests/ai.test.mjs full     + the pace sweep that finds the lapping edge
//
// WHAT THIS FILE PROTECTS — two promises that pull against each other
// -------------------------------------------------------------------
// 1. A struggling child must never be lapped and must always have karts on
//    screen. Delivered by the rubber band's hold-back floor, which is now an
//    ABSOLUTE effective pace (BAND_FLOOR_PACE, 62% of an opponent's own clean
//    flat-out) rather than a percentage off a base pace that moves. Wave 1's
//    -17%-of-base floor meant 0.677 effective on race 1 but 0.801 on race 3,
//    and a 70%-pace player was measured 1.04 laps down on `cloud` — lapped,
//    alone on track, the exact outcome the band exists to prevent.
// 2. The race has to be worth winning. Wave 1's AI was slower than a clean
//    driver on its own flat-out, so a passive 100%-pace player won all three
//    races on all five seeds. Wave 4 put the field on a flat 1.00 pace with a
//    per-track calibration and gave the opponents the same garage upgrades the
//    child buys (stock / tier 1 / tier 2 across the championship). The target
//    feel, and what sections 2-3 pin: clean driving with no engagement is
//    2nd-3rd on race 1 and 3rd-5th on races 2-3, and a decent garage upgrade
//    turns that back into a win.
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
import { getTrack, gridSlots, TrackSpline } from '/Users/yoyopc/repos/kart-project/src/track/trackdef.js';
import { KartBody, autopilotInput } from '/Users/yoyopc/repos/kart-project/src/kart/kartphysics.js';
import { ROSTER } from '/Users/yoyopc/repos/kart-project/src/kart/roster.js';
import { createAIField, BAND_CATCH, BAND_HOLD, BAND_FLOOR_PACE, aiPartTier } from '/Users/yoyopc/repos/kart-project/.tmp/w4v_wave1.js';

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
function race({ track, difficulty, pace, seed, laps = 3, parts = null, maxTime = 900 }) {
  const { def, spline } = getTrack(track);
  const slots = gridSlots(spline, def, 8);
  const racer = ROSTER[0];
  const surface = def?.theme === 'cloud' ? 'cloud' : def?.theme === 'circuit' ? 'grass' : 'sand';
  // `parts` is the garage axis: the same tier map the child's own kart carries.
  const player = new KartBody({
    spline, stats: racer.stats, startSlot: slots[0], surface, parts: parts || undefined,
  });
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
  // Every opponent on a track shares one base pace, so one driver answers for
  // the field. Both are needed to check the band: the multiplier bound is
  // relative, the never-lapped promise is an absolute pace.
  const basePace = field.drivers[0].basePace();
  const bandFloor = field.drivers[0].bandFloor();
  field.dispose();
  return {
    pos: order.findIndex(o => o[1] === 0) + 1,
    lapsBehind: lapsBehind ?? 0,
    gap: (finish[0] ?? Infinity) - order[0][0],
    bandMin: tel.bandMin, bandMax: tel.bandMax, basePace, bandFloor,
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
let worstPaceFloorSlack = 9, effPaceLo = 9;
for (const pace of [1.00, 0.85, 0.70]) {
  const cols = sweep(pace);
  results[pace] = cols;
  const cells = cols.map(({ runs }) => {
    const p = runs.map(r => r.pos);
    const lb = runs.map(r => r.lapsBehind);
    for (const r of runs) {
      bandLo = Math.min(bandLo, r.bandMin); bandHi = Math.max(bandHi, r.bandMax);
      worstPaceFloorSlack = Math.min(worstPaceFloorSlack, r.bandMin - r.bandFloor);
      effPaceLo = Math.min(effPaceLo, r.bandMin * r.basePace);
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
  // Budget 0.35, not 1.00, and not the 0.72 this file used before Wave 4.
  // Headless is measurably kinder than the built game — the Wave-1 code measured
  // 0.61-0.78 here and 1.04 in the real thing, a factor of ~1.7 — so a budget
  // anywhere near 1.00 cannot see the bug it exists to catch, and 0.72 was
  // slack enough that the ORIGINAL broken code passed it. 0.35 headless is
  // ~0.60 in the built game: still comfortably on the lead lap, and tight
  // enough that this assertion goes red against the Wave-1 constants (0.61).
  // Measured after the rebalance: 0.17 / 0.15 / 0.20.
  assert(Math.max(...lb) < 0.35,
    `race ${R.n} (${R.track} d${R.difficulty}): 70%-pace player stays on the lead lap ` +
    `(worst ${f(Math.max(...lb))} laps behind, budget 0.35)`);
}
// Not being lapped is the guarantee; not being ALONE is what it is for. At the
// floor the field can only ease off so far, so the honest promise at 70% is
// "there is always somebody within half a lap" — before the fix the nearest
// opponent on race 3 got 0.67 laps up the road, which is a child driving round
// an empty track.
// 0.25, down from 0.50: with the deep floor the measured worst case is 0.08, and
// the Wave-1 code left a struggling child 0.41 laps from the nearest kart on
// race 3 — driving round an empty track, which is the failure this exists to see.
assert(worstLonely < 0.25,
  `70%-pace player always has an opponent within a quarter lap (worst ${f(worstLonely)} laps to the nearest kart)`);
{
  const l85 = results[0.85].flatMap(({ runs }) => runs.map(r => r.lonely));
  assert(Math.max(...l85) < 0.20,
    `85%-pace player is always in traffic (worst ${f(Math.max(...l85))} laps to the nearest kart)`);
}

// --- 2. the race is worth winning -------------------------------------------
// The Wave-4 target feel, measured on the reference driver: clean driving and
// nothing else is a podium fight on race 1 and mid-pack on races 2-3. Before
// this, a 100%-pace player won 15/15. These are two-sided on purpose: too easy
// fails, and (section 2b) too hard fails as well.
console.log('\n=== 2. NO-ENGAGEMENT CLEAN DRIVING DOES NOT WIN ===');
{
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  for (const { R, runs } of results[1.00]) {
    const p = runs.map(r => r.pos), wins = runs.filter(r => r.pos === 1).length;
    console.log(`  race ${R.n} (${R.track} d${R.difficulty}): places ${p.join(' ')}  mean ${f(mean(p), 1)}`);
    if (R.n === 1) {
      // Race 1 is the gentle one: a clean lap should be a podium, and winning
      // should want a couple of quiz boosts or genuinely good drifts on top.
      assert(wins <= 1 && mean(p) >= 1.8,
        `race 1: clean driving alone is a podium fight, not a walkover ` +
        `(wins ${wins}/${runs.length}, mean place ${f(mean(p), 1)} >= 1.8)`);
      assert(mean(p) <= 3.5, `race 1 is still the gentle one (mean place ${f(mean(p), 1)} <= 3.5)`);
    } else {
      // Races 2-3: the upgrade and the quiz are the difference between mid-pack
      // and the win. A no-engagement player must not win a single seed.
      assert(wins === 0 && mean(p) >= 3.0,
        `race ${R.n}: no-engagement clean driving lands mid-pack, never first ` +
        `(wins ${wins}, mean place ${f(mean(p), 1)} >= 3.0)`);
      assert(mean(p) <= 5.5,
        `race ${R.n} is not punishing for a clean driver (mean place ${f(mean(p), 1)} <= 5.5)`);
    }
  }
}

// --- 2b. ...but a garage upgrade wins it -------------------------------------
// The other half of "winnable, just earned". If a rebalance ever makes the field
// unbeatable, this is what says so. Tier 2 is a good-but-not-perfect prompt, and
// it is the tier the opponents themselves run in race 3.
console.log('\n=== 2b. A DECENT GARAGE UPGRADE WINS IT BACK ===');
{
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const T2 = { engine: 2, tyres: 2, frame: 2, turbo: 2 };
  console.log(`  opponents' own championship tier: race 1 ${aiPartTier(1)}, race 2 ${aiPartTier(2)}, race 3 ${aiPartTier(3)}`);
  for (const R of RACES) {
    const runs = SEEDS.map(seed => race({ track: R.track, difficulty: R.difficulty, pace: 1.00, seed, parts: T2 }));
    const p = runs.map(r => r.pos), wins = runs.filter(r => r.pos === 1).length;
    const stock = mean(results[1.00].find(c => c.R.n === R.n).runs.map(r => r.pos));
    console.log(`  race ${R.n}: places ${p.join(' ')}  mean ${f(mean(p), 1)}  (stock ${f(stock, 1)} -> +${f(stock - mean(p), 1)} places)`);
    assert(wins >= 1 && mean(p) <= 2.0,
      `race ${R.n}: a tier-2 kart is fighting for the win ` +
      `(${wins}/${runs.length} seeds won, mean place ${f(mean(p), 1)} <= 2.0)`);
    assert(mean(p) <= stock - 0.8,
      `race ${R.n}: the upgrade is worth ${f(stock - mean(p), 1)} places over stock (>= 0.8)`);
  }
  // Race 2 is the one a tier-2 kart only fights for rather than wins outright
  // (2/5 seeds), which is the intended shape: on the hardest of the three for a
  // reference driver, the last step has to come from the quiz or the garage. A
  // fully-spent garage must still close it, or the championship is unwinnable.
  {
    const T3 = { engine: 3, tyres: 3, frame: 3, turbo: 3 };
    const runs = SEEDS.map(seed => race({ track: 'circuit', difficulty: 2, pace: 1.00, seed, parts: T3 }));
    const wins = runs.filter(r => r.pos === 1).length;
    assert(wins === runs.length,
      `race 2: a fully-upgraded kart wins outright (${wins}/${runs.length} seeds)`);
  }
}

// --- 3. the championship still escalates ------------------------------------
console.log('\n=== 3. THE CHAMPIONSHIP STILL ESCALATES ===');
{
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const places = results[1.00].map(({ runs }) => mean(runs.map(r => r.pos)));
  console.log(`  championship (oasis d1 -> circuit d2 -> cloud d3) at 100%, mean place: ${places.map(p => f(p, 1)).join('  ->  ')}`);
  console.log(`  at 85%:                                                                ${results[0.85].map(({ runs }) => f(mean(runs.map(r => r.pos)), 1)).join('     ->     ')}`);
  // The championship changes track AND difficulty at once, and the tracks are
  // not equally hard, so the difficulty ladder is measured on ONE track — the
  // same isolation GAPS.md used when it re-measured per race.
  //
  // Measured at 100% and NOT at 85%, which is where Wave 1 measured it: the
  // hold-back floor deliberately pins a struggling player in the same place at
  // every difficulty (that is what the floor is FOR), so at 85% the ladder is
  // flat by design and says nothing about whether difficulty still works.
  const ladder = [1, 2, 3].map(d => mean(SEEDS.map(seed => race({ track: 'oasis', difficulty: d, pace: 1.00, seed }).pos)));
  console.log(`  difficulty ladder on oasis alone at 100%, mean place: ${ladder.map(p => f(p, 1)).join('  ->  ')}`);
  assert(ladder[0] <= 3.0, `difficulty 1 is still the gentle end (mean place ${f(ladder[0], 1)} <= 3.0)`);
  assert(ladder[1] >= ladder[0] + 0.5 && ladder[2] >= ladder[1] - 1e-9,
    'each difficulty step is a visible step down the order for a competent player');
  assert(ladder[2] - ladder[0] >= 1.5,
    `difficulty 3 is meaningfully harder than difficulty 1 (${f(ladder[0], 1)} -> ${f(ladder[2], 1)})`);
  const lb = results[0.85].flatMap(({ runs }) => runs.map(r => r.lapsBehind));
  assert(Math.max(...lb) < 0.5, `an 85% player is never close to lapped (worst ${f(Math.max(...lb))} laps)`);
  const p85 = results[0.85].flatMap(({ runs }) => runs.map(r => r.pos));
  assert(Math.max(...p85) <= 7,
    `an 85% player is never last (worst place ${Math.max(...p85)} <= 7) — the field is harder, not a wall`);
}

// --- 4. the band stays inside its hard bound --------------------------------
console.log('\n=== 4. THE BAND IS STILL HARD-BOUNDED ===');
console.log(`  measured band multiplier over ${3 * RACES.length * SEEDS.length} races: ${f(bandLo, 4)} .. ${f(bandHi, 4)}`);
console.log(`  measured EFFECTIVE pace (band x base), lowest sample: ${f(effPaceLo, 4)}  floor ${f(BAND_FLOOR_PACE, 3)}`);
console.log(`  ceiling: +BAND_CATCH = ${f(1 + BAND_CATCH, 3)};  floor: never slower than ${f(BAND_FLOOR_PACE, 3)} of clean flat-out`);
assert(bandHi <= 1 + BAND_CATCH + 1e-6,
  `no opponent ever exceeds the catch-up ceiling (peak ${f(bandHi, 4)} <= ${f(1 + BAND_CATCH, 3)})`);
// The floor is the one the never-lapped promise rests on, and it is an absolute
// pace now, so it is checked as one: no sample may fall below either the
// per-driver band floor or BAND_FLOOR_PACE of the AI's own clean flat-out.
assert(worstPaceFloorSlack >= -1e-6,
  `no opponent ever drops below its own band floor (worst slack ${f(worstPaceFloorSlack, 4)})`);
assert(effPaceLo >= BAND_FLOOR_PACE - 1e-6,
  `no opponent ever runs slower than ${f(BAND_FLOOR_PACE, 2)} of its clean flat-out (lowest ${f(effPaceLo, 4)})`);
assert(BAND_CATCH <= 0.075,
  `the catch-up ceiling has not been widened (catch ${f(BAND_CATCH, 3)} <= 0.075)`);
// Hold-back can only ever make an opponent SLOWER, so a deep floor cannot make a
// race unwinnable — but it can make one look staged, so it is bounded too.
assert(BAND_HOLD <= 0.170 && BAND_FLOOR_PACE >= 0.60,
  `the hold-back floor is deep but bounded (min authority ${f(BAND_HOLD, 3)}, pace floor ${f(BAND_FLOOR_PACE, 2)} >= 0.60)`);

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

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
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { createAIField, BAND_CATCH, BAND_HOLD, BAND_FLOOR_PACE, aiPartTier } from '../src/kart/ai.js';

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
  // Race 2 is the one a tier-2 kart only fights for rather than wins outright,
  // which is the intended shape: on the hardest of the three for a reference
  // driver, the last step has to come from the quiz or the garage. The other
  // half of that promise — a FULLY-spent garage must still close race 2, or the
  // championship is unwinnable — is asserted in section 3b instead of here,
  // because on five seeds it is a coin flip: the same code measures 3/5 and 4/5
  // depending on which five, while over 21 seeds it is a stable 48%.
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
  // 1.0, not 1.5: at 100% pace a clean driver is inside the front of the field
  // on every race, so eight places compress into a few seconds and the ladder
  // has little room to open. The gradient that matters to a child who is NOT
  // driving a machine-perfect line is the 85% ladder at the bottom of this
  // section, and that one is held to 1.5.
  assert(ladder[2] - ladder[0] >= 1.0,
    `difficulty 3 is meaningfully harder than difficulty 1 (${f(ladder[0], 1)} -> ${f(ladder[2], 1)})`);
  const lb = results[0.85].flatMap(({ runs }) => runs.map(r => r.lapsBehind));
  assert(Math.max(...lb) < 0.5, `an 85% player is never close to lapped (worst ${f(Math.max(...lb))} laps)`);
  const p85 = results[0.85].flatMap(({ runs }) => runs.map(r => r.pos));
  assert(Math.max(...p85) <= 7,
    `an 85% player is never last (worst place ${Math.max(...p85)} <= 7) — the field is harder, not a wall`);

  // THE LADDER A STRUGGLING CHILD ACTUALLY EXPERIENCES.
  // Everything above this line is about a player who can hold ~100% of a clean
  // line. Nothing above it can see the failure that matters most: the first
  // Wave-4 build read 6.0 / 6.0 / 6.2 at 85% pace — race 1, the first race a
  // child ever plays and the one BEFORE the garage exists, was exactly as
  // punishing as the finale, and every safety assertion above still passed.
  // A mutation that puts the opponents on tier-2 karts in race 1 moves this
  // number and moves nothing else in the file.
  const e85 = results[0.85].map(({ runs }) => mean(runs.map(r => r.pos)));
  console.log(`  85% ladder (the struggling-child curve): ${e85.map(p => f(p, 1)).join('  ->  ')}`);
  assert(e85[2] - e85[0] >= 1.5,
    `race 1 is genuinely the gentle one for a struggling player: ${f(e85[0], 1)} on race 1 vs ` +
    `${f(e85[2], 1)} on race 3 (gradient ${f(e85[2] - e85[0], 1)} >= 1.5 places)`);
  assert(e85[1] >= e85[0] + 0.5,
    `and it is a ladder, not a step: race 2 (${f(e85[1], 1)}) sits above race 1 (${f(e85[0], 1)})`);
  assert(e85[0] >= 3.0,
    `race 1 at 85% is gentle, not a free win (mean place ${f(e85[0], 1)} >= 3.0)`);
}

// --- 3b. race 2 is the MIDDLE RUNG, on both axes (Wave 5) --------------------
// The bug this section exists to catch, reported from a real playtest: "race 2
// is easier than race 1 — winnable by clean driving alone whatever the kart is
// in". Everything above this line passed while that was true, because on the
// five gate seeds race 1 and race 2 both read mean 3.0 at 100% pace and the
// only assertions about them were one-sided bounds.
//
// Measured on the SAME 21 seeds, before (circuit 0.96) -> after (0.98):
//   race 2, stock, 100%          3.19 (best 2nd) -> 3.62 (best 3rd)
//   race 2, tier-3, 100%         1.14, 18/21 wins -> 1.52, 10/21 wins
//   race 1 / race 3, stock 100%  2.33 / 3.71 (untouched: the constant is
//                                keyed by track and race N -> track N)
// Twenty-one seeds rather than five because both cells that carry the bug are
// coin flips at five: the tier-3 win count reads 3/5 or 4/5 on the same code.
console.log('\n=== 3b. RACE 2 IS THE MIDDLE RUNG (21 seeds, both axes) ===');
{
  const S21 = [3, 11, 19, 41, 57, 2, 7, 23, 31, 47, 61, 5, 13, 29, 37, 53, 67, 71, 79, 83, 97];
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const T3 = { engine: 3, tyres: 3, frame: 3, turbo: 3 };
  const cell = (R, pace, parts = null) => {
    const p = S21.map(seed => race({ track: R.track, difficulty: R.difficulty, pace, seed, parts }).pos);
    return { p, mean: mean(p), wins: p.filter(x => x === 1).length, best: Math.min(...p) };
  };
  const [R1, R2, R3] = RACES;
  const c1 = cell(R1, 1.00), c2 = cell(R2, 1.00), c3 = cell(R3, 1.00);
  const c2t3 = cell(R2, 1.00, T3);
  const e1 = cell(R1, 0.85), e2 = cell(R2, 0.85), e3 = cell(R3, 0.85);
  const show = (n, c) => console.log(`  ${n}: mean ${f(c.mean)}  best ${c.best}  wins ${c.wins}/${S21.length}  [${c.p.join(' ')}]`);
  show('race 1 stock 100%', c1); show('race 2 stock 100%', c2); show('race 3 stock 100%', c3);
  show('race 2 TIER-3 100%', c2t3);
  console.log(`  85% ladder over 21 seeds: ${f(e1.mean)}  ->  ${f(e2.mean)}  ->  ${f(e3.mean)}`);

  // (i) the reported failure, direct: race 2 must be a clear step DOWN the
  // order from race 1 for the same clean, unengaged, stock driver. Pre-fix 0.86.
  assert(c2.mean - c1.mean >= 1.05,
    `race 2 is strictly harder than race 1 for a stock clean driver ` +
    `(${f(c1.mean)} -> ${f(c2.mean)}, gap ${f(c2.mean - c1.mean)} >= 1.05 places)`);
  // (ii) and lands where the brief wants it: 3rd-4th, never a podium handed out
  // for driving alone. Pre-fix 3.19 with 2nd places on 4 of the 21 seeds.
  assert(c2.wins === 0 && c2.mean >= 3.40,
    `race 2 with no engagement is a 3rd-4th finish, not a podium fight ` +
    `(mean ${f(c2.mean)} >= 3.40, ${c2.wins} wins)`);
  // (iii) the other end of the same requirement: race 2 must stay BELOW the
  // finale. If a future rebalance overshoots this constant, race 2 becomes the
  // hardest race in the championship and the curve is broken the other way.
  assert(c2.mean <= c3.mean + 0.25,
    `race 2 is still easier than the finale (race 2 ${f(c2.mean)} <= race 3 ${f(c3.mean)} + 0.25)`);
  // (iv) THE SPECIFIC PLAYTEST COMPLAINT: a well-upgraded kart driven cleanly,
  // with zero quiz engagement, must not simply collect race 2. Pre-fix a tier-3
  // kart won 18 of 21 seeds (86%) at mean 1.14 — the race was a formality for
  // anyone who had spent in the garage.
  assert(c2t3.mean >= 1.35 && c2t3.wins <= 13,
    `race 2 is not a formality for a well-upgraded clean driver ` +
    `(tier-3 mean ${f(c2t3.mean)} >= 1.35, ${c2t3.wins}/${S21.length} wins <= 13)`);
  // (v) ...but a FULLY-spent garage must still close it, or the championship is
  // unwinnable for the child who did everything the game asked. This is the
  // assertion moved out of section 2b, where five seeds could not measure it.
  assert(c2t3.wins >= 5 && c2t3.mean <= 2.20,
    `race 2 is still won by a fully-spent garage (tier-3 ${c2t3.wins}/${S21.length} wins >= 5, ` +
    `mean ${f(c2t3.mean)} <= 2.20)`);
  // (vi) the struggling child's ladder, on the same 21 seeds. The hold-back
  // floor deliberately flattens this axis (D33b), so the margin here is small
  // by design — it is a shape guard, not the assertion that catches this bug.
  assert(e2.mean >= e1.mean + 0.75 && e2.mean <= e3.mean - 0.55,
    `at 85% race 2 still sits between the other two ` +
    `(${f(e1.mean)} -> ${f(e2.mean)} -> ${f(e3.mean)})`);
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

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

// THE QUIZ-ENGAGEMENT AXIS (Wave 5.1).
// ---------------------------------------------------------------------------
// `pace x parts` models a player's DRIVING and their GARAGE, and for four waves
// that was the whole model — which quietly assumed the third axis, how many quiz
// questions a child answers, does not move the finishing order. Wave 5.1 changed
// the cadence (6.4 -> 8.6 questions opened per engaged race) and the assumption
// had to be measured rather than assumed.
//
// A correct answer calls `body.applyBoost()` with the constants below, copied
// from src/race/quiz.js (`const BOOST` there). They are duplicated rather than
// imported because quiz.js reaches for the DOM at module scope; if that file's
// BOOST ever moves, section 6 is where the divergence shows up, and the bounds
// there are set so a real change to it goes red rather than silently passing.
//
// An engaged child is modelled as N correct answers spread evenly through the
// race in track progress. N = 8 is the measured cadence of the shipped build
// (spread 6-11, most races 8); N = 0 is clean-driving-only, which is the case
// the race-2 target is written against.
const QUIZ_BOOST = { strength: 1.3, duration: 2.4, impulse: 6 };

/**
 * One headless 3-lap race.
 * @param {number} boosts  correct quiz answers, spread evenly through the race
 * @returns {{pos, lapsBehind, gap, bandMin, bandMax, lonely, time}}
 */
function race({ track, difficulty, pace, seed, laps = 3, parts = null, boosts = 0, maxTime = 900 }) {
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
  // Answer times, in track progress: evenly spread, first one half an interval in.
  const boostAt = [];
  for (let k = 0; k < boosts; k++) boostAt.push(toLine + (k + 0.5) * laps / boosts);
  let nextBoost = 0;
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
    while (nextBoost < boostAt.length && pProg >= boostAt[nextBoost]) {
      player.applyBoost(QUIZ_BOOST.strength, QUIZ_BOOST.duration, QUIZ_BOOST.impulse);
      nextBoost++;
    }
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

// ---------------------------------------------------------------------------
// THE 40-SEED CELLS (Wave 5). Five seeds is enough for the cells where the
// answer is 40-of-40 or 0-of-40; it is NOT enough for any cell where the
// outcome is a fight, and every assertion about race 2 with an upgraded kart is
// exactly such a cell. Measured on four DISJOINT 40-seed sets (1-40, 41-80,
// 81-120, 121-160), the shipped code reads:
//
//   cell                        set A   set B   set C   set D   pooled
//   race 2 tier-2, 100%          2.17    2.35    2.27    2.08    2.22  (12% wins)
//   race 2 tier-3, 100%          1.63    1.63    1.90    1.57    1.68  (35% wins)
//   race 2 stock,  100%          3.73    3.85    3.85    3.75    3.79  (0% wins)
//   race 3 tier-2, 100%          1.10    1.10    1.13    1.02    1.09  (92% wins)
//
// while the five shipped SEEDS put race-2 tier-2 at exactly 2.00 with exactly
// 1 win — dead on both bounds of the assertion that used to live in 2b, which
// duly went red on two of four alternate five-seed sets. The bounds below are
// set from the pooled figure with margin, and each was checked to hold on all
// four sets. The seed set is the first forty integers: chosen by construction,
// so it cannot be quietly re-picked to make a number come out.
const S40 = Array.from({ length: 40 }, (_, i) => i + 1);
const T2 = { engine: 2, tyres: 2, frame: 2, turbo: 2 };
const T3 = { engine: 3, tyres: 3, frame: 3, turbo: 3 };
const _cells = new Map();
const cell40 = (R, pace, parts = null, tag = '', boosts = 0) => {
  const key = `${R.n}|${pace}|${tag}|q${boosts}`;
  if (!_cells.has(key)) {
    const p = S40.map(seed => race({ track: R.track, difficulty: R.difficulty, pace, seed, parts, boosts }).pos);
    const m = p.reduce((a, b) => a + b, 0) / p.length;
    const hist = new Array(8).fill(0);
    for (const x of p) hist[x - 1]++;
    _cells.set(key, {
      p, hist, mean: m, wins: p.filter(x => x === 1).length,
      podium: p.filter(x => x <= 3).length, best: Math.min(...p), worst: Math.max(...p),
    });
  }
  return _cells.get(key);
};

// --- 2b. ...but a garage upgrade wins it -------------------------------------
// The other half of "winnable, just earned". If a rebalance ever makes the field
// unbeatable, this is what says so. Tier 2 is a good-but-not-perfect prompt, and
// it is the tier the opponents themselves run in race 3.
console.log('\n=== 2b. A DECENT GARAGE UPGRADE WINS IT BACK ===');
{
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  console.log(`  opponents' own championship tier: race 1 ${aiPartTier(1)}, race 2 ${aiPartTier(2)}, race 3 ${aiPartTier(3)}`);
  for (const R of RACES) {
    // Races 1 and 3 are 40-of-40 wins on every seed set measured, so five seeds
    // answer them. Race 2 is a fight and gets the 40-seed cell.
    const fight = R.n === 2;
    const c = fight ? cell40(R, 1.00, T2, 't2') : (() => {
      const p = SEEDS.map(seed => race({ track: R.track, difficulty: R.difficulty, pace: 1.00, seed, parts: T2 }).pos);
      return { p, mean: mean(p), wins: p.filter(x => x === 1).length };
    })();
    const stock = fight ? cell40(R, 1.00, null, 'stock').mean
      : mean(results[1.00].find(x => x.R.n === R.n).runs.map(r => r.pos));
    console.log(`  race ${R.n}: mean ${f(c.mean)} over ${c.p.length} seeds, ${c.wins} wins ` +
      `(stock ${f(stock)} -> +${f(stock - c.mean)} places)`);
    if (fight) {
      // Pooled 2.22 over 160 seeds, worst set 2.35, best 2.08; wins 2-9 per 40.
      // The bound is 2.60, not the 2.00 this used to carry: 2.00 is BELOW the
      // true mean, so the old assertion was passing on seed luck and would have
      // gone red for the next person to touch these constants.
      assert(c.wins >= 1 && c.mean <= 2.60,
        `race 2: a tier-2 kart is fighting for the win ` +
        `(${c.wins}/${c.p.length} seeds won, mean place ${f(c.mean)} <= 2.60)`);
      // ...and not a walkover either: if a future change hands race 2 to anyone
      // holding a receipt, this side goes red. Measured floor 2.08 over 40.
      assert(c.mean >= 1.60,
        `race 2: a tier-2 kart still has to race for it (mean place ${f(c.mean)} >= 1.60)`);
      assert(c.mean <= stock - 1.00,
        `race 2: the upgrade is worth ${f(stock - c.mean)} places over stock (>= 1.00)`);
    } else {
      assert(c.wins >= 1 && c.mean <= 2.0,
        `race ${R.n}: a tier-2 kart is fighting for the win ` +
        `(${c.wins}/${c.p.length} seeds won, mean place ${f(c.mean, 1)} <= 2.0)`);
      assert(c.mean <= stock - 0.8,
        `race ${R.n}: the upgrade is worth ${f(stock - c.mean, 1)} places over stock (>= 0.8)`);
    }
  }
  // The other half of race 2's promise — a FULLY-spent garage must still close
  // it, or the championship is unwinnable — is asserted in section 3b, on the
  // same 40 seeds, for the same reason: on five seeds it is a coin flip (the
  // shipped code measures 3/5 and 4/5 depending on which five).
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
// Measured on S40 (seeds 1-40), before (circuit 0.96) -> after (0.98), with the
// same figure on three further disjoint 40-seed sets in brackets:
//   race 2, stock, 100%    3.17 -> 3.73   [3.13/3.15/2.80 -> 3.85/3.85/3.75]
//   race 2, tier-3, 100%   1.23, 31/40 wins -> 1.63, 16/40   [pre-fix 1.27/1.35/1.30
//                          (65-78% wins) -> 1.63/1.90/1.57 (20-43%)]
//   race 1 / race 3 stock  2.25 / 3.90, byte-identical before and after (the
//                          constant is keyed by track, and race N -> track N)
// Forty seeds, not five and not twenty-one: an earlier draft of this section
// quoted the tier-3 cell as "48% wins" from a 21-seed set, and three alternate
// 21-seed sets read 29%. The honest pooled figure over 160 seeds is 35%, and
// the per-40 spread is 20-43% — which is why the bound below is 60%, not 50%.
console.log('\n=== 3b. RACE 2 IS THE MIDDLE RUNG (40 seeds, both axes) ===');
{
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const [R1, R2, R3] = RACES;
  const c1 = cell40(R1, 1.00, null, 'stock');
  const c2 = cell40(R2, 1.00, null, 'stock');
  const c3 = cell40(R3, 1.00, null, 'stock');
  const c2t2 = cell40(R2, 1.00, T2, 't2');
  const c2t3 = cell40(R2, 1.00, T3, 't3');
  const c3t2 = cell40(R3, 1.00, T2, 't2');
  const show = (n, c) => console.log(`  ${n}: mean ${f(c.mean)}  best ${c.best}  wins ${c.wins}/${S40.length}`);
  show('race 1 stock  100%', c1); show('race 2 stock  100%', c2); show('race 3 stock  100%', c3);
  show('race 2 TIER-2 100%', c2t2); show('race 2 TIER-3 100%', c2t3); show('race 3 TIER-2 100%', c3t2);
  const e85 = results[0.85].map(({ runs }) => mean(runs.map(r => r.pos)));

  // Which of these bite the pre-fix bug is stated per assertion, because a
  // section where only some of the checks are catchers and the rest are guards
  // is exactly the kind of thing that gets mis-read as "six proofs".
  //
  // (i) CATCHER. The reported failure, direct: race 2 must be a clear step DOWN
  // the order from race 1 for the same clean, unengaged, stock driver.
  // Pre-fix 0.78-0.93 across the four seed sets; after 1.48-1.73.
  assert(c2.mean - c1.mean >= 1.20,
    `race 2 is strictly harder than race 1 for a stock clean driver ` +
    `(${f(c1.mean)} -> ${f(c2.mean)}, gap ${f(c2.mean - c1.mean)} >= 1.20 places)`);
  // (ii) CATCHER. And it lands where the brief wants it: 3rd-4th, never a podium
  // handed out for driving alone. Pre-fix 2.80-3.17, with outright WINS on two
  // of the four sets; after 3.73-3.85 and no win in 160 seeds.
  assert(c2.wins === 0 && c2.mean >= 3.40,
    `race 2 with no engagement is a 3rd-4th finish, not a podium fight ` +
    `(mean ${f(c2.mean)} >= 3.40, ${c2.wins} wins)`);
  // (iii) GUARD, green against the pre-fix bug. The other end of the same
  // requirement: race 2 must stay BELOW the finale for a stock driver. Trips on
  // an over-hardening mutant (circuit 1.02+), not on the bug.
  assert(c2.mean <= c3.mean + 0.35,
    `race 2 is still easier than the finale for a stock driver ` +
    `(race 2 ${f(c2.mean)} <= race 3 ${f(c3.mean)} + 0.35)`);
  // (iv) CATCHER, and the specific playtest complaint: a well-upgraded kart
  // driven cleanly, with zero quiz engagement, must not simply collect race 2.
  // Pre-fix a tier-3 kart won 26-31 of every 40 seeds (65-78%) at mean 1.23-1.35;
  // after, 8-17 of 40 (20-43%) at 1.57-1.90. Both halves of the bound bite on
  // all four seed sets; the mean bound is 1.45 rather than 1.50 because the
  // pre-fix cell reaches 1.35 on one of them.
  assert(c2t3.mean >= 1.45 && c2t3.wins <= 24,
    `race 2 is not a formality for a well-upgraded clean driver ` +
    `(tier-3 mean ${f(c2t3.mean)} >= 1.45, ${c2t3.wins}/${S40.length} wins <= 24 (60%))`);
  // (v) GUARD, green against the pre-fix bug — it fails the OTHER way, on an
  // over-hardened field (it trips at circuit 1.04 and on the reverted-pace
  // mutant). A fully-spent garage must still close race 2, or the championship
  // is unwinnable for the child who did everything the game asked. Measured
  // 8-17 wins per 40; the bound is 4 so that normal seed-to-seed spread cannot
  // flap it.
  assert(c2t3.wins >= 4 && c2t3.mean <= 2.20,
    `race 2 is still won by a fully-spent garage (tier-3 ${c2t3.wins}/${S40.length} wins >= 4, ` +
    `mean ${f(c2t3.mean)} <= 2.20)`);
  // (vi) GUARD, green against the pre-fix bug. The struggling child's ladder.
  // The hold-back floor deliberately flattens this axis (D33b), so the margin
  // here is small by design and it is measured on the five-seed sweep already
  // taken at the top of this file rather than on 40 fresh races.
  assert(e85[1] >= e85[0] + 0.75 && e85[1] <= e85[2] - 0.55,
    `at 85% race 2 still sits between the other two ` +
    `(${f(e85[0])} -> ${f(e85[1])} -> ${f(e85[2])})`);

  // (vii) PINS A KNOWN-WRONG SHAPE. READ THIS BEFORE "FIXING" IT.
  // ------------------------------------------------------------------------
  // On the axis an engaged child is actually on — a kart with garage parts in
  // it — the championship is INVERTED, and this assertion pins that rather than
  // claiming it is right. Measured on S40 (four disjoint 40-seed sets agree):
  //
  //     kart                  race 1        race 2         race 3
  //     tier-2 all slots      1.00 (100%)   2.22 (12%)     1.09 (92%)
  //     tier-3 all slots      1.00 (100%)   1.68 (35%)     1.00 (100%)
  //     eng3/tyre2/frame1     1.00 (100%)   2.23 (11%)     1.79 (37%)
  //
  // So the child who spends in the garage — the entire lesson of the game —
  // meets the wall in the middle and coasts through the finale. This is
  // PRE-EXISTING: at circuit 0.96 it was already 1.82 (race 2) against 1.09
  // (race 3), a 0.73-place inversion; Wave 5's race-2 fix widened it to 1.13.
  // It was left open deliberately, because closing it means making race 3
  // harder and Wave 5's brief froze races 1 and 3 as approved. GAPS.md carries
  // the measured lever (the finale's opponents on tier-3 parts).
  //
  // A GREEN TICK HERE DOES NOT MEAN THE CURVE IS CORRECT. It means the curve is
  // still as wrong as it was when this was measured. Whoever fixes race 3 will
  // see this go red: that is the intended signal — re-derive the numbers above,
  // then flip this into a real ladder assertion (race 3 tier-2 >= race 2 tier-2).
  const inversion = c2t2.mean - c3t2.mean;
  console.log(`  KNOWN-WRONG upgraded ladder: race 2 tier-2 ${f(c2t2.mean)} vs race 3 tier-2 ` +
    `${f(c3t2.mean)} (inverted by ${f(inversion)} places)`);
  assert(inversion >= 0.60 && inversion <= 1.60,
    `the upgraded-kart inversion is UNCHANGED at ${f(inversion)} places ` +
    `(race 2 ${f(c2t2.mean)} vs race 3 ${f(c3t2.mean)}; pinned 0.60..1.60 — see the note above)`);
  assert(c3t2.wins >= 28,
    `race 3 is still a walkover for an upgraded kart (${c3t2.wins}/${S40.length} wins >= 28) ` +
    `— pinned, not endorsed`);
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

// --- 6. THE QUIZ-ENGAGEMENT AXIS (Wave 5.1) ---------------------------------
// Everything above this line models a player as `pace x parts`. A child also
// ANSWERS QUESTIONS, and every correct answer is a speed boost, so "is race 2
// too easy?" has two different causes with two different fixes: the field's pace
// is wrong, or engagement is over-rewarded. This section measures the second one
// so the two can be told apart, and pins it so a future change to the quiz's
// BOOST constant or to the question cadence cannot move the difficulty curve
// without a gate going red.
//
// MEASURED, 40 seeds, 100% pace, stock kart, x0 vs x8 correct answers:
//
//   cell                  x0 (clean only)        x8 (fully engaged)     worth
//   race 1 (oasis)    2.25  5/40 wins  40 pod   1.45  22/40  40 pod   0.80 pl
//   race 2 (circuit)  3.73  0/40 wins   9 pod   3.48   0/40  16 pod   0.25 pl
//   race 3 (cloud)    3.90  0/40 wins  15 pod   3.40   1/40  26 pod   0.50 pl
//
// So a correct answer is worth 0.03-0.10 of a finishing place — 0.16-0.38s of
// lap time — and eight of them are worth well under one garage tier (a tier-2
// kart is 7.2-9.5s a race). The reason is mechanical and worth knowing before
// anyone "fixes" it: the quiz boost is 1.30x, a purple drift release is 1.38x,
// and a clean autopilot lap is already inside a drift boost about two thirds of
// the time — so most answers land on top of a STRONGER boost and buy only
// `duration * 0.35`. Engagement is under-rewarded here, not over-rewarded, which
// is the evidence that race 2's old walkover was a PACE problem (fixed at
// TRACK_PACE.circuit) and not an engagement problem.
//
// Do not buff the quiz boost to "make engagement matter" without re-running
// this: measured, 1.45x/4.0s takes race 1 from 22/40 wins to 40/40 — it hands
// the first race, the one a child plays before the garage exists, to anyone who
// answers the questions, and still does not win them race 2 (0/40 at 1.60x/4.0s).
console.log('\n=== 6. THE QUIZ-ENGAGEMENT AXIS (40 seeds, x0 vs x8 correct answers) ===');
{
  const [R1, R2, R3] = RACES;
  const q0 = [cell40(R1, 1.00, null, 'stock'), cell40(R2, 1.00, null, 'stock'), cell40(R3, 1.00, null, 'stock')];
  const q8 = [cell40(R1, 1.00, null, 'stock', 8), cell40(R2, 1.00, null, 'stock', 8), cell40(R3, 1.00, null, 'stock', 8)];
  const perAnswer = [0, 1, 2].map(i => (q0[i].mean - q8[i].mean) / 8);
  for (let i = 0; i < 3; i++) {
    console.log(`  race ${i + 1}: x0 mean ${f(q0[i].mean)} (${q0[i].wins} wins, ${q0[i].podium} podiums) ` +
      `-> x8 mean ${f(q8[i].mean)} (${q8[i].wins} wins, ${q8[i].podium} podiums)  ` +
      `worth ${f(q0[i].mean - q8[i].mean)} places, ${f(perAnswer[i], 3)}/answer  dist x8 ${q8[i].hist.join(' ')}`);
  }
  // (i) CATCHER, on the quiz side. Engagement has to be VISIBLY worth doing on
  // the race a child meets before the garage exists: race 1 is where answering
  // turns a fought-for 2nd into a win. Goes red if the boost is nerfed, if the
  // cadence collapses, or if quiz.js stops calling applyBoost at all (at x0 this
  // cell reads 2.25 with 5/40 wins, so both halves fail).
  assert(q8[0].mean <= 1.75 && q8[0].wins >= 10,
    `race 1: answering the questions turns 2nd into a win fight ` +
    `(x8 mean ${f(q8[0].mean)} <= 1.75, ${q8[0].wins}/${S40.length} wins >= 10, from ${f(q0[0].mean)} at x0)`);
  // (ii) GUARD, the other side of the same number: engagement must not TRIVIALISE
  // race 1. Trips at boost 1.45x/2.4s (1.07) and 1.45x/4.0s (1.00).
  assert(q8[0].mean >= 1.15,
    `race 1 is still a race for an engaged child (x8 mean ${f(q8[0].mean)} >= 1.15)`);
  // (iii) CATCHER. Race 2's target, stated on the axis the playtest complaint was
  // really about: a clean driver who ALSO answers everything still does not win
  // race 2 — the garage is the lever there. Red on the pre-Wave-5 pace
  // (circuit 0.96) and red on a boost buffed to 1.45x/4.0s (3.02).
  assert(q8[1].wins === 0 && q8[1].mean >= 3.10,
    `race 2 is not won by engagement alone (x8 mean ${f(q8[1].mean)} >= 3.10, ${q8[1].wins} wins)`);
  // (iv) CATCHER. Race 2 stays the middle rung under FULL engagement too, not
  // just for the unengaged driver section 3b measures. Pre-fix (circuit 0.96)
  // this gap collapses with race 2's mean.
  assert(q8[1].mean - q8[0].mean >= 1.50,
    `race 2 is still strictly harder than race 1 for an engaged child ` +
    `(${f(q8[0].mean)} -> ${f(q8[1].mean)}, gap ${f(q8[1].mean - q8[0].mean)} >= 1.50)`);
  // (v) GUARD, and the direct answer to "is engagement over-rewarded?". A single
  // correct answer may not be worth more than a seventh of a finishing place on
  // any race; measured 0.100 / 0.031 / 0.063. Trips on every boost buff measured
  // (1.45x/4.0s reads 0.156 on race 1 and 0.163 on race 3).
  assert(Math.max(...perAnswer) <= 0.14,
    `one correct answer is a nudge, not a shortcut (worst ${f(Math.max(...perAnswer), 3)} places/answer <= 0.14)`);
}

// --- 7. RACE 3, MEASURED EXPLICITLY (Wave 5.1) ------------------------------
// The finale had never been playtested by a human, so its target is asserted
// here rather than inferred from the sections above: winning it should want a
// decent upgrade AND engagement, and a 70%-pace child must never be lapped on
// `cloud` — the one track where Wave 1 measured 1.04 laps down (LAPPED) and
// Wave 2 claimed a fix that was never re-measured end to end.
//
// MEASURED, 40 seeds unless stated:
//   100% stock  x0   mean 3.90  best 2nd  0 wins  15/40 podiums  +2.2s to winner
//   100% stock  x8   mean 3.40  best 1st  1 win   26/40 podiums
//   100% tier-2 x0   mean 1.10  36/40 wins        <- OFF TARGET, see below
//   100% tier-2 x8   mean 1.00  40/40 wins
//    85% stock  x0   mean 6.17            0.10 laps behind
//    70% stock  x0   8th on 40/40 seeds   0.21 laps behind, 0 lapped, nearest
//                    opponent never further than 0.08 laps up the road
//
// VERDICT: half on target, half off, and the off half is FLAGGED not fixed
// (Wave 5.1's brief froze race 3). The clean-driver half is right — 3.90 stock,
// no win in 40 seeds, and engagement moves it to 3.40 with one win. The upgrade
// half is not: a tier-2 kart wins the finale 36 times in 40 with ZERO questions
// answered, so "a decent upgrade AND engagement" is really "a decent upgrade".
// This is the same inversion pinned in 3b (vii) — race 3 is easier than race 2
// for an upgraded kart — and it is one fault, not two: the finale's opponents
// stop at tier-2 parts (`aiPartTier` caps at 2), so a child arriving on tier-2
// meets an equally-equipped field on the geometry with the least room to defend.
// GAPS.md carries the lever (the finale's opponents on tier-3).
console.log('\n=== 7. RACE 3 MEASURED AGAINST ITS TARGET ===');
{
  const R3 = RACES[2];
  const c0 = cell40(R3, 1.00, null, 'stock');
  const c8 = cell40(R3, 1.00, null, 'stock', 8);
  console.log(`  clean stock: x0 mean ${f(c0.mean)} best ${c0.best} worst ${c0.worst} wins ${c0.wins} podiums ${c0.podium}  dist ${c0.hist.join(' ')}`);
  console.log(`  engaged x8:  mean ${f(c8.mean)} best ${c8.best} worst ${c8.worst} wins ${c8.wins} podiums ${c8.podium}  dist ${c8.hist.join(' ')}`);
  // (i) ON TARGET, both sides. The finale is not won by driving, engaged or not…
  assert(c0.wins === 0 && c0.mean >= 3.40,
    `race 3 is not won by clean driving alone (mean ${f(c0.mean)} >= 3.40, ${c0.wins} wins)`);
  assert(c8.wins <= 4 && c8.mean >= 3.00,
    `…nor by clean driving plus a full set of correct answers ` +
    `(x8 mean ${f(c8.mean)} >= 3.00, ${c8.wins}/${S40.length} wins <= 4)`);
  // (ii) …and it is not a wall either: a stock, unengaged child still finishes
  // mid-pack and on the podium sometimes, rather than being strung out.
  assert(c0.mean <= 4.60 && c0.podium >= 5,
    `race 3 is a finale, not a wall (mean ${f(c0.mean)} <= 4.60, ${c0.podium}/${S40.length} podiums >= 5)`);

  // (iii) THE STANDING CONSTRAINT FROM GAPS.md, on the track it was broken on.
  // Section 1 checks all three races on the five gate seeds; this checks `cloud`
  // specifically, on twelve, with a tighter budget — because this is the cell
  // that was measured at 1.04 laps down in the built game and it is the promise
  // the whole rubber band exists to keep. 0.30 headless is ~0.51 in the built
  // game (headless runs ~1.7x kinder — see the note at the top of this file).
  const S12 = S40.slice(0, 12);
  const runs = S12.map(seed => race({ track: R3.track, difficulty: R3.difficulty, pace: 0.70, seed }));
  const lb = runs.map(r => r.lapsBehind);
  const lonely = Math.max(...runs.map(r => r.lonely));
  console.log(`  70% pace on cloud, ${S12.length} seeds: laps behind ${f(Math.min(...lb))}..${f(Math.max(...lb))}, ` +
    `lapped ${runs.filter(r => r.lapsBehind >= 1).length}, worst gap to nearest kart ${f(lonely)} laps, ` +
    `places ${Math.min(...runs.map(r => r.pos))}..${Math.max(...runs.map(r => r.pos))}`);
  assert(runs.every(r => r.lapsBehind < 1),
    `race 3: a 70%-pace child is NEVER lapped on cloud (${runs.filter(r => r.lapsBehind >= 1).length}/${S12.length} lapped)`);
  assert(Math.max(...lb) < 0.30,
    `race 3: and not close to it (worst ${f(Math.max(...lb))} laps behind, budget 0.30)`);
  assert(lonely < 0.15,
    `race 3: a 70%-pace child always has a kart in sight (worst ${f(lonely)} laps to the nearest, budget 0.15)`);
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

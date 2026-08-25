// Balance + fairness gate for src/kart/ai.js.
//
//   node tests/ai.test.mjs          the gate (~3.5 min: a 5-seed sweep, the
//                                   40-seed cells sections 2b-2c/3b/6/7/7c need,
//                                   and section 8's 8 karts x 3 races x 40 seeds
//                                   — that last block is ~90s of the total)
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
//    alone on track, the exact outcome the band exists to prevent. (That 1.04
//    is PRE-D64, a Wave-1 built-game reading; it is quoted as the shape of the
//    failure, not as a figure to compare with anything current.)
// 2. The race has to be worth winning. Wave 1's AI was slower than a clean
//    driver on its own flat-out, so a passive 100%-pace player won all three
//    races on all five seeds. Wave 4 put the field on a flat 1.00 pace with a
//    per-track calibration and gave the opponents the same garage upgrades the
//    child buys (stock / tier 1 / tier 2 across the championship). The target
//    feel, and what sections 2-3 pin: clean driving with no engagement is
//    2nd-3rd on race 1 and 3rd-5th on races 2-3, and a decent garage upgrade
//    turns that back into a win.
// 3. THE RACE HAS TO FEEL LIKE A RACE (Wave 6). Finishing position cannot see
//    whether the child spent the race in a fight, and a playtest found races
//    1-2 reading as "cruising alone" while hitting their position targets
//    exactly. Section 2c measures the pack itself — how much of the race the
//    child leads, how close the nearest rival is, how many passes the child can
//    actually SEE — with race 3 on a stock kart as the reference profile the
//    player named as the exemplar, and bounds it two-sided so neither the
//    cruise nor an over-correction into race-3 pressure can come back. Round 2
//    re-derived every bound in it from five disjoint 40-seed sets after three of
//    them turned out to be one seed from red on sets the author never tried, and
//    corrected two metrics that could not see what they claimed to (see race()).
// 4. A CHILD MUST NEVER BE PUNISHED FOR BUYING A PART (Wave 6, section 7c). The
//    finale's field steps a whole tier when the child's own kart is good enough,
//    which is a full finishing place; where that threshold sits decides whether
//    a better prompt can produce a WORSE result. Section 7c measures it over the
//    garages a championship can actually build — two visits, one part each, so
//    at most two non-zero slots — rather than over the uniform tier-2/tier-3
//    karts the rest of this file uses to pin the extremes.
// 5. PICKING A KART IS A CHARACTER CHOICE, NOT A DIFFICULTY CHOICE (Wave 6.1,
//    section 8). Everything above this line is measured on ONE kart, ROSTER[0].
//    The other seven lap at their own pace, and against a field that never
//    noticed, that was worth up to two finishing places — more than the whole
//    garage, and invisible to the child. Section 8 is the only part of this file
//    that races anything other than the reference kart, and the only place the
//    per-kart field correction (KART_PACE) is held to its sign, its clamp, its
//    per-track structure and its wiring.
//
// HOW THE MEASUREMENTS IN THIS FILE ARE LABELLED, AND THE ONE RULE ABOUT THEM
// ---------------------------------------------------------------------------
// Wave 7 found that every difficulty figure this project published between
// Wave 4 and Wave 6 was read off a crooked ruler (D64: the progress origin, the
// accumulator phase skew, and the `lapT` projection snaps — three leaks in the
// same quantity, all of them moving the running order). Comments below
// therefore label the numbers they quote:
//   PRE-D64  measured on the broken instrument. Kept rather than deleted,
//            because it is usually the argument that MOVED a constant and a
//            bound with no derivation is worse than one with a historical
//            derivation — but it is not a description of the game as it stands.
//   HONEST   measured after the fix: D67 / D68 / D69, or a live run of this
//            file (the shipped-build figures quoted below are from the Wave-7
//            run, and are what a green run still prints).
// A PRE-D64 number may NEVER be compared against an HONEST one. That comparison
// is itself the mistake D64 exists to name, and D67 committed it once while
// writing D64 up — see the "D67 CORRECTION" entry in DECISIONS.md. Where a
// before/after pair is quoted here, either both sides come off the same
// instrument (so the direction is readable) or the pair is marked as not
// differenceable. `src/kart/ai.js` carries the same labelling on the constants
// these bounds pin, and points here for the honest figures.
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
// thresholds below carry that offset as margin. BOTH of those readings are
// PRE-D64 (Wave 1, same instrument on both sides, which is what makes the
// ~1.7x ratio between them the usable part). The ratio has not been re-measured
// since the fix, so treat it as a rule of thumb rather than a figure.
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import {
  createAIField, BAND_CATCH, BAND_HOLD, BAND_FLOOR_PACE, aiPartTier, playerPartTier,
  KART_PACE, KART_PACE_CLAMP, PACE_REF_ID, kartPace,
} from '../src/kart/ai.js';
// Section 8 re-derives the per-kart pace table from the physics rather than
// trusting the constant. `tools/kartpace.mjs` is a measurement tool with an
// isMain CLI guard, so importing it runs nothing.
import { measureCell, paceRatios, TRACK_IDS } from '../tools/kartpace.mjs';

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

// Pack-feel sampling: seconds of race skipped before any pack metric is taken,
// and the gap inside which a place change counts as a pass the child can see.
// Both are justified at the metric block inside race().
const SETTLE = 15;
const CLOSE_PASS = 1.0;

/**
 * One headless 3-lap race.
 * @param {number} boosts  correct quiz answers, spread evenly through the race
 * @returns {{pos, lapsBehind, gap, bandMin, bandMax, lonely, time}}
 */
function race({ track, difficulty, pace, seed, laps = 3, parts = null, boosts = 0, maxTime = 900,
  racerId = ROSTER[0].id }) {
  const { def, spline } = getTrack(track);
  const slots = gridSlots(spline, def, 8);
  // Which kart the child chose. Defaults to ROSTER[0] (nitzotz) — the kart the
  // whole file was written against and the one every other section still uses —
  // so every existing cell is bit-for-bit unchanged. Section 8 is the only
  // caller that passes anything else. Note that this moves TWO things at once,
  // deliberately, because the game does: the player's physics AND the field's
  // composition (createAIField builds the field from the other seven).
  const racer = ROSTER.find(r => r.id === racerId) || ROSTER[0];
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
    // Wave 6: the finale's opponents scale with the child's own garage, so the
    // field has to see the player's parts. race.js passes exactly this.
    playerParts: parts,
  });

  // PROGRESS ORIGIN = the start/finish line, exactly as src/kart/ai.js measures
  // it. `progress0` is the signed arc offset of this kart's grid slot from
  // `def.startT` — a small NEGATIVE number, because gridSlots parks the field
  // 4..22 m behind the line. The finish is then `progress >= laps` for EVERY
  // kart alike. (Before Wave 6.1 this harness gave all eight karts one shared
  // `finishAt = toLine + laps` measured from the POLE kart's slot, which handed
  // every kart on rows 2-4 a 4-18 m head start in the measurement — the same
  // zero-origin bug the code itself had.)
  const progress0 = TrackSpline.deltaT(player.lapT, def.startT ?? 0);
  const finishAt = laps;
  // Answer times, in track progress: evenly spread, first one half an interval in.
  const boostAt = [];
  for (let k = 0; k < boosts; k++) boostAt.push(progress0 + (k + 0.5) * laps / boosts);
  let nextBoost = 0;
  const finish = new Array(field.drivers.length + 1).fill(null);
  let t = 0, prevT = player.lapT, pProg = progress0, lapsBehind = null;
  // "Alone on track", measured along the road rather than as the crow flies:
  // the worst moment of the race, in laps, between the player and the nearest
  // opponent in the running order. Euclidean distance lies on a folded circuit
  // (a kart half a lap up the road can be 30m away across a hairpin).
  let worstLonely = 0;

  // ---- PACK-FEEL METRICS (Wave 6) -----------------------------------------
  // Finishing position says who won; it says nothing about whether the child
  // spent the race in a fight. Gaps are in SECONDS, converted exactly the way
  // createAIField.update converts them (gapM / cruise, cruise = the rival's own
  // topSpeed x 0.82), so a number here means the same thing the band's own
  // input means, on a slow track and a fast one alike.
  //
  // TWO CORRECTIONS, round 2, both because the round-1 versions could not
  // discriminate the complaint they were built for:
  //
  //  * SETTLE. Nothing is sampled for the first 15 seconds. Eight karts leave a
  //    standing grid in formation, so for that whole window the nearest rival is
  //    inside 1.5s on EVERY race of EVERY build (measured: the pre-settle
  //    `near15` reads exactly 1.000 in all 45 cells taken across five builds and
  //    five seed sets) and the order churns while the field sorts itself out —
  //    7.0-7.5 sustained place changes on race 1 against 10.2 for the remaining
  //    ~138s, i.e. 41% of the round-1 count was the grid scramble rather than
  //    racing. A whole-race number is that start averaged with the race.
  //  * CLOSE PASSES rather than rank flicker. A place change only counts if, at
  //    the moment it sticks, the nearest rival is within CLOSE_PASS seconds —
  //    a pass the child can see out of the window, not an arithmetic swap with
  //    somebody up the road. HONEST RESULT: on every build and cell measured so
  //    far the filtered count equals the unfiltered one exactly, because after
  //    the settle window every sustained swap already happens inside a second.
  //    The filter is kept because it is the definition the assertion means, and
  //    because a future build that strings the field out is exactly the case
  //    where the two numbers would part company — but it did not, by itself,
  //    separate any two builds.
  const lapLen = spline.length;
  let nSamp = 0, near15 = 0, near30 = 0, ahead15 = 0, ahead30 = 0, leadSamp = 0, gapSum = 0;
  const gapSamples = [];
  let rank = null, rankPend = null, rankT = 0, closePasses = 0;

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

    // Sampled every step while the player is still racing AND the field has
    // settled (see SETTLE above).
    if (pProg < finishAt && t >= SETTLE) {
      let best = Infinity, bestAhead = Infinity, ahead = 0;
      for (const d of field.drivers) {
        const cruise = Math.max(12, d.body.p.topSpeed * 0.82);
        const g = ((d.progress - pProg) * lapLen) / cruise;   // +ve = rival up the road
        if (Math.abs(g) < best) best = Math.abs(g);
        if (g > 0) { ahead++; if (g < bestAhead) bestAhead = g; }
      }
      nSamp++;
      gapSum += best;
      if (best <= 1.5) near15++;
      if (best <= 3.0) near30++;
      if (bestAhead <= 1.5) ahead15++;
      if (bestAhead <= 3.0) ahead30++;
      if (ahead === 0) leadSamp++;           // nobody in front: the player is leading
      if ((nSamp % 6) === 0) gapSamples.push(best);
      // CLOSE PASSES: the player's own position in the running order changes,
      // HOLDS for >= 0.5s (the same sustained-swap idea as the field's own
      // _rankPass, at half the dwell), and the nearest rival is inside
      // CLOSE_PASS seconds when it sticks. A swap between two rivals elsewhere
      // on the track cannot move it, so every count is a pass made on, or by,
      // the kart the child can actually see; a multi-place jump counts once per
      // place.
      const r = 1 + ahead;
      if (rank == null) { rank = r; rankPend = r; rankT = 0; }
      else if (r !== rankPend) { rankPend = r; rankT = 0; }
      else {
        rankT += DT;
        if (rankT >= 0.5 && rankPend !== rank) {
          if (best <= CLOSE_PASS) closePasses += Math.abs(rankPend - rank);
          rank = rankPend;
        }
      }
    }

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
  const partTier = field.partTier;
  field.dispose();
  gapSamples.sort((a, b) => a - b);
  return {
    pos: order.findIndex(o => o[1] === 0) + 1,
    lapsBehind: lapsBehind ?? 0,
    gap: (finish[0] ?? Infinity) - order[0][0],
    bandMin: tel.bandMin, bandMax: tel.bandMax, basePace, bandFloor,
    lonely: worstLonely, time: t, partTier,
    // pack feel
    near15: near15 / nSamp, near30: near30 / nSamp,
    ahead15: ahead15 / nSamp, ahead30: ahead30 / nSamp,
    leadPct: leadSamp / nSamp, gapMean: gapSum / nSamp,
    gapMedian: gapSamples.length ? gapSamples[gapSamples.length >> 1] : 0,
    closePasses,
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
  // Every figure in that derivation is PRE-D64 (Wave 1 against Wave 4, both
  // sides on the crooked ruler). It is why the budget is 0.35; it is not a
  // reading of the game today, and the PRE-D64 reading of the shipped cells
  // ("measured after the rebalance: 0.17 / 0.15 / 0.20") is not one either.
  // HONEST (D67, and a live run of this file): worst laps behind at 70% pace is
  // 0.11 / 0.14 / 0.19-0.21 on races 1/2/3, with 0 of 600 races lapped. That is
  // close to the PRE-D64 reading by luck rather than by evidence — the two may
  // not be differenced — and either way the bound keeps ~0.14 laps of margin.
  assert(Math.max(...lb) < 0.35,
    `race ${R.n} (${R.track} d${R.difficulty}): 70%-pace player stays on the lead lap ` +
    `(worst ${f(Math.max(...lb))} laps behind, budget 0.35)`);
}
// Not being lapped is the guarantee; not being ALONE is what it is for. At the
// floor the field can only ease off so far, so the promise at 70% is "there is
// always somebody within half a lap" — before the band fix the nearest opponent
// on race 3 got 0.67 laps up the road, which is a child driving round an empty
// track.
// 0.25, down from 0.50. The derivation is PRE-D64 on both sides and is kept as
// the reason for the constant: 0.08 measured with the deep floor against 0.41
// for the Wave-1 code on race 3 (and the 0.67 above).
// HONEST (a live run of this file): worst 0.08 laps at 70% and 0.03 at 85% —
// the shipped side re-read on the fixed instrument, so the bound keeps its
// margin. The Wave-1 side has not been re-measured.
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
// exactly such a cell.
//
// PRE-D64 (crooked ruler). Kept because the load-bearing part of it is the
// SPREAD between disjoint seed sets — the argument for 40 seeds rather than 5 —
// and that argument is about sampling, not about the instrument. Measured on
// four DISJOINT 40-seed sets (1-40, 41-80, 81-120, 121-160):
//
//   cell                        set A   set B   set C   set D   pooled
//   race 2 tier-2, 100%          2.17    2.35    2.27    2.08    2.22  (12% wins)
//   race 2 tier-3, 100%          1.63    1.63    1.90    1.57    1.68  (35% wins)
//   race 2 stock,  100%          3.73    3.85    3.85    3.75    3.79  (0% wins)
//   race 3 tier-2, 100%          1.10    1.10    1.13    1.02    1.09  (92% wins)
//
// while the five shipped SEEDS put race-2 tier-2 at exactly 2.00 with exactly
// 1 win — dead on both bounds of the assertion that used to live in 2b, which
// duly went red on two of four alternate five-seed sets. The seed set is the
// first forty integers: chosen by construction, so it cannot be quietly
// re-picked to make a number come out.
//
// HONEST (D67, and what a live run of this file prints on S40 today):
//
//   cell                        S40    wins/40
//   race 2 tier-2, 100%         2.08      7
//   race 2 tier-3, 100%         1.57     17
//   race 2 stock,  100%         3.88      0
//   race 3 tier-2, 100%         2.15      7
//
// Do not difference the two tables. Note also that the race-3 tier-2 row moved
// for a reason that has nothing to do with the ruler: Wave 6 made the finale's
// field scale with the child's garage (D58), so 1.09 describes a build that no
// longer exists. The other three rows are the same cells re-read.
const S40 = Array.from({ length: 40 }, (_, i) => i + 1);
const T2 = { engine: 2, tyres: 2, frame: 2, turbo: 2 };
const T3 = { engine: 3, tyres: 3, frame: 3, turbo: 3 };
const _cells = new Map();
const _cellParts = new Map();
const cell40 = (R, pace, parts = null, tag = '', boosts = 0) => {
  // `tag` is part of the cache key and NOTHING ELSE about `parts` is, so two
  // different karts sharing a tag silently return each other's forty races. That
  // is not hypothetical: section 7c's single-part cells were first written with
  // tags 't2'/'t3' and quietly served section 3b's uniform tier-2 kart, which
  // reads a place and a half better. The assertion below makes the collision an
  // error instead of a wrong number.
  const key = `${R.n}|${pace}|${tag}|q${boosts}`;
  const sig = JSON.stringify(parts);
  if (_cellParts.has(key) && _cellParts.get(key) !== sig) {
    throw new Error(`cell40 tag collision on "${key}": ${_cellParts.get(key)} vs ${sig}`);
  }
  _cellParts.set(key, sig);
  if (!_cells.has(key)) {
    const runs = S40.map(seed => race({ track: R.track, difficulty: R.difficulty, pace, seed, parts, boosts }));
    const p = runs.map(r => r.pos);
    const m = p.reduce((a, b) => a + b, 0) / p.length;
    const hist = new Array(8).fill(0);
    for (const x of p) hist[x - 1]++;
    const avg = k => runs.reduce((a, r) => a + r[k], 0) / runs.length;
    _cells.set(key, {
      p, hist, mean: m, wins: p.filter(x => x === 1).length,
      podium: p.filter(x => x <= 3).length, best: Math.min(...p), worst: Math.max(...p),
      tier: runs[0].partTier,
      // pack feel, averaged over the forty races
      near15: avg('near15'), near30: avg('near30'), ahead15: avg('ahead15'),
      ahead30: avg('ahead30'), leadPct: avg('leadPct'), gapMean: avg('gapMean'),
      gapMedian: avg('gapMedian'), closePasses: avg('closePasses'), behind: avg('gap'),
    });
  }
  return _cells.get(key);
};

// --- 2c. THE PACK-FEEL PROFILE (Wave 6, 40 seeds) ---------------------------
// The playtest verdict that opened Wave 6: "race 3 on a stock kart is the
// exemplar — neck and neck the whole way, rivals occasionally ahead, boosts
// necessary, still winnable; races 1-2 feel like cruising alone" — even though
// races 1-2 hit their finishing-position targets. Position alone cannot see
// that, so this section measures the RACE rather than the result.
//
// ROUND 2 RE-DERIVED EVERYTHING HERE from the corrected metrics (settle skip +
// close passes; see race()), on FIVE disjoint 40-seed sets — 1-40, 41-80,
// 81-120, 201-240, 501-540 — because three of round 1's bounds turned out to be
// a seed set away from red. Each bound below states the measured population it
// came from and is labelled CATCHER (red against the build it exists to catch,
// with the margin stated) or GUARD (green both ways, there so a retune cannot be
// overshot). A bound whose two populations do not separate on all five sets is
// NOT called a catcher, however much one wishes it were.
//
// WAVE 7 RE-MEASURED THE WHOLE TABLE ON THE FIXED INSTRUMENT (D64/D67). Every
// number round 2 derived from was read off the crooked ruler — the progress
// origin, the accumulator phase skew and the `lapT` projection snaps all moved
// the running order, and close-pass counts in particular were inflated by the
// skew chattering the order across near-ties. The table below is the honest
// one, same five disjoint 40-seed sets, same cells:
//
//   honest metrics (D64), stock kart, 100% pace, min-max over the five sets
//                       race 1        race 2        race 3 (exemplar)
//   mean place          2.43-2.55     3.73-3.90     4.10-4.38
//   % of race led       45.6-55.9     2.2-3.6       1.6-4.9
//   rival ahead <=1.5s  29.8-35.5     92.6-94.3     93.5-96.5
//   nearest <=1.5s      95.0-96.3     99.99-100     99.9-100
//   mean gap            0.55-0.57     0.27-0.29     0.28-0.31
//   median gap          0.46-0.50     0.25-0.27     0.24-0.28
//   close passes/race   5.70-6.80     9.45-10.95    11.13-13.15
//   behind the winner   1.55-1.93s    1.98-2.12s    2.42-2.52s
//
// WHICH OF THE TWO READINGS THIS IS. D67 records race 1 as leading 47.3% of the
// race (against 46.0% recorded for the pre-Wave-6 build) with 6.4 close passes
// (against 7.7-8.7 recorded pre-Wave-6) and concludes that D58's race-1
// pack-feel repair is an artefact — i.e. that race 1 is genuinely a lonely race
// and the design goal is unmet. That inference is CROSS-INSTRUMENT: it compares
// an honest number against a number measured on the crooked ruler, which is the
// exact error D64 exists to name. Re-measuring the comparison build ON THE
// HONEST INSTRUMENT — `TRACK_PACE.oasis` reverted 1.09 -> 1.03, the pre-Wave-6
// value and the constant D58 raised — settles it, five sets, 40 seeds each:
//
//                          shipped (1.09)   pre-Wave-6 (1.03)   halfway (1.06)
//   close passes/race        5.70-6.80        1.68-2.10          4.65-4.98
//   % of race led           45.6-55.9        64.6-73.0          44.4-65.9
//   median gap               0.46-0.50        0.72-0.84          0.54-0.65
//   nearest <=1.5s          95.0-96.3        86.1-90.9          91.7-96.8
//   mean place               2.43-2.55        1.53-1.73          2.10-2.25
//
// Like for like, the shipped build has THREE TIMES the visible passes of the
// build D58 replaced, leads 18 points less of the race and sits half as far
// from its nearest rival. So this is reading (a): the metric was inflated, the
// design intent is intact, and D58's repair is in fact larger than the crooked
// ruler ever credited it with — the ruler flattered the LONELY build far more
// than the shipped one (recorded 7.7-8.7 against an honest 1.7-2.1), because a
// child cruising alone at the front is exactly where a phase skew has the most
// near-ties to chatter across. The bounds below are re-derived to the honest
// scale and each is shown separating the same two populations it always claimed
// to. Race 1 is not a lonely race on the honest instrument either: a rival is
// within 1.5s for 95% of it and the child makes or takes a visible pass roughly
// every 24 seconds. What it IS is a race the child leads about half of — which
// is what race 1 is FOR, and what (iv) pins from the other side.
//
// AND THE HONEST ANSWER ABOUT RACE 2, since round 1 shipped a change for it.
// Round 2's version of this paragraph said race 2 had "75% more visible passes
// than the exemplar" (26.4 vs 15.1). On the honest instrument that is gone:
// 9.45-10.95 against race 3's 11.13-13.15, i.e. race 2 has slightly FEWER, and
// the two are within a pass of each other on every axis these instruments have
// — it leads no more of the race (2.6% vs 3.4%), its nearest rival is as close
// (0.28s vs 0.30s) and its winner is CLOSER (2.04s vs 2.47s). `ahead<=1.5s`, the
// one axis round 2 said race 2 trailed the exemplar on, no longer trails: 92.6-
// 94.3 against 93.5-96.5, overlapping. SLOT_FWD_R2 still earns its place on the
// distance-to-the-front axis (v) pins, and pushing it further was measured and
// rejected on the crooked ruler for a reason that survives the re-measure in
// kind if not in number — it buys points on `ahead<=1.5s` by pulling the winner
// back into (vi). If race 2 still reads as cruising alone in a playtest, the
// cause is NOT in these six numbers and no further tuning of the band will find
// it — that is a GAPS entry, not a licence to keep turning knobs.
console.log('\n=== 2c. THE PACK-FEEL PROFILE (40 seeds, 100% pace, stock kart) ===');
{
  const [R1, R2, R3] = RACES;
  const P = [cell40(R1, 1.00, null, 'stock'), cell40(R2, 1.00, null, 'stock'), cell40(R3, 1.00, null, 'stock')];
  console.log(pad('race', 8) + ['mean pl', '%led', 'ah<=1.5s', 'ah<=3s', 'near<=1.5', 'gap mean', 'gap med', 'passes', 'behind'].map(h => padL(h, 10)).join(''));
  for (let i = 0; i < 3; i++) {
    const c = P[i];
    console.log(pad('race ' + (i + 1), 8) + padL(f(c.mean), 10) + padL(f(100 * c.leadPct, 1), 10) +
      padL(f(100 * c.ahead15, 1), 10) + padL(f(100 * c.ahead30, 1), 10) + padL(f(100 * c.near15, 1), 10) +
      padL(f(c.gapMean), 10) + padL(f(c.gapMedian), 10) + padL(f(c.closePasses, 1), 10) + padL(f(c.behind) + 's', 10));
  }
  const [p1, p2, p3] = P;

  // (i) GUARD, and the reference the other two are measured against. The finale
  // is frozen bit-for-bit on a stock kart this wave, so this can only go red if
  // someone changes race 3 — which is exactly what it is for.
  //
  // RE-DERIVED FOR D64. The profile this pins MOVED when the instrument was
  // fixed: race 3 now reads 1.6-4.9% led (was 1.3-2.1) and 93.5-96.5% chasing
  // (was 95.5-97.6), so the old 0.05 / 0.93 pair was pinning a profile the game
  // no longer has — set A alone reads 4.9% against a 5% bound and 93.5% against
  // a 93% bound, i.e. 0.1pt and 0.5pt of margin on the very set the file runs
  // first. Honest populations and the bounds derived from them:
  //   led           1.6-4.9%    bound 9%      margin 4.1pt
  //   ahead<=1.5s   93.5-96.5%  bound 90%     margin 3.5pt
  //   nearest<=1.5s 99.9-100%   bound 99%     margin 0.9pt
  //   mean gap      0.28-0.31s  bound 0.38s   margin 0.07s
  // Shown biting: TRACK_PACE.cloud 1.00 -> 0.94 (a slower finale field, i.e.
  // exactly "someone changed race 3") reads 20.1-32.2% led and 66.9-78.6%
  // chasing on the same five sets — red on both, by 11pt and 11pt. The other
  // two clauses do NOT separate that mutant (it reads 97.3-99.6% nearest and
  // 0.34-0.39s mean gap) and are sanity bounds only; they are kept because they
  // are cheap and because a re-spacing of the finale's pack would show there
  // first, but nothing here calls them catchers.
  assert(p3.leadPct <= 0.09 && p3.ahead15 >= 0.90 && p3.near15 >= 0.99 && p3.gapMean <= 0.38,
    `race 3 is still the exemplar: leads ${f(100 * p3.leadPct, 1)}% of the race (<= 9), a rival ahead ` +
    `within 1.5s ${f(100 * p3.ahead15, 1)}% (>= 90), nearest within 1.5s ${f(100 * p3.near15, 1)}% (>= 99), ` +
    `mean gap ${f(p3.gapMean)}s (<= 0.38)`);

  // (ii) CATCHER, and the strongest one in this section. Race 1's visible
  // overtaking — "race 1 is a race the child is passing in", the design intent
  // D58 was built to deliver.
  //
  // RE-DERIVED FOR D64, not nudged. The 9.4 this carried was derived from
  // close-pass counts the phase skew inflated (see the reading-(a) argument in
  // this section's header); on the honest instrument the same cell reads
  // 5.70 / 6.10 / 6.38 / 6.50 / 6.80 on sets C / E / A / B / D — pooled 6.30,
  // spread 1.10, per-set sd 0.42 — so the old bound was 30% out on every set
  // and no seed choice would have rescued it. The builds it has to separate,
  // measured on the SAME instrument rather than quoted from the old ruler:
  //   TRACK_PACE.oasis 1.03 (pre-Wave-6)   1.68-2.10  per race
  //   TRACK_PACE.oasis 1.06 (half revert)  4.65-4.98  per race
  // Bound 5.2: 0.50 below the shipped minimum (2.6 per-set sd below the pooled
  // mean) and 0.22 above the half-revert's worst set, 3.1 above the full one.
  // A red here means race 1 has gone back to being a race the child drives
  // alone at the front of.
  assert(p1.closePasses >= 5.2,
    `race 1 is a race the child is passing in (${f(p1.closePasses, 1)} close passes per race >= 5.2, ` +
    `1.7-2.1 at TRACK_PACE.oasis 1.03)`);
  // (iii) GUARD, NOT a catcher, and round 1's comment was wrong to call it one.
  // RE-DERIVED FOR D64: the honest median gap is 0.458-0.505 across the five
  // sets, so the old 0.50 ceiling was ON the measured value (sets A and C read
  // exactly 0.50) — a bound with negative margin, red on two sets out of five.
  // Honest populations: shipped 0.46-0.50s, TRACK_PACE.oasis 1.03 0.72-0.84s,
  // 1.06 0.54-0.65s. The two-sided bound 0.36..0.58 leaves 0.10 below and 0.075
  // above the shipped spread; the 1.03 revert is red by 0.14, but the half
  // revert overlaps it (0.54-0.65 straddles 0.58 on 2 sets of 5), which is
  // precisely why this is a guard on the pack's density and not a catcher.
  // The lower half fires long before race 1 becomes race 3, which reads 0.26.
  assert(p1.gapMedian >= 0.36 && p1.gapMedian <= 0.58,
    `race 1's pack has not been re-spaced (median gap to the nearest rival ` +
    `${f(p1.gapMedian)}s, in 0.36..0.58)`);
  // (iv) GUARD. The other side of (ii): race 1 must NOT become race 3. A gentler
  // version of the exemplar, not the exemplar. Measured on the honest
  // instrument (D64): 45.6-55.9% led and 29.8-35.5% chasing, against race 3's
  // 3.4% and 94.9%, so this trips long before race 1 gets there. Margins 20.6pt
  // and 26.5pt — the widest in the section, and the reason (iv) needed no
  // re-derivation when the instrument moved everything else.
  assert(p1.leadPct >= 0.25 && p1.ahead15 <= 0.62,
    `race 1 is still the gentle one: the child leads ${f(100 * p1.leadPct, 1)}% of it (>= 25, race 3 ` +
    `${f(100 * p3.leadPct, 1)}%) and is chasing only ${f(100 * p1.ahead15, 1)}% (<= 62, race 3 ${f(100 * p3.ahead15, 1)}%)`);
  // (v) CATCHER. Race 2's fault was distance to the front, not pack density:
  // its two front-runners sat 2.7s up the road in a race of their own.
  // Re-measured on the honest instrument (D64), five sets: 1.98-2.12s here
  // against 2.64-2.90s with SLOT_FWD_R2 removed (1.0). Margins 0.23 above the
  // shipped spread and 0.29 below the mutant's — near enough the 0.24/0.31 the
  // crooked ruler reported, so 2.35 stands unchanged. Worth recording that
  // `ahead<=1.5s`, the axis SLOT_FWD_R2 was introduced FOR, barely moves on the
  // honest instrument (88.8-93.8 removed against 92.6-94.3 shipped, overlapping)
  // — the distance to the front is the effect that is real.
  assert(p2.behind <= 2.35,
    `race 2's leaders are in play (${f(p2.behind)}s behind the winner <= 2.35, 2.64-2.90 without SLOT_FWD_R2)`);
  // (vi) GUARD. …and not so close that the 3rd-4th target starts to wobble.
  // This is the bound the rejected SLOT_FWD_R2 values were eating into (1.89 /
  // 1.84 / 1.71s at 0.55 / 0.50 / 0.40).
  assert(p2.behind >= 1.50 && p2.near15 >= 0.98,
    `race 2 is still a race to win, not a formality (${f(p2.behind)}s behind the winner >= 1.50, ` +
    `nearest rival within 1.5s ${f(100 * p2.near15, 1)}% of the race >= 98)`);
  // (vii) CATCHER for TRACK_PACE.oasis, which had nothing pinning it. This
  // wave's headline constant went 1.03 -> 1.09 and a straight revert passed
  // 3b(i), 3b(ii), 6(i), 6(iv) and every band bound in the file. Re-measured on
  // the honest instrument (D64), race-1 stock mean place: 2.43-2.55 here,
  // 1.53-1.73 with the constant reverted, 2.10-2.25 at the halfway 1.06.
  // Margins 0.28 below the shipped spread and 0.42 above the revert — both
  // WIDER than the 0.23/0.22 the crooked ruler reported, so the bound is kept
  // as it stands. It does NOT separate the halfway revert (2.10-2.25 straddles
  // 2.15); (ii) is what catches that, by 0.22 of a pass. ((ii) also catches the
  // full revert, three times over.)
  assert(p1.mean >= 2.15,
    `race 1's field is still quick enough to be a race (mean place ${f(p1.mean)} >= 2.15, ` +
    `1.53-1.73 at TRACK_PACE.oasis 1.03)`);
  // (viii) CATCHER for HOLD_REACH_R1, which had nothing pinning it either — the
  // mutant that removes it passed every 2c assertion on seeds 1-40 and was caught
  // only by 6(i), by 0.12 places. This is the number the constant was introduced
  // FOR: raising TRACK_PACE.oasis cost D33b's struggling-child ladder, and halving
  // race 1's hold-back time constant is what put it back. Measured 4.00 on all
  // five seed sets (the hold-back floor pins it hard); 4.97-5.00 with
  // HOLD_REACH_R1 removed. Margins 0.40 below, 0.57 above.
  const p185 = cell40(R1, 0.85, null, 'stock');
  console.log(`  race 1 at 85% pace (the struggling child, what HOLD_REACH_R1 protects): mean ${f(p185.mean)}`);
  assert(p185.mean <= 4.40,
    `race 1 still holds its ladder for a struggling child (85%-pace mean place ${f(p185.mean)} <= 4.40, ` +
    `5.00 without HOLD_REACH_R1)`);
}

// --- 2b. ...but a garage upgrade wins it -------------------------------------
// The other half of "winnable, just earned". If a rebalance ever makes the field
// unbeatable, this is what says so. Tier 2 is a good-but-not-perfect prompt, and
// it is the tier the opponents themselves run in race 3.
console.log('\n=== 2b. A DECENT GARAGE UPGRADE WINS IT BACK ===');
{
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  console.log(`  opponents' own championship tier: race 1 ${aiPartTier(1)}, race 2 ${aiPartTier(2)}, race 3 ${aiPartTier(3)}`);
  for (const R of RACES) {
    // Race 1 is 40-of-40 wins on every seed set measured, so five seeds answer
    // it. Races 2 AND 3 are fights and get the 40-seed cell — race 3 became one
    // in Wave 6, when the finale's field started scaling with the child's own
    // garage. That change was recorded PRE-D64 as 1.10 mean / 36 wins in 40 ->
    // 2.10 / 8; HONEST, the shipped side of it reads 2.15 / 7 (D67, live run).
    // The 1.10 / 36 side has never been re-measured, so the pair is a
    // direction, not a difference.
    const fight = R.n !== 1;
    const c = fight ? cell40(R, 1.00, T2, 't2') : (() => {
      const p = SEEDS.map(seed => race({ track: R.track, difficulty: R.difficulty, pace: 1.00, seed, parts: T2 }).pos);
      return { p, mean: mean(p), wins: p.filter(x => x === 1).length };
    })();
    const stock = fight ? cell40(R, 1.00, null, 'stock').mean
      : mean(results[1.00].find(x => x.R.n === R.n).runs.map(r => r.pos));
    console.log(`  race ${R.n}: mean ${f(c.mean)} over ${c.p.length} seeds, ${c.wins} wins ` +
      `(stock ${f(stock)} -> +${f(stock - c.mean)} places)`);
    if (fight) {
      // PRE-D64, and the argument that set the bound: race 2 pooled 2.22 over
      // 160 seeds, worst set 2.35, best 2.08; wins 2-9 per 40. The bound is
      // 2.60, not the 2.00 this used to carry, because 2.00 sat BELOW the true
      // mean and the old assertion was passing on seed luck. That argument is
      // about the spread, and it survives the re-measure.
      // HONEST (D67, live run): race 2 tier-2 2.08 with 7/40 wins, race 3
      // tier-2 2.15 with 7/40 — so the same pair of bounds still fits both and
      // says the same thing about both, with ~0.5 places of margin.
      assert(c.wins >= 1 && c.mean <= 2.60,
        `race ${R.n}: a tier-2 kart is fighting for the win ` +
        `(${c.wins}/${c.p.length} seeds won, mean place ${f(c.mean)} <= 2.60)`);
      // ...and not a walkover either: if a future change hands the race to
      // anyone holding a receipt, this side goes red. PRE-D64 floor 2.08 (race
      // 2) and 2.10 (race 3) over 40; HONEST (D67, live run) 2.08 and 2.15,
      // i.e. 0.48 and 0.55 of margin above the bound.
      assert(c.mean >= 1.60,
        `race ${R.n}: a tier-2 kart still has to race for it (mean place ${f(c.mean)} >= 1.60)`);
      assert(c.mean <= stock - 1.00,
        `race ${R.n}: the upgrade is worth ${f(stock - c.mean)} places over stock (>= 1.00)`);
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
  // That 6.0 / 6.0 / 6.2 is PRE-D64 and describes a build that no longer
  // exists. The HONEST shipped ladder is 4.00 / 5.00 / 6.00 (D67 lists it among
  // the claims that survived the re-measure; a live run prints the same), which
  // is what the three assertions below are measured against.
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
// PRE-D64 (crooked ruler on BOTH sides, which is what makes this before/after
// readable as a direction). It is the argument that moved TRACK_PACE.circuit
// and it is kept for that reason.
// Measured on S40 (seeds 1-40), before (circuit 0.96) -> after (0.98), with the
// same figure on three further disjoint 40-seed sets in brackets:
//   race 2, stock, 100%    3.17 -> 3.73   [3.13/3.15/2.80 -> 3.85/3.85/3.75]
//   race 2, tier-3, 100%   1.23, 31/40 wins -> 1.63, 16/40   [pre-fix 1.27/1.35/1.30
//                          (65-78% wins) -> 1.63/1.90/1.57 (20-43%)]
//   race 1 / race 3 stock  2.25 / 3.90, byte-identical before and after (the
//                          constant is keyed by track, and race N -> track N)
// Forty seeds, not five and not twenty-one: an earlier draft of this section
// quoted the tier-3 cell as "48% wins" from a 21-seed set, and three alternate
// 21-seed sets read 29%. The pooled figure over 160 seeds is 35% and the per-40
// spread 20-43% — a sampling argument, which is why the bound below is 60% and
// not 50%, and which the re-measure does not disturb.
//
// HONEST, the shipped side only (D67, and a live run of this file on S40):
// race 2 stock 3.88 with 0 wins, race 2 tier-3 1.57 with 17/40 wins, race 1
// stock 2.55, race 3 stock 4.22. The pre-fix (circuit 0.96) column has NOT been
// re-measured on the fixed instrument, so no "before -> after" difference in
// this section is a number.
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
  // PRE-D64, and the entire derivation of the 0.70 bound — every figure on the
  // crooked ruler, and each compared only against others from it. Pre-fix
  // 0.78-0.93 across the four seed sets, after 1.48-1.73. Wave 6 then hardened
  // race 1 deliberately (2.25 -> 2.67 on seeds 1-40, 2.20 -> 2.38 and
  // 2.25 -> 2.67 on the two disjoint sets) so that a clean child stops leading
  // half of it, with race 2 unchanged at 3.67-3.85, so the same ladder measured
  // 1.00 / 1.32 / 1.18 and the bound came down from 1.20 to 0.70.
  // HONEST (live run): 2.55 -> 3.88, a gap of 1.33, i.e. 0.63 of margin.
  // The assertion still says exactly what it said. "Still red against the
  // pre-Wave-5 bug it was written for (0.78-0.93)" is an inference from the old
  // instrument — that build has not been re-run — not a fresh measurement.
  assert(c2.mean - c1.mean >= 0.70,
    `race 2 is strictly harder than race 1 for a stock clean driver ` +
    `(${f(c1.mean)} -> ${f(c2.mean)}, gap ${f(c2.mean - c1.mean)} >= 0.70 places)`);
  // (ii) CATCHER. And it lands where the brief wants it: 3rd-4th, never a podium
  // handed out for driving alone. PRE-D64, both sides: pre-fix 2.80-3.17, with
  // outright WINS on two of the four sets; after 3.73-3.85 and no win in 160
  // seeds. HONEST (D67, live run): 3.73-3.90 across five 40-seed sets, 3.88 on
  // S40, still 0 wins in 200 seeds — the zero-wins half is the claim D67 calls
  // numerically the most stable in the project.
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
  // PRE-D64, and the derivation of the 1.30 / 27 bounds. Round 2 found the
  // shipped cell reading mean 1.45 on seed set 501-540, EXACTLY where the old
  // 1.45 bound sat — an assertion sitting on its bound is not passing, it is
  // about to fail (D43). Re-measured then on five disjoint 40-seed sets:
  // shipped 1.45-1.57 at 18-22 wins per 40 against the pre-Wave-5 build
  // (TRACK_PACE.circuit 0.96) at 1.07-1.18 and 33-37 wins, i.e. margins of
  // 0.15 / 0.12 on the mean and 5 / 6 on the wins. Both sides crooked ruler.
  // HONEST (D67, live run): the shipped cell is 1.57 with 17/40 wins — 0.27 of
  // margin on the mean and 10 wins on the count, WIDER than the PRE-D64
  // derivation claimed. The circuit-0.96 build has not been re-measured, so the
  // figures the assertion prints for it are PRE-D64 and are labelled in the
  // message rather than sitting unmarked beside an honest number.
  assert(c2t3.mean >= 1.30 && c2t3.wins <= 27,
    `race 2 is not a formality for a well-upgraded clean driver ` +
    `(tier-3 mean ${f(c2t3.mean)} >= 1.30, ${c2t3.wins}/${S40.length} wins <= 27; ` +
    `PRE-D64 1.07-1.18 and 33-37 wins at TRACK_PACE.circuit 0.96 — not comparable)`);
  // (v) GUARD, green against the pre-fix bug — it fails the OTHER way, on an
  // over-hardened field (it trips at circuit 1.04 and on the reverted-pace
  // mutant). A fully-spent garage must still close race 2, or the championship
  // is unwinnable for the child who did everything the game asked. PRE-D64
  // 8-17 wins per 40; the bound is 4 so that normal seed-to-seed spread cannot
  // flap it, and that sampling argument survives. HONEST (live run): 17/40.
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

  // (vii) THE UPGRADED-KART LADDER — FLIPPED, as the pin it replaced instructed.
  // ------------------------------------------------------------------------
  // Until Wave 6 this block pinned a KNOWN-WRONG shape: on the axis an engaged
  // child is actually on — a kart with garage parts in it — the championship was
  // INVERTED, race 2 harder than the finale, and the pin said in as many words
  // that a green tick meant the curve was still as wrong as when it was measured,
  // with instructions to flip it into a real ladder once race 3 was fixed.
  //
  //   race 3, tier-2 kart, 40 seeds     mean   wins
  //   Wave 5.1 (the pinned wrongness)   1.09   36/40      <- easier than race 2
  //   Wave 6 (aiPartTier sees the child's garage)  2.10    8/40
  //
  // The finale's field now runs one tier above the child's own kart (still never
  // above tier 3, still exactly tier 2 for a child who has bought nothing — race
  // 3 on a STOCK kart is bit-identical to Wave 5.1 on all 240 measured races).
  // So the ladder is real and is asserted as one.
  const ladderGap = c3t2.mean - c2t2.mean;
  console.log(`  upgraded ladder: race 2 tier-2 ${f(c2t2.mean)} (${c2t2.wins} wins) vs race 3 tier-2 ` +
    `${f(c3t2.mean)} (${c3t2.wins} wins), AI tier ${c2t2.tier} -> ${c3t2.tier}`);
  // CATCHER, RE-DERIVED IN WAVE 6.1 — the old bound measured nothing.
  // -----------------------------------------------------------------------
  // It read `>= -0.25` and was justified as "+-0.15 seed-set spread". On the
  // honest instrument (D64 — every difficulty figure taken before it was
  // polluted by a progress-origin bug) this gap is +0.09 over 200 seeds with a
  // per-40-seed spread of -0.15..+0.48, so -0.25 sat INSIDE the noise: a build
  // whose true gap was -0.2 (genuinely inverted, race 2 harder than the finale)
  // passed it on most seed sets. Re-derived from five DISJOINT 40-seed sets:
  //
  //   build                                  gap per set (race3 t2 - race2 t2)
  //   shipped (race 2's field flat at tier 1) +0.08 -0.15 -0.05 +0.13 +0.48
  //   pre-Wave-6 (finale's field flat at 2)   -1.07 (the bug this replaced)
  //   race 2's field matched to the child     -0.88 -1.08 -0.90 -0.73 -0.90
  //                                           (built and measured in 6.1; the
  //                                            reason it did not ship is in the
  //                                            aiPartTier comment in ai.js)
  //
  // Bound -0.55: 0.40 places of margin under the worst shipped set, and red by
  // 0.18 / 0.52 places against the two builds that really are inverted. It is
  // the tightest bound the measured spread allows, and BOTH known inversion
  // mechanisms — a finale that stops scaling, and a race 2 that starts — are red
  // against it.
  //
  // HONEST LIMIT, stated rather than asserted: this is a FLATNESS bound, not a
  // ladder. The shipped championship does not escalate on the upgraded axis
  // (+0.09 places is a tenth of a place, well inside one set's spread), and no
  // bound requiring a REAL step can be written here without being red today.
  // Making it real means moving race 3 or the tracks' own pace — race 2's field
  // is the wrong lever and 6.1 measured why. GAPS.md carries the item.
  // The other side of the window is enforced, and enforced tightly, by section
  // 2b: race 2's tier-2 cell must stay <= 2.60 and be worth >= 1.00 places over
  // stock, which is what goes red the moment race 2 is hardened toward race 3.
  assert(ladderGap >= -0.55,
    `the upgraded-kart championship is not inverted: race 3 tier-2 ${f(c3t2.mean)} is not ` +
    `easier than race 2 tier-2 ${f(c2t2.mean)} (gap ${f(ladderGap)} >= -0.55; -1.07 pre-Wave-6, ` +
    `-0.90 with race 2's field matched to the child)`);
  // GUARD, the other side of the same number: race 3 must not run away from
  // race 2 either. Measured max +0.48 over the five sets; the bound is +1.20, so
  // it cannot flap, and it goes red on an over-hardened finale (the +1 field
  // uncapped reads +1.4 on the sets measured in 6.1).
  assert(ladderGap <= 1.20,
    `…and the finale has not run away from race 2 either (gap ${f(ladderGap)} <= 1.20)`);
  // CATCHER (Wave 6.1). The gap above is a DIFFERENCE, and a difference can be
  // held by two cells moving together. This pins the race-2 side of it directly:
  // race 2's field is FLAT — it does not scale with the child's garage — which is
  // the contract section 3c states and ai.js's aiPartTier comment justifies.
  // Red against exactly the change 6.1 measured and rejected (that build reads
  // tier 2 here), and against any future attempt to scale race 2 from inside
  // createAIField rather than from aiPartTier, which the pure-function checks in
  // 3c cannot see.
  assert(c2.tier === 1 && c2t2.tier === 1 && c2t3.tier === 1,
    `race 2's field is the same tier 1 for a stock child and a fully-spent one ` +
    `(stock ${c2.tier}, tier-2 ${c2t2.tier}, tier-3 ${c2t3.tier})`);
  // GUARD. The finale's side of the same seam: its field DOES scale (D58).
  assert(c3.tier === 2 && c3t2.tier === 3,
    `…while the finale's field does scale with the child (stock ${c3.tier}, tier-2 kart ${c3t2.tier})`);
  // CATCHER. The GAPS.md complaint stated directly: an upgrade with no questions
  // answered must stop collecting the finale. PRE-D64: 36/40 before, 8/40
  // after, with 8 / 13 / 8 wins on the three disjoint 40-seed sets against 36
  // for the pre-Wave-6 field — which is why the bound is 18 (still under half)
  // rather than hard against the worst set.
  // HONEST (D67, live run): 7/40 at mean 2.15, so the shipped side clears the
  // bounds by 11 wins and 0.55 places. The pre-Wave-6 36/40 has never been
  // re-measured; the assertion labels it PRE-D64 rather than printing it beside
  // an honest count unmarked.
  assert(c3t2.wins <= 18 && c3t2.mean >= 1.60,
    `race 3 is no longer a walkover for an upgraded kart (${c3t2.wins}/${S40.length} wins <= 18, ` +
    `mean ${f(c3t2.mean)} >= 1.60; PRE-D64 pre-Wave-6 reading 36/40 at 1.10)`);
  // GUARD, the other side: the finale must still be WINNABLE by the child who
  // spent well, or the lever has been overshot. PRE-D64 8/40 unengaged and
  // 34/40 for the same kart with a full set of correct answers (section 7);
  // HONEST (live run) 7/40 and 28/40 — the same shape, four wins above the
  // bound.
  assert(c3t2.mean <= 2.80 && c3t2.wins >= 3,
    `…and it is still won by a good kart (mean ${f(c3t2.mean)} <= 2.80, ${c3t2.wins}/${S40.length} wins >= 3)`);
}

// --- 3c. THE FIELD-TIER CONTRACT (Wave 6.1, pure function, no races) --------
// Sections 2b/3b measure what the field's garage DOES to a child's finishing
// place; they take ~40 seconds a cell and they can only see the three
// difficulties the championship uses. This section states the rule itself, on
// the pure function, for every input — including the ones a race cannot reach
// (a negative tier, a fractional one, a tier above the top of PART_TIERS) — so
// that a rewrite of aiPartTier is caught by arithmetic in a millisecond rather
// than by a place-and-a-half drift in a 40-seed mean.
//
// The rule, and where each clause is argued:
//   race 1  stock, always, whatever the child drives          (D33b, 2b)
//   race 2  tier 1, always, whatever the child drives         (ai.js: measured
//           in 6.1 and deliberately NOT scaled — matching the child inverts the
//           championship by 0.9 places and takes 1.0 place off what the garage
//           is worth on the one race it is supposed to win)
//   race 3  one tier ABOVE the child, floored at the
//           championship's own tier 2, capped at PART_TIERS' 3 (D58, D44)
//   and, at every difficulty, monotone non-decreasing in the child's tier: a
//   better part may never produce a HARDER field than a worse one (D33).
console.log('\n=== 3c. THE FIELD-TIER CONTRACT (pure function) ===');
{
  const row = d => [0, 1, 2, 3].map(t => aiPartTier(d, t));
  console.log(`  race 1 ${row(1).join(' ')}   race 2 ${row(2).join(' ')}   race 3 ${row(3).join(' ')}` +
    `   (columns = the child's own part tier 0..3)`);
  // (i) CATCHER. Race 1 is the tutorial race: its field is stock for everyone.
  assert(row(1).every(x => x === 0),
    `race 1's field is stock whatever the child drives (${row(1).join(' ')})`);
  // (ii) CATCHER, and the contract 6.1 chose over matching the child. Red the
  // moment race 2's field starts scaling, in either direction.
  assert(row(2).every(x => x === 1),
    `race 2's field is tier 1 whatever the child drives (${row(2).join(' ')})`);
  // (iii) CATCHER for D58/D44: the finale, and only the finale, scales.
  assert(row(3).join(' ') === '2 2 3 3',
    `the finale runs one tier above the child, floored at 2 and capped at 3 (${row(3).join(' ')})`);
  // (iv) CATCHER for D33 at the level of the rule rather than the outcome: no
  // difficulty may hand a better-equipped child a harder field than a worse-
  // equipped one. This is the property the round-1 `max` over all four slots
  // broke in the finale (see playerPartTier's comment).
  const monotone = [1, 2, 3].every(d => row(d).every((x, i, a) => i === 0 || x >= a[i - 1]));
  assert(monotone, 'the field tier never DROPS as the child\'s own kart improves (all three races)');
  // (v) GUARD. Out-of-range and fractional tiers are clamped and rounded rather
  // than propagated: save.js is a JSON blob a child could in principle hand-edit,
  // and a tier of 9 must not dress the field in parts PART_TIERS does not have.
  const inRange = [1, 2, 3].every(d => [-5, 0.4, 1.6, 9, 99].every(t => {
    const x = aiPartTier(d, t);
    return Number.isInteger(x) && x >= 0 && x <= 3;
  }));
  const clamped = aiPartTier(3, 9) === aiPartTier(3, 3) && aiPartTier(3, 99) === aiPartTier(3, 3) &&
    aiPartTier(3, -5) === aiPartTier(3, 0) && aiPartTier(3, 1.6) === aiPartTier(3, 2);
  assert(clamped && inRange,
    'a tier outside 0..3 is clamped and a fractional one rounded: the field tier is always an ' +
    'integer in 0..3, at every difficulty, for every input');
  // (vi) CATCHER for the seam between the two functions: what the finale READS
  // off the child's garage. Engine and turbo only (D58 — on `cloud` tyres and
  // frame make a kart SLOWER, so counting them makes buying one cost a place),
  // best-of rather than sum, clamped to PART_TIERS.
  const pt = playerPartTier;
  assert(pt(null) === 0 && pt({}) === 0 && pt({ tyres: 3, frame: 3 }) === 0 &&
    pt({ engine: 1 }) === 1 && pt({ turbo: 2 }) === 2 && pt({ engine: 3, turbo: 1 }) === 3 &&
    pt({ engine: 9 }) === 3,
    `the finale reads the child's ENGINE and TURBO only, best-of, clamped 0..3 ` +
    `(tyres+frame -> ${pt({ tyres: 3, frame: 3 })}, engine 3 + turbo 1 -> ${pt({ engine: 3, turbo: 1 })})`);
  // (vii) GUARD. A child who buys nothing gets the championship's own ladder,
  // which is what every pre-Wave-6 caller and every A/B telemetry run assumes.
  assert(aiPartTier(1) === 0 && aiPartTier(2) === 1 && aiPartTier(3) === 2,
    'with no garage at all the field runs the plain championship ladder 0 / 1 / 2');
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
  // Lap time = elapsed / LAPS COVERED IN THIS LOOP. `d.progress` is measured
  // from the START/FINISH LINE, and these karts began on the grid 4..22 m
  // BEHIND it, so every accumulator starts slightly negative; dividing by the
  // raw value divides by ~2.99 where 3.00 laps were driven, and INFLATES every
  // printed lap time by 0.1-0.6% (measured: 49.34..51.51s printed against
  // 49.28..51.43s actually driven). Take the delta against this loop's own
  // `start[]` instead.
  const covered = {};
  field.drivers.forEach((d, i) => { covered[d.racer.id] = d.progress - start[i]; });
  const lap = d => tel.time / covered[d.id];
  console.log(pad('persona', 12) + padL('lap', 8) + padL('entry', 8) + padL('drift%', 9) + padL('mistakes', 10));
  for (const d of tel.drivers) {
    console.log(pad(d.personality, 12) + padL(f(lap(d), 2), 8) + padL(f(d.cornerEntry, 2), 8) +
      padL(f(100 * d.driftTime / tel.time, 1), 9) + padL(d.mistakes, 10));
  }
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
// PRE-D64, 40 seeds, 100% pace, stock kart, x0 vs x8 correct answers — the
// table this section's bounds were first written against:
//
//   cell                  x0 (clean only)        x8 (fully engaged)     worth
//   race 1 (oasis)    2.25  5/40 wins  40 pod   1.45  22/40  40 pod   0.80 pl
//   race 2 (circuit)  3.73  0/40 wins   9 pod   3.48   0/40  16 pod   0.25 pl
//   race 3 (cloud)    3.90  0/40 wins  15 pod   3.40   1/40  26 pod   0.50 pl
//
// The conclusion drawn from it — "a correct answer is worth 0.03-0.10 of a
// finishing place, 0.16-0.38s of lap time" — is PRE-D64, and D67 OVERTURNS it.
// Do not quote that range.
//
// HONEST, the same cells and seeds on the fixed instrument (D67, and what a
// live run of this file prints):
//
//   cell                  x0 (clean only)        x8 (fully engaged)     worth
//   race 1 (oasis)    2.55  4/40 wins  40 pod   1.55  22/40  40 pod   1.00 pl
//   race 2 (circuit)  3.88  0/40 wins   7 pod   3.73   0/40  11 pod   0.15 pl
//   race 3 (cloud)    4.22  0/40 wins   7 pod   3.13   0/40  33 pod   1.10 pl
//
// A correct answer is worth 0.125 / 0.019 / 0.137 of a place on races 1/2/3.
// Race 3's engagement payoff more than DOUBLED and race 2's fell to near
// nothing, so the spread across races widened from about 3x to about 7x.
//
// WHAT SURVIVES THE CORRECTION, and it is the part the section is for: eight
// answers are still worth well under one garage tier (1.00 / 0.15 / 1.10 places
// against a tier-2 kart's 1.40 / 1.80 / 2.07 in section 2b), so engagement is
// under-rewarded here rather than over-rewarded, and race 2's old walkover was
// still a PACE problem (fixed at TRACK_PACE.circuit) and not an engagement one.
// The mechanism is unchanged and worth knowing before anyone "fixes" it: the
// quiz boost is 1.30x, a purple drift release is 1.38x, and a clean autopilot
// lap is already inside a drift boost about two thirds of the time — so most
// answers land on top of a STRONGER boost and buy only `duration * 0.35`.
//
// Do not buff the quiz boost to "make engagement matter" without re-running
// this: PRE-D64, 1.45x/4.0s took race 1 from 22/40 wins to 40/40 — it hands the
// first race, the one a child plays before the garage exists, to anyone who
// answers the questions, and still did not win them race 2 (0/40 at
// 1.60x/4.0s). Those buff cells have NOT been re-measured on the fixed
// instrument: the direction is sound, the figures are UNVERIFIED.
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
  // cadence collapses, or if quiz.js stops calling applyBoost at all — the null
  // case is the x0 cell beside it, HONEST 2.55 with 4/40 wins, so both halves
  // fail against it.
  // PRE-D64, and the derivation of the 1.90 / 10 bounds: Wave 6 made race 1's
  // field faster (TRACK_PACE.oasis 1.03 -> 1.09), so a clean unengaged child
  // read 2.38-2.68 rather than 2.20-2.25 and the engaged one 1.48-1.68 with
  // 14-24 wins per 40 rather than 1.35-1.45 with 22-26; round 2 then dropped
  // the win bound from 12 to 10, because 12 was two seeds clear on set 201-240
  // (14 wins), leaving 3 wins of margin above the null case (0-7 wins on the
  // same five sets) and 4 below the shipped one. All crooked ruler.
  // HONEST (D67, live run): x0 2.43-2.55 with 4 wins, x8 1.55 with 22 wins —
  // 0.35 of margin on the mean and 12 wins on the count, so the bounds are
  // LOOSER than their PRE-D64 derivation assumed, not tighter.
  assert(q8[0].mean <= 1.90 && q8[0].wins >= 10,
    `race 1: answering the questions turns 3rd into a win fight ` +
    `(x8 mean ${f(q8[0].mean)} <= 1.90, ${q8[0].wins}/${S40.length} wins >= 10, from ${f(q0[0].mean)} at x0)`);
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
  // Bound 1.50 -> 1.20 for the same reason as 3b (i): Wave 6 lifted race 1.
  // PRE-D64, on the three disjoint 40-seed sets: 1.62 / 1.82 / 2.15.
  // HONEST (live run): 1.55 -> 3.73, a gap of 2.17, i.e. 0.97 of margin.
  assert(q8[1].mean - q8[0].mean >= 1.20,
    `race 2 is still strictly harder than race 1 for an engaged child ` +
    `(${f(q8[0].mean)} -> ${f(q8[1].mean)}, gap ${f(q8[1].mean - q8[0].mean)} >= 1.20)`);
  // (v) GUARD, and the direct answer to "is engagement over-rewarded?". A single
  // correct answer may not be worth more than a seventh of a finishing place on
  // any race.
  // PRE-D64, and the whole derivation of the 0.17 bound: the shipped build
  // measured 0.100 / 0.031 / 0.063 and tripped on every boost buff measured
  // (1.45x/4.0s reading 0.156 on race 1 and 0.163 on race 3); Wave 6 then
  // re-derived it against the mutant rather than the shipped number, because a
  // tighter race-1 field makes each answer worth more — the three disjoint
  // 40-seed sets read 0.125 / 0.087 / 0.144 on race 1 (was 0.100 / 0.106 /
  // 0.112) while the 1.45x/4.0s buff read 0.209 / 0.206 against the SAME field,
  // hence "0.17 sits ~18% clear of both".
  // HONEST (D67, live run): 0.125 / 0.019 / 0.137 per answer. The worst race is
  // now race 3 at 0.137, not race 1, and the margin under the bound is 0.033.
  // THE OTHER HALF OF THAT ARGUMENT IS UNVERIFIED. The 0.209 / 0.206 buff
  // mutant has NOT been re-measured on the fixed instrument, so "0.17 sits
  // clear of the mutant" still rests on a crooked-ruler figure. The bound is
  // left where it is because it is green with real margin on the shipped build,
  // but a future wave leaning on this clause as a CATCHER must re-measure the
  // mutant first — on today's evidence it is a GUARD.
  assert(Math.max(...perAnswer) <= 0.17,
    `one correct answer is a nudge, not a shortcut (worst ${f(Math.max(...perAnswer), 3)} places/answer <= 0.17)`);
}

// --- 7. RACE 3, MEASURED EXPLICITLY (Wave 5.1) ------------------------------
// The finale had never been playtested by a human, so its target is asserted
// here rather than inferred from the sections above: winning it should want a
// decent upgrade AND engagement, and a 70%-pace child must never be lapped on
// `cloud` — the one track where Wave 1 measured 1.04 laps down (LAPPED) and
// Wave 2 claimed a fix that was never re-measured end to end.
//
// PRE-D64, 40 seeds unless stated (Wave 5.1 -> Wave 6) — the table the bounds
// below were written against:
//   100% stock  x0   mean 3.90  best 2nd  0 wins  15/40 podiums  +2.2s to winner
//   100% stock  x8   mean 3.40  best 1st  1 win   26/40 podiums
//   100% tier-2 x0   mean 1.10, 36/40 wins  ->  2.10, 8/40
//   100% tier-2 x8   mean 1.00, 40/40 wins  ->  1.18, 34/40
//    85% stock  x0   mean 6.17            0.10 laps behind
//    70% stock  x0   8th on 40/40 seeds   0.21 laps behind, 0 lapped, nearest
//                    opponent never further than 0.08 laps up the road
//
// HONEST, the SHIPPED side of each of those cells (D67, and a live run of this
// file). The Wave-5.1 columns above have not been re-measured, so nothing here
// may be differenced against them:
//   100% stock  x0   mean 4.22  best 3rd  0 wins   7/40 podiums  +2.47s to winner
//   100% stock  x8   mean 3.13  best 2nd  0 wins  33/40 podiums
//   100% tier-2 x0   mean 2.15,  7/40 wins
//   100% tier-2 x8   mean 1.35, 28/40 wins
//    85% stock  x0   mean 6.00
//    70% stock  x0   8th on 12/12 seeds, 0.17-0.20 laps behind, 0 lapped,
//                    nearest opponent never further than 0.08 laps up the road
//
// D67 re-read race 3 stock as ~0.32 places HARDER than the PRE-D64 figure
// (3.90 -> 4.22) and HALVED its podium rate (15/40 -> 7/40): every "race 3 is
// the frozen reference / the exemplar" statement in this project was written
// against a number that was too kind.
//
// VERDICT (Wave 6, and it survives the re-measure): on target on both halves at
// last. The clean-driver half was always right — stock, no win in 40 seeds, and
// engagement moves it up the order without winning it; those cells were
// BIT-IDENTICAL to Wave 5.1 (a same-instrument comparison, so the bit-identity
// holds) because the retune is conditional on the child's own parts. The
// upgrade half used to read "a tier-2 kart wins the finale 36 times in 40 with
// ZERO questions answered", i.e. "a decent upgrade AND engagement" was really
// "a decent upgrade"; `aiPartTier` now takes the child's garage tier and puts
// the finale's field one tier above it, so the same kart reads 7 wins unengaged
// and 28 engaged. Section (iia) below asserts both ends.
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

  // (iia) WAVE 6 — THE OTHER HALF OF THE TARGET, WHICH USED TO BE THE OPEN GAP.
  // "Winning the finale realistically requires a decent upgrade PLUS engagement"
  // was, until this wave, just "requires a decent upgrade": a tier-2 kart with
  // ZERO questions answered won 36 of 40 seeds (PRE-D64, never re-measured).
  // `aiPartTier` now sees the child's own garage and puts the finale's field one
  // tier above it, so:
  //
  //   race 3, 40 seeds        x0 (clean only)        x8 (fully engaged)
  //   PRE-D64  stock          3.90, 0 wins           3.40, 1 win     (unchanged)
  //   PRE-D64  tier-2         2.10, 8 wins           1.18, 34 wins
  //   HONEST   stock          4.22, 0 wins           3.13, 0 wins
  //   HONEST   tier-2         2.15, 7 wins           1.35, 28 wins
  //
  // i.e. the upgrade buys a real fight and the questions convert it into the
  // win — true on both instruments, and the two blocks may not be differenced.
  const t2a = cell40(R3, 1.00, T2, 't2');
  const t2q = cell40(R3, 1.00, T2, 't2', 8);
  console.log(`  tier-2 kart: x0 mean ${f(t2a.mean)} wins ${t2a.wins}/${S40.length} (AI tier ${t2a.tier})  ` +
    `-> x8 mean ${f(t2q.mean)} wins ${t2q.wins}/${S40.length}  (engagement worth ${f(t2a.mean - t2q.mean)} places)`);
  // CATCHER: an upgrade alone no longer collects the finale.
  assert(t2a.wins <= 18,
    `race 3 is not won by the garage alone (tier-2 x0 ${t2a.wins}/${S40.length} wins <= 18, PRE-D64 36/40)`);
  // CATCHER: …and an upgrade PLUS engagement does win it, comfortably more often
  // than not. Goes red if the finale scaling is overshot into "an upgrade is
  // worthless", and red if quiz.js stops calling applyBoost.
  // PRE-D64, and the derivation of the 16 / 1.85 bounds. Round 1 set 22 wins /
  // 1.60 from three seed sets reading 34 / 27 / 29 wins; sets 201-240 and
  // 501-540 then read 28 and 23 wins at mean 1.38 and 1.55 — one seed and 0.05
  // places from red. Population over the five sets: 23-34 wins, mean 1.18-1.55.
  // The null case this exists to catch — a build where the boost does nothing,
  // i.e. the x0 cell beside it — read 6-13 wins at 2.05-2.10, so the bounds
  // cleared the shipped code by 7 wins / 0.30 places and the null case by
  // 3 wins / 0.20 places.
  // HONEST (live run): shipped 28 wins at mean 1.35, null case 7 wins at 2.15.
  // Margins 12 wins / 0.50 places above the shipped side and 9 wins / 0.30
  // below the null case — the bounds still separate the two populations they
  // were built to separate, now on the fixed instrument.
  assert(t2q.wins >= 16 && t2q.mean <= 1.85,
    `…but an upgraded, engaged child wins it (tier-2 x8 ${t2q.wins}/${S40.length} wins >= 16, ` +
    `mean ${f(t2q.mean)} <= 1.85)`);
  // CATCHER: engagement has to be the thing that made the difference. PRE-D64
  // 0.55-0.92 places over the five sets (round 1's 0.45 bound left 0.10 on the
  // worst of them); 0.00 if the boost stops landing. HONEST (live run): 0.80,
  // i.e. 0.45 of margin over the bound.
  assert(t2a.mean - t2q.mean >= 0.35,
    `engagement is worth ${f(t2a.mean - t2q.mean)} places on an upgraded kart in the finale (>= 0.35; ` +
    `PRE-D64 it was worth 0.10 when the field stopped at tier 2)`);

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

// --- 7c. THE FINALE IS FAIR TO A LOPSIDED GARAGE (Wave 6, round 2) ----------
// The finale's field steps from tier 2 to tier 3 when the child's own kart is
// good enough (aiPartTier x playerPartTier). That step is worth a full place, so
// WHERE the threshold sits decides whether a child who buys a part can finish
// WORSE for it — the exact shape of unfairness D33 says children notice.
//
// WHAT A CHILD CAN ACTUALLY OWN, which is what this section is measured over: a
// garage visit builds ONE part (scenes.js writes `parts[slot] = tier`, one slot)
// and there are exactly TWO visits before the finale — the results screen after
// race 1 and after race 2 — with `parts` cleared by resetChampionship(). So the
// real race-3 garage has AT MOST TWO non-zero slots. The uniform tier-2 and
// tier-3 karts sections 2b/3b/7 talk about are not reachable in a championship;
// they are there to pin the extremes, and they are the ONE shape where round 1's
// `max` aggregator happened to be harmless.
//
// ROUND 1 SHIPPED `max` OVER ALL FOUR SLOTS AND IT WAS NOT HARMLESS. On `cloud`
// only the engine and the turbo make a kart quicker (autopilot lap time: engine
// 48.07 -> 45.50, turbo 48.07 -> 46.33, tyres 48.07 -> 48.84, frame 48.07 ->
// 47.98) — so a tier-2 tyre bought the child nothing and summoned a tier-3
// field. Those lap times are PHYSICS, not progress: D64 did not touch them, and
// Wave 7's honest re-measure agrees to within a few hundredths (47.82 stock ->
// 45.34 engine 3, 46.07 turbo 3, 47.91 frame 3, 48.67 tyres 3). What WAS wrong
// about them is their SCOPE rather than their value — GAPS.md's Wave-7
// correction shows the sign flips per track: on `circuit` tyres are the FASTEST
// part in the game (54.37 -> 52.66) while on `cloud` they are actively harmful.
//
// PRE-D64, mean place on race 3, x0, over the five 40-seed sets — the table
// that chose the 0.65 tolerance:
//
//   single part only     stock      tyres 2    tyres 3    frame 3    engine 2
//   round 1 (max of 4)   3.90-4.20  4.80-5.00  4.92-5.10  4.88-4.90  3.17-3.42
//   now (max eng,turbo)  3.90-4.20  4.10-4.33  4.13-4.38  3.88-4.15  3.17-3.42
//
// HONEST, the shipped row only (live run, S40):
//
//   now (max eng,turbo)  4.22       4.22       4.40       4.38       3.10
//
// i.e. buying a tier-3 tyre cost a child a full place under round 1's
// aggregator; it now costs +0.18, which is less than the physics was already
// costing them. (Tyres are mildly negative on `cloud` at every field tier —
// that is a kartphysics/autopilot fact, present on Wave 5.1 too, and the
// tolerance below is sized to it rather than pretending otherwise.) The round-1
// row has NOT been re-measured, so the two tables may not be differenced.
//
// THE CRITIC'S PROPOSAL, floor-of-mean over the four slots, was measured and
// rejected: it steps at a slot total of 8 and two garage visits cannot exceed 6,
// so it never fires in a real game — the strongest reachable garage (a tier-3
// engine and a tier-3 turbo, two good prompts) goes back to winning the finale
// 39-40 times in 40 with zero questions answered, which is D44 reopened. The
// 39-40 count is PRE-D64, but the argument does not rest on it: the aggregator
// provably cannot reach its own threshold in two visits, which is structural.
// Both halves are asserted below.
console.log('\n=== 7c. THE FINALE IS FAIR TO A LOPSIDED GARAGE (40 seeds) ===');
{
  const R3 = RACES[2];
  const one = (k, v) => ({ engine: 0, tyres: 0, frame: 0, turbo: 0, [k]: v });
  const stock = cell40(R3, 1.00, null, 'stock');
  const singles = [
    ['engine 2', cell40(R3, 1.00, one('engine', 2), 'one-e2')],
    ['turbo 2', cell40(R3, 1.00, one('turbo', 2), 'one-w2')],
    ['tyres 2', cell40(R3, 1.00, one('tyres', 2), 'one-t2')],
    ['tyres 3', cell40(R3, 1.00, one('tyres', 3), 'one-t3')],
    ['frame 3', cell40(R3, 1.00, one('frame', 3), 'one-f3')],
  ];
  console.log(`  stock: mean ${f(stock.mean)} (AI tier ${stock.tier})`);
  for (const [n, c] of singles) {
    console.log(`  ${pad(n, 9)}: mean ${f(c.mean)} (AI tier ${c.tier})  ` +
      `${c.mean > stock.mean ? '+' : ''}${f(c.mean - stock.mean)} vs stock`);
  }
  const worst = Math.max(...singles.map(([, c]) => c.mean - stock.mean));
  const worstName = singles.find(([, c]) => c.mean - stock.mean === worst)[0];

  // CATCHER. MONOTONICITY, stated as the property rather than as cells: no
  // single part a child can buy may cost them more than the physics already
  // costs them. PRE-D64 worst single-part penalty over the five 40-seed sets:
  // 0.05-0.40 places here (all of it the tyre/frame flatness, which is present
  // with no field scaling at all) against 0.90-1.15 with round 1's `max`-of-four
  // aggregator; margins 0.25 below and 0.25 above.
  // HONEST (live run): +0.18, on tyres 3 — 0.47 of margin under the bound. The
  // `max`-of-four side has not been re-measured, so the assertion labels it
  // PRE-D64 rather than printing it unmarked beside an honest number.
  assert(worst <= 0.65,
    `no single garage part makes the finale worse for the child who bought it ` +
    `(worst: ${worstName}, ${worst > 0 ? '+' : ''}${f(worst)} places vs stock <= 0.65; ` +
    `PRE-D64 +0.90..+1.15 with a max-over-all-four aggregator)`);

  // CATCHER, the other half. The strongest garage two visits can build — a
  // tier-3 engine and a tier-3 turbo — must still have to race for the finale.
  // PRE-D64: 17-21 wins per 40 at mean 1.52-1.70; 39-40 wins at 1.00-1.02 both
  // with the finale scaling removed (Wave 5.1) and with a floor-of-mean
  // aggregator, which cannot reach its own threshold in two visits. Margins 7
  // wins / 0.17 places below, 11 wins / 0.33 above.
  // HONEST (live run): 20/40 wins at mean 1.55 — 8 wins and 0.20 places of
  // margin, so the bounds hold on the fixed instrument too. Both 39-40
  // comparison builds are PRE-D64 and are labelled as such in the message.
  const best = cell40(R3, 1.00, { engine: 3, tyres: 0, frame: 0, turbo: 3 }, 'two-e3w3');
  console.log(`  best two-visit garage (engine 3 + turbo 3), x0: mean ${f(best.mean)}, ` +
    `${best.wins}/${S40.length} wins (AI tier ${best.tier})`);
  assert(best.wins <= 28 && best.mean >= 1.35,
    `the best garage two visits can build still has to race the finale ` +
    `(${best.wins}/${S40.length} wins <= 28, mean ${f(best.mean)} >= 1.35; PRE-D64 39-40 wins at 1.00 ` +
    `with no finale scaling, and with a floor-of-mean aggregator that never fires)`);
}

// --- MEASURED DEAD END: engagement cannot win race 2 ------------------------
// Recorded here so nobody spends another wave searching the same space. The
// question is "can an ENGAGED child win race 2 on a stock kart?", and the answer
// is no, by roughly a factor of three in every lever available:
//
//   * the quiz axis itself (section 6). PRE-D64: x8 correct answers worth
//     0.22-0.37 of a place on race 2 across the five seed sets, against 0.99 on
//     race 1, leaving the mean at 3.30-3.67 with ZERO wins in 200 seeds.
//     HONEST (D67): engagement's value on race 2 FELL to 0.04-0.27, pooled
//     0.13, against 1.00 on race 1, with the mean at 3.73 on S40 and still zero
//     wins in 200 seeds. The dead end got deeper, not shallower.
//   * the quiz BOOST constant, the lever round 1 named as "never measured": at
//     1.80x / 5.0s / impulse 12 — a ~3x buff, far past anything shippable, and
//     one that trivialises race 1 long before it touches race 2 — with twelve
//     answers race 2 read mean 2.75 and 0 wins in 40. That buys 0.9 of the 2.7
//     places needed. PRE-D64 and UNVERIFIED since; the zero-wins half is the
//     load-bearing one and D67 makes it more secure, not less.
//   * the band's own race-2 terms: SLOT_FWD_R2 swept to 0 read 3.45 / 0 wins;
//     a race-2-only bandCatchMax of 0.60 / 0.40 read 3.63 / 3.60, 0 wins, and
//     helped a TIER-3 kart rather than the stock engaged one. PRE-D64 and
//     UNVERIFIED since; again the zero-wins result is what carries.
//
// Race 2 is the race the GARAGE wins — that is the design, section 3b pins it,
// and it is why the token economy pays out where it does. Do not re-open this
// by tuning quiz.js. D67/D68 re-ran the question on the fixed instrument and
// reached the same verdict, harder: the >=15%-of-seeds race-2 win target Wave 7
// set is not reachable from engagement (D68).

// --- 8. KART CHOICE IS NOT A DIFFICULTY SLIDER (Wave 6.1) -------------------
// The playtest complaint: "the purple one walks races". HONEST (D69 — this
// whole section was built and measured after D64, so every figure in it is on
// the fixed instrument), 40 seeds, stock parts, no answers, mean finishing
// place — the purple one is kaftor:
//
//   BEFORE            race 1        race 2        race 3
//   nitzotz (ref)     2.55  4w      3.88  0w      4.22  0w
//   kaftor            1.20 32w      3.20  1w      2.60  2w
//   plada             1.40 26w      4.47  0w      3.92  0w
//   nurit             3.00  1w      3.75  0w      3.95  0w
//   spread            1.83          1.48          2.10
//
// Kart choice was worth up to TWO finishing places — more than the whole
// garage, and invisible to the child, who is told the karts trade speed against
// handling and not that one of them turns the championship off. The cause is
// simply that every pace number in ai.js is calibrated against ONE kart
// (ROSTER[0]) and the field never noticed which kart it was racing.
//
// The fix (src/kart/ai.js, KART_PACE) moves the FIELD by the chosen kart's own
// measured clean flat-out ratio, so the stats keep their feel and stop buying
// places. This section is what stops it silently inverting, collapsing or
// falling out of the wiring.
//
// N = 40 seeds (S40, the same 1..40 every other target-bearing cell in this
// file uses) x 8 karts x 3 races = 960 races, ~85s. That is the bulk of this
// section's runtime and it is not negotiable down: the per-kart differences
// being asserted are a place wide with a per-seed sd near 1.5 places, so five
// seeds cannot see them.
console.log('\n=== 8. KART CHOICE IS NOT A DIFFICULTY SLIDER (8 karts x 40 seeds) ===');
{
  const LO = 1 - KART_PACE_CLAMP, HI = 1 + KART_PACE_CLAMP;
  // Read through kartPace() rather than off the literal, because kartPace() is
  // what the field actually calls: a mutant that inverts or rescales inside the
  // accessor while leaving the table looking correct has to go red here too.
  const cells = ROSTER.flatMap(r => TRACK_IDS.map(tr => ({ id: r.id, tr, v: kartPace(r.id, tr) })));

  // --- 8a. the stored constant -------------------------------------------
  const outside = cells.filter(c => c.v < LO - 1e-12 || c.v > HI + 1e-12);
  assert(outside.length === 0,
    `every stored KART_PACE cell is inside the +-${(KART_PACE_CLAMP * 100).toFixed(0)}% clamp `
    + `(${cells.length} cells, ${f(Math.min(...cells.map(c => c.v)), 3)}..${f(Math.max(...cells.map(c => c.v)), 3)})`
    + (outside.length ? ` — outside: ${outside.map(c => `${c.id}/${c.tr}=${c.v}`).join(', ')}` : ''));

  // The reference kart is the origin of the whole calibration: if its row is
  // not exactly 1 the correction is silently re-basing every other number.
  assert(TRACK_IDS.every(tr => kartPace(PACE_REF_ID, tr) === 1),
    `the reference kart (${PACE_REF_ID}) is corrected by exactly 1.000 on every track`);

  // Every shipped kart is measured. A kart with no row gets 1 by design (see
  // kartPace's doc comment) — which is right for a kart nobody has measured
  // yet, and wrong for one of the eight the child can actually pick.
  const unmeasured = ROSTER.filter(r => TRACK_IDS.some(tr => !Number.isFinite(KART_PACE[r.id]?.[tr])));
  assert(unmeasured.length === 0,
    `all ${ROSTER.length} roster karts carry a full three-track row`
    + (unmeasured.length ? ` — missing: ${unmeasured.map(r => r.id).join(', ')}` : ''));

  // Unknown id / unknown track / garbage -> no correction at all, never NaN.
  // A NaN here would multiply the whole field's pace to NaN and every kart
  // would stand still on the grid.
  assert(kartPace('no-such-kart', 'oasis') === 1 && kartPace('kaftor', 'no-such-track') === 1
    && kartPace(undefined, undefined) === 1 && kartPace(null, 'oasis') === 1,
    'an unknown racer id or track yields exactly 1 (no correction), never NaN');

  // --- 8b. THE SIGN, re-derived from the physics rather than from the table.
  // Three flying laps per cell after two discarded — 24 cells in ~0.4s, and
  // measured to agree with the shipped 20-lap table to within 0.008 on every
  // cell (worst: kaftor/cloud, the track whose limit cycle never repeats).
  // This is what makes the sign assertion mean something: it compares the
  // constant against the game's own lap times TODAY, so a physics change that
  // reverses a kart's advantage also goes red here.
  const live = {};
  for (const tr of TRACK_IDS) for (const r of ROSTER) live[`${r.id}|${tr}`] = measureCell({ racer: r.id, track: tr, laps: 3, warmup: 2 });
  const ratio = paceRatios(live);
  const NOISE = 0.005;      // 3-lap vs 20-lap disagreement, worst cell, x0.6

  console.log(pad('  kart', 12) + TRACK_IDS.map(t => padL(t + ' meas/stored', 22)).join(''));
  for (const r of ROSTER) {
    console.log(pad('  ' + r.id, 12) + TRACK_IDS.map(t =>
      padL(`${f(ratio[`${r.id}|${t}`], 4)} / ${f(kartPace(r.id, t), 3)}`, 22)).join(''));
  }

  // SIGN. A kart that laps FASTER than the reference has a SHORTER lap, so
  // ratio > 1, and the field must be sped UP: stored > 1 too. Getting this
  // backwards does not half-fix the bug, it DOUBLES it (measured: inverting the
  // table takes kaftor on race 1 from 22 wins in 40 to 40 in 40), so it is
  // asserted per cell with the offenders printed rather than left to a comment.
  const wrongSign = cells.filter(c => Math.abs(ratio[`${c.id}|${c.tr}`] - 1) > NOISE
    && (c.v - 1) * (ratio[`${c.id}|${c.tr}`] - 1) < 0);
  assert(wrongSign.length === 0,
    'SIGN: every correction points the same way as the kart it corrects — a faster kart gets a '
    + `faster field (${cells.filter(c => Math.abs(ratio[`${c.id}|${c.tr}`] - 1) > NOISE).length} cells `
    + 'clear of the noise band)'
    + (wrongSign.length ? ` — INVERTED: ${wrongSign.map(c => `${c.id}/${c.tr} stored ${c.v} vs measured ${f(ratio[`${c.id}|${c.tr}`], 4)}`).join(', ')}` : ''));

  // MAGNITUDE, for the cells the clamp does not touch.
  const clampOf = v => Math.min(HI, Math.max(LO, v));
  const drift = cells.filter(c => ratio[`${c.id}|${c.tr}`] > LO && ratio[`${c.id}|${c.tr}`] < HI)
    .map(c => ({ ...c, d: Math.abs(c.v - clampOf(ratio[`${c.id}|${c.tr}`])) }));
  assert(drift.every(c => c.d <= 0.010),
    `every unclamped cell still matches the live measurement within 0.010 (worst ${f(Math.max(...drift.map(c => c.d)), 4)}`
    + `, ${drift.filter(c => c.d > 0.010).map(c => c.id + '/' + c.tr).join(',') || 'none over'})`);

  // THE CLAMP IS LIVE, and it clamps the three cells it is documented to clamp:
  // the low-handling karts on `circuit`, the handling-limited track. If this
  // ever reads "none", the clamp has stopped doing anything and the table is
  // free to hand the field a race.
  const clamped = cells.filter(c => ratio[`${c.id}|${c.tr}`] < LO || ratio[`${c.id}|${c.tr}`] > HI);
  assert(clamped.length === 3 && clamped.every(c => c.tr === 'circuit' && c.v === LO)
    && ['plada', 'zamzum', 'raash'].every(id => clamped.some(c => c.id === id)),
    'the clamp is live and bites exactly the three documented cells — plada/zamzum/raash on '
    + `circuit, each pinned at ${LO} (measured ${clamped.map(c => c.id + ' ' + f(ratio[`${c.id}|${c.tr}`], 3)).join(', ')})`);

  // --- 8c. PER-TRACK STRUCTURE MUST SURVIVE -------------------------------
  // The tempting simplification is one number per kart. It is wrong, and this
  // is the assertion whose only job is to make that edit red.
  const spreadOf = (row, get) => {
    const vs = TRACK_IDS.map(tr => get(row, tr));
    return Math.max(...vs) - Math.min(...vs);
  };
  const storedSpread = Math.max(...ROSTER.map(r => spreadOf(r.id, (id, tr) => kartPace(id, tr))));
  const liveSpread = Math.max(...ROSTER.map(r => spreadOf(r.id, (id, tr) => ratio[`${id}|${tr}`])));
  assert(storedSpread >= 0.04 && liveSpread >= 0.06,
    `a kart's correction still varies across tracks — stored spread ${f(storedSpread, 3)} (bar 0.040), `
    + `live measured spread ${f(liveSpread, 3)} (bar 0.060). Collapsing KART_PACE to one number per `
    + 'kart fails here.');
  // Stronger than a spread: zamzum's correction CHANGES SIGN between tracks
  // (1.004 on oasis, clamped 0.950 on circuit). No single per-kart number can
  // reproduce that — a mean would get circuit ~6 points wrong AND point the
  // wrong way on oasis.
  assert(kartPace('zamzum', 'oasis') >= 1 && kartPace('zamzum', 'circuit') < 1
    && ratio['zamzum|oasis'] > 1 && ratio['zamzum|circuit'] < 1,
    'zamzum is faster than the reference on oasis and slower on circuit, in the measurement '
    + `(${f(ratio['zamzum|oasis'], 3)} / ${f(ratio['zamzum|circuit'], 3)}) and in the table `
    + `(${kartPace('zamzum', 'oasis')} / ${kartPace('zamzum', 'circuit')}) alike`);

  // --- 8d. THE WIRING — the constant reaches the field --------------------
  // A table nobody multiplies by is the quietest way for this fix to die. The
  // field's own basePace() is read back for each kart and compared against the
  // reference kart's on the same track.
  const fieldPace = (id, track) => {
    const { def, spline } = getTrack(track);
    const fld = createAIField(spline, def, null, { difficulty: 1, playerRacerId: id, seed: 1 });
    const bp = fld.drivers[0].basePace();
    fld.dispose();
    return bp;
  };
  let wired = 0, wireBad = [], signBad = [];
  for (const tr of TRACK_IDS) {
    const ref = fieldPace(PACE_REF_ID, tr);
    for (const r of ROSTER) {
      const got = fieldPace(r.id, tr) / ref;
      wired++;
      if (Math.abs(got - kartPace(r.id, tr)) > 1e-9) wireBad.push(`${r.id}/${tr} ${f(got, 4)} != ${kartPace(r.id, tr)}`);
      if (Math.abs(ratio[`${r.id}|${tr}`] - 1) > NOISE && (got - 1) * (ratio[`${r.id}|${tr}`] - 1) < 0) {
        signBad.push(`${r.id}/${tr}`);
      }
    }
  }
  assert(wireBad.length === 0,
    `the field a child actually races is scaled by exactly its own KART_PACE cell, on all ${wired} `
    + `kart x track combinations` + (wireBad.length ? ` — off: ${wireBad.join(', ')}` : ''));
  assert(signBad.length === 0,
    'SIGN, END TO END: the field built for a kart that laps faster than the reference is itself '
    + 'faster than the reference field' + (signBad.length ? ` — INVERTED: ${signBad.join(', ')}` : ''));

  // --- 8e. THE OUTCOME ----------------------------------------------------
  // 8 karts x 3 races x 40 seeds, stock parts, no answers.
  //
  // BOUNDS. HONEST throughout — section 8 was built and measured after the
  // instrument fix, so nothing in it is a crooked-ruler figure (D69). Measured
  // on the shipped code with S40: 1.78 / 1.02 / 1.63. The
  // bounds below (1.90 / 1.60 / 1.85) carry the set-to-set variation, which is
  // real: a disjoint 41..80 set reads 1.55 / 1.40 / 1.40, i.e. +-0.25 on this
  // statistic. They are deliberately NOT set to the target.
  //
  // THE TARGET IS 0.75 PLACES AND THIS DOES NOT REACH IT, HONESTLY. Two
  // measured reasons, neither of them tunable by this table:
  //  * FIELD COMPOSITION. Choosing a kart also REMOVES it from the seven-kart
  //    field. Measured with the player's physics HELD at the reference kart and
  //    the pace correction off, so the only thing varying is which seven
  //    opponents show up, the mean place still spreads 1.13 / 0.93 / 1.35. The
  //    confound alone is already over target; no pace number can touch it.
  //  * THE PACE LEVER IS SATURATED ON OASIS. TRACK_PACE.oasis is 1.09 and the
  //    field there is TOP-SPEED limited, exactly as the TRACK_PACE comment in
  //    ai.js warned ("pace above ~1.05 buys nothing there"). Measured on the
  //    field alone: +5% pace moves the field's mean 3-lap time by -0.7% on
  //    oasis and -1.3% on cloud, against -4.8% on circuit. So race 2 gets the
  //    full correction, race 1 gets roughly a sixth of it, and the residual on
  //    race 1 (plada and kaftor, ~1.0 place each) is what is left over.
  // GAPS.md carries both; the lever that would reach the target on oasis is
  // the field's TOP SPEED (parts), not its pace, and that is a design change.
  const RESULT_BOUND = { 1: 1.90, 2: 1.60, 3: 1.85 };
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const kartRows = ROSTER.map(r => ({
    id: r.id,
    m: RACES.map(R => {
      const p = S40.map(seed => race({
        track: R.track, difficulty: R.difficulty, pace: 1.00, seed, racerId: r.id,
      }).pos);
      return { mean: mean(p), wins: p.filter(x => x === 1).length };
    }),
  }));
  console.log(pad('  kart', 12) + RACES.map(R => padL(`race ${R.n} mean (wins)`, 22)).join(''));
  for (const row of kartRows) {
    console.log(pad('  ' + row.id, 12) + row.m.map(m => padL(`${f(m.mean)} (${m.wins}w)`, 22)).join(''));
  }
  RACES.forEach((R, i) => {
    const ms = kartRows.map(r => r.m[i].mean);
    const spread = Math.max(...ms) - Math.min(...ms);
    assert(spread <= RESULT_BOUND[R.n],
      `race ${R.n}: mean finishing place spreads ${f(spread, 2)} places across all eight karts `
      + `(${f(Math.min(...ms))}..${f(Math.max(...ms))}, bar ${f(RESULT_BOUND[R.n])}; target is 0.75 and `
      + 'the residual is field composition + oasis pace saturation, see the note above)');
  });

  // THE REPORTED BUG, pinned by name. kaftor is the purple kart the playtest
  // said walks race 1: 32 wins in 40 before, 22 after (21 on the disjoint set).
  // An inverted table reads 40/40 and a table that never reaches the field
  // reads 32/40, so both go red here as well as in 8b/8d.
  const kaftor1 = kartRows.find(r => r.id === 'kaftor').m[0];
  assert(kaftor1.wins <= 27 && kaftor1.mean >= 1.35,
    `race 1 is no longer a walkover for kaftor, the purple kart the playtest named: `
    + `${kaftor1.wins} wins in 40 (bar 27, was 32) at mean ${f(kaftor1.mean)} (bar 1.35, was 1.20)`);

  // SEAM: the default path is untouched. Section 8 is the first caller ever to
  // pass a racerId; if that plumbing perturbed the reference kart, every other
  // number in this file would move underneath it. cell40's race-N cells are the
  // same forty seeds with the racer left to its default.
  const refDrift = RACES.map((R, i) => Math.abs(kartRows[0].m[i].mean - cell40(R, 1.00).mean));
  assert(kartRows[0].id === PACE_REF_ID && refDrift.every(d => d === 0),
    `the reference kart's forty-seed cells are bit-identical to the rest of the file's `
    + `(${RACES.map((R, i) => `race ${R.n} ${f(kartRows[0].m[i].mean)}`).join(', ')}) — the racerId `
    + 'plumbing did not move the default path');
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

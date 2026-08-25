// AIDriver — the seven opponents of מרוץ הפרומפטים.
//
// DESIGN RULE #1: the AI drives the SAME physics as the player. Everything in
// this file ends as an `{throttle, brake, steer, drift, hop}` object handed to
// KartBody.update(). There is no teleporting, no spline-following, no secret
// grip. If an opponent is fast it is because it braked earlier and drifted
// better than you did — which is the only kind of fast a kid believes.
//
// The stack, bottom to top:
//   1. racingLine(spline)      — a min-curvature line solved ONCE per track and
//                                cached on the spline. Brake in wide, apex the
//                                inside, track out. Shared by all 8 karts.
//   2. speedProfile(line, kart)— per-kart target speed at every node, from the
//                                real grip circle, then a backward pass that
//                                propagates braking distance. This is why the
//                                AI brakes *early enough* instead of guessing.
//   3. AIDriver                — pure-pursuit steering onto that line, throttle
//                                / brake against that profile, a drift state
//                                machine, awareness of the other karts, a
//                                personality, and deliberate small mistakes.
//   4. ProgressTracker         — the ONE way any kart's race progress is
//                                accumulated, player included (race.js drives
//                                the player's instance). Progress is measured
//                                from the START/FINISH LINE and converges on
//                                the centreline projection; see D64 and the
//                                block above the class.
//   5. createAIField           — the 7 opponents + the bounded rubber band.
//
// Determinism: every random number comes from core/rng.js. Never Math.random.
//
// READING THE MEASURED NUMBERS IN THIS FILE. Every difficulty figure published
// before D64 was read off a crooked instrument: progress accumulators started
// at 0 while the grid parks karts up to 22 m behind the line, the accumulators
// were compared across a phase skew, and `lapT` could snap forward. Comment
// blocks below therefore label their tables **pre-D64** (historical, kept
// because they explain why a constant has its value) or **honest** (re-measured
// after the fix — D67/D69, and the tables in tests/ai.test.mjs §2c and §8). A
// pre-D64 number may NOT be compared against an honest one; that comparison is
// itself the mistake D64 exists to name (see the "D67 CORRECTION" entry).
import * as THREE from 'three';
import { getTrack, gridSlots, TrackSpline } from '../track/trackdef.js';
import { KartBody, DRIFT_TIERS, DRIFT_GRIP } from './kartphysics.js';
import { ROSTER } from './roster.js';
import { makeRng } from '../core/rng.js';
import { createKart } from './kartmodel.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));

// ===========================================================================
// 1. RACING LINE — solved once per track, cached on the spline object.
// ===========================================================================

// Margin from the painted edge that the racing line may use, metres.
//
// Tuned by lap time, not by theory (.tmp/aitest.mjs, oasis, one kart, no
// traffic): 2.2m -> 49.3s with the kart off-track 24% of the lap; 3.0m ->
// 48.6s / 14%; 3.6m -> 47.7s / 3%. A line that uses every last centimetre of
// road is only quick for a driver that can track it perfectly, and this one
// drifts. The margin is where the tracking error gets to live.
const EDGE_MARGIN = 3.6;

const LINE_CACHE = new WeakMap();

/**
 * Minimum-curvature racing line for a spline.
 *
 * Solved by gradient descent on E = Σ |P(i-1) - 2P(i) + P(i+1)|², where each
 * P(i) may only slide along the track normal and is clamped inside the road.
 * Minimising the discrete second difference is *exactly* "make the path as
 * straight as the track allows", which is what produces the wide-in /
 * apex-inside / wide-out shape by itself — no hand-authored corner cases.
 *
 * @returns {{N, ds, off, px, py, pz, radius, length}}  arrays are per-node,
 *          `off` is the lateral offset (+ = right of travel, matching
 *          TrackSpline.rightAt), `radius` is the line's own corner radius (m).
 */
export function racingLine(spline, opts = {}) {
  const hit = LINE_CACHE.get(spline);
  if (hit && !opts.force) return hit;

  const N = clamp(Math.round(spline.length / 3), 192, 640);
  const ds = spline.length / N;
  const cx = new Float64Array(N), cy = new Float64Array(N), cz = new Float64Array(N);
  const rx = new Float64Array(N), rz = new Float64Array(N);
  const lim = new Float64Array(N);
  const p = new THREE.Vector3(), r = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const t = i / N;
    spline.positionAt(t, p); spline.rightAt(t, r);
    cx[i] = p.x; cy[i] = p.y; cz[i] = p.z;
    rx[i] = r.x; rz[i] = r.z;
    lim[i] = Math.max(0.4, spline.widthAt(t) - (opts.margin ?? EDGE_MARGIN));
  }

  const off = new Float64Array(N);
  const px = new Float64Array(N), pz = new Float64Array(N);
  const build = () => { for (let i = 0; i < N; i++) { px[i] = cx[i] + rx[i] * off[i]; pz[i] = cz[i] + rz[i] * off[i]; } };
  build();

  // Gradient descent on E = ALPHA·Σ|P(i+1)-P(i)|² + BETA·Σ|Δ²P(i)|².
  //
  // The first term is path length (its gradient is just -Δ²P — every node pulled
  // toward the midpoint of its neighbours) and the second is curvature energy.
  // Length alone gives the geometric "shortest way round", which cuts corners
  // too hard; curvature alone is the textbook minimum-curvature line but its
  // operator is 4th order, and descending it at any usable step size is
  // UNSTABLE — the first version of this file did exactly that and produced a
  // perfect sawtooth pinned to both kerbs at 3m intervals, which read as a
  // racing line with a 9m corner radius everywhere and made the AI lap in 100s.
  // Mixing in the (well-conditioned, 2nd order) length term both stabilises the
  // descent and gives the line its corner-cutting character. Step is chosen
  // under the stability limit 2/(4·ALPHA + 16·BETA).
  const ALPHA = 1, BETA = 0.14;
  const step = opts.step ?? 0.22;             // limit here is ~0.31
  const iters = opts.iters ?? 2400;
  const gx = new Float64Array(N), gz = new Float64Array(N);
  const d2x = new Float64Array(N), d2z = new Float64Array(N);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      d2x[i] = px[a] - 2 * px[i] + px[b];
      d2z[i] = pz[a] - 2 * pz[i] + pz[b];
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      gx[i] = -ALPHA * d2x[i] + BETA * (d2x[a] - 2 * d2x[i] + d2x[b]);
      gz[i] = -ALPHA * d2z[i] + BETA * (d2z[a] - 2 * d2z[i] + d2z[b]);
    }
    for (let i = 0; i < N; i++) {
      const g = gx[i] * rx[i] + gz[i] * rz[i];
      off[i] = clamp(off[i] - step * g, -lim[i], lim[i]);
    }
    build();
  }
  // The width clamp leaves corners in the offset profile where the line runs
  // out of road. Smooth them out (still inside the corridor) — a kink here is
  // a phantom hairpin as far as the speed profile is concerned.
  for (let pass = 0; pass < 24; pass++) {
    const prev = Float64Array.from(off);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      off[i] = clamp(prev[i] * 0.5 + (prev[a] + prev[b]) * 0.25, -lim[i], lim[i]);
    }
  }
  build();

  // Late-apex bias: slide the whole profile a couple of nodes down the road.
  // A geometric apex is theoretically quickest and practically a trap — it puts
  // the kart on the exit kerb with the throttle already open. Delaying it ~6m
  // makes the AI's exits repeatable (and, in traffic, survivable).
  const shift = Math.round(clamp(opts.lateApex ?? 6, 0, 30) / ds);
  if (shift > 0) {
    const tmp = Float64Array.from(off);
    for (let i = 0; i < N; i++) off[i] = clamp(tmp[(i - shift + N) % N], -lim[i], lim[i]);
    build();
  }

  // Menger curvature of the resulting polyline -> corner radius per node.
  // The stencil spans ~11 metres either side: at 3m node spacing a ±1 node
  // stencil measures mostly floating-point noise, and noise in the radius turns
  // straight into phantom braking points.
  const K = Math.max(2, Math.round(11 / ds));
  const kap = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - K + N * 2) % N, b = (i + K) % N;
    const ax = px[a] - px[i], az = pz[a] - pz[i];
    const bx = px[b] - px[i], bz = pz[b] - pz[i];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    const lc = Math.hypot(px[b] - px[a], pz[b] - pz[a]);
    const area2 = Math.abs(ax * bz - az * bx);
    const denom = la * lb * lc;
    kap[i] = denom < 1e-6 ? 0 : (2 * area2) / denom;
  }
  // Box-smooth the curvature (not the radius — averaging radii lets one long
  // straight erase a hairpin sitting next to it).
  const ks = Float64Array.from(kap);
  const W = Math.max(1, Math.round(4 / ds));
  for (let i = 0; i < N; i++) {
    let s = 0, n = 0;
    for (let k = -W; k <= W; k++) { s += ks[(i + k + N * 2) % N]; n++; }
    kap[i] = s / n;
  }
  const radius = new Float64Array(N);
  for (let i = 0; i < N; i++) radius[i] = clamp(kap[i] > 1e-5 ? 1 / kap[i] : 2000, 7, 2000);
  // A corner is only as fast as its tightest part: smear the minimum backwards
  // over ~6m so the entry already knows what is coming.
  const rs = Float64Array.from(radius);
  const S = Math.max(1, Math.round(6 / ds));
  for (let i = 0; i < N; i++) {
    let m = rs[i];
    for (let k = 1; k <= S; k++) m = Math.min(m, rs[(i + k) % N]);
    radius[i] = m;
  }

  const py = new Float64Array(N);
  for (let i = 0; i < N; i++) py[i] = cy[i];
  const line = { N, ds, off, px, py, pz, radius, length: spline.length, spline };
  LINE_CACHE.set(spline, line);
  return line;
}

const nodeAt = (line, t) => ((Math.floor(((t % 1) + 1) % 1 * line.N) % line.N) + line.N) % line.N;

/** Lateral offset of the racing line at lap fraction t (linear between nodes). */
export function lineOffsetAt(line, t) {
  const f = (((t % 1) + 1) % 1) * line.N;
  const i = Math.floor(f) % line.N, j = (i + 1) % line.N, a = f - Math.floor(f);
  return line.off[i] + (line.off[j] - line.off[i]) * a;
}

/** Racing-line corner radius (metres) at t. */
export function lineRadiusAt(line, t) { return line.radius[nodeAt(line, t)]; }

// ===========================================================================
// 2. SPEED PROFILE — per kart, built once, read every frame.
// ===========================================================================

/**
 * Target speed at every node: the grip-circle limit, then a backward pass that
 * makes sure each node is reachable from the next one under braking.
 *
 * The backward pass is the whole trick. A lookahead heuristic ("is there a
 * corner in 1.5s?") is always either too early on a straight or too late into a
 * hairpin; propagating v² = u² + 2as around the loop is correct everywhere and
 * costs one array per kart, once.
 */
export function speedProfile(line, { mu, brakeA, vmax }) {
  const N = line.N, ds = line.ds;
  const v = new Float64Array(N);
  for (let i = 0; i < N; i++) v[i] = Math.min(vmax, Math.sqrt(mu * line.radius[i]));
  for (let pass = 0; pass < 2; pass++) {
    for (let k = N - 1; k >= 0; k--) {
      const i = k, j = (i + 1) % N;
      const reach = Math.sqrt(v[j] * v[j] + 2 * brakeA * ds);
      if (reach < v[i]) v[i] = reach;
    }
  }
  return v;
}

// ===========================================================================
// 3. PERSONALITIES
// ===========================================================================
//
// Every number here has to be visible from the driver's seat over three laps.
// Tuning rule used throughout: if a knob does not change a telemetry column in
// .tmp/aitest.mjs, it is decoration and it does not belong in this table.
export const PERSONA = {
  // the player's own key; used when the AI stands in for a player (previews).
  balanced: {
    pace: 1.00, mu: 1.00, brakeEarly: 1.00, driftEager: 1.00, driftHold: 1,
    aggression: 0.50, mistakeEvery: 12, mistakeMag: 1.0, wobble: 0.030,
    block: 0.15, lift: 0.80, paceWave: 0.015, waveHz: 0.42,
  },
  // Late braker. Carries more speed in, runs a bit wide out, leans on you.
  aggressive: {
    pace: 1.015, mu: 1.035, brakeEarly: 0.72, driftEager: 1.05, driftHold: 1,
    aggression: 1.00, mistakeEvery: 7.5, mistakeMag: 1.4, wobble: 0.045,
    block: 0.20, lift: 0.97, paceWave: 0.02, waveHz: 0.42,
  },
  // Metronome. Slightly slower peak, almost never wrong, easy to follow.
  steady: {
    pace: 0.995, mu: 0.975, brakeEarly: 1.40, driftEager: 0.72, driftHold: 1,
    aggression: 0.30, mistakeEvery: 30, mistakeMag: 0.5, wobble: 0.012,
    block: 0.10, lift: 0.66, paceWave: 0.006, waveHz: 0.42,
  },
  // Over- and under-shoots. Fast on her day; the lap time scatter is the point.
  erratic: {
    pace: 1.00, mu: 1.00, brakeEarly: 0.94, driftEager: 1.15, driftHold: 1,
    aggression: 0.60, mistakeEvery: 3.4, mistakeMag: 2.1, wobble: 0.085,
    block: 0.20, lift: 0.80, paceWave: 0.075, waveHz: 0.085,
  },
  // Defends the inside when you are close behind. Slower alone, hard to pass.
  blocker: {
    pace: 1.00, mu: 0.99, brakeEarly: 1.10, driftEager: 0.85, driftHold: 1,
    aggression: 0.70, mistakeEvery: 16, mistakeMag: 0.8, wobble: 0.022,
    block: 1.00, lift: 0.72, paceWave: 0.01, waveHz: 0.42,
  },
  // Drifts everything, including corners that do not need it. Sparkly to watch.
  drifter: {
    pace: 1.00, mu: 1.02, brakeEarly: 0.92, driftEager: 2.2, driftHold: 2,
    aggression: 0.50, mistakeEvery: 11, mistakeMag: 1.0, wobble: 0.035,
    block: 0.20, lift: 0.78, paceWave: 0.02, waveHz: 0.42,
  },
};

const persona = key => PERSONA[key] || PERSONA.balanced;

// ===========================================================================
// Difficulty scalar
// ===========================================================================
/**
 * Accepts either a race number (1, 2, 3 — the championship escalation) or a
 * raw 0..1 fraction. Returns 0..1 where 0 is gentle and 1 is challenging.
 * difficulty 1 === race one === the gentlest setting.
 */
export function difficulty01(d) {
  if (d == null) return 0.5;
  if (d >= 1) return clamp((d - 1) / 2, 0, 1);
  return clamp(d, 0, 1);
}

// ---------------------------------------------------------------------------
// PACE, TRACK CALIBRATION AND THE OPPONENTS' OWN GARAGE  (Wave 4 rebalance)
// ---------------------------------------------------------------------------
// Wave 1 carried the whole championship escalation in one number — a base pace
// of 0.815 -> 0.965 of the AI's speed profile. Measured end-to-end in Wave 4
// (autopilot player, real KartBody, topSpeed+accel scaled to `pace`, 3 laps,
// 5 seeds) that left the game a walkover: a clean 100%-pace player won all
// three races on every seed, on every track, at every difficulty — because the
// AI's own flat-out was already slower than the reference driver and the pace
// fraction then took another 3.5-18.5% off it:
//
//   4-lap flat-out, one kart, no traffic     oasis    circuit   cloud
//   reference autopilot (the yardstick)      46.95s   54.56s    48.08s
//   AI at pace 1.00, stock kart              48.08s   51.71s    50.35s
//
// So the escalation is now carried by two honest things instead of one:
//
//  1. PACE is a flat 1.00 — the AI simply drives its own speed profile with no
//     safety margin left in it. It is not a licence to exceed the physics: the
//     profile is capped at the kart's own topSpeed and built from the real grip
//     circle at `skill` confidence, and `skill`, mistake rate and hand wobble
//     still scale with difficulty exactly as before.
//     TRACK_PACE is a per-geometry calibration, measured from the table above:
//     the gap between the reference lap and the AI's own flat-out is +2.4% on
//     oasis, -5.2% on circuit and +4.7% on cloud, so one global number puts the
//     field in a different place on every track. These three put the FIELD where
//     the design wants it relative to a clean driver, per track.
//  2. THE OPPONENTS UPGRADE TOO. Race 1 is stock; race 2 they run tier-1 parts;
//     race 3 tier-2. Same PART_TIERS the child buys in the garage, same physics,
//     no secret grip — and it is the only lever that raises the AI's TOP SPEED,
//     which is what limits it on oasis and cloud (pace above ~1.05 buys nothing
//     there but off-track time). It also makes the garage legible: the way to
//     beat an upgraded field is to turn up with an upgrade of your own.
//
// PRE-D64 (crooked ruler — historical, do not compare with an honest number).
// Measured result, autopilot player, 5 seeds, place out of 8:
//   stock player  race 1: 1st-3rd (mean 2.2)   race 2: 3rd-4th   race 3: 3rd-5th
//   tier-1 player            1st-2nd (1.2)              2nd-3rd          1st-3rd
//   tier-2 player            1st                        1st-2nd          1st
// The honest stock ladder over five disjoint 40-seed sets (D67, and the table
// in tests/ai.test.mjs §2c) is 2.43-2.55 / 3.73-3.90 / 4.10-4.38. The SHAPE the
// two levers were chosen for survives; the figures above do not.
//
// WAVE 6: oasis 1.03 -> 1.09, measured, and what it cost.
// -------------------------------------------------------
// The playtest verdict: race 1 reads as cruising alone. Race 1's opponents are
// the sloppiest in the game by design, and their catch-up is already pinned at
// the BAND_CATCH ceiling (bandCatchMax is 1.00x at d01 = 0), so no band setting
// can put them in front of a clean child — only their own speed can.
//
// HONEST NUMBERS (D64/D67 + the "D67 CORRECTION" entry). Both builds were
// re-measured on the fixed instrument, five disjoint 40-seed sets, stock kart,
// 100% pace — because comparing the shipped build against a pre-D64 recording
// of the old one is exactly the error D64 names, and D67 made it once already:
//
//   race 1, stock, 100%     1.09 (ships)   1.03 (pre-Wave-6)   1.06 (halfway)
//   close passes / race     5.70-6.80      1.68-2.10           4.65-4.98
//   % of race led           45.6-55.9      64.6-73.0           44.4-65.9
//   median gap              0.46-0.50      0.72-0.84           0.54-0.65
//   nearest rival <=1.5 s   95.0-96.3      86.1-90.9           91.7-96.8
//   mean place              2.43-2.55      1.53-1.73           2.10-2.25
//
// So the raise is real and LARGER than the crooked ruler ever credited it with:
// three times the visible passes, 18 points less of the race led, half the
// distance to the nearest rival. Race 1 on honest data is not lonely — a rival
// is within 1.5 s for 95% of it and a visible pass lands roughly every 24 s —
// it is simply a race the child leads about half of, which is what the gentle
// opening race is for. Bounds live in tests/ai.test.mjs §2c.
//
// PRE-D64 (crooked ruler — the reading this constant was actually chosen on,
// kept because it is the argument that moved it, NOT comparable with the table
// above): 1.03 read 2.25 / 5 wins in 40 / 46.0% led / 0.53 s / 14.9 lead
// changes, 1.09 read 2.67 / 0 wins / 34.9% / 0.43 s / 17.4; an engaged child
// (x8) read 18 wins in 40 at 1.68 mean, from 1.45 / 22.
//
// The engaged child on the SHIPPED build, honest (tests/ai.test.mjs §6 prints
// it every run, seeds 1-40): x0 2.55 with 4 wins -> x8 1.55 with 22 wins, i.e.
// 1.00 place, 0.125 of a place per correct answer. The promise race 1 exists to
// make — that answering the questions is what wins it — is intact, and by more
// than the crooked ruler said. The CEILING argument that stopped this constant
// at 1.09 is pre-D64 and has not been re-measured: values above ~1.12 were
// recorded taking the engaged child below a quarter of the seeds. Treat that
// threshold as UNVERIFIED, and re-measure before moving the constant again.
// Keyed by track id, so races 2 and 3 are bit-identical (verified per seed).
//
// WAVE 5: circuit 0.96 -> 0.98, and why that number was the one that moved.
// -----------------------------------------------------------------------
// The calibration above puts the field where the design wants it relative to
// the REFERENCE AUTOPILOT — a machine whose skill is identical on all three
// geometries. A child's is not: `circuit` is the plainest, widest geometry in
// the game and the one a human drives closest to the optimal line on, so a
// handicap sized against the machine over-pays on exactly that track. Measured
// (autopilot player, 3 laps, race 2 = circuit d2, place out of 8; the 100%
// figures are pooled over 160 seeds — four DISJOINT 40-seed sets, because every
// upgraded cell here is a fight and a five- or twenty-one-seed reading of one
// swings by 20 percentage points).
//
// PRE-D64 (crooked ruler — the reading that chose the constant; not comparable
// with an honest figure, though both columns were measured the same way so the
// DIRECTION they establish stands):
//
//   circuit pace   stock 100%       tier-2 100%      tier-3 100%     85% stock*
//   0.96 (before)  3.06  best 1st   1.82  26% wins   1.29  71% wins   5.05
//   0.98 (now)     3.79  best 2nd   2.22  12% wins   1.68  35% wins   5.27
//   (* 85% column is 41 seeds; that axis is flat by design — see D33b)
//
// HONEST, the shipped 0.98 only (D67/D68, five disjoint 40-seed sets): race 2
// stock 3.73-3.90 (0 wins in 200), uniform tier-2 2.12 (2.08-2.25), uniform
// tier-3 1.47 with 107 wins in 200, and the 85%-pace ladder 4.00 / 5.00 / 6.00.
// Nothing here was re-tuned on those numbers — they are what the same shipped
// constant measures on a straight ruler.
//
// i.e. race 2 stopped being a race a clean driver could podium in with no
// engagement at all, and stopped being a formality for a well-upgraded one.
// Race 1 (oasis) and race 3 (cloud) are bit-for-bit unmoved: this constant is
// keyed by track id and the championship maps race N -> track N.
// Alternatives measured and rejected (5 seeds and PRE-D64, so read as
// directions rather than as figures — and the first of them was re-measured
// properly in D68, which reached the same verdict for better reasons), both
// because they broke the RANK order rather than the gap:
// `aiPartTier` race 2 -> tier 2 put race 2 (4.00) above race 3 (3.80) at 100%
// and left a fully-spent garage unable to win it; a quartic `slotStretch`
// falloff (race-2 stretch 1.20 -> 1.05) moved the 85% child twice as far as the
// 100% one (5.00 -> 5.60) while leaving the tier-3 walkover the complaint is
// about untouched (1.20, 4/5 wins). Values above 0.99 tie or pass race 3 at
// 100% and are the punishing side of the target.
//
// NOT fixed here, and pinned rather than claimed: the upgraded axis does not
// escalate. Wave 5 wrote this as "the championship is INVERTED (race 2 tier-2
// 2.22 against race 3 tier-2 1.09)" — both pre-D64 figures, and the claim did
// not survive the honest re-measure. D58's finale scaling removed the inversion
// and what is left is FLAT: race 2 tier-2 2.12 against race 3 tier-2 2.22, a
// gap of +0.09 places over 200 seeds with a per-set spread of -0.15..+0.48
// (D67/D68). Flat, not inverted, is the real defect, and closing it still means
// moving race 3 or the tracks' own pace — race 2's field is the wrong lever and
// D68 measured why. tests/ai.test.mjs (3b vii) pins the FLATNESS (gap >= -0.55,
// re-derived because the old -0.25 bound sat inside its own noise); no bound
// asserting a real step can be green today. GAPS.md carries the lever.
const AI_PACE = 1.00;
const TRACK_PACE = { oasis: 1.09, circuit: 0.98, cloud: 1.00 };
const paceForDifficulty = () => AI_PACE;

// ---------------------------------------------------------------------------
// PER-KART FIELD CORRECTION (Wave 6.1) — kart choice must not buy places.
// ---------------------------------------------------------------------------
// Every number above is calibrated against ONE kart: ROSTER[0], nitzotz
// (3/4/4/3). The roster's stat spread is deliberately wide, so the OTHER seven
// karts lap the same track at a different clean flat-out pace — and against a
// field that never noticed, that difference was bought straight out of the
// finishing order.
//
// HONEST, 40 seeds, stock parts, no answers, mean finishing place and wins on
// race 1, BEFORE this correction (D69, and the table in tests/ai.test.mjs §8 —
// four karts, which is what was re-measured on the fixed instrument):
//
//     kart            race 1      race 2      race 3
//     nitzotz (ref)   2.55  4w    3.88  0w    4.22  0w
//     kaftor          1.20 32w    3.20  1w    2.60  2w
//     plada           1.40 26w    4.47  0w    3.92  0w
//     nurit           3.00  1w    3.75  0w    3.95  0w
//     spread          1.83        1.48        2.10
//
// Kart choice was worth up to TWO finishing places — more than the whole garage,
// and invisible to the child, who is told the karts trade speed for handling and
// not that one of them turns the championship off. It was a difficulty slider
// wearing a costume. AFTER this correction the spreads read 1.78 / 1.02 / 1.63
// (D69): race 2 took most of it, race 1 barely moved, and the <=0.75 target is
// MISSED for two measured reasons no pace number can reach — field composition
// (choosing a kart also removes it from the seven opponents: 1.13/0.93/1.35 on
// its own) and pace saturation on oasis. GAPS.md carries the item; do not tune
// this table against it.
//
// PRE-D64 (crooked ruler — the eight-kart sweep this correction was first built
// from, kept because it is where the table's shape came from; NOT comparable
// with the honest figures above, which read the same cells differently, e.g.
// kaftor's race 1 as 1.20 / 32 wins rather than 1.10 / 36):
//
//     nitzotz 2.50 3.83 4.10      zamzum  2.50 4.88 3.65
//     zuzi    3.08 3.30 4.53      tipa    2.65 3.53 3.20
//     plada   1.35 4.40 4.13      kaftor  1.10 3.10 2.55   <- 36/40 wins on race 1
//     nurit   3.03 3.73 4.05      raash   1.88 4.25 2.98
//
// KART_PACE[id][track] = lap(nitzotz, track) / lap(id, track), clamped to +-5%,
// measured by `tools/kartpace.mjs` (20 flying laps per cell after 2 discarded,
// clean autopilot, stock parts, no traffic; nothing on that path is random, so
// every figure is bit-reproducible and the noise floor on a ratio is +-0.15%).
//
// THE SIGN. A kart FASTER than the reference has a SHORTER lap, so ratio > 1,
// and the field must be sped UP by that factor to meet it. The correction moves
// the field in the SAME direction as the chosen kart. Inverting it would double
// the bug rather than cancel it, so the sign is asserted directly in
// tests/ai.test.mjs section 8 rather than trusted to this paragraph.
//
//     fieldPace = AI_PACE * TRACK_PACE[track] * kartPace(racerId, track)
//
// PER-TRACK IS STRUCTURAL, NOT COSMETIC. zamzum's ratio spans 1.004 on `oasis`
// to 0.900 on `circuit` — 10.4 points, 70x the noise floor and twice the whole
// clamp. The cause is the geometry: `circuit` is the handling-limited track, so
// the low-handling karts (zamzum h=1, plada h=2, raash h=2) collapse there and
// are fine on the two flowing tracks. Collapsing this table to one number per
// kart would get zamzum's circuit correction ~6 points wrong AND flip its sign
// on oasis; section 8 has an assertion whose only job is to make that edit red.
//
// THE CLAMP is on the STORED CONSTANT and is symmetric, +-5%: a correction is
// allowed to move the field by as much as the honest kart difference and no
// more, so a pathological cell cannot hand the field a race. Three circuit
// cells clamp (plada 0.937, zamzum 0.900, raash 0.940) and those three karts
// therefore remain genuinely harder on race 2 by design — the residual is
// stated in DECISIONS.md rather than tuned away. The clamp is NOT applied to
// the product with TRACK_PACE: TRACK_PACE.oasis is already 1.09 and clamping
// the product would destroy it.
const KART_PACE = {
  nitzotz:  { oasis: 1.000, circuit: 1.000, cloud: 1.000 },
  zuzi:     { oasis: 0.981, circuit: 1.021, cloud: 0.983 },
  plada:    { oasis: 1.018, circuit: 0.950, cloud: 1.004 },   // clamped from circuit 0.937
  nurit:    { oasis: 1.009, circuit: 1.027, cloud: 1.004 },
  zamzum:   { oasis: 1.004, circuit: 0.950, cloud: 0.978 },   // clamped from circuit 0.900
  tipa:     { oasis: 1.000, circuit: 0.977, cloud: 1.003 },
  kaftor:   { oasis: 1.029, circuit: 1.003, cloud: 1.022 },
  raash:    { oasis: 1.014, circuit: 0.950, cloud: 0.997 },   // clamped from circuit 0.940
};
/** The reference kart every pace number in this file is calibrated against. */
export const PACE_REF_ID = 'nitzotz';
/** How far the per-kart correction may move the field, either way. */
export const KART_PACE_CLAMP = 0.05;
export { KART_PACE };

/**
 * The field's pace correction for the kart the child chose. Unknown racer,
 * unknown track, or a missing cell -> 1, i.e. no correction at all: a new kart
 * added to the roster without a measurement gets the reference field rather
 * than a guess.
 *
 * NOT to be confused with AIDriver#racerPace(), which is the small fixed ±4%
 * personality offset of ONE OPPONENT. `kartPace` is keyed by the kart the HUMAN
 * picked and moves the WHOLE field; it is read once, in createAIField.
 */
export function kartPace(racerId, trackId) {
  const v = KART_PACE[racerId]?.[trackId];
  return Number.isFinite(v) ? v : 1;
}

// Championship tier of the opponents' own karts: race 1 stock, race 2 tier 1,
// race 3 tier 2.
//
// WAVE 6 — THE FINALE SCALES WITH THE CHILD'S OWN GARAGE.
// The finale's field stopped at tier 2, so a child who arrived on tier-2 parts
// met an equally-equipped field on the geometry with the least room to defend
// and won it 36 times in 40 with ZERO questions answered (D44, GAPS.md). The
// finale — and ONLY the finale — now runs one tier above the child's own kart,
// never below its championship tier of 2 and never above tier 3, which is the
// top of PART_TIERS: the field still cannot out-equip a fully-spent garage
// (D33), it just stops handing the race to a half-spent one.
//
// `playerTier` defaults to 0, so every existing caller — and a race where the
// child has bought nothing — gets exactly the Wave-5.1 field.
//
// PRE-D64 (crooked ruler — the reading that justified the change; both columns
// were measured the same way, so the STEP it establishes stands even though the
// figures do not). 40 seeds, 100% pace, race 3:
//
//   player kart      before            after
//   stock  x0/x8     3.90 / 3.40       bit-identical (the field is still tier 2)
//   tier-2 x0        1.10, 36/40 wins  2.10, 8/40 wins
//   tier-2 x8        1.00, 40/40       1.18, 34/40 wins
//   tier-3 x0/x8     1.00, 40/40       1.00, 40/40 (the field is capped at 3)
//
// HONEST (D67): this scaling is one of the claims that SURVIVED the re-measure
// essentially bit-for-bit — the shipped tier-2 x0 cell reads 2.15 with 7 wins in
// 40 against the 2.10 / 8 recorded above. What did move is the stock reference
// beside it: race 3 stock is 4.10-4.38 over five 40-seed sets, not 3.90, so
// every "race 3 is the exemplar" statement written against 3.90 was written
// against a number that was too kind.
//
// WAVE 6.1 — RACE 2'S FIELD WAS MEASURED AGAINST SCALING WITH THE CHILD, AND
// DELIBERATELY LEFT FLAT. Race 2 runs tier 1 whatever the child is driving, and
// the obvious symmetry — have it MATCH the child the way the finale runs one
// tier above them, `max(1, min(playerPartTier, 2))` — was built, measured on the
// honest instrument (D64) and REJECTED. It is not a tuning miss; it is the wrong
// sign, and the numbers are here so nobody has to re-derive them.
//
// Measured, 100% pace, no quiz answers, five DISJOINT 40-seed sets (200 seeds),
// mean finishing place out of 8:
//
//   cell                         flat tier 1 (ships)   match-the-child   delta
//   race 2, stock                3.88/3.75/3.75/3.85/3.80   BIT-IDENTICAL  0
//   race 2, uniform tier-2       2.12  (2.08..2.25)    3.11 (3.03..3.20)  +0.99
//   race 2, uniform tier-3       1.47, 107/200 wins    2.14, 32/200 wins  +0.67
//   race 3, uniform tier-2       2.22  (unchanged — the finale is untouched)
//
// WHY IT IS THE WRONG SIGN. The complaint it was built for is that the upgraded
// championship is FLAT: race 3 minus race 2 for a tier-2 kart is +0.09 places
// (per set +0.08/-0.15/-0.05/+0.13/+0.48), so the ladder does not escalate on the
// axis the garage sits on. Matching the child can only make race 2 HARDER, and
// race 3 is already capped at PART_TIERS' top tier — so the same gap goes to
// -0.90 (per set -0.88/-1.08/-0.90/-0.73/-0.90): a flat rung becomes an inverted
// one. Over all 66 garages a two-visit championship can actually build, the mean
// race3-race2 gap goes +0.15 -> -0.22, and the number of garages for which race 3
// is the harder race falls from 37/66 to 23/66.
//
// AND IT COSTS THE THING RACE 2 IS FOR. Race 2 is the race the GARAGE wins
// (tests/ai.test.mjs section 2b, and the token economy pays out for it): a tier-2
// kart is worth 1.80 places over stock there today, and 0.85 with the field
// matched — the upgrade stops being worth buying. The best garage two visits can
// reach reads 1.93 today and 2.90 matched, and a fully-spent garage's race-2 win
// rate falls from 43% to 10%.
//
// AND IT BREAKS D33. The field steps a whole tier the moment the child's engine
// or turbo reaches 2, but on `circuit` TYRES are the fastest part (stock 54.37s
// -> tyres-3 52.67s, engine-3 53.32s, turbo-3 53.34s, frame flat) and
// `playerPartTier` deliberately cannot see them (D58). So a child with tyres
// bought first who then buys an engine crosses the threshold for a part that
// barely pays: over the 240 one-purchase steps a championship can make, the worst
// "bought a part, finished WORSE" step goes +0.23 -> +0.85 places, with 3 steps
// over half a place where there are none today. Counting tyres in a RACE-2-ONLY
// signal (max of engine/turbo/tyres, the three parts that pay on circuit) fixes
// that half of it — worst step +0.42, no step over half a place — but makes race 2
// harder still (mean over the 66 reachable garages 3.22 -> 3.71) and the ladder
// worse (-0.35). Both variants are measured in full in the Wave 6.1 report.
//
// If this is ever revisited: the lever that makes the ladder REAL is race 3 or
// the tracks' own pace, not race 2's field, and tests/ai.test.mjs section 3c
// pins the contract below so a change to it cannot land silently.
export const aiPartTier = (d01, playerTier = 0) => {
  const base = clamp(Math.round(2 * difficulty01(d01)), 0, 2);
  return difficulty01(d01) >= 1 ? Math.max(base, clamp(Math.round(playerTier) + 1, 0, 3)) : base;
};

// THE CHILD'S OWN KART TIER, as the finale reads it — and why it is the best of
// the SPEED parts rather than the best, or the mean, of all four.
// ---------------------------------------------------------------------------
// This number decides ONE thing: whether the finale's field steps from tier 2 to
// tier 3 (aiPartTier above). That step is worth a full finishing place, so where
// the threshold sits is a fairness question, not a tuning one — D33: a child who
// buys a better part and finishes WORSE notices, and resents it.
//
// TWO measured facts set the answer.
//
// 1. WHAT A CHILD CAN ACTUALLY OWN. A garage visit builds ONE part (scenes.js:
//    `parts[slot] = tier`, one slot per visit) and there are exactly TWO visits
//    before the finale — the results screen after race 1 and after race 2. So at
//    race 3 at most TWO of the four slots are non-zero, and `parts` is reset by
//    resetChampionship(). Every uniform-tier kart the gate talks about (all-tier-2,
//    all-tier-3) is UNREACHABLE in a real championship; the real garage is
//    lopsided by construction, which is exactly the case an aggregator has to get
//    right.
// 2. WHAT THE FOUR SLOTS ARE WORTH ON `cloud`. Autopilot lap time, one kart, no
//    traffic (.tmp/w6a2-lap.mjs):
//
//      slot    stock   tier 1   tier 2   tier 3
//      engine  48.07   47.25    46.01    45.50
//      turbo   48.07   47.05    46.82    46.33
//      tyres   48.07   48.12    48.53    48.84    <- SLOWER
//      frame   48.07   48.30    47.92    47.98    <- flat
//
//    On the finale's geometry only the engine and the turbo make a kart quicker.
//    Tyres and frame are flat-to-negative there (they pay on `circuit`, where
//    tyre-3 is worth 1.66s), and that is a kartphysics/autopilot fact this file
//    cannot change — it is present at every field tier and predates Wave 6.
//
// So `max` over all four slots (round 1) made the field step up for a purchase
// that had given the child nothing.
//
// EVERY FINISHING-PLACE FIGURE IN THE REST OF THIS BLOCK IS PRE-D64 (crooked
// ruler); the lap-time table above is not (it is physics, and D64 did not touch
// it). They compare four AGGREGATORS against each other, all on the same seeds,
// so the ranking they establish — and the choice of `max(engine, turbo)` — is
// unaffected; the absolute places are not honest numbers and must not be set
// beside a post-D64 figure. The honest race-3 stock reference, for scale, is
// 4.10-4.38 rather than the 4.04 below (D67). Measured, race 3, 200 seeds
// (5 disjoint 40-seed sets), mean place with the resulting field:
//
//   single part only     stock   tier 1   tier 2   tier 3
//   max over 4 (round 1)  4.04    4.08     4.91     5.04   <- tyres: buying the
//   max(engine,turbo)     4.04    4.08     4.20     4.25      part costs a place
//   (frame, round 1)      4.04    3.98     4.79     4.89
//   (frame, now)          4.04    3.98     3.96     4.00
//
// Over all 120 one-purchase steps a child can actually make (<= 2 non-zero
// slots, 200 seeds), the worst "bought a part, finished worse" step is:
//
//   aggregator            worst step   steps > 0.5 places   walkover (best kart's
//                                                            wins per 200, x0)
//   none (Wave 5.1)          0.40             0                   198
//   max over 4 (round 1)     0.90             8                    94
//   floor-of-mean            0.40             0                   198  <- see below
//   max(engine, turbo)       0.42             0                    94
//
// i.e. this aggregator keeps round 1's whole D44 fix (the strongest reachable
// garage still wins under half its races unengaged, down from 99%) and gives back
// every one of the eight half-place-or-worse punishments, landing on the 0.40
// floor that the physics itself sets with no field scaling at all.
//
// FLOOR-OF-MEAN WAS MEASURED AND REJECTED. It steps at sum >= 8 over four slots,
// and the largest sum a child can reach in two visits is 6 — so it never fires in
// a real game, and the finale reverts to Wave 5.1 exactly: a kart with a tier-3
// engine and a tier-2 wing (two good prompts, entirely reachable) wins the finale
// 198 times in 200 with ZERO questions answered. It is monotone because it is
// inert. D44 is the gap it would reopen.
//
// The residual: engine tier 1 -> tier 2 reads 3.17 -> 3.31 (+0.14, ~1 SE at 200
// seeds) because that is the step that crosses the threshold. Moving the
// threshold to tier 3 makes it worse (2.35 -> 2.92, +0.57) and hands the finale
// back to a tier-2 engine. A discrete field tier cannot have no boundary; this is
// the smallest one available. Section 7c gates the property.
export const playerPartTier = parts => (parts
  ? clamp(Math.max(0, ...['engine', 'turbo'].map(k => Math.round(parts[k] ?? 0))), 0, 3)
  : 0);

// ---------------------------------------------------------------------------
// Rubber band. Two independent terms, summed, then hard-clamped:
//
//   PACK term    — where am I relative to the other seven? Keeps the AI field
//                  from stringing out into single file. Small (±5%), always on.
//   PLAYER term  — where am I relative to the human? Keeps the race around the
//                  kid. Asymmetric: slows a runaway leader harder than it
//                  speeds up a straggler.
//
// Two terms rather than one blended reference, because a single tanh
// saturates: when the whole field is behind a fast player every opponent pegs
// at maximum catch-up and the band silently stops doing its other job
// (measured: AI-only spread on oasis was 11.1s blended, 5.4s split).
//
// The bounds are what the fairness argument rests on:
//   * catch-up is capped so that base·(1+catch) stays BELOW the AI's own clean
//     flat-out at every difficulty — an opponent that is behind can never lap
//     faster than it would have on its own.
//   * hold-back is larger, because keeping a runaway leader in sight is what
//     saves a struggling 8-year-old, and driving slower can never make a race
//     unwinnable for anybody.
//
// CEILING vs FLOOR — and why the floor is now an ABSOLUTE PACE, not a percentage
// -----------------------------------------------------------------------------
// The CEILING (catch-up) is scaled down as the championship escalates: a race-3
// opponent is already running near its own flat-out, so there is very little
// headroom left above it and handing out +7.5% there would push it past the
// clean-lap cap the fairness argument rests on. Unchanged, still +7.5% max.
//
// The FLOOR (hold-back) is the ONLY thing standing between a struggling child
// and being lapped, and it has now been expressed as the thing it is actually
// promising: a floor on the opponent's EFFECTIVE PACE — BAND_FLOOR_PACE, 62% of
// its own clean flat-out — rather than a fixed -17% off whatever the base pace
// happens to be. A percentage floor silently changes meaning every time the base
// pace moves: Wave 1's -17% meant 0.677 effective at race 1 and 0.801 at race 3,
// which is exactly why a 70%-pace child was measured 1.04 laps down (LAPPED) on
// `cloud` and only 0.24 down on `oasis`. Wave 4 raises the base pace to ~1.00,
// which would have made that far worse. An absolute floor keeps the promise
// identical on all three races no matter what the pace above it does.
//
//   effective floor pace, per race (fraction of the AI's own clean flat-out)
//                       race 1   race 2   race 3
//   Wave 1 (-17%)        0.677    0.739    0.801     <- race 3 lapped a child
//   Wave 4 (absolute)    0.620    0.620    0.620
//
// PRE-D64 (crooked ruler; both columns measured the same way, so the before/
// after the floor establishes stands). 3-lap races, autopilot player with
// topSpeed+accel scaled to `pace`, 5 seeds, laps behind the winner when the
// winner finishes (>= 1.00 = lapped):
//
//                race 1 (oasis)  race 2 (circuit)  race 3 (cloud)
//   70% pace     0.24 -> 0.17     0.25 -> 0.15      0.61 -> 0.20   (before/after)
//   85% pace     0.03 -> 0.10     0.09 -> 0.09      0.15 -> 0.10
//
// and the worst distance to the NEAREST opponent at 70% pace fell from 0.41 laps
// to 0.08 — a struggling child is now inside the pack, not alone on an empty
// track, which is what the floor is for.
//
// HONEST (D67): the guarantee is one of the claims that survived the re-measure
// unchanged — a 70%-pace child is worst 0.11 / 0.14 / 0.21 laps down and was
// lapped 0 times in 600 races.
//
// Do not "fix" a future never-lapped gap by widening BAND_CATCH — an unbounded
// catch-up is the thing kids notice and resent, and it is capped so an opponent
// that is behind can never lap faster than its own clean flat-out.
// tests/ai.test.mjs pins the bound, the floor and the guarantee.
export const BAND_CATCH = 0.075;      // hard ceiling: +7.5% on target speed
export const BAND_HOLD = 0.170;       // minimum hold-back authority (see below)
export const BAND_FLOOR_PACE = 0.62;  // hard floor on effective pace
const bandCatchMax = d01 => BAND_CATCH * (1 - 0.30 * d01);
// Hold-back authority for a given base pace: enough to reach the absolute floor,
// and never less than the Wave-1 percentage.
const bandHoldMax = base => Math.max(BAND_HOLD, 1 - BAND_FLOOR_PACE / Math.max(base, 0.1));
const packCatchMax = d01 => 0.026 * (1 - 0.30 * d01);
const packHoldMax = () => 0.034;                   // difficulty-independent
// Seconds of gap at which each term is ~76% saturated. The pack is tight, so
// its term has to react over a much shorter gap than the player's.
const BAND_TAU = 6.0;
const PACK_TAU = 2.5;
// WAVE 6: two PER-RACE scalings of the band, and why they are shaped this way.
// ---------------------------------------------------------------------------
// The playtest verdict was that race 3 on a stock kart is the exemplar — the
// player is inside the pack the whole way — while races 1-2 read as cruising
// alone. Measured on the gate's own harness (40 seeds, 100% pace, stock kart),
// the metric that separates them is not the nearest-kart gap (every race is
// under a second) but how much of the race the player spends IN FRONT of
// everybody: pre-D64 that read race 1 46%, race 2 2.0%, race 3 3.1%; honest,
// over five 40-seed sets, it reads 45.6-55.9 / 2.2-3.6 / 1.6-4.9 (D67 and
// tests/ai.test.mjs §2c). The diagnosis is the same on either ruler — race 1 is
// the outlier by an order of magnitude — which is why these two scalings stay.
//
// So this is a race-1 problem plus a race-2 "the leaders are up the road in a
// different race" problem, and both are fixed by scaling terms that ALREADY
// exist. Both scalings are written so that they are EXACTLY 1 at d01 = 1
// (a multiplication by a term that is exactly zero there), which is what makes
// the finale bit-identical to Wave 5.1 on a stock kart.
//
//  1. HOLD REACH, race 1 only. Race 1's field is deliberately sloppy (most
//     mistakes, lowest skill) and its catch-up is already pinned at the
//     BAND_CATCH ceiling, so the only honest way to put opponents in front of a
//     clean child was to raise TRACK_PACE.oasis (1.03 -> 1.09, see above). That
//     alone costs D33b's struggling-child ladder — an 85%-pace child slid from
//     4.0 to 5.0 on race 1, because partial hold-back is a fraction of a base
//     pace that just went up. Halving the hold term's TIME CONSTANT on race 1
//     (not its authority, and not the floor) makes the same hold-back arrive at
//     half the gap, and puts the 85% ladder back where it was (recorded pre-D64
//     as 4.0 / 5.2 / 6.2; the honest re-measure reads 4.00 / 5.00 / 6.00 and
//     D67 lists the struggling-child ladder among the claims that survived).
//  2. FORWARD SLOT, race 2 only. Race 2's two front-runners sat at +2.06s and
//     +0.83s, which is a separate race up the road: the player was 2.73s off the
//     win with no way to see it. Compressing race 2's forward slots to 0.65 puts
//     them at the finale's own +1.63s / +0.65s spacing. Measured PRE-D64 (both
//     sides on the same ruler): time behind the winner 2.73s -> 2.02s, a rival
//     within 1.5s ahead 89.7% -> 93.4% of the race, an engaged stock kart's
//     podium rate 16/40 -> 23/40, and the 3rd-4th finish target untouched at
//     3.67 with zero wins in 40. HONEST, shipped build only (D67): race 2 stock
//     finishes 3.73-3.90 with 0 wins in 200 — still dead centre of its 3rd-4th
//     ask, the most stable claim in the file — sits 1.98-2.12s behind the winner
//     and has a rival within 1.5s ahead for 92.6-94.3% of the race. The
//     distance-to-the-front axis is what this scaling still earns its place on;
//     race 2 no longer trails the exemplar on `ahead<=1.5s` at all.
const HOLD_REACH_R1 = 0.5;
const holdReach = d01 => 1 - (1 - HOLD_REACH_R1) * Math.max(0, 1 - 2 * d01);
const SLOT_FWD_R2 = 0.65;
const slotFwd = d01 => 1 - (1 - SLOT_FWD_R2) * Math.max(0, 1 - 2 * Math.abs(d01 - 0.5));
const slotCompress = d01 => (1 - 0.35 * d01);
// Each opponent aims to run a few seconds AHEAD OF or BEHIND the human rather
// than exactly alongside — otherwise the player term bunches all seven onto the
// player's gearbox and the race becomes a rolling roadblock. The spread is
// biased backwards (+3s to -11s) so that a good kid is still racing for the
// win, not for fourth. Scaled down as the championship escalates.
const SLOT_AHEAD = [2.5, 1, -0.5, -2, -3.5, -5, -6.5];

// THIS TABLE, NOT PACE, IS WHAT DECIDES A STRUGGLING CHILD'S FINISHING PLACE.
// -------------------------------------------------------------------------
// Once a player drops below the field's own speed the hold-back floor gathers
// everybody around them, and the order is then settled by how many opponents
// are AIMING to sit behind the player — two of them, at every difficulty, which
// is why Wave 4 shipped a championship that read 6th -> 6th -> 6th to an
// 85%-pace child. Measured: dropping the race-1 catch-up ceiling to zero moved
// that 6.0 by nothing at all, and widening the field's internal pace spread by
// 3x moved it to 5.6. The slot table moved it to 4.0.
//
// So the backward half of the table is STRETCHED at low difficulty: on race 1
// four or five opponents are racing for the places behind the player, and by
// race 3 only the original two are. The forward slots (+2.5s, +1s) are left
// alone at every difficulty — they are what keeps a clean 100% driver fighting
// for the win rather than handed it.
//
//   PRE-D64 (crooked ruler, and only 11 seeds — a direction, not a figure;
//   both columns measured the same way, and the 85% row is what the table was
//   chosen on):
//   mean place, autopilot player, 11 seeds      race 1   race 2   race 3
//   100% pace   before / after                  2.2/2.5  3.8/3.1  3.8/3.8
//    85% pace   before / after                  6.0/4.1  6.0/5.0  6.2/6.1
//
//   HONEST, shipped only (D67): the 85% ladder is 4.00 / 5.00 / 6.00 and the
//   100% one 2.43-2.55 / 3.73-3.90 / 4.10-4.38. The struggling child no longer
//   reads 6th on every race, which is the whole point of the stretch.
//
// The falloff is squared so race 2 keeps most of the escalation: the stretch is
// 1.8x at d01 = 0, 1.2x at d01 = 0.5 and 1.0x (i.e. Wave-1 behaviour) at d01 = 1.
const SLOT_STRETCH_EASY = 1.8;
const slotStretch = d01 => 1 + (SLOT_STRETCH_EASY - 1) * (1 - d01) * (1 - d01);

// ===========================================================================
// 4. AIDriver
// ===========================================================================

const NO_INPUT = { throttle: 0, brake: 0, steer: 0, drift: false, hop: false };

// ---------------------------------------------------------------------------
// ProgressTracker — the ONE way a kart's race progress is accumulated (D64).
// Every accumulator in the game is an instance of this: the seven opponents get
// theirs from AIDriver, and race.js builds the player's from the same class, so
// there is exactly one definition of "how far round the lap is this kart".
//
// Progress is `laps + fraction past def.startT`, integrated from the kart's
// centreline projection `body.lapT`. Two things make the raw integral lie, and
// both are fixed here rather than in five copies of the same three lines:
//
// 1. PROJECTION SNAPS. `TrackSpline.closestT()` is a GLOBAL nearest-sample
//    lookup (its `hintT` argument is declared and never read). A kart that runs
//    wide — off the road, or across the neck of a hairpin — can have its nearest
//    centreline sample flip to a different branch of the lap, and `lapT` then
//    jumps discontinuously. Integrated raw, that jump is FREE PROGRESS.
//    Measured before this guard, over 3 tracks x 4 seeds: worst single step
//    +13.67 m of progress for 0.29 m actually travelled (cloud/19, kart
//    'plada', 13.0 m off a 9.3 m half-width), and every one of the 12
//    net-nonzero events was a GAIN, up to +10.23 m for one kart over one race.
//    Progress is an accumulator, so that credit is permanent.
// 2. TELEPORTS. `respawn()` / `placeAt()` move the kart without driving it.
//    Those must be absorbed, never integrated.
//
// THE GUARD: a step may not advance progress by more than the kart could
// physically have covered.
//
//     cap = ground * (1 + PROGRESS_ARC_EPS) + quantisation floor
//
// where `ground` is the larger of the measured horizontal displacement and
// `speed * dt` over the SAME interval `lapT` moved across (see step()).
//
// WHY AN EPS AT ALL, AND WHICH DIRECTION IS REAL. Centreline arc and ground
// distance are not equal: on the INSIDE of a corner of radius R, a kart at
// lateral offset L sweeps the same angle on radius R-L, so it covers R/(R-L)
// times its own ground distance in CENTRELINE ARC. That is the one direction an
// upper bound has to allow for — on the OUTSIDE it covers less, and a cap never
// cares about less. The tightest corner in the game is circuit's first hairpin,
// R = 18.8 m (oasis 29.4 m, cloud 33.6 m); at the inside edge of its 8 m
// half-width the honest factor is 18.8/14.8 = 1.27. EPS = 0.60 (cap factor
// 1.60) leaves 26% over that worst case, which also absorbs the residual
// mismatch between a step's displacement and its slightly-stale speed.
//
// WHY AN ADDITIVE FLOOR, AND WHY IT IS THE SAMPLE SPACING. `closestT()` refines
// onto the segment [i, i+1] of the arc-length table and CLAMPS the parameter to
// [0, 1], so a kart sitting just behind sample i reads exactly t = i/N until it
// passes the sample. `lapT` is therefore a slight staircase with a tread of one
// sample spacing (0.826 m on oasis, 0.845 circuit, 0.855 cloud), and a single
// step's arc delta can legitimately carry up to about half a tread of catch-up.
// A pure multiplicative cap sits INSIDE that noise (at 20 m/s, 1.6 x 0.33 m =
// 0.53 m) and misfires on 13% of all steps, bleeding ~0.06 m each. Measured
// unguarded over 892,800 steps (3 tracks x 4 seeds x 8 karts), the excess
// |arc step| - 1.6 x ground runs to 0.4 m of quantisation noise and then stops:
// 50 steps exceed 0.40 m, 31 exceed 0.60 m, and those 31 are the projection
// snaps themselves (0.83 m to 16.4 m). The floor is set at 0.72 of a sample
// spacing (0.60 m here) — above all the noise, below every real snap.
//
// SENSITIVITY, stated the way the gate's 0.06 m tie tolerance is: the guard
// rejects any single step that gifts more than ~0.60 m of arc beyond what the
// kart could physically cover — 0.93 m of progress in one 1/60 s step at
// 20 m/s. It fires 31 times in 892,800 steps of clean racing.
//
// NEVER FREEZES. When the cap bites the step is not dropped — it is replaced by
// the kart's own along-track displacement (Δposition · tangent), clamped to the
// cap. So a kart whose projection is misbehaving keeps making the progress it
// is really making, in the right direction. Every bite is COUNTED
// (`.clamps`, `.clampedM`) and surfaced through `field.telemetry()`, so a
// mis-firing guard is observable instead of silent.
//
// AND IT HEALS — WHICH IS WHERE ON-TRACK vs OFF-TRACK MATTERS.
// A cap on its own trades one bias for the mirror image of it. The snaps
// measured here are not transient: a kart 12-15 m off the road in a corner has
// its projection jump 1.6-4.1 m forward and STAY there, so a pure cap leaves
// that kart's progress permanently BEHIND its own projection — up to -6.60 m on
// oasis/3 — and the child then sees it ranked behind karts it is visibly
// alongside. That is the same lie with the sign flipped.
//
// The way out is to notice WHEN the projection can be trusted. On the road it
// is unambiguous: the nearest centreline branch is tens of metres from any
// other (the tightest hairpin puts its two sides 37 m apart against a 16 m
// road), so `lapT` IS the kart's arc position and "equal progress == physically
// abreast" must hold exactly. Off the road it is a global nearest-sample lookup
// with nothing to keep it on the branch the kart came from, and it snaps.
//
// So: while the kart is ON TRACK and the step was clean, progress is set
// exactly to the projection — there is no residual to see, ever, and the
// ranking the child reads is the ranking on the tarmac. While the kart is OFF
// TRACK, progress converges toward the projection at no more than
// PROGRESS_REANCHOR_MPS (a thirteenth of racing speed): a snap cannot flip
// anyone's place in one frame, and nothing can be banked, because the moment
// the kart touches the road again the accumulator is simply the truth.
// Measured over 113,749 steps x 12 cells with this in: every pair of ON-TRACK
// karts is ordered correctly, worst error 0.000 m, and no on-track kart's
// progress differs from its projection at all. The 140 remaining
// order-vs-projection disagreements ALL involve a kart that is off the road at
// that instant, where the projection is the thing that is lying — that is
// `closestT()`'s ignored `hintT`, and it belongs to trackdef.js.
export const PROGRESS_ARC_EPS = 0.60;
// Fraction of one arc-length-table sample spacing allowed as additive slack.
export const PROGRESS_FLOOR_SAMPLES = 0.72;
// Metres/second of allowed convergence toward the projection while the kart is
// OFF the road. On the road the convergence is immediate — see the header.
export const PROGRESS_REANCHOR_MPS = 1.5;
// An offset bigger than this is not a projection snap — it is a lost lap or a
// broken accumulator. Don't quietly heal it; count it (`.faults`) and leave it
// visible.
export const PROGRESS_REANCHOR_MAX_M = 40;
// A kart that trips the guard this many times in one race is not "running wide
// occasionally" — something is wrong with its projection or its physics. Warn
// once, loudly, rather than quietly clamping forever.
const CLAMP_WARN_AT = 240;

const _tmpTan = new THREE.Vector3();

export class ProgressTracker {
  /**
   * @param {TrackSpline} spline
   * @param {KartBody} body   seeded from where this body is standing RIGHT NOW
   * @param {number} startT   the start/finish line t. progress 0 == on the line.
   */
  constructor(spline, body, startT = 0) {
    this.spline = spline;
    this.lapLen = spline.length;
    // Additive slack: the `lapT` staircase tread (see the header).
    this.floorM = PROGRESS_FLOOR_SAMPLES * spline.length / (spline.N || 1400);
    this.startT = startT;
    this.value = TrackSpline.deltaT(body.lapT, startT);
    this.clamps = 0;
    this.clampedM = 0;
    this.healedM = 0;      // metres re-anchored back onto a trusted projection
    this.faults = 0;       // offsets too big to be a snap — see the header
    this._warned = false;
    this.resync(body);
  }

  /** Absorb a teleport (respawn / placeAt): re-anchor without integrating. */
  resync(body) {
    this._prevT = body.lapT;
    this._px = this._qx = body.position.x;
    this._pz = this._qz = body.position.z;
    this._prevSpeed = 0;
  }

  /**
   * Integrate one fixed step. Call AFTER `body.update()`, so that every kart's
   * progress describes the same instant (see the phase note in createAIField).
   * @returns {number} the metres of arc actually credited (signed).
   */
  step(dt, body) {
    const t = body.lapT;
    const raw = TrackSpline.deltaT(t, this._prevT) * this.lapLen;
    // THE GROUND DISTANCE MUST COVER THE SAME INTERVAL AS `raw`, and that is
    // NOT the step just taken. `KartBody.update` samples `lapT` at its TOP,
    // from the position the kart held at the end of the previous step, and only
    // integrates afterwards — so `lapT` lags `position` by exactly one step.
    // The honest ground distance for `raw` is therefore the one between the
    // PREVIOUS TWO position snapshots, with the speed recorded alongside them.
    // (Pairing `raw` with the current step's displacement instead makes the
    // guard fire ~2600 times a race on the standing start alone, where the
    // grid's collision shoves and the acceleration ramp put the two intervals
    // an order of magnitude apart.)
    const dx = this._px - this._qx, dz = this._pz - this._qz;
    const ground = Math.max(Math.hypot(dx, dz), Math.abs(this._prevSpeed || 0) * dt);
    const cap = ground * (1 + PROGRESS_ARC_EPS) + this.floorM;
    let use = raw, clamped = false;
    if (!(Math.abs(raw) <= cap)) {           // NaN-safe: an unusable raw also lands here
      clamped = true;
      const tan = this.spline.tangentAt(this._prevT, _tmpTan);
      const along = dx * tan.x + dz * tan.z;
      use = Math.max(-cap, Math.min(cap, Number.isFinite(along) ? along : 0));
      this.clamps++;
      this.clampedM += Math.abs((Number.isFinite(raw) ? raw : 0) - use);
      if (this.clamps === CLAMP_WARN_AT && !this._warned) {
        this._warned = true;
        console.warn(`ProgressTracker: ${CLAMP_WARN_AT} clamped steps ` +
          `(${this.clampedM.toFixed(1)} m of bogus arc rejected) — the centreline ` +
          'projection or the physics for this kart is misbehaving.');
      }
    }
    this.value += use / this.lapLen;

    // ---- converge onto the projection ------------------------------------
    // `deltaT` reduces the difference to the nearest half-lap, so `err` is the
    // signed offset, in metres, between the accumulator and where this kart's
    // centreline projection says it actually is. ON THE ROAD that projection is
    // the truth and the offset is taken out in full; OFF the road it is only
    // approached, at a rate no snap can ride. See the header.
    if (!clamped && Number.isFinite(t)) {
      const err = TrackSpline.deltaT(t - this.startT, this.value) * this.lapLen;
      if (Math.abs(err) > PROGRESS_REANCHOR_MAX_M) this.faults++;
      else if (err !== 0) {
        const lim = body.offTrack ? PROGRESS_REANCHOR_MPS * dt : Math.abs(err);
        const corr = Math.max(-lim, Math.min(lim, err));
        this.value += corr / this.lapLen;
        this.healedM += Math.abs(corr);
      }
    }

    this._prevT = t;
    this._qx = this._px; this._qz = this._pz;
    this._px = body.position.x; this._pz = body.position.z;
    this._prevSpeed = body.speed || 0;
    return use;
  }
}

export class AIDriver {
  /**
   * @param {object} o
   *   body        KartBody to drive (required)
   *   spline      TrackSpline (required)
   *   racer       ROSTER entry (for personality + identity)
   *   personality override for racer.personality
   *   seed        integer seed for this driver's rng
   *   difficulty  race number 1..3 or 0..1 fraction
   *   pace        optional hard pace override (used by the test's scripted
   *               player and by preview stand-ins); disables the rubber band.
   *   startT      the track's start/finish line t (def.startT). Progress is
   *               measured FROM it, so a grid slot behind the line seeds a
   *               small negative progress. Defaults to 0 — a caller that
   *               passes neither startT nor a def still works, it just uses
   *               t = 0 as its origin.
   */
  constructor(o = {}) {
    this.body = o.body;
    this.spline = o.spline || this.body?.spline;
    if (!this.body || !this.spline) throw new Error('AIDriver needs a body and a spline');
    this.racer = o.racer || ROSTER[0];
    this.name = this.racer.nameEn || this.racer.id;
    this.personality = o.personality || this.racer.personality || 'balanced';
    this.P = o.persona ? { ...persona(this.personality), ...o.persona } : persona(this.personality);
    this.rng = makeRng((o.seed ?? 1) * 7919 + 13);
    this.d01 = difficulty01(o.difficulty);
    // Per-geometry pace calibration, handed down by createAIField (which is the
    // only thing that knows which track def this spline belongs to).
    this.trackPace = o.trackPace ?? 1;

    this.line = racingLine(this.spline);
    this.paceOverride = o.pace ?? null;
    this.banded = o.pace == null && o.rubberBand !== false;

    // Per-kart speed profile from its own grip and brakes. A heavy low-grip
    // kart genuinely has to go slower through the hairpin than a nimble one.
    this.rebuildProfile();

    // --- driving state ----------------------------------------------------
    this.time = 0;
    this.dev = 0;              // smoothed lateral deviation from the line (m)
    this.devTarget = 0;
    this.band = 1;             // rubber-band multiplier, smoothed
    this.pace = 1;
    // Progress ORIGIN is the start/finish line, not "wherever this kart was
    // constructed". gridSlots() parks row r 4..22 m BEHIND the line, so a kart
    // seeded at 0 carried a permanent free-metres credit in every progress
    // comparison (order(), _rankPass, race positions, the band's gap terms).
    // Seeding with the signed arc offset from startT makes progress == 0 mean
    // "on the line" and equal progress mean physically abreast. See D58.
    // Accumulated by `commitProgress(dt)`, which the field calls AFTER this
    // kart's body has been stepped — never inside update(), which runs BEFORE
    // it. See the phase note in createAIField.update.
    this.startT = o.startT ?? 0;
    this._prog = new ProgressTracker(this.spline, this.body, this.startT);
    this._passSide = 0;
    this._passHold = 0;
    this._blockT = 0;
    this._mistakeIn = this.rng.range(2, this.P.mistakeEvery);
    this._mistake = null;
    this._wobPhase = [this.rng.range(0, 6.3), this.rng.range(0, 6.3)];
    this._wobFreq = [this.rng.range(0.5, 0.9), this.rng.range(1.4, 2.2)];
    this._wavePhase = this.rng.range(0, 6.3);
    this._prevRadius = 999;
    this.slotAhead = 0;          // seconds ahead of the player this kart aims for
    this._driftGoal = 1;
    this.input = { throttle: 1, brake: 0, steer: 0, drift: false, hop: false };

    // --- telemetry --------------------------------------------------------
    this.stats = {
      driftTime: 0, driftBoosts: 0, cornerEntrySum: 0, cornerEntryN: 0,
      overtakes: 0, mistakes: 0, offTrackTime: 0, bandMax: 1, bandMin: 1,
      throttleTime: 0, brakeTime: 0, blockTime: 0,
    };
  }

  /**
   * Laps + fraction past the start/finish line. 0 means ON the line; a kart on
   * the grid is a small negative number. Backed by a guarded accumulator; the
   * setter exists so a test can re-seed it.
   */
  get progress() { return this._prog.value; }
  set progress(v) { this._prog.value = v; }

  /**
   * Integrate this kart's progress for the step just taken. MUST be called
   * after `this.body.update()`, so `order()` compares end-of-step against
   * end-of-step. Returns the metres of arc credited.
   */
  commitProgress(dt) { return this._prog.step(dt, this.body); }

  /** Absorb a respawn/teleport of this kart's body without integrating it. */
  resyncProgress() { this._prog.resync(this.body); }

  /** Rebuilds the target-speed table (call after a parts change). */
  rebuildProfile() {
    const p = this.body.p;
    const P = this.P;
    // Confidence: how much of the real grip circle the AI dares to use. Under
    // 1.0 by design — the margin is where "beatable" lives.
    const skill = 0.86 + 0.12 * this.d01;
    // DRIFT_GRIP is in here on purpose. In this physics a drifting kart has 20%
    // more lateral bite AND a tenth of the sideways scrub, so a fast lap is a
    // nearly continuous drift (the reference autopilot drifts 86% of a lap and
    // laps oasis in 46.7s). A profile built on static grip has the AI braking
    // away the very advantage its own drift is generating — measured at 10%
    // slower than the dumb centreline autopilot before this line was fixed.
    this.baseMu = p.grip * DRIFT_GRIP * P.mu * skill;
    // Assumed braking deceleration. The physics gives ~17 m/s²; assuming less
    // means braking earlier. `brakeEarly` is the whole personality of a corner
    // entry: 1.26 (steady) brakes a car length sooner than 0.74 (aggressive).
    this.brakeA = 17.0 / P.brakeEarly * 0.62;
    this.profile = speedProfile(this.line, {
      mu: this.baseMu, brakeA: this.brakeA, vmax: p.topSpeed * 1.02,
    });
  }

  /** Target speed (m/s) the driver is aiming for right now, before the band. */
  targetSpeedAt(t, v) {
    // Read the profile slightly up the road: reaction time + a personality
    // margin. This is what makes a `steady` driver settle its braking a beat
    // before an `aggressive` one.
    const lead = v * 0.42 * this.P.brakeEarly;
    const i = nodeAt(this.line, t + lead / this.line.length);
    let vt = this.profile[i];
    // Also respect the next couple of nodes, so a very short apex is not
    // stepped over between frames.
    const j = (i + 1) % this.line.N;
    if (this.profile[j] < vt) vt = this.profile[j];
    return vt;
  }

  // -------------------------------------------------------------------------
  // Main step: returns the input object. Does NOT step the body — the field
  // (or the race scene) does that, so collisions can be resolved in one place.
  // -------------------------------------------------------------------------
  update(dt, ctx = {}) {
    const b = this.body, sp = this.spline, L = this.line, P = this.P;
    this.time += dt;
    const v = Math.max(b.speed, 0.001);
    const t = b.lapT;

    // NOTE: progress is NOT accumulated here. This method runs BEFORE
    // `body.update()` moves the kart, so anything integrated here would
    // describe the START of the step while the player's accumulator (folded in
    // by the field from an already-stepped body) describes the END of it — a
    // systematic ~0.3 m/frame gift to the player in every order() comparison.
    // The field calls `commitProgress(dt)` after the bodies move instead.

    // ---- pace ------------------------------------------------------------
    const wave = 1 + P.paceWave * Math.sin(this.time * (P.waveHz ?? 0.42) + this._wavePhase);
    if (this.paceOverride != null) this.pace = this.paceOverride * wave;
    else this.pace = this.basePace() * P.pace * this.racerPace() * wave * this.band;

    // ---- mistakes ---------------------------------------------------------
    this._tickMistakes(dt);

    // ---- traffic ----------------------------------------------------------
    const traffic = this._traffic(dt, ctx);

    // ---- lateral deviation from the racing line ---------------------------
    let dev = traffic.dev + this._tokenPull(ctx) + (this._mistake?.lat || 0);
    if (this._blockT > 0) dev += traffic.blockDev;
    this.devTarget = clamp(dev, -6, 6);
    // Rate-limited: the deviation is a driver deciding to move, not a warp.
    this.dev = damp(this.dev, this.devTarget, 2.6, dt);

    // ---- steering: pure pursuit onto the line -----------------------------
    // Pure-pursuit lookahead. Long on a straight (smooth, no slalom), SHORT in
    // a tight corner — a fixed long lookahead chords across the apex, which
    // makes the kart cut in early and then run out of road on the exit. This
    // one term was worth ~9% of the off-track time.
    const tight = clamp(lineRadiusAt(L, t + 10 / L.length) / 130, 0.42, 1);
    const look = clamp(6.0 + v * 0.55 * tight, 6.5, 24) * (this.personality === 'aggressive' ? 0.95 : 1);
    const aimT = t + look / L.length;
    const halfW = sp.widthAt(aimT);
    const aimOff = clamp(lineOffsetAt(L, aimT) + this.dev, -(halfW - 0.6), halfW - 0.6);
    const aim = sp.offsetPoint(aimT, aimOff);

    // Steer relative to where we are TRAVELLING, not where the nose points —
    // while drifting the nose carries a big rendered lean and chasing it makes
    // the controller fight its own drift. (Same reasoning as autopilotInput.)
    let fx = b.forward.x, fz = b.forward.z;
    if (b.drifting && v > 4) {
      const m = Math.hypot(b.velocity.x, b.velocity.z) || 1;
      fx = b.velocity.x / m; fz = b.velocity.z / m;
    }
    const dx = aim.x - b.position.x, dz = aim.z - b.position.z;
    const cross = fx * dz - fz * dx, dot = fx * dx + fz * dz;
    const alpha = -Math.atan2(cross, dot);
    const dist = Math.max(Math.hypot(dx, dz), 1);
    const kappa = 2 * Math.sin(clamp(alpha, -1.4, 1.4)) / dist;
    const lock = b.steerLock ?? 1;
    let steer = clamp((kappa * v) / (2.55 * Math.max(lock, 0.08)), -1, 1);

    // Hand wobble. Two slow sines, not noise: a human's correction has a
    // frequency, and white noise at 60Hz just reads as a broken servo.
    const wob = P.wobble * (1.25 - 0.5 * this.d01) *
      (Math.sin(this.time * this._wobFreq[0] * 6.283 + this._wobPhase[0]) * 0.6 +
       Math.sin(this.time * this._wobFreq[1] * 6.283 + this._wobPhase[1]) * 0.4);
    steer = clamp(steer + wob + (this._mistake?.steer || 0), -1, 1);

    // ---- speed control ----------------------------------------------------
    let vt = this.targetSpeedAt(t, v) * this.pace * (this._mistake?.speed || 1);
    vt *= traffic.speedMul;
    let throttle = 1, brake = 0;
    const over = v - vt;
    if (over > 1.1) { throttle = 0; brake = clamp(0.45 + over * 0.22, 0, 1); }
    else if (over > 0) { throttle = clamp(0.35 - over * 0.3, 0, 0.35); }
    // Never coast to a stop: if something has gone wrong and we are crawling,
    // drive. This is the only "assist" in the file and it exists so a shunted
    // kart rejoins instead of sulking in the sand.
    if (v < 6 && !b.airborne) { throttle = 1; brake = 0; }

    // ---- drift ------------------------------------------------------------
    const drift = this._drift(dt, v, t, steer);
    if (drift.steer != null) steer = drift.steer;

    // ---- telemetry --------------------------------------------------------
    const R = lineRadiusAt(L, t + (v * 0.35) / L.length);
    if (this._prevRadius > 70 && R <= 70) { this.stats.cornerEntrySum += v; this.stats.cornerEntryN++; }
    this._prevRadius = R;
    if (b.drifting) this.stats.driftTime += dt;
    if (b.offTrack) this.stats.offTrackTime += dt;
    if (throttle > 0.5) this.stats.throttleTime += dt;
    if (brake > 0.1) this.stats.brakeTime += dt;

    const inp = this.input;
    inp.throttle = throttle; inp.brake = brake; inp.steer = steer;
    inp.drift = drift.want; inp.hop = false;
    return inp;
  }

  /**
   * This driver's un-banded pace: difficulty pace x the track calibration. The
   * band is expressed as a multiplier ON THIS, and the never-lapped floor is an
   * absolute pace, so both are meaningless without it.
   */
  basePace() { return paceForDifficulty(this.d01) * this.trackPace; }

  /** Lowest band multiplier this driver can ever reach (the absolute floor). */
  bandFloor() { return 1 - bandHoldMax(this.basePace()); }

  /**
   * Small fixed per-racer pace offset so the field is not eight clones. This is
   * an OPPONENT's own character; the player's kart choice is corrected for
   * elsewhere and once, by kartPace() feeding `trackPace`.
   */
  racerPace() {
    if (this._racerPace == null) {
      const r = makeRng(1 + (this.racer.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0));
      // ±4%: wider than the pack band can erase, so the field keeps a real
      // running order instead of eight karts locked at identical pace. This is
      // what lets a weaker kid finish mid-pack rather than automatically last.
      this._racerPace = 0.947 + r() * 0.108;
    }
    return this._racerPace;
  }

  // -------------------------------------------------------------------------
  // Mistakes. A flawless AI reads as a machine; the tell is that it NEVER
  // gets a corner slightly wrong. Three failure modes, all recoverable, all
  // rarer at higher difficulty.
  // -------------------------------------------------------------------------
  _tickMistakes(dt) {
    if (this._mistake) {
      this._mistake.time -= dt;
      if (this._mistake.time <= 0) this._mistake = null;
    }
    this._mistakeIn -= dt;
    if (this._mistakeIn > 0 || this._mistake) return;
    // Higher difficulty = longer gaps between errors.
    const every = this.P.mistakeEvery * (0.75 + 0.85 * this.d01);
    this._mistakeIn = this.rng.range(every * 0.55, every * 1.6);
    const mag = this.P.mistakeMag * (1.15 - 0.45 * this.d01);
    const roll = this.rng();
    const s = this.rng.sign();
    if (roll < 0.42) {
      // missed apex: drift a metre or two off the line for a beat
      this._mistake = { time: this.rng.range(0.7, 1.5), lat: s * this.rng.range(0.9, 2.2) * mag };
    } else if (roll < 0.78) {
      // late brake: carry too much speed in, understeer wide, lose the exit
      this._mistake = { time: this.rng.range(0.5, 1.1), speed: 1 + this.rng.range(0.05, 0.14) * mag };
    } else {
      // wobble: a steering twitch
      this._mistake = { time: this.rng.range(0.25, 0.6), steer: s * this.rng.range(0.06, 0.16) * mag };
    }
    this.stats.mistakes++;
  }

  // -------------------------------------------------------------------------
  // Awareness of the rest of the field. Produces a lateral deviation, a
  // throttle multiplier and (for blockers) a defensive line.
  // -------------------------------------------------------------------------
  _traffic(dt, ctx) {
    const out = { dev: 0, speedMul: 1, blockDev: 0 };
    const karts = ctx.karts;
    if (!karts || karts.length < 2) { this._blockT = Math.max(0, this._blockT - dt); return out; }
    const b = this.body, L = this.line, P = this.P;
    const myLat = b.lateral;
    const v = b.speed;

    let ahead = null, aheadGap = 1e9;
    let behind = null, behindGap = 1e9;
    for (const k of karts) {
      if (k.body === b) continue;
      const gap = TrackSpline.deltaT(k.body.lapT, b.lapT) * L.length;
      if (gap > 0 && gap < 26 && gap < aheadGap) { ahead = k; aheadGap = gap; }
      if (gap <= 0 && gap > -22 && -gap < behindGap) { behind = k; behindGap = -gap; }
    }

    // ---- the kart in front ----------------------------------------------
    this._passHold = Math.max(0, this._passHold - dt);
    if (ahead) {
      const o = ahead.body;
      const latDiff = o.lateral - myLat;
      const overlap = Math.abs(latDiff) < (b.radius + o.radius + 0.9);
      const closing = v - o.speed;
      const halfW = this.spline.widthAt(b.lapT);
      if (overlap) {
        const faster = closing > 0.4 || v > o.speed * 1.01;
        if (faster && aheadGap < 22) {
          // Commit to a side and stay committed — dithering between sides is
          // what makes bad AI look drunk in traffic.
          if (!this._passSide || this._passHold <= 0) {
            // pick the side with more road, away from the kart in front
            const roomR = halfW - o.lateral, roomL = halfW + o.lateral;
            this._passSide = roomR > roomL ? 1 : -1;
            this._passHold = 1.6;
          }
          const reach = clamp(1 - aheadGap / 26, 0, 1);
          out.dev += this._passSide * (b.radius + o.radius + 1.0) * reach * (0.6 + 0.5 * P.aggression);
        }
        // Do not rear-end them. Aggressive drivers lift far less and will
        // genuinely lean on the kart in front — the collision code handles it.
        if (aheadGap < 9 && closing > 0) {
          const urgency = clamp(1 - (aheadGap - 3) / 6, 0, 1);
          out.speedMul *= lerp(1, P.lift, urgency);
        }
      } else if (aheadGap < 7 && Math.abs(latDiff) < (b.radius + o.radius + 2.2)) {
        // side-by-side: hold your own space, do not chop across
        out.dev += -Math.sign(latDiff || 1) * 0.9;
      }
    }

    // ---- someone on our tail: blockers defend ---------------------------
    const threat = behind && behindGap < 18 ? behind : null;
    if (threat && P.block > 0.25) {
      this._blockT = 0.9;
      const o = threat.body;
      // Defend the inside of the corner we are approaching; on a straight,
      // simply cover the side the challenger has chosen. Both are legal, both
      // are readable from behind, and neither can push anyone off the road
      // because the movement is rate-limited and bounded by the track width.
      const kAhead = this.spline.curvatureAt(b.lapT + 30 / L.length);
      const inside = Math.abs(kAhead) > 0.02 ? -Math.sign(kAhead) : Math.sign(o.lateral - b.lateral) || 1;
      const strength = P.block * clamp(1 - behindGap / 18, 0, 1);
      out.blockDev = inside * 2.4 * strength;
      this.stats.blockTime += dt;
    } else {
      this._blockT = Math.max(0, this._blockT - dt);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Tokens: a small line deviation for a pickup that is roughly on the way.
  // Never worth losing a place over — capped at 2.2m and only inside a 30m cone.
  // -------------------------------------------------------------------------
  _tokenPull(ctx) {
    const toks = ctx.tokens;
    if (!toks || !toks.length) return 0;
    const b = this.body, L = this.line;
    // Re-scan a few times a second, not every frame.
    if (this.time - (this._tokScan || -9) > 0.2) {
      this._tokScan = this.time;
      this._tokDev = 0;
      let best = 1e9, bestDev = 0;
      for (const tk of toks) {
        if (tk.active === false || tk.taken) continue;
        const pos = tk.position || tk;
        const s = this.spline.closestT(pos);
        const gap = TrackSpline.deltaT(s.t, b.lapT) * L.length;
        if (gap < 4 || gap > 34) continue;
        const want = s.lateral - lineOffsetAt(L, s.t);
        if (Math.abs(want) > 4.5) continue;          // not on the way
        if (gap < best) { best = gap; bestDev = clamp(want, -2.2, 2.2); }
      }
      this._tokDev = bestDev;
    }
    return this._tokDev || 0;
  }

  // -------------------------------------------------------------------------
  // Drift state machine. Same rules the player plays by: hop, commit, hold to
  // charge, release on the exit so the boost lands where it can be spent.
  // -------------------------------------------------------------------------
  _drift(dt, v, t, steer) {
    const b = this.body, L = this.line, P = this.P;
    const R = lineRadiusAt(L, t + clamp(v * 0.35, 4, 18) / L.length);
    // The radius a corner must be under for a drift to pay. Scaled by the
    // driver's appetite: a `drifter` throws it sideways almost everywhere, a
    // `steady` driver only when the corner actually demands it.
    const thresh = 240 * P.driftEager;
    let want = false;
    if (b.drifting) {
      const tier = b.driftTier;
      const ripe = b.driftCharge >= DRIFT_TIERS[clamp(this._driftGoal, 0, 2)].charge;
      const opening = R > 190;
      want = v > 9 && steer * (b.driftDir || 1) > -0.7 &&
        b.driftCharge < DRIFT_TIERS[2].charge && !(ripe && opening);
      if (!want && tier > 0) this.stats.driftBoosts++;
    } else if (v > 12.5 && R < thresh && Math.abs(steer) > 0.10 && !b.airborne) {
      want = true;
      // How long to hold: orange by default, purple for the drift specialist,
      // blue when a mistake has already compromised the corner.
      this._driftGoal = clamp(P.driftHold + (this.rng() < 0.25 ? 1 : 0), 0, 2);
    }
    let outSteer = null;
    if (want && b.drifting) {
      // Invert KartBody's drift steering map so a pursuit command means the
      // same arc drifting or not (see kartphysics section 7).
      const dir = b.driftDir || Math.sign(steer) || 1;
      const s = clamp(steer * dir, 0, 1);
      outSteer = dir * clamp(2 * (s - 0.02) / 0.98 - 1, -1, 1);
    }
    return { want, steer: outSteer };
  }

  /**
   * Rubber band, applied by the field. Bounded, smoothed, AI-only.
   * @param {number} gapSeconds      seconds behind the human (negative = ahead)
   * @param {number} packGapSeconds  seconds behind the AI pack's own mean
   */
  applyBand(dt, gapSeconds, packGapSeconds = 0) {
    if (!this.banded) { this.band = 1; return 1; }
    // Aim for our slot, not for the player's exact bumper.
    // Opponents that aim BEHIND the player have their slot stretched on the
    // gentle races (see SLOT_STRETCH_EASY) — that stretch is the championship's
    // whole gradient for anyone driving below the field's own pace.
    const slot = this.slotAhead * (this.slotAhead < 0 ? slotStretch(this.d01) : slotFwd(this.d01));
    // The hold branch (we are up the road) reaches further down the gap on the
    // gentle races; the catch branch and the bounds below are untouched.
    const x = gapSeconds + slot * slotCompress(this.d01);
    const rp = Math.tanh(x / (BAND_TAU * (x < 0 ? holdReach(this.d01) : 1)));
    const rk = Math.tanh(packGapSeconds / PACK_TAU);
    // Catch-up (rp > 0, we are behind the human) is difficulty-scaled; hold-back
    // (rp < 0, we are up the road and the human is struggling) is not. See the
    // CEILING vs FLOOR note above the constants.
    const holdMax = bandHoldMax(this.basePace());
    const dPlayer = rp > 0 ? rp * bandCatchMax(this.d01) : rp * holdMax;
    const dPack = rk > 0 ? rk * packCatchMax(this.d01) : rk * packHoldMax();
    const target = clamp(1 + dPlayer + dPack, 1 - holdMax, 1 + BAND_CATCH);
    // ~1.4s time constant: the band is a mood, never a gear change.
    this.band = damp(this.band, target, 0.7, dt);
    if (this.band > this.stats.bandMax) this.stats.bandMax = this.band;
    if (this.band < this.stats.bandMin) this.stats.bandMin = this.band;
    return this.band;
  }

  setDifficulty(d) {
    const n = difficulty01(d);
    if (n === this.d01) return;
    this.d01 = n;
    this.rebuildProfile();
  }
}

// ===========================================================================
// 5. createAIField — the seven opponents plus the rubber band
// ===========================================================================

/**
 * @param {TrackSpline} spline
 * @param {object} def      track def (for startT / grid)
 * @param {object} engine   engine (quality tiers; may be null headless)
 * @param {object} opts
 *   difficulty      1..3 race number, or 0..1
 *   playerRacerId   id of the racer the human is driving (excluded)
 *   count           number of opponents (default 7)
 *   slots           grid slots; defaults to gridSlots(spline, def, 8)
 *   playerSlot      which slot index the player occupies (default 0)
 *   seed            rng seed
 *   parts           garage parts applied to every opponent
 *   playerParts     the HUMAN's physics parts ({engine,tyres,frame,turbo}).
 *                   Optional: the finale's opponents run one tier above it (see
 *                   aiPartTier). Absent or all-zero => exactly the Wave-5.1 field.
 *   collide         resolve kart-vs-kart inside update() (default true)
 *   rubberBand      false to disable entirely (for A/B telemetry)
 */
export function createAIField(spline, def, engine, opts = {}) {
  const difficulty = opts.difficulty ?? 1;
  const d01 = difficulty01(difficulty);
  const playerId = opts.playerRacerId ?? ROSTER[0].id;
  const count = opts.count ?? 7;
  const slots = opts.slots || gridSlots(spline, def, count + 1);
  const playerSlot = opts.playerSlot ?? 0;
  // Origin for every progress accumulator in this field, player included.
  const startT = def?.startT ?? 0;
  const surface = def?.theme === 'cloud' ? 'cloud' : def?.theme === 'circuit' ? 'grass' : 'sand';
  // Per-geometry calibration x the per-kart correction for the kart the child
  // actually chose (see KART_PACE above). Faster kart -> faster field, so the
  // choice keeps its FEEL and stops buying finishing places. Not clamped as a
  // product: TRACK_PACE.oasis is 1.09 and a clamp here would erase it.
  const trackPace = (TRACK_PACE[def?.id] ?? 1) * kartPace(playerId, def?.id);
  // The opponents' own garage. `opts.parts` still wins (A/B telemetry hands the
  // whole field the player's parts on purpose); otherwise the field runs the
  // championship tier for this difficulty. Exposed on the api as `parts` so the
  // race scene can dress them to match if it wants to.
  const tier = aiPartTier(difficulty, playerPartTier(opts.playerParts));
  const aiParts = opts.parts || (tier > 0 ? { engine: tier, tyres: tier, frame: tier, turbo: tier } : null);

  const field = ROSTER.filter(r => r.id !== playerId).slice(0, count);
  const free = slots.filter((_, i) => i !== playerSlot);

  const drivers = [];
  const bodies = [];
  field.forEach((racer, i) => {
    const body = opts.bodies?.[i] || new KartBody({
      spline, stats: racer.stats, startSlot: free[i] || free[free.length - 1],
      parts: aiParts, surface,
    });
    const drv = new AIDriver({
      body, spline, racer, difficulty, trackPace, startT,
      seed: (opts.seed ?? 1) * 101 + i * 37,
      rubberBand: opts.rubberBand !== false,
    });
    drivers.push(drv);
    bodies.push(body);
  });

  // Everything the drivers see each frame. One shared array, no per-kart allocs.
  // Hand out target slots fastest-first, so the quick characters are the ones
  // fighting the player for the lead and the slower ones fill in behind.
  drivers.slice().sort((a, b) => b.racerPace() * PERSONA[b.personality].pace -
                                 a.racerPace() * PERSONA[a.personality].pace)
    .forEach((d, i) => { d.slotAhead = SLOT_AHEAD[Math.min(i, SLOT_AHEAD.length - 1)]; });

  const karts = drivers.map(d => ({ body: d.body, driver: d, racer: d.racer }));
  const ctx = { karts, tokens: null, player: null };
  let playerEntry = null;
  let tokens = null;
  let bandPeak = 1, bandTrough = 1;
  let time = 0;
  let playerProgress = 0, playerTrack = null;

  const api = {
    drivers, bodies, karts, line: racingLine(spline), difficulty: d01,
    // What the opponents are driving: the championship part tier and the parts
    // object itself, so a caller can dress the AI karts to match their physics.
    partTier: tier, parts: aiParts,

    /** Tokens the AI may deviate slightly to collect. `[{position, active}]`. */
    setTokens(list) { tokens = list; ctx.tokens = list; },

    /**
     * Mid-life difficulty change. Moves skill / mistakes / band authority, but
     * NOT the opponents' part tier — their karts are built once, and swapping
     * hardware under a running race would change lap times mid-lap.
     */
    setDifficulty(d) {
      api.difficulty = difficulty01(d);
      for (const drv of drivers) drv.setDifficulty(d);
    },

    /**
     * Step every opponent.
     * @param {number} dt
     * @param {object} playerState  a KartBody, or {body}, or
     *        {position, lapT, speed, progress}. Optional — without it the band
     *        references the pack mean only.
     */
    update(dt, playerState) {
      time += dt;
      // ---- fold the player into the awareness list (never into the band's
      //      "who do we slow down" set — the player is never rubber-banded) --
      const pb = playerState?.body || (playerState?.lapT != null ? playerState : null);
      let stepPlayer = false;
      if (pb) {
        if (!playerEntry) { playerEntry = { body: pb, driver: null, isPlayer: true }; karts.push(playerEntry); }
        else playerEntry.body = pb;
        // Seed the human's accumulator on the same origin as the opponents':
        // the signed arc offset of their grid slot from the start/finish line.
        if (!playerTrack || playerTrack.body !== pb) {
          playerTrack = new ProgressTracker(spline, pb, startT);
          playerTrack.body = pb;
          playerProgress = playerTrack.value;
        }
        // The human's body was stepped by the caller BEFORE this call, so its
        // lapT already describes the end of the step; the opponents' do not
        // until their bodies are stepped below. Both accumulators are therefore
        // committed together, after the drive loop.
        stepPlayer = true;
      }
      if (playerState?.progress != null) {
        // The caller keeps its own accumulator (race.js does). Honour it, and
        // re-anchor ours to it so a later frame without one does not jump.
        playerProgress = playerState.progress;
        if (playerTrack) { playerTrack.value = playerProgress; playerTrack.resync(pb); }
        stepPlayer = false;
      }

      // ---- rubber band -----------------------------------------------------
      // Reference = a blend of the human's progress and the pack's own mean.
      // Blending matters: pure player-reference glues the field to a slow kid
      // and makes the AI look broken; pure pack-mean lets the leaders vanish.
      let mean = 0;
      for (const d of drivers) mean += d.progress;
      mean /= drivers.length;
      const ref = pb ? playerProgress : mean;
      const lapLen = spline.length;
      for (const d of drivers) {
        // gaps in SECONDS, using this kart's own cruising speed, so the band
        // means the same thing on a slow track as on a fast one.
        const cruise = Math.max(12, d.body.p.topSpeed * 0.82);
        const gapM = (ref - d.progress) * lapLen;
        const packM = (mean - d.progress) * lapLen;
        const b = d.applyBand(dt, gapM / cruise, packM / cruise);
        if (b > bandPeak) bandPeak = b;
        if (b < bandTrough) bandTrough = b;
      }

      // ---- drive -----------------------------------------------------------
      for (const d of drivers) {
        const input = d.update(dt, ctx);
        d.body.update(dt, input);
      }
      if (opts.collide !== false) {
        const all = pb ? bodies.concat([pb]) : bodies;
        KartBody.resolveCollisions(all);
      }

      // ---- progress, all karts at the SAME instant -------------------------
      // Every body has now been stepped (the human's by the caller, before this
      // call). Committing here — and only here — is what makes order() compare
      // end-of-step against end-of-step. Doing it inside AIDriver.update, which
      // runs before the bodies move, handed the player a systematic ~0.3 m per
      // frame: 972 wrong orderings over 113,749 steps, worst lie 4.15 m.
      for (const d of drivers) d.commitProgress(dt);
      if (stepPlayer) { playerTrack.step(dt, pb); playerProgress = playerTrack.value; }

      api._rankPass(dt, pb);
    },

    // Overtake counting for telemetry: a place change that sticks for 1s.
    _rankPass(dt, pb) {
      const all = karts.slice().sort((a, c) => {
        const pa = a.driver ? a.driver.progress : playerProgress;
        const pc = c.driver ? c.driver.progress : playerProgress;
        return pc - pa;
      });
      for (let i = 0; i < all.length; i++) {
        const d = all[i].driver;
        if (!d) continue;
        if (d._rank == null) { d._rank = i; d._rankPend = i; d._rankT = 0; continue; }
        if (i !== d._rankPend) { d._rankPend = i; d._rankT = 0; }
        else {
          d._rankT += dt;
          if (d._rankT > 1.0 && d._rankPend !== d._rank) {
            if (d._rankPend < d._rank) d.stats.overtakes += (d._rank - d._rankPend);
            d._rank = d._rankPend;
          }
        }
      }
    },

    /** Current order, best first: [{racer, progress, isPlayer}] */
    order() {
      const rows = drivers.map(d => ({ racer: d.racer, driver: d, progress: d.progress, isPlayer: false }));
      if (playerEntry) rows.push({ racer: null, driver: null, progress: playerProgress, isPlayer: true });
      return rows.sort((a, b) => b.progress - a.progress);
    },

    telemetry() {
      return {
        bandMax: bandPeak, bandMin: bandTrough, time,
        // Guard diagnostics: how many steps the progress cap had to reject, and
        // how many metres of bogus arc that was. Both should be ~0 in a healthy
        // race; a non-zero clampedM is a projection snap that DIDN'T become free
        // progress. Non-silent by design — see ProgressTracker.
        progressClamps: drivers.reduce((n, d) => n + d._prog.clamps, 0) +
          (playerTrack ? playerTrack.clamps : 0),
        progressClampedM: drivers.reduce((n, d) => n + d._prog.clampedM, 0) +
          (playerTrack ? playerTrack.clampedM : 0),
        drivers: drivers.map(d => ({
          id: d.racer.id, name: d.racer.nameEn, personality: d.personality,
          progress: d.progress, band: d.band, pace: d.pace,
          progressClamps: d._prog.clamps, progressClampedM: d._prog.clampedM,
          ...d.stats,
          cornerEntry: d.stats.cornerEntryN ? d.stats.cornerEntrySum / d.stats.cornerEntryN : 0,
        })),
      };
    },

    dispose() { drivers.length = 0; bodies.length = 0; karts.length = 0; },
  };
  return api;
}

// ===========================================================================
// 6. preview(engine) — aerial view of a race in progress, racing line drawn.
// ===========================================================================

export function preview(engine) {
  const { def, spline } = getTrack('oasis');
  const line = racingLine(spline);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x4a5680);
  scene.fog = new THREE.FogExp2(0xc99a63, 0.0022);

  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 2000);

  const sun = new THREE.DirectionalLight(0xffd9a0, 2.3);
  sun.position.set(-90, 120, 40);
  scene.add(sun, new THREE.HemisphereLight(0x8fa8dd, 0x6b4a2c, 0.9));

  const disposables = [];
  const own = (m) => { disposables.push(m); return m; };

  const groundGeo = new THREE.PlaneGeometry(1800, 1800);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x8f5f34 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.08;
  scene.add(ground); disposables.push(ground);

  // road + edges
  scene.add(own(ribbon(spline, t => 0, t => spline.widthAt(t), 0x4a4a52, 0.02)));
  scene.add(own(ribbon(spline, t => spline.widthAt(t) * 0.96, () => 0.22, 0x8e8a84, 0.05)));
  scene.add(own(ribbon(spline, t => -spline.widthAt(t) * 0.96, () => 0.22, 0x8e8a84, 0.05)));
  // THE RACING LINE — the whole point of this preview. Deliberately a cool
  // near-white: every racer colour in the roster is warm or saturated, so the
  // ideal line can never be mistaken for somebody's trail.
  scene.add(own(ribbon(spline, t => lineOffsetAt(line, t), () => 0.55, 0xffffff, 0.09)));

  // Edge posts: without something with a known size beside the road, an aerial
  // shot has no scale and the field's spread is unreadable.
  {
    const postGeo = new THREE.BoxGeometry(0.5, 1.4, 0.5);
    const postMat = new THREE.MeshLambertMaterial({ color: 0xe8d6b0 });
    const n = 120;
    const posts = new THREE.InstancedMesh(postGeo, postMat, n * 2);
    const m4 = new THREE.Matrix4(), pv = new THREE.Vector3(), rv = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = i / n;
      spline.positionAt(t, pv); spline.rightAt(t, rv);
      const w = spline.widthAt(t) + 1.8;
      for (let sg = -1; sg <= 1; sg += 2) {
        m4.makeTranslation(pv.x + rv.x * w * sg, pv.y + 0.7, pv.z + rv.z * w * sg);
        posts.setMatrixAt(i * 2 + (sg > 0 ? 1 : 0), m4);
      }
    }
    posts.instanceMatrix.needsUpdate = true;
    scene.add(posts);
    disposables.push(posts);
  }

  // 8 karts: the player stand-in (a clean 100%-pace balanced driver) + 7 AI.
  const player = ROSTER[0];
  const slots = gridSlots(spline, def, 8);
  const playerBody = new KartBody({ spline, stats: player.stats, startSlot: slots[0], surface: 'sand' });
  const playerDrv = new AIDriver({ body: playerBody, spline, racer: player, seed: 5, pace: 0.95, startT: def.startT ?? 0 });
  const field = createAIField(spline, def, engine, {
    difficulty: 1, playerRacerId: player.id, slots, playerSlot: 0, seed: 3,
  });

  // Per-kart trail: the last ~6 seconds of where this driver actually went.
  // Eight coloured threads over one gold ideal line is the whole diagnostic —
  // you can see who apexed, who ran wide, and who is defending the inside.
  const TRAIL = 150;
  const makeTrail = (color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    g.setDrawRange(0, 0);
    const m = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(g, m);
    line.frustumCulled = false;
    scene.add(line); disposables.push(line);
    return { g, n: 0, head: 0 };
  };

  // Stand-in kart if kartmodel is unavailable or mid-edit. This preview is
  // about lines and spread, and it must not go dark because a sibling module
  // is being refactored in another window.
  const proxyKart = (racer) => {
    const group = new THREE.Group();
    const parts = [];
    const box = (w, h, d, col, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.MeshLambertMaterial({ color: col });
      const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z);
      parts.push(g, m); group.add(mesh);
    };
    box(1.3, 0.42, 2.2, racer.color, 0, 0.44, 0);
    box(1.0, 0.34, 0.6, racer.color2, 0, 0.78, -0.3);
    box(0.34, 0.88, 0.88, 0x22242e, 0.78, 0.44, -0.7);
    box(0.34, 0.88, 0.88, 0x22242e, -0.78, 0.44, -0.7);
    return { group, update() {}, dispose() { for (const d of parts) d.dispose(); } };
  };

  const models = [];
  const mk = (racer, body) => {
    let k;
    try {
      k = createKart({ racer, engine, lod: 'low', shadows: false,
        parts: { engine: 1, tires: 1, wing: 1, chassis: 1, exhaust: 1 } });
    } catch (e) { k = proxyKart(racer); }
    scene.add(k.group);
    models.push({ k, body });
    // a bright puck so each kart is identifiable from 60m up
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.05, 20),
      new THREE.MeshBasicMaterial({ color: racer.color }));
    scene.add(puck); disposables.push(puck);
    models[models.length - 1].puck = puck;
    models[models.length - 1].trail = makeTrail(racer.color);
    return k;
  };
  mk(player, playerBody);
  field.drivers.forEach(d => mk(d.racer, d.body));

  // Roll everyone in already moving so the first seconds are a race, not a
  // standing start — the screenshot is taken at t=20s and we want a spread.
  for (const b of [playerBody, ...field.bodies]) b._vLong = 14;

  const centre = new THREE.Vector3();
  let time = 0, trailClock = 0;
  return {
    scene, camera,
    update(dt) {
      time += dt;
      const pi = playerDrv.update(dt, { karts: field.karts });
      playerBody.update(dt, pi);
      playerDrv.commitProgress(dt);   // stand-in driver isn't in the field's loop
      field.update(dt, playerBody);

      trailClock += dt;
      const pushTrail = trailClock >= 0.04;
      if (pushTrail) trailClock = 0;

      centre.set(0, 0, 0);
      for (const m of models) {
        m.k.group.position.copy(m.body.position);
        m.k.group.position.y += m.body.hopOffset;
        m.k.group.quaternion.copy(m.body.renderQuaternion);
        try { m.k.update(dt, m.body.getState()); } catch (e) { /* model mid-edit */ }
        m.puck.position.copy(m.body.position); m.puck.position.y += 0.03;
        centre.add(m.body.position);
        if (pushTrail) {
          const tr = m.trail, a = tr.g.attributes.position;
          if (tr.n < TRAIL) tr.n++;
          else {                                  // shift the ring down by one
            a.array.copyWithin(0, 3);
          }
          const k = (tr.n - 1) * 3;
          a.array[k] = m.body.position.x;
          a.array[k + 1] = m.body.position.y + 0.16;
          a.array[k + 2] = m.body.position.z;
          a.needsUpdate = true;
          tr.g.setDrawRange(0, tr.n);
        }
      }
      centre.divideScalar(models.length);
      // Aerial chase: high and tilted, framed so the whole pack plus a corner
      // either side of it is in shot — the spread of the field IS the subject.
      let spread = 0;
      for (const m of models) spread = Math.max(spread, m.body.position.distanceTo(centre));
      const h = clamp(78 + spread * 1.15, 90, 220);
      camera.position.set(centre.x + h * 0.16, centre.y + h, centre.z + h * 0.62);
      camera.lookAt(centre.x, centre.y, centre.z);
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() {
      for (const m of models) m.k.dispose();
      for (const d of disposables) {
        if (d.isInstancedMesh) d.dispose();
        if (d.geometry) d.geometry.dispose();
        if (d.material) d.material.dispose();
      }
      groundGeo.dispose(); groundMat.dispose();
      field.dispose();
    },
  };
}

/** Flat ribbon along the spline at a lateral offset — used for the line overlay. */
function ribbon(spline, offAt, halfAt, color, yOff) {
  const N = 720;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const idx = [];
  const p = new THREE.Vector3(), r = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = (i / N) % 1;
    spline.positionAt(t, p); spline.rightAt(t, r);
    const c = offAt(t), hw = Math.max(0.1, halfAt(t));
    const k = i * 6;
    pos[k] = p.x + r.x * (c - hw); pos[k + 1] = p.y + yOff; pos[k + 2] = p.z + r.z * (c - hw);
    pos[k + 3] = p.x + r.x * (c + hw); pos[k + 4] = p.y + yOff; pos[k + 5] = p.z + r.z * (c + hw);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
}

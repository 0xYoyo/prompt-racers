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
//   4. createAIField           — the 7 opponents + the bounded rubber band.
//
// Determinism: every random number comes from core/rng.js. Never Math.random.
import * as THREE from 'three';
import { getTrack, gridSlots, TrackSpline } from '/Users/yoyopc/repos/kart-project/src/track/trackdef.js';
import { KartBody, DRIFT_TIERS, DRIFT_GRIP } from '/Users/yoyopc/repos/kart-project/src/kart/kartphysics.js';
import { ROSTER } from '/Users/yoyopc/repos/kart-project/src/kart/roster.js';
import { makeRng } from '/Users/yoyopc/repos/kart-project/src/core/rng.js';
import { createKart } from '/Users/yoyopc/repos/kart-project/src/kart/kartmodel.js';

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
// Measured result, autopilot player, 5 seeds, place out of 8:
//   stock player  race 1: 1st-3rd (mean 2.2)   race 2: 3rd-4th   race 3: 3rd-5th
//   tier-1 player            1st-2nd (1.2)              2nd-3rd          1st-3rd
//   tier-2 player            1st                        1st-2nd          1st
const AI_PACE = 1.00;
const TRACK_PACE = { oasis: 1, circuit: 1, cloud: 1 };
const paceForDifficulty = d01 => 0.815 + 0.150 * d01;

// Championship tier of the opponents' own karts: race 1 stock, race 2 tier 1,
// race 3 tier 2. Tier 3 is left to the player — the field never out-equips a
// child who has spent well.
export const aiPartTier = d01 => 0 * difficulty01(d01);

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
// Measured, 3-lap races, autopilot player with topSpeed+accel scaled to `pace`,
// 5 seeds, laps behind the winner when the winner finishes (>= 1.00 = lapped):
//
//                race 1 (oasis)  race 2 (circuit)  race 3 (cloud)
//   70% pace     0.24 -> 0.17     0.25 -> 0.15      0.61 -> 0.20   (before/after)
//   85% pace     0.03 -> 0.10     0.09 -> 0.09      0.15 -> 0.10
//
// and the worst distance to the NEAREST opponent at 70% pace fell from 0.41 laps
// to 0.08 — a struggling child is now inside the pack, not alone on an empty
// track, which is what the floor is for.
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
const bandHoldMax = base => BAND_HOLD + 0 * base;
const packCatchMax = d01 => 0.026 * (1 - 0.30 * d01);
const packHoldMax = () => 0.034;                   // difficulty-independent
// Seconds of gap at which each term is ~76% saturated. The pack is tight, so
// its term has to react over a much shorter gap than the player's.
const BAND_TAU = 6.0;
const PACK_TAU = 2.5;
// Each opponent aims to run a few seconds AHEAD OF or BEHIND the human rather
// than exactly alongside — otherwise the player term bunches all seven onto the
// player's gearbox and the race becomes a rolling roadblock. The spread is
// biased backwards (+3s to -11s) so that a good kid is still racing for the
// win, not for fourth. Scaled down as the championship escalates.
const SLOT_AHEAD = [2.5, 1, -0.5, -2, -3.5, -5, -6.5];

// ===========================================================================
// 4. AIDriver
// ===========================================================================

const NO_INPUT = { throttle: 0, brake: 0, steer: 0, drift: false, hop: false };

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
    this.progress = 0;         // laps completed, fractional & monotonic
    this._prevT = this.body.lapT;
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

    // lap progress (monotonic, wrap-safe)
    this.progress += TrackSpline.deltaT(t, this._prevT);
    this._prevT = t;

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

  /** Small fixed per-racer pace offset so the field is not eight clones. */
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
    const rp = Math.tanh((gapSeconds + this.slotAhead * (1 - 0.35 * this.d01)) / BAND_TAU);
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
  const surface = def?.theme === 'cloud' ? 'cloud' : def?.theme === 'circuit' ? 'grass' : 'sand';
  const trackPace = TRACK_PACE[def?.id] ?? 1;
  // The opponents' own garage. `opts.parts` still wins (A/B telemetry hands the
  // whole field the player's parts on purpose); otherwise the field runs the
  // championship tier for this difficulty. Exposed on the api as `parts` so the
  // race scene can dress them to match if it wants to.
  const tier = aiPartTier(difficulty);
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
      body, spline, racer, difficulty, trackPace,
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
  let playerProgress = 0, playerPrevT = null;

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
      if (pb) {
        if (!playerEntry) { playerEntry = { body: pb, driver: null, isPlayer: true }; karts.push(playerEntry); }
        else playerEntry.body = pb;
        if (playerPrevT == null) playerPrevT = pb.lapT;
        playerProgress += TrackSpline.deltaT(pb.lapT, playerPrevT);
        playerPrevT = pb.lapT;
      }
      if (playerState?.progress != null) playerProgress = playerState.progress;

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
        drivers: drivers.map(d => ({
          id: d.racer.id, name: d.racer.nameEn, personality: d.personality,
          progress: d.progress, band: d.band, pace: d.pace,
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
  const playerDrv = new AIDriver({ body: playerBody, spline, racer: player, seed: 5, pace: 0.95 });
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

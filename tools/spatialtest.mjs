// tools/spatialtest.mjs — SPATIAL TRUTH gate.
//
//   node tools/spatialtest.mjs                  the gate (~60s + ~40s browser)
//   node tools/spatialtest.mjs --no-dist        skip section E (no build needed)
//   node tools/spatialtest.mjs --dist=<path>    drive some OTHER build in E
//   node tools/spatialtest.mjs --ai=<path>      run A-D against a COPY of ai.js
//                                               kept somewhere else (never the
//                                               tree — copy the whole src/ to
//                                               .tmp/ and point at its ai.js)
//   node tools/spatialtest.mjs --mutate=origin  re-zero every progress
//                                               accumulator after construction
//   node tools/spatialtest.mjs --mutate=phase   commit each AI's progress from
//                                               the state it had BEFORE its body
//                                               was stepped (the Wave-6 skew)
//   node tools/spatialtest.mjs --mutate=jump    remove the per-step physical
//                                               bound: integrate `lapT` raw
//   Those three mutations must all make this gate RED. They are how it was
//   proved to bite; see the block at the bottom of this header.
//   node tools/spatialtest.mjs --mutate=probefreeze
//                                               the ODD ONE OUT, and it must stay
//                                               GREEN. It mutates this gate's own
//                                               teleport probe, not the game: it
//                                               opens a quiz question immediately
//                                               before section E's probe, which
//                                               freezes the world (time scale 0)
//                                               exactly as a loaded machine used
//                                               to leave it. Before Wave 7 that
//                                               state made the probe's two
//                                               PRECONDITIONS red — offTrack=false,
//                                               lapT jumped 0.0 m — while the
//                                               contract they guard went
//                                               unexercised. This route is the
//                                               reproduction, and a green run is
//                                               the proof: with the DOM-only
//                                               dismissal it was tried with first,
//                                               this route reports `the sim never
//                                               took a live step ... 900 steps
//                                               tried` and four reds.
//
// WHAT THIS PROTECTS
// ------------------
// The running order the child sees must be the running order on the tarmac.
// Wave 6 shipped a race where it was not, in three separate ways:
//
//  1. ORIGIN. `gridSlots()` parks kart i 4..22 m BEHIND the start/finish line,
//     but every progress accumulator was seeded to exactly 0 and then
//     integrated `deltaT`. A kart on row 4 carried a permanent +18 m credit in
//     every comparison — `order()`, `_rankPass()`, the HUD position, the
//     `race:position` toasts, the rubber band's gap terms and `finishPlayer()`'s
//     projected standings all sorted biased numbers.
//  2. PHASE. `createAIField.update()` folded the human in from an
//     already-stepped body, but wrote each AI's progress inside `d.update()`,
//     which runs BEFORE `d.body.update()` moves that kart. `order()` therefore
//     compared the player's end-of-step position against the AI's start-of-step
//     position: measured 856 wrongly-ordered pairs of on-track karts over
//     113,749 steps, worst lie 0.855 m, all of them free to the player.
//  3. PROJECTION SNAPS. `TrackSpline.closestT()` is a global nearest-sample
//     lookup whose `hintT` argument is declared and never read, so a kart well
//     off the road can have its nearest centreline point flip branches and its
//     `lapT` jump. Integrated raw, that was free progress: worst single step
//     +13.67 m of arc for 0.29 m actually travelled.
//
// This file is the contract: progress == 0 means ON THE LINE, equal progress
// means physically abreast, and no step may credit more arc than the kart could
// physically have covered.
//
// A. CONTINUOUS RANKING TRUTH, AT THE PHASE THE GAME READS. race.js calls
//    `field.order()` AFTER `field.update`, so that is where this audits. Every
//    pair of ON-TRACK karts must be ordered exactly as the tarmac orders them,
//    and every on-track kart's progress must equal its own projection. The
//    pre-`field.update` phase is audited too, as the counter-check that the
//    accumulators really are committed at the end of the step.
// B. PHOTO FINISH — the recorded standings order equals the physical crossing
//    order, including hard-coded genuinely-close finishes.
// C. GRID FAIRNESS — one step off the grid, all 8 seeded progress values equal
//    their true arc offsets (-22 m to -4 m: the field starts BEHIND the line).
//    The player's value is read out of `field.order()`, not recomputed here —
//    a row that recomputes race.js's formula is a self-test on that row.
// D. PHYSICAL BOUND — no step may advance a kart's progress by more arc than it
//    could have travelled, plus an independent along-track displacement truth
//    that never touches `lapT` at all.
// E. THE REAL GAME — sections A-D drive the modules directly and so cannot see
//    race.js's own half of this (`S.progress`, `updatePositions`, the position
//    toast, `finishPlayer`). E drives dist/index.html and audits those.
//
// HOW THE GATE STAYS INDEPENDENT OF THE CODE IT TESTS
// ---------------------------------------------------
// The "truth" arc position is NEVER read off `.progress`. It is
//   truth_i = lapsCompleted_i + ((lapT_i - startT) mod 1)
// where lapsCompleted_i is a counter this file maintains by watching the
// fraction wrap, initialised to -1 for a kart that starts behind the line and 0
// for one that starts on or past it. Nothing but `body.lapT` and `def.startT`
// feeds it. Section D's second truth does not even use `lapT`: it integrates
// each kart's own Δposition · tangent, curvature-corrected, from `position`
// alone.
//
// WHY "ON-TRACK" QUALIFIES THE RANKING ASSERTION — read this before widening it.
// `closestT()` is only trustworthy while the kart is ON the road, where the
// nearest centreline branch is tens of metres from any other (the tightest
// hairpin puts its two sides 37 m apart against a 16 m road). Off the road it
// snaps, and BOTH this file's truth and the game's ranking would then be reading
// the same lying number — the gate could not tell one from the other, so a
// tolerance there would be theatre. ai.js's ProgressTracker answers the same
// fact by rate-limiting an off-track kart's progress toward its projection and
// taking the offset out in full the moment the kart is back on the road, so the
// on-track contract below is EXACT: zero violations, zero residual, no
// tolerance spent. The off-road disagreements that remain (140 across the 12
// cells, worst 7.18 m) are `closestT`'s ignored `hintT`, and that lives in
// trackdef.js.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const hit = argv.find(a => a === `--${k}` || a.startsWith(`--${k}=`));
  if (!hit) return d;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const MUT = arg('mutate', null);
const MUTATE = MUT === 'origin';
const MUT_PHASE = MUT === 'phase';
const MUT_JUMP = MUT === 'jump';
// Not a mutation of the code under test: it mutates section E's own probe, to
// reproduce the frozen world a loaded machine used to hand it. Stays GREEN.
const MUT_PROBEFREEZE = MUT === 'probefreeze';
if (MUT && !MUTATE && !MUT_PHASE && !MUT_JUMP && !MUT_PROBEFREEZE) {
  console.error(`unknown --mutate=${MUT} (origin | phase | jump | probefreeze)`); process.exit(2);
}
const AI_PATH = arg('ai', null);
const NO_DIST = arg('no-dist', false) === true;
const aiUrl = AI_PATH
  ? pathToFileURL(path.resolve(process.cwd(), AI_PATH)).href
  : new URL('../src/kart/ai.js', import.meta.url).href;
const aiMod = await import(aiUrl);
const { createAIField } = aiMod;

const DT = 1 / 60;
const f = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : 'inf');
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

let failures = 0, assertions = 0;
const assert = (ok, msg) => {
  assertions++;
  if (!ok) { failures++; console.log('  ✗ FAIL: ' + msg); } else console.log('  ✓ ' + msg);
};

// TIE TOLERANCE, in METRES of arc. Two karts inside this may swap in the sort
// without the gate calling it a lie — that is a genuine photo-finish tie, and
// with float noise alone the two rankings agree to ~1e-9 m anyway. It is a
// HUNDREDTH of the smallest thing the origin bug produced (row 2 = 4 m behind
// row 1, row 4 = 18 m), a sixtieth of one grid row, and a fourteenth of the
// worst phase-skew lie (0.855 m). Do not widen it.
const TIE_M = 0.06;

// --- section D's own constants, derived here rather than imported ------------
// The gate must not grade the implementation against the implementation's own
// numbers, so these are re-derived from the geometry and set DELIBERATELY
// LOOSER than ai.js's (eps 0.60 + 0.72 of a sample spacing).
//
// ARC_EPS: on the inside of a corner of radius R a kart at lateral offset L
// sweeps the same angle on radius R-L, so it covers R/(R-L) times its ground
// distance in centreline arc — the only direction an upper bound must allow.
// Tightest corner in the game: circuit's first hairpin, R = 18.8 m, half-width
// 8 m, so the honest worst factor is 18.8/14.8 = 1.27. 1.60 leaves 26% over it.
const ARC_EPS = 0.60;
// FLOOR: `closestT()` clamps its segment parameter to [0,1], so `lapT` is a
// staircase with a tread of one arc-table sample (0.826 m oasis, 0.845 circuit,
// 0.855 cloud) and one step can legitimately carry up to half a tread of
// catch-up. The gate allows a WHOLE tread. Measured unguarded over 892,800
// steps, exactly 31 steps exceed this — and all 31 are projection snaps.
const floorFor = spline => spline.length / (spline.N || 1400);
// The rate at which a kart OFF the road is allowed to converge on its own
// (untrusted) projection. Stated here so section D can allow for it; the same
// number lives in ai.js as PROGRESS_REANCHOR_MPS. A gate that allowed an
// unlimited convergence would be blind to leak 1 again.
const REANCHOR_MPS = 1.5;

const TRACKS = ['oasis', 'circuit', 'cloud'];
const SEEDS = [3, 11, 19, 41];

const frac01 = x => ((x % 1) + 1) % 1;

/**
 * Independent arc-position tracker. Fed raw lapT values; never sees .progress.
 */
class ArcTruth {
  constructor(startT, lapTs) {
    this.startT = startT;
    this.frac = lapTs.map(t => frac01(t - startT));
    // Behind the line (fraction close to 1) => the kart has not yet completed
    // lap 0, so its arc position is a small NEGATIVE number.
    this.laps = this.frac.map(fr => (fr < 0.5 ? 0 : -1));
  }
  step(lapTs) {
    for (let i = 0; i < lapTs.length; i++) {
      const fr = frac01(lapTs[i] - this.startT);
      const d = fr - this.frac[i];
      if (d < -0.5) this.laps[i] += 1;
      else if (d > 0.5) this.laps[i] -= 1;
      this.frac[i] = fr;
    }
  }
  at(i) { return this.laps[i] + this.frac[i]; }
  all() { return this.laps.map((l, i) => l + this.frac[i]); }
}

/**
 * SECOND, TOTALLY INDEPENDENT TRUTH — never touches `lapT`.
 * Integrates each kart's own along-track displacement: the 3D step
 * Δposition dotted with the centreline tangent, divided by (1 - kappa*lateral)
 * to convert the kart's own path length into CENTRELINE arc (a kart on the
 * inside of a corner covers more centreline than ground; see ARC_EPS).
 * `lapT`/`lateral` are used only to look the geometry up, never as a position.
 */
class DispTruth {
  constructor(spline, bodies) {
    this.spline = spline;
    this.ds = 12 * spline.length / spline.N;   // arc between _buildCurvature's samples
    this.tan = new THREE.Vector3();
    this.value = bodies.map(() => 0);
    // Two-deep, for the same reason ProgressTracker is: `lapT` is sampled at the
    // TOP of body.update, so the geometry that goes with a step is the geometry
    // of the PREVIOUS pair of positions.
    this.p = bodies.map(b => ({ x: b.position.x, y: b.position.y, z: b.position.z }));
    this.q = this.p.map(o => ({ ...o }));
    this.t = bodies.map(b => b.lapT);
    this.lat = bodies.map(b => b.lateral);
  }
  step(bodies) {
    for (let i = 0; i < bodies.length; i++) {
      const dx = this.p[i].x - this.q[i].x, dy = this.p[i].y - this.q[i].y, dz = this.p[i].z - this.q[i].z;
      this.spline.tangentAt(this.t[i], this.tan);
      const along = dx * this.tan.x + dy * this.tan.y + dz * this.tan.z;
      const kappa = this.spline.curvatureAt(this.t[i]) / this.ds;     // signed, + = right
      const fac = Math.max(0.4, Math.min(2.5, 1 / (1 - kappa * this.lat[i])));
      this.value[i] += along * fac;
      this.q[i] = this.p[i];
      const b = bodies[i];
      this.p[i] = { x: b.position.x, y: b.position.y, z: b.position.z };
      this.t[i] = b.lapT; this.lat[i] = b.lateral;
    }
  }
}

/**
 * One headless race with the full spatial audit running on every step.
 * Sequencing is race.js's exactly: player.update, then field.update(dt, player).
 */
function audit({ track, seed, difficulty = 2, pace = 1, laps = 3, maxTime = 400 }) {
  const { def, spline } = getTrack(track);
  const startT = def.startT ?? 0;
  const lapLen = spline.length;
  const FLOOR = floorFor(spline);
  const slots = gridSlots(spline, def, 8);
  const racer = ROSTER[0];
  const surface = def?.theme === 'cloud' ? 'cloud' : def?.theme === 'circuit' ? 'grass' : 'sand';
  const player = new KartBody({ spline, stats: racer.stats, startSlot: slots[0], surface });
  player.p.topSpeed *= pace;
  player.p.accelPower *= pace;

  const field = createAIField(spline, def, null, {
    difficulty, playerRacerId: racer.id, slots, playerSlot: 0, seed,
  });
  const N = field.drivers.length;      // 7 opponents
  const PL = N;                        // the player's index everywhere in here
  const idxOf = new Map();
  field.drivers.forEach((d, i) => idxOf.set(d, i));
  const labels = [...field.drivers.map(d => d.racer.id), 'PLAYER'];
  const label = i => labels[i];
  const bodies = [...field.bodies, player];

  // --mutate=origin: put the accumulators back exactly where the bug had them.
  let mutProg = 0, mutPrev = player.lapT;
  if (MUTATE) for (const d of field.drivers) d.progress = 0;

  // --mutate=phase: commit each AI's progress from the state its body had
  // BEFORE it was stepped — i.e. exactly what accumulating inside
  // AIDriver.update did. Implemented by snapshotting each body at the top of
  // field.update and feeding the tracker that stand-in instead.
  if (MUT_PHASE) {
    const real = field.update.bind(field);
    field.update = (dt, ps) => {
      const stale = field.drivers.map(d => ({
        lapT: d.body.lapT, speed: d.body.speed, offTrack: d.body.offTrack,
        position: { x: d.body.position.x, y: d.body.position.y, z: d.body.position.z },
      }));
      field.drivers.forEach((d, i) => { d.commitProgress = (s) => d._prog.step(s, stale[i]); });
      return real(dt, ps);
    };
  }

  // ---- C. grid fairness, one step off the line ---------------------------
  const gridLapTs = [...field.bodies.map(b => b.lapT), player.lapT];
  const gridTruth = new ArcTruth(startT, gridLapTs);
  // The PLAYER's seed is READ OUT OF THE FIELD, not recomputed here — a row that
  // recomputes it is a self-test on that row. The field has not met the player
  // until its first update, so the seeds and the truth they are graded against
  // are BOTH taken one step after the lights, when the karts have moved 5 mm.
  let gridSeed = null, gridSeedTruth = null;

  // ---- the run -----------------------------------------------------------
  const snap = new Array(N + 1);
  const readSnap = () => {
    for (let i = 0; i < N; i++) snap[i] = field.bodies[i].lapT;
    snap[PL] = player.lapT;
    return snap.slice();
  };
  const readProg = (rows) => {
    const out = new Array(N + 1);
    for (const r of rows) out[r.driver ? idxOf.get(r.driver) : PL] = r.progress;
    return out;
  };

  let t = 0;
  let preTruth = null;                                // pre-field.update phase
  let postTruth = new ArcTruth(startT, readSnap());   // the phase the game reads
  let prevPost = postTruth.all();
  const disp = new DispTruth(spline, bodies);
  let prevProg = null, dispBase = null;

  // 2-deep position/speed history, for section D's physical bound. Same reason
  // as DispTruth's: `lapT` lags `position` by one step.
  let hp = bodies.map(b => ({ x: b.position.x, y: b.position.y, z: b.position.z }));
  let hq = hp.map(o => ({ ...o }));
  let hspeed = bodies.map(() => 0);
  let prevOff = bodies.map(b => !!b.offTrack);

  let steps = 0;
  let postViol = 0, postWorst = 0, postWorstAt = null;   // A: on-track pairs
  let preViol = 0, preWorst = 0;
  let resid = 0, residAt = null;                          // A: on-track residual
  let offResid = 0;                                       // diagnostic
  let anyViol = 0, anyWorst = 0;                          // diagnostic, all pairs
  let bound = 0, boundWorst = 0, boundAt = null, recon = 0, reconWorst = 0;
  let dispWorst = 0;
  const crossT = new Array(N + 1).fill(null);
  const crossPlaceSeen = new Array(N + 1).fill(null);
  const crossPlaceTrue = new Array(N + 1).fill(null);

  while (t < maxTime && crossT.some(x => x == null)) {
    player.update(DT, autopilotInput(player, spline, { drift: true }));

    // PHASE BOUNDARY: the player has moved this step, the AI has not.
    const pre = readSnap();
    if (!preTruth) preTruth = new ArcTruth(startT, pre);
    else preTruth.step(pre);
    const preRows = field.order();
    const preSeq = preRows.map(r => (r.driver ? idxOf.get(r.driver) : PL));
    if (steps > 2) {
      const tv = preTruth.all();
      const off = bodies.map(b => !!b.offTrack);
      for (let i = 0; i + 1 < preSeq.length; i++) {
        if (off[preSeq[i]] || off[preSeq[i + 1]]) continue;
        const d = (tv[preSeq[i + 1]] - tv[preSeq[i]]) * lapLen;
        if (d > TIE_M) { preViol++; if (d > preWorst) preWorst = d; }
      }
    }

    if (MUTATE) {
      mutProg += TrackSpline.deltaT(player.lapT, mutPrev);
      mutPrev = player.lapT;
      field.update(DT, { body: player, progress: mutProg });
    } else {
      field.update(DT, player);
    }
    t += DT;
    steps++;

    const rows = field.order();
    const seq = rows.map(r => (r.driver ? idxOf.get(r.driver) : PL));
    const prog = readProg(rows);
    postTruth.step(readSnap());
    const post = postTruth.all();
    if (!gridSeed) { gridSeed = prog.slice(); gridSeedTruth = post.slice(); }
    disp.step(bodies);
    if (dispBase == null) { dispBase = prog.slice(); disp.value = disp.value.map(() => 0); }
    const offNow = bodies.map(b => !!b.offTrack);

    // ---- A. ranking truth at the phase the game reads --------------------
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = post[seq[i]], b = post[seq[i + 1]];
      const deficitM = (b - a) * lapLen;    // > 0 => the kart ranked AHEAD is BEHIND
      if (deficitM > TIE_M) {
        anyViol++; if (deficitM > anyWorst) anyWorst = deficitM;
        if (offNow[seq[i]] || offNow[seq[i + 1]]) continue;
        postViol++;
        if (deficitM > postWorst) {
          postWorst = deficitM;
          postWorstAt = `${label(seq[i])} ranked ahead of ${label(seq[i + 1])} while ${f(deficitM, 2)} m behind it (t=${f(t, 1)}s)`;
        }
      }
    }
    // ...and the residual behind it: an on-track kart's progress IS its projection.
    for (let i = 0; i <= N; i++) {
      const r = Math.abs(prog[i] - post[i]) * lapLen;
      if (offNow[i]) { if (r > offResid) offResid = r; continue; }
      if (r > resid) { resid = r; residAt = `${labels[i]} t=${f(t, 1)}s`; }
    }

    // ---- D. per-step physical bound --------------------------------------
    if (prevProg && steps > 2) {
      for (let i = 0; i <= N; i++) {
        const dx = hp[i].x - hq[i].x, dy = hp[i].y - hq[i].y, dz = hp[i].z - hq[i].z;
        const ground = Math.max(Math.hypot(dx, dy, dz), Math.abs(hspeed[i]) * DT);
        let cap = ground * (1 + ARC_EPS) + FLOOR;
        // A kart OFF the road is additionally allowed to converge on its own
        // projection at REANCHOR_MPS...
        if (prevOff[i]) cap += REANCHOR_MPS * DT;
        const dM = (prog[i] - prevProg[i]) * lapLen;
        // ...and the single step on which it REJOINS the road may take the whole
        // remaining offset out at once, because on the road the projection is
        // the truth. Counted, and required to land ON the projection.
        if (prevOff[i] && !offNow[i] && Math.abs(dM) > cap) {
          recon++;
          const land = Math.abs(prog[i] - post[i]) * lapLen;
          if (land > reconWorst) reconWorst = land;
          continue;
        }
        if (Math.abs(dM) > cap + 1e-9) {
          bound++;
          const over = Math.abs(dM) - cap;
          if (over > boundWorst) {
            boundWorst = over;
            boundAt = `${labels[i]} advanced ${f(dM, 2)} m of arc for ${f(ground, 2)} m of ground (t=${f(t, 1)}s, ${offNow[i] ? 'off' : 'on'}-track)`;
          }
        }
        // displacement truth, cumulative
        const e = Math.abs((prog[i] - dispBase[i]) * lapLen - disp.value[i]);
        if (e > dispWorst) dispWorst = e;
      }
    }
    for (let i = 0; i <= N; i++) {
      hq[i] = hp[i];
      hp[i] = { x: bodies[i].position.x, y: bodies[i].position.y, z: bodies[i].position.z };
      hspeed[i] = bodies[i].speed || 0;
    }
    prevOff = offNow;
    prevProg = prog;

    // ---- B. physical crossings -------------------------------------------
    for (let i = 0; i <= N; i++) {
      if (crossT[i] == null && prevPost[i] < laps && post[i] >= laps) {
        const frv = (laps - prevPost[i]) / (post[i] - prevPost[i]);
        crossT[i] = t - DT * (1 - frv);
        crossPlaceTrue[i] = 1 + crossT.filter((x, j) => j !== i && x != null && x < crossT[i]).length;
        crossPlaceSeen[i] = seq.indexOf(i) + 1;
      }
    }
    prevPost = post;
  }

  let gridWorstM = 0;
  for (let i = 0; i <= N; i++) {
    gridWorstM = Math.max(gridWorstM, Math.abs((gridSeed?.[i] ?? 0) - (gridSeedTruth?.[i] ?? 0)) * lapLen);
  }

  const finished = crossT.map((x, i) => [x == null ? Infinity : x, i]).sort((a, b) => a[0] - b[0]);
  const playerPlace = finished.findIndex(o => o[1] === PL) + 1;
  const margin = Math.abs((crossT[finished[0][1]] ?? 0) - (crossT[finished[1][1]] ?? Infinity));
  const playerMargin = playerPlace === 1
    ? (crossT[finished[1][1]] ?? Infinity) - crossT[PL]
    : crossT[PL] - (crossT[finished[playerPlace - 2][1]] ?? -Infinity);

  const out = {
    track, seed, pace, steps, lapLen,
    postViol, postWorst, postWorstAt, preViol, preWorst, anyViol, anyWorst,
    resid, residAt, offResid, bound, boundWorst, boundAt, recon, reconWorst, dispWorst,
    gridWorstM, gridSeed, gridSeedTruth, gridTruth: gridTruth.all(),
    crossT, crossPlaceSeen, crossPlaceTrue, playerPlace, margin, playerMargin,
    order: finished.map(o => o[1]), label, labels,
    misrecorded: crossPlaceSeen.filter((p, i) => p != null && p !== crossPlaceTrue[i]).length,
  };
  field.dispose();
  return out;
}

// ===========================================================================
console.log(`\n=== SPATIAL TRUTH GATE ===  ai=${AI_PATH || 'src/kart/ai.js'}${MUT ? `  [MUTANT: ${MUT}]` : ''}`);
console.log(`tie tolerance ${TIE_M} m of arc; physical bound = ground x ${1 + ARC_EPS} + one sample spacing\n`);

// --mutate=jump: strip the per-step bound and the re-anchor out of the tracker,
// leaving the raw `lapT` integral the pre-fix code had. Nothing else changes.
if (MUT_JUMP) {
  if (!aiMod.ProgressTracker) { console.error('--mutate=jump needs ai.js to export ProgressTracker'); process.exit(2); }
  aiMod.ProgressTracker.prototype.step = function (dt, body) {
    const t = body.lapT;
    const raw = TrackSpline.deltaT(t, this._prevT) * this.lapLen;
    this.value += raw / this.lapLen;
    this._prevT = t;
    this._qx = this._px; this._qz = this._pz;
    this._px = body.position.x; this._pz = body.position.z;
    this._prevSpeed = body.speed || 0;
    return raw;
  };
}

// --- A + C + D: one pass over 3 tracks x 4 seeds ----------------------------
console.log('=== A. CONTINUOUS RANKING TRUTH, AT THE PHASE THE GAME READS ===');
console.log(pad('track', 9) + pad('seed', 6) + padL('steps', 8) + padL('bad pairs', 11) +
  padL('worst lie (m)', 15) + padL('residual (m)', 14) + padL('pre-phase bad', 15));
let totalSteps = 0, postViol = 0, postWorst = 0, postMsg = null;
let preViol = 0, preWorst = 0, resid = 0, residMsg = null, offResid = 0;
let anyViol = 0, anyWorst = 0;
let bound = 0, boundWorst = 0, boundMsg = null, recon = 0, reconWorst = 0, dispWorst = 0;
let gridWorst = 0;
const runs = [];
for (const track of TRACKS) {
  for (const seed of SEEDS) {
    const r = audit({ track, seed, difficulty: 2 });
    runs.push(r);
    totalSteps += r.steps;
    postViol += r.postViol; preViol += r.preViol; anyViol += r.anyViol;
    bound += r.bound; recon += r.recon;
    if (r.postWorst > postWorst) { postWorst = r.postWorst; postMsg = r.postWorstAt; }
    if (r.preWorst > preWorst) preWorst = r.preWorst;
    if (r.resid > resid) { resid = r.resid; residMsg = r.residAt; }
    if (r.boundWorst > boundWorst) { boundWorst = r.boundWorst; boundMsg = r.boundAt; }
    offResid = Math.max(offResid, r.offResid);
    anyWorst = Math.max(anyWorst, r.anyWorst);
    reconWorst = Math.max(reconWorst, r.reconWorst);
    dispWorst = Math.max(dispWorst, r.dispWorst);
    gridWorst = Math.max(gridWorst, r.gridWorstM);
    console.log(pad(r.track, 9) + pad(r.seed, 6) + padL(r.steps, 8) + padL(r.postViol, 11) +
      padL(f(r.postWorst, 2), 15) + padL(f(r.resid, 3), 14) + padL(r.preViol, 15));
  }
}
assert(postViol === 0,
  `order() matched the tarmac for every pair of ON-TRACK karts on all ${totalSteps} steps ` +
  `(${postViol} disagreements` + (postMsg ? `; worst: ${postMsg}` : '') + ')');
assert(postWorst <= TIE_M,
  `no on-track kart was ever ranked ahead of one it was behind by more than ${TIE_M} m (worst ${f(postWorst, 3)} m)`);
assert(resid <= TIE_M,
  `every on-track kart's progress IS its own centreline projection (worst residual ${f(resid, 4)} m` +
  (residMsg ? `, ${residMsg}` : '') + `; the phase skew alone put this at 0.855 m)`);
// The counter-check on the sampling phase. If the accumulators went back to
// being written before the bodies move, THIS is the number that would go to
// zero while the assertion above went red.
assert(preViol > 0,
  `the accumulators describe the END of the step, not the start (the pre-field.update ` +
  `audit disagrees ${preViol} times, worst ${f(preWorst, 2)} m — it is the wrong phase, and the game does not read it)`);
console.log(`  (diagnostic: including pairs where a kart is OFF the road, ${anyViol} disagreements, worst ${f(anyWorst, 2)} m — ` +
  `that is closestT()'s ignored hintT, in trackdef.js. Worst off-road residual ${f(offResid, 2)} m.)`);

// --- C. GRID FAIRNESS -------------------------------------------------------
console.log('\n=== C. GRID FAIRNESS (seeded progress == true arc offset) ===');
console.log(pad('track', 9) + padL('worst seed error (m)', 24) + padL('spread of true offsets (m)', 30));
for (const track of TRACKS) {
  const r = runs.find(x => x.track === track && x.seed === SEEDS[0]);
  const tr = r.gridTruth.map(x => x * r.lapLen);
  console.log(pad(r.track, 9) + padL(f(r.gridWorstM, 3), 24) +
    padL(`${f(Math.min(...tr), 1)} .. ${f(Math.max(...tr), 1)}`, 30));
}
assert(gridWorst <= TIE_M,
  `every kart's seeded progress — the PLAYER's read out of field.order(), not recomputed here — ` +
  `is its true arc offset from the line (worst error ${f(gridWorst, 3)} m <= ${TIE_M} m)`);
{
  let bad = 0, worst = 0;
  for (const r of runs) {
    const idx = r.gridSeed.map((_, i) => i).sort((a, b) => r.gridSeed[b] - r.gridSeed[a]);
    for (let i = 0; i + 1 < idx.length; i++) {
      const d = (r.gridSeedTruth[idx[i + 1]] - r.gridSeedTruth[idx[i]]) * r.lapLen;
      if (d > TIE_M) { bad++; worst = Math.max(worst, d); }
    }
  }
  assert(bad === 0,
    `on the grid, seeded progress orders the 8 karts exactly as the tarmac does (${bad} inversions, worst ${f(worst, 2)} m)`);
}

// --- D. PHYSICAL BOUND ------------------------------------------------------
console.log('\n=== D. PHYSICAL BOUND (no step credits arc the kart could not cover) ===');
console.log(`  steps audited ${totalSteps * 8}; over-bound steps ${bound}; ` +
  `rejoin reconciliations ${recon} (worst landing error ${f(reconWorst, 3)} m)`);
assert(bound === 0,
  `no kart ever advanced its progress by more than ground x ${1 + ARC_EPS} + one sample spacing ` +
  `in a single 1/60 s step (${bound} violations` + (boundMsg ? `; worst: ${boundMsg}` : '') + ')');
assert(reconWorst <= TIE_M,
  `every off-road kart that rejoined the tarmac landed exactly on its projection ` +
  `(${recon} rejoin steps, worst landing error ${f(reconWorst, 4)} m)`);
// The second truth. It never reads lapT as a position — it integrates
// Δposition·tangent. It is COARSE (the curvature correction is a first-order
// one, and over a 3.5 km race the two disagree by a few metres on geometry
// alone), so it is asserted at a bound that catches a gross leak, not a subtle
// one. Measured: 1.5-8.6 m per race across the 12 cells.
assert(dispWorst < 15,
  `progress tracked each kart's own along-track displacement over the whole race ` +
  `(worst |Δprogress - Δdisplacement| ${f(dispWorst, 2)} m over ~3.4 km, bound 15 m)`);

// --- B. PHOTO FINISH --------------------------------------------------------
const PHOTO = [
  { track: 'circuit', seed: 41, pace: 1.14, want: 'top two split by one frame' },
  { track: 'oasis', seed: 41, pace: 1.06, want: 'player wins narrowly' },
  { track: 'oasis', seed: 7, pace: 1.06, want: 'player loses narrowly' },
  { track: 'cloud', seed: 3, pace: 1.02, want: 'player loses narrowly, cloud' },
];
console.log('\n=== B. PHOTO FINISH (recorded standings == physical crossing order) ===');
console.log(pad('track', 9) + pad('seed', 6) + pad('pace', 7) + padL('player', 8) +
  padL('top-2 margin', 14) + padL('player margin', 15) + padL('misrecorded', 13));
let photoBad = 0, closest = Infinity, sawPlayerWin = false, sawPlayerLose = false;
for (const cfg of PHOTO) {
  const r = audit({ track: cfg.track, seed: cfg.seed, pace: cfg.pace, difficulty: 2 });
  photoBad += r.misrecorded;
  closest = Math.min(closest, r.margin);
  if (r.playerPlace === 1) sawPlayerWin = true;
  if (r.playerPlace > 1 && Math.abs(r.playerMargin) < 1.0) sawPlayerLose = true;
  console.log(pad(r.track, 9) + pad(r.seed, 6) + pad(f(r.pace, 2), 7) + padL(r.playerPlace, 8) +
    padL(f(r.margin, 3) + 's', 14) + padL(f(r.playerMargin, 3) + 's', 15) + padL(r.misrecorded, 13));
  assert(r.misrecorded === 0,
    `${cfg.track}/${cfg.seed} (${cfg.want}): every kart's recorded place is its physical crossing place`);
  const winner = r.order[0];
  assert(r.crossPlaceSeen[winner] === 1,
    `${cfg.track}/${cfg.seed}: the recorded winner (${r.label(winner)}) is the kart that physically crossed first`);
}
assert(closest < 0.40,
  `at least one of the pinned finishes really is a photo finish (closest top-two margin ${f(closest, 3)}s < 0.40s)`);
assert(sawPlayerWin, 'one pinned finish has the player winning');
assert(sawPlayerLose, 'one pinned finish has the player losing by under a second');
assert(photoBad === 0, `no recorded place disagreed with the tarmac in any photo finish (${photoBad})`);

// --- E. THE REAL GAME -------------------------------------------------------
// Sections A-D drive ai.js directly, so race.js's own seed (`S.progress`), its
// own per-step guard, `updatePositions`, the position toast and `finishPlayer`
// are all invisible to them. A regression in that half would corrupt the HUD
// position, the rival gaps and the projected result times with nothing going
// red. This section drives the REAL BUILD and audits them.
if (!NO_DIST) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const distArg = arg('dist', null);
  const dist = distArg ? path.resolve(process.cwd(), distArg) : path.resolve(root, 'dist/index.html');
  console.log(`\n=== E. THE REAL GAME (race.js's own progress seam) ===  ${distArg || 'dist/index.html'}`);
  if (!existsSync(dist)) {
    console.log(`  ✗ FAIL: build missing (${dist}) — run npm run build, or pass --no-dist`);
    failures++; assertions++;
  } else {
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1024, height: 640 });
      // 120 s, not 60: measured, a machine running six copies of this gate plus
      // a CPU load takes over a minute to boot SwiftShader and this build, and a
      // navigation timeout there crashes the gate outright — the same
      // "red because the machine is busy" failure the probe below was fixed for.
      // Still bounded, so a build that genuinely never boots still fails.
      await page.goto('file://' + dist, { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 120000 });
      await page.evaluate(() => window.__DEBUG.goto('race', { track: 0, autopilot: true, quality: 'low' }));
      await new Promise(r => setTimeout(r, 400));

      // Sample INSIDE the page, once per fixed step, by wrapping the scene's own
      // update. Round-tripping 1/60 s at a time through the driver would take
      // minutes; this takes one evaluate.
      const raw = await page.evaluate(async (secs) => {
        const D = window.__DEBUG, s = D.engine.active;
        const out = [];
        const orig = s.update.bind(s);
        // index 0 = the player, 1..7 = s.aiKarts in their own order.
        const idOf = new Map(s.aiKarts.map((k, i) => [k.racer.id, i + 1]));
        s.update = (dt) => {
          orig(dt);
          const rows = s.field.order();
          const karts = [s.player, ...s.aiKarts.map(k => k.body)];
          out.push({
            prog: s.state.progress,
            rt: s.state.raceTime,
            pos: s.state.position,
            phase: s.state.phase,
            finished: !!s.state.finished,
            frozen: !!s.state.quizFrozen || !!s.state.paused,
            fieldPlayer: (rows.find(r => r.isPlayer) || {}).progress,
            rank: rows.findIndex(r => r.isPlayer) + 1,
            ord: rows.map(r => (r.isPlayer ? 0 : idOf.get(r.racer.id))),
            k: karts.map(b => [b.lapT, b.position.x, b.position.y, b.position.z, b.speed, b.offTrack ? 1 : 0]),
          });
        };
        // Dismiss anything that owns the screen. This is tools/flowtest.mjs's
        // playerBeat, inlined: without it the first quiz panel freezes the sim
        // and this section audits 14 seconds of race instead of a whole one.
        const beat = () => {
          const present = el => el && el.offsetParent !== null &&
            getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
          const visible = el => present(el) && +getComputedStyle(el).opacity > 0.05;
          for (const sel of ['.grgtok-scrim', '.grg-meet-scrim', '.qzint-scrim', '.ic-scrim', '[data-onetime]']) {
            const scrim = document.querySelector(sel);
            if (present(scrim)) {
              const b = scrim.querySelector('button');
              if (b) { b.click(); return; }
              if (typeof scrim.close === 'function') { scrim.close(); return; }
            }
          }
          if (visible(document.querySelector('.quiz-card.quiz-answered'))) {
            dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
            return;
          }
          if (visible(document.querySelector('.quiz-q'))) {
            const slot = s.quiz?.correctSlot;
            const n = (typeof slot === 'number' && slot >= 0 && slot <= 2) ? slot + 1 : 1;
            dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit' + n, key: String(n), bubbles: true }));
          }
        };
        for (let i = 0; i < secs; i++) {
          D.advance(1); beat(); await new Promise(r => setTimeout(r, 0));
          if (window.__LAST_RESULT__) break;
        }
        s.update = orig;
        return out;
      }, 220);

      const samples = raw.filter(x => x.phase === 'racing' || x.phase === 'finished');
      const { def, spline } = getTrack(0);
      const startT = def.startT ?? 0, lapLen = spline.length, FLOOR = floorFor(spline);
      console.log(`  ${samples.length} steps captured from the real build, ` +
        `${f(samples[samples.length - 1].rt, 1)}s of race time, ` +
        `${samples.filter(x => x.finished).length} after the flag`);

      // 0. COVERAGE. A section that silently audited two seconds would be worse
      //    than no section at all.
      assert(samples.length > 500 && samples[samples.length - 1].rt > 60,
        `the audit actually drove a race (${samples.length} steps, ${f(samples[samples.length - 1].rt, 1)}s of race time, bar 60s)`);

      // 1. THE SEAM. race.js keeps its OWN accumulator (S.progress); the field
      //    keeps the player's too. They are committed at the same instant and
      //    must be the same number — every rival gap and every projected finish
      //    time in finishPlayer() is a DIFFERENCE between the two families.
      let seam = 0, seamWorst = 0;
      for (const s of samples) {
        const d = Math.abs(s.prog - s.fieldPlayer) * lapLen;
        if (d > TIE_M) { seam++; if (d > seamWorst) seamWorst = d; }
      }
      assert(seam === 0,
        `race.js's S.progress and the field's own player progress are the same number on every step ` +
        `(${seam} disagreements, worst ${f(seamWorst, 3)} m)`);

      // 2. THE HUD. updatePositions() takes S.position straight out of
      //    field.order(); the toast and the results screen both read it. Only
      //    while the sim is actually running — a quiz panel or the pause menu
      //    freezes updatePositions on purpose.
      let posBad = 0, posN = 0, posMsg = '';
      let prt = null;
      for (const s of samples) {
        const ran = prt == null || s.rt - prt > 1e-9;
        prt = s.rt;
        // rank 0 == field.order() has no player row yet (the field meets the human
        // on its first update, which is one step after the scene exists).
        if (!ran || s.rank === 0 || s.phase !== 'racing' || s.finished || s.frozen) continue;
        posN++;
        if (s.pos !== s.rank) { posBad++; if (!posMsg) posMsg = `first at t=${f(s.rt, 2)}s: S.position=${s.pos}, order() index ${s.rank}`; }
      }
      assert(posBad === 0,
        `S.position is the player's index in field.order() on every one of ${posN} live steps (${posBad} disagreements${posMsg ? '; ' + posMsg : ''})`);

      // 3. THE TARMAC, in the real game. Same on-track ranking contract as A,
      //    but on the bodies the child is actually looking at, ordered by the
      //    game's own field.order().
      const truth = new ArcTruth(startT, samples[0].k.map(k => k[0]));
      let rankBad = 0, rankWorst = 0, residBad = 0, residWorst = 0;
      for (const s of samples) {
        truth.step(s.k.map(k => k[0]));
        const tv = truth.all();
        const seq = s.ord;
        for (let i = 0; i + 1 < seq.length; i++) {
          if (s.k[seq[i]][5] || s.k[seq[i + 1]][5]) continue;
          const d = (tv[seq[i + 1]] - tv[seq[i]]) * lapLen;
          if (d > TIE_M) { rankBad++; if (d > rankWorst) rankWorst = d; }
        }
        const pr = Math.abs(s.prog - tv[0]) * lapLen;
        if (!s.k[0][5] && pr > TIE_M) { residBad++; if (pr > residWorst) residWorst = pr; }
      }
      assert(rankBad === 0,
        `in the real build, every pair of on-track karts is ranked as the tarmac ranks them ` +
        `(${rankBad} disagreements, worst ${f(rankWorst, 2)} m)`);
      assert(residBad === 0,
        `in the real build, the player's S.progress IS the player's own projection while on the road ` +
        `(${residBad} steps off, worst ${f(residWorst, 3)} m)`);

      // 4. RACE.JS'S HALF OF THE GUARD. Its old guard only dropped a step past
      //    0.3 LAPS (~350 m); every measured projection snap sailed through.
      let pBound = 0, pWorst = 0;
      let hq = null, hp = null, hs = 0, hoff = false, prev = null;
      for (const s of samples) {
        const k = s.k[0];
        if (hp && hq && prev != null) {
          const dx = hp[0] - hq[0], dy = hp[1] - hq[1], dz = hp[2] - hq[2];
          const ground = Math.max(Math.hypot(dx, dy, dz), Math.abs(hs) * DT);
          let cap = ground * (1 + ARC_EPS) + FLOOR;
          if (hoff) cap += REANCHOR_MPS * DT;
          const dM = Math.abs(s.prog - prev) * lapLen;
          const rejoin = hoff && !k[5];
          if (!rejoin && dM > cap + 1e-9) { pBound++; if (dM - cap > pWorst) pWorst = dM - cap; }
        }
        hq = hp; hp = [k[1], k[2], k[3]]; hs = k[4]; hoff = !!k[5]; prev = s.prog;
      }
      assert(pBound === 0,
        `race.js never advanced the player's progress past the physical bound in one step ` +
        `(${pBound} violations, worst overshoot ${f(pWorst, 2)} m)`);

      // 5. TELEPORT ABSORPTION — race.js's guard, exercised on purpose.
      //    A clean autopilot never leaves the road, so nothing in the run above
      //    can make the player's own projection snap; the critic's "the player
      //    nets 0.0 m only because it never leaves the road" is exactly this
      //    blind spot. So put the player 16 m off the road (where `closestT()`
      //    is a global nearest-sample lookup with nothing holding it to the
      //    branch the kart came from) and then shift it 10 m ALONG the track
      //    without it driving a centimetre. That is a projection jump, and the
      //    old guard here — drop the step only past 0.3 LAPS, ~350 m — passed
      //    every one of them straight through into S.progress.
      //
      //    LOAD INDEPENDENCE — why this probe opens by proving the sim is live.
      //    The probe used to teleport into whatever state the 220-second audit
      //    loop above happened to exit in, and that state is NOT deterministic
      //    even though `__DEBUG.advance` is: race.js's `update()` emits ZERO
      //    fixed steps while a quiz panel owns the screen (time scale 0, D11/D20),
      //    the panel is dismissed by a DOM beat whose own visibility test reads a
      //    CSS opacity — i.e. WALL clock — and the finish hands the scene over to
      //    results on a 2200 ms wall-clock `setTimeout`. On a loaded machine
      //    (reproduced with six concurrent copies of this gate, ~1 run in 6) the
      //    loop exited with the world frozen, `put()` moved a body nothing was
      //    going to re-project, and the two PRECONDITIONS went red —
      //    `offTrack=false`, `lapT jumped 0.0 m` — while the contract they exist
      //    to guard was never exercised at all. A gate that reports a red for a
      //    busy machine is a gate people learn to re-run.
      //    The flake has two halves, and both are "a step that did not simulate":
      //      * the world is already frozen when the probe starts, so `put()` moves
      //        a body nothing re-projects (`offTrack=false`);
      //      * the world freezes DURING the probe — the kart drives through a
      //        beacon on one of the five steps and a question opens — so the
      //        second `put()` is never taken up (`lapT jumped 0.0 m`), which is
      //        the residual seen once in six runs after the first half was fixed.
      //    So the probe (a) clears whatever owns the screen through the scene's
      //    OWN api rather than through CSS-timed DOM state, (b) checks EVERY one
      //    of its own steps for liveness, and (c) retries the five-step
      //    PRECONDITION, bounded, if any of those steps turned out to be dead.
      //    The teleport measurement the three assertions below read is a single
      //    uninterrupted run — no assertion is averaged, retried or relaxed, and
      //    a genuine regression reproduces on all eight attempts and is reported
      //    from the last one. If liveness cannot be reached at all, the probe
      //    fails loudly with the reason instead of blaming the contract.
      const tp = await page.evaluate(async (freezeFirst) => {
        const D = window.__DEBUG, s = D.engine.active;
        // The finish hands over to the results scene 2.2s of WALL time after
        // __LAST_RESULT__ appears, and the loop above stops the moment it does.
        if (!s || !s.player || !s.state || typeof s.state.progress !== 'number') {
          return { fatal: `the active scene is not a race (${D.engine.activeName})` };
        }
        const b = s.player, sp = b.spline;
        const put = (t, lat) => { const p = sp.offsetPoint(t, lat); b.position.x = p.x; b.position.z = p.z; };
        // Clear whatever owns the screen. The quiz is closed through its OWN
        // API rather than by playing the panel: `quiz.close()` is the documented
        // "force the panel shut immediately, skipping the countdown" seam, and
        // it is the only route here that involves no CSS clock at all. Playing
        // the panel the way flowtest's beat does cannot be relied on for this:
        // measured, a question opened by `openQuestion()` keeps `.quiz-q` at
        // `visibility: hidden` for its whole life and does not become answerable
        // for 8 s of stepped time, then holds the freeze through feedback and a
        // 3·2·1 — a DOM beat gated on visibility never presses a key at all, and
        // that is precisely how the load flake survived. One-time popups are
        // still dismissed through the DOM (a button click is synchronous), and
        // by PRESENCE rather than opacity, because an opacity ramp is a
        // transition, i.e. wall clock, i.e. the load dependence itself.
        const dismiss = () => {
          if (s.quiz?.frozen) { s.quiz.close(); return; }
          const present = el => el && el.offsetParent !== null &&
            getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
          for (const sel of ['.grgtok-scrim', '.grg-meet-scrim', '.qzint-scrim', '.ic-scrim', '[data-onetime]']) {
            const scrim = document.querySelector(sel);
            if (present(scrim)) {
              const btn = scrim.querySelector('button');
              if (btn) { btn.click(); return; }
              if (typeof scrim.close === 'function') { scrim.close(); return; }
            }
          }
        };
        // --mutate=probefreeze: put a question on the screen, which is the exact
        // state (quiz time scale 0, no fixed steps emitted) a loaded machine
        // used to leave behind.
        if (freezeFirst) { try { s.quiz?.openQuestion(); } catch { /* nothing to freeze */ } }
        // One fixed step, reporting whether it was a LIVE one: the world can
        // freeze again DURING the probe (a beacon the kart drives through on any
        // of the five steps below opens a question, and which step that lands on
        // is decided by where the audit loop above happened to stop). A dead step
        // moves nothing, so it silently turns the teleport into a no-op — that is
        // the second half of the same flake, and it reads `lapT jumped 0.0 m`.
        let phase = s.state.phase, frozen = false, steps = 0;
        const step = () => {
          const t0 = b.lapT, x0 = b.position.x, z0 = b.position.z;
          D.advance(1 / 60);
          steps++;
          phase = s.state.phase;
          frozen = !!s.state.quizFrozen || !!s.state.paused;
          return !frozen && (phase === 'racing' || phase === 'finished') &&
            (b.lapT !== t0 || b.position.x !== x0 || b.position.z !== z0);
        };
        // 900 steps = 15 s of sim. Nothing should need more than a handful:
        // `quiz.close()` is immediate and a popup's button click is synchronous,
        // so the bound is there to fail loudly on a freeze this probe does not
        // know how to clear, not to wait one out.
        let live = false;
        for (let i = 0; i < 900 && !live; i++) { dismiss(); live = step(); }
        if (!live) {
          return { fatal: `the sim never took a live step (phase=${phase}, frozen=${frozen}, ${steps} steps tried)` };
        }
        // WHERE the probe fires must not depend on where the race happened to
        // stop either. `closestT()` is a global nearest-sample lookup, so "16 m
        // sideways" is not the same experiment everywhere on the lap: where the
        // road folds back on itself the displaced point projects onto the OTHER
        // branch, and the 10 m shift along the road then reads as 3.0 m, or as
        // nothing at all — measured, twice in eighteen loaded runs, with every
        // step of the probe live. That is a load dependence in the GEOMETRY the
        // sim happened to stop on rather than in the sim. So the spot is chosen
        // by geometry instead: the first lap position (of 512, scanned in a
        // fixed order) where a 16 m lateral offset projects back onto the
        // centreline it came from — to within 1 m — over the whole -4..+14 m
        // window the probe uses, which is wide enough that the four settle steps
        // of drift cannot walk out of it. Same spot on every machine, every run.
        const LEN = sp.length, LAT = 16;
        const dT = (a, c) => { let d = a - c; while (d > 0.5) d -= 1; while (d < -0.5) d += 1; return d; };
        const roundTrips = t => {
          for (let m = -4; m <= 14; m++) {
            const tt = (((t + m / LEN) % 1) + 1) % 1;
            if (Math.abs(dT(sp.closestT(sp.offsetPoint(tt, LAT)).t, tt)) * LEN > 1.0) return false;
          }
          return true;
        };
        let T0 = null;
        for (let i = 0; i < 512 && T0 === null; i++) { if (roundTrips(i / 512)) T0 = i / 512; }
        if (T0 === null) {
          return { fatal: 'no lap position projects a 16 m lateral offset back onto its own branch' };
        }
        // The teleport, on a sim that is provably stepping. `attempt` re-runs the
        // PRECONDITION — and only the precondition: a run whose five steps were
        // all live produces exactly one measurement, and the three assertions
        // below see it exactly once. A genuine regression (the guard banks the
        // jump, or the projection stops moving) reproduces on every attempt and
        // still goes red on the last one.
        let out = null;
        for (let attempt = 0; attempt < 8 && !out; attempt++) {
          for (let i = 0; i < 900 && !live; i++) { dismiss(); live = step(); }
          put(T0, LAT);                          // off the road, sideways
          let ok = true;
          for (let i = 0; i < 4; i++) ok = step() && ok;
          const before = s.state.progress, t1 = b.lapT, off = !!b.offTrack;
          put(b.lapT + 10 / LEN, LAT);           // 10 m up the road, no driving
          ok = step() && ok;
          const r = {
            gainM: (s.state.progress - before) * sp.length, off,
            jumpM: ((b.lapT - t1 + 1.5) % 1 - 0.5) * sp.length, speed: b.speed,
            steps, phase, attempts: attempt + 1,
          };
          // Keep the last measurement whatever happens, so a real failure is
          // reported rather than swallowed; only a run that was interrupted by a
          // freeze is worth trying again.
          if (ok || attempt === 7) out = r;
          live = false;
        }
        return out;
      }, MUT_PROBEFREEZE === true);
      assert(!tp.fatal,
        `the teleport probe reached a live simulation step before teleporting ` +
        `(${tp.fatal || `${tp.steps} step${tp.steps === 1 ? '' : 's'} stepped, ${tp.attempts} attempt${tp.attempts === 1 ? '' : 's'}, phase ${tp.phase}`})`);
      assert(tp.off, `the teleport probe really did put the player off the road (offTrack=${tp.off})`);
      assert(tp.jumpM > 4,
        `the teleport really did move the player's projection (lapT jumped ${f(tp.jumpM, 1)} m of arc, bar 4 m)`);
      assert(tp.gainM < 1.0,
        `race.js absorbed the ${f(tp.jumpM, 1)} m projection jump instead of banking it ` +
        `(S.progress gained ${f(tp.gainM, 2)} m in that step, bar 1.0 m)`);
    } finally {
      await browser.close();
    }
  }
} else {
  console.log('\n=== E. THE REAL GAME === SKIPPED (--no-dist)');
}

// ===========================================================================
console.log(`\n${assertions} assertions, ${failures} failed.`);
if (failures) { console.log('✗ SPATIAL TRUTH GATE RED'); process.exit(1); }
console.log('✓ spatial truth gate green');

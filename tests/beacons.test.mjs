// QUIZ-BEACON RUNWAY (Wave 3)
//
// A quiz beacon freezes the world so a child can read. Three seconds later the
// 3·2·1 hands the kart back, at the speed and on the heading it was frozen at —
// so the question "how much open road is in front of a beacon?" is the question
// of whether the teaching moment punishes the child for having stopped to read.
//
// The old placement (`startT + (i + 0.62)/6`) answered it by accident: it was
// chosen only to dodge the token clusters and never looked ahead at all. Half
// the beacons on the three tracks gave under ~1.1 seconds of straight-ahead
// drivable surface at the speed the freeze happens (20–29 m/s), and two on
// `circuit` sat on 0.27–0.38-radian corners.
//
// This test pins the property nothing used to look at. It measures runway with
// its OWN marching code — deliberately not quiz.js's, so the gate cannot pass by
// agreeing with a bug in the thing it is checking — and it needs no browser.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { planBeacons, BEACON_KEEPOUT_M } from '../src/race/quiz.js';
import { thinTokenSpots, TOKEN_CLUSTERS_PER_LAP } from '../src/race/race.js';

let fail = 0;
const ok = (name, cond, detail = '') => { if (!cond) fail++;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(52)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`); };

console.log('\n  QUIZ-BEACON RUNWAY\n  ' + '─'.repeat(72));

// The kart is frozen at 20–29 m/s; 28 is the top of that band and the number the
// placement rule is written against.
const SPEED = 28;
// Straight ahead, on the exact heading the freeze happened on.
const MIN_RUNWAY_M = 45;          // 1.61 s at 28 m/s
// …and with the ±6° of misalignment a child actually leaves a beacon with. A
// spot that only works dead straight is not a spot a child can use.
const MIN_CONE_M = 35;            // 1.25 s at 28 m/s
const YAW_DEG = 6;
const MIN_SEPARATION_M = 60;      // nudging forward must not bunch two beacons
const MARCH_M = 0.5;              // finer than the placement's own march
const MAX_MARCH_M = 200;
// Wave 6 — the race-opening layout rule. Written in seconds of drive and
// converted here at the SAME speed the runway rule uses, then asserted as an
// absolute so shrinking the shipped constant cannot make the gate agree.
const KEEPOUT_S = 3;
const KEEPOUT_M = KEEPOUT_S * SPEED;   // 84 m
const TOKEN_GROUPS = 8;                // trackbuild authors 8 clusters a lap

/** Metres of arc forward around the lap from `a` to `b`. */
const arc = (a, b, L) => (((b - a) % 1 + 1) % 1) * L;

// The cluster schedule is re-derived above from trackbuild's own formula, so pin
// that the formula is still the one trackbuild uses. Same shape as the
// finish-line gate: a layout rule asserted against a number typed in another
// file is a rule that rots the day that file is edited.
{
  const src = readFileSync(fileURLToPath(new URL('../src/track/trackbuild.js', import.meta.url)), 'utf8');
  ok('trackbuild still authors 8 clusters at startT + (g+0.5)/8',
    /const clusters = 8;/.test(src) && /\(startT \+ \(g2 \+ 0\.5\) \/ clusters\)/.test(src),
    'the cluster schedule this gate re-derives');
}

/** Independent measurement: metres of drivable road on a straight heading. */
function runway(spline, t, lateral, yawDeg) {
  const p = spline.offsetPoint(t, lateral);
  const dir = spline.tangentAt(t);
  if (yawDeg) {
    const a = (yawDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    dir.set(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c).normalize();
  }
  for (let d = MARCH_M; d <= MAX_MARCH_M; d += MARCH_M) {
    p.addScaledVector(dir, MARCH_M);
    const cl = spline.closestT(p);
    if (Math.abs(cl.lateral) > spline.widthAt(cl.t)) return d;   // left the road
  }
  return MAX_MARCH_M;
}

for (const id of ['oasis', 'circuit', 'cloud']) {
  const { def, spline } = getTrack(id);
  const L = spline.length;
  const startT = def.startT ?? 0;
  const plan = planBeacons(spline, startT, 6);

  ok(`${id}: six beacons`, plan.length === 6, `${plan.length}`);

  const straight = [], cones = [];
  for (const b of plan) {
    const s = runway(spline, b.t, b.lateral, 0);
    const c = Math.min(s, runway(spline, b.t, b.lateral, -YAW_DEG), runway(spline, b.t, b.lateral, YAW_DEG));
    straight.push(s); cones.push(c);
    ok(`${id}: beacon ${b.i} is on the road`,
       Math.abs(b.lateral) < spline.widthAt(b.t), `|lat| ${Math.abs(b.lateral).toFixed(1)}m of ${spline.widthAt(b.t).toFixed(1)}m`);
  }

  const worstS = Math.min(...straight), worstC = Math.min(...cones);
  ok(`${id}: every beacon has ${MIN_RUNWAY_M}m straight ahead`, worstS >= MIN_RUNWAY_M,
     `worst ${worstS.toFixed(0)}m = ${(worstS / SPEED).toFixed(2)}s at ${SPEED} m/s`);
  ok(`${id}: …and ${MIN_CONE_M}m across a ±${YAW_DEG}° cone`, worstC >= MIN_CONE_M,
     `worst ${worstC.toFixed(0)}m = ${(worstC / SPEED).toFixed(2)}s`);

  // Nudging a beacon forward must not walk it into the next one, and the order
  // around the lap must be preserved (the six segments stay six segments).
  const ts = plan.map(b => b.t);
  let minGap = Infinity;
  for (let i = 0; i < ts.length; i++) {
    const gap = ((ts[(i + 1) % ts.length] - ts[i] + 1) % 1) * L;
    if (gap < minGap) minGap = gap;
  }
  ok(`${id}: beacons stay spread around the lap`, minGap >= MIN_SEPARATION_M,
     `closest pair ${minGap.toFixed(0)}m apart`);

  // Each beacon may only move FORWARD, and only inside its own segment, so the
  // token-cluster reasoning behind the original offsets is not thrown away.
  // The ideal schedule is re-derived here rather than imported, deliberately: a
  // gate that asked quiz.js where its own ideals are could not notice that
  // arithmetic changing. It is the Wave 3 rhythm across the WHOLE lap, with the
  // Wave 6 keep-out applied as a CLAMP — only an ideal that lands inside the
  // zone moves, and only to the near edge of it. (Round 1 re-spaced all six
  // across `L - 2*KEEPOUT`; that moved every beacon on every track and broke
  // the teaching-card floor and the question cadence. See quiz.js.)
  const idealM = i => {
    const raw = ((i + 0.62) / 6) * L;
    if (raw < KEEPOUT_M) return KEEPOUT_M;
    if (L - raw < KEEPOUT_M) return L - KEEPOUT_M;
    return raw;
  };
  // The clamp lands a clamped ideal a HAIR outside the zone edge rather than on
  // it (quiz.js's KEEPOUT_EPS_M), so a clamped beacon reads a metre "behind"
  // the edge this gate re-derives. That much slack, and no more.
  const CLAMP_SLACK_M = 1;
  let worstAdv = 0, backwards = 0;
  for (const b of plan) {
    const ideal = (((startT + idealM(b.i) / L) % 1) + 1) % 1;
    const adv = TrackSpline.deltaT(b.t, ideal) * L;      // signed, ±L/2
    if (adv < -CLAMP_SLACK_M) backwards++;
    worstAdv = Math.max(worstAdv, adv);
  }
  ok(`${id}: beacons only move forward, within their segment`,
     backwards === 0 && worstAdv <= L / 6 * 0.62,
     `furthest nudge ${worstAdv.toFixed(0)}m of ${(L / 6).toFixed(0)}m spacing`);

  /* ── WAVE 6: the race-opening layout rule ─────────────────────────────────
     Two properties, both pure geometry, both on all three tracks.

     1. NO BEACON WITHIN KEEPOUT_S OF THE START/FINISH LINE, IN EITHER
        DIRECTION. A beacon just after the line is met seconds into lap 1 and
        again on every lap crossing (on top of the lap banner and jingle); one
        just before it freezes the child out of the run to the flag. Measured
        before the rule, the last beacon sat 53–75 m BEFORE the line on all
        three tracks and, on oasis, the forward runway search then walked it
        76 m further — 3 m AFTER the line, 0.10 s into the lap.

        Stated in SECONDS and converted here at the same 28 m/s the runway
        tiering is written against, and asserted at an ABSOLUTE 84 m as well as
        against the shipped constant: importing the constant alone would let
        someone shrink the rule to nothing and stay green.

     2. THE FIRST PICKUP MOMENT OF LAP 1 IS A TOKEN CLUSTER, BEFORE THE FIRST
        BEACON — measured from the GRID (the child starts up to 22 m behind the
        line), not from startT. This is what makes the first-token teaching card
        precede the first-quiz card on a fresh save, without the modal registry
        or the cadence logic knowing anything about track layout. */
  // Honest label (round 2): this assertion measures the CONSTANT, not the
  // layout — it stayed green in round 1's predecessor while beacons sat 3 m from
  // the line, which is why the two measured assertions below exist and are the
  // ones that bite. Kept only so the constant cannot be quietly shrunk to zero.
  ok(`${id}: the BEACON_KEEPOUT_M constant has not been shrunk below ${KEEPOUT_S}s`,
     BEACON_KEEPOUT_M >= KEEPOUT_M, `${BEACON_KEEPOUT_M}m shipped vs ${KEEPOUT_M}m required`);
  {
    let worstFwd = Infinity, worstBack = Infinity, worstB = null;
    for (const b of plan) {
      const fwd = arc(startT, b.t, L), back = L - fwd;
      if (Math.min(fwd, back) < Math.min(worstFwd, worstBack)) worstB = b;
      worstFwd = Math.min(worstFwd, fwd);
      worstBack = Math.min(worstBack, back);
    }
    ok(`${id}: no beacon within ${KEEPOUT_S}s AFTER the start/finish line`,
       worstFwd >= KEEPOUT_M,
       `nearest ${worstFwd.toFixed(0)}m = ${(worstFwd / SPEED).toFixed(2)}s (beacon ${worstB?.i})`);
    ok(`${id}: …and none within ${KEEPOUT_S}s BEFORE it either`,
       worstBack >= KEEPOUT_M,
       `nearest ${worstBack.toFixed(0)}m = ${(worstBack / SPEED).toFixed(2)}s (beacon ${worstB?.i})`);
  }
  {
    // The authored clusters, re-derived from trackbuild's own formula (pinned
    // against its source below) and then thinned by the SHIPPED thinTokenSpots,
    // so this reads the real kept rows rather than a guess at them.
    const authored = [];
    for (let g = 0; g < TOKEN_GROUPS; g++) authored.push((((startT + (g + 0.5) / TOKEN_GROUPS) % 1) + 1) % 1);
    const marks = authored.map(t => { const p = spline.offsetPoint(t, 0); p.t = t; return p; });
    const kept = thinTokenSpots(marks, TOKEN_CLUSTERS_PER_LAP).map(p => p.t);
    ok(`${id}: the lap carries 3+ pickup clusters, not one row`,
       kept.length === TOKEN_CLUSTERS_PER_LAP && TOKEN_CLUSTERS_PER_LAP >= 3,
       `${kept.length} rows at ${kept.map(t => arc(startT, t, L).toFixed(0) + 'm').join(', ')}`);
    // From the GRID, not from startT: the child starts behind the line.
    const slots = gridSlots(spline, def, 8);
    const gridT = slots.reduce((w, s) => (arc(s.t, startT, L) > arc(w.t, startT, L) ? s : w), slots[0]).t;
    const firstCluster = Math.min(...kept.map(t => arc(gridT, t, L)));
    const firstBeacon = Math.min(...plan.map(b => arc(gridT, b.t, L)));
    ok(`${id}: the first thing on lap 1 is a token row, not a question box`,
       firstCluster < firstBeacon,
       `from the back of the grid: row at ${firstCluster.toFixed(0)}m, first beacon at ${firstBeacon.toFixed(0)}m`);
  }

  console.log(`    \x1b[2m${id.padEnd(8)} runway s: ${straight.map(x => (x / SPEED).toFixed(2)).join('  ')}\x1b[0m`);
  console.log(`    \x1b[2m${''.padEnd(8)} ±${YAW_DEG}°   s: ${cones.map(x => (x / SPEED).toFixed(2)).join('  ')}\x1b[0m`);
}

console.log('  ' + '─'.repeat(72));
console.log(fail ? `  \x1b[31m${fail} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exit(fail ? 1 : 0);

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
import { getTrack, TrackSpline } from '../src/track/trackdef.js';
import { planBeacons } from './quiz-oldplacement.js';

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
  let worstAdv = 0, backwards = 0;
  for (const b of plan) {
    const ideal = (((startT + (b.i + 0.62) / 6) % 1) + 1) % 1;
    const adv = ((TrackSpline.deltaT(b.t, ideal) + 1) % 1) * L;
    if (adv > L / 2) backwards++;
    worstAdv = Math.max(worstAdv, adv);
  }
  ok(`${id}: beacons only move forward, within their segment`,
     backwards === 0 && worstAdv <= L / 6 * 0.62,
     `furthest nudge ${worstAdv.toFixed(0)}m of ${(L / 6).toFixed(0)}m spacing`);

  console.log(`    \x1b[2m${id.padEnd(8)} runway s: ${straight.map(x => (x / SPEED).toFixed(2)).join('  ')}\x1b[0m`);
  console.log(`    \x1b[2m${''.padEnd(8)} ±${YAW_DEG}°   s: ${cones.map(x => (x / SPEED).toFixed(2)).join('  ')}\x1b[0m`);
}

console.log('  ' + '─'.repeat(72));
console.log(fail ? `  \x1b[31m${fail} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exit(fail ? 1 : 0);

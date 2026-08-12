// Telemetry harness for src/kart/kartphysics.js. Plain node, no DOM.
//   node .tmp/feeltest.mjs
import * as THREE from 'three';
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, applyPartStats, autopilotInput, DRIFT_TIERS } from '../src/kart/kartphysics.js';

const DT = 1 / 60;
const { def, spline } = getTrack('oasis');
const slots = gridSlots(spline, def, 8);
const PLAYER = { speed: 3, accel: 4, handling: 4, weight: 3 };

const mk = (stats = PLAYER, parts) => new KartBody({ spline, stats, startSlot: slots[0], parts });
const f2 = n => (Math.round(n * 100) / 100).toFixed(2);
const rows = [];
const row = (k, v, note = '') => rows.push([k, v, note]);
let failures = 0;
const assert = (ok, msg) => { if (!ok) { failures++; console.log('  ✗ FAIL: ' + msg); } else console.log('  ✓ ' + msg); };

// ---------------------------------------------------------------------------
// 1. straight line: 0 -> top speed, and braking distance
// ---------------------------------------------------------------------------
function straightLine(stats) {
  const b = mk(stats);
  const IN = { throttle: 1, brake: 0, steer: 0, drift: false, hop: false };
  let t = 0, t90 = null, top = 0, prev = 0, settle = 0;
  // Run on a synthetic infinite straight: freeze the track sampling by just
  // driving and ignoring the corner (we clamp steer to 0 and respawn laterally).
  while (t < 20) {
    b.update(DT, IN); t += DT;
    // keep it on the centreline so off-track drag never enters the measurement
    const s = spline.closestT(b.position);
    b.position.copy(spline.positionAt(s.t)); b.lapT = s.t;
    if (b.speed > top) top = b.speed;
    if (t90 === null && b.speed >= b.p.topSpeed * 0.95) t90 = t;
    if (Math.abs(b.speed - prev) < 0.0015) { settle++; if (settle > 60) break; } else settle = 0;
    prev = b.speed;
  }
  // braking
  const BR = { throttle: 0, brake: 1, steer: 0, drift: false, hop: false };
  let dist = 0, bt = 0;
  while (b.speed > 0.5 && bt < 10) {
    const v0 = b.speed; b.update(DT, BR); bt += DT;
    const s = spline.closestT(b.position);
    b.position.copy(spline.positionAt(s.t));
    dist += (v0 + b.speed) * 0.5 * DT;
  }
  return { top, t95: t90, brakeDist: dist, brakeTime: bt };
}

// ---------------------------------------------------------------------------
// 2. autopilot lap
// ---------------------------------------------------------------------------
function lap(stats, { drift = false, parts, laps = 1, log = false } = {}) {
  const b = mk(stats, parts);
  b._vLong = 12;
  let t = 0, prevT = b.lapT, prog = 0, offTime = 0, maxSpeed = 0, driftTime = 0, boostTime = 0;
  let sumSpeed = 0, n = 0, wallHits = 0, maxLateral = 0;
  const tierCounts = [0, 0, 0, 0];
  let lastTier = 0;
  while (t < 400) {
    const input = autopilotInput(b, spline, { drift });
    b.update(DT, input);
    t += DT; n++;
    if (b.drifting && b.driftTier > lastTier) tierCounts[b.driftTier]++;
    lastTier = b.drifting ? b.driftTier : 0;
    if (b.offTrack) offTime += DT;
    if (b.drifting) driftTime += DT;
    if (b.boosting) boostTime += DT;
    if (b.wallHit > 0.05) wallHits++;
    if (Math.abs(b.lateral) > maxLateral) maxLateral = Math.abs(b.lateral);
    maxSpeed = Math.max(maxSpeed, b.speed);
    sumSpeed += b.speed;
    prog += TrackSpline.deltaT(b.lapT, prevT);
    prevT = b.lapT;
    if (prog >= laps) break;
    if (!Number.isFinite(b.position.x)) throw new Error('NaN position');
  }
  return {
    time: t / laps, offTime, driftTime, boostTime, maxSpeed, avg: sumSpeed / n,
    wallHits, maxLateral, tierCounts, finished: prog >= laps, body: b,
  };
}

// ---------------------------------------------------------------------------
// 3. fixed corner, entered at each drift tier
// ---------------------------------------------------------------------------
// A representative oasis corner: t 0.30 -> 0.40 (the tightening section).
function cornerRun(tier, t0 = 0.72, t1 = 0.92) {
  const b = mk();
  b.placeAt({ t: t0, lateral: 0, rot: spline.tangentAt(t0) });
  b._vLong = 24; b._writeVelocity();
  // A tier's payoff is the boost you carry INTO the corner from the drift you
  // charged in the previous one — that is what a player actually experiences.
  if (tier) { const T = DRIFT_TIERS[tier - 1]; b.applyBoost(T.strength, T.duration, T.impulse); }
  let t = 0, prevT = t0, prog = 0, minV = 99;
  while (t < 30) {
    b.update(DT, autopilotInput(b, spline, { drift: false }));
    t += DT;
    minV = Math.min(minV, b.speed);
    prog += TrackSpline.deltaT(b.lapT, prevT);
    prevT = b.lapT;
    if (prog >= t1 - t0) break;
  }
  return { time: t, exitSpeed: b.speed, minSpeed: minV };
}

// Seconds of fully-committed drift needed to light each tier.
function chargeTimes() {
  const b = mk();
  b.placeAt({ t: 0.62, lateral: 0, rot: spline.tangentAt(0.62) });
  b._vLong = 22; b._writeVelocity();
  const out = [null, null, null];
  let t = 0, held = 0;
  while (t < 12) {
    const dir = b.drifting ? b.driftDir : 1;
    b.update(DT, { throttle: 1, brake: 0, steer: dir, drift: true, hop: false });
    t += DT;
    if (b.drifting) held += DT;
    // Keep it on the road so this measures the charge rate, not the barrier.
    const sm = spline.closestT(b.position);
    if (Math.abs(sm.lateral) > spline.widthAt(sm.t) * 0.5) {
      const back = spline.offsetPoint(sm.t, 0);
      b.position.x = back.x; b.position.z = back.z;
    }
    for (let i = 0; i < 3; i++) if (out[i] === null && b.driftTier > i) out[i] = held;
    if (out[2] !== null) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
console.log('\n=== 1. LONGITUDINAL ===');
const slPlayer = straightLine(PLAYER);
row('0 -> 95% top (player)', f2(slPlayer.t95) + ' s');
row('top speed (player)', f2(slPlayer.top) + ' m/s', f2(slPlayer.top * 3.6) + ' km/h');
row('braking distance', f2(slPlayer.brakeDist) + ' m', f2(slPlayer.brakeTime) + ' s');
const slFast = straightLine({ speed: 5, accel: 2, handling: 2, weight: 5 });
const slLight = straightLine({ speed: 2, accel: 5, handling: 5, weight: 1 });
row('top speed (speed 5)', f2(slFast.top) + ' m/s');
row('top speed (speed 2)', f2(slLight.top) + ' m/s');
row('0->95% (accel 5)', f2(slLight.t95) + ' s');
row('0->95% (accel 2)', f2(slFast.t95) + ' s');
assert(slPlayer.top >= 22 && slPlayer.top <= 30, `player top speed in 22..30 (${f2(slPlayer.top)})`);
assert(slFast.top <= 30.5, `max-stat top speed <= 30 (${f2(slFast.top)})`);
assert(slPlayer.t95 > 1.5 && slPlayer.t95 < 6, `0->95% between 1.5 and 6s (${f2(slPlayer.t95)})`);

console.log('\n=== 2. LAP: GRIP vs DRIFT ===');
const gripLap = lap(PLAYER, { drift: false });
const driftLap = lap(PLAYER, { drift: true });
row('lap, no drift', f2(gripLap.time) + ' s', `avg ${f2(gripLap.avg)} m/s`);
row('lap, drifting', f2(driftLap.time) + ' s', `avg ${f2(driftLap.avg)} m/s`);
row('drift advantage', f2(gripLap.time - driftLap.time) + ' s',
  f2((gripLap.time - driftLap.time) / gripLap.time * 100) + '%');
row('drift time / boost time', f2(driftLap.driftTime) + ' / ' + f2(driftLap.boostTime) + ' s',
  'tiers b/o/p: ' + driftLap.tierCounts.slice(1).join('/'));
row('off-track time (drift lap)', f2(driftLap.offTime) + ' s');
assert(gripLap.finished && driftLap.finished, 'both autopilot laps completed');
assert(driftLap.time < gripLap.time, `drifting lap is FASTER (${f2(driftLap.time)} < ${f2(gripLap.time)})`);
assert(driftLap.driftTime > 4 && driftLap.boostTime > 3, 'the drifting lap actually drifts and boosts');

console.log('\n=== 3. CORNER BY TIER ===');
const cr = ['grip', 'blue', 'orange', 'purple'].map((m, i) => {
  const r = cornerRun(i);
  row(`boost run t0.72->0.92 (${m})`, f2(r.time) + ' s',
    `exit ${f2(r.exitSpeed)} m/s, min ${f2(r.minSpeed)} m/s`);
  return r;
});
// What a corner actually costs: the R~41m sweeper and the R~29m hairpin.
for (const [nm, a, b2] of [['sweeper R41 t0.62-0.74', 0.62, 0.74], ['hairpin R29 t0.94-0.04', 0.94, 1.04]]) {
  const r = cornerRun(0, a, b2);
  row(nm, f2(r.time) + ' s', `min ${f2(r.minSpeed)} m/s  (top ${f2(slPlayer.top)})`);
  const bar = a === 0.94 ? 0.82 : 0.94;   // the hairpin must really hurt
  assert(r.minSpeed < slPlayer.top * bar,
    `${nm}: corner forces a real slowdown (${f2(r.minSpeed)} vs top ${f2(slPlayer.top)})`);
}
const ct = chargeTimes();
row('drift secs to blue/orange/purple', ct.map(x => f2(x ?? 99)).join(' / ') + ' s');
assert(ct[2] !== null && ct[2] < 4.0, `purple reachable in one committed drift (${f2(ct[2] ?? 99)}s)`);
assert(cr[1].time < cr[0].time && cr[2].time < cr[1].time && cr[3].time < cr[2].time,
  'each drift tier is a strictly bigger gain through the same corner');

console.log('\n=== 4. STAT SPREAD ===');
const combos = [
  ['nitzotz  3/4/4/3', { speed: 3, accel: 4, handling: 4, weight: 3 }],
  ['plada    5/2/2/5', { speed: 5, accel: 2, handling: 2, weight: 5 }],
  ['zuzi     2/5/5/1', { speed: 2, accel: 5, handling: 5, weight: 1 }],
  ['zamzum   5/4/1/3', { speed: 5, accel: 4, handling: 1, weight: 3 }],
  ['nurit    3/3/5/2', { speed: 3, accel: 3, handling: 5, weight: 2 }],
];
const lapTimes = [];
for (const [name, st] of combos) {
  const r = lap(st, { drift: true });
  lapTimes.push(r.time);
  row('lap ' + name, f2(r.time) + ' s', `off ${f2(r.offTime)}s  max ${f2(r.maxSpeed)} m/s`);
}
const best = Math.min(...lapTimes), worst = Math.max(...lapTimes);
const spread = (worst - best) / best * 100;
row('stat spread', f2(spread) + '%', `${f2(best)} .. ${f2(worst)} s`);
assert(spread >= 3 && spread <= 8, `stat spread 3-8% (${f2(spread)}%)`);

console.log('\n=== 5. GARAGE PARTS ===');
const stock = lap(PLAYER, { drift: true, parts: { engine: 0, tyres: 0, frame: 0, turbo: 0 } });
const maxed = lap(PLAYER, { drift: true, parts: { engine: 3, tyres: 3, frame: 3, turbo: 3 } });
row('lap stock parts', f2(stock.time) + ' s');
row('lap maxed parts', f2(maxed.time) + ' s');
row('parts advantage', f2(stock.time - maxed.time) + ' s',
  f2((stock.time - maxed.time) / stock.time * 100) + '%');
assert(maxed.time < stock.time, 'fully upgraded kart is measurably faster');
const partsPct = (stock.time - maxed.time) / stock.time * 100;
assert(partsPct > 1.5 && partsPct < 12, `parts advantage 1.5-12% (${f2(partsPct)}%)`);

console.log('\n=== 6. SAFETY ===');
{
  // No NaN / runaway over a long chaotic run with random-ish inputs.
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const b = mk();
  let maxV = 0, bad = false, maxAbsLat = 0;
  for (let i = 0; i < 60 * 120; i++) {
    b.update(DT, {
      throttle: rnd() < 0.75 ? 1 : 0, brake: rnd() < 0.12 ? 1 : 0,
      steer: Math.sin(i * 0.013) * 1.4 + (rnd() - 0.5) * 0.9,
      drift: rnd() < 0.4, hop: rnd() < 0.02,
    });
    if (!Number.isFinite(b.position.x + b.position.y + b.position.z + b.speed + b.yaw)) { bad = true; break; }
    maxV = Math.max(maxV, b.speed);
    maxAbsLat = Math.max(maxAbsLat, Math.abs(b.lateral) - b.trackWidth);
  }
  row('chaos run max speed', f2(maxV) + ' m/s');
  row('chaos run max off-track depth', f2(maxAbsLat) + ' m');
  assert(!bad, 'no NaN over 2 minutes of chaotic input');
  assert(maxV < 45, `no runaway velocity (${f2(maxV)} m/s)`);
  assert(maxAbsLat < 7, `never escapes the barrier (max ${f2(maxAbsLat)} m past the edge)`);
}
{
  // Deliberately drive into the wall and hold throttle: anti-stuck must free it.
  const b = mk();
  b.placeAt({ t: 0.1, lateral: 0, rot: spline.tangentAt(0.1) });
  b.yaw += Math.PI / 2;      // point straight at the barrier
  b._syncBasis();
  let t = 0, hitAt = null, freed = null;
  while (t < 12) {
    b.update(DT, { throttle: 1, brake: 0, steer: 0.0, drift: false, hop: false });
    t += DT;
    if (hitAt === null && b.wallHit > 0.05) hitAt = t;
    if (hitAt !== null && freed === null && b.speed > 6 && Math.abs(b.lateral) < b.trackWidth) freed = t;
    if (freed !== null) break;
  }
  row('anti-stuck recovery', freed === null ? 'NEVER' : f2(freed - hitAt) + ' s',
    `wall contact at ${f2(hitAt ?? 0)}s, moving again at ${f2(freed ?? 0)}s`);
  assert(freed !== null && freed - hitAt < 2.2,
    `anti-stuck frees a walled kart within 2.2s (${f2((freed ?? 99) - (hitAt ?? 0))}s)`);
}
{
  // Anti-stuck TRIGGER latency: wedged against the barrier, barely moving.
  const b = mk();
  b.placeAt({ t: 0.3, lateral: 0, rot: spline.tangentAt(0.3) });
  const w = spline.widthAt(0.3);
  b.position.copy(spline.offsetPoint(0.3, w + 5.4));
  b.yaw += Math.PI / 2; b._syncBasis();
  b._vLong = 0.4; b._writeVelocity();
  let t = 0, moving = null, nudged = null;
  while (t < 6) {
    b.update(DT, { throttle: 1, brake: 0, steer: 0, drift: false, hop: false });
    t += DT;
    if (nudged === null && b.unstuckPulse !== undefined) nudged = t;
    if (moving === null && b.speed > 6 && Math.abs(b.lateral) < w + 5) moving = t;
    if (moving !== null) break;
  }
  row('wedged-in-wall -> under way', moving === null ? 'NEVER' : f2(moving) + ' s',
    nudged === null ? 'freed by the wall assist, anti-stuck never needed' : `anti-stuck fired at ${f2(nudged)}s`);
  assert(moving !== null && moving <= 1.5, `wedged kart is under way within 1.5s (${f2(moving ?? 99)}s)`);
}
{
  // respawn()
  const b = mk();
  b.position.set(9999, -400, 9999);
  b.respawn(0.25);
  const s = spline.closestT(b.position);
  assert(Math.abs(s.lateral) < 0.5 && Math.abs(s.t - 0.25) < 0.01 && Number.isFinite(b.yaw),
    'respawn() puts the kart on the centreline facing forward');
}
{
  // kart vs kart bumping: heavy shoves light
  const heavy = new KartBody({ spline, stats: { speed: 3, accel: 3, handling: 3, weight: 5 }, startSlot: slots[0] });
  const light = new KartBody({ spline, stats: { speed: 3, accel: 3, handling: 3, weight: 1 }, startSlot: slots[0] });
  light.position.copy(heavy.position); light.position.x += 1.4;
  heavy._vLong = 20; heavy._writeVelocity();
  const lx = light.position.x, hx = heavy.position.x;
  KartBody.resolveCollisions([heavy, light]);
  const lMove = Math.hypot(light.position.x - lx, light.position.z - light.position.z);
  const hMove = Math.abs(heavy.position.x - hx);
  row('bump: light displaced', f2(Math.abs(light.position.x - lx)) + ' m',
    `heavy displaced ${f2(hMove)} m`);
  assert(Math.abs(light.position.x - lx) > hMove, 'heavy kart shoves the light one further');
}
{
  // Airborne: no full steering authority, lands cleanly.
  const b = mk();
  b._vLong = 20; b.vy = 6; b.airborne = true;
  const y0 = b.yaw;
  let air = 0;
  for (let i = 0; i < 120; i++) { b.update(DT, { throttle: 1, steer: 1, brake: 0, drift: false }); if (b.airborne) air += DT; }
  row('air time from vy=6', f2(air) + ' s', `yaw change ${f2(b.yaw - y0)} rad`);
  assert(!b.airborne && b.landingSquash >= 0, 'kart lands and leaves the airborne state');
}
{
  // Off-track really costs you.
  const on = mk(), off = mk();
  on._vLong = off._vLong = 24; on._writeVelocity(); off._writeVelocity();
  for (let i = 0; i < 180; i++) {
    for (const [k, latOff] of [[on, 0], [off, 3.0]]) {
      k.update(DT, { throttle: 1, steer: 0, brake: 0, drift: false });
      // Pin each kart to a fixed lateral offset so only the surface differs.
      const s = spline.closestT(k.position);
      const w = spline.widthAt(s.t);
      k.position.copy(spline.offsetPoint(s.t, w + latOff - (latOff ? 0 : w)));
      const tan = spline.tangentAt(s.t);
      k.yaw = Math.atan2(tan.x, tan.z); k._syncBasis(); k._writeVelocity();
    }
  }
  row('speed after 3s on asphalt', f2(on.speed) + ' m/s');
  row('speed after 3s off-track', f2(off.speed) + ' m/s', off.surfaceKind);
  assert(off.speed < on.speed * 0.8, 'off-track is meaningfully slower');
  assert(off.rumble > 0.3, 'off-track raises the rumble flag');
}

console.log('\n=== 7. ALL THREE TRACKS ===');
for (const id of ['oasis', 'circuit', 'cloud']) {
  const tk = getTrack(id);
  const sl = gridSlots(tk.spline, tk.def, 8)[0];
  const b = new KartBody({ spline: tk.spline, stats: PLAYER, startSlot: sl });
  b._vLong = 12; b._writeVelocity();
  let t = 0, prevT = b.lapT, prog = 0, air = 0, jumps = 0, off = 0, maxV = 0;
  while (t < 300) {
    b.update(DT, autopilotInput(b, tk.spline, { drift: true }));
    t += DT;
    if (b.airborne) air += DT;
    if (b.jumped) jumps++;
    if (b.offTrack) off += DT;
    maxV = Math.max(maxV, b.speed);
    prog += TrackSpline.deltaT(b.lapT, prevT); prevT = b.lapT;
    if (prog >= 1) break;
  }
  // Same lap with drifting switched off, for a per-track drift advantage.
  const g = new KartBody({ spline: tk.spline, stats: PLAYER, startSlot: sl });
  g._vLong = 12; g._writeVelocity();
  let gt = 0, gp = 0, gprev = g.lapT;
  while (gt < 300) {
    g.update(DT, autopilotInput(g, tk.spline, { drift: false }));
    gt += DT; gp += TrackSpline.deltaT(g.lapT, gprev); gprev = g.lapT;
    if (gp >= 1) break;
  }
  row('lap ' + id.padEnd(8), f2(t) + ' s',
    `no-drift ${f2(gt)}s (drift ${f2((gt - t) / gt * 100)}% faster)  air ${f2(air)}s  jumps ${jumps}  max ${f2(maxV)} m/s`);
  assert(prog >= 1 && Number.isFinite(b.position.x), `${id}: autopilot completes a clean lap`);
  assert(t < gt, `${id}: drifting lap beats the gripping lap`);
}

// ---------------------------------------------------------------------------
console.log('\n=== TUNING TABLE ===');
const w0 = Math.max(...rows.map(r => r[0].length));
const w1 = Math.max(...rows.map(r => String(r[1]).length));
for (const [k, v, n] of rows) console.log('  ' + k.padEnd(w0) + '  ' + String(v).padStart(w1) + (n ? '   ' + n : ''));
console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);

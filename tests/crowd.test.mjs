// ─────────────────────────────────────────────────────────────────────────────
// CROWD ANIMATION GATE — spectators must never launch.
//
// The bug this guards: the shared cheer envelope is module-level state stored as
// (start, duration, strength) and evaluated against the RACE clock. When a new
// race reset t to 0 while a previous race's roar was still on record, the
// envelope was extrapolated BACKWARDS — k = 1 - (t - t0)/dur grew far above 1,
// the quadratic tail squared it, and the bob gain (1 + 3·env) threw capsule
// spectators hundreds of metres into the sky.
//
// Two things must hold forever, and both are asserted here:
//   1. root cause — cheerAt() is silent outside [t0, t0+dur), and createCrowd()
//      clears stale roars, so no clock reset can resurrect an old cheer.
//   2. belt and suspenders — update() clamps every spectator's vertical offset
//      to lift[i] = amp·(1+3·MAX_ENV) + MAX_ENV·0.34 regardless of what the
//      envelope says, so a future envelope/phase mistake cannot escape.
//
//   node tests/crowd.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createCrowd } from '../src/gfx/props.js';
import { makeRng } from '../src/core/rng.js';
import { bus } from '../src/core/bus.js';

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(56)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};

// The loosest bound anyone should accept: the tallest legitimate bob amplitude
// is 0.13 * 2.5 (bouncer archetype), lifted by the full cheer gain, plus the
// cheer jump. Anything above this is a launch, not an animation.
const MAX_ENV = 1.5;
const MAX_AMP = 0.13 * 2.5;
const SANE = MAX_AMP * (1 + 3 * MAX_ENV) + MAX_ENV * 0.34 + 1e-4;   // ≈ 2.29 m

// A stand on a slope, so "offset above base" is a real per-spectator quantity
// and a test that only checked absolute Y would pass by accident.
function makeSpots(n) {
  const spots = [];
  for (let i = 0; i < n; i++) {
    spots.push({ x: (i % 25) * 0.9 - 11, y: Math.floor(i / 25) * 0.55, z: 8 + (i % 7) * 0.3, s: 1 });
  }
  return spots;
}

const N = 200;
const spots = makeSpots(N);

// Worst vertical offset above base across the whole crowd, this frame.
function worstOffset(crowd) {
  const bodies = crowd.group.children.find(c => c.name === 'crowd-bodies');
  const heads = crowd.group.children.find(c => c.name === 'crowd-heads');
  const bm = bodies.instanceMatrix.array, hm = heads.instanceMatrix.array;
  let worst = 0, worstI = -1, bad = false;
  for (let i = 0; i < N; i++) {
    const y = bm[i * 16 + 13];
    if (!Number.isFinite(y) || hm[i * 16 + 13] !== y) { bad = true; worstI = i; break; }
    const dy = y - spots[i].y;
    if (dy < -1e-6) { bad = true; worstI = i; break; }
    if (dy > worst) { worst = dy; worstI = i; }
  }
  return { worst, worstI, bad };
}

console.log('\n  CROWD — spectators stay on the ground\n  ' + '─'.repeat(72));

// ── 1. long run, fixed timestep, cheers firing constantly ────────────────────
{
  const crowd = createCrowd(spots, makeRng(7), { shadows: false });
  let t = 0, worst = 0, nonFinite = false, negative = false;
  const DT = 1 / 60;
  // 12 simulated minutes at 60 Hz, with a roar every ~1.7 s so the envelope is
  // essentially always live and often re-fired mid-decay.
  for (let f = 0; f < 60 * 60 * 12; f++) {
    t += DT;
    if (f % 100 === 0) crowd.cheer(1.5, 2.5);
    crowd.update(t);
    if (f % 7 === 0) {
      const r = worstOffset(crowd);
      if (r.bad) { nonFinite = true; break; }
      if (r.worst > worst) worst = r.worst;
    }
  }
  ok('12 min @60Hz: every Y finite, never below base', !nonFinite && !negative);
  ok('12 min @60Hz: offset within sane bound', worst <= SANE, `worst ${worst.toFixed(3)} m ≤ ${SANE.toFixed(3)}`);
  crowd.dispose();
}

// ── 2. adversarial clocks: dt spikes, stalls, and a RACE RESET mid-roar ──────
// The reset is the original bug, reproduced exactly: roar at t≈40, then the
// clock snaps back to 0 as the next race starts.
{
  const crowd = createCrowd(spots, makeRng(11), { shadows: false });
  const DTS = [1 / 60, 1 / 60, 0.25, 1 / 240, 0.5, 0, 1 / 30, 0.25];
  let t = 0, worst = 0, bad = false;
  for (let f = 0; f < 20000 && !bad; f++) {
    t += DTS[f % DTS.length];
    if (f % 137 === 0) crowd.cheer(1.5, 5.0);
    crowd.update(t);
    const r = worstOffset(crowd);
    if (r.bad) { bad = true; break; }
    if (r.worst > worst) worst = r.worst;
  }
  ok('dt spikes (0.25s / 0.5s / 0): all Y finite and ≥ base', !bad);
  ok('dt spikes: offset within sane bound', worst <= SANE, `worst ${worst.toFixed(3)} m`);

  // clock reset mid-roar — the exact shape of the original launch
  crowd.cheer(1.5, 5.0);
  crowd.update(t + 0.5);
  let resetWorst = 0, resetBad = false;
  for (let f = 0; f < 3000; f++) {
    crowd.update(f / 60);                 // race restarted: t back to 0
    const r = worstOffset(crowd);
    if (r.bad) { resetBad = true; break; }
    if (r.worst > resetWorst) resetWorst = r.worst;
  }
  ok('clock reset mid-roar does not launch anyone', !resetBad && resetWorst <= SANE,
    `worst ${resetWorst.toFixed(3)} m`);
  crowd.dispose();
}

// ── 3. stale module state meeting a brand-new stand ──────────────────────────
{
  const a = createCrowd(spots, makeRng(3), { shadows: false });
  a.update(120);
  a.cheer(1.5, 6.0);                      // loud roar recorded at t = 120
  a.update(120.2);
  a.dispose();

  const b = createCrowd(spots, makeRng(3), { shadows: false });   // new race, t = 0
  let worst = 0, bad = false;
  for (let f = 0; f < 1200; f++) {
    b.update(f / 60);
    const r = worstOffset(b);
    if (r.bad) { bad = true; break; }
    if (r.worst > worst) worst = r.worst;
  }
  ok('new stand ignores the previous race\'s roar', !bad && worst <= SANE, `worst ${worst.toFixed(3)} m`);
  b.dispose();
}

// ── 4. hostile inputs: garbage strength, garbage clock ───────────────────────
{
  const crowd = createCrowd(spots, makeRng(5), { shadows: false });
  crowd.update(1);
  crowd.cheer(1e9, 1e9);                  // strength must clamp to 1.5
  crowd.cheer(NaN, NaN);                  // must be ignored outright
  let worst = 0, bad = false;
  for (const t of [1.5, 2, 5, 60, 3600, NaN, Infinity, -Infinity, 1e9, 61]) {
    crowd.update(t);
    const r = worstOffset(crowd);
    if (r.bad) { bad = true; break; }
    if (r.worst > worst) worst = r.worst;
  }
  ok('absurd strength / NaN / Infinity clock stay bounded', !bad && worst <= SANE,
    `worst ${worst.toFixed(3)} m`);
  crowd.dispose();
}

// ── 4b. hostile DURATIONS must not mute the crowd forever ────────────────────
// cheer(1, NaN) once left cheerDur = NaN, so cheerAt() returned NaN for the
// rest of the process and `s*s >= NaN` was false — every later cheer was
// silently dropped. A permanent mute is harder to spot than a launch, because
// nothing on screen looks broken. cheer(1, 1e9) is the mirror image: the stand
// pinned near maximum gain forever, which reads as a stuck animation.
for (const [label, secs] of [['NaN', NaN], ['1e9', 1e9], ['Infinity', Infinity],
                             ['negative', -5], ['zero', 0]]) {
  const crowd = createCrowd(spots, makeRng(29), { shadows: false });
  crowd.update(1);
  crowd.cheer(1, secs);                    // the hostile call

  // it must not pin the stand: 30 s later the crowd is back to an idle bob
  let worst = 0, bad = false;
  for (let f = 60; f < 60 * 40; f++) {
    crowd.update(f / 60);
    const r = worstOffset(crowd);
    if (r.bad) { bad = true; break; }
    if (r.worst > worst) worst = r.worst;
  }
  const settled = worstOffset(crowd).worst;

  // and a later legitimate cheer must still visibly lift the stand
  crowd.update(40);
  const idle = worstOffset(crowd).worst;
  crowd.cheer(1, 2.5);
  crowd.update(40.05);
  const roar = worstOffset(crowd).worst;

  ok(`cheer(1, ${label}): stays bounded and settles`, !bad && worst <= SANE && settled < 0.5,
    `worst ${worst.toFixed(3)} m, settled ${settled.toFixed(3)} m`);
  ok(`cheer(1, ${label}): a later cheer still lifts the stand`, roar > idle * 1.5,
    `idle ${idle.toFixed(3)} → roar ${roar.toFixed(3)}`);
  crowd.dispose();
}

// ── 4c. the live seam: the clock jumps BACKWARD mid-roar ─────────────────────
// race.js feeds the crowd S.clock during the countdown and S.raceTime after, so
// the crowd's clock steps back by up to ~3.2 s at the start of every real race
// — and it does so while the grid is already cheering. This is the shipped
// shape of the original bug; props.js must survive it on its own.
for (const jump of [0.5, 1.5, 3.2, 12]) {
  const crowd = createCrowd(spots, makeRng(31), { shadows: false });
  let t = 5;
  crowd.update(t);
  crowd.cheer(1.5, 5.0);                   // roaring on the grid
  for (let f = 0; f < 30; f++) crowd.update(t + f / 60);
  t -= jump;                               // clock source swaps: step backwards
  let worst = 0, bad = false;
  for (let f = 0; f < 60 * 30; f++) {
    crowd.update(t + f / 60);
    const r = worstOffset(crowd);
    if (r.bad) { bad = true; break; }
    if (r.worst > worst) worst = r.worst;
  }
  ok(`clock jumps back ${jump}s mid-roar: bounded`, !bad && worst <= SANE, `worst ${worst.toFixed(3)} m`);
  crowd.dispose();
}

// ── 5. bus-driven cheers (the path the real game uses) ───────────────────────
{
  const crowd = createCrowd(spots, makeRng(13), { shadows: false });
  let worst = 0, bad = false;
  for (let f = 0; f < 6000; f++) {
    const t = f / 60;
    if (f % 60 === 0) bus.emit('race:position', { from: 4, to: 3 });
    if (f % 300 === 0) bus.emit('race:lap', {});
    if (f % 900 === 0) bus.emit('race:finish', {});
    crowd.update(t);
    const r = worstOffset(crowd);
    if (r.bad) { bad = true; break; }
    if (r.worst > worst) worst = r.worst;
  }
  ok('bus cheers (position/lap/finish) stay bounded', !bad && worst <= SANE, `worst ${worst.toFixed(3)} m`);
  crowd.dispose();
}

// ── 5b. a disposed stand must stop listening ─────────────────────────────────
// Observable because the cheer envelope is module-level and stamped with the
// CHEERING stand's own last clock: a leaked listener whose clock ran to t=500
// would stamp cheerT0=500 over the live stand's roar and silence it.
{
  const live = createCrowd(spots, makeRng(23), { shadows: false });   // subscribes first
  const stale = createCrowd(spots, makeRng(23), { shadows: false });  // subscribes second
  stale.update(500);
  stale.dispose();

  live.update(1);
  const idle = worstOffset(live).worst;
  bus.emit('race:finish', {});
  live.update(1.05);
  const roar = worstOffset(live).worst;
  ok('dispose() unsubscribes from the bus', roar > idle * 1.5,
    `idle ${idle.toFixed(3)} → roar ${roar.toFixed(3)} (equal ⇒ leaked listener stamped a stale clock)`);
  live.dispose();
}

// ── 6. the animation is still an animation ───────────────────────────────────
// A clamp that pins everyone to 0 would pass every bound above. Prove motion.
{
  const crowd = createCrowd(spots, makeRng(17), { shadows: false });
  let lo = Infinity, hi = 0;
  for (let f = 0; f < 600; f++) {
    crowd.update(f / 60);
    const r = worstOffset(crowd);
    if (r.worst < lo) lo = r.worst;
    if (r.worst > hi) hi = r.worst;
  }
  ok('idle bob actually moves', hi > 0.02 && hi - lo > 0.005, `range ${lo.toFixed(3)}–${hi.toFixed(3)} m`);
  crowd.update(10);
  const idle = worstOffset(crowd).worst;
  crowd.cheer(1, 2.5);
  crowd.update(10.05);
  const roar = worstOffset(crowd).worst;
  ok('a cheer visibly lifts the stand', roar > idle, `idle ${idle.toFixed(3)} → roar ${roar.toFixed(3)}`);
  crowd.dispose();
}

console.log(failed ? `\n  \x1b[31m${failed} FAILURE(S)\x1b[0m\n` : '\n  \x1b[32mall checks passed\x1b[0m\n');
process.exit(failed ? 1 : 0);

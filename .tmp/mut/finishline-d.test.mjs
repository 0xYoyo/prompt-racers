// FINISH LINE ALIGNMENT (item 13)
//
// The lap used to be credited long before the kart reached the chequered line:
// ~95–99m early on all three tracks, which a child sees as the lap counter
// ticking over while the gantry is still ahead of them. Two causes, both in the
// detection and neither in the artwork (see createLapTracker in race/race.js):
// the lap fired on the LAST checkpoint rather than on the line (1/16 lap), and
// every checkpoint fired on proximity (|deltaT| < 0.02) rather than on a
// crossing (another 0.02 lap).
//
// This test pins the two halves to the same anchor:
//   • the VISUAL — trackbuild draws both the chequer band and the gantry at
//     `def.startT`; asserted against the source so moving the artwork without
//     moving the trigger fails here rather than in a playtest.
//   • the TRIGGER — the lap fraction at which createLapTracker credits a lap,
//     measured by driving the tracker forward in realistic 1/60-second steps.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTrack, gridSlots, TrackSpline } from './src-d/track/trackdef.js';
import { createLapTracker } from './src-d/race/race.js';

let fail = 0;
const ok = (name, cond, detail = '') => { if (!cond) fail++;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(52)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`); };

console.log('\n  FINISH-LINE ALIGNMENT\n  ' + '─'.repeat(72));

/* ── 1. the visual anchor, read out of trackbuild ─────────────────────────── */
const src = readFileSync(fileURLToPath(new URL('./src-d/track/trackbuild.js', import.meta.url)), 'utf8');
ok('trackbuild anchors the start/finish complex at startT',
   /const\s+startT\s*=\s*def\.startT/.test(src)
   && /const\s+tt\s*=\s*startT\s*-\s*dT\s*\/\s*2/.test(src)      // chequer band, centred
   && /const\s+fr\s*=\s*spline\.frameAt\(startT\)/.test(src));   // gantry
ok('trackbuild builds 16 checkpoints from startT',
   /const\s+CP\s*=\s*16/.test(src)
   && /checkpoints\.push\(\(\(startT\s*\+\s*i\s*\/\s*CP\)\s*%\s*1\s*\+\s*1\)\s*%\s*1\)/.test(src));

// Tolerance: one fixed step of travel at a generous top speed, plus slack.
const TOL_M = 1.0;

for (const id of ['oasis', 'circuit', 'cloud']) {
  const { def, spline } = getTrack(id);
  const L = spline.length;
  const startT = def.startT ?? 0;            // where the chequer + gantry are drawn
  const CP = [];
  for (let i = 0; i < 16; i++) CP.push(((startT + i / 16) % 1 + 1) % 1);

  // Start on the grid, exactly where race.js starts the player.
  const slot = gridSlots(spline, def, 8)[0];
  const t0 = spline.closestT(slot.pos).t;
  const tracker = createLapTracker(CP, t0);

  // Drive forward at 36 m/s in 1/60 steps — faster than any kart in the game,
  // so the measured error is an upper bound on the real one.
  const step = (36 / 60) / L;
  let t = t0;
  const lapTs = [];
  for (let i = 0; i < Math.ceil(3.2 * L / (36 / 60)); i++) {
    t = (t + step) % 1;
    if (tracker.step(t) === 'lap') lapTs.push(t);
  }

  const errs = lapTs.map(x => Math.abs(TrackSpline.deltaT(x, startT)) * L);
  const worst = errs.length ? Math.max(...errs) : Infinity;
  ok(`${id}: three clean laps are credited`, lapTs.length === 3, `${lapTs.length} laps`);
  ok(`${id}: lap credited AT the finish line`, worst <= TOL_M,
     `worst ${worst.toFixed(2)}m from the line (was ~${(L * (1 / 16 + 0.02)).toFixed(0)}m early)`);

  // Ordering must still hold: a partial lap that skips the back half of the
  // track (the infield cut a checkpoint chain exists to stop) credits nothing.
  {
    const tk = createLapTracker(CP, t0);
    let u = t0;
    for (let i = 0; i < 400; i++) { u = (u + step) % 1; tk.step(u); }   // cross the line, drive a bit
    u = ((startT - 0.01) % 1 + 1) % 1;                                  // teleport to just before the line
    let credited = false;
    for (let i = 0; i < 200; i++) { u = (u + step) % 1; if (tk.step(u) === 'lap') credited = true; }
    ok(`${id}: skipping the lap does not credit one`, !credited);
  }

  // And reversing back over the line does not farm a lap either.
  {
    const tk = createLapTracker(CP, t0);
    let u = t0;
    for (let i = 0; i < 400; i++) { u = (u + step) % 1; tk.step(u); }
    let credited = false;
    for (let r = 0; r < 6; r++) {
      for (let i = 0; i < 120; i++) { u = (u - step + 1) % 1; if (tk.step(u) === 'lap') credited = true; }
      for (let i = 0; i < 120; i++) { u = (u + step) % 1; if (tk.step(u) === 'lap') credited = true; }
    }
    ok(`${id}: reversing over the line does not farm laps`, !credited);
  }
}

console.log('  ' + '─'.repeat(72));
console.log(fail ? `  \x1b[31m${fail} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exit(fail ? 1 : 0);

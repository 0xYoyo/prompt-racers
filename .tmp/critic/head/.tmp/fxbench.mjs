// Headless benchmark for src/gfx/particles.js.
//
//   node .tmp/fxbench.mjs            # all three quality tiers
//   node .tmp/fxbench.mjs --frames 600
//
// Runs the effects system under SUSTAINED WORST CASE — a tier-3 drift plus an
// active boost plus off-track spray, with a wall hit, a kart hit and a token
// pickup every few frames — for N frames, and reports the per-frame cost of
// update() (mean / p50 / p95 / max), the live particle counts, and the JS heap
// growth across the run (with --expose-gc, so the number is real retention and
// not just uncollected garbage).
//
// No renderer is involved: update() is pure CPU work on typed arrays, and the
// GPU side is structurally two draw calls regardless of load.
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, rmSync, mkdirSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) args[k.slice(2)] = process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i];
}
const FRAMES = +(args.frames || 600);

const tmp = resolve(root, '.tmp');
mkdirSync(tmp, { recursive: true });
const entry = resolve(tmp, 'fxbench-entry.js');
writeFileSync(entry, `
import * as THREE from 'three';
import { createEffects } from ${JSON.stringify(resolve(root, 'src/gfx/particles.js'))};
import { TIERS } from ${JSON.stringify(resolve(root, 'src/core/engine.js'))};

window.__BENCH = async function (tier, frames) {
  const engine = { q: TIERS[tier], ui: null };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  camera.position.set(0, 3, 8); camera.lookAt(0, 0.6, 0); camera.updateMatrixWorld();

  // Worst case: a fully charged drift, a live boost and off-track spray at once.
  const body = {
    position: new THREE.Vector3(), velocity: new THREE.Vector3(0, 0, 22),
    forward: new THREE.Vector3(0, 0, 1), speed01: 1,
    drifting: true, driftDir: 1, driftTier: 3, driftCharge01: 1,
    boosting: true, airborne: false, landingSquash: 0,
    offTrack: true, surfaceKind: 'sand', wallHit: 0, kartHit: 0,
  };
  const fx = createEffects(engine, { camera, screen: false, events: false });

  const dt = 1 / 60;
  const t = new Float64Array(frames);
  let peakSoft = 0, peakGlow = 0, dropped = 0;

  // warm up: JIT + fill the pools before we start timing
  for (let i = 0; i < 120; i++) fx.update(dt, body);

  if (window.gc) { window.gc(); await new Promise(r => setTimeout(r, 30)); window.gc(); }
  const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;

  // performance.now() is clamped to ~100us in Chrome, which is coarser than a
  // single update(). Time BLOCKS of 10 frames and divide.
  const BLOCK = 10;
  for (let i = 0; i < frames; i += BLOCK) {
   const tb0 = performance.now();
   for (let k = 0; k < BLOCK; k++) {
    const j = i + k;
    // heading weave, plus a hit / pickup cadence
    const a = Math.sin(j * 0.02) * 0.3;
    body.forward.set(Math.sin(a), 0, Math.cos(a));
    body.position.x += body.forward.x * 22 * dt;
    body.position.z += body.forward.z * 22 * dt;
    body.wallHit = (j % 37 === 0) ? 0.9 : 0;
    body.kartHit = (j % 53 === 0) ? 0.7 : 0;
    body.landingSquash = (j % 71 === 0) ? 0.8 : 0;

    fx.update(dt, body);
    if (j % 29 === 0) fx.spawn('token', body.position);
    if (j % 61 === 0) fx.spawn('boost', body.position, { power: 1.3 });
   }
   const per = (performance.now() - tb0) / BLOCK;
   for (let k = 0; k < BLOCK; k++) t[i + k] = per;
   // stats() builds an object, so it is sampled OUTSIDE the timed block and
   // only occasionally — otherwise the bench measures its own allocation.
   const s = fx.stats();
   if (s.soft > peakSoft) peakSoft = s.soft;
   if (s.glow > peakGlow) peakGlow = s.glow;
   dropped = s.dropped;
  }

  // Pure allocation probe: nothing but update() in the loop, so the number is
  // the system's own churn and not the harness's stats()/spawn() objects.
  if (window.gc) { window.gc(); await new Promise(r => setTimeout(r, 30)); window.gc(); }
  const probe0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
  for (let i = 0; i < frames; i++) fx.update(dt, body);
  const probe1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
  // idle probe: same call, but with every emitter switched off, so the two
  // numbers separate "simulating particles" from "spawning particles".
  const idle = { position: body.position, forward: body.forward, speed01: 0.2,
    drifting: false, boosting: false, offTrack: false, airborne: false,
    landingSquash: 0, wallHit: 0, kartHit: 0, surfaceKind: 'asphalt' };
  for (let i = 0; i < 60; i++) fx.update(dt, idle);
  if (window.gc) { window.gc(); await new Promise(r => setTimeout(r, 20)); window.gc(); }
  const idle0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
  for (let i = 0; i < frames; i++) fx.update(dt, idle);
  const idle1 = performance.memory ? performance.memory.usedJSHeapSize : 0;

  const heapRun = performance.memory ? performance.memory.usedJSHeapSize : 0;
  if (window.gc) { window.gc(); await new Promise(r => setTimeout(r, 30)); window.gc(); }
  const heap1 = performance.memory ? performance.memory.usedJSHeapSize : 0;

  const sorted = Array.from(t).sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const st = fx.stats();
  fx.dispose();
  return {
    tier, frames,
    mean: sum / frames, p50: sorted[frames >> 1],
    p95: sorted[Math.floor(frames * 0.95)], max: sorted[frames - 1],
    peakSoft, peakGlow, capSoft: st.capSoft, capGlow: st.capGlow,
    drawCalls: st.drawCalls, dropped,
    heapGrowthBytes: heap1 - heap0,          // retained after GC
    heapChurnBytes: heapRun - heap0,         // allocated during the run
    probeBytes: probe1 - probe0,
    idleBytes: idle1 - idle0,             // update()-only churn over the run
    gc: !!window.gc, mem: !!performance.memory,
  };
};
window.__READY = true;
`);

const built = await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'iife', write: false,
  alias: { three: resolve(root, 'vendor/three.module.js') },
  target: ['chrome100'], logLevel: 'warning',
});
const html = resolve(tmp, 'fxbench.html');
writeFileSync(html, `<!doctype html><meta charset="utf-8"><body><script>${built.outputFiles[0].text}</script>`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc',
    '--disable-dev-shm-usage', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  await page.goto('file://' + html, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true');
  const rows = [];
  for (const tier of ['low', 'medium', 'high']) {
    rows.push(await page.evaluate((t, f) => window.__BENCH(t, f), tier, FRAMES));
  }
  const ms = v => v.toFixed(3).padStart(7);
  console.log(`\nparticles.js — ${FRAMES} frames of sustained drift+boost+spray+collisions\n`);
  console.log('tier    mean      p50      p95      max   | live soft/glow (cap)   drops  draws');
  for (const r of rows) {
    console.log(
      `${r.tier.padEnd(6)}${ms(r.mean)}  ${ms(r.p50)}  ${ms(r.p95)}  ${ms(r.max)}  | ` +
      `${String(r.peakSoft).padStart(4)}/${String(r.peakGlow).padStart(4)} ` +
      `(${r.capSoft}/${r.capGlow})`.padEnd(12) + `  ${String(r.dropped).padStart(5)}  ${r.drawCalls}`);
  }
  console.log('\nallocation (JS heap, bytes)');
  for (const r of rows) {
    console.log(`${r.tier.padEnd(6)} retained after GC: ${String(r.heapGrowthBytes).padStart(8)}` +
      `   update()-only probe: ${String(r.probeBytes).padStart(9)}` +
      `   (${(r.probeBytes / r.frames).toFixed(1)} B/frame)` +
      `   idle: ${(r.idleBytes / r.frames).toFixed(1)} B/frame`);
  }
  console.log('\nbudget: 16.67 ms/frame at 60fps.');
  for (const r of rows) {
    console.log(`  ${r.tier.padEnd(6)} p95 = ${(r.p95 / 16.67 * 100).toFixed(2)}% of a frame`);
  }
} finally {
  await browser.close();
  rmSync(entry, { force: true });
}

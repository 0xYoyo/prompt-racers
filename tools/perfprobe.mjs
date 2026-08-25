// Performance probe (Wave 5, item 7).
//
// Drives the REAL built game through real requestAnimationFrame frames and
// records per-frame wall time plus renderer.info draw calls / triangles, at a
// fixed resolution, a fixed seed and an explicit quality tier. Unlike
// tools/shot.mjs it deliberately un-sets `engine._headless` so the engine's own
// loop runs — a `__DEBUG.advance()` sweep steps the simulation without ever
// submitting a frame, which measures nothing about rendering.
//
//   node tools/perfprobe.mjs --tiers low,medium,high --tracks 0,1,2 --secs 6
//   node tools/perfprobe.mjs --html .tmp/w5perf-before/dist.html --dpr 2 --tiers high
//
// --gpu uses the platform GPU backend instead of SwiftShader. Draw calls and
// triangle counts are backend-independent and exact; frame time is not, and the
// header of every run prints which rasteriser produced the numbers.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, writeFileSync, mkdirSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const a = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) a[k.slice(2)] = (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--')) ? true : process.argv[++i];
}

const htmlPath = resolve(root, a.html || 'dist/index.html');
const W = +(a.w || 1600), H = +(a.h || 900);
const DPR = +(a.dpr || 1);
const SECS = +(a.secs || 6);
const WARM = +(a.warm || 1.5);
const SEED = +(a.seed || 12345);
const TIERS = String(a.tiers || 'low,medium,high').split(',').filter(Boolean);
const TRACKS = String(a.tracks || '0,1,2').split(',').filter(Boolean).map(Number);
const LABEL = a.label || (a.html ? String(a.html) : 'dist');

if (!existsSync(htmlPath)) { console.error(`missing ${htmlPath} — npm run build`); process.exit(2); }

const GPU_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=metal',
  '--hide-scrollbars', '--mute-audio'];
const SW_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--hide-scrollbars', '--mute-audio'];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: a.gpu ? false : true,
  args: a.gpu ? GPU_ARGS : SW_ARGS,
});

// --shot mode: a screenshot at an arbitrary devicePixelRatio. tools/shot.mjs
// forces deviceScaleFactor 1, at which `min(dpr,2)` and `min(dpr,1.5)` are the
// same number — so the high-tier dpr cap cannot be judged from its output at
// all. This exists only to photograph that one difference.
if (a.shot) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  const scene = a.scene || 'race';
  await page.evaluate((s, o) => window.__DEBUG.goto(s, o), scene, {
    track: TRACKS[0], lang: 'he', quality: TIERS[0] || 'high', seed: SEED, visit: 1,
  });
  if (+(a.t || 0) > 0) await page.evaluate(t => window.__DEBUG.advance(t), +a.t);
  await page.evaluate(() => window.__DEBUG.renderOnce());
  const meta = await page.evaluate(() => {
    const e = window.__DEBUG.engine, g = e.renderer.getContext();
    return { pr: e.renderer.getPixelRatio(), buf: `${g.drawingBufferWidth}x${g.drawingBufferHeight}`, q: e.q.name, dpr: devicePixelRatio };
  });
  await new Promise(r => setTimeout(r, 350));
  const out = resolve(root, a.shot === true ? 'shots/perfprobe.png' : a.shot);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, type: 'png' });
  console.log(`wrote ${out}  ${W}x${H} @dpr${DPR}  scene=${scene} q=${meta.q} pixelRatio=${meta.pr} buffer=${meta.buf} devicePixelRatio=${meta.dpr}`);
  await browser.close();
  process.exit(0);
}

const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};
const f2 = n => (Number.isFinite(n) ? n.toFixed(2) : '—');

const rows = [];
let gpuName = '?';
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

  gpuName = await page.evaluate(() => {
    const gl = window.__DEBUG.engine.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });

  for (const tier of TIERS) {
    for (const track of TRACKS) {
      await page.evaluate((t, tr, s) => window.__DEBUG.goto('race', {
        track: tr, lang: 'he', quality: t, seed: s, visit: 1,
      }), tier, track, SEED);
      // Settle the sim past the countdown at a fixed number of fixed steps, so
      // every tier starts the sample window from the same simulation state.
      await page.evaluate(() => window.__DEBUG.advance(8));

      const r = await page.evaluate(async (secs, warm) => {
        const e = window.__DEBUG.engine;
        const info = e.renderer.info;
        const gl = e.renderer.getContext();
        const frames = [], work = [], calls = [], tris = [];
        // The engine's own rAF loop is vsync-locked, so on a fast machine wall
        // frame time only ever reads back the display's refresh interval and
        // measures nothing. Drive the step+draw manually and time it directly;
        // `gl.finish()` folds the GPU's own cost for that frame back into the
        // number, which is what a weaker machine would be paying.
        const t0 = performance.now();
        let last = t0;
        await new Promise(done => {
          const tick = () => {
            const w0 = performance.now();
            const dt = w0 - last; last = w0;
            e.step(1 / 60);
            e.draw();
            gl.finish();
            const w1 = performance.now();
            const el = (w1 - t0) / 1000;
            if (el > warm) {
              frames.push(dt);
              work.push(w1 - w0);
              calls.push(info.render.calls);
              tris.push(info.render.triangles);
            }
            if (el >= secs) { done(); return; }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const g = gl;
        return {
          frames, work, calls, tris,
          pixelRatio: e.renderer.getPixelRatio(),
          bufW: g.drawingBufferWidth, bufH: g.drawingBufferHeight,
          shadows: e.renderer.shadowMap.enabled,
          q: e.q.name, dpr: devicePixelRatio,
          progs: e.renderer.info.programs?.length ?? -1,
        };
      }, SECS, WARM);

      rows.push({
        tier, track,
        med: pct(r.work, 0.5), p95: pct(r.work, 0.95),
        wall: pct(r.frames, 0.5),
        fps: 1000 / pct(r.work, 0.5),
        calls: Math.round(r.calls.reduce((x, y) => x + y, 0) / Math.max(1, r.calls.length)),
        callsMax: Math.max(...r.calls),
        tris: Math.round(r.tris.reduce((x, y) => x + y, 0) / Math.max(1, r.tris.length)),
        n: r.frames.length, pr: r.pixelRatio, buf: `${r.bufW}x${r.bufH}`,
        shadows: r.shadows, qname: r.q, dpr: r.dpr, progs: r.progs,
      });
    }
  }
  if (errs.length) console.error('page errors:\n' + errs.slice(0, 8).join('\n'));
} catch (e) {
  console.error('PERFPROBE FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log(`\n  PERFPROBE  ${LABEL}   ${W}x${H} @dpr${DPR}  seed=${SEED}  ${SECS - WARM}s/sample`);
console.log(`  rasteriser: ${gpuName}`);
console.log('  ' + '─'.repeat(96));
console.log('  tier    track  q       pr    buffer      shadows  step+draw med   p95     ~fps   calls  tris');
for (const r of rows) {
  console.log(`  ${r.tier.padEnd(7)} ${String(r.track).padEnd(6)} ${r.qname.padEnd(7)} ${String(r.pr).padEnd(5)} ${r.buf.padEnd(11)} ${String(r.shadows).padEnd(8)} ${f2(r.med).padStart(9)} ${f2(r.p95).padStart(7)} ${f2(r.fps).padStart(7)} ${String(r.calls).padStart(6)} ${String(r.tris).padStart(8)}`);
}
if (a.json) {
  mkdirSync(dirname(resolve(root, a.json)), { recursive: true });
  writeFileSync(resolve(root, a.json), JSON.stringify({ label: LABEL, gpu: gpuName, W, H, DPR, SEED, rows }, null, 2));
  console.log(`  → ${a.json}`);
}

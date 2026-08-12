// Isolated module preview + screenshot. Builds ONE module's exported scene factory
// into its own throwaway bundle and captures a frame — so each subsystem can be
// developed and critiqued independently, in parallel, without touching dist/.
//
//   node tools/preview.mjs --mod src/gfx/sky.js --fn preview --t 2 --out shots/sky.png
//
// The module must export a scene factory:  export function preview(engine){...}
// returning { scene, camera, update(dt), dispose() }  (same contract as any scene).
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { createHash } from 'crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const a = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) a[k.slice(2)] = (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--')) ? true : process.argv[++i];
}
if (!a.mod) { console.error('usage: --mod src/x/y.js [--fn preview] [--t 2] [--out shots/x.png] [--w 1600 --h 900] [--lang he] [--quality high]'); process.exit(2); }

const fn = a.fn || 'preview';
const W = +(a.w || 1600), H = +(a.h || 900), T = +(a.t || 0);
const out = resolve(root, a.out || `shots/${a.mod.split('/').pop().replace(/\.js$/, '')}.png`);
const tmp = resolve(root, '.tmp');
mkdirSync(tmp, { recursive: true });
mkdirSync(dirname(out), { recursive: true });

const id = createHash('sha1').update(a.mod + fn).digest('hex').slice(0, 10);
const entry = resolve(tmp, `entry-${id}.js`);
const modPath = resolve(root, a.mod);
writeFileSync(entry, `
import { bootPreview } from ${JSON.stringify(resolve(root, 'src/core/harness.js'))};
import * as M from ${JSON.stringify(modPath)};
const f = M[${JSON.stringify(fn)}];
if (typeof f !== 'function') {
  document.body.innerHTML = '<pre style="color:#f88;padding:24px;direction:ltr">' +
    ${JSON.stringify(a.mod)} + ' has no exported function "' + ${JSON.stringify(fn)} + '". Exports: ' + Object.keys(M).join(', ') + '</pre>';
} else { bootPreview(f); }
`);

const built = await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'iife', minify: true, write: false,
  alias: { three: resolve(root, 'vendor/three.module.js') },
  target: ['chrome100'], legalComments: 'none', logLevel: 'warning',
});

const htmlPath = resolve(tmp, `preview-${id}.html`);
writeFileSync(htmlPath, `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0d1a}#app{position:fixed;inset:0}</style>
</head><body><div id="app"><div id="boot"></div></div><script>${built.outputFiles[0].text}</script></body></html>`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
const errs = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  if (a.lang || a.quality) await page.evaluate((l, q) => window.__DEBUG.goto('preview', { lang: l, quality: q }), a.lang || 'he', a.quality || 'high');
  if (T > 0) await page.evaluate(t => window.__DEBUG.advance(t), T);
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: out, type: 'png' });
  console.log(`wrote ${relative(root, out)}  (${W}x${H}, t=${T}s)${errs.length ? '  ERRORS' : ''}`);
  if (errs.length) console.error(errs.slice(0, 12).join('\n'));
} catch (e) {
  console.error('PREVIEW FAILED:', e.message);
  if (errs.length) console.error(errs.slice(0, 12).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  rmSync(entry, { force: true });
}

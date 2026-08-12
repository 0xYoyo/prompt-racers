// Deterministic screenshot harness. Drives the built game into a given state via
// window.__DEBUG and captures a real rendered frame. Used by every visual critic.
//
//   node tools/shot.mjs --scene race --track 0 --t 12 --out shots/race1.png
//   node tools/shot.mjs --scene garage --visit 1 --out shots/garage.png --lang he
//   node tools/shot.mjs --scene menu --out shots/menu.png --w 1600 --h 900
//
// --t advances the sim in FIXED steps (not wall clock) so output is reproducible.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[++i];
}

const scene = args.scene || 'menu';
const out = resolve(root, args.out || `shots/${scene}.png`);
const W = +(args.w || 1600), H = +(args.h || 900);
const T = +(args.t || 0);
const opts = {
  track: +(args.track || 0),
  visit: +(args.visit || 1),
  lang: args.lang || 'he',
  quality: args.quality || 'high',
  seed: +(args.seed || 12345),
  place: args.place !== undefined ? +args.place : undefined,
};

if (!existsSync(resolve(root, 'dist/index.html'))) {
  console.error('dist/index.html missing — run `npm run build` first.');
  process.exit(2);
}
mkdirSync(dirname(out), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-lcd-text', '--force-device-scale-factor=1',
    '--hide-scrollbars', '--mute-audio',
  ],
});

const errs = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  // Fail loudly if anything tries to touch the network — that's a contest DQ.
  await page.setRequestInterception(true);
  const net = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) net.push(u);
    r.continue();
  });

  await page.goto('file://' + resolve(root, 'dist/index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

  await page.evaluate((s, o) => window.__DEBUG.goto(s, o), scene, opts);
  if (T > 0) await page.evaluate(t => window.__DEBUG.advance(t), T);
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await new Promise(r => setTimeout(r, 350)); // let CSS transitions settle

  await page.screenshot({ path: out, type: 'png' });

  if (net.length) console.error('!! RUNTIME NETWORK REQUESTS DETECTED:\n' + net.join('\n'));
  if (errs.length) console.error('!! PAGE ERRORS:\n' + errs.slice(0, 12).join('\n'));
  console.log(`wrote ${out}  (${W}x${H}, scene=${scene}, t=${T}s)${net.length ? '  NETWORK-VIOLATION' : ''}${errs.length ? '  ERRORS' : ''}`);
} catch (e) {
  console.error('SHOT FAILED:', e.message);
  if (errs.length) console.error(errs.slice(0, 12).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}

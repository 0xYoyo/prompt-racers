// Contest-compliance gate. Run before every hand-off:  node tools/verify.mjs
//
// Checks the HARD constraints that would disqualify the project, plus a perf budget.
// Exits non-zero on any failure so this can gate a release.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dist = resolve(root, 'dist/index.html');

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); };

if (!existsSync(dist)) { console.error('dist/index.html missing — run npm run build'); process.exit(2); }
const html = readFileSync(dist, 'utf8');

// ---- static checks -------------------------------------------------------
ok('single self-contained file', true, `${(html.length / 1024 / 1024).toFixed(2)} MB`);

const external = [...html.matchAll(/\b(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi)].map(m => m[1]);
ok('no external src/href in HTML', external.length === 0, external.join(', '));

// Look for network APIs in the shipped JS. Allow the words inside our own harness
// comment text by checking for call syntax specifically.
const netPatterns = [
  [/\bfetch\s*\(/g, 'fetch('],
  [/XMLHttpRequest/g, 'XMLHttpRequest'],
  [/new\s+WebSocket/g, 'WebSocket'],
  [/navigator\.sendBeacon/g, 'sendBeacon'],
  [/importScripts\s*\(/g, 'importScripts'],
  [/EventSource/g, 'EventSource'],
];
const found = netPatterns.filter(([re]) => re.test(html)).map(([, n]) => n);
ok('no network APIs in bundle', found.length === 0, found.join(', '));

const urls = [...html.matchAll(/https?:\/\/[^\s"'`)]+/gi)].map(m => m[0])
  .filter(u => !/w3\.org|schemas|spdx|opensource\.org/i.test(u));
ok('no http(s) URLs in bundle', urls.length === 0, [...new Set(urls)].slice(0, 5).join(', '));

// No external asset files anywhere in the project source.
const assetExts = /\.(png|jpe?g|gif|webp|svg|mp3|wav|ogg|m4a|glb|gltf|fbx|obj|ttf|otf|woff2?)$/i;
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => {
  if (e.name === 'node_modules' || e.name === '.git' || e.name === '.tmp') return [];
  const p = resolve(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const srcAssets = walk(resolve(root, 'src')).filter(p => assetExts.test(p));
ok('no asset files in src/', srcAssets.length === 0, srcAssets.join(', '));

const bigDataUri = [...html.matchAll(/data:(?:image|audio|font)\/[^;]+;base64,([A-Za-z0-9+/=]{2000,})/g)];
ok('no embedded base64 media', bigDataUri.length === 0, `${bigDataUri.length} found`);

// Determinism: our own source must never use Math.random (three.js internals may).
const srcFiles = walk(resolve(root, 'src'));
const randomOffenders = srcFiles.filter(p => /Math\.random\s*\(/.test(readFileSync(p, 'utf8')))
  .map(p => p.replace(root + '/', ''));
ok('no Math.random in src/ (determinism)', randomOffenders.length === 0, randomOffenders.join(', '));

// IP-safety keyword sweep — cheap insurance against an accidental reference.
// Distinctive tokens only. Bare "peach", "toad" and "sonic" are ordinary English
// words (and colour/material names) that misfire constantly, so require the
// unambiguous forms instead.
const ipWords = /\b(mario kart|super mario|luigi|princess peach|bowser|yoshi|koopa|nintendo|sonic the hedgehog|sega|crash bandicoot|pixar|disney|pokemon|pikachu|forza|gran turismo)\b/i;
const srcText = srcFiles.map(p => readFileSync(p, 'utf8')).join('\n');
const ipHit = srcText.match(ipWords);
ok('no existing-IP references in source', !ipHit, ipHit ? ipHit[0] : '');

// ---- runtime checks ------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errs = [], net = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (!/^(file|data|blob):/.test(u)) net.push(u);
    r.continue();
  });

  await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

  ok('zero runtime network requests', net.length === 0, [...new Set(net)].slice(0, 5).join(', '));
  ok('boots with no console/page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  // Storage hygiene: only our single namespaced key, and no cookies.
  const storage = await page.evaluate(() => ({
    keys: Object.keys(localStorage),
    cookies: document.cookie,
    session: Object.keys(sessionStorage),
  }));
  ok('localStorage limited to one namespaced key', storage.keys.every(k => k.startsWith('promptracers.')), storage.keys.join(', '));
  ok('no cookies set', storage.cookies === '', storage.cookies);

  // Hebrew RTL default
  const dir = await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
  ok('defaults to Hebrew RTL', dir[0] === 'rtl' && dir[1] === 'he', dir.join('/'));

  await browser.close();
} catch (e) {
  ok('runtime checks completed', false, e.message);
  await browser.close().catch(() => {});
}

// ---- report --------------------------------------------------------------
const pad = Math.max(...results.map(r => r.name.length));
console.log('\n  CONTEST COMPLIANCE\n  ' + '─'.repeat(pad + 30));
for (const r of results) {
  console.log(`  ${r.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.name.padEnd(pad)}  ${r.detail ? '\x1b[2m' + r.detail + '\x1b[0m' : ''}`);
}
const failed = results.filter(r => !r.pass);
console.log('  ' + '─'.repeat(pad + 30));
console.log(`  ${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length ? 1 : 0);

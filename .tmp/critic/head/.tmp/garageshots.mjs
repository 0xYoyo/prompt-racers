import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
const root = resolve('.');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(resolve(root, '.tmp'), { recursive: true });
const entry = resolve(root, '.tmp/gshots-entry.js');
writeFileSync(entry, `
import { bootPreview } from ${JSON.stringify(resolve(root, 'src/core/harness.js'))};
import { garageScene, setKartPreviewMounter } from ${JSON.stringify(resolve(root, 'src/garage/garage.js'))};
import { createKart } from ${JSON.stringify(resolve(root, 'src/kart/kartmodel.js'))};
import { ROSTER } from ${JSON.stringify(resolve(root, 'src/kart/roster.js'))};
setKartPreviewMounter((c, o = {}) => { const k = createKart({ racer: ROSTER[0], engine: o.engine, parts: o.parts }); c.add(k.group); return k; });
bootPreview((engine, o = {}) => garageScene(engine, { visit: 3, meet: false, tokens: 17, onDone(){}, ...o }));
`);
const built = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', write: false,
  alias: { three: resolve(root, 'vendor/three.module.js') }, target: ['chrome100'], logLevel: 'warning' });
const html = resolve(root, '.tmp/gshots.html');
writeFileSync(html, `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0d1a}#app{position:fixed;inset:0}</style>
</head><body><div id="app"><div id="boot"></div></div><script>${built.outputFiles[0].text}</script></body></html>`);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
await page.goto('file://' + html, { waitUntil: 'load' });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (name, opts) => {
  await page.evaluate(async o => { await window.__DEBUG.goto('preview', o); }, opts);
  await page.evaluate(() => { window.__DEBUG.advance(1.0); window.__DEBUG.renderOnce(); });
  await wait(200);
  await page.screenshot({ path: resolve(root, 'shots/' + name + '.png') });
  console.log('wrote shots/' + name + '.png');
};
const wiz = { ownedParts: { engine: 2, tires: 1 }, selection: { part: 'engine', goal: 'engine.exit', constraint: null, style: null } };
const rev = { ownedParts: { engine: 2, tires: 1 }, phase: 'reveal',
  selection: { part: 'wing', goal: 'wing.fastcorner', constraint: 'wing.drag', style: 'wing.neon' } };
for (const lang of ['he', 'en']) {
  await shot(`garage-wizard-${lang}`, { ...wiz, lang });
  await shot(`garage-debrief-${lang}`, { ...rev, lang });
}
await browser.close();

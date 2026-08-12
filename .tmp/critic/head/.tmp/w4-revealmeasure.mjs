// SCRATCH (Wave 4 item 5) — measure the reveal's geometry. Not a gate.
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const a = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) a[k.slice(2)] = (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--')) ? true : process.argv[++i];
}
const FN = a.fn || 'previewReveal';
const tmp = resolve(root, '.tmp');
mkdirSync(tmp, { recursive: true });
const entry = resolve(tmp, 'w4-rm-entry.js');
writeFileSync(entry, `
import { bootPreview } from ${JSON.stringify(resolve(root, 'src/core/harness.js'))};
import * as M from ${JSON.stringify(resolve(root, 'src/garage/garage.js'))};
bootPreview(M[${JSON.stringify(FN)}]);`);
const built = await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'iife', minify: true, write: false,
  alias: { three: resolve(root, 'vendor/three.module.js') }, target: ['chrome100'], logLevel: 'warning',
});
const htmlPath = resolve(tmp, 'w4-rm.html');
writeFileSync(htmlPath, `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0d1a}#app{position:fixed;inset:0}</style>
</head><body><div id="app"><div id="boot"></div></div><script>${built.outputFiles[0].text}</script></body></html>`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage();
await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
const SIZES = [[1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 720], [1024, 640]];
for (const lang of ['he', 'en']) {
  await page.evaluate(l => window.__DEBUG.goto('preview', { lang: l }), lang);
  await new Promise(r => setTimeout(r, 350));
  for (const [w, h] of SIZES) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await new Promise(r => setTimeout(r, 400));
    const m = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) }; };
      const sc = q('.grg-rev-scroll');
      const rows = [...document.querySelectorAll('.grg-dbrow')];
      const last = rows[rows.length - 1];
      const labels = [...document.querySelectorAll('.grg-rev-scroll .label')].map(e => e.textContent.trim());
      return {
        scroll: sc ? { ...box(sc), sh: sc.scrollHeight, ch: sc.clientHeight, over: sc.scrollHeight - sc.clientHeight } : null,
        reveal: box(q('.grg-reveal')),
        actions: box(q('.grg-revactions')),
        debrief: box(q('.grg-debrief')),
        rows: rows.length,
        lastRow: box(last),
        labels,
        cols: [...document.querySelectorAll('.grg-revcol')].map(e => `${e.className.split(' ')[1]}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`),
        kids: [...(sc ? sc.children : [])].map(e => `${e.className.split(' ')[0]}:${Math.round(e.getBoundingClientRect().height)}`),
      };
    });
    console.log(`${lang} ${w}x${h}`.padEnd(14),
      `reveal ${m.reveal?.t}..${m.reveal?.b}`.padEnd(22),
      `scroll ch=${m.scroll?.ch} sh=${m.scroll?.sh} over=${m.scroll?.over}`.padEnd(34),
      `rows=${m.rows} lastRow ${m.lastRow?.t}..${m.lastRow?.b}`,
      `| ${m.kids.join(" ")} | ${m.cols.join(" ")}`);
  }
}
await browser.close();

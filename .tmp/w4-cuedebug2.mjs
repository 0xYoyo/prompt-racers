// SCRATCH — why does has-more survive scrolling to the bottom?
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const entry = resolve(root, '.tmp/w4-cd-entry.js');
writeFileSync(entry, `
import { bootPreview } from ${JSON.stringify(resolve(root, 'src/core/harness.js'))};
import * as M from ${JSON.stringify(resolve(root, 'src/garage/garage.js'))};
bootPreview(M.previewReveal);`);
const built = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', minify: true, write: false,
  alias: { three: resolve(root, 'vendor/three.module.js') }, target: ['chrome100'], logLevel: 'warning' });
const htmlPath = resolve(root, '.tmp/w4-cd.html');
writeFileSync(htmlPath, `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0d1a}#app{position:fixed;inset:0}</style>
</head><body><div id="app"><div id="boot"></div></div><script>${built.outputFiles[0].text}</script></body></html>`);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 640 });
await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 800));
const read = () => page.evaluate(() => {
  const sc = document.querySelector('.grg-rev-scroll');
  const body = document.querySelector('.grg-revbody');
  const cue = document.querySelector('.grg-morecue');
  return { ch: sc.clientHeight, sh: sc.scrollHeight, top: sc.scrollTop,
    gutter: sc.offsetWidth - sc.clientWidth, hasMore: body.classList.contains('has-more'),
    opacity: +getComputedStyle(cue).opacity, sbw: getComputedStyle(sc).scrollbarWidth };
});
console.log('initial ', await read());
await page.evaluate(() => { const s = document.querySelector('.grg-rev-scroll'); s.scrollTop = s.scrollHeight; });
await new Promise(r => setTimeout(r, 400));
console.log('bottom  ', await read());

const probe = await page.evaluate(async () => {
  const sc = document.querySelector('.grg-rev-scroll');
  let fired = 0;
  sc.addEventListener('scroll', () => { fired++; });
  sc.scrollTop = 0;
  await new Promise(r => setTimeout(r, 200));
  sc.scrollTop = sc.scrollHeight;
  await new Promise(r => setTimeout(r, 300));
  const body = document.querySelector('.grg-revbody');
  return { fired, top: sc.scrollTop, hidden: sc.scrollHeight - sc.clientHeight - sc.scrollTop,
    hasMore: body.classList.contains('has-more'), cls: body.className, kids: body.children.length,
    scrollers: document.querySelectorAll('.grg-rev-scroll').length, bodies: document.querySelectorAll('.grg-revbody').length };
});
console.log('probe   ', probe);
await browser.close();

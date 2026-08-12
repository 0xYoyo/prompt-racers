import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.argv[2] || resolve(root, 'dist/index.html');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
page.on('console', m => console.log('CONSOLE[' + m.type() + ']:', m.text().slice(0, 300)));
await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
await new Promise(r => setTimeout(r, 8000));
console.log(await page.evaluate(() => ({ hasDebug: !!window.__DEBUG, ready: window.__DEBUG?.ready, scene: window.__DEBUG?.state?.().scene })));
await browser.close();

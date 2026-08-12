// crop+zoom a PNG:  node .tmp/critic-crop.mjs in.png out.png x y w h [scale]
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'fs';
const [inp, outp, x, y, w, h, sc = 3] = process.argv.slice(2);
const b64 = readFileSync(inp).toString('base64');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setContent('<body style="margin:0"><canvas id=c></canvas></body>');
const data = await page.evaluate(async ({ b64, x, y, w, h, sc }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.getElementById('c');
  c.width = w * sc; c.height = h * sc;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(img, x, y, w, h, 0, 0, w * sc, h * sc);
  return c.toDataURL('image/png');
}, { b64, x: +x, y: +y, w: +w, h: +h, sc: +sc });
writeFileSync(outp, Buffer.from(data.split(',')[1], 'base64'));
await browser.close();
console.log('wrote', outp);

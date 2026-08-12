// measure the pixel height of dark text inside a region of a PNG
// node .tmp/critic-textpx.mjs img.png x y w h
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'fs';
const [inp, x, y, w, h] = process.argv.slice(2);
const b64 = readFileSync(inp).toString('base64');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const res = await page.evaluate(async (o) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + o.b64; await img.decode();
  const c = document.getElementById('c'); c.width = o.w; c.height = o.h;
  const g = c.getContext('2d');
  g.drawImage(img, o.x, o.y, o.w, o.h, 0, 0, o.w, o.h);
  const d = g.getImageData(0, 0, o.w, o.h).data;
  const lum = [];
  for (let j = 0; j < o.h; j++) {
    let dark = 0, sum = 0;
    for (let i = 0; i < o.w; i++) {
      const k = (j * o.w + i) * 4;
      const L = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
      sum += L; if (L < 110) dark++;
    }
    lum.push({ row: j, dark, mean: +(sum / o.w).toFixed(1) });
  }
  return lum;
}, { b64, x: +x, y: +y, w: +w, h: +h });
console.log(res.map(r => `${String(r.row).padStart(3)}  dark=${String(r.dark).padStart(3)}  mean=${r.mean}`).join('\n'));
await browser.close();

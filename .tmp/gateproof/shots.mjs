// Podium + certificate, both languages, four resolutions, from a real seeded
// championship ledger. Proves the .pop-in positioning collision is gone.
import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

const root = resolve(process.cwd());
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = resolve(root, 'shots/podium-fix');
mkdirSync(OUT, { recursive: true });

const SIZES = [[1920, 1080], [1366, 768], [1280, 720], [1024, 640]];
const REST = ['zamzum', 'tipa', 'kaftor', 'raash'];
const ORDERS = [
  ['zuzi', 'nitzotz', 'plada', 'nurit', ...REST],
  ['plada', 'zuzi', 'nitzotz', 'nurit', ...REST],
  ['nitzotz', 'nurit', 'zuzi', 'plada', ...REST],
];
const results = ORDERS.map((order, i) => ({
  trackIndex: i, track: ['oasis', 'circuit', 'cloud'][i], place: order.indexOf('nitzotz') + 1,
  timeMs: 90000 + i * 1000, bestLapMs: 30000,
  standings: order.map((id, j) => ({ racerId: id, place: j + 1, isPlayer: id === 'nitzotz', timeMs: 90000 + j * 800 })),
}));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--disable-lcd-text', '--force-device-scale-factor=1',
    '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage();
await page.goto('file://' + resolve(root, 'dist/index.html'), { waitUntil: 'load', timeout: 60000 });
await page.evaluate((k, d) => localStorage.setItem(k, JSON.stringify(d)), 'promptracers.v1', {
  lang: 'he', quality: 'high', muted: true, racerId: 'nitzotz',
  garageMetBoreg: true, garageTokenIntroSeen: true,
  championshipRace: 3, tokens: 9, parts: { engine: 2, tires: 1 }, results,
  bestPrompt: { text: 'מנוע קליל שמאיץ מהר ביציאה מפנייה, בלי לאבד אחיזה', score: 84 },
});

for (const lang of ['he', 'en']) {
  for (const [w, h] of SIZES) {
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.evaluate(l => window.__DEBUG.goto('podium', { lang: l }), lang);
    await new Promise(r => setTimeout(r, 700));
    await page.evaluate(() => window.__DEBUG.renderOnce());
    await new Promise(r => setTimeout(r, 250));
    await page.screenshot({ path: `${OUT}/podium-${lang}-${w}x${h}.png`, type: 'png' });

    const geo = await page.evaluate(() => {
      const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right) }; };
      return { side: r('.mn-side'), bottom: r('.mn-bottom'), total: r('.mn-total') };
    });
    console.log(`podium ${lang} ${w}x${h}  side=${JSON.stringify(geo.side)} bottom=${JSON.stringify(geo.bottom)} total.bottom=${geo.total?.b}`);

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /תעודת|Certificate/.test(x.textContent));
      b?.click();
    });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => window.__DEBUG.renderOnce());
    await page.screenshot({ path: `${OUT}/cert-${lang}-${w}x${h}.png`, type: 'png' });
  }
}
await browser.close();

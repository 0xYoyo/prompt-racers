// Load an OLD-style save (results written when track 2 was still עיר המעגלים)
// and check the UI resolves the new display name everywhere.
import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
const root = resolve(process.cwd());
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + root + '/dist/index.html', { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('promptracers.v1', JSON.stringify({
    lang: 'he', tokens: 40, championshipRace: 2,
    results: [
      { track: 'oasis', place: 2, time: 91234 },
      { track: 'circuit', place: 1, time: 88888 },
    ],
    bestLap: { circuit: 28888 },
    parts: {}, tipsSeen: [], badges: [], glossary: [], stats: {},
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
const OPTS = { menu: {}, results: { track: 'circuit', trackIndex: 1, place: 1 }, podium: {}, select: {} };
for (const scene of ['menu', 'results', 'podium', 'select']) {
  await page.evaluate((s, o) => window.__DEBUG.goto(s, o), scene, OPTS[scene]);
  await new Promise(r => setTimeout(r, 400));
  const txt = await page.evaluate(() => document.body.innerText);
  if (scene === 'menu') console.log('MENU TEXT:', txt.replace(/\n/g, ' | ').slice(0, 600));
  console.log(`--- ${scene}: old name present? ${/המעגלים/.test(txt)} | new name present? ${/הנוירונים/.test(txt)}`);
  const m = txt.match(/.{0,40}(הנוירונים|המעגלים).{0,40}/g);
  if (m) console.log('   ', m.join(' // ').replace(/\n/g, ' '));
}
console.log('championship state read back:', await page.evaluate(() => JSON.parse(localStorage.getItem('promptracers.v1')).results.map(r => r.track).join(',')));
if (errs.length) console.log('PAGE ERRORS:', errs.slice(0, 5));
await browser.close();

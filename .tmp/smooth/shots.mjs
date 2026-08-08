// Wave-3 smoothing, art pass: capture every screen a child meets, in sequence,
// in both languages, at one resolution, so they can be judged as ONE game.
// node .tmp/smooth/shots.mjs [--tag before|after]
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SAVE_KEY = 'promptracers.v1';
const TAG = (process.argv.find(a => a.startsWith('--tag=')) || '--tag=before').slice(6);
const OUT = resolve(root, 'shots/smooth-' + TAG);
mkdirSync(OUT, { recursive: true });

const W = 1440, H = 810;
const ORDER = ['nitzotz', 'zuzi', 'plada', 'nurit', 'zamzum', 'tipa', 'kaftor', 'raash'];
const ledger = n => Array.from({ length: n }, (_, i) => ({
  trackIndex: i, track: ['oasis', 'circuit', 'cloud'][i], place: 1, timeMs: 90000 + i * 1000,
  bestLapMs: 30000,
  standings: ORDER.map((id, j) => ({ racerId: id, place: j + 1, isPlayer: id === 'nitzotz', timeMs: 90000 + j * 800 })),
}));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--disable-lcd-text', '--force-device-scale-factor=1',
    '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const settle = (ms = 500) => new Promise(r => setTimeout(r, ms));
const boot = async patch => {
  await page.goto('file://' + resolve(root, 'dist/index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((k, d) => localStorage.setItem(k, JSON.stringify(d)), SAVE_KEY, {
    quality: 'high', muted: true, racerId: 'nitzotz',
    garageMetBoreg: true, garageTokenIntroSeen: true, ...patch,
  });
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
};
const snap = async name => {
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await settle(350);
  await page.screenshot({ path: resolve(OUT, name + '.png'), type: 'png' });
  console.log('  ' + name);
};

for (const lang of ['he', 'en']) {
  console.log('\n' + lang.toUpperCase());
  const L = '-' + lang;

  // 1 title
  await boot({ lang, championshipRace: 0, results: [], tokens: 0, parts: {} });
  await page.evaluate(l => window.__DEBUG.goto('menu', { lang: l }), lang);
  await settle(900);
  await snap('01-title' + L);

  // 2 racer select
  await page.evaluate(() => window.__DEBUG.goto('select', {}));
  await settle(1200);
  await snap('02-select' + L);

  // 3 race + HUD
  await page.evaluate(() => window.__DEBUG.goto('race', { track: 0, difficulty: 1, seed: 4242, autopilot: true }));
  await settle(600);
  await page.evaluate(() => window.__DEBUG.advance(22));
  await snap('03-race' + L);

  // 4 quiz question, 5 quiz feedback
  await page.evaluate(() => window.__DEBUG.engine.active.quiz.openQuestion());
  await page.evaluate(() => window.__DEBUG.advance(0.6));
  await snap('04-quiz-q' + L);
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true })));
  await page.evaluate(() => window.__DEBUG.advance(0.6));
  await snap('05-quiz-fb' + L);

  // 6 pause
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })));
  await page.evaluate(() => window.__DEBUG.advance(3));
  await page.evaluate(() => window.__DEBUG.bus.emit('input:pause'));
  await settle(500);
  await snap('06-pause' + L);

  // 7 results
  await page.evaluate(o => window.__DEBUG.goto('results', o), {
    trackIndex: 0, track: 'oasis', place: 2, timeMs: 92000, bestLapMs: 30000, tokens: 12,
    standings: ORDER.map((id, j) => ({ racerId: id, place: j + 1, isPlayer: id === 'nitzotz', timeMs: 90000 + j * 800 })),
  });
  await settle(900);
  await snap('07-results' + L);

  // 8/9 garage visit 1 and visit 3
  await boot({ lang, championshipRace: 1, tokens: 17, parts: {}, results: ledger(1) });
  await page.evaluate(l => window.__DEBUG.goto('garage', { lang: l }), lang);
  await settle(1400);
  await snap('08-garage-v1' + L);
  // walk the wizard so the sentence and later steps are visible
  for (let s = 0; s < 4; s++) {
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('.grg-card, .grg-opt, [data-opt]')].filter(x => x.offsetParent);
      c[1]?.click() ?? c[0]?.click();
    });
    await settle(450);
  }
  await snap('09-garage-filled' + L);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find(b => /תבנה|build it/i.test(b.textContent))?.click();
  });
  await settle(1600);
  await snap('10-garage-reveal' + L);

  await boot({ lang, championshipRace: 2, tokens: 17, parts: { engine: 2, tires: 1 }, results: ledger(2) });
  await page.evaluate(l => window.__DEBUG.goto('garage', { lang: l }), lang);
  await settle(1400);
  await snap('11-garage-v3' + L);

  // 12 podium, 13 certificate
  await boot({
    lang, championshipRace: 3, tokens: 9, parts: { engine: 2, tires: 1 }, results: ledger(3),
    bestPrompt: { text: lang === 'he' ? 'בורג, תחזק לי את המנוע ליציאה מהסיבוב האחרון, בלי להוסיף משקל, בסגנון מדברי' : 'Boreg, strengthen my engine for the last corner exit, without adding weight, in a dusty desert style', score: 86 },
  });
  await page.evaluate(l => window.__DEBUG.goto('podium', { lang: l }), lang);
  await settle(1200);
  await snap('12-podium' + L);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find(b => /תעודת|Certificate/.test(b.textContent))?.click();
  });
  await settle(700);
  await snap('13-certificate' + L);
}

await browser.close();
console.log('\nwrote ' + OUT);

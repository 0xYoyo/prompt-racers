// CRITIC probe — read-only. Drives dist/index.html with crafted saves.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dist = resolve(root, 'dist/index.html');
const SAVE_KEY = 'promptracers.v1';
const REST = ['zamzum', 'tipa', 'kaftor', 'raash'];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms));
const shot = f => page.screenshot({ path: resolve(root, 'shots/' + f), type: 'png' });
const scene = () => page.evaluate(() => window.__DEBUG.state().scene);

await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

const ledger = orders => orders.map((order, i) => ({
  trackIndex: i, track: ['oasis', 'circuit', 'cloud'][i] || 'oasis',
  place: order.indexOf('nitzotz') + 1, timeMs: 90000 + i * 1000, bestLapMs: 30000,
  standings: order.map((id, j) => ({ racerId: id, place: j + 1, isPlayer: id === 'nitzotz', timeMs: 90000 + j * 800 })),
}));

const seed = async (patch) => {
  await page.evaluate((key, data) => localStorage.setItem(key, JSON.stringify(data)), SAVE_KEY, {
    lang: 'he', quality: 'low', muted: true, racerId: 'nitzotz',
    garageMetBoreg: true, garageTokenIntroSeen: true, ...patch,
  });
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
};
const goto = async (s, o = {}) => { await page.evaluate((s, o) => window.__DEBUG.goto(s, o), s, o); await settle(700); await page.evaluate(() => window.__DEBUG.renderOnce()); };
const readSave = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}'), SAVE_KEY);
const readPodium = () => page.evaluate(() => {
  const strip = s => String(s == null ? '' : s).replace(/[⁦-⁩]/g, '').trim();
  const rows = [...document.querySelectorAll('.mn-prow')].map(r => ({
    place: strip(r.querySelector('i')?.textContent), name: strip(r.querySelector('b')?.textContent),
    points: strip(r.querySelector('em')?.textContent), isMe: r.classList.contains('me'),
  }));
  const a = window.__DEBUG.engine.active;
  return { rows, title: strip(document.querySelector('.mn-podium-top .mn-h1')?.textContent),
    congrats: strip(document.querySelector('.mn-congrats')?.textContent),
    total: strip(document.querySelector('.mn-total em')?.textContent),
    karts: a?.mountedKarts ? a.mountedKarts() : null,
    body: strip(document.querySelector('.mn-root')?.innerText).slice(0, 400) };
});
const P = (label, v) => console.log('\n### ' + label + '\n' + (typeof v === 'string' ? v : JSON.stringify(v)));

/* ── PROBE 1: does the WINS tie-break term actually matter anywhere? ────── */
// zuzi 1st,1st,8th = 21 pts, 2 wins, final 8th.  nitzotz 2nd,2nd,4th = 21, 0 wins, final 4th.
// WITH the wins term  → zuzi 1st.   WITHOUT it → bestFinal decides → nitzotz 1st.
const WINS_DECIDE = [
  ['zuzi', 'nitzotz', 'plada', 'nurit', ...REST],
  ['zuzi', 'nitzotz', 'plada', 'nurit', ...REST],
  ['plada', 'nurit', 'zamzum', 'nitzotz', 'tipa', 'kaftor', 'raash', 'zuzi'],
];
await seed({ championshipRace: 3, tokens: 9, parts: { engine: 2 }, results: ledger(WINS_DECIDE),
  bestPrompt: { text: 'מנוע קליל שמאיץ מהר ביציאה מפנייה, בלי לאבד אחיזה', score: 84 } });
await goto('podium');
P('P1 wins-term discriminator (expect 1.זוזי 21, 2.ניצוץ 21 if wins term is live)', (await readPodium()).rows.slice(0, 3));
await shot('critic-p1-wins-tie.png');

/* ── PROBE 2: podium visited repeatedly ─────────────────────────────────── */
await seed({ championshipRace: 3, results: ledger(WINS_DECIDE) });
await goto('podium'); const c1 = (await readSave()).championshipsDone;
await goto('menu'); await goto('podium'); const c2 = (await readSave()).championshipsDone;
await goto('menu'); await goto('podium'); const c3 = (await readSave()).championshipsDone;
P('P2 championshipsDone after 1/2/3 podium visits', [c1, c2, c3]);

/* ── PROBE 3: what reset actually preserves / clears ─────────────────────── */
await seed({ championshipRace: 3, tokens: 9, parts: { engine: 2 }, results: ledger(WINS_DECIDE),
  bestPrompt: { text: 'x', score: 5 }, bestLap: { oasis: 31234 }, tipsSeen: ['a', 'b'],
  expertUnlocked: true, championshipAsked: ['q1', 'q2', 'q3'], championshipsDone: 2,
  quality: 'high', muted: true, lang: 'he' });
await goto('podium');
const beforeReset = await readSave();
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /אליפות חדשה/.test(b.textContent))?.click());
await settle(1100);
const afterReset = await readSave();
P('P3 save AFTER "אליפות חדשה"', {
  scene: await scene(),
  championshipRace: afterReset.championshipRace, results: (afterReset.results || []).length,
  tokens: afterReset.tokens, parts: afterReset.parts, bestPrompt: afterReset.bestPrompt,
  championshipCounted: afterReset.championshipCounted,
  championshipAsked: afterReset.championshipAsked,
  championshipsDone: afterReset.championshipsDone,
  PRESERVED: { lang: afterReset.lang, quality: afterReset.quality, muted: afterReset.muted,
    bestLap: afterReset.bestLap, tipsSeen: afterReset.tipsSeen, expertUnlocked: afterReset.expertUnlocked },
  before_counted: beforeReset.championshipCounted, before_asked: beforeReset.championshipAsked,
});

/* ── PROBE 4: second championship counted? (reset → finish again → podium) ─ */
await seed({ championshipRace: 3, results: ledger(WINS_DECIDE), championshipsDone: 1, championshipCounted: true });
await goto('podium');
P('P4 stale championshipCounted: does a 2nd finished ledger count?', await page.evaluate(k => {
  const s = JSON.parse(localStorage.getItem(k) || '{}');
  return { championshipsDone: s.championshipsDone, counted: s.championshipCounted };
}, SAVE_KEY));

/* ── PROBE 5: hole in the results array ─────────────────────────────────── */
const holed = ledger(WINS_DECIDE); holed[1] = null;
await seed({ championshipRace: 3, results: holed });
await goto('podium');
P('P5 hole in results[1] → podium', (await readPodium()).rows.slice(0, 3));
await shot('critic-p5-hole.png');

/* ── PROBE 6: racerId no longer in the roster ───────────────────────────── */
await seed({ championshipRace: 3, results: ledger(WINS_DECIDE), racerId: 'ghost-racer' });
await goto('podium');
const r6 = await readPodium();
P('P6 unknown racerId → podium', { rows: r6.rows.slice(0, 3), congrats: r6.congrats, title: r6.title, karts: r6.karts, total: r6.total });
await shot('critic-p6-ghost-racer.png');
const cert6 = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /תעודת/.test(x.textContent));
  b?.click();
  const ov = document.querySelector('.mn-ov');
  return (ov?.innerText || '').replace(/[⁦-⁩]/g, '').slice(0, 300);
});
P('P6 certificate with unknown racerId', cert6);

/* ── PROBE 7: championshipRace beyond TRACKS.length ─────────────────────── */
await seed({ championshipRace: 7, results: ledger(WINS_DECIDE) });
const t7 = await page.evaluate(() => [...document.querySelectorAll('.mn-root button')].map(b => b.textContent.trim()));
P('P7 title buttons with championshipRace=7', t7);
await goto('freeplay'); P('P7 freeplay door', { scene: await scene(), podium: await page.evaluate(() => !!document.querySelector('.mn-prow')) });
await goto('race', { track: 9 }); await settle(1200);
P('P7 goto race track=9', { scene: await scene(), canvasAlive: await page.evaluate(() => !!window.__DEBUG.engine.active) });
await shot('critic-p7-race-clamped.png');

/* ── PROBE 8: championshipRace=3 but EMPTY ledger ───────────────────────── */
await seed({ championshipRace: 3, results: [] });
await goto('podium');
const r8 = await readPodium();
P('P8 finished flag, empty ledger', { rows: r8.rows.slice(0, 3), title: r8.title, congrats: r8.congrats, total: r8.total, karts: r8.karts });
await shot('critic-p8-empty-ledger.png');

/* ── PROBE 9: new championship started MID-championship from the title ──── */
await seed({ championshipRace: 1, tokens: 14, parts: { engine: 1 }, results: ledger(WINS_DECIDE).slice(0, 1), championshipAsked: ['q1'] });
await goto('menu');
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /אליפות חדשה/.test(b.textContent))?.click());
await settle(1000);
P('P9 mid-championship "אליפות חדשה"', { scene: await scene(), save: await readSave() });

/* ── PROBE 10: podium reached via the garage door, then Escape ──────────── */
await seed({ championshipRace: 3, results: ledger(WINS_DECIDE) });
await goto('freeplay');
await page.keyboard.press('Escape'); await settle(800);
P('P10 podium via garage door, then Escape', { scene: await scene(),
  text: await page.evaluate(() => (document.querySelector('.mn-root')?.innerText || '').slice(0, 80)) });

console.log('\n### PAGE ERRORS\n' + (errs.length ? errs.join('\n') : 'none'));
await browser.close();

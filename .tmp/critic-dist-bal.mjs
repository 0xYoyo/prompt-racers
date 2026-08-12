// Built-game (dist/index.html) balance check: does the real game agree with the
// headless harness? Drives the REAL race scene on autopilot, scales the player's
// topSpeed/accel by `pace` exactly as tests/ai.test.mjs does, and reads the
// real finishing place out of the real results object.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dist = resolve(root, 'dist/index.html');

const CASES = [];
for (const pace of [1.00, 0.85, 0.70]) {
  for (const [n, track, difficulty] of [[1, 0, 1], [2, 1, 2], [3, 2, 3]]) {
    for (const seed of [2, 7, 23]) CASES.push({ pace, n, track, difficulty, seed });
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

const out = [];
for (const c of CASES) {
  const r = await page.evaluate(async (c) => {
    const D = window.__DEBUG;
    window.__LAST_RESULT__ = null;
    await D.goto('race', { track: c.track, difficulty: c.difficulty, seed: c.seed, autopilot: true, introCard: false });
    const s = window.__DEBUG.engine.active;
    s.player.p.topSpeed *= c.pace;
    s.player.p.accelPower *= c.pace;
    // Drive it out. Dismiss anything that owns the screen (quiz card etc.) so a
    // frozen sim cannot masquerade as a slow race.
    let simT = 0, guard = 0, lonely = 0;
    const near = () => {
      let m = 1e9;
      for (const d of s.field.drivers) m = Math.min(m, Math.abs(d.progress - (s.state.progress ?? 0)));
      return m;
    };
    while (!window.__LAST_RESULT__ && guard++ < 4000) {
      D.advance(0.25); simT += 0.25;
      const n = near(); if (Number.isFinite(n) && n > lonely) lonely = n;
      const q = document.querySelector('.quiz-card.quiz-answered');
      if (q && q.offsetParent) dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      const qq = document.querySelector('.quiz-q');
      if (qq && qq.offsetParent) dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
      if (simT > 600) break;
    }
    const res = window.__LAST_RESULT__;
    return { place: res?.place ?? null, phase: s.state?.phase, simT, lonely,
             tokens: res?.tokens, fromQuiz: res?.tokensFromQuiz };
  }, c);
  out.push({ ...c, ...r });
  console.log(`pace ${c.pace.toFixed(2)} race ${c.n} seed ${c.seed}  place ${r.place}  simT ${r.simT.toFixed(0)}s  lonely ${r.lonely.toFixed(3)}  tokens ${r.tokens} (quiz ${r.fromQuiz})`);
}
console.log('\n--- means ---');
for (const pace of [1.00, 0.85, 0.70]) {
  for (const n of [1, 2, 3]) {
    const rows = out.filter(o => o.pace === pace && o.n === n && o.place != null);
    if (!rows.length) { console.log(`pace ${pace} race ${n}: NO RESULT`); continue; }
    const m = rows.reduce((a, b) => a + b.place, 0) / rows.length;
    console.log(`pace ${pace.toFixed(2)} race ${n}: places ${rows.map(r => r.place).join(' ')}  mean ${m.toFixed(2)}`);
  }
}
if (errs.length) console.log('PAGE ERRORS:', errs.slice(0, 5));
await browser.close();

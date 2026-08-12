// Built-game balance check, robust version. One page per case (a stalled race
// must not poison the next one), and it reports WHY a race stalled.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, '.tmp/critic/index.html');
const CASES = [];
for (const pace of [1.00, 0.85]) {
  for (const [n, track, difficulty] of [[1, 0, 1], [2, 1, 2], [3, 2, 3]]) {
    for (const seed of [2, 7, 23]) CASES.push({ pace, n, track, difficulty, seed });
  }
}
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

const out = [];
for (const c of CASES) {
  const r = await page.evaluate(async (c) => {
    const D = window.__DEBUG;
    window.__LAST_RESULT__ = null;
    await D.goto('race', { track: c.track, difficulty: c.difficulty, seed: c.seed, autopilot: true, introCard: false });
    const s = D.engine.active;
    if (!s?.player) return { err: 'no race scene' };
    s.player.p.topSpeed *= c.pace;
    s.player.p.accelPower *= c.pace;
    let simT = 0, lastRT = -1, stallAt = null, stallDom = '';
    while (!window.__LAST_RESULT__ && simT < 400) {
      // dismiss anything owning the screen BEFORE advancing
      const vis = el => el && el.offsetParent !== null;
      const ans = document.querySelector('.quiz-card.quiz-answered');
      if (vis(ans)) dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      const q = document.querySelector('.quiz-q');
      if (vis(q)) dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
      for (const sel of ['.grgtok-scrim', '.grg-meet-scrim', '[data-onetime]']) {
        const sc = document.querySelector(sel);
        if (vis(sc)) sc.querySelector('button')?.click();
      }
      D.advance(0.25); simT += 0.25;
      const rt = s.state.raceTime;
      if (rt === lastRT && simT > 6 && stallAt == null) {
        stallAt = simT;
        stallDom = [...document.querySelectorAll('body *')]
          .filter(e => e.offsetParent && e.className && typeof e.className === 'string' &&
            /quiz|scrim|modal|intro|pause/.test(e.className))
          .map(e => e.className).slice(0, 4).join(' | ');
      }
      lastRT = rt;
    }
    const res = window.__LAST_RESULT__;
    return { place: res?.place ?? null, phase: s.state?.phase, lap: s.state?.lap,
             raceTime: s.state?.raceTime, simT, stallAt, stallDom,
             quizTokens: res?.tokensFromQuiz };
  }, c);
  out.push({ ...c, ...r });
  console.log(`pace ${c.pace.toFixed(2)} race ${c.n} seed ${String(c.seed).padStart(3)}  place ${r.place}  phase ${r.phase} lap ${r.lap} raceTime ${r.raceTime?.toFixed?.(1)}  simT ${r.simT}  stallAt ${r.stallAt} [${r.stallDom || ''}]`);
}
console.log('\n--- built-game means ---');
for (const pace of [1.00, 0.85]) for (const n of [1, 2, 3]) {
  const rows = out.filter(o => o.pace === pace && o.n === n && o.place != null);
  console.log(`pace ${pace.toFixed(2)} race ${n}: ${rows.length}/3 finished  places ${rows.map(r => r.place).join(' ')}  mean ${rows.length ? (rows.reduce((a, b) => a + b.place, 0) / rows.length).toFixed(2) : '-'}`);
}
await browser.close();

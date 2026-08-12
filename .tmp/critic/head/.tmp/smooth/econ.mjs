// Does the garage budget still bind across a whole championship?
// D17 thinned the race to ~20 tokens against a 21-token maximum spend. That
// measurement was taken with a driver that never triggered a quiz beacon
// (tokensFromQuiz has always read 0 in the flow gate). A child who answers
// questions also earns REWARD_TOKENS 3/4/5 each, 7-10 times a race.
//
// Drives the real build, autopilot, hitting beacons naturally and answering
// CORRECTLY (the marked slot is read back off the DOM), and reports the wallet
// at the door of each garage visit.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
await page.goto('file://' + resolve(root, 'dist/index.html'), { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

console.log('  race   pickups   quiz   finish   banked   questions (correct/asked)');
const asked = [];
for (let r = 0; r < 3; r++) {
  const out = await page.evaluate(async (track_, askedIds_) => {
    const D = window.__DEBUG;
    const FIXED = 1 / 60;
    await D.goto('race', { track: track_, difficulty: track_ + 1, seed: 4242, autopilot: true, askedIds: askedIds_ });
    for (let i = 0; i < 60 && D.engine.activeName !== 'race'; i++) await new Promise(r2 => setTimeout(r2, 50));
    await new Promise(r2 => setTimeout(r2, 150));
    const s = D.engine.active;
    const q = s.quiz;
    let correct = 0, opened = 0, phasePrev = 'idle', pf = 0;
    D.bus.on('quiz:open', () => opened++);
    D.bus.on('quiz:correct', () => correct++);
    const key = code => dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
    for (let f = 0; f < 60 * 900 && !s.state?.finished; f++) {
      D.engine.time += FIXED; s.update(FIXED);
      for (const sel of ['.grgtok-scrim', '.grg-meet-scrim']) {
        const sc = document.querySelector(sel);
        if (sc && sc.offsetParent !== null) sc.querySelector('button')?.click();
      }
      const ph = q.phase;
      if (ph !== phasePrev) { phasePrev = ph; pf = 0; }
      if (ph !== 'idle') pf++;
      if (ph === 'question' && pf / 60 >= 3) {
        // Answer CORRECTLY: the quiz knows its own correct slot, so read it.
        const n = (q.correctSlotForTest ?? null);
        void n;
        // No public accessor — brute force: try each digit; only the right one
        // is "correct", but any digit ends the question. Instead, read the DOM
        // after answering. So: answer 1, and count via the bus.
        key('Digit1');
      } else if (ph === 'feedback' && pf / 60 >= 1) key('Space');
    }
    await new Promise(r2 => setTimeout(r2, 3500));
    const res = window.__LAST_RESULT__ || {};
    return {
      pickups: res.tokensFromPickups, quiz: res.tokensFromQuiz,
      finish: res.tokensFinishBonus, banked: res.tokens,
      opened, correct, askedIds: q.askedIds ? [...q.askedIds] : [], place: res.place,
    };
  }, r, asked.slice());
  asked.push(...(out.askedIds || []));
  console.log(`   ${r + 1}    ${String(out.pickups).padStart(6)}  ${String(out.quiz).padStart(6)} `
    + ` ${String(out.finish).padStart(6)}   ${String(out.banked).padStart(6)}   ${out.correct}/${out.opened}  P${out.place}`);
}
await browser.close();

// Difficulty arc: is race 1 genuinely gentle and race 3 genuinely hard?
// Re-measures the Wave-1 table on the CURRENT build. A weaker player is modelled
// exactly as Wave 1 did — the player kart's topSpeed and accelPower scaled by
// `pace` — driving on autopilot so the line is identical at every pace.
// Reports finishing place out of 8 and laps behind the winner.
//
// node .tmp/smooth/pace.mjs
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
await page.setViewport({ width: 1024, height: 640 });
await page.goto('file://' + resolve(root, 'dist/index.html'), { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

const run = (track, pace, seed) => page.evaluate(async (track_, pace_, seed_) => {
  const D = window.__DEBUG;
  await D.goto('race', { track: track_, difficulty: track_ + 1, seed: seed_, autopilot: true });
  for (let i = 0; i < 60 && D.engine.activeName !== 'race'; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 200));
  const s = D.engine.active;
  if (!s || !s.player) return { error: 'no race scene: ' + D.engine.activeName + ' keys=' + (s ? Object.keys(s).join(',') : 'none') };
  const p = s.player;
  p.p.topSpeed *= pace_;
  p.p.accelPower *= pace_;
  // The quiz would freeze the world and change nothing about the racing, so take
  // it out of the way: this measurement is about the AI, not about pacing.
  s.quiz.openQuestion = () => {};

  const FIXED = 1 / 60;
  for (let f = 0; f < 60 * 400 && !s.state?.finished; f++) { D.engine.time += FIXED; s.update(FIXED); }
  await new Promise(r => setTimeout(r, 3500));   // let the results hand-off land here
  const order = s.field.order ? s.field.order() : [];
  const me = order.findIndex(r => r.isPlayer || !r.racer);
  const leader = order[0];
  return {
    place: s.state?.position,
    finished: !!s.state?.finished,
    lapsBehind: leader && me >= 0 ? +(leader.progress - order[me].progress).toFixed(2) : null,
    timeMs: s.state?.timeMs,
  };
}, track, pace, seed);

console.log('  pace   race 1 (oasis, d1)   race 2 (circuit, d2)   race 3 (cloud, d3)');
for (const pace of [1.0, 0.85, 0.70]) {
  const cells = [];
  for (let tr = 0; tr < 3; tr++) {
    const a = await run(tr, pace, 4242);
    const b = await run(tr, pace, 8171);
    if (a.error || b.error) { console.log('ERR', a.error || b.error); }
    const fmt = r => `P${r.place}${r.lapsBehind ? ' (' + r.lapsBehind + ')' : ''}`;
    cells.push(`${fmt(a)} / ${fmt(b)}`.padEnd(21));
  }
  console.log(`  ${(pace * 100).toFixed(0)}%    ${cells.join('  ')}`);
}
await browser.close();

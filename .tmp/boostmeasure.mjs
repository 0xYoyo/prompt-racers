// What is a correct quiz answer actually WORTH? (Wave 4, quiz.js BOOST retune)
//
//   node .tmp/boostmeasure.mjs "<label>:<strength>,<duration>,<impulse>" ... --races 1,3 --seeds 3 --counts 0,2,4
//
// Drives the real built game on autopilot (a clean racing line, no mistakes) and
// models a correct answer as exactly what quiz.js does to the body it holds:
// player.applyBoost(strength, duration, impulse), N times, spread over the race.
// The quiz panel itself is closed the frame it opens — the freeze stops the
// world for everyone, so it has no relative effect on the finishing order and
// only costs wall clock here.
//
// Reports finishing place and race time, so "a couple of correct answers should
// win race 1" can be checked rather than asserted.
import puppeteer from 'puppeteer-core';

const dist = '/Users/yoyopc/repos/kart-project/dist/index.html';
const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1]; };
const races = String(flag('races', '1,2,3')).split(',').map(Number);
const seeds = String(flag('seeds', '11,22,33')).split(',').map(Number);
const counts = String(flag('counts', '0,2,4')).split(',').map(Number);
const configs = argv.filter(a => a.includes(':')).map(a => {
  const [label, nums] = a.split(':');
  const [strength, duration, impulse] = nums.split(',').map(Number);
  return { label, strength, duration, impulse };
});
if (!configs.length) { console.error('give at least one "label:strength,duration,impulse"'); process.exit(2); }

const b = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 900, height: 560 });
const wait = ms => new Promise(r=>setTimeout(r,ms));

await page.goto('file://' + dist, { waitUntil: 'load' });
await page.evaluate(()=>localStorage.setItem('promptracers.v1', JSON.stringify({garageTokenIntroSeen:true, quizBoxIntroSeen:true})));
await page.reload({ waitUntil: 'load' });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

async function race(trackIdx, difficulty, seed, cfg, n) {
  await page.evaluate(o=>window.__DEBUG.goto('race', o),
    { track: trackIdx, difficulty, seed, autopilot: true, introCard: false });
  await wait(200);
  return page.evaluate(({ s, d, i, n }) => {
    const D = window.__DEBUG, A = () => D.engine.active;
    window.__LAST_RESULT__ = null;
    const marks = [];
    for (let k = 0; k < n; k++) marks.push(14 + k * (130 / Math.max(1, n)));
    let guard = 0, boosts = 0;
    while (!window.__LAST_RESULT__ && guard++ < 5000) {
      D.advance(0.1);
      const a = A();
      if (a.quiz && a.quiz.phase !== 'idle') a.quiz.close();
      while (marks.length && a.state.raceTime >= marks[0]) { marks.shift(); a.player.applyBoost(s, d, i); boosts++; }
    }
    const r = window.__LAST_RESULT__;
    return r ? { place: r.place, sec: r.timeMs / 1000, boosts } : { place: null, sec: A().state.raceTime, boosts };
  }, { s: cfg.strength, d: cfg.duration, i: cfg.impulse, n });
}

const rows = [];
for (const cfg of configs) {
  for (const r of races) {
    for (const n of counts) {
      const out = [];
      for (const seed of seeds) out.push(await race(r - 1, r, seed, cfg, n));
      const places = out.map(o => o.place);
      const mean = places.every(p=>p!=null) ? (places.reduce((a,c)=>a+c,0)/places.length) : NaN;
      const secs = out.map(o => o.sec.toFixed(1)).join('/');
      rows.push({ cfg: cfg.label, race: r, n, mean, places: places.join('/'), secs });
      console.log(`${cfg.label.padEnd(10)} race ${r}  ${String(n).padStart(2)} correct → place ${places.join('/')}  mean ${isNaN(mean)?'DNF':mean.toFixed(2)}   ${secs}s`);
    }
  }
}
console.log('\n label       race   n   mean place');
for (const r of rows) console.log(`  ${r.cfg.padEnd(10)} ${r.race}    ${String(r.n).padStart(2)}   ${isNaN(r.mean)?'DNF':r.mean.toFixed(2)}`);
await b.close();

// CRITIC — REAL modals in the REAL built game + init-while-modal-open. read-only.
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = 'file://' + process.cwd() + '/.tmp/critic/build.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 140)));

const RIG = () => {
  const a = window.__AUDIO;
  const an = a.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
  a.master.connect(an); window.__an = an;
  const buf = new Float32Array(an.fftSize);
  window.__measure = ms => new Promise(res => {
    let sum = 0, n = 0, peak = 0;
    const iv = setInterval(() => {
      window.__an.getFloatTimeDomainData(buf);
      let s = 0, p = 0;
      for (let i = 0; i < buf.length; i++) { const v = buf[i]; s += v * v; if (Math.abs(v) > p) p = Math.abs(v); }
      sum += Math.sqrt(s / buf.length); n++; if (p > peak) peak = p;
    }, 20);
    setTimeout(() => { clearInterval(iv); res({ rms: sum / Math.max(1, n), peak }); }, ms);
  });
  window.__buses = () => ({ engine: +a.engineBus.gain.value.toFixed(4), world: +a.worldBus.gain.value.toFixed(4),
    music: +a.musicBus.gain.value.toFixed(4), sfx: +a.sfxBus.gain.value.toFixed(4), ducked: a._modalDucked });
};

// ══ PART A: audio graph built WHILE a modal is already open ═════════════════
await page.goto(target, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
const pre = await page.evaluate(() => ({ ok: window.__AUDIO.ok, ducked: window.__AUDIO._modalDucked }));
// a panel owns the screen BEFORE the first user gesture (audio has no context yet)
await page.evaluate(() => window.__AUDIO.modal.push('intro'));
const mid = await page.evaluate(() => ({ ok: window.__AUDIO.ok, ducked: window.__AUDIO._modalDucked }));
await page.mouse.click(683, 400);          // the gesture that builds the graph
for (let i = 0; i < 30; i++) { if ((await page.evaluate(() => __AUDIO.ctx && __AUDIO.ctx.state)) === 'running') break; await sleep(100); }
await page.evaluate(RIG);
const A = await page.evaluate(async () => {
  const a = window.__AUDIO;
  const iv = setInterval(() => a.bus.emit('kart:engine', { rpm01: 0.85, load: 1, boosting: false, surface: 'asphalt' }), 16);
  a.bus.emit('drift:start'); a.bus.emit('drift:charge', { charge: 0.8 });
  await new Promise(r => setTimeout(r, 800));
  const m = await window.__measure(600);
  const b = window.__buses();
  clearInterval(iv); a.stopEngine(); a.drift.stop(a.now, 0.05); a.modal.pop('intro');
  return { rms: m.rms, peak: m.peak, b };
});
console.log('A  graph BUILT while a modal was open (pre-gesture push)');
console.log('   audio.ok before push =', pre.ok, ' _modalDucked after push =', mid.ducked, '(ctx not yet built)');
console.log('   WITH THE MODAL STILL OPEN → rms', A.rms.toFixed(5), 'peak', A.peak.toFixed(4), 'buses', JSON.stringify(A.b));
console.log('   EXPECTED under the spec: rms 0.00000, engine 0, world 0\n');

// ══ PART B: real modals inside a real race ══════════════════════════════════
await page.evaluate(() => localStorage.setItem('promptracers.v1', JSON.stringify({ garageTokenIntroSeen: true, quizBoxIntroSeen: true })));
await page.goto(target, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
await page.mouse.click(683, 400);
for (let i = 0; i < 30; i++) { if ((await page.evaluate(() => __AUDIO.ctx && __AUDIO.ctx.state)) === 'running') break; await sleep(100); }
await page.evaluate(RIG);
await page.evaluate(() => window.__DEBUG.goto('race', { track: 0, difficulty: 1 }));
await sleep(600);

const vis = sel => page.evaluate(s => [...document.querySelectorAll(s)].some(e => e.offsetParent !== null || e.getClientRects().length), sel);
const drive = async s => { for (let i = 0; i < s; i++) { await page.evaluate(() => window.__DEBUG.advance(0.5)); await sleep(90); } };

// let the race actually run (countdown, intro card if any)
console.log('B  real race — intro card present?', await vis('.intro-root, .introcard, .ic-root'));
const modalsNow = await page.evaluate(() => window.__DEBUG.state && JSON.stringify(window.__DEBUG.state().scene));
await drive(14);
const running = await page.evaluate(() => window.__measure(700));
console.log('   racing (no modal): rms', running.rms.toFixed(5), 'buses', JSON.stringify(await page.evaluate(() => window.__buses())), 'scene', modalsNow);

// REAL quiz panel
await page.evaluate(() => window.__DEBUG.engine.active.quiz.openQuestion());
await sleep(500);
const quizUp = await vis('.quiz-root.show');
const q = await page.evaluate(() => window.__measure(800));
const qb = await page.evaluate(() => window.__buses());
console.log('   REAL QUIZ panel up =', quizUp, '→ rms', q.rms.toFixed(6), 'peak', q.peak.toFixed(5), 'buses', JSON.stringify(qb));

// pause menu ON TOP of the quiz
await page.keyboard.press('Escape');
await sleep(400);
const pauseUp = await vis('.mn-dialog.pause');
const p = await page.evaluate(() => window.__measure(700));
console.log('   REAL PAUSE over quiz =', pauseUp, '→ rms', p.rms.toFixed(6), 'buses', JSON.stringify(await page.evaluate(() => window.__buses())));
await page.keyboard.press('Escape');
await sleep(400);
// answer + dismiss the quiz
await page.keyboard.press('1'); await sleep(400);
await page.keyboard.press('Space'); await sleep(600);
await drive(6);
const back = await page.evaluate(() => window.__measure(800));
console.log('   after the quiz closes: rms', back.rms.toFixed(5), 'buses', JSON.stringify(await page.evaluate(() => window.__buses())));

// plain pause, no quiz
await page.keyboard.press('Escape'); await sleep(500);
const p2 = await page.evaluate(() => window.__measure(800));
console.log('   REAL PAUSE alone =', await vis('.mn-dialog.pause'), '→ rms', p2.rms.toFixed(6), 'buses', JSON.stringify(await page.evaluate(() => window.__buses())));
await page.keyboard.press('Escape'); await sleep(600);
await drive(6);
const p3 = await page.evaluate(() => window.__measure(800));
console.log('   resumed: rms', p3.rms.toFixed(5), 'buses', JSON.stringify(await page.evaluate(() => window.__buses())));

console.log('\nERRORS:', errs.slice(0, 5));
await browser.close();

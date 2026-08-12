// CRITIC — is the duck stuck ON after a real quiz? read-only.
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = 'file://' + process.cwd() + '/.tmp/critic/build.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
await page.goto(target, { waitUntil: 'load', timeout: 90000 });
await page.evaluate(() => localStorage.setItem('promptracers.v1', JSON.stringify({ garageTokenIntroSeen: true, quizBoxIntroSeen: true })));
await page.goto(target, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
await page.mouse.click(683, 400);
for (let i = 0; i < 30; i++) { if ((await page.evaluate(() => __AUDIO.ctx && __AUDIO.ctx.state)) === 'running') break; await sleep(100); }
await page.evaluate(() => {
  const a = window.__AUDIO;
  const an = a.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0; a.master.connect(an);
  const buf = new Float32Array(an.fftSize);
  window.__measure = ms => new Promise(res => { let sum = 0, n = 0, peak = 0;
    const iv = setInterval(() => { an.getFloatTimeDomainData(buf); let s = 0, p = 0;
      for (let i = 0; i < buf.length; i++) { const v = buf[i]; s += v * v; if (Math.abs(v) > p) p = Math.abs(v); }
      sum += Math.sqrt(s / buf.length); n++; if (p > peak) peak = p; }, 20);
    setTimeout(() => { clearInterval(iv); res({ rms: sum / Math.max(1, n), peak }); }, ms); });
});
const snap = async label => {
  const s = await page.evaluate(() => {
    const a = window.__AUDIO;
    const q = window.__DEBUG.engine.active && window.__DEBUG.engine.active.quiz;
    const root = [...document.querySelectorAll('.quiz-root')].find(e => e.classList.contains('show'));
    return { ducked: a._modalDucked, engine: +a.engineBus.gain.value.toFixed(3), world: +a.worldBus.gain.value.toFixed(3),
      music: +a.musicBus.gain.value.toFixed(3), quizPhase: q ? q.phase : '-', quizVisible: !!root,
      pauseVisible: !!document.querySelector('.mn-dialog.pause'), paused: !!(window.__DEBUG.engine.active && window.__DEBUG.engine.active.paused) };
  });
  const m = await page.evaluate(() => window.__measure(600));
  console.log(label.padEnd(34), JSON.stringify({ ...s, rms: +m.rms.toFixed(5) }));
  return s;
};
await page.evaluate(() => window.__DEBUG.goto('race', { track: 0, difficulty: 1 }));
await sleep(600);
const drive = async n => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__DEBUG.advance(0.5)); await sleep(90); } };
await drive(14);
await snap('racing, no modal');
await page.evaluate(() => window.__DEBUG.engine.active.quiz.openQuestion());
await sleep(500);
await snap('real quiz open');
await page.keyboard.press('Digit1'); await sleep(600);
await snap('answered (feedback up)');
await page.keyboard.press('Space'); await sleep(800);
await snap('space dismissed feedback');
await drive(10);
await snap('after 3-2-1 resume + 5s drive');
await drive(20);
await snap('after 10 more sim-seconds');
console.log('\nERRORS:', errs.slice(0, 5));
await browser.close();

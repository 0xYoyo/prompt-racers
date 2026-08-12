// Measures the ENGINE VOICE alone, on the racer-select screen (no live sim).
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = process.env.T || '/Users/yoyopc/repos/kart-project/dist/index.html';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto('file://' + target, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  await page.mouse.click(683, 400);
  for (let i = 0; i < 30; i++) {
    if (await page.evaluate(() => window.__AUDIO.ctx.state === 'running')) break;
    await sleep(100);
  }
  await page.evaluate(() => {
    const a = window.__AUDIO;
    const an = a.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
    a.master.connect(an);
    const buf = new Float32Array(an.fftSize);
    window.__measure = ms => new Promise(res => {
      let sum = 0, n = 0, peak = 0;
      const iv = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0, p = 0;
        for (let i = 0; i < buf.length; i++) { const v = buf[i]; s += v * v; if (Math.abs(v) > p) p = Math.abs(v); }
        sum += Math.sqrt(s / buf.length); n++; if (p > peak) peak = p;
      }, 20);
      setTimeout(() => { clearInterval(iv); res({ rms: sum / Math.max(1, n), peak }); }, ms);
    });
    window.__hush = async () => {
      a.stopMusic(0.05); a.stopEngine(); a.drift.stop(a.now, 0.05); a.setAiEngines([]);
      await new Promise(r => setTimeout(r, 450));
    };
  });
  await page.evaluate(() => window.__DEBUG.goto('select'));
  await sleep(500);
  await page.evaluate(() => window.__hush());
  const quiet = await page.evaluate(() => window.__measure(400));
  console.log('idle      ', JSON.stringify(quiet));

  const holdEngine = async (rpm, ms) => {
    await page.evaluate(() => window.__hush());
    const m = await page.evaluate(async ({ rpm, ms }) => {
      const bus = window.__AUDIO.bus;
      const iv = setInterval(() => bus.emit('kart:engine',
        { rpm01: rpm, load: Math.min(1, 0.35 + rpm * 0.65), boosting: false, surface: 'asphalt' }), 16);
      await new Promise(r => setTimeout(r, 500));   // let the ramp settle
      const out = await window.__measure(ms);
      clearInterval(iv);
      window.__AUDIO.stopEngine();
      return out;
    }, { rpm, ms });
    console.log(`engine rpm=${rpm.toFixed(2)}`, JSON.stringify(m));
    return m;
  };
  for (const r of [0.15, 0.35, 0.6, 0.85, 1.0]) await holdEngine(r, 900);

  // modal duck probe
  await page.evaluate(() => window.__hush());
  const duck = await page.evaluate(async () => {
    const a = window.__AUDIO, bus = a.bus;
    const iv = setInterval(() => bus.emit('kart:engine', { rpm01: 0.8, load: 1, surface: 'asphalt' }), 16);
    await new Promise(r => setTimeout(r, 600));
    const before = await window.__measure(500);
    const M = a.modal || null;
    if (!M) { clearInterval(iv); return { before, note: 'no audio.modal seam' }; }
    M.push('someFutureModal');
    await new Promise(r => setTimeout(r, 300));
    const during = await window.__measure(500);
    M.pop('someFutureModal');
    await new Promise(r => setTimeout(r, 300));
    const after = await window.__measure(500);
    clearInterval(iv); a.stopEngine();
    return { before, during, after };
  });
  console.log('duck      ', JSON.stringify(duck));
} finally { await browser.close(); }

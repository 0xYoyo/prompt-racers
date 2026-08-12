// CRITIC — engine share of the mix while the kart is ACTUALLY DRIVING.
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = 'file://' + process.cwd() + '/.tmp/critic/build.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
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
await page.evaluate(() => window.__DEBUG.goto('race', { track: 0, difficulty: 1, autopilot: true }));
await sleep(800);
for (let i = 0; i < 20; i++) { await page.evaluate(() => window.__DEBUG.advance(0.5)); await sleep(80); }
const meas = async (label, setup) => {
  await page.evaluate(setup); await sleep(300);
  const mm = await page.evaluate(async () => {
    const p = window.__measure(1600);
    let rmin = 9, rmax = 0, rs = 0, n = 0;
    for (let i = 0; i < 8; i++) {
      window.__DEBUG.advance(0.22);
      const s = window.__AUDIO._engineState || {};
      const r = s.rpm01 ?? -1; if (r >= 0) { rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); rs += r; n++; }
      await new Promise(r2 => setTimeout(r2, 200));
    }
    const out = await p; out.rpm = n ? [rmin, rs / n, rmax] : null; out.speed = window.__DEBUG.engine.active.player.speed; out.duck = window.__AUDIO._modalDucked; out.eb = +window.__AUDIO.engineBus.gain.value.toFixed(3); out.ev = +window.__AUDIO.engine.out.gain.value.toFixed(4); out.en = window.__AUDIO.engine.enabled;
    return out;
  });
  console.log('  ' + label.padEnd(32), 'rms', mm.rms.toFixed(5), 'peak', mm.peak.toFixed(4),
    'rpm', mm.rpm ? mm.rpm.map(x => x.toFixed(2)).join('/') : '-', 'speed', (mm.speed || 0).toFixed(1), 'duck', mm.duck, 'engBus', mm.eb, 'voice', mm.ev, mm.en);
  return mm;
};
console.log('MIX WHILE ACTUALLY DRIVING (autopilot)');
const full = await meas('everything on', () => {});
const noEng = await meas('engine bus muted', () => window.__AUDIO.setVolume({ engine: 0 }));
const eng = await meas('engine only', () => window.__AUDIO.setVolume({ engine: 0.21, music: 0, sfx: 0 }));
const mus = await meas('music only', () => window.__AUDIO.setVolume({ engine: 0, music: 0.85, sfx: 0 }));
await page.evaluate(() => window.__AUDIO.setVolume({ engine: 0.21, music: 0.85, sfx: 1 }));
console.log('  engine adds', (20 * Math.log10(full.rms / noEng.rms)).toFixed(2), 'dB to the mix;',
  'engine vs music:', (20 * Math.log10(eng.rms / mus.rms)).toFixed(1), 'dB');
await browser.close();

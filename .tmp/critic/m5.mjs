// CRITIC — intro card (the new "future modal") + engine's share of the real race mix.
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
  window.__st = () => ({ ducked: a._modalDucked, engine: +a.engineBus.gain.value.toFixed(3),
    world: +a.worldBus.gain.value.toFixed(3), music: +a.musicBus.gain.value.toFixed(3) });
});

// ── the pre-race intro card: a modal that did not exist when audio.js was written
await page.evaluate(() => window.__DEBUG.goto('race', { track: 0, difficulty: 1, introCard: true }));
await sleep(900);
const cardUp = await page.evaluate(() => !!document.querySelector('.ic-root, .intro-root, [class*="intro"]'));
const st1 = await page.evaluate(() => window.__st());
const m1 = await page.evaluate(() => window.__measure(700));
console.log('INTRO CARD visible =', cardUp, ' state', JSON.stringify(st1), ' rms', m1.rms.toFixed(5));
// dismiss it
await page.keyboard.press('Space'); await sleep(400);
await page.evaluate(() => window.__DEBUG.advance(4)); await sleep(300);
for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__DEBUG.advance(0.5)); await sleep(90); }
const st2 = await page.evaluate(() => window.__st());
const m2 = await page.evaluate(() => window.__measure(700));
console.log('after dismissing it      ', JSON.stringify(st2), ' rms', m2.rms.toFixed(5));

// ── the engine's share of the real race mix ────────────────────────────────
const drive = async n => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__DEBUG.advance(0.5)); await sleep(90); } };
await drive(14);
const meas = async (label, setup) => {
  await page.evaluate(setup);
  await sleep(400);
  const mm = await page.evaluate(async () => {
    const p = window.__measure(1400);
    for (let i = 0; i < 6; i++) { window.__DEBUG.advance(0.25); await new Promise(r => setTimeout(r, 220)); }
    return p;
  });
  console.log('  ' + label.padEnd(34), 'rms', mm.rms.toFixed(5), 'peak', mm.peak.toFixed(4));
  return mm;
};
console.log('\nENGINE SHARE OF THE REAL RACE MIX (mid-race, driving)');
const full = await meas('everything on', () => {});
const noEng = await meas('engine bus muted', () => window.__AUDIO.setVolume({ engine: 0 }));
const engOnly = await meas('engine only (music+sfx off)', () => { const a = window.__AUDIO; a.setVolume({ engine: 0.21, music: 0, sfx: 0 }); });
await page.evaluate(() => window.__AUDIO.setVolume({ engine: 0.21, music: 0.85, sfx: 1 }));
console.log('  engine contribution: full', full.rms.toFixed(5), 'vs no-engine', noEng.rms.toFixed(5),
  '→', (20 * Math.log10(full.rms / Math.max(1e-9, noEng.rms))).toFixed(2), 'dB of the mix');
console.log('  engine alone in race:', engOnly.rms.toFixed(5), ' = ',
  (20 * Math.log10(engOnly.rms / Math.max(1e-9, noEng.rms))).toFixed(1), 'dB relative to music+sfx bed');
console.log('\nERRORS:', errs.slice(0, 5));
await browser.close();

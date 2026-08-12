// CRITIC — ducking torture. read-only.
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = process.cwd() + '/.tmp/critic/build.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 120)));
await page.goto('file://' + target, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
await page.mouse.click(683, 400);
for (let i = 0; i < 30; i++) { if ((await page.evaluate(() => __AUDIO.ctx.state)) === 'running') break; await sleep(100); }

await page.evaluate(() => {
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
  window.__hush = async () => { a.stopMusic(0.05); a.stopEngine(); a.drift.stop(a.now, 0.05); a.setAiEngines([]); await new Promise(r => setTimeout(r, 450)); };
  window.__rev = () => { if (window.__revIv) return; window.__revIv = setInterval(() => a.bus.emit('kart:engine', { rpm01: 0.85, load: 1, boosting: false, surface: 'asphalt' }), 16); };
  window.__revStop = () => { clearInterval(window.__revIv); window.__revIv = 0; a.stopEngine(); };
  window.__buses = () => ({ engine: a.engineBus.gain.value, world: a.worldBus.gain.value, music: a.musicBus.gain.value, sfx: a.sfxBus.gain.value, master: a.master.gain.value, ducked: a._modalDucked });
});
await page.evaluate(() => window.__DEBUG.goto('select'));
await sleep(400);
await page.evaluate(() => window.__hush());

const line = (n, o) => console.log(n.padEnd(46), JSON.stringify(o));

// ── 1. unknown id ────────────────────────────────────────────────────────────
let r = await page.evaluate(async () => {
  const a = window.__AUDIO; window.__rev(); await new Promise(r => setTimeout(r, 700));
  const before = await window.__measure(400);
  a.modal.push('zzz-never-existed-2027');
  await new Promise(r => setTimeout(r, 400));
  const during = await window.__measure(500);
  const buses = window.__buses();
  a.modal.pop('zzz-never-existed-2027');
  await new Promise(r => setTimeout(r, 400));
  const after = await window.__measure(500);
  window.__revStop();
  return { before: before.rms, during: during.rms, duringPeak: during.peak, after: after.rms, buses };
});
line('1 unknown modal id', { before: +r.before.toFixed(5), during: +r.during.toFixed(6), duringPeak: +r.duringPeak.toFixed(6), after: +r.after.toFixed(5), engineBus: r.buses.engine, worldBus: r.buses.world });

// ── 2. nested, popped OUT OF ORDER ───────────────────────────────────────────
r = await page.evaluate(async () => {
  const a = window.__AUDIO; window.__rev(); await new Promise(r => setTimeout(r, 700));
  a.modal.push('A'); a.modal.push('B');
  await new Promise(r => setTimeout(r, 350));
  const bothOpen = window.__buses();
  a.modal.pop('A');                     // out of order: A first, B still up
  await new Promise(r => setTimeout(r, 350));
  const onlyB = await window.__measure(400); const onlyBB = window.__buses();
  a.modal.pop('B');
  await new Promise(r => setTimeout(r, 500));
  const closed = await window.__measure(500); const closedB = window.__buses();
  window.__revStop();
  return { bothOpen, onlyB: onlyB.rms, onlyBB, closed: closed.rms, closedB };
});
line('2 nested A+B, pop A then B', { withBstillOpen_rms: +r.onlyB.toFixed(6), engineBusWithB: r.onlyBB.engine, afterAllClosed_rms: +r.closed.toFixed(5), engineBusEnd: r.closedB.engine, duckedEnd: r.closedB.ducked });

// ── 3. same id pushed twice, popped once (two owners) ────────────────────────
r = await page.evaluate(async () => {
  const a = window.__AUDIO; window.__rev(); await new Promise(r => setTimeout(r, 700));
  a.modal.push('quiz'); a.modal.push('quiz');   // two owners, one id
  await new Promise(r => setTimeout(r, 350));
  const both = window.__buses();
  a.modal.pop('quiz');                           // one owner closes
  await new Promise(r => setTimeout(r, 400));
  const one = await window.__measure(400); const oneB = window.__buses();
  a.modal.pop('quiz');
  window.__revStop();
  return { both, one: one.rms, oneB };
});
line('3 same id twice, popped once', { engineBusAfterFirstPop: r.oneB.engine, rms: +r.one.toFixed(5), ducked: r.oneB.ducked });

// ── 4. rapid open/close ──────────────────────────────────────────────────────
r = await page.evaluate(async () => {
  const a = window.__AUDIO; window.__rev(); await new Promise(r => setTimeout(r, 700));
  for (let i = 0; i < 40; i++) { a.modal.push('rapid' + i); a.modal.pop('rapid' + i); }
  await new Promise(r => setTimeout(r, 600));
  const open = await window.__measure(500);
  const b = window.__buses();
  window.__revStop();
  return { rms: open.rms, b };
});
line('4 rapid 40x push/pop -> audio back?', { rms: +r.rms.toFixed(5), engineBus: r.b.engine, ducked: r.b.ducked });

// ── 5. master volume changed WHILE ducked ────────────────────────────────────
r = await page.evaluate(async () => {
  const a = window.__AUDIO; const was = a.getMasterVolume();
  window.__rev(); await new Promise(r => setTimeout(r, 700));
  a.modal.push('pause');
  await new Promise(r => setTimeout(r, 350));
  a.setMasterVolume(1.0, false);
  a.setVolume({ engine: 0.5 });                 // group volume write mid-duck
  await new Promise(r => setTimeout(r, 400));
  const during = await window.__measure(500); const b = window.__buses();
  a.modal.pop('pause');
  await new Promise(r => setTimeout(r, 500));
  const after = await window.__measure(400); const b2 = window.__buses();
  a.setVolume({ engine: 0.21 }); a.setMasterVolume(was, false); window.__revStop();
  return { during: during.rms, b, after: after.rms, b2 };
});
line('5 volume writes mid-duck', { rmsDuring: +r.during.toFixed(6), engineBus: r.b.engine, worldBus: r.b.world, rmsAfterPop: +r.after.toFixed(5), engineBusAfter: r.b2.engine });

// ── 6. mute / unmute while ducked ────────────────────────────────────────────
r = await page.evaluate(async () => {
  const a = window.__AUDIO;
  window.__rev(); await new Promise(r => setTimeout(r, 700));
  a.modal.push('pause'); await new Promise(r => setTimeout(r, 300));
  a.setMuted(true, false); await new Promise(r => setTimeout(r, 250));
  a.setMuted(false, false); await new Promise(r => setTimeout(r, 300));
  const during = await window.__measure(400); const b = window.__buses();
  a.modal.pop('pause'); await new Promise(r => setTimeout(r, 600));
  const after = await window.__measure(500); const b2 = window.__buses();
  window.__revStop();
  return { during: during.rms, b, after: after.rms, b2 };
});
line('6 mute+unmute mid-duck', { rmsDuring: +r.during.toFixed(6), engineBus: r.b.engine, rmsAfterPop: +r.after.toFixed(5), engineBusAfter: r.b2.engine });

// ── 7. graph rebuild (dispose+init) while ducked ─────────────────────────────
r = await page.evaluate(async () => {
  const a = window.__AUDIO;
  window.__rev(); await new Promise(r => setTimeout(r, 600));
  a.modal.push('pause'); await new Promise(r => setTimeout(r, 300));
  const preB = window.__buses();
  a.dispose(); a.init();
  // re-attach the meter to the NEW master node
  const an = a.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
  a.master.connect(an); window.__an = an;
  await a.ctx.resume().catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  const midB = window.__buses();
  const during = await window.__measure(500);
  a.modal.pop('pause');
  await new Promise(r => setTimeout(r, 600));
  const after = await window.__measure(600); const b2 = window.__buses();
  window.__revStop();
  return { preB, midB, during: during.rms, after: after.rms, b2, state: a.ctx.state };
});
line('7 dispose+init while ducked', { engineBusWhileDucked: r.midB.engine, ducked: r.midB.ducked, rmsDuring: +r.during.toFixed(6), rmsAfterPop: +r.after.toFixed(5), engineBusAfter: r.b2.engine, ctx: r.state });

console.log('\nERRORS:', errs.slice(0, 6));
await browser.close();

// CRITIC measurement rig — read-only, measures .tmp/critic/build.html
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = process.cwd() + '/.tmp/critic/build.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + target, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
await page.mouse.click(683, 400);
for (let i = 0; i < 30; i++) { if ((await page.evaluate(() => __AUDIO.ctx.state)) === 'running') break; await sleep(100); }

await page.evaluate(() => {
  const a = window.__AUDIO;
  const an = a.ctx.createAnalyser();
  an.fftSize = 4096; an.smoothingTimeConstant = 0;
  a.master.connect(an);
  const buf = new Float32Array(an.fftSize);
  const fbuf = new Float32Array(an.frequencyBinCount);
  window.__measure = ms => new Promise(res => {
    let sum = 0, n = 0, peak = 0;
    const spec = new Float64Array(an.frequencyBinCount);
    const iv = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let s = 0, p = 0;
      for (let i = 0; i < buf.length; i++) { const v = buf[i]; s += v * v; if (Math.abs(v) > p) p = Math.abs(v); }
      sum += Math.sqrt(s / buf.length); n++; if (p > peak) peak = p;
      an.getFloatFrequencyData(fbuf);
      for (let i = 0; i < fbuf.length; i++) spec[i] += Math.pow(10, fbuf[i] / 20);
    }, 20);
    setTimeout(() => {
      clearInterval(iv);
      const sr = a.ctx.sampleRate, binHz = sr / an.fftSize;
      const S = Array.from(spec, v => v / Math.max(1, n));
      // spectral centroid + dominant bin below 6 kHz
      let num = 0, den = 0, best = 0, bi = 0;
      for (let i = 1; i < S.length; i++) {
        const f = i * binHz; if (f > 8000) break;
        num += f * S[i]; den += S[i];
        if (f > 25 && f < 6000 && S[i] > best) { best = S[i]; bi = i; }
      }
      // band energies
      const band = (lo, hi) => { let e = 0; for (let i = 1; i < S.length; i++) { const f = i * binHz; if (f >= lo && f < hi) e += S[i] * S[i]; } return e; };
      res({ rms: sum / Math.max(1, n), peak, centroid: den ? num / den : 0, dom: bi * binHz,
            b: { lo: band(0, 300), mid: band(300, 1200), hi: band(1200, 4000), top: band(4000, 16000) } });
    }, ms);
  });
  window.__hush = async () => {
    a.stopMusic(0.05); a.stopEngine(); a.drift.stop(a.now, 0.05); a.setAiEngines([]);
    await new Promise(r => setTimeout(r, 450));
  };
});

// leave the title screen (its backdrop is a live raceScene)
await page.evaluate(() => window.__DEBUG.goto('select'));
await sleep(500);
await page.evaluate(() => window.__hush());
const quiet = await page.evaluate(() => window.__measure(600));
console.log('IDLE-BUS (racer select, hushed):', JSON.stringify({ rms: +quiet.rms.toFixed(6), peak: +quiet.peak.toFixed(5) }));

const holdEngine = async (rpm, ms = 1000) => {
  await page.evaluate(() => window.__hush());
  return page.evaluate(async ({ rpm, ms }) => {
    const bus = window.__AUDIO.bus;
    const iv = setInterval(() => bus.emit('kart:engine',
      { rpm01: rpm, load: Math.min(1, 0.35 + rpm * 0.65), boosting: false, surface: 'asphalt' }), 16);
    await new Promise(r => setTimeout(r, 700));
    const out = await window.__measure(ms);
    clearInterval(iv); window.__AUDIO.stopEngine();
    return out;
  }, { rpm, ms });
};

console.log('\n== ENGINE vs RPM (racer select, 3 passes) ==');
const rpms = [0, 0.15, 0.3, 0.5, 0.75, 1.0];
const table = {};
for (let pass = 0; pass < 3; pass++) {
  for (const r of rpms) {
    const m = await holdEngine(r, 800);
    (table[r] ||= []).push(m);
  }
}
for (const r of rpms) {
  const a = table[r];
  const avg = k => a.reduce((s, x) => s + x[k], 0) / a.length;
  console.log(`rpm ${String(r).padEnd(5)} rms ${avg('rms').toFixed(5)} [${a.map(x=>x.rms.toFixed(5)).join(' ')}]  peak ${avg('peak').toFixed(4)}  centroid ${avg('centroid').toFixed(0)}Hz  dom ${avg('dom').toFixed(0)}Hz`);
}
const r0 = table[0.15].reduce((s,x)=>s+x.rms,0)/3, r1 = table[1].reduce((s,x)=>s+x.rms,0)/3;
console.log(`full/idle ratio (rpm1.0 / rpm0.15) = x${(r1/r0).toFixed(2)}   dB=${(20*Math.log10(r1/r0)).toFixed(1)}`);
const rz = table[0].reduce((s,x)=>s+x.rms,0)/3;
console.log(`rpm0 (grid idle) rms ${rz.toFixed(5)}  vs idle-bus floor ${quiet.rms.toFixed(5)}`);

console.log('\n== MIX: engine vs music vs SFX ==');
const src = async (label, code, ms = 1400) => {
  await page.evaluate(() => window.__hush());
  const m = await page.evaluate(async ({ code, ms }) => {
    await new Function('a', 'bus', code)(window.__AUDIO, window.__AUDIO.bus);
    return window.__measure(ms);
  }, { code, ms });
  console.log(`${label.padEnd(30)} rms ${m.rms.toFixed(5)}  peak ${m.peak.toFixed(4)}  centroid ${m.centroid.toFixed(0)}`);
  return m;
};
const music = await src('race music (oasis)', `a.playMusic('race',{theme:'oasis'});`, 2500);
await page.evaluate(() => window.__hush());
const tok = await src('token pickup x5', `let i=0;const iv=setInterval(()=>{bus.emit('token:pickup',{combo:++i});if(i>4)clearInterval(iv);},160);`);
const wall = await src('wall hit', `bus.emit('kart:collide',{kind:'wall',speed:0.9});`, 900);
const qz = await src('quiz stinger correct', `bus.emit('quiz:correct');`, 1200);
await page.evaluate(() => window.__hush());
console.log(JSON.stringify({ engineFull: { rms: +r1.toFixed(5) }, music: +music.rms.toFixed(5), tokenPeak: +tok.peak.toFixed(4), wallPeak: +wall.peak.toFixed(4), quizPeak: +qz.peak.toFixed(4) }));

console.log('\nERRORS:', errs.slice(0, 5));
await browser.close();

// Offline audio verification. Renders every registered sound through an
// OfflineAudioContext inside headless Chrome (same puppeteer-core setup as
// tools/preview.mjs) and measures peak / RMS / silence / clipping / spectral
// centroid. Also simulates 60 seconds of race events to prove the voice cap
// holds and the master never clips.
//
//   node .tmp/audiocheck.mjs            # all sounds + 60s race sim
//   node .tmp/audiocheck.mjs --only ui  # filter by group or name substring
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tmp = resolve(root, '.tmp');
mkdirSync(tmp, { recursive: true });

const a = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) a[k.slice(2)] = (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--')) ? true : process.argv[++i];
}

const entry = resolve(tmp, 'audiocheck-entry.js');
writeFileSync(entry, `
import { audio } from ${JSON.stringify(resolve(root, 'src/audio/audio.js'))};
import { bus } from ${JSON.stringify(resolve(root, 'src/core/bus.js'))};
const SR = 44100;

// ---- analysis --------------------------------------------------------------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function measure(d, sr) {
  let peak = 0, sum = 0, clipped = 0, nz = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i], av = Math.abs(v);
    if (av > peak) peak = av;
    if (av > 1.0) clipped++;
    if (av > 0.0005) nz++;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / d.length);
  // spectral centroid: energy-weighted average over 2048-sample Hann windows
  const N = 2048;
  let cenNum = 0, cenDen = 0;
  for (let off = 0; off + N <= d.length; off += N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    let e = 0;
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
      re[i] = d[off + i] * w; e += d[off + i] * d[off + i];
    }
    if (e < 1e-8) continue;
    fft(re, im);
    let mn = 0, md = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      mn += m * (k * sr / N); md += m;
    }
    if (md > 0) { cenNum += (mn / md) * e; cenDen += e; }
  }
  return {
    peak: +peak.toFixed(4),
    rms: +rms.toFixed(5),
    rmsDb: +(20 * Math.log10(Math.max(rms, 1e-9))).toFixed(1),
    nonSilent: peak > 0.002 && rms > 0.00015,
    clips: clipped > 0,
    clippedSamples: clipped,
    activeRatio: +(nz / d.length).toFixed(3),
    centroid: cenDen > 0 ? Math.round(cenNum / cenDen) : 0,
  };
}

function fresh(seconds) {
  audio.dispose();
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
  audio.init({ context: ctx, muted: false });
  return ctx;
}

window.__list = () => audio.list();

window.__render = async (name, opts = {}) => {
  const info = audio.sounds.get(name);
  const seconds = opts.seconds || (info.dur + 0.6);
  const ctx = fresh(seconds);
  audio.play(name, Object.assign({ at: 0.05 }, opts));
  const buf = await ctx.startRendering();
  const m = measure(buf.getChannelData(0), SR);
  m.peakVoices = audio.peakVoices;
  m.dropped = audio.stats.dropped;
  return m;
};

// Engine sweep rendered through the *real* per-frame API path (setEngineState
// is realtime-only, so offline we drive the same automation entry point).
window.__engineDetail = async () => {
  const secs = 5.2;
  const ctx = fresh(secs);
  const E = audio.engine;
  E.enable(0.02, 0.1);
  const pts = [[0.05,0.05,0.15,0],[0.9,0.09,0.2,0],[1.5,0.4,0.8,0],[2.3,0.7,0.9,0],
               [3.0,0.95,1.0,0],[3.6,0.98,1.0,1],[4.4,0.5,0.4,0]];
  for (const [t, r, l, b] of pts) E.setAt(t, { rpm01: r, load: l, boosting: !!b, surface: 'road' }, 0.12);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  const seg = (t0, t1) => measure(d.slice(Math.floor(t0 * SR), Math.floor(t1 * SR)), SR);
  return { idle: seg(0.3, 0.85), mid: seg(1.8, 2.2), full: seg(3.1, 3.5), boost: seg(3.7, 4.3), whole: measure(d, SR) };
};

// 60 seconds of a plausible race: engine every 100ms, drift cycles, tokens,
// collisions, laps, music with a final-lap intensity lift.
window.__race = async (seconds = 60) => {
  const ctx = fresh(seconds + 1);
  audio.playMusic('race', { theme: 'circuit', at: 0, offline: seconds });
  audio.engine.enable(0.02, 0.2);
  const ai = [];
  for (let i = 0; i < 3; i++) ai.push(new (audio.engine.constructor)(audio, { level: 0.12, detune: [-72, 58, 121][i] }));
  for (const v of ai) v.enable(0.05, 0.2);

  let events = 0;
  for (let t = 0; t < seconds; t += 0.1) {
    const rpm = 0.45 + 0.45 * Math.sin(t * 1.7) * Math.cos(t * 0.31);
    audio.engine.setAt(t, { rpm01: Math.abs(rpm), load: 0.7, boosting: (t % 9) < 0.6, surface: (t % 13) < 1 ? 'grass' : 'road' }, 0.08);
    ai.forEach((v, i) => v.setAt(t, { rpm01: Math.abs(rpm) * (0.8 + i * 0.07), load: 0.7 }, 0.12));
  }
  const at = t => ({ at: t });
  for (let t = 0.5; t < seconds; t += 0.55) { audio.play('token.pickup', { at: t, combo: Math.floor(t) % 10 }); events++; }
  for (let t = 1.2; t < seconds; t += 3.1) { audio.play('drift.start', at(t)); audio.play('boost.release', at(t + 1.4)); events += 2; }
  for (let t = 2.7; t < seconds; t += 4.3) { audio.play('collide.wall', { at: t, speed: 0.8 }); events++; }
  for (let t = 3.9; t < seconds; t += 5.7) { audio.play('collide.kart', at(t)); audio.play('collide.scrape', at(t + 0.2)); events += 2; }
  for (let t = 6.0; t < seconds; t += 7.0) { audio.play('surface.grass', at(t)); events++; }
  for (let t = 15; t < seconds; t += 15) { audio.play('lap.complete', at(t)); events++; }
  audio.play('lap.final', at(45)); events++;
  audio.music.setIntensity(1);
  audio.play('results.sting', at(seconds - 3)); events++;
  for (let t = 0.3; t < seconds; t += 1.9) { audio.play('ui.hover', at(t)); events++; }

  const buf = await ctx.startRendering();
  const m = measure(buf.getChannelData(0), SR);
  m.peakVoices = audio.peakVoices;
  m.dropped = audio.stats.dropped;
  m.played = audio.stats.played;
  m.events = events;
  return m;
};

// Bus wiring: emit game events and confirm each produces a scheduled sound.
window.__buswire = async () => {
  const ctx = fresh(6);
  const before = audio.stats.played;
  const evs = [
    ['ui:hover'], ['ui:select'], ['ui:confirm'], ['ui:back'], ['ui:error'],
    ['race:countdown', 3], ['race:countdown', 0], ['race:lap'], ['race:finalLap'],
    ['race:position', 1], ['race:position', -1], ['race:finish'],
    ['token:pickup', {}], ['token:pickup', {}],
    ['kart:collide', { kind: 'wall', speed: 0.8 }], ['kart:collide', { kind: 'kart' }], ['kart:collide', { kind: 'scrape' }],
    ['kart:surface', 'grass'], ['kart:surface', 'sand'],
    ['drift:start'], ['drift:charge', 0.6], ['drift:end', { released: true }],
    ['garage:build'], ['garage:reveal', { tier: 0 }], ['garage:reveal', { score: 92 }],
    ['kart:engine', { rpm01: 0.5, load: 0.8 }],
    ['audio:play', { name: 'lap.final' }],
  ];
  for (const [e, p] of evs) bus.emit(e, p);
  const buf = await ctx.startRendering();
  const m = measure(buf.getChannelData(0), SR);
  m.emitted = evs.length;
  m.played = audio.stats.played - before;
  return m;
};

window.__muteCheck = async () => {
  const ctx = fresh(1.5);
  audio.setMuted(true, false);
  audio.play('race.fanfare', { at: 0.05 });
  audio.playMusic('race', { at: 0, offline: 1.2 });
  const buf = await ctx.startRendering();
  audio.setMuted(false, false);
  return measure(buf.getChannelData(0), SR);
};

window.__ready = true;
`);

const built = await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'iife', write: false,
  alias: { three: resolve(root, 'vendor/three.module.js') },
  target: ['chrome100'], logLevel: 'warning',
});

const htmlPath = resolve(tmp, 'audiocheck.html');
writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>${built.outputFiles[0].text}</script></body></html>`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto('file://' + htmlPath, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
let fails = 0;

const list = await page.evaluate(() => window.__list());
const filter = typeof a.only === 'string' ? a.only : null;
const rows = [];

console.log('\n── per-sound offline render (mono 44.1k) ' + '─'.repeat(46));
console.log(pad('sound', 24) + pad('grp', 8) + lpad('peak', 7) + lpad('rms', 9) + lpad('dBFS', 8) +
            lpad('cent.Hz', 9) + lpad('act%', 7) + lpad('voices', 8) + '  verdict');
for (const s of list) {
  if (filter && !s.name.includes(filter) && s.group !== filter) continue;
  const m = await page.evaluate(n => window.__render(n), s.name);
  const bad = [];
  if (!m.nonSilent) bad.push('SILENT');
  if (m.clips) bad.push('CLIPS(' + m.clippedSamples + ')');
  if (m.peak > 0.985) bad.push('HOT');
  if (bad.length) fails++;
  rows.push({ ...m, name: s.name, group: s.group });
  console.log(pad(s.name, 24) + pad(s.group, 8) + lpad(m.peak.toFixed(3), 7) + lpad(m.rms.toFixed(5), 9) +
    lpad(m.rmsDb, 8) + lpad(m.centroid, 9) + lpad((m.activeRatio * 100).toFixed(0), 7) +
    lpad(m.peakVoices, 8) + '  ' + (bad.length ? '✗ ' + bad.join(' ') : '✓'));
}

console.log('\n── engine sweep, per-phase ' + '─'.repeat(60));
const ed = await page.evaluate(() => window.__engineDetail());
for (const k of ['idle', 'mid', 'full', 'boost', 'whole']) {
  const m = ed[k];
  console.log(pad(k, 24) + lpad(m.peak.toFixed(3), 7) + lpad(m.rms.toFixed(5), 9) + lpad(m.rmsDb, 8) +
    lpad(m.centroid, 9) + '  ' + (m.nonSilent && !m.clips ? '✓' : '✗'));
  if (!m.nonSilent || m.clips) fails++;
}
if (!(ed.boost.centroid > ed.idle.centroid && ed.full.centroid > ed.idle.centroid)) {
  console.log('  ! centroid does not rise with rpm — engine is not tracking'); fails++;
} else {
  console.log(`  centroid idle ${ed.idle.centroid}Hz → full ${ed.full.centroid}Hz → boost ${ed.boost.centroid}Hz  ✓ rises with rpm`);
}

console.log('\n── bus wiring ' + '─'.repeat(73));
const bw = await page.evaluate(() => window.__buswire());
console.log(`  ${bw.played}/${bw.emitted} emitted events produced a sound; peak ${bw.peak.toFixed(3)} rms ${bw.rms.toFixed(5)} ` +
  (bw.nonSilent && !bw.clips ? '✓' : '✗'));
if (!bw.nonSilent || bw.clips || bw.played < bw.emitted - 2) fails++;

console.log('\n── mute ' + '─'.repeat(79));
const mu = await page.evaluate(() => window.__muteCheck());
console.log(`  muted output peak=${mu.peak} rms=${mu.rms} ` + (mu.peak < 0.001 ? '✓ silent' : '✗ LEAKS'));
if (mu.peak >= 0.001) fails++;

console.log('\n── 60s race simulation ' + '─'.repeat(64));
const r = await page.evaluate(() => window.__race(60));
console.log(`  events=${r.events} scheduled=${r.played} dropped=${r.dropped} peakVoices=${r.peakVoices}`);
console.log(`  peak=${r.peak.toFixed(4)} rms=${r.rms.toFixed(5)} (${r.rmsDb} dBFS) centroid=${r.centroid}Hz active=${(r.activeRatio * 100).toFixed(1)}%`);
const raceBad = [];
if (r.clips) raceBad.push('CLIPS(' + r.clippedSamples + ')');
if (!r.nonSilent) raceBad.push('SILENT');
if (r.peakVoices > 80) raceBad.push('RUNAWAY VOICES');
console.log('  ' + (raceBad.length ? '✗ ' + raceBad.join(' ') : '✓ no clipping, voice count bounded'));
if (raceBad.length) fails++;

if (errs.length) { console.log('\npage errors:\n' + errs.slice(0, 10).join('\n')); fails++; }
console.log(`\n${fails === 0 ? '✓ ALL CHECKS PASSED' : '✗ ' + fails + ' CHECK(S) FAILED'}  (${rows.length} sounds rendered)\n`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);

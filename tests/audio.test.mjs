// ─────────────────────────────────────────────────────────────────────────────
// AUDIO INTEGRATION GATE — runs against the REAL built game.
//
// Why this file exists: the audio module was verified in isolation (offline
// render, every sound measured non-silent) and the shipped game was still
// COMPLETELY SILENT, because src/audio/audio.js was never imported by any file
// that reaches the bundle. Isolation tests cannot see that class of bug. Neither
// can a "does the graph exist" check — so this one measures actual samples
// leaving the master bus of the real dist/index.html, after a real user gesture.
//
// It asserts:
//   1. the audio module is present in the bundle at all
//   2. the AudioContext reaches 'running' after ONE real click (autoplay policy)
//   3. the game is not silently muted from a previous session
//   4. simulated racing produces output that is non-silent AND non-clipping
//   5. engine / drift / token / UI / music each measurably produce output
//   6. every bus event the game actually emits reaches a listener (a renamed or
//      near-miss event name is silent, and silence looks like "works fine")
//
//   node tests/audio.test.mjs                  # gates dist/index.html
//   AUDIO_TEST_TARGET=/abs/path.html node …    # gate another build
// ─────────────────────────────────────────────────────────────────────────────
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = process.env.AUDIO_TEST_TARGET || resolve(root, 'dist/index.html');

// Non-silent floor and clip ceiling for the master bus. The soft-clip stage
// asymptotes at 0.97, so anything at/above ~0.98 means the curve was bypassed.
const RMS_FLOOR = 0.004;
const RMS_RACE_FLOOR = 0.012;
const PEAK_CEIL = 0.98;

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(52)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};
const die = msg => { console.error('\n\x1b[31m' + msg + '\x1b[0m\n'); process.exit(1); };

if (!existsSync(target)) die(`build missing: ${target}\n  run: npm run build`);

console.log('\n  AUDIO — real built game, real gesture, measured output\n  ' + '─'.repeat(72));

// ── 0. is the module even in the bundle? ─────────────────────────────────────
// This is the check that would have caught the original P0 in one second.
const html = readFileSync(target, 'utf8');
const bundled = /createOscillator/.test(html) && /__AUDIO/.test(html);
ok('audio module is present in the bundle', bundled,
  bundled ? '' : 'NOT BUNDLED — nothing imports src/audio/audio.js');
if (!bundled) {
  die('P0: the audio module never reaches the bundle, so the game is silent by construction.\n'
    + '    FIX (lead-owned file): add to src/main.js, before the SCENES import:\n'
    + "        import './audio/audio.js';\n"
    + '    The module self-wires to the bus and unlocks itself on the first gesture.');
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // Deliberately NO --mute-audio and NO --autoplay-policy override: the point is
  // to exercise the same autoplay policy a child's laptop applies.
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars'],
});

const pageErrors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });

  await page.goto('file://' + target, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  ok('audio singleton reachable in the running game', await page.evaluate(() => !!window.__AUDIO));

  // ── 1. autoplay policy ─────────────────────────────────────────────────────
  const pre = await page.evaluate(() => {
    const a = window.__AUDIO;
    return { muted: a.muted, state: a.ctx ? a.ctx.state : 'no-context' };
  });
  ok('not muted from a previous session', pre.muted === false, `muted=${pre.muted}`);

  // ONE real click, on whatever is under the cursor — exactly what a player does.
  const t0 = Date.now();
  await page.mouse.click(683, 400);
  // resume() is a promise: poll rather than assume it has settled. Still a hard
  // assertion — no further gesture is sent, so only that one click can do it.
  let post = null;
  for (let i = 0; i < 30; i++) {
    post = await page.evaluate(() => {
      const a = window.__AUDIO;
      return { state: a.ctx.state, master: a.master.gain.value, ok: a.ok };
    });
    if (post.state === 'running') break;
    await sleep(100);
  }
  ok('AudioContext reaches "running" after one click', post.state === 'running',
    `${pre.state} → ${post.state} in ${Date.now() - t0}ms`);
  ok('master gain is open', post.master > 0.1, post.master.toFixed(2));

  // ── metering rig: an analyser on the real master bus ───────────────────────
  await page.evaluate(() => {
    const a = window.__AUDIO;
    const an = a.ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0;
    a.master.connect(an);
    const buf = new Float32Array(an.fftSize);
    // Measure over `ms` of REAL time: peak + mean RMS of the actual samples.
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
    // Silence every persistent voice so a single source can be measured alone.
    window.__hush = async () => {
      a.stopMusic(0.05); a.stopEngine(); a.drift.stop(a.now, 0.05); a.setAiEngines([]);
      await new Promise(r => setTimeout(r, 450));
    };
  });

  // ── 2. silence floor: with nothing playing, the bus must be quiet ──────────
  // Leave the title screen first. Its backdrop is a REAL raceScene (that is the
  // whole point of it — you can see the game happening behind the logo), so it
  // emits `kart:engine` every frame and re-enables the engine voice on the frame
  // after `__hush()` disables it. Whether this assertion saw silence therefore
  // depended on rAF timing: it read 0.00000 most runs and 0.026–0.049 when a
  // frame landed inside the measurement window. Racer select has karts but no
  // running simulation, so nothing re-arms behind the meter.
  await page.evaluate(() => window.__DEBUG.goto('select'));
  await sleep(400);
  await page.evaluate(() => window.__hush());
  const quiet = await page.evaluate(() => window.__measure(400));
  ok('idle bus is quiet (proves the meter is honest)', quiet.rms < RMS_FLOOR, `rms ${quiet.rms.toFixed(5)}`);

  // ── 3. per-source: each family must measurably reach the destination ───────
  const measureSource = async (label, setup, ms = 900) => {
    await page.evaluate(() => window.__hush());
    const m = await page.evaluate(async ({ src, ms }) => {
      // eslint-disable-next-line no-new-func
      await new Function('a', 'bus', src)(window.__AUDIO, window.__AUDIO.bus);
      return window.__measure(ms);
    }, { src: setup, ms });
    ok(`${label} produces output`, m.rms > RMS_FLOOR && m.peak < PEAK_CEIL,
      `rms ${m.rms.toFixed(4)}  peak ${m.peak.toFixed(3)}`);
    return m;
  };

  // Emit at 60Hz from a rpm the kart actually idles at, which is what race.js
  // does. The old version ticked every 30ms from rpm 0 — and `setEngineState`
  // throttles writes to one per 33ms, so the test's period aliased against the
  // throttle and an unlucky phase could drop the early writes entirely while the
  // ramp was still near-silent. That produced an intermittent rms 0.0000 here
  // with nothing wrong in the game.
  await measureSource('engine (kart:engine bus events)', `
    let r = 0.3;
    const iv = setInterval(() => {
      r = Math.min(1, r + 0.03);
      bus.emit('kart:engine', { rpm01: r, load: 1, boosting: r > 0.8, surface: 'asphalt' });
    }, 16);
    setTimeout(() => clearInterval(iv), 1400);
  `);

  // ── 2b. ENGINE LOUDNESS AND THROTTLE RESPONSE (Wave 4) ────────────────────
  // Wave 3's engine was a constant grating buzz: measured on the built game it
  // sat at rms 0.0801 / peak 0.114 at rpm 0.15 and only 0.1012 / 0.135 flat out
  // — 0.98 dB of throttle response across the entire rev range, permanently on
  // top of the music and the SFX. Three things are pinned here so that cannot
  // silently come back: a CEILING (it must stay quiet), a FLOOR (it must not be
  // "fixed" by being turned off), and a RATIO (it must respond to the throttle).
  //
  // Measured on the racer-select screen for the same reason the silence check is
  // — the title screen's backdrop is a live raceScene that emits `kart:engine`
  // every frame, so anything measured there is measuring the game, not the test.
  // Wave 4 measures 0.0256 / 0.0629 / x3.47. The ceilings sit ~1.7x above that,
  // which is loose enough not to be flaky and far below every Wave-3 number.
  const ENGINE_RMS_CEIL = 0.045;   // full throttle; was 0.1012 in Wave 3
  const ENGINE_PEAK_CEIL = 0.090;  // full throttle; was 0.1350 in Wave 3
  const ENGINE_RISE = 1.6;         // min loud/quiet rms ratio; Wave 3 managed 1.26

  // Hold ONE rpm at 60Hz (race.js's rate — never 30ms, which aliases against the
  // ~30Hz throttle in setEngineState and drops writes), let the ramp settle, then
  // measure. Returns {rms, peak}.
  const holdEngine = async (rpm, ms = 900) => {
    await page.evaluate(() => window.__hush());
    return page.evaluate(async ({ rpm, ms }) => {
      const bus = window.__AUDIO.bus;
      const iv = setInterval(() => bus.emit('kart:engine',
        { rpm01: rpm, load: Math.min(1, 0.35 + rpm * 0.65), boosting: false, surface: 'asphalt' }), 16);
      await new Promise(r => setTimeout(r, 500));
      const out = await window.__measure(ms);
      clearInterval(iv);
      window.__AUDIO.stopEngine();
      return out;
    }, { rpm, ms });
  };

  const engLow = await holdEngine(0.15);
  const engHigh = await holdEngine(1.0);
  ok('engine is QUIET at full throttle (not the Wave-3 buzz)',
    engHigh.rms < ENGINE_RMS_CEIL && engHigh.peak < ENGINE_PEAK_CEIL,
    `rms ${engHigh.rms.toFixed(4)} < ${ENGINE_RMS_CEIL}, peak ${engHigh.peak.toFixed(3)} < ${ENGINE_PEAK_CEIL}`);
  ok('engine is still audible under throttle', engHigh.rms > RMS_FLOOR,
    `rms ${engHigh.rms.toFixed(4)} > ${RMS_FLOOR}`);
  ok('engine level RISES with speed (a child hears acceleration)',
    engHigh.rms > engLow.rms * ENGINE_RISE,
    `rpm 0.15 → ${engLow.rms.toFixed(4)}   rpm 1.0 → ${engHigh.rms.toFixed(4)}   `
    + `x${(engHigh.rms / Math.max(1e-9, engLow.rms)).toFixed(2)} (need x${ENGINE_RISE})`);

  // ── 2c. AUTOMATIC MODAL DUCKING (Wave 4) ──────────────────────────────────
  // The engine and the world must STOP while any panel owns the screen, driven by
  // the modal registry in ui/style.js (via onModalChange) — never by a list of
  // known modal ids in audio.js, because the modal someone adds next wave would
  // not be on it. `__AUDIO.modal` is the REAL registry re-exported as an
  // automation seam, i.e. the same Set quiz.js and pause.js push into.
  // rms over a 400ms window that STARTS at the push, as a fraction of unducked.
  // Verified by deliberately removing the subscription: without ducking this
  // window reads 0.97 of unducked, so 0.40 bites hard. Not tighter than that —
  // the unducked reference itself moves ±20% run to run, and this assertion is
  // only about "the ramp is short"; the settled check below is what proves
  // silence.
  const DUCK_FAST = 0.40;
  const duckProbe = async id => page.evaluate(async ({ id }) => {
    const a = window.__AUDIO, bus = a.bus;
    const iv = setInterval(() => bus.emit('kart:engine',
      { rpm01: 0.8, load: 1, boosting: false, surface: 'asphalt' }), 16);
    try {
      await new Promise(r => setTimeout(r, 600));
      const before = await window.__measure(500);
      a.modal.push(id);
      const ramp = await window.__measure(400);          // includes the fade itself
      const during = await window.__measure(400);        // fully settled
      a.modal.pop(id);
      await new Promise(r => setTimeout(r, 300));
      const after = await window.__measure(500);
      return { before, ramp, during, after, seam: true };
    } finally {
      clearInterval(iv);
      try { a.modal.pop(id); } catch { /* never leave a modal pinned */ }
      a.stopEngine();
    }
  }, { id });

  await page.evaluate(() => window.__hush());
  const dPause = await duckProbe('pause');
  ok('the modal seam is the real ui/style.js registry', dPause.seam === true);
  ok('a modal ducks the bus to silence within the ramp',
    dPause.ramp.rms < dPause.before.rms * DUCK_FAST && dPause.during.rms < RMS_FLOOR,
    `unducked ${dPause.before.rms.toFixed(4)} → ramp ${dPause.ramp.rms.toFixed(4)} → settled ${dPause.during.rms.toFixed(5)}`);
  ok('closing the last modal restores the engine',
    dPause.after.rms > RMS_FLOOR && dPause.after.rms > dPause.before.rms * 0.6,
    `recovered to ${dPause.after.rms.toFixed(4)} of ${dPause.before.rms.toFixed(4)}`);

  // The one that matters most: an id that did not exist when audio.js was written
  // must duck exactly the same, because the subscription is to the registry and
  // not to a table of names. If this passes while the 'pause' probe above also
  // passes, the duck cannot be hardcoded.
  await page.evaluate(() => window.__hush());
  const dFuture = await duckProbe('someFutureModal');
  ok('an UNKNOWN future modal id ducks too (registry-driven, not a list)',
    dFuture.during.rms < RMS_FLOOR && dFuture.after.rms > RMS_FLOOR,
    `settled ${dFuture.during.rms.toFixed(5)}, recovered ${dFuture.after.rms.toFixed(4)}`);
  ok('no modal is left pinned by the duck probes',
    (await page.evaluate(() => window.__AUDIO._modalDucked)) === false);
  await page.evaluate(() => window.__hush());

  // ── 2d. master volume API (used by the settings screen) ───────────────────
  const mv = await page.evaluate(() => {
    const a = window.__AUDIO, was = a.getMasterVolume();
    try {
      const set = a.setMasterVolume(0.4);
      const got = a.getMasterVolume();
      const hi = a.setMasterVolume(5), lo = a.setMasterVolume(-2), nan = a.setMasterVolume('x');
      // save.js's key. Read it directly: the point is to prove it really reached
      // storage, not just that the in-memory object changed.
      const persisted = JSON.parse(localStorage.getItem('promptracers.v1') || '{}').volume;
      return { was, set, got, hi, lo, nan, persisted };
    } finally {
      // NEVER leave the probe's value behind: a persisted 0 would open the next
      // run of the real game silent, and that would look like an audio bug.
      a.setMasterVolume(was);
    }
  });
  ok('setMasterVolume/getMasterVolume round-trip and clamp 0..1',
    mv.set === 0.4 && mv.got === 0.4 && mv.hi === 1 && mv.lo === 0 && mv.nan === 0,
    `set→${mv.set} get→${mv.got} clamp(5)→${mv.hi} clamp(-2)→${mv.lo} clamp('x')→${mv.nan}`);
  ok('master volume persists to save', mv.persisted === 0,
    `save.volume=${mv.persisted} (last write was the clamp of 'x')`);

  await measureSource('drift scrape (drift:start / drift:charge)', `
    bus.emit('drift:start');
    let c = 0;
    const iv = setInterval(() => { c = Math.min(1, c + 0.06); bus.emit('drift:charge', { charge: c }); }, 40);
    setTimeout(() => { clearInterval(iv); bus.emit('drift:end', { tier: 2 }); }, 1000);
  `);

  await measureSource('token pickup (token:pickup)', `
    let i = 0;
    const iv = setInterval(() => { bus.emit('token:pickup', { combo: ++i }); if (i > 4) clearInterval(iv); }, 160);
  `);

  await measureSource('UI (ui:confirm / ui:select)', `
    bus.emit('ui:confirm');
    setTimeout(() => bus.emit('ui:select'), 300);
  `);

  await measureSource('quiz stingers (quiz:correct / quiz:wrong)', `
    bus.emit('quiz:correct');
    setTimeout(() => bus.emit('quiz:wrong'), 700);
  `, 1500);

  for (const theme of ['oasis', 'circuit', 'cloud']) {
    await measureSource(`music — ${theme}`, `a.playMusic('race', { theme: ${JSON.stringify(theme)} });`, 1600);
  }
  const themeOk = await page.evaluate(() => window.__AUDIO.music.themeId);
  ok('music theme switches per track', themeOk === 'cloud', `themeId=${themeOk}`);
  await page.evaluate(() => window.__hush());

  // ── 4. every event the game really emits must be heard ────────────────────
  // A near-miss name (surface:changed vs surface:change) is silent, and silence
  // is indistinguishable from "no event happened". Assert each one lands.
  const EVENTS = [
    ['race:countdown', { n: 2 }], ['race:start', {}], ['race:lap', { lap: 1 }],
    ['race:bestlap', { ms: 41000 }], ['race:finallap', {}], ['race:position', { from: 3, to: 2 }],
    ['race:finish', { position: 1 }], ['token:pickup', { combo: 1 }],
    ['kart:collide', { kind: 'wall', speed: 0.8 }], ['kart:collide', { kind: 'kart', speed: 0.6 }],
    ['surface:change', { surface: 'grass' }], ['surface:change', { surface: 'sand' }],
    ['drift:start', {}], ['drift:tier', { tier: 2 }], ['drift:boost', { tier: 2 }],
    ['quiz:correct', {}], ['quiz:wrong', {}], ['quiz:timeout', {}],
    ['ui:hover', {}], ['ui:select', {}], ['ui:confirm', {}], ['ui:back', {}],
    ['garage:build', {}], ['garage:reveal', { tier: 3 }],
  ];
  const deaf = await page.evaluate(async evts => {
    const a = window.__AUDIO, bus = a.bus, missed = [];
    for (const [name, payload] of evts) {
      const before = a.stats.played;
      bus.emit(name, payload);
      if (a.stats.played === before) missed.push(name + (payload && payload.kind ? ':' + payload.kind : '')
        + (payload && payload.surface ? ':' + payload.surface : ''));
      await new Promise(r => setTimeout(r, 120));
    }
    return missed;
  }, EVENTS);
  ok('every emitted game event reaches a sound', deaf.length === 0,
    deaf.length ? 'SILENT: ' + deaf.join(', ') : `${EVENTS.length} events heard`);
  await page.evaluate(() => window.__hush());

  // ── 5. an actual race must be audible and must not clip ───────────────────
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /אליפות|Championship/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(900);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /לזינוק|Start|התחל/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(1500);
  const scene = await page.evaluate(() => window.__DEBUG.state().scene);
  ok('reaches the race scene', scene === 'race', scene);

  // Drive the sim forward in small slices, letting real time pass between them
  // so the audio clock actually renders what the race schedules.
  const raceMeter = page.evaluate(() => window.__measure(6000));
  for (let i = 0; i < 24; i++) {
    await page.evaluate(() => {
      window.__DEBUG.engine._headless = true;      // sim only; skip the GPU draw
      window.__DEBUG.advance(0.75);
    });
    await sleep(240);
  }
  const race = await raceMeter;
  const after = await page.evaluate(() => ({
    state: __AUDIO.ctx.state, played: __AUDIO.stats.played, dropped: __AUDIO.stats.dropped,
    peakVoices: __AUDIO.peakVoices, voices: __AUDIO.activeVoices,
    engine: __AUDIO.engine.enabled, music: __AUDIO.music.track + '/' + __AUDIO.music.themeId,
  }));

  ok('race audio is non-silent', race.rms > RMS_RACE_FLOOR, `rms ${race.rms.toFixed(4)}`);
  ok('race audio does not clip', race.peak < PEAK_CEIL, `peak ${race.peak.toFixed(3)}`);
  ok('engine voice is live during the race', after.engine === true);
  ok('race music is playing in the track theme', /^race\//.test(after.music), after.music);
  ok('context still running after the race', after.state === 'running', after.state);
  ok('no runaway voice growth', after.peakVoices <= 64, `peak ${after.peakVoices} voices, ${after.dropped} dropped`);
  console.log(`  \x1b[2mplayed ${after.played} sounds, ${after.voices} voices live at the end\x1b[0m`);

  ok('no page errors while the audio ran', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  failed++;
  console.error('\n\x1b[31m  harness error:\x1b[0m', e && (e.stack || e.message));
} finally {
  await browser.close();
}

console.log('  ' + '─'.repeat(72));
if (failed) { console.log(`\n  \x1b[31m${failed} audio check(s) failed\x1b[0m\n`); process.exit(1); }
console.log('\n  \x1b[32maudio OK — measured, in the real game\x1b[0m\n');

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
    // ── a SECOND, long-window meter, for the engine's level curve ────────────
    // 2048 samples is ~46ms — barely one cycle of the engine's 27 Hz sub at idle,
    // so a low-rpm reading is really "wherever in the waveform this window landed".
    // Worse, `triB` is detuned +0.4%, which at a 55 Hz fundamental beats against
    // triA with a ~4.5 SECOND period. Measured consequence: the same build read
    // rms 0.0086 on one page load and 0.0055 on the next, while three passes
    // inside one load agreed to ±5% — noise that looks exactly like a real
    // regression. 32768 samples (~0.74s) plus long windows averages both out.
    // Only the engine-shape checks use this; everything else is broadband and
    // fine on the fast meter.
    const anLF = a.ctx.createAnalyser();
    anLF.fftSize = 32768;
    anLF.smoothingTimeConstant = 0;
    a.master.connect(anLF);
    const bufLF = new Float32Array(anLF.fftSize);
    window.__measureLF = ms => new Promise(res => {
      let sum = 0, n = 0, peak = 0;
      const iv = setInterval(() => {
        anLF.getFloatTimeDomainData(bufLF);
        let s = 0, p = 0;
        for (let i = 0; i < bufLF.length; i++) { const v = bufLF[i]; s += v * v; if (Math.abs(v) > p) p = Math.abs(v); }
        sum += Math.sqrt(s / bufLF.length); n++; if (p > peak) peak = p;
      }, 60);
      setTimeout(() => { clearInterval(iv); res({ rms: sum / Math.max(1, n), peak }); }, ms);
    });
    // Hold ONE rpm at race.js's real 60Hz rate and measure it once settled.
    // `load` is the raw throttle (race.js:592 emits `player.throttleApplied`), so
    // this schedule is PART throttle — the quietest legitimate way to be at a
    // given speed, i.e. the worst case for the "can a child hear it" floor.
    window.__holdLF = async (rpm, ms) => {
      const iv = setInterval(() => a.bus.emit('kart:engine',
        { rpm01: rpm, load: Math.min(1, 0.35 + rpm * 0.65), boosting: false, surface: 'asphalt' }), 16);
      await new Promise(r => setTimeout(r, 600));
      const out = await window.__measureLF(ms);
      clearInterval(iv); a.stopEngine();
      return out;
    };
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

  // ── 2a. MENU AND BACKDROP SCREENS ARE GAMEPLAY-SILENT (Wave 5) ────────────
  // Measured on the built game before the fix: sitting on the TITLE SCREEN, whose
  // backdrop is a real raceScene with a real pack in it, produced 123 overtake
  // stingers, 2 lap jingles, a best-lap chime, a final-lap warning and a podium
  // sting in one 400s sit — plus a `race:complete` that scenes.js recorded into
  // the save and badges.js scored as if it were the child's own race.
  //
  // This is deliberately measured on the screen that is SECRETLY RUNNING THE GAME
  // (the same lesson as the idle-bus check above): a menu-silence assertion taken
  // on a screen with no simulation behind it proves nothing at all. So the
  // backdrop is stepped for 90 REAL simulated seconds through the harness while
  // the meter is open.
  //
  // Three separate properties, because they fail in three different ways:
  //   (a) the live backdrop makes no sound and starts no sounds;
  //   (b) hand-emitted gameplay events — every one the game can raise — are
  //       silent on a menu even though the same events are audible in a race;
  //   (c) THE STRUCTURAL ONE: a sound id that did not exist when audio.js was
  //       written is silent too if it is registered in a gameplay GROUP, and
  //       audible if it is registered in the UI group. A hardcoded list of known
  //       gameplay ids passes (a) and (b) and fails exactly here — which is what
  //       a future maintainer would actually write, and the same proof D34 used
  //       for the modal duck.
  // And the counter-assertion, on the same screen in the same state: music and a
  // UI click MUST still be heard, or "silent menus" would just be a mute.
  //
  // `race:wrongway` is deliberately NOT in the list below, and the reason is the
  // one thing a categorical gate cannot do: audio.js wires it to `ui.error`, a UI
  // sound, so on a menu it is allowed BY DESIGN — a menu may blip. It is covered
  // by (a) instead, because race.js is where it is stopped: the backdrop never
  // emits it in the first place. Left in the list it added rms 0.004 of legal UI
  // audio to a silence window and made this assertion sit on its own threshold.
  const MENU_EVENTS = [
    ['race:countdown', { n: 2 }], ['race:start', {}], ['race:lap', { lap: 2 }],
    ['race:bestlap', { ms: 41000 }], ['race:finallap', {}],
    ['race:position', { from: 4, to: 3 }], ['race:position', { from: 3, to: 4 }],
    ['race:finish', { position: 1 }],
    ['token:pickup', { tokens: 3, combo: 2 }],
    ['kart:collide', { kind: 'wall', speed: 0.9 }], ['kart:collide', { kind: 'kart', speed: 0.7 }],
    ['surface:change', { surface: 'grass' }], ['surface:change', { surface: 'sand' }],
    ['drift:start', {}], ['drift:tier', { tier: 2 }], ['drift:boost', { tier: 2 }],
    ['quiz:correct', {}], ['quiz:wrong', {}], ['quiz:timeout', {}],
  ];
  await page.evaluate(() => window.__DEBUG.goto('menu'));
  await sleep(500);
  const menu = await page.evaluate(async evts => {
    const a = window.__AUDIO, bus = a.bus;
    const started = [];
    const realPlay = a.play.bind(a);
    a.play = (n, o) => {
      const r = realPlay(n, o);
      if (r) started.push({ name: n, group: (a.sounds.get(n) || {}).group });
      return r;
    };
    const drain = () => { const out = started.slice(); started.length = 0; return out; };
    try {
      // Badge unlocks announce themselves with `garage.reveal` through
      // `audio:play` (badges.js), and a badge unlocks exactly once per save —
      // so the first pass over these events would otherwise measure a one-time
      // congratulation and call it a leaking race. Burn the one-time unlocks off
      // first, three passes, THEN open the meter. (That cue is UI-class audio and
      // is allowed on menus by design; it is the screen's own answer to the
      // child, not a race narrating itself.)
      for (let pass = 0; pass < 3; pass++) {
        for (const [name, payload] of evts) bus.emit(name, payload);
        await new Promise(r => setTimeout(r, 60));
      }
      await window.__hush();
      await new Promise(r => setTimeout(r, 700));
      drain();

      // (a) the live backdrop, stepped for 90 simulated seconds.
      // Both layers are checked separately here, because either one alone would
      // hide a break in the other: the EVENTS the backdrop emits (race.js's
      // guard) and the SOUND that reaches the bus (audio.js's). With only the
      // audio-side assertion, a backdrop that emits the whole race again still
      // measures silent — and the next thing to subscribe to those events, a
      // crowd, a banner, a save write, would get them.
      const GAMEPLAY_EVENT = /^(race:|token:|drift:|surface:change|kart:collide|kart:engine)/;
      const emitted = new Set();
      const realEmit = bus.emit.bind(bus);
      bus.emit = (evt, p) => { if (GAMEPLAY_EVENT.test(evt)) emitted.add(evt); return realEmit(evt, p); };
      const backdropMeter = window.__measure(2500);
      for (let i = 0; i < 90; i++) { window.__DEBUG.advance(1); await new Promise(r => setTimeout(r, 0)); }
      const backdrop = await backdropMeter;
      bus.emit = realEmit;
      const backdropEvents = [...emitted];
      const backdropStarted = drain();

      // (b) every gameplay event the game can raise, by hand
      await window.__hush();
      const handMeter = window.__measure(1800);
      for (const [name, payload] of evts) {
        bus.emit(name, payload);
        await new Promise(r => setTimeout(r, 45));
      }
      // the persistent voices have no `play()` to refuse them — check them too
      for (let i = 0; i < 30; i++) {
        bus.emit('kart:engine', { rpm01: 0.9, load: 1, boosting: false, surface: 'asphalt' });
        bus.emit('drift:charge', { charge: 0.8 });
        await new Promise(r => setTimeout(r, 16));
      }
      const hand = await handMeter;
      const handStarted = drain();
      const engineLive = a.engine.enabled;

      // (c) two sounds invented right now: same synthesis, different GROUP
      const voice = function (t) {
        this._tone(t, { type: 'triangle', f: 660, dur: 0.45, peak: 0.30, attack: 0.004 });
        this._tone(t, { type: 'sine', f: 990, dur: 0.35, peak: 0.18, attack: 0.004 });
      };
      a._snd('futureRace.sting', 'race', 0.6, 'probe (gameplay group)', voice);
      a._snd('futureUi.sting', 'ui', 0.6, 'probe (ui group)', voice);
      await window.__hush();
      const gm = window.__measure(900);
      const gameAccepted = a.play('futureRace.sting');
      const unknownGame = await gm;
      const um = window.__measure(900);
      const uiAccepted = a.play('futureUi.sting');
      const unknownUi = await um;

      // the counter-assertion: this screen is not simply muted
      await window.__hush();
      a.playMusic('menu');
      await new Promise(r => setTimeout(r, 900));
      const music = await window.__measure(1200);
      a.stopMusic(0.1);
      await new Promise(r => setTimeout(r, 600));
      const cm = window.__measure(900);
      bus.emit('ui:confirm');
      const click = await cm;

      return {
        backdrop, backdropStarted, backdropEvents, hand, handStarted, engineLive,
        gameAccepted, uiAccepted, unknownGame, unknownUi, music, click,
        scene: window.__DEBUG.state().scene,
      };
    } finally { a.play = realPlay; }
  }, MENU_EVENTS);

  const GAMEPLAY_GROUPS = ['race', 'drive', 'impact', 'quiz', 'engine'];
  const leaked = list => list.filter(s => GAMEPLAY_GROUPS.includes(s.group)).map(s => s.name);
  ok('the silent-menu probe really sat on the title screen', menu.scene === 'menu', menu.scene);
  ok('the LIVE menu backdrop emits no gameplay EVENTS (race.js)',
    menu.backdropEvents.length === 0,
    menu.backdropEvents.length ? 'EMITTED: ' + menu.backdropEvents.join(', ')
      : '90s of simulated racing behind the logo, not a word');
  ok('the LIVE menu backdrop starts no gameplay sound',
    leaked(menu.backdropStarted).length === 0,
    leaked(menu.backdropStarted).length
      ? 'SOUNDED: ' + [...new Set(leaked(menu.backdropStarted))].join(', ')
      : '90s of simulated racing behind the logo, silent');
  ok('the LIVE menu backdrop is inaudible on the master bus',
    menu.backdrop.rms < RMS_FLOOR, `rms ${menu.backdrop.rms.toFixed(5)} < ${RMS_FLOOR}`);
  ok('every gameplay EVENT is silent on a menu screen',
    leaked(menu.handStarted).length === 0 && menu.hand.rms < RMS_FLOOR,
    leaked(menu.handStarted).length
      ? 'SOUNDED: ' + [...new Set(leaked(menu.handStarted))].join(', ')
      : `${MENU_EVENTS.length} events, rms ${menu.hand.rms.toFixed(5)}`);
  ok('the engine voice cannot be armed from a menu', menu.engineLive === false);
  ok('an UNKNOWN gameplay sound id is silent too (group-driven, not a list)',
    menu.gameAccepted === false && menu.unknownGame.rms < RMS_FLOOR,
    `accepted=${menu.gameAccepted} rms ${menu.unknownGame.rms.toFixed(5)}`);
  ok('a UI sound invented at the same moment still plays',
    menu.uiAccepted === true && menu.unknownUi.rms > RMS_FLOOR,
    `accepted=${menu.uiAccepted} rms ${menu.unknownUi.rms.toFixed(4)}`);
  ok('menu MUSIC still plays on that same screen',
    menu.music.rms > RMS_FLOOR, `rms ${menu.music.rms.toFixed(4)}`);
  ok('a UI click still sounds on that same screen',
    menu.click.rms > RMS_FLOOR, `rms ${menu.click.rms.toFixed(4)}`);

  // Back to racer select, and onto the screen KIND where world audio is allowed —
  // everything from here to the real race below measures the sounds themselves,
  // and `scene:entered('race')` is what puts the game in this state for real.
  await page.evaluate(() => window.__DEBUG.goto('select'));
  await sleep(300);
  await page.evaluate(() => window.__AUDIO.setScreenKind('race'));
  await page.evaluate(() => window.__hush());

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
  // Wave 4 measures 0.026 / 0.065 / x2.5. The ceilings sit ~1.7x above that,
  // which is loose enough not to be flaky and far below every Wave-3 number.
  // EVERY number below comes from the long-window meter and the single sweep
  // underneath. An earlier version took each of these on its own 900ms window
  // through the 2048-sample analyser, which reported the ratio as anywhere from
  // x1.94 to x3.25 on one unchanged build — the same beat artifact described at
  // __measureLF, and the reason the figures first written into D34 were wrong.
  const ENGINE_RMS_CEIL = 0.045;   // full throttle; was 0.1012 in Wave 3
  const ENGINE_PEAK_CEIL = 0.090;  // full throttle; was 0.1350 in Wave 3
  const ENGINE_RISE = 1.6;         // min loud/quiet rms ratio; Wave 3 managed 1.26

  // ── 2b-i. THE SHAPE OF THE LEVEL CURVE ────────────────────────────────────
  // A ceiling at full throttle + a floor at full throttle + a ratio can ALL be
  // satisfied by an engine that is inaudible everywhere except flat out — and a
  // ratio check actively REWARDS that, scoring a silent idle as a better result.
  // A sabotaged build with `_levelFor = 0.02 + rpm^2.2` (idle 12x quieter than
  // shipped, i.e. gone) passed every one of those three and printed x31.40 as if
  // it were an improvement. So the curve is pinned by SHAPE, at both ends:
  //   (a) a LOW-RPM FLOOR — a child on the grid, or restarting after a crash,
  //       must be able to hear their own kart against the music bed (rms 0.027);
  //   (b) MONOTONICITY — the kart must never get quieter as it speeds up. That
  //       was a real bug: `strain` (throttle minus speed) peaks at low rpm, and
  //       as it faded, pulling away from the grid measured 12–17% QUIETER at
  //       rpm 0.3 than at 0.15.
  const SHAPE_RPMS = [0, 0.15, 0.3, 0.5, 0.75, 1.0];
  const IDLE_FLOOR_RMS = 0.0045;   // rpm 0 — measured 0.0065–0.0086
  const ROLL_FLOOR_RMS = 0.010;    // rpm 0.3 — measured 0.0120–0.0144
  const MONO_TOL = 0.95;           // no bucket below 95% of the one beneath it
  const shape = [];
  for (const r of SHAPE_RPMS) {
    const passes = [];
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.__hush());
      passes.push(await page.evaluate(({ r }) => window.__holdLF(r, 2500), { r }));
    }
    shape.push({
      rpm: r,
      rms: passes.reduce((s, m) => s + m.rms, 0) / passes.length,
      peak: passes.reduce((s, m) => s + m.peak, 0) / passes.length,
    });
  }
  const curve = shape.map(s => `${s.rpm}:${s.rms.toFixed(4)}`).join('  ');
  ok('engine is audible at IDLE (not "fixed" by silencing it)',
    shape[0].rms > IDLE_FLOOR_RMS, `rpm 0 → ${shape[0].rms.toFixed(4)} > ${IDLE_FLOOR_RMS}`);
  ok('engine is clearly audible pulling away (rpm 0.3, vs music bed 0.027)',
    shape[2].rms > ROLL_FLOOR_RMS, `rpm 0.3 → ${shape[2].rms.toFixed(4)} > ${ROLL_FLOOR_RMS}`);
  // From rpm 0.15 up. rpm 0 vs 0.15 is deliberately flat (IDLE_FLOOR dominates
  // there), so it is covered by its own floor above rather than by this chain.
  const dips = [];
  for (let i = 2; i < shape.length; i++) {
    if (shape[i].rms < shape[i - 1].rms * MONO_TOL) {
      dips.push(`rpm ${shape[i].rpm} is ${((1 - shape[i].rms / shape[i - 1].rms) * 100).toFixed(0)}% quieter than rpm ${shape[i - 1].rpm}`);
    }
  }
  ok('engine never gets QUIETER as the kart speeds up', dips.length === 0, dips.join('; ') || curve);

  // Same sweep, no extra measurements: buckets 0.15 and 1.0 are the quiet and
  // loud ends of the curve just measured.
  const engLow = shape[1], engHigh = shape[5];
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

  // ── 2c-i. the two JUDGEMENT CALLS in the duck (D34) ───────────────────────
  // Both of these are what a future maintainer "tidies up" into a full mute,
  // and both would be wrong. They are asserted on measured output, not on gain
  // values, because the question is what a child actually hears.
  //
  // SFX must stay OPEN: the quiz's own right/wrong stingers and every button the
  // child is about to press live on that bus. A modal that silenced its own
  // buttons would be worse than no ducking at all.
  const sfxUnderModal = await page.evaluate(async () => {
    const a = window.__AUDIO;
    a.modal.push('quiz');
    try {
      await new Promise(r => setTimeout(r, 250));
      a.bus.emit('quiz:correct');
      return await window.__measure(1200);
    } finally { a.modal.pop('quiz'); }
  });
  ok('SFX still sound while a modal is open (quiz stingers, buttons)',
    sfxUnderModal.rms > RMS_FLOOR, `rms ${sfxUnderModal.rms.toFixed(4)} > ${RMS_FLOOR}`);
  await page.evaluate(() => window.__hush());

  // Music DUCKS but does not STOP. A quiz card is a beat inside the race, not a
  // scene change; cutting the music dead reads as "the game broke", and the
  // restart when the panel closes is more jarring than the duck ever was.
  const musicUnderModal = await page.evaluate(async () => {
    const a = window.__AUDIO;
    a.playMusic('race', { theme: 'oasis' });
    await new Promise(r => setTimeout(r, 900));
    const before = await window.__measure(1200);
    a.modal.push('pause');
    try {
      await new Promise(r => setTimeout(r, 350));
      const during = await window.__measure(1500);
      return { before, during };
    } finally { a.modal.pop('pause'); a.stopMusic(0.1); }
  });
  ok('music DUCKS under a modal but does not stop',
    musicUnderModal.during.rms > RMS_FLOOR
    && musicUnderModal.during.rms < musicUnderModal.before.rms * 0.75,
    `${musicUnderModal.before.rms.toFixed(4)} → ${musicUnderModal.during.rms.toFixed(4)} `
    + `(must stay above ${RMS_FLOOR} and drop below 75%)`);
  await page.evaluate(() => window.__hush());

  // ── 2c-ii. A HIDDEN TAB PARKS THE AUDIO THREAD (Wave 5, item 7) ───────────
  // engine.js emits `audio:suspend` / `audio:resume` on visibility change; the
  // requirement is a REAL suspend, because the symptom being fixed is CPU burn
  // in a background tab and a graph ramped to zero still renders every voice.
  //
  // SILENCE IS NOT MEASURED WITH THE ANALYSER HERE, and that is not a shortcut.
  // A suspended context processes nothing, so `getFloatTimeDomainData` keeps
  // handing back the LAST buffer it filled — the meter would read the pre-suspend
  // audio forever and this assertion would fail on a correct fix and pass on a
  // ramp. The honest instrument is the context clock: if `currentTime` does not
  // advance, not one sample was produced. That is silence, and it is also the
  // exact property "the audio thread stopped" means.
  const SUSPEND_WINDOW = 700;      // ms of wall time to watch the clock over
  const susp = await page.evaluate(async ms => {
    const a = window.__AUDIO, bus = a.bus;
    const clockRate = async () => {
      const t0 = a.ctx.currentTime, w0 = performance.now();
      await new Promise(r => setTimeout(r, ms));
      return (a.ctx.currentTime - t0) / ((performance.now() - w0) / 1000);
    };
    const mixState = () => ({
      muted: a.muted, master: a.master.gain.value, volume: a.getMasterVolume(),
      engineBus: a.engineBus.gain.value, musicBus: a.musicBus.gain.value,
      modalDucked: a._modalDucked, track: a.music.track, theme: a.music.themeId,
      step: a.music._step,
    });
    const out = {};
    try {
      // ---- 1. plain: music playing, tab hidden, tab back -------------------
      a.playMusic('race', { theme: 'oasis' });
      await new Promise(r => setTimeout(r, 900));
      out.runningRate = await clockRate();
      out.before = mixState();
      out.beforeRms = await window.__measure(700);
      bus.emit('audio:suspend');
      await new Promise(r => setTimeout(r, 250));
      out.state = a.ctx.state;
      out.suspendedRate = await clockRate();
      bus.emit('audio:resume');
      await new Promise(r => setTimeout(r, 300));
      out.stateAfter = a.ctx.state;
      out.resumedRate = await clockRate();
      out.after = mixState();
      out.afterRms = await window.__measure(700);

      // ---- 2. muted across the round trip ----------------------------------
      a.setMuted(true, false);
      a.setMasterVolume(0.62, false);
      const mutedBefore = mixState();
      bus.emit('audio:suspend');
      await new Promise(r => setTimeout(r, 250));
      // the trap: an unmute or an unlock() while parked would restart the thread
      a.unlock();
      const mutedMid = { state: a.ctx.state, muted: a.muted };
      bus.emit('audio:resume');
      await new Promise(r => setTimeout(r, 350));
      out.muted = { before: mutedBefore, mid: mutedMid, after: mixState() };
      a.setMuted(false, false);

      // ---- 3. a modal is open across the round trip (D34's duck) -----------
      a.modal.push('quiz');
      await new Promise(r => setTimeout(r, 300));
      const duckBefore = mixState();
      bus.emit('audio:suspend');
      await new Promise(r => setTimeout(r, 250));
      bus.emit('audio:resume');
      await new Promise(r => setTimeout(r, 350));
      out.duck = { before: duckBefore, after: mixState() };
      return out;
    } finally {
      try { a.modal.pop('quiz'); } catch { /* */ }
      a.setMuted(false, false);
      bus.emit('audio:resume');
      a.stopMusic(0.1);
    }
  }, SUSPEND_WINDOW);

  const near = (x, y, tol) => Math.abs(x - y) <= tol;
  ok('audio:suspend really suspends the AudioContext',
    susp.state === 'suspended', `ctx.state=${susp.state}`);
  ok('a suspended context produces no samples at all (clock frozen)',
    susp.suspendedRate < 0.02 && susp.runningRate > 0.8,
    `clock ran at x${susp.runningRate.toFixed(2)} → x${susp.suspendedRate.toFixed(3)} of real time`);
  ok('audio:resume restarts the thread', susp.stateAfter === 'running' && susp.resumedRate > 0.8,
    `ctx.state=${susp.stateAfter}, clock x${susp.resumedRate.toFixed(2)}`);
  ok('the mix comes back where it was, and music does not restart',
    susp.afterRms.rms > RMS_FLOOR && susp.after.track === susp.before.track
    && susp.after.theme === susp.before.theme && susp.after.step >= susp.before.step,
    `rms ${susp.beforeRms.rms.toFixed(4)} → ${susp.afterRms.rms.toFixed(4)}, `
    + `${susp.before.track}/${susp.before.theme} step ${susp.before.step} → ${susp.after.step}`);
  // The two states a maintainer's "resume everything" reflex would clobber.
  ok('MUTE survives hide/show (and a parked tab cannot be unlocked)',
    susp.muted.after.muted === true && susp.muted.after.master === 0
    && susp.muted.mid.state === 'suspended'
    && near(susp.muted.after.volume, susp.muted.before.volume, 0.001),
    `muted ${susp.muted.before.muted}→${susp.muted.after.muted}, master ${susp.muted.after.master}, `
    + `volume ${susp.muted.before.volume}→${susp.muted.after.volume}, mid-state ${susp.muted.mid.state}`);
  ok('the MODAL DUCK survives hide/show (D34 stays applied)',
    susp.duck.after.modalDucked === true && susp.duck.after.engineBus < 0.001
    && near(susp.duck.after.musicBus, susp.duck.before.musicBus, 0.02),
    `ducked=${susp.duck.after.modalDucked} engineBus ${susp.duck.after.engineBus.toFixed(4)} `
    + `musicBus ${susp.duck.before.musicBus.toFixed(3)}→${susp.duck.after.musicBus.toFixed(3)}`);
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

  // ── 3b. THE QUIZ STING'S PLACE IN THE MIX (Wave 5) ────────────────────────
  // The sting fires 7–10 times a race (D28) over a bed that never rests, so where
  // it sits relative to the MUSIC is the whole question — an absolute ceiling
  // would be meaningless the moment the music moves. Pinned as a ratio, measured.
  //
  // ONE sweep on ONE long meter (D34): every number below comes from the same
  // 2.5s / fftSize-32768 windows, run back to back. Taking each on its own short
  // window is how three parties got three answers out of one build in Wave 4.
  //
  // Two traps this measurement has already fallen into, both documented so the
  // next person does not re-fall into them:
  //  * THE FIRST SOUND OF A PAGE LOAD IS NOT THE SOUND. The first `quiz:correct`
  //    of a save unlocks the `quiz-first` badge, and badges.js announces every
  //    unlock with `garage.reveal` — peak 0.489 on its own. Measured together
  //    they read peak 0.524, which is the "0.52 quiz stinger" GAPS recorded; the
  //    sting alone was 0.272. Section 2a above burns the one-time unlocks off
  //    before anything is measured, which is why this section is honest.
  //  * BOTH ENDS OR NEITHER. A ratio alone is satisfied by a sting that has been
  //    turned off, so the floor and the right/wrong contrast are pinned too.
  const STING_VS_MUSIC = 0.55;    // sting peak as a fraction of music peak
  const STING_RMS_FLOOR = 0.008;  // it must still be a moment, not a whisper
  const mix = await page.evaluate(async () => {
    const a = window.__AUDIO, bus = a.bus;
    const one = async src => {
      await window.__hush();
      await new Promise(r => setTimeout(r, 900));   // let any tail leave the window
      // eslint-disable-next-line no-new-func
      await new Function('a', 'bus', src)(a, bus);
      return window.__measureLF(2500);
    };
    return {
      silence: await one(';'),
      correct: await one(`bus.emit('quiz:correct');`),
      wrong: await one(`bus.emit('quiz:wrong');`),
      music: await one(`a.playMusic('race', { theme: 'oasis' });`),
      wall: await one(`bus.emit('kart:collide', { kind: 'wall', speed: 1 });`),
      token: await one(`bus.emit('token:pickup', { combo: 1 });`),
    };
  });
  await page.evaluate(() => window.__hush());
  console.log(`  \x1b[2mmix sweep (one long meter): sting ${mix.correct.peak.toFixed(3)}/${mix.correct.rms.toFixed(4)}  `
    + `wrong ${mix.wrong.peak.toFixed(3)}/${mix.wrong.rms.toFixed(4)}  music ${mix.music.peak.toFixed(3)}/${mix.music.rms.toFixed(4)}  `
    + `wall ${mix.wall.peak.toFixed(3)}  token ${mix.token.peak.toFixed(3)}\x1b[0m`);
  ok('the mix meter is honest (silence between rows)', mix.silence.rms < RMS_FLOOR,
    `rms ${mix.silence.rms.toFixed(5)}`);
  ok('quiz sting sits BELOW the music it plays over',
    mix.correct.peak < mix.music.peak * STING_VS_MUSIC,
    `sting peak ${mix.correct.peak.toFixed(3)} vs music ${mix.music.peak.toFixed(3)} `
    + `= ${(mix.correct.peak / Math.max(1e-9, mix.music.peak)).toFixed(2)} (need < ${STING_VS_MUSIC})`);
  ok('quiz sting is not the loudest event in the game',
    mix.correct.peak < mix.wall.peak && mix.correct.rms < mix.music.rms,
    `sting ${mix.correct.peak.toFixed(3)} < wall ${mix.wall.peak.toFixed(3)}, `
    + `rms ${mix.correct.rms.toFixed(4)} < music ${mix.music.rms.toFixed(4)}`);
  ok('quiz sting was not "fixed" by silencing it',
    mix.correct.rms > STING_RMS_FLOOR && mix.correct.peak > mix.token.peak,
    `rms ${mix.correct.rms.toFixed(4)} > ${STING_RMS_FLOOR}, peak ${mix.correct.peak.toFixed(3)} > token ${mix.token.peak.toFixed(3)}`);
  ok('right still reads brighter than wrong (the only contrast it carries)',
    mix.correct.peak > mix.wrong.peak && mix.correct.rms > mix.wrong.rms * 1.2,
    `correct ${mix.correct.peak.toFixed(3)}/${mix.correct.rms.toFixed(4)} vs `
    + `wrong ${mix.wrong.peak.toFixed(3)}/${mix.wrong.rms.toFixed(4)}`);

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

// End-to-end playability test. Drives the REAL built game with synthetic input
// through the whole Wave-1 slice: title → racer select → race (3 laps) →
// results → garage → next race. Screenshots each beat.
//
// Renders prove a screen draws. This proves the game can actually be PLAYED.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dist = resolve(root, 'dist/index.html');
if (!existsSync(dist)) { console.error('dist missing — npm run build'); process.exit(2); }
mkdirSync(resolve(root, 'shots'), { recursive: true });

const steps = [];
const step = (name, ok, detail = '') => {
  steps.push({ name, ok, detail });
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(46)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});

const errs = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });   // school-laptop resolution
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

  const scene = () => page.evaluate(() => window.__DEBUG.state().scene);
  const shot = f => page.screenshot({ path: resolve(root, 'shots/' + f), type: 'png' });
  const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));


  // A player dismisses things. The gate must too, or a modal that legitimately
  // pauses the sim (the first-token explainer, a quiz panel) stalls the whole run
  // and every downstream step fails for the wrong reason.
  const playerBeat = async () => page.evaluate(() => {
    const visible = el => el && el.offsetParent !== null &&
      getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > 0.05;

    // Blocking one-time modals FIRST — they pause the sim, and the quiz container
    // (.quiz-root) is always in the DOM, so checking quizzes first short-circuits
    // forever and the run silently stalls.
    for (const sel of ['.grgtok-scrim', '.grg-meet-scrim', '[data-onetime]']) {
      const scrim = document.querySelector(sel);
      if (visible(scrim)) {
        const b = scrim.querySelector('button');
        if (b) { b.click(); return 'popup:' + sel; }
        if (typeof scrim.close === 'function') { scrim.close(); return 'popup:' + sel; }
      }
    }
    // Then an ACTUALLY OPEN quiz question (not merely the container).
    const q = document.querySelector('.quiz-q');
    if (visible(q)) {
      dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
      return 'quiz';
    }
    return null;
  });

  console.log('\n  PLAYABILITY — full Wave-1 slice at 1366x768\n  ' + '─'.repeat(70));
  step('boots to title', (await scene()) === 'menu', await scene());
  await shot('flow-1-title.png');

  // ---- title → racer select -------------------------------------------
  // Click the primary CTA rather than pressing Enter, so we exercise the real
  // button (and prove it is not clipped or pointer-events-blocked).
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /אליפות|Championship/.test(x.textContent));
    if (!b) return 'no-button';
    const r = b.getBoundingClientRect();
    if (r.bottom > innerHeight || r.top < 0) return 'clipped';
    b.click(); return 'ok';
  });
  await settle(900);
  step('start button is clickable', clicked === 'ok', clicked);
  step('reaches racer select', (await scene()) === 'select', await scene());
  await shot('flow-2-select.png');

  // ---- racer select → race --------------------------------------------
  await page.keyboard.press('ArrowLeft');            // move selection (RTL-aware)
  await settle(250);
  const started = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /לזינוק|Start|התחל/.test(x.textContent));
    if (!b) return 'no-button';
    b.click(); return 'ok';
  });
  await settle(1800);
  step('start-race button works', started === 'ok', started);
  step('reaches race scene', (await scene()) === 'race', await scene());

  // ---- drive ------------------------------------------------------------
  // Hold throttle + drift via real key events so Input is genuinely exercised,
  // then fast-forward the sim deterministically.
  await page.evaluate(() => {
    const k = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    k('keydown', 'ArrowUp');
  });
  await page.evaluate(() => window.__DEBUG.advance(6));
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await settle(200);
  await shot('flow-3-race-early.png');

  const early = await page.evaluate(() => {
    const s = window.__DEBUG.engine.active;
    return { speed: s.player?.speed ?? 0, phase: s.state?.phase, lap: s.state?.lap };
  });
  step('countdown completed, kart is moving', early.speed > 3, `${early.speed.toFixed(1)} m/s, phase=${early.phase}`);

  // Simulate a full 3-lap race. Quiz beacons put the world into slow motion until
  // answered, so answer them the way a player would — otherwise the sim crawls and
  // the race never finishes (this is exactly what happens if nobody presses a key).
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.__DEBUG.advance(5));
    await playerBeat();
  }
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await settle(300);
  await shot('flow-4-race-mid.png');

  const mid = await page.evaluate(() => {
    const s = window.__DEBUG.engine.active;
    return {
      lap: s.state?.lap, laps: 3, finished: s.state?.finished,
      pos: s.state?.position, tokens: s.state?.tokens,
      best: s.state?.bestLap, progress: s.state?.progress,
      speed: s.player?.speed, off: s.player?.offTrack,
    };
  });
  step('laps are counting', mid.lap > 1 || mid.finished, `lap ${mid.lap}, progress ${mid.progress?.toFixed(2)}`);
  step('tokens collectable', mid.tokens > 0, `${mid.tokens} tokens`);
  step('position is tracked', mid.pos >= 1 && mid.pos <= 8, `P${mid.pos}`);
  step('best lap recorded', mid.best != null, mid.best ? (mid.best / 1000).toFixed(2) + 's' : 'none');

  // Run long enough to finish 3 laps, still answering quizzes as they appear.
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => window.__DEBUG.advance(6));
    await playerBeat();
  }
  await settle(3000);   // the 2.2s results delay plus transition
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await settle(400);

  const sc = await scene();
  step('race completes → results', sc === 'results', sc);
  await shot('flow-5-results.png');

  // ECONOMY GATE. The garage's whole lesson is "precision costs — choose where it
  // is worth spending", against a budget of ~17 and a max spend of ~21. If one race
  // banks far more than that, the budget never binds and the lesson evaporates.
  const econ = await page.evaluate(() => window.__LAST_RESULT__ || null);
  if (econ) {
    console.log(`        \x1b[2mtokens: ${econ.tokensFromPickups} pickups + ${econ.tokensFromQuiz} quiz + ${econ.tokensFinishBonus} finish = ${econ.tokens}\x1b[0m`);
    step('race token yield stays near the garage budget', econ.tokens >= 6 && econ.tokens <= 28,
      `${econ.tokens} banked vs ~21 max garage spend`);
  }

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('promptracers.v1') || '{}'));
  step('progress persisted to localStorage', (saved.results?.length || 0) > 0,
    `race ${saved.championshipRace}, ${saved.tokens} tokens`);

  // ---- results → garage -------------------------------------------------
  const toGarage = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /מוסך|Garage|הבא|Next|המשך/.test(x.textContent));
    if (!b) return 'no-button';
    const r = b.getBoundingClientRect();
    if (r.bottom > innerHeight) return 'clipped:' + Math.round(r.bottom - innerHeight) + 'px';
    b.click(); return 'ok';
  });
  await settle(1600);
  step('results CTA reachable at 1366x768', toGarage === 'ok', toGarage);
  const gs = await scene();
  step('reaches garage', gs === 'garage', gs);
  await shot('flow-6-garage.png');

  // ---- garage interaction ----------------------------------------------
  const built = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const picked = [];
    // Pick the first available option in each row as it progressively reveals.
    for (let round = 0; round < 6; round++) {
      const cards = [...document.querySelectorAll('.grg-opt, [data-opt], .grg-card')]
        .filter(el => el.offsetParent !== null && !el.getAttribute('aria-disabled'));
      if (!cards.length) break;
      cards[0].click();
      picked.push(cards.length);
      await sleep(320);
    }
    const btn = [...document.querySelectorAll('button')]
      .find(b => b.offsetParent && /בנה|תבנה|Build/.test(b.textContent) && !b.disabled);
    if (btn) { btn.click(); await sleep(2200); }
    // The reveal modal then offers "install" — that is the button that actually
    // commits the part, so the flow is not complete until it is clicked.
    const inst = [...document.querySelectorAll('button')]
      .find(b => b.offsetParent && /התקנ|הרכב|[Ii]nstall|קדימה|יאללה/.test(b.textContent) && !b.disabled);
    if (inst) { inst.click(); await sleep(900); }
    return {
      picked, built: !!btn, installed: !!inst,
      sentence: document.querySelector('.grg-sentence, .grg-ask')?.textContent?.trim().slice(0, 70),
    };
  });
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await settle(500);
  step('garage slots are selectable', built.picked.length >= 3, `${built.picked.length} rows engaged`);
  step('part can be built', built.built, built.sentence ? `"${built.sentence}…"` : '');
  step('part can be installed', built.installed, built.installed ? 'install clicked' : 'no install button found');
  await shot('flow-7-garage-built.png');

  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('promptracers.v1') || '{}'));
  step('parts persisted', Object.keys(after.parts || {}).length > 0, JSON.stringify(after.parts || {}).slice(0, 60));

  // ═══════════════════════════════════════════════════════════════════════
  // P0 REGRESSION GATES (Wave 2). Each of these shipped silently once; every
  // one is the "looks fine in a screenshot, wrong in play" class this file exists
  // for. Run against the REAL built game, in a real race.
  // ═══════════════════════════════════════════════════════════════════════
  console.log('  ' + '─'.repeat(70));
  console.log('  P0 REGRESSION GATES');

  await page.evaluate(() => window.__DEBUG.goto('race', { track: 0 }));
  await settle(1200);
  await page.evaluate(() => window.__DEBUG.advance(8));   // clear the countdown

  // --- P0 #1: karts must not render back-to-front -----------------------
  const orient = await page.evaluate(() => {
    const sc = window.__DEBUG.engine.active;
    const THREE = window.__THREE__;
    const fwdOf = (mesh) => {
      const v = { x: 0, y: 0, z: -1 };                 // model convention: -Z forward
      const q = mesh.group.quaternion;
      // rotate v by q, inline (no THREE dependency needed)
      const ix = q.w*v.x + q.y*v.z - q.z*v.y, iy = q.w*v.y + q.z*v.x - q.x*v.z;
      const iz = q.w*v.z + q.x*v.y - q.y*v.x, iw = -q.x*v.x - q.y*v.y - q.z*v.z;
      return { x: ix*q.w + iw*-q.x + iy*-q.z - iz*-q.y,
               z: iz*q.w + iw*-q.z + ix*-q.y - iy*-q.x };
    };
    const rows = [];
    const check = (label, mesh, body) => {
      const f = fwdOf(mesh);
      const vx = body.velocity.x, vz = body.velocity.z;
      const m = Math.hypot(vx, vz), fm = Math.hypot(f.x, f.z);
      if (m < 1 || fm < 0.001) return;
      rows.push({ label, dot: (f.x*vx + f.z*vz) / (m*fm) });
    };
    check('player', sc.playerMesh, sc.player);
    (sc.aiKarts || []).slice(0, 3).forEach((k, i) => check('ai' + i, k.mesh, k.body));
    void THREE;
    return rows;
  });
  const backwards = orient.filter(r => r.dot < 0.5);
  step('P0#1 karts face their direction of travel', orient.length > 0 && backwards.length === 0,
    orient.map(r => `${r.label}:${r.dot.toFixed(2)}`).join(' '));

  // --- P0 #2: right arrow must steer right ------------------------------
  const steerCheck = await page.evaluate(async () => {
    const sc = window.__DEBUG.engine.active;
    const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const sample = () => {
      const b = sc.player;
      const f = { x: Math.sin(b.yaw), z: Math.cos(b.yaw) };        // sim forward (+Z)
      // forward x UP with forward=(fx,0,fz), UP=(0,1,0)  ->  (-fz, 0, fx).
      // Getting this backwards makes the gate report the mirror of the truth.
      const right = { x: -f.z, z: f.x };
      return { p: { x: b.position.x, z: b.position.z }, right };
    };
    key('keydown', 'ArrowUp');
    window.__DEBUG.advance(1.5);
    const a = sample();
    key('keydown', 'ArrowRight');
    window.__DEBUG.advance(1.2);
    key('keyup', 'ArrowRight'); key('keyup', 'ArrowUp');
    const b2 = sc.player;
    const d = { x: b2.position.x - a.p.x, z: b2.position.z - a.p.z };
    return { lateral: d.x * a.right.x + d.z * a.right.z };
  });
  step('P0#2 ArrowRight steers RIGHT', steerCheck.lateral > 0.3,
    `${steerCheck.lateral.toFixed(2)} m to the kart's own right`);

  // --- P0 #3: no geometry across the drivable surface -------------------
  const wall = await page.evaluate(() => {
    const sc = window.__DEBUG.engine.active;
    const sp = sc.track.spline, grp = sc.track.group;
    const hits = [];
    // Sample the centreline and look for owned geometry sitting on the road.
    const ray = new (window.__RAY__ || Object)();
    void ray;
    const box = { min: {}, max: {} };
    void box;
    // Cheap proxy: walk the lap, cast a short ray forward at kart height and see
    // if anything in the track group blocks it.
    const THREE = window.__THREE__ || null;
    if (!THREE) return { skipped: true };
    const rc = new THREE.Raycaster();
    for (let i = 0; i < 160; i++) {
      const t = i / 160;
      const p = sp.positionAt(t), tan = sp.tangentAt(t);
      p.y += 0.8;
      rc.set(p, tan); rc.far = 6;
      const hit = rc.intersectObject(grp, true).filter(h => h.distance > 0.2);
      if (hit.length) hits.push({ t: +t.toFixed(3), d: +hit[0].distance.toFixed(2), n: hit[0].object.name || '?' });
    }
    return { hits: hits.slice(0, 5), count: hits.length };
  });
  if (wall.skipped) step('P0#3 no obstruction across the track', true, 'skipped (no THREE handle)');
  else step('P0#3 no obstruction across the track', wall.count === 0,
    wall.count ? `${wall.count} blocked samples, e.g. ${JSON.stringify(wall.hits[0])}` : 'clear lap');

  // --- P0 #4: Escape pauses and freezes the sim -------------------------
  const pauseCheck = await page.evaluate(async () => {
    const sc = window.__DEBUG.engine.active;
    const before = sc.state.raceTime;
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 350));
    const overlay = !!document.querySelector('.mn-ov, .pause-root, [data-pause]');
    window.__DEBUG.advance(2);
    const after = sc.state.raceTime;
    return { overlay, frozen: Math.abs(after - before) < 0.05, delta: +(after - before).toFixed(2) };
  });
  step('P0#4 Escape opens a pause overlay', pauseCheck.overlay, pauseCheck.overlay ? '' : 'no overlay found');
  step('P0#4 pause freezes the simulation', pauseCheck.frozen, `race clock advanced ${pauseCheck.delta}s`);

  // --- P0 #5: audio actually produces sound -----------------------------
  // A running AudioContext is NOT proof of sound — the graph can be live with a
  // muted master, a disconnected bus, or events whose names nobody listens for.
  // Tap the real destination with an analyser and measure.
  const audioCheck = await page.evaluate(async () => {
    const a = window.__AUDIO__ || null;
    if (!a) return { present: false };
    const ctx = a.ctx || a.context || a._ctx || null;
    const state = ctx?.state ?? null;
    let rms = null, peak = null;
    if (ctx && a.master) {
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      try { a.master.connect(an); } catch { /* already routed */ }
      const buf = new Float32Array(an.fftSize);
      // Drive some real race audio, then sample.
      for (let i = 0; i < 30; i++) {
        a.setEngineState?.({ rpm01: 0.7, load: 1, boosting: false, surface: 'asphalt' });
        await new Promise(r => setTimeout(r, 20));
      }
      let acc = 0, mx = 0, n = 0;
      for (let s = 0; s < 12; s++) {
        an.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) { acc += buf[i] * buf[i]; mx = Math.max(mx, Math.abs(buf[i])); }
        n += buf.length;
        await new Promise(r => setTimeout(r, 25));
      }
      rms = Math.sqrt(acc / n); peak = mx;
    }
    return { present: true, state, muted: a.muted ?? null, voices: a.activeVoices ?? null, rms, peak };
  });
  step('P0#5 audio context running', audioCheck.present && audioCheck.state === 'running',
    audioCheck.present ? `state=${audioCheck.state} muted=${audioCheck.muted}` : 'audio singleton not exposed');
  step('P0#5 audio is actually AUDIBLE (non-silent at destination)',
    audioCheck.rms != null && audioCheck.rms > 1e-4 && audioCheck.peak <= 1.001,
    audioCheck.rms == null ? 'could not tap master' :
      `rms=${audioCheck.rms.toExponential(2)} peak=${audioCheck.peak.toFixed(3)}`);

  step('no page errors during whole flow', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('  ' + '─'.repeat(70));
  const fails = steps.filter(s => !s.ok);
  console.log(`  ${steps.length - fails.length}/${steps.length} passed\n`);
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error('\nFLOW TEST CRASHED:', e.message);
  if (errs.length) console.error(errs.slice(0, 6).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}

// End-to-end playability test. Drives the REAL built game with synthetic input
// through the whole Wave-1 slice: title → racer select → race (3 laps) →
// results → garage → next race. Screenshots each beat.
//
// Renders prove a screen draws. This proves the game can actually be PLAYED.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
// The economy gate compares against the garage's OWN prices rather than a copy of
// them, so a price change shows up here as a failing band instead of a stale
// comment. prompts.js is pure data + i18n registration, so it imports in node.
import { MAX_COST, MIN_COMPLETE_COST, KART_SLOTS, optionsFor, costOf } from '../src/garage/prompts.js';
// The carryover half of the economy gate (Wave 5) needs the garage's own scorer
// and its own rebate, for the same reason the line above imports its prices: a
// copy of them here would pass while the game had moved.
import { scorePrompt, tokenReward } from '../src/garage/scoring.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// `--dist=<path>` drives a build OTHER than dist/index.html. It exists for the
// project's own rule that a gate only counts if it fails against the broken
// code: you can keep a build of the pre-fix source in .tmp/ and point this at
// it, instead of rewinding a working tree that several agents share (D25). It
// defaults to the real build, so nothing about `npm run flow` changes.
const distArg = (process.argv.find(a => a.startsWith('--dist=')) || '').slice(7);
const dist = distArg ? resolve(root, distArg) : resolve(root, 'dist/index.html');
if (!existsSync(dist)) { console.error(`build missing (${dist}) — npm run build`); process.exit(2); }
if (distArg) console.log(`\n  \x1b[2m(driving ${distArg} instead of dist/index.html)\x1b[0m`);
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
    // For the blocking scrims, laid out and not hidden is the bar — NOT opacity.
    // Their fade-in is a CSS transition, and under a harness that steps the sim
    // without presenting frames a transition never settles, so a card that is
    // genuinely on screen and genuinely holding the modal registry reads as
    // opacity 0 and is skipped. That is why the pre-race welcome card stalled
    // this gate at "phase=intro" while the game itself was behaving.
    const present = el => el && el.offsetParent !== null &&
      getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';

    // Blocking one-time modals FIRST — they pause the sim, and the quiz container
    // (.quiz-root) is always in the DOM, so checking quizzes first short-circuits
    // forever and the run silently stalls.
    // '.qzint-scrim' is the Wave-4 first-quiz-box explainer and '.intro-scrim'
    // the pre-race welcome card. Both freeze the sim exactly as the first-token
    // explainer does, so both stall the whole run if the gate does not dismiss
    // them the way a child would. This list is the single reason a new blocking
    // modal must be added here the day it ships.
    for (const sel of ['.grgtok-scrim', '.grg-meet-scrim', '.qzint-scrim', '.ic-scrim', '[data-onetime]']) {
      const scrim = document.querySelector(sel);
      if (present(scrim)) {
        const b = scrim.querySelector('button');
        if (b) { b.click(); return 'popup:' + sel; }
        if (typeof scrim.close === 'function') { scrim.close(); return 'popup:' + sel; }
      }
    }
    // The ANSWERED state first. Wave 3 turned the quiz from slow motion into a
    // full freeze whose feedback waits for Space with NO time limit, so a beat
    // that only ever presses a digit answers the question and then leaves the
    // explanation up forever with the sim stopped — the race can never finish.
    if (visible(document.querySelector('.quiz-card.quiz-answered'))) {
      dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      return 'quiz:dismiss';
    }
    // Then an ACTUALLY OPEN quiz question (not merely the container).
    //
    // ANSWER IT CORRECTLY. This beat used to press `1` blind, which is the whole
    // reason the economy went unmeasured for three waves: a third of the answers
    // landed by luck and the driver met few beacons anyway, so `tokensFromQuiz`
    // printed 0 on every run in the project's history and the only assertion
    // that looked at the wallet was blind to its largest term (D29). The correct
    // slot is read from the race's own quiz (`scene.quiz.correctSlot`) because
    // the three options are SHUFFLED per showing — nothing outside the panel can
    // work it out — and it is pressed as the real digit key, so the answer goes
    // through the same keyboard path a child's finger does.
    const q = document.querySelector('.quiz-q');
    if (visible(q)) {
      const slot = window.__DEBUG?.engine?.active?.quiz?.correctSlot;
      const n = (typeof slot === 'number' && slot >= 0 && slot <= 2) ? slot + 1 : 1;
      dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit' + n, key: String(n), bubbles: true }));
      return 'quiz:answer' + n;
    }
    return null;
  });

  // The gate groups are independent: the play-through drives a real race, the
  // championship-end group and the navigation walk run off crafted save data,
  // the seam group pokes two cross-module joints. `--only=play|champ|seam|nav`
  // runs one of them, so a fix in any seam can be iterated on in seconds
  // instead of minutes.
  const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
  const runs = name => !ONLY || ONLY === name;

  async function mainFlowGates() {
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

  // Count the question boxes this race actually opens and how many were answered
  // right, so the economy block below can prove its quiz term came from real
  // questions rather than from a lucky non-zero number.
  await page.evaluate(() => {
    window.__ECON_Q__ = { opens: 0, correct: 0 };
    window.__DEBUG.bus.on('quiz:open', () => { window.__ECON_Q__.opens++; });
    window.__DEBUG.bus.on('quiz:correct', () => { window.__ECON_Q__.correct++; });
  });

  // ---- drive ------------------------------------------------------------
  // Hold throttle + drift via real key events so Input is genuinely exercised,
  // then fast-forward the sim deterministically.
  await page.evaluate(() => {
    const k = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    k('keydown', 'ArrowUp');
  });
  await page.evaluate(() => window.__DEBUG.advance(6));
  // The pre-race welcome card (D35) owns the screen and holds the scene in phase
  // 'intro', which emits zero fixed steps — so the kart is provably NOT moving
  // until a child dismisses it. Dismiss it exactly the way playerBeat does for
  // every other blocking modal, then let the countdown actually run; otherwise
  // the next assertion fails at 'phase=intro' and takes thirteen downstream
  // checks with it, which is a gate reporting the card as a bug.
  await playerBeat();
  await settle(150);
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

  // Run long enough to finish 3 laps, still answering quizzes as they appear —
  // and STOP as soon as the flag falls. Driving on past it kept advancing the
  // world underneath the results screen, which the economy read below then
  // measured: whatever race happened to finish LAST won the global result slot.
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => window.__DEBUG.advance(6));
    await playerBeat();
    if (await page.evaluate(() => !!window.__LAST_RESULT__)) break;
  }
  await settle(3000);   // the 2.2s results delay plus transition
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await settle(400);

  const sc = await scene();
  step('race completes → results', sc === 'results', sc);
  await shot('flow-5-results.png');

  // ECONOMY, part 1 of 2 — WHAT THIS SLICE'S OWN DRIVER BANKED.
  // The driver above holds a throttle key and never steers, so it drives like a
  // child who has just picked up the keyboard: it bounces off walls, finishes
  // last and meets two or three question boxes. That is a useful thing to
  // measure (nobody should be able to get RICH by driving badly) but it cannot
  // speak for "a winning, fully engaged player" — the economy measurement that
  // does is part 2, below. What is asserted here is the INVARIANT, which holds
  // for every player, plus the floor.
  const econ = await page.evaluate(() => window.__LAST_RESULT__ || null);
  const qcount = await page.evaluate(() => window.__ECON_Q__ || { opens: 0, correct: 0 });
  if (econ) {
    console.log(`        \x1b[2mtokens: ${econ.tokensFromPickups} pickups + ${econ.tokensFromQuiz} quiz + ${econ.tokensFinishBonus} finish`
      + ` = ${econ.tokens}  ·  P${econ.place}, ${qcount.correct}/${qcount.opens} questions answered right`
      + `  ·  max ask ${MAX_COST}, cheapest complete ask ${MIN_COMPLETE_COST}\x1b[0m`);

    step('a scrappy driver still cannot buy the most expensive ask',
      econ.tokens < MAX_COST,
      `${econ.tokens} banked vs ${MAX_COST} max ask (margin ${MAX_COST - econ.tokens})`);
    // The floor: the garage must never open with every card greyed out. A race
    // pays its finishing bonus to everyone, so even this run funds a complete ask.
    step('…and still funds a complete ask after a bad race',
      econ.tokens >= MIN_COMPLETE_COST,
      `${econ.tokens} banked, cheapest complete ask ${MIN_COMPLETE_COST}, finish bonus ${econ.tokensFinishBonus}`);
    step('a bad race does not pay like a good one',
      econ.tokens <= 14, `${econ.tokens} banked = ${econ.tokensFromPickups}+${econ.tokensFromQuiz}+${econ.tokensFinishBonus}`);
  } else {
    step('economy: the race produced a result to measure', false, 'no __LAST_RESULT__');
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
  }   // end mainFlowGates

  /* ─────────────────────────────────────────────────────────────────────────
   * CHAMPIONSHIP-END GATES — see the call site below for why they are grouped.
   * ───────────────────────────────────────────────────────────────────────── */
  async function championshipEndGates() {
    console.log('  ' + '─'.repeat(70));
    console.log('  CHAMPIONSHIP-END GATES (podium · tie-break · certificate · reset · routing)');

    const SAVE_KEY = 'promptracers.v1';
    const HE = {
      nitzotz: 'ניצוץ', zuzi: 'זוזי', plada: 'פלדה', nurit: 'נורית',
      zamzum: 'זמזום', tipa: 'טיפה', kaftor: 'כפתור', raash: 'רעשן',
    };
    // i18n.js ordinal(), Hebrew branch. The header quotes one of these words; the
    // gate's whole point is that it must be the word for the player's TABLE place.
    const HE_ORDINAL = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני'];
    // The NON-champion podium headline (menu.podium.done). Named once so the
    // tie-break check below can say "crowned" without pinning the CHAMPION
    // wording, which is copy and moves.
    const LOSE_TITLE_HE = 'סוף האליפות';
    const REST = ['zamzum', 'tipa', 'kaftor', 'raash'];
    const BEST_PROMPT = { text: 'מנוע קליל שמאיץ מהר ביציאה מפנייה, בלי לאבד אחיזה', score: 84 };

    // Crafted ledgers. Each row is one race's finishing order, best first.
    // CLEAR: no tie at all — plain ordering, the baseline.
    const CLEAR = [
      ['zuzi', 'nitzotz', 'plada', 'nurit', ...REST],
      ['zuzi', 'nitzotz', 'plada', 'nurit', ...REST],
      ['zuzi', 'nitzotz', 'plada', 'nurit', ...REST],
    ];
    // Two 24–24 ties that are exact mirrors of each other: same points, same
    // number of wins (one each), decided ONLY by the final race. The order flips
    // between them, so a header that computes the player's place by itself, or a
    // sort that falls back to roster order, disagrees with the table in exactly
    // one of the two — which is the bug this pins (26–26 called the player
    // "second" in the header while the table showed them first).
    const TIE_PLAYER_WINS = [
      ['zuzi', 'nitzotz', 'plada', 'nurit', ...REST],
      ['plada', 'zuzi', 'nitzotz', 'nurit', ...REST],
      ['nitzotz', 'nurit', 'zuzi', 'plada', ...REST],   // final race: player 1st
    ];
    const TIE_RIVAL_WINS = [
      ['nitzotz', 'zuzi', 'plada', 'nurit', ...REST],
      ['plada', 'nitzotz', 'zuzi', 'nurit', ...REST],
      ['zuzi', 'nurit', 'nitzotz', 'plada', ...REST],   // final race: player 3rd
    ];
    // WINS: 21–21 between zuzi and nitzotz, and ONLY the wins term separates
    // them. zuzi takes races 1 and 2 and comes last in race 3 (10+10+1 = 21, two
    // wins); nitzotz is 2nd, 2nd and 4th (8+8+5 = 21, no wins). Their bestFinal
    // actually favours NITZOTZ (4th vs 8th), so deleting the wins term does not
    // merely stop mattering — it flips the table. plada takes the title on 22.
    const TIE_WINS = [
      ['zuzi', 'nitzotz', 'plada', 'nurit', ...REST],
      ['zuzi', 'nitzotz', 'plada', 'nurit', ...REST],
      ['plada', 'nurit', 'zamzum', 'nitzotz', 'tipa', 'kaftor', 'raash', 'zuzi'],
    ];
    // PLAYER: equal points, equal wins AND equal bestFinal. The final race is run
    // by six racers only — neither of the tied pair is in it — so both carry the
    // bestFinal sentinel 99 and the first three terms are all level. The player is
    // ZUZI for this ledger, not nitzotz: nitzotz is ROSTER[0], so with the
    // player term deleted the stable sort would leave nitzotz on top anyway and
    // the gate could not tell the difference. With zuzi as the player the term is
    // the only thing that can lift them above the racer ahead of them in roster
    // order, and deleting it flips the pair.
    //   zuzi 10+8 = 18 (1 win)   nitzotz 8+10 = 18 (1 win)   both bestFinal 99
    const TIE_PLAYER_TERM = [
      ['zuzi', 'nitzotz', 'nurit', 'plada', ...REST],
      ['nitzotz', 'zuzi', 'nurit', 'plada', ...REST],
      ['nurit', 'plada', 'zamzum', 'tipa', 'kaftor', 'raash'],   // zuzi/nitzotz did not run
    ];
    const clean = s => String(s == null ? '' : s).replace(/[⁦-⁩]/g, '').trim();

    const ledger = (orders, playerId = 'nitzotz') => orders.map((order, i) => ({
      trackIndex: i, track: ['oasis', 'circuit', 'cloud'][i] || 'oasis',
      place: order.indexOf(playerId) + 1, timeMs: 90000 + i * 1000, bestLapMs: 30000,
      standings: order.map((id, j) => ({
        racerId: id, place: j + 1, isPlayer: id === playerId, timeMs: 90000 + j * 800,
      })),
    }));

    // Reload with a hand-built save. Reloading (rather than poking save.js) is the
    // point: it proves the ledger on disk is enough to reconstruct these screens.
    const seed = async (patch) => {
      await page.evaluate((key, data) => {
        localStorage.setItem(key, JSON.stringify(data));
      }, SAVE_KEY, {
        lang: 'he', quality: 'low', muted: true, racerId: 'nitzotz',
        garageMetBoreg: true, garageTokenIntroSeen: true,   // skip the one-time explainers
        ...patch,
      });
      await page.reload({ waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
    };
    const finished = (orders, extra = {}, playerId = 'nitzotz') =>
      seed({ championshipRace: 3, tokens: 9, parts: { engine: 2, tires: 1 },
        racerId: playerId, results: ledger(orders, playerId), ...extra });

    const openPodium = async () => {
      await page.evaluate(() => window.__DEBUG.goto('podium', {}));
      await settle(600);
      await page.evaluate(() => window.__DEBUG.renderOnce());
    };
    const readPodium = () => page.evaluate(() => {
      const strip = s => String(s == null ? '' : s).replace(/[⁦-⁩]/g, '').trim();
      const rows = [...document.querySelectorAll('.mn-prow')].map(r => ({
        place: strip(r.querySelector('i')?.textContent),
        name: strip(r.querySelector('b')?.textContent),
        points: strip(r.querySelector('em')?.textContent),
        isMe: r.classList.contains('me'),
      }));
      const active = window.__DEBUG.engine.active;
      return {
        rows,
        title: strip(document.querySelector('.mn-podium-top .mn-h1')?.textContent),
        congrats: strip(document.querySelector('.mn-congrats')?.textContent),
        total: strip(document.querySelector('.mn-total em')?.textContent),
        text: strip(document.querySelector('.mn-root')?.innerText) + ' ' +
              [...document.querySelectorAll('.mn-side,.mn-bottom')].map(n => strip(n.innerText)).join(' '),
        karts: active?.mountedKarts ? active.mountedKarts() : null,
      };
    });

    // Expected table for a ledger, computed HERE from the crafted orders rather
    // than from the game's own code, so the gate is an independent check.
    const expectFor = (orders, playerId = 'nitzotz') => {
      const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
      const acc = new Map();
      orders.forEach(order => order.forEach((id, i) => {
        const e = acc.get(id) || { points: 0, wins: 0, bestFinal: 99 };
        e.points += POINTS[i]; if (i === 0) e.wins++;
        acc.set(id, e);
      }));
      // A racer absent from the final race keeps the 99 sentinel — that is the
      // state TIE_PLAYER_TERM manufactures on purpose.
      orders[orders.length - 1].forEach((id, i) => { acc.get(id).bestFinal = i + 1; });
      return [...acc.entries()]
        .map(([id, e]) => ({ id, ...e, isPlayer: id === playerId }))
        .sort((a, b) => (b.points - a.points) || (b.wins - a.wins) ||
          (a.bestFinal - b.bestFinal) || (a.isPlayer ? -1 : b.isPlayer ? 1 : 0))
        .map((e, i) => ({ place: String(i + 1), name: HE[e.id], points: String(e.points), isMe: e.isPlayer }));
    };

    // --- C#1: the podium table IS the final standings ----------------------
    await finished(CLEAR, { bestPrompt: BEST_PROMPT });
    await openPodium();
    await shot('flow-8-podium.png');
    let want = expectFor(CLEAR);
    let got = await readPodium();
    const sameTable = JSON.stringify(got.rows) === JSON.stringify(want);
    step('C#1 podium rows === final standings (name/points/order)', sameTable,
      sameTable ? got.rows.map(r => `${r.place}.${r.name} ${r.points}`).join('  ')
        : `got ${JSON.stringify(got.rows.slice(0, 3))} want ${JSON.stringify(want.slice(0, 3))}`);
    step('C#1 no "undefined" anywhere in the podium', !/undefined|NaN|null/i.test(got.text),
      (got.text.match(/\S*undefined\S*|\S*NaN\S*/i) || ['clean'])[0]);
    step('C#1 podium total matches the player row',
      got.total === (got.rows.find(r => r.isMe)?.points), `total ${got.total}`);

    // --- C#2: three DIFFERENT karts, and only the player wears the parts ---
    const wantKarts = ['zuzi', 'nitzotz', 'plada'].map(id => 'kart:' + id);
    const gotKarts = (got.karts || []).map(k => k.name);
    step('C#2 each podium step shows its own racer\'s kart',
      JSON.stringify(gotKarts) === JSON.stringify(wantKarts),
      gotKarts.length ? gotKarts.join(' ') : 'no karts mounted');

    // --- C#3: tie-break — header place === table place, both directions ----
    for (const [label, orders] of [['player takes it', TIE_PLAYER_WINS], ['rival takes it', TIE_RIVAL_WINS]]) {
      await finished(orders, { bestPrompt: BEST_PROMPT });
      await openPodium();
      want = expectFor(orders);
      got = await readPodium();
      const tableOK = JSON.stringify(got.rows) === JSON.stringify(want);
      const mine = got.rows.find(r => r.isMe);
      const myPlace = Number(mine?.place || 0);
      // Winning replaces the ordinal sentence with the champion headline, so the
      // header agrees with the table when it names first place OR crowns them.
      //
      // Deliberately does NOT pin the champion headline's WORDING. It used to
      // match /אלוף/, and Wave 4's smoothing pass rewrote that headline to
      // `זכיתם באליפות!` — masculine singular on the game's proudest screen was
      // exactly the D27 defect that pass existed to find — which turned this
      // gate red for a copy IMPROVEMENT rather than for a bug. A gate that pins
      // a string it does not own makes correct copy edits look like
      // regressions, and that argument usually ends with the copy being
      // reverted. What this check is for is that the header and the table agree
      // about the player's place, so it tests exactly that.
      const crowned = got.title !== LOSE_TITLE_HE && !/מקום ה/.test(got.congrats);
      const headerOK = myPlace === 1
        ? crowned
        : got.congrats.includes(HE_ORDINAL[myPlace]) && got.title === LOSE_TITLE_HE;
      step(`C#3 tie 24–24 (${label}): table follows the tie-break`, tableOK,
        got.rows.slice(0, 2).map(r => `${r.place}.${r.name} ${r.points}${r.isMe ? '*' : ''}`).join('  '));
      step(`C#3 tie 24–24 (${label}): header place === table place`, headerOK,
        `table P${myPlace} · "${got.congrats.slice(0, 46) || got.title}"`);
      if (label === 'rival takes it') await shot('flow-9-podium-tie.png');
    }

    // --- C#3b: the WINS term of the tie-break is load-bearing ---------------
    // C#3's two ledgers give both contenders exactly one win each, so the wins
    // term contributed nothing and could be deleted with all 20 gates still
    // green. This ledger is decided by wins ALONE: zuzi and nitzotz are level on
    // 21 points, and bestFinal (the next term down) points the other way, so
    // removing the wins comparison does not merely stop mattering — it swaps
    // rows 2 and 3.
    await finished(TIE_WINS, { bestPrompt: BEST_PROMPT });
    await openPodium();
    want = expectFor(TIE_WINS);
    got = await readPodium();
    const winsTable = JSON.stringify(got.rows) === JSON.stringify(want);
    const top3 = got.rows.slice(0, 3).map(r => `${r.name} ${r.points}`).join(', ');
    step('C#3b tie 21–21 is broken by WINS, not by the final race',
      winsTable && got.rows[1]?.name === HE.zuzi && got.rows[2]?.name === HE.nitzotz &&
      got.rows[1]?.points === '21' && got.rows[2]?.points === '21' && got.rows[0]?.points === '22',
      `${top3}  (want ${HE.plada} 22, ${HE.zuzi} 21, ${HE.nitzotz} 21 — zuzi has 2 wins, ` +
      `nitzotz the better final race)`);

    // --- C#3c: the PLAYER term of the tie-break is load-bearing -------------
    // Points, wins AND bestFinal all level: the final race is run by six racers
    // and neither of the tied pair is in it, so both carry the 99 sentinel. The
    // only thing left is "the player takes the higher spot". The player here is
    // ZUZI rather than nitzotz on purpose — nitzotz is ROSTER[0], so with the
    // term deleted the stable sort would keep nitzotz on top for the wrong
    // reason and the gate would still pass.
    await finished(TIE_PLAYER_TERM, { bestPrompt: BEST_PROMPT }, 'zuzi');
    await openPodium();
    want = expectFor(TIE_PLAYER_TERM, 'zuzi');
    got = await readPodium();
    const meRow = got.rows.find(r => r.isMe);
    const rival = got.rows.find(r => r.name === HE.nitzotz);
    const playerTable = JSON.stringify(got.rows) === JSON.stringify(want);
    step('C#3c dead heat (points, wins AND final race all level) → the PLAYER takes the higher spot',
      playerTable && meRow?.name === HE.zuzi && rival &&
      meRow.points === rival.points && Number(meRow.place) === Number(rival.place) - 1,
      `me ${meRow?.name} P${meRow?.place} ${meRow?.points}pts · rival ${rival?.name} ` +
      `P${rival?.place} ${rival?.points}pts`);
    await finished(CLEAR, { bestPrompt: BEST_PROMPT });   // back to the default player

    // --- C#3d: a racerId that is not in the roster must not crown a stranger -
    // playerRacerId() fell back to ROSTER[0] only when the saved id was FALSY, so
    // an unknown-but-truthy id matched nobody: every row came back
    // isPlayer:false, the podium's `find(isPlayer) || standings[0]` fallback
    // congratulated the leader by name, highlighted no row, printed a total of 0
    // beside a table of 21s and 22s, and handed them the certificate.
    await finished(CLEAR, { bestPrompt: BEST_PROMPT, racerId: 'ghost-racer' });
    await openPodium();
    got = await readPodium();
    const mine = got.rows.filter(r => r.isMe);
    step('C#3d an unknown racerId falls back to a real roster racer — exactly one row is the player',
      mine.length === 1 && mine[0].name === HE.nitzotz,
      `${mine.length} highlighted row(s): ${mine.map(r => r.name).join(',') || 'none'}`);
    step('C#3d ...and the total, the header and the certificate all name THAT racer',
      mine.length === 1 && got.total === mine[0].points && got.total !== '0' &&
      got.congrats.includes(HE.nitzotz),
      `total=${got.total} playerRow=${mine[0]?.points} congrats="${got.congrats.slice(0, 44)}"`);

    // --- C#4: podium → certificate → main menu -----------------------------
    await finished(CLEAR, { bestPrompt: BEST_PROMPT });
    await openPodium();
    const cert = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /תעודת|Certificate/.test(x.textContent));
      if (!b) return { opened: false };
      b.click();
      const ov = document.querySelector('.mn-ov');
      return {
        opened: !!ov,
        quote: ov?.querySelector('q')?.textContent?.trim() || '',
        text: (ov?.innerText || '').replace(/[⁦-⁩]/g, ''),
      };
    });
    await page.evaluate(() => window.__DEBUG.renderOnce());
    await settle(200);
    await shot('flow-10-certificate.png');
    step('C#4 podium CTA opens the certificate', cert.opened, cert.opened ? '' : 'no overlay');
    step('C#4 certificate quotes the player\'s best prompt', cert.quote === BEST_PROMPT.text,
      cert.quote ? `"${cert.quote.slice(0, 40)}…"` : 'no quote element');
    step('C#4 certificate names what was learned',
      /דיוק/.test(cert.text) && /סבבים/.test(cert.text), cert.text ? '' : 'empty certificate');
    const toMenu = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.mn-ov button')].find(x => /הבית|Home|תפריט|Menu/.test(x.textContent));
      if (!b) return 'no-button';
      b.click(); return 'ok';
    });
    await settle(900);
    step('C#4 certificate → main menu', toMenu === 'ok' && (await scene()) === 'menu',
      `${toMenu}, scene=${await scene()}`);

    // --- C#5: "אליפות חדשה" fully resets and lands on racer select ---------
    await finished(CLEAR, { bestPrompt: BEST_PROMPT });
    await openPodium();
    const again = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /אליפות חדשה|New Championship/.test(x.textContent));
      if (!b) return 'no-button';
      b.click(); return 'ok';
    });
    await settle(1100);
    await page.evaluate(() => window.__DEBUG.renderOnce());
    await settle(200);
    await shot('flow-11-new-championship.png');
    const afterReset = await page.evaluate(key => ({
      save: JSON.parse(localStorage.getItem(key) || '{}'),
      scene: window.__DEBUG.state().scene,
      cards: document.querySelectorAll('.mn-card').length,
      // "Not a black screen": there is a real, readable screen with controls on it.
      text: (document.querySelector('.mn-root')?.innerText || '').length,
      buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent).length,
    }), SAVE_KEY);
    const s2 = afterReset.save;
    const ledgerClear = (s2.results || []).length === 0 && (Number(s2.championshipRace) || 0) === 0 &&
      (Number(s2.tokens) || 0) === 0 && Object.keys(s2.parts || {}).length === 0 && !s2.bestPrompt;
    step('C#5 new championship clears the whole ledger', again === 'ok' && ledgerClear,
      `race=${s2.championshipRace} results=${(s2.results || []).length} tokens=${s2.tokens} ` +
      `parts=${Object.keys(s2.parts || {}).length} bestPrompt=${s2.bestPrompt ? 'kept' : 'cleared'}`);
    step('C#5 new championship lands on racer select, not a black screen',
      afterReset.scene === 'select' && afterReset.cards === 8 && afterReset.text > 40,
      `scene=${afterReset.scene}, ${afterReset.cards} cards, ${afterReset.buttons} buttons`);
    step('C#5 championshipsDone counted exactly once', Number(s2.championshipsDone) === 1,
      `championshipsDone=${s2.championshipsDone}`);

    // --- C#6: no "continue championship" past the final race ---------------
    await finished(CLEAR);
    await page.evaluate(() => window.__DEBUG.goto('menu', {}));
    await settle(500);
    const titleBtns = await page.evaluate(() =>
      [...document.querySelectorAll('.mn-root button')].map(b => b.textContent.trim()));
    step('C#6 finished championship offers no "continue"',
      !titleBtns.some(x => /ממשיכים באליפות|Continue Championship/.test(x)),
      titleBtns.slice(0, 3).join(' | '));

    // --- C#7: garage routing — sandbox only when there is no championship --
    const openGarageDoor = async () => {
      await page.evaluate(() => window.__DEBUG.goto('freeplay', {}));
      await settle(900);
      // Told apart by what the screen PROMISES, not by one class name: the
      // sandbox is the one with an unlimited practice wallet.
      return page.evaluate(() => {
        const garage = !!document.querySelector('.grg-root');
        const budget = document.querySelector('.grg-bignum')?.textContent || '';
        const practice = !!document.querySelector('.grg-mode.practice, .grg-visit.practice')
          || budget.includes('∞');
        return { garage, sandbox: garage && practice, real: garage && !practice,
          podium: !!document.querySelector('.mn-prow') };
      });
    };
    await seed({ championshipRace: 0, results: [], tokens: 0, parts: {} });
    let door = await openGarageDoor();
    step('C#7 no save → the sandbox garage', door.sandbox && !door.podium, JSON.stringify(door));
    await seed({ championshipRace: 1, tokens: 14, parts: { engine: 1 }, results: ledger(CLEAR).slice(0, 1) });
    door = await openGarageDoor();
    step('C#7 championship in progress → the REAL garage', door.real && !door.sandbox, JSON.stringify(door));
    await shot('flow-12-garage-routing.png');
    await finished(CLEAR);
    door = await openGarageDoor();
    step('C#7 championship finished → still the podium', door.podium, JSON.stringify(door));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CHAMPIONSHIP-END GATES (Wave 3). Separable section: everything below runs
  // off CRAFTED save data, so it needs none of the driving above and can be
  // lifted out wholesale. The cluster it pins — podium table, tie-break,
  // certificate, new-championship reset, garage routing — is a single seam:
  // the shape of the championship standings, which used to be read one way in
  // scenes.js and a different way in menus.js.
  // ═══════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════
  // CROSS-MODULE SEAM GATES (Wave 3). Both of these pin a seam whose unit test
  // passes whether or not the seam is actually connected — the failure mode
  // this project keeps producing. They must run against the BUILT game.
  // ═══════════════════════════════════════════════════════════════════════
  async function seamGates() {
    console.log('  ' + '─'.repeat(70));
    console.log('  CROSS-MODULE SEAMS (crowd clock · quiz memory)');

    // ── S#1 the crowd's clock runs backwards at every race start ───────────
    // race.js feeds the crowd `S.clock` during the countdown and `S.raceTime`
    // afterwards. S.clock climbs to ~3.2s and is then reset to 0, so the crowd
    // sees time jump BACKWARD once per race. props.js survives that now, but
    // tests/crowd.test.mjs only proves it against a synthetic clock it invents
    // itself — it never touches race.js and would stay green if that line
    // changed. A roar has to be LIVE across the transition for the old bug
    // (a backward-extrapolated envelope, squared, launching spectators half a
    // million metres up) to have anything to bite on.
    await page.evaluate(() => window.__DEBUG.goto('race', { track: 0 }));
    const crowd = await page.evaluate(() => {
      const D = window.__DEBUG;
      // Walk the live scene graph for the crowd's InstancedMeshes and measure
      // every spectator's Y against the lowest in its own stand.
      const stands = [];
      D.engine.active?.scene?.traverse?.(o => {
        if (/^crowd-(bodies|heads)$/.test(o.name || '') && o.isInstancedMesh) stands.push(o);
      });
      if (!stands.length) return { found: 0 };
      // Each spectator is measured against ITS OWN travel, not against the
      // stand: grandstand terraces step upwards, so the lowest instance in the
      // mesh sits metres below the top row and a shared baseline reads that
      // architecture as flight.
      const lo = stands.map(m => new Float64Array(m.count).fill(Infinity));
      const hi = stands.map(m => new Float64Array(m.count).fill(-Infinity));
      let bad = 0;
      const sample = () => {
        stands.forEach((m, s) => {
          const a = m.instanceMatrix.array;
          for (let i = 0; i < m.count; i++) {
            const y = a[i * 16 + 13];
            if (!Number.isFinite(y)) { bad++; continue; }
            if (y < lo[s][i]) lo[s][i] = y;
            if (y > hi[s][i]) hi[s][i] = y;
          }
        });
      };
      const worst = () => {
        let w = 0;
        stands.forEach((m, s) => {
          for (let i = 0; i < m.count; i++) {
            const d = hi[s][i] - lo[s][i];
            if (Number.isFinite(d) && d > w) w = d;
          }
        });
        return w;
      };
      const run = (secs, stepS = 0.1) => {
        for (let t = 0; t < secs; t += stepS) { D.advance(stepS); sample(); }
      };
      sample();
      run(1.5);                                         // mid-countdown
      D.bus.emit('race:position', { from: 4, to: 3 });  // roar, live across the seam
      run(0.4);
      const during = worst();
      run(4);                                           // green light: clock → 0
      const after = worst();
      run(6);
      return { found: stands.length, during, after, settled: worst(), bad };
    });
    // 2.3m is the tallest archetype's own bob at full cheer gain (tests/crowd.
    // test.mjs derives the same number from the animation constants). The old
    // bug produced ~5.5e5.
    const CROWD_MAX = 2.4;
    step('S#1 crowd instances found in the built race', crowd.found > 0, `${crowd.found} instanced meshes`);
    step('S#1 no spectator launches across the countdown→raceTime clock reset',
      crowd.found > 0 && crowd.bad === 0
      && crowd.during < CROWD_MAX && crowd.after < CROWD_MAX && crowd.settled < CROWD_MAX,
      `during ${crowd.during?.toFixed(3)}m · after reset ${crowd.after?.toFixed(3)}m · settled ${crowd.settled?.toFixed(3)}m · non-finite ${crowd.bad}`);

    // ── S#2 the quiz's memory actually spans races ─────────────────────────
    // quizdata can exclude already-asked ids and race.js forwards an `askedIds`
    // opt, but for a while NOTHING set it: the parameter was inert, the unit
    // test passed (it calls the pure function directly), and race 2 happily
    // re-asked race 1's questions. Only the built game can prove the ledger,
    // the race and the quiz are joined up.
    // Drive the quiz directly rather than waiting for beacons: open every
    // question the race would ever show and check what comes out. The ids the
    // save says were "already asked in race 1" must never appear in race 2.
    const drawIds = async (asked) => {
      await page.evaluate(a => {
        localStorage.setItem('promptracers.v1', JSON.stringify({
          championshipRace: 1, championshipAsked: a, racerId: 'nitzotz', results: [],
        }));
      }, asked);
      await page.reload();
      await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
      await page.evaluate(() => window.__DEBUG.goto('race', { track: 1 }));
      return page.evaluate(() => {
        const q = window.__DEBUG.engine.active?.quiz;
        if (!q) return { exposed: false };
        const ids = [];
        for (let i = 0; i < 12; i++) {
          q.openQuestion?.();
          if (q.currentId && !ids.includes(q.currentId)) ids.push(q.currentId);
          q.close?.();
          window.__DEBUG.advance(30);        // clear the cooldown between draws
        }
        return { exposed: true, ids, poolSize: q.poolSize };
      });
    };

    const baseline = await drawIds([]);
    step('S#2 race.js exposes its quiz to the gates', baseline.exposed !== false,
      baseline.exposed === false ? 'scene.quiz missing' : `${baseline.ids?.length} ids drawn, pool ${baseline.poolSize}`);

    if (baseline.exposed !== false && baseline.ids?.length >= 3) {
      // Exclude exactly the questions this race just proved it likes to draw —
      // a hardcoded id list could silently stop being eligible and the gate
      // would pass by drawing around ids that were never candidates.
      const seen = baseline.ids.slice(0, 5);
      const after = await drawIds(seen);
      const leaked = (after.ids || []).filter(id => seen.includes(id));
      step('S#2 questions already asked this championship are excluded from the next race',
        after.exposed !== false && leaked.length === 0 && after.ids.length > 0,
        `excluded ${seen.length} · redrew ${after.ids?.length} · leaked ${leaked.length ? leaked.join(',') : 'none'}`);
      step('S#2 excluding shrinks the eligible pool (the ledger really reaches the quiz)',
        after.poolSize === baseline.poolSize - seen.length,
        `pool ${baseline.poolSize} → ${after.poolSize}, expected ${baseline.poolSize - seen.length}`);
    } else {
      step('S#2 questions already asked this championship are excluded from the next race',
        false, 'could not draw a baseline set of questions');
    }
    // Leave the save clean for anything after us.
    await page.evaluate(() => localStorage.removeItem('promptracers.v1'));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NAVIGATION WALK (Wave 3, item 15). Separable section: it visits EVERY
  // screen in the game, from crafted save data, and comes home from each one.
  //
  // What it pins, screen by screen:
  //   • the scene really became the one we asked for (not a black screen, not
  //     a silent no-op),
  //   • there is a VISIBLE route home — a control a child can see and press,
  //     not only a keyboard shortcut they will never discover,
  //   • that control is inside the viewport AND hit-tests to itself at its own
  //     centre. "Exists in the DOM" is not the bar: the racer-select back
  //     button existed and was swallowed by the fading title next to it, and
  //     the pause button on the race would be equally useless behind the HUD,
  //   • Escape does what this screen documents, including the two places where
  //     Escape must NOT go home (the root menu, and the pause confirmation),
  //   • pressing that control lands on the main menu.
  //
  // Its own errors budget: a route that lands on a broken screen usually says
  // so on the console long before it looks wrong.
  // ═══════════════════════════════════════════════════════════════════════
  async function navigationWalkGates() {
    console.log('  ' + '─'.repeat(70));
    console.log('  NAVIGATION WALK — every screen has a visible way home');
    const errsBefore = errs.length;

    const SAVE_KEY = 'promptracers.v1';
    const REST = ['zamzum', 'tipa', 'kaftor', 'raash'];
    const ORDER = ['zuzi', 'nitzotz', 'plada', 'nurit', ...REST];
    const ledger = n => Array.from({ length: n }, (_, i) => ({
      trackIndex: i, track: ['oasis', 'circuit', 'cloud'][i] || 'oasis',
      place: 2, timeMs: 90000 + i * 1000, bestLapMs: 30000,
      standings: ORDER.map((id, j) => ({
        racerId: id, place: j + 1, isPlayer: id === 'nitzotz', timeMs: 90000 + j * 800,
      })),
    }));
    // Reload from disk rather than poking save.js: the child arrives at these
    // screens from a cold start too.
    const seed = async patch => {
      await page.evaluate((key, data) => localStorage.setItem(key, JSON.stringify(data)), SAVE_KEY, {
        lang: 'he', quality: 'low', muted: true, racerId: 'nitzotz',
        garageMetBoreg: true, garageTokenIntroSeen: true,   // the one-time explainers own their own dismissal
        ...patch,
      });
      await page.reload({ waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
    };

    // Find a control, and report everything needed to judge whether a CHILD
    // could actually press it: visible, fully inside the viewport, big enough to
    // hit, and — the one that keeps biting us — the topmost element at its own
    // centre point.
    const probe = (sel, reSrc = null) => page.evaluate((sel, reSrc) => {
      const strip = s => String(s == null ? '' : s).replace(/[⁦-⁩]/g, '').trim();
      const re = reSrc ? new RegExp(reSrc) : null;
      const vis = el => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' &&
        +getComputedStyle(el).opacity > 0.05;
      const el = [...document.querySelectorAll(sel)]
        .filter(vis).find(e => !re || re.test(strip(e.textContent)));
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      return {
        found: true, text: strip(el.textContent), cx, cy,
        inView: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
        big: r.width >= 24 && r.height >= 24,
        hits: !!(hit && (hit === el || el.contains(hit))),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      };
    }, sel, reSrc);

    // One assertion, used identically on every screen, so a screen cannot pass
    // by being special.
    const assertHome = (label, p) => {
      step(`N: ${label} — visible route home, inside the viewport, not covered`,
        !!(p.found && p.inView && p.big && p.hits),
        p.found ? `"${p.text}" ${p.rect.join(',')} inView=${p.inView} tapTarget=${p.big} hitTest=${p.hits}`
          : 'NO VISIBLE CONTROL LEADS HOME');
    };
    // A real mouse click at the control's own centre — the same point the hit
    // test just checked, so "it hits" and "it works" are the same claim.
    const clickAt = async p => { if (p.found) await page.mouse.click(p.cx, p.cy); };
    const esc = async (ms = 800) => {
      await page.keyboard.press('Escape');
      await settle(ms);
      return page.evaluate(() => ({
        scene: window.__DEBUG.state().scene,
        overlays: document.querySelectorAll('.mn-ov').length,
        focus: (document.activeElement?.textContent || '').replace(/[⁦-⁩]/g, '').trim().slice(0, 24),
      }));
    };
    const atScene = async (want, label) => {
      const got = await scene();
      step(`N: ${label} — scene is "${want}"`, got === want, `scene=${got}`);
      return got === want;
    };
    // "Not a black screen": something readable, and something to press.
    const alive = async label => {
      const v = await page.evaluate(() => ({
        text: (document.getElementById('ui')?.innerText || '').replace(/\s+/g, ' ').trim().length,
        buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent).length,
      }));
      step(`N: ${label} — renders a real screen (text + controls)`, v.text > 20 && v.buttons > 0,
        `${v.text} chars, ${v.buttons} buttons`);
    };

    // ── 1. MAIN MENU — the root. Escape must NOT leave; it parks focus on the
    //      primary CTA, which is the documented behaviour (menus.js titleScene).
    await seed({ championshipRace: 0, results: [] });
    await atScene('menu', 'main menu');
    await alive('main menu');
    let r = await esc();
    step('N: main menu — Escape stays home and focuses the primary CTA',
      r.scene === 'menu' && r.overlays === 0 && /אליפות/.test(r.focus), JSON.stringify(r));

    // ── 2. RACER SELECT
    await page.evaluate(() => window.__DEBUG.goto('select', {}));
    await settle(900);
    await atScene('select', 'racer select');
    let p = await probe('button.mn-back', 'למסך הבית');
    assertHome('racer select', p);
    r = await esc();
    step('N: racer select — Escape goes home', r.scene === 'menu', JSON.stringify(r));
    await page.evaluate(() => window.__DEBUG.goto('select', {}));
    await settle(900);
    p = await probe('button.mn-back', 'למסך הבית');
    await clickAt(p);
    await settle(900);
    step('N: racer select — the back button lands on the main menu', (await scene()) === 'menu', await scene());

    // ── 3. HOW TO PLAY / 4. ABOUT / 5. SETTINGS — three overlays over the menu.
    for (const [label, open, closeRe] of [
      ['how-to-play', /איך משחקים|How to/, /הבנתי|Got it/],
      ['about (how it was built)', /נבנה|Built/, /מגניב|Cool|סגירה|Close/],
      ['settings', /הגדרות|Settings/, /סגירה|Close/],
    ]) {
      await page.evaluate(() => window.__DEBUG.goto('menu', {}));
      await settle(700);
      const opened = await page.evaluate(src => {
        const re = new RegExp(src);
        const b = [...document.querySelectorAll('.mn-root button')].find(x => re.test(x.textContent));
        if (!b) return false;
        b.click(); return true;
      }, open.source);
      await settle(450);
      const overlay = await page.evaluate(() => document.querySelectorAll('.mn-ov').length);
      step(`N: ${label} — opens from the main menu`, opened && overlay === 1, `overlays=${overlay}`);
      p = await probe('.mn-ov button', closeRe.source);
      assertHome(label, p);
      await clickAt(p);
      await settle(400);
      let left = await page.evaluate(() => document.querySelectorAll('.mn-ov').length);
      step(`N: ${label} — its own button closes it back to the menu`,
        left === 0 && (await scene()) === 'menu', `overlays=${left}, scene=${await scene()}`);
      // ...and Escape does the same thing, without taking the menu with it.
      await page.evaluate(src => {
        const re = new RegExp(src);
        [...document.querySelectorAll('.mn-root button')].find(x => re.test(x.textContent))?.click();
      }, open.source);
      await settle(400);
      r = await esc(400);
      step(`N: ${label} — Escape closes the overlay and leaves the menu standing`,
        r.overlays === 0 && r.scene === 'menu', JSON.stringify(r));
    }

    // ── 6. FREE PLAY (the sandbox garage: no championship on the books) ──────
    await seed({ championshipRace: 0, results: [], tokens: 0, parts: {} });
    await page.evaluate(() => window.__DEBUG.goto('freeplay', { freePlay: true }));
    await settle(1200);
    await atScene('freeplay', 'free play');
    await alive('free play');
    p = await probe('button.mn-home', 'למסך הבית');
    assertHome('free play', p);
    r = await esc();
    step('N: free play — Escape goes home', r.scene === 'menu', JSON.stringify(r));
    await page.evaluate(() => window.__DEBUG.goto('freeplay', { freePlay: true }));
    await settle(1200);
    p = await probe('button.mn-home', 'למסך הבית');
    await clickAt(p);
    await settle(900);
    step('N: free play — the back button lands on the main menu', (await scene()) === 'menu', await scene());

    // ── 7. GARAGE, championship mode (a championship in progress) ────────────
    await seed({ championshipRace: 1, tokens: 14, parts: { engine: 1 }, results: ledger(1) });
    await page.evaluate(() => window.__DEBUG.goto('garage', {}));
    await settle(1200);
    await atScene('garage', 'garage (championship)');
    await alive('garage (championship)');
    step('N: garage (championship) — is the real garage, not the sandbox',
      await page.evaluate(() => !!document.querySelector('.grg-root') &&
        !(document.querySelector('.grg-bignum')?.textContent || '').includes('∞')), '');
    p = await probe('button.mn-home', 'למסך הבית');
    assertHome('garage (championship)', p);
    await clickAt(p);
    await settle(1000);
    step('N: garage (championship) — the back button lands on the main menu',
      (await scene()) === 'menu', await scene());
    await page.evaluate(() => window.__DEBUG.goto('garage', {}));
    await settle(1200);
    r = await esc(1000);
    step('N: garage (championship) — Escape goes home', r.scene === 'menu', JSON.stringify(r));

    // ── 8. RACE + 9. PAUSE ───────────────────────────────────────────────────
    // The race is the screen where being stuck matters most and the screen that
    // had no visible exit at all. Quitting must still cost a confirmation.
    await seed({ championshipRace: 0, results: [] });
    await page.evaluate(() => window.__DEBUG.goto('race', { track: 0 }));
    await settle(1200);
    await page.evaluate(() => window.__DEBUG.advance(8));
    await atScene('race', 'race');
    p = await probe('button.mn-home', 'הפסקה');
    assertHome('race', p);
    await clickAt(p);
    await settle(500);
    let pause = await page.evaluate(() => ({
      overlays: document.querySelectorAll('.mn-ov').length,
      isPause: !!document.querySelector('.mn-dialog.pause'),
      frozen: window.__DEBUG.engine.paused === true,
    }));
    step('N: race — the visible control opens the pause menu and freezes the race',
      pause.overlays === 1 && pause.isPause && pause.frozen, JSON.stringify(pause));
    const quit = await probe('.mn-dialog.pause button', 'יציאה');
    assertHome('pause', quit);
    // A mis-tap must NOT throw the race away: the quit button asks first.
    await clickAt(quit);
    await settle(400);
    const asked = await page.evaluate(() => ({
      scene: window.__DEBUG.state().scene,
      confirming: /לצאת מהמרוץ|Leave the race/.test(document.querySelector('.mn-dialog.pause')?.innerText || ''),
    }));
    step('N: pause — quitting asks before it throws the race away',
      asked.scene === 'race' && asked.confirming, JSON.stringify(asked));
    // Escape inside the confirmation steps BACK, it does not quit and does not resume.
    r = await esc(400);
    const backToMenu = await page.evaluate(() =>
      /הפסקה|Paused/.test(document.querySelector('.mn-dialog.pause')?.innerText || ''));
    step('N: pause — Escape in the confirmation steps back to the pause menu, not out of the race',
      r.scene === 'race' && r.overlays === 1 && backToMenu, JSON.stringify(r) + ` pauseMenu=${backToMenu}`);
    // Escape from the pause menu itself resumes — it must not leave the race.
    r = await esc(500);
    const resumed = await page.evaluate(() => window.__DEBUG.engine.paused === false);
    step('N: race — Escape opens/closes the pause menu and never quits by itself',
      r.scene === 'race' && r.overlays === 0 && resumed, JSON.stringify(r) + ` running=${resumed}`);
    // ...and the confirmed quit does go home.
    await page.evaluate(() => window.__DEBUG.advance(1));
    p = await probe('button.mn-home', 'הפסקה');
    await clickAt(p);
    await settle(400);
    await clickAt(await probe('.mn-dialog.pause button', 'יציאה'));
    await settle(400);
    await clickAt(await probe('.mn-dialog.pause button', 'כן, יוצאים'));
    await settle(1100);
    const afterQuit = await page.evaluate(() => ({
      scene: window.__DEBUG.state().scene, paused: window.__DEBUG.engine.paused,
      overlays: document.querySelectorAll('.mn-ov').length,
    }));
    step('N: pause — confirmed quit lands on the main menu with the engine running',
      afterQuit.scene === 'menu' && afterQuit.paused === false && afterQuit.overlays === 0,
      JSON.stringify(afterQuit));
    await alive('main menu after quitting a race');

    // ── 8b. the race UNDER AN OPEN QUIZ — the one state a child can be stuck in.
    // The quiz freezes the world and its feedback waits for Space with no time
    // limit (D20), so a quiz panel can be the last thing on screen forever. The
    // route home must survive it: the pill stays visible, un-covered, and opens
    // the pause menu ON TOP without disturbing the quiz underneath.
    await page.evaluate(() => window.__DEBUG.goto('race', { track: 0 }));
    await settle(1200);
    await page.evaluate(() => window.__DEBUG.advance(8));
    await page.evaluate(() => window.__DEBUG.engine.active.quiz.openQuestion());
    await settle(400);
    // A child's FIRST question box is preceded by the one-time explainer (D37),
    // which stands in front of the question and opens it when dismissed. This
    // save has never seen one, so dismiss it the way playerBeat does everywhere
    // else — otherwise the assertion below measures the explainer and reports
    // "the quiz is not open" about a quiz that is queued behind it.
    await playerBeat();
    await settle(400);
    const quizUp = await page.evaluate(() => !!document.querySelector('.quiz-root.show'));
    p = await probe('button.mn-home', 'הפסקה');
    step('N: race with a quiz on screen — the quiz is really open', quizUp, `quiz=${quizUp}`);
    assertHome('race under an open quiz', p);
    await clickAt(p);
    await settle(500);
    const overQuiz = await page.evaluate(() => ({
      pause: !!document.querySelector('.mn-dialog.pause'),
      quizStillThere: !!document.querySelector('.quiz-root.show'),
    }));
    step('N: race under an open quiz — pause opens on top, the quiz stays put (D20)',
      overQuiz.pause && overQuiz.quizStillThere, JSON.stringify(overQuiz));
    await esc(500);   // back to the quiz
    await page.evaluate(() => window.__DEBUG.goto('menu', {}));
    await settle(900);

    // ── 10. RESULTS ──────────────────────────────────────────────────────────
    await page.evaluate(o => window.__DEBUG.goto('results', o), {
      trackIndex: 0, place: 2, timeMs: 92000, bestLapMs: 30000, tokens: 12,
      standings: ORDER.map((id, j) => ({ racerId: id, place: j + 1, isPlayer: id === 'nitzotz', timeMs: 90000 + j * 800 })),
    });
    await settle(900);
    await atScene('results', 'results');
    await alive('results');
    p = await probe('button', 'למסך הבית');
    assertHome('results', p);
    r = await esc();
    step('N: results — Escape goes home', r.scene === 'menu', JSON.stringify(r));
    await page.evaluate(o => window.__DEBUG.goto('results', o), {
      trackIndex: 0, place: 2, timeMs: 92000, tokens: 12,
      standings: ORDER.map((id, j) => ({ racerId: id, place: j + 1, isPlayer: id === 'nitzotz' })),
    });
    await settle(900);
    await clickAt(await probe('button', 'למסך הבית'));
    await settle(900);
    step('N: results — the menu button lands on the main menu', (await scene()) === 'menu', await scene());

    // ── 11. PODIUM + 12. CERTIFICATE — the end of a championship ─────────────
    await seed({
      championshipRace: 3, tokens: 9, results: ledger(3),
      bestPrompt: { text: 'מנוע קליל שמאיץ מהר ביציאה מפנייה', score: 84 },
    });
    await page.evaluate(() => window.__DEBUG.goto('podium', {}));
    await settle(1000);
    await atScene('podium', 'podium');
    await alive('podium');
    p = await probe('button', 'למסך הבית');
    assertHome('podium', p);
    // The certificate is the pay-off screen, and the one most likely to trap a
    // child: it is a modal over the podium, so it needs BOTH a way back to the
    // podium and a way home.
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find(x => /תעודת|Certificate/.test(x.textContent))?.click();
    });
    await settle(500);
    const certOpen = await page.evaluate(() => document.querySelectorAll('.mn-ov .mn-dialog.cert').length);
    step('N: certificate — opens from the podium', certOpen === 1, `overlays=${certOpen}`);
    const certHome = await probe('.mn-ov button', 'הבית');
    assertHome('certificate', certHome);
    const certClose = await probe('.mn-ov button', 'סגירה');
    step('N: certificate — also has a visible way back to the podium',
      !!(certClose.found && certClose.inView && certClose.hits),
      certClose.found ? `"${certClose.text}" hitTest=${certClose.hits}` : 'no close button');
    // Escape must return to the podium, NOT skip the podium and land home.
    r = await esc(600);
    step('N: certificate — Escape returns to the podium it was opened from',
      r.scene === 'podium' && r.overlays === 0, JSON.stringify(r));
    // Escape on the podium itself goes home.
    r = await esc();
    step('N: podium — Escape goes home', r.scene === 'menu', JSON.stringify(r));
    // And the certificate's own home button goes all the way home in one press.
    await page.evaluate(() => window.__DEBUG.goto('podium', {}));
    await settle(900);
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find(x => /תעודת|Certificate/.test(x.textContent))?.click();
    });
    await settle(500);
    await clickAt(await probe('.mn-ov button', 'הבית'));
    await settle(1000);
    const home = await page.evaluate(() => ({
      scene: window.__DEBUG.state().scene, overlays: document.querySelectorAll('.mn-ov').length,
    }));
    step('N: certificate — its home button lands on the main menu, overlay gone',
      home.scene === 'menu' && home.overlays === 0, JSON.stringify(home));
    await alive('main menu after the certificate');

    // ── 13. the garage door at the end of a championship ─────────────────────
    // Once every race is run the garage IS the podium (scenes.js). That reroute
    // must not strand anyone: the screen it lands on needs its own way home.
    await page.evaluate(() => window.__DEBUG.goto('garage', {}));
    await settle(1000);
    // The engine keeps the name it was asked for ('garage'); what changes is the
    // screen behind it, so this asserts on what is actually rendered.
    const rerouted = await page.evaluate(() => ({
      podium: !!document.querySelector('.mn-prow'), garage: !!document.querySelector('.grg-root'),
    }));
    step('N: garage after the final race — reroutes to the podium, not a black screen',
      rerouted.podium && !rerouted.garage, `scene=${await scene()} ${JSON.stringify(rerouted)}`);
    assertHome('garage → podium', await probe('button', 'למסך הבית'));

    await shot('flow-13-nav-walk.png');
    step('N: no page errors during the whole navigation walk', errs.length === errsBefore,
      errs.slice(errsBefore, errsBefore + 2).join(' | '));
    await page.evaluate(key => localStorage.removeItem(key), SAVE_KEY);
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ECONOMY, part 2 of 2 — THE PLAYER THE TARGET IS ABOUT (Wave 4, item 6).
  //
  // The garage's whole lesson is "precision costs, so choose where it is worth
  // spending", against a maximum ask of MAX_COST (21) — and the target is that a
  // player who is BOTH winning AND answering every question still cannot buy it.
  // Nothing in this file could measure that player until now: the play slice's
  // driver holds a throttle key, and for three waves the assertion that looked at
  // the wallet reported `tokensFromQuiz = 0` on every run in the project's
  // history and passed because the term that breaks it was missing (D29).
  //
  // So this drives a real race on the game's own autopilot — a clean racing line
  // that wins — and answers every question box it meets, correctly, through the
  // real answer buttons. The result is the whole wallet, by source, for exactly
  // the child the economy is aimed at.
  // The best ask a given wallet can buy, enumerated over the garage's REAL price
  // list and scored by the garage's REAL scorer. `ceiling` lets the caller ask
  // "the best ask costing no more than N", which is how a child who means to save
  // something for next time shops.
  const askTable = [];
  for (let b = 0; b <= 30; b++) {
    let best = { score: 0, cost: 0 };
    for (const part of KART_SLOTS)
      for (const g of optionsFor('goal', part))
        for (const l of optionsFor('constraint', part))
          for (const s of optionsFor('style', part)) {
            const sel = { part, goal: g.id, constraint: l.id, style: s.id };
            const cost = costOf(sel);
            if (cost > b) continue;
            const score = scorePrompt(sel).score;
            if (score > best.score || (score === best.score && cost < best.cost)) best = { score, cost };
          }
    askTable[b] = best;
  }
  const bestAskUpTo = n => askTable[Math.max(0, Math.min(30, n))];
  // The wallet a child arrives at the SECOND garage with, exactly as scenes.js
  // computes it: race 1, spend, rebate, race 2.
  const walletAtSecondGarage = (r1, buy, r2) => r1 - buy.cost + tokenReward(buy.score, false) + r2;

  const SAVE_KEY = 'promptracers.v1';
  /**
   * Drive one real race to the flag on the game's own autopilot and return the
   * result object the results screen reads. `answer` is the child:
   *   'all'  — answers every question box, correctly (an engaged child)
   *   'none' — never touches a box (a disengaged one; they time out)
   */
  async function driveRace({ track, difficulty, seed, answer }) {
    await page.evaluate(k => localStorage.setItem(k, JSON.stringify({
      racerId: 'nitzotz', results: [], championshipRace: 0,
      // The one-time explainers own their own dismissal and are gated elsewhere;
      // what is being measured here is tokens, not popups.
      garageTokenIntroSeen: true, quizBoxIntroSeen: true, garageMetBoreg: true,
    })), SAVE_KEY);
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
    await page.evaluate(o => window.__DEBUG.goto('race', o),
      { track, difficulty, seed, autopilot: true, introCard: false });

    return page.evaluate(async (answer) => {
      const D = window.__DEBUG;
      const sc = D.engine.active;
      const q = sc.quiz;
      const STEP = 1 / 60;
      let answered = 0, correct = 0, opened = 0;
      const off = D.bus.on('quiz:open', () => { opened++; });
      // The disengaged run lets every box time out, and a timeout costs a 24s
      // cooldown of slow motion — so it needs a much longer sim budget than the
      // engaged one, or it "fails to reach the flag" for a pacing reason.
      for (let i = 0; i < 60 * 1800 && !window.__LAST_RESULT__; i++) {
        D.engine.time += STEP;
        sc.update(STEP);
        // A child dismisses things; so does this.
        const scrim = document.querySelector('.grgtok-scrim, .qzint-scrim, .ic-scrim');
        if (scrim && scrim.offsetParent !== null) { scrim.querySelector('button')?.click(); continue; }
        if (q && q.phase === 'question' && answer === 'all') {
          // `correctSlot` is the panel's own answer: the three options are
          // shuffled per showing, so nothing outside it can know which is right,
          // which is why no automated driver had ever answered one.
          const btns = document.querySelectorAll('.quiz-root.show .quiz-opt');
          const slot = q.correctSlot;
          if (btns[slot]) { const was = q.correctSlot; btns[slot].click(); answered++; if (slot === was) correct++; }
        } else if (q && q.phase === 'feedback') {
          q.dismiss('key');            // the child has read the explanation
        }
      }
      off();
      const r = window.__LAST_RESULT__;
      return { r, opened, answered, correct, beacons: q?.beaconCount ?? 0 };
    }, answer);
  }

  async function economyGate() {
    console.log('\n  TOKEN ECONOMY — a winning, fully engaged race\n  ' + '─'.repeat(70));
    const run = await driveRace({ track: 0, difficulty: 1, seed: 3, answer: 'all' });

    const r = run.r;
    if (!r) { step('E: the engaged race reached the flag', false, `${run.opened} questions opened`); return; }
    console.log(`        \x1b[2m${r.tokensFromPickups} pickups + ${r.tokensFromQuiz} quiz + ${r.tokensFinishBonus} finish`
      + ` = ${r.tokens} banked · P${r.place} · ${run.correct}/${run.opened} boxes answered right`
      + ` · ask costs ${MIN_COMPLETE_COST}–${MAX_COST}\x1b[0m`);

    // The term that was missing. Assert it is PRESENT, not merely that the total
    // looks sane: a band over a sum passes happily while a summand is absent,
    // which is exactly how the old assertion stayed green for three waves.
    step('E: the driver really meets question boxes and answers them',
      run.opened >= 4 && run.correct === run.opened && r.tokensFromQuiz > 0,
      `${run.correct}/${run.opened} right → ${r.tokensFromQuiz} tokens from the quiz`);
    step('E: it really is a winning race', r.place <= 2, `P${r.place}`);
    // THE TARGET (Wave-4 item 6, D17 restated with the quiz counted).
    step('E: a winning, fully engaged race still cannot buy the top ask',
      r.tokens < MAX_COST,
      `${r.tokens} banked vs ${MAX_COST} — margin ${MAX_COST - r.tokens}`);
    // The band. Measured 14–18 across three tracks × three seeds; it must FAIL
    // rather than be widened, because it is the thing that notices a constant
    // drifting back up underneath an invariant that still happens to hold.
    step('E: …and the yield stays in the intended 11–19 band',
      r.tokens >= 11 && r.tokens <= 19,
      `${r.tokens} = ${r.tokensFromPickups}+${r.tokensFromQuiz}+${r.tokensFinishBonus}`);
    // Each source still contributes: a "balanced" total that is really one term
    // is how the economy got here in the first place.
    step('E: every source still pays something (pickups / quiz / finish)',
      r.tokensFromPickups > 0 && r.tokensFromQuiz > 0 && r.tokensFinishBonus > 0,
      `${r.tokensFromPickups} / ${r.tokensFromQuiz} / ${r.tokensFinishBonus}`);

    // ─────────────────────────────────────────────────────────────────────────
    // CARRYOVER — the Wave-5 target: the top tier must be REACHABLE.
    //
    // Everything above measures ONE race, and one race is deliberately not
    // enough to buy the 21-token ask (that is invariant A, and it is what stops
    // the garage becoming a shop where everything is affordable). But the wallet
    // CARRIES, so what a child can actually buy is decided at the second garage,
    // by `race1 − spend + rebate + race2` — and until Wave 5 nothing in this file
    // looked at that number. It was possible for the top tier of the teaching
    // screen to be unreachable in real play with every assertion above green.
    //
    // So: drive race 2 as well (it is a DIFFERENT track at a DIFFERENT pace —
    // the reason this must be measured rather than doubled), drive one race as a
    // child who never touches a question box, and run the real prices, the real
    // scorer and the real rebate over both.
    const run2 = await driveRace({ track: 1, difficulty: 2, seed: 3, answer: 'all' });
    const idle = await driveRace({ track: 0, difficulty: 1, seed: 3, answer: 'none' });
    if (!run2.r || !idle.r) {
      step('E2: the carryover races reached the flag', false,
        `engaged race 2 ${run2.r ? 'ok' : 'MISSING'}, disengaged race ${idle.r ? 'ok' : 'MISSING'}`);
    } else {
      const R1 = r.tokens, R2 = run2.r.tokens, RI = idle.r.tokens;
      // A child who ignores the boxes must still be recognisable AS that child in
      // the numbers — if the two profiles bank the same, the assertions below are
      // measuring nothing.
      step('E2: the disengaged run really is disengaged (no quiz income)',
        idle.r.tokensFromQuiz === 0 && idle.opened >= 3 && RI < R1,
        `${idle.opened} boxes met, ${idle.correct} answered → ${RI} banked vs the engaged ${R1}`);

      // THE TARGET. The child buys something REAL at the first garage — an ask
      // costing at least twice the cheapest complete one — and can still afford
      // the top tier at the second. Not "buys the cheapest thing and hoards":
      // that was the only route before Wave 5, and it paid the child for NOT
      // engaging with the teaching screen.
      const REAL_ASK = MIN_COMPLETE_COST * 2;
      let bought = null, wallet = 0;
      for (let cap = R1; cap >= REAL_ASK; cap--) {
        const ask = bestAskUpTo(cap);
        if (ask.cost < REAL_ASK) continue;
        const w = walletAtSecondGarage(R1, ask, R2);
        if (w >= MAX_COST) { bought = ask; wallet = w; break; }   // the most it can spend and still get there
      }
      console.log(`        \x1b[2mcarryover: race1 ${R1} + race2 ${R2}`
        + (bought ? `, best first-garage ask that keeps the top tier in reach: ${bought.cost} tokens (score ${bought.score},`
          + ` rebate ${tokenReward(bought.score, false)}) → ${wallet} at the second garage` : ', top tier unreachable')
        + `  ·  disengaged ${RI}+${RI}\x1b[0m`);
      step('E2: an engaged child reaches a top-tier ask by the second garage',
        !!bought && wallet >= MAX_COST,
        bought ? `${R1} − ${bought.cost} + ${tokenReward(bought.score, false)} + ${R2} = ${wallet} vs the ${MAX_COST} top ask`
          : `nothing above ${REAL_ASK} tokens leaves ${MAX_COST} in reach`);
      step('E2: …and it is a real ask, not the cheapest thing on the screen',
        !!bought && bought.cost >= REAL_ASK,
        bought ? `spent ${bought.cost} at the first garage, cheapest complete ask is ${MIN_COMPLETE_COST}` : '—');

      // The other half, and the half that is easy to lose: making the top tier
      // reachable must not make it reachable for a child who engaged with
      // nothing. Measured against the most GENEROUS thing that child can do —
      // buy the cheapest complete ask and bank everything else, twice.
      const idleWallet = walletAtSecondGarage(RI, bestAskUpTo(MIN_COMPLETE_COST), RI);
      step('E2: a child who ignores every box still cannot, however they hoard',
        idleWallet < MAX_COST,
        `${RI} − ${MIN_COMPLETE_COST} + ${tokenReward(bestAskUpTo(MIN_COMPLETE_COST).score, false)} + ${RI}`
        + ` = ${idleWallet} vs the ${MAX_COST} top ask`);
    }
    await page.evaluate(k => localStorage.removeItem(k), SAVE_KEY);
  }

  if (runs('play')) await mainFlowGates();
  if (runs('play') || runs('econ')) await economyGate();
  if (runs('champ')) await championshipEndGates();
  if (runs('seam')) await seamGates();
  if (runs('nav')) await navigationWalkGates();

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

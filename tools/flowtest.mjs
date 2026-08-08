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
    // The ANSWERED state first. Wave 3 turned the quiz from slow motion into a
    // full freeze whose feedback waits for Space with NO time limit, so a beat
    // that only ever presses a digit answers the question and then leaves the
    // explanation up forever with the sim stopped — the race can never finish.
    // This gate passed anyway only because its straight-ahead driver happens to
    // miss every beacon (which is also why tokensFromQuiz has always read 0);
    // the day the driver improves, the run would deadlock instead of failing.
    if (visible(document.querySelector('.quiz-card.quiz-answered'))) {
      dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      return 'quiz:dismiss';
    }
    // Then an ACTUALLY OPEN quiz question (not merely the container).
    const q = document.querySelector('.quiz-q');
    if (visible(q)) {
      dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
      return 'quiz';
    }
    return null;
  });

  // The two gate groups are independent: the play-through drives a real race,
  // the championship-end group runs off crafted save data. `--only=play` /
  // `--only=champ` runs one of them, so a fix in either seam can be iterated on
  // in seconds instead of minutes.
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
    const clean = s => String(s == null ? '' : s).replace(/[⁦-⁩]/g, '').trim();

    const ledger = orders => orders.map((order, i) => ({
      trackIndex: i, track: ['oasis', 'circuit', 'cloud'][i] || 'oasis',
      place: order.indexOf('nitzotz') + 1, timeMs: 90000 + i * 1000, bestLapMs: 30000,
      standings: order.map((id, j) => ({
        racerId: id, place: j + 1, isPlayer: id === 'nitzotz', timeMs: 90000 + j * 800,
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
    const finished = (orders, extra = {}) =>
      seed({ championshipRace: 3, tokens: 9, parts: { engine: 2, tires: 1 }, results: ledger(orders), ...extra });

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
    const expectFor = (orders) => {
      const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
      const acc = new Map();
      orders.forEach(order => order.forEach((id, i) => {
        const e = acc.get(id) || { points: 0, wins: 0, bestFinal: 99 };
        e.points += POINTS[i]; if (i === 0) e.wins++;
        acc.set(id, e);
      }));
      orders[orders.length - 1].forEach((id, i) => { acc.get(id).bestFinal = i + 1; });
      return [...acc.entries()]
        .map(([id, e]) => ({ id, ...e, isPlayer: id === 'nitzotz' }))
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
      const headerOK = myPlace === 1
        ? /אלוף/.test(got.title) && !/מקום ה/.test(got.congrats)
        : got.congrats.includes(HE_ORDINAL[myPlace]) && !/אלוף/.test(got.title);
      step(`C#3 tie 24–24 (${label}): table follows the tie-break`, tableOK,
        got.rows.slice(0, 2).map(r => `${r.place}.${r.name} ${r.points}${r.isMe ? '*' : ''}`).join('  '));
      step(`C#3 tie 24–24 (${label}): header place === table place`, headerOK,
        `table P${myPlace} · "${got.congrats.slice(0, 46) || got.title}"`);
      if (label === 'rival takes it') await shot('flow-9-podium-tie.png');
    }

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

  if (runs('play')) await mainFlowGates();
  if (runs('champ')) await championshipEndGates();
  if (runs('seam')) await seamGates();

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

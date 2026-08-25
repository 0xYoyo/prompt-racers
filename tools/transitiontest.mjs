// SCENE-TRANSITION GATE (Wave 5.1 item 2).
//
// WHAT THIS EXISTS TO CATCH
// -------------------------
// Wave 5 shipped a regression the player felt as a 1-2 s hard freeze whenever a
// screen changed: entering and leaving האוסף שלי, garage -> home, starting or
// continuing a championship, kart-select -> race. Nothing was slow to RENDER;
// the freeze was work being redone from scratch on the transition path, on every
// single scene entry:
//
//   * `paintSky` repainted a 2048x1024 equirectangular canvas and ran its dither
//     pass (one getImageData of 2.1 M pixels, a per-pixel fbm loop, one
//     putImageData) — and `rig.dispose()` threw the result away again. Every
//     scene that shows a sky paid it: title backdrop, racer select, collection,
//     race, podium.
//   * the signage occlusion search re-probed every board on a 21 x 9 grid across
//     both lettered planes from six read distances, for every nudge and every
//     outward step: ~560 ms of pure JS per track build.
//   * `auditTrackClearance` re-swept the whole lap: ~210 ms per track build.
//
// All three are pure functions of (theme / track, quality tier). The fix is to
// compute them once and reuse. THIS GATE IS THE THING THAT KEEPS THEM CACHED:
// the failure mode is silent (the game still looks right, it just stutters), so
// nothing but a measured wall clock will ever notice it coming back.
//
// HOW IT MEASURES
// ---------------
// A 4 ms `setInterval` heartbeat runs in the page. A synchronous main-thread
// block cannot be interrupted, so the LARGEST GAP between two heartbeats across
// a transition is the length of the longest freeze the player would feel —
// which is the number that matters, not the total wall time (a transition that
// yields three times for 300 ms each is not a freeze).
//
// THE LAPS:
//   * cold, untimed-as-a-gate. It pays one-off costs that are NOT the bug —
//     shader program compilation, the first bake of each theme's texture set —
//     and under headless SwiftShader (no GPU, software rasteriser) shader
//     linking alone reads as 0.5-2 s per new material set. Gating that tightly
//     would be gating the rasteriser, not the game, so it only has to stay under
//     a catastrophe ceiling.
//   * warm x2, judged on the faster of the two. Everything the regression re-did
//     per entry is re-done on a warm lap as well, so the bug is fully visible
//     here.
//   * tier, at the two quality tiers the first three laps did not use, over
//     variants already baked. This is the lap that catches a cache sized for a
//     key space smaller than the game's — the failure mode a single-tier gate is
//     structurally blind to. See SKY_TEX_MAX in src/gfx/sky.js.
//
// AND THE ASSERTION THAT ACTUALLY MATTERS is not any of those clocks: it is the
// bake counters (PERF_STATS in src/gfx/sky.js). Each one is incremented inside
// the expensive work — `paintSky`, `buildOccluderIndex`, `auditTrackClearance` —
// and never at the cache that skips it, so removing a cache cannot remove its
// counter along with it. Warm and tier laps must bake zero of everything.
//
//   node tools/transitiontest.mjs
//   node tools/transitiontest.mjs --budget 2000 --json .tmp/trans.json
//   node tools/transitiontest.mjs --quality low
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, writeFileSync, mkdirSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const a = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) a[k.slice(2)] = (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--')) ? true : process.argv[++i];
}

const dist = resolve(root, a.html || 'dist/index.html');
if (!existsSync(dist)) { console.error(`missing ${dist} — npm run build`); process.exit(2); }

// THE BUDGET, and why it is not 250 ms.
//
// 250 ms is the right target for a PLAYER and it is what the fix was aimed at.
// It is not a threshold this harness can honestly assert, and the profile says
// exactly why: after the fix, everything left in a warm transition that costs
// more than ~30 ms is `getShaderInfoLog` / `getProgramInfoLog` /
// `getProgramParameter` — WebGL program linking inside SwiftShader, the
// software rasteriser this gate runs on because there is no GPU in CI. Measured
// warm, game JS is ~180-200 ms per race transition and shader linking accounts
// for 42-74% of the wall time on top of it, varying by a factor of two run to
// run on an otherwise identical page. (An earlier draft of this comment said
// 60-100 ms; that was read off the largest few self-time entries rather than the
// whole JS total, and an independent re-measure put it at 180-200. The argument
// is unchanged — 200 ms is still inside the brief's 250 ms — but the number was
// wrong and a wrong number in a threshold's justification is how thresholds
// drift.) Asserting 250 ms here would gate the rasteriser, not the game, and it
// would flap.
//
// So the time budget is 1600 ms, and it is picked from both sides of a measured
// gap rather than chosen:
//   * after the fix the worst warm transitions are the ones that still rebuild
//     the title/free-play backdrop — garage -> home and free play -> home, at
//     815-1040 ms depending on machine load, nearly all of it program linking;
//   * against pre-fix code every track-bearing transition fails, the SMALLEST at
//     1673 ms and the worst at 3529 ms.
// 1600 sits above the first and below the second, so it still turns all seven
// pre-fix transitions red. Tighter flaps on the rasteriser; looser lets a real
// regression through.
//
// Both halves of that gap MOVE TOGETHER with machine load — on a box busy with
// other agents' gates the post-fix worst rose to 1190 ms and the pre-fix numbers
// rose to 2124-5386 ms in the same conditions — which is why the margin is
// stated as a ratio and not as a promise. It is also why this is the weaker
// assertion: when the two are close, believe the bake counters.
//
// If `free play -> home` ever starts brushing this ceiling, the fix is to stop
// rebuilding a whole race scene behind a menu — NOT to raise the number.
//
// It is deliberately the WEAKER of the two assertions. The strong one is the
// bake counter below, which is exact, rasteriser-independent, and goes red the
// instant any of the three caches is removed.
const BUDGET = +(a.budget || 1600);
// The cold lap pays every one-time bake in the game at once, and it is bounded
// so a genuine catastrophe still fails — not so it is comfortable.
//
// 20000 ms, and the size of that number is an admission rather than a comfort.
// The FIRST entry to a theme nobody has visited (starting a championship on עיר
// הנוירונים) profiles at 6.0-6.6 s under SwiftShader on an idle box — 3.8 s of
// canvas readback baking twelve 1024^2 signage/surface textures plus that
// theme's sky, and 1.4 s of one-off signage occlusion search — and 12.8 s on a
// box busy with other agents' gates. Software texture upload is the part that
// degrades worst under contention, so a tight cold ceiling is a flap generator
// and nothing else: it would fire on CPU contention, never on a code change.
//
// So this catches a catastrophe (a first entry that has doubled again) and
// nothing subtler. The first-visit cost itself is real, is a genuine
// player-facing freeze, and is LOGGED rather than fixed — removing it means
// baking a theme ahead of time on an idle frame, a new system rather than the
// caching fix this gate belongs to. See the Wave 5.1 entry in GAPS.md.
const COLD_BUDGET = +(a['cold-budget'] || 20000);
// A caching fix that leaks is not a fix. An identical second lap over every
// screen must not grow the JS heap by anything like a scene's worth.
const HEAP_GROWTH_MB = +(a['heap-growth'] || 40);
// THE PLAYER-PATH BUDGET (Wave 6 item 5).
//
// The cold numbers above are the HARNESS path: `__DEBUG.goto` sets
// `engine._headless`, `introCardEnabled` returns false for it, and a race
// therefore builds with nothing in front of it. That path is allowed to keep the
// cost — it is the one that makes the cost measurable.
//
// A CHILD never takes that path. Every real race opens on the pre-race card, and
// since Wave 6 scenes.js raises that card BEFORE building the world, so the
// one-off first-visit build happens behind a full curtain. What this budget
// bounds is therefore not the build at all: it is the only part of the
// transition a child can still perceive as a freeze — the stretch between asking
// for a race and having something on screen.
//
// 400 ms, and it is a ceiling rather than a target: measured on this rasteriser
// the card mounts 2-5 ms into the transition with 0 ms of main-thread block in
// front of it, while the build behind it still costs 3.9-5.7 s. Two orders of
// magnitude of margin is not slack, it is the shape of the fix — the pre-card
// window contains one `createIntroCard` and two animation frames and nothing
// else, so anything that pushes it past 400 ms is work that has moved to the
// wrong side of the curtain, which is the entire regression this section exists
// to catch.
const CURTAIN_BUDGET = +(a['curtain-budget'] || 400);
// ...and the other half of the same assertion. A mask that masks nothing passes
// trivially, so the section also requires that there WAS a freeze behind the
// card — otherwise a build that had simply become cheap (or a race that failed
// to build at all) would read as a successful masking. If this one ever fails
// because a first visit genuinely got fast, that is the good outcome: retire the
// check deliberately, do not lower it.
const CURTAIN_MASKED_MIN = +(a['curtain-masked-min'] || 500);
const QUALITY = a.quality || 'high';
const SEED = +(a.seed || 12345);

// The walk: every screen the player can reach, in an order a player reaches
// them in, including both championship entries (a new theme, then a repeat) and
// both directions through the collection screen.
const WALK = [
  ['title (menu)', 'menu', {}],
  ['title -> racer select', 'select', {}],
  ['racer select -> race', 'race', { track: 0 }],
  ['race -> results', 'results', { track: 0, place: 1 }],
  ['results -> garage', 'garage', {}],
  ['garage -> home', 'menu', {}],
  ['home -> collection', 'collection', {}],
  ['collection -> home', 'menu', {}],
  ['champ start (track 1)', 'race', { track: 1 }],
  ['champ continue (track 2)', 'race', { track: 2 }],
  ['race -> podium', 'podium', {}],
  ['podium -> home', 'menu', {}],
  ['home -> free play', 'freeplay', {}],
  ['free play -> home', 'menu', {}],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--mute-audio'],
});

const errs = [];
let cold = [], warm = [], caches = null, bakes = null;
const curtain = [];
let latch = null;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });   // school-laptop resolution
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto('file://' + dist, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 90000 });

  // The heartbeat. 4 ms is fast enough that the measurement floor (~4-8 ms of
  // timer jitter) is an order of magnitude under the budget, and cheap enough
  // that it does not itself perturb the transition.
  await page.evaluate(() => {
    window.__HB = { last: performance.now(), max: 0, n: 0 };
    setInterval(() => {
      const t = performance.now();
      const gap = t - window.__HB.last;
      window.__HB.last = t;
      window.__HB.n++;
      if (gap > window.__HB.max) window.__HB.max = gap;
    }, 4);
  });

  const stats = () => page.evaluate(() => ({ ...(globalThis.__PERFSTATS__ || {}) }));

  async function lap(label, quality = QUALITY) {
    const rows = [];
    for (const [name, scene, opts] of WALK) {
      // Let the heartbeat settle and zero the high-water mark, so the number
      // below belongs to this transition and nothing else.
      await new Promise(r => setTimeout(r, 120));
      const r = await page.evaluate(async (s, o, q, seed) => {
        window.__HB.max = 0; window.__HB.last = performance.now(); window.__HB.n = 0;
        const t0 = performance.now();
        await window.__DEBUG.goto(s, { ...o, quality: q, seed, lang: 'he' });
        const wall = performance.now() - t0;
        return { wall, block: window.__HB.max, beats: window.__HB.n, scene: window.__DEBUG.state().scene };
      }, scene, opts, quality, SEED);
      if (r.scene !== scene) errs.push(`scene mismatch after "${name}": wanted ${scene}, got ${r.scene}`);
      rows.push({ name, ...r });
    }
    return rows;
  }

  cold = await lap('cold');
  const afterCold = await stats();
  const heapCold = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1);
  // TWO warm laps, and each transition is judged on the FASTER of its two.
  // Under a software rasteriser the same transition varies by a factor of two
  // run to run purely on scheduler and shader-linker luck, while a transition
  // that regenerates an asset is slow every single time. Taking the minimum
  // keeps the gate sensitive to the second and blind to the first.
  const warmA = await lap('warm1');
  const warmB = await lap('warm2');
  warm = warmA.map((r, i) => ({
    ...r,
    block: Math.min(r.block, warmB[i].block),
    blockHi: Math.max(r.block, warmB[i].block),
    wall: Math.min(r.wall, warmB[i].wall),
  }));
  const afterWarm = await stats();
  const heapWarm = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1);

  // THE TIER LAP. Everything above walks at one quality tier, and that is
  // structurally why the first round of this gate could not see a sky cache
  // sized for 4 variants in a key space of 9: the key carries the tier
  // (`applyTheme` picks a 2048/1536/1024 sky from `q.texSize`, `variantKey`
  // carries propDensity and friends), so a single-tier walk exercises one third
  // of it and can never provoke the thrash a player provokes with the settings
  // toggle. So: cold-walk the other two tiers to bake them, then re-walk all
  // three and require zero bakes across the lot.
  const OTHER_TIERS = ['low', 'medium', 'high'].filter(t => t !== QUALITY);
  for (const t of OTHER_TIERS) await lap('bake:' + t, t);          // untimed, bakes them
  const beforeTierLap = await stats();
  const tierRows = [];
  for (const t of [QUALITY, ...OTHER_TIERS]) tierRows.push([t, await lap('tier:' + t, t)]);
  const afterTierLap = await stats();
  const heapTier = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1);

  bakes = {
    skyPaints: (afterWarm.skyPaints ?? 0) - (afterCold.skyPaints ?? 0),
    signSearches: (afterWarm.signSearches ?? 0) - (afterCold.signSearches ?? 0),
    trackAudits: (afterWarm.trackAudits ?? 0) - (afterCold.trackAudits ?? 0),
    cold: afterCold,
    tier: {
      tiers: [QUALITY, ...OTHER_TIERS],
      skyPaints: (afterTierLap.skyPaints ?? 0) - (beforeTierLap.skyPaints ?? 0),
      signSearches: (afterTierLap.signSearches ?? 0) - (beforeTierLap.signSearches ?? 0),
      trackAudits: (afterTierLap.trackAudits ?? 0) - (beforeTierLap.trackAudits ?? 0),
      worst: tierRows.map(([t, rows]) => {
        const w = rows.reduce((m, r) => (r.block > m.block ? r : m), rows[0]);
        return { tier: t, name: w.name, block: w.block };
      }),
    },
  };
  caches = { heapCold, heapWarm, heapTier };

  // ── THE PLAYER PATH: a first visit to each track, with the card up ────────
  // On a SECOND PAGE, deliberately. The caches this file's other laps measure
  // are module state, so a fresh page is the only way to get three genuinely
  // cold track builds without perturbing the cold/warm/tier laps above.
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1366, height: 768 });
  p2.on('pageerror', e => errs.push('PAGEERROR (curtain): ' + e.message));
  await p2.goto('file://' + dist, { waitUntil: 'load', timeout: 90000 });
  await p2.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 90000 });
  await p2.evaluate(() => {
    window.__HB = { last: performance.now(), max: 0 };
    setInterval(() => {
      const t = performance.now(); const g = t - window.__HB.last;
      window.__HB.last = t; if (g > window.__HB.max) window.__HB.max = g;
    }, 4);
  });
  // One priming transition first, and it is not a cheat — it is the same
  // argument this file already makes for COLD_BUDGET. A freshly loaded page owes
  // one-time costs that belong to the rasteriser rather than to the game (WebGL
  // program links dominate under SwiftShader), and the very first transition on
  // it pays all of them. Without this, track 0 measured 642 ms to its first
  // frame while the build behind the curtain was only 200 ms — i.e. the number
  // was almost entirely page warm-up, and gating it would gate the rasteriser.
  //
  // Note also that track 0 is never really cold here: the title screen's
  // backdrop is a live race on it, so booting the page has already baked its
  // theme. Tracks 1 and 2 are the genuinely cold entries, and they are the ones
  // carrying a real build behind the curtain (see the masked column).
  await p2.evaluate(() => window.__DEBUG.goto('select', {}));
  await new Promise(r => setTimeout(r, 300));

  for (const track of [0, 1, 2]) {
    await new Promise(r => setTimeout(r, 120));
    curtain.push(await p2.evaluate(async (tk, seed) => {
      // A MutationObserver rather than a poll: the build blocks the main thread,
      // so nothing that has to be scheduled can observe the moment the card is
      // inserted. The observer callback runs in the yield scenes.js takes for
      // its two animation frames, which is exactly the window being measured.
      // `at` is DOM INSERTION and `painted` is the second animation frame after
      // it. The difference is the whole item: a mutant that mounts the card and
      // never yields to the compositor inserts it in 2 ms and shows the child a
      // frozen title screen for the entire build, and an insertion-only metric
      // calls that a success. If the build takes the thread before those two
      // frames run, they cannot run until it finishes — so `painted - at` is
      // the length of the freeze the child saw with nothing on top of it.
      window.__CARD = { at: null, painted: null };
      const obs = new MutationObserver(() => {
        if (window.__CARD.at == null && document.querySelector('.ic-root')) {
          window.__CARD.at = performance.now();
          // ONE frame, and the count is the point. An animation-frame callback
          // for frame N runs immediately before frame N is rendered, so this
          // firing means the browser reached a rendering opportunity with the
          // card in the DOM — i.e. it painted it. scenes.js yields for two
          // frames before building, so with correct code this callback lands in
          // the first of them, well before the thread is taken. With a mutant
          // that mounts the card and does not yield, the build runs inside this
          // same task and the callback cannot fire until it is over — which is
          // exactly the difference this number reports.
          requestAnimationFrame(() => { window.__CARD.painted = performance.now(); });
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      window.__HB.max = 0; window.__HB.last = performance.now();
      const t0 = performance.now();
      // `introCard: true` is the explicit override introCardEnabled() honours in
      // both directions — this is the real card on the real player path, not a
      // harness imitation of one.
      await window.__DEBUG.goto('race', { track: tk, introCard: true, seed, lang: 'he' });
      const total = performance.now() - t0;
      // The card is armed two animation frames after the build (see race.js);
      // under a software rasteriser two frames can outlast `__DEBUG.goto`'s own
      // 60 ms settle, so give it a beat before reading the flag.
      await new Promise(r => setTimeout(r, 350));
      obs.disconnect();
      const sc = window.__DEBUG.engine.active;
      return {
        track: tk, total, blockTotal: window.__HB.max,
        cardAt: window.__CARD.at == null ? null : window.__CARD.at - t0,
        paintedAfterMount: window.__CARD.painted == null || window.__CARD.at == null
          ? null : window.__CARD.painted - window.__CARD.at,
        cardUp: !!document.querySelector('.ic-root'),
        armed: sc?.intro?.armed ?? null,
        phase: sc?.state?.phase ?? null,
      };
    }, track, SEED));
    await p2.evaluate(() => window.__DEBUG.goto('menu', {}));
  }
  await p2.close();

  // ── THE LATCH: a key pressed DURING the build must not take the card ──────
  // A blocked main thread queues input rather than dropping it, so every key a
  // child presses while the world is being built is delivered the instant the
  // build returns. The first version of this arming shipped as a decorative
  // flag — it armed the card synchronously at the end of the build, i.e. before
  // the queued key arrived — and a critic measured a Space pressed 250 ms into a
  // 2.5 s build destroying the card at 2558 ms with `armed === true`. Nothing
  // caught it, because every assertion read `armed` AFTER the build, where it is
  // true either way. So this presses a real key mid-build and asserts the CARD
  // SURVIVES, and then asserts a key after arming still works — because a
  // curtain a child cannot raise is worse than the freeze it replaced.
  const p3 = await browser.newPage();
  await p3.setViewport({ width: 1366, height: 768 });
  p3.on('pageerror', e => errs.push('PAGEERROR (latch): ' + e.message));
  await p3.goto('file://' + dist, { waitUntil: 'load', timeout: 90000 });
  await p3.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 90000 });
  // Track 1 on a fresh page: a genuinely cold build, so there is a real block to
  // press into. Not awaited — the point is to be typing while it runs.
  const building = p3.evaluate(async (seed) => {
    const t0 = performance.now();
    await window.__DEBUG.goto('race', { track: 1, introCard: true, seed, lang: 'he' });
    return performance.now() - t0;
  }, SEED);
  await new Promise(r => setTimeout(r, 300));
  await p3.keyboard.press('Space');            // queued behind the blocking build
  const buildMs = await building;
  await new Promise(r => setTimeout(r, 250));  // past the two arming frames
  latch = await p3.evaluate(() => ({
    survived: !!document.querySelector('.ic-root'),
    phase: window.__DEBUG.engine.active?.state?.phase ?? null,
    armed: window.__DEBUG.engine.active?.intro?.armed ?? null,
  }));
  latch.buildMs = buildMs;
  // …and now that it is armed, a key must still dismiss it.
  await p3.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 200));
  latch.dismissable = await p3.evaluate(() => !document.querySelector('.ic-root'));
  await p3.close();
} catch (e) {
  console.error('TRANSITIONTEST FAILED TO RUN:', e.message);
  process.exitCode = 2;
} finally {
  await browser.close();
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const f0 = n => (Number.isFinite(n) ? n.toFixed(0) : '—');
console.log(`\n  SCENE TRANSITIONS  ${QUALITY} tier, 1366x768, SwiftShader`);
console.log(`  warm budget ${BUDGET} ms   cold budget ${COLD_BUDGET} ms`);
console.log('  ' + '─'.repeat(76));
console.log('  transition                      cold block   warm block   (slower lap)   verdict');
const failures = [];
warm.forEach((w, i) => {
  const c = cold[i] || { block: NaN };
  const bad = w.block > BUDGET;
  const coldBad = c.block > COLD_BUDGET;
  if (bad) failures.push(`${w.name}: warm block ${f0(w.block)} ms > ${BUDGET} ms`);
  if (coldBad) failures.push(`${w.name}: cold block ${f0(c.block)} ms > ${COLD_BUDGET} ms`);
  console.log(`  ${w.name.padEnd(30)} ${f0(c.block).padStart(8)} ms ${f0(w.block).padStart(10)} ms ${f0(w.blockHi).padStart(12)} ms   ${bad || coldBad ? 'FAIL' : 'ok'}`);
});
if (warm.length) {
  const worst = warm.reduce((m, w) => (w.block > m.block ? w : m), warm[0]);
  console.log('  ' + '─'.repeat(76));
  console.log(`  worst warm transition: ${worst.name} at ${f0(worst.block)} ms — ${f0(BUDGET - worst.block)} ms of headroom`);
  if (caches && caches.heapWarm > 0) {
    console.log(`  JS heap: ${caches.heapCold.toFixed(1)} MB after the cold lap -> ${caches.heapWarm.toFixed(1)} MB after the warm lap`
      + (caches.heapTier > 0 ? ` -> ${caches.heapTier.toFixed(1)} MB after all three tiers` : ''));
    // The caches are bounded (4 skies, 12 sign placements, 24 audit keys) and
    // hold data, not scenes. A second identical lap must not grow the heap by
    // anything like the size of a scene.
    if (caches.heapWarm - caches.heapCold > HEAP_GROWTH_MB) {
      failures.push(`heap grew ${(caches.heapWarm - caches.heapCold).toFixed(1)} MB over an identical second lap (> ${HEAP_GROWTH_MB} MB) — a cache is unbounded`);
    }
  }
}

// THE STRONG ASSERTION. The three things Wave 5.1 stopped redoing on every
// scene entry each bump a counter when they actually run. The cold lap has
// already visited every screen and every track, so a warm lap that repeats the
// identical walk must bake NOTHING. This is exact and does not care how fast the
// machine is: remove any one of the caches and it goes red immediately.
if (bakes) {
  console.log('  ' + '─'.repeat(76));
  // The counters ARE the gate. A build where `globalThis.__PERFSTATS__` never
  // appeared is a build where the caches that bump them do not exist, so a
  // missing counter is a failure and not an excuse to skip the check — that is
  // exactly how this gate would have quietly passed against pre-fix code.
  if (bakes.cold.skyPaints === undefined) {
    failures.push('globalThis.__PERFSTATS__ is missing — the sky / signage / audit caches are not in this build');
  }
  console.log(`  bakes on the cold lap: ${bakes.cold.skyPaints} sky paints, ${bakes.cold.signSearches} signage searches, ${bakes.cold.trackAudits} track audits`);
  console.log(`  bakes on the warm lap: ${bakes.skyPaints} sky paints, ${bakes.signSearches} signage searches, ${bakes.trackAudits} track audits   (all must be 0)`);
  const LABELS = [['skyPaints', 'sky repaints (paintSky, 2.1 M px + dither)'],
    ['signSearches', 'signage occlusion searches (~560 ms each)'],
    ['trackAudits', 'track clearance audits (~210 ms each)']];
  for (const [k, label] of LABELS) {
    if (bakes[k] > 0) failures.push(`${bakes[k]} ${label} on a warm walk of screens already visited — the cache for it is gone`);
  }
  if (bakes.tier) {
    const t = bakes.tier;
    console.log(`  bakes on the tier lap (${t.tiers.join(' -> ')}, all already baked): ` +
      `${t.skyPaints} sky paints, ${t.signSearches} signage searches, ${t.trackAudits} track audits   (all must be 0)`);
    console.log('  worst block per tier: ' + t.worst.map(w => `${w.tier} ${f0(w.block)} ms (${w.name})`).join(', '));
    for (const [k, label] of LABELS) {
      if (t[k] > 0) failures.push(`${t[k]} ${label} while re-walking tiers that were already baked — a cache is capped below its key space and is thrashing`);
    }
  }
}
// ── THE PLAYER PATH ────────────────────────────────────────────────────────
// Everything above measures the harness path, where a race builds with nothing
// in front of it. This measures the path a child actually takes, and it is the
// one the Wave-6 brief set a target for: no perceived freeze on a first visit.
if (curtain.length) {
  console.log('  ' + '─'.repeat(76));
  console.log(`  player path, FIRST visit with the intro card up (budget ${CURTAIN_BUDGET} ms to the curtain)`);
  console.log('  track        to curtain   to first px    masked behind it   card   phase');
  for (const c of curtain) {
    const ok = c.cardUp && c.cardAt != null && c.cardAt <= CURTAIN_BUDGET
      && c.paintedAfterMount != null && c.paintedAfterMount <= CURTAIN_BUDGET;
    console.log(`  ${String(c.track).padEnd(12)} ${f0(c.cardAt).padStart(7)} ms ${f0(c.paintedAfterMount).padStart(11)} ms `
      + `${f0(c.blockTotal).padStart(15)} ms   ${c.cardUp ? 'up ' : 'NONE'}   ${c.phase}   ${ok ? '' : 'FAIL'}`);
    // THE STATE MUST HAVE BEEN REACHED. GAPS records that an assertion over a
    // sample set that was never populated is not an assertion — a run where the
    // card never mounted would otherwise sail through the timing checks below
    // with `cardAt === null`.
    if (!c.cardUp || c.cardAt == null) {
      failures.push(`track ${c.track}: the intro card never mounted on the player path — nothing was masked, and the timings below mean nothing`);
      continue;
    }
    if (c.phase !== 'intro') failures.push(`track ${c.track}: the race is in phase "${c.phase}" with the card up — the world is not frozen behind the curtain`);
    if (c.cardAt > CURTAIN_BUDGET) failures.push(`track ${c.track}: ${f0(c.cardAt)} ms of black screen before the curtain rose (> ${CURTAIN_BUDGET} ms) — work has moved in front of the card`);
    // THE ASSERTION THAT ACTUALLY MATTERS. Insertion is cheap and always fast;
    // what the child sees is the second presented frame after it. If the build
    // took the thread before the compositor got a turn, this is the length of
    // the unmasked freeze.
    if (c.paintedAfterMount == null) {
      failures.push(`track ${c.track}: the curtain was inserted but no frame was ever rendered with it — the child saw the previous screen for the whole build`);
    } else if (c.paintedAfterMount > CURTAIN_BUDGET) {
      failures.push(`track ${c.track}: ${f0(c.paintedAfterMount)} ms between mounting the curtain and the first frame rendered with it (> ${CURTAIN_BUDGET} ms) — the build is taking the thread before the child sees the card`);
    }
    // The card must be armed by the time the race exists, or a child is looking
    // at a curtain they cannot raise.
    if (c.armed !== true) failures.push(`track ${c.track}: the intro card is still unarmed after the build — the child cannot dismiss it (armed=${c.armed})`);
  }
  // ...and the mask must have masked something. See CURTAIN_MASKED_MIN.
  // `max`, not `min`, and deliberately: track 0's theme is already warm here
  // because the title screen's backdrop is a real race on it, so track 0
  // legitimately has almost nothing left to mask (measured at ~200 ms, which is
  // good news rather than a failure). What this checks is that AT LEAST ONE
  // track still had a real build behind the curtain — otherwise a race that
  // failed to build at all would read as a successful masking.
  if (latch) {
    console.log(`  latch: Space pressed 300 ms into a ${f0(latch.buildMs)} ms build -> `
      + `card ${latch.survived ? 'SURVIVED' : 'was destroyed'}, phase ${latch.phase}, armed ${latch.armed}`
      + `; a key after arming ${latch.dismissable ? 'dismisses it' : 'DOES NOT dismiss it'}`);
    if (latch.buildMs < CURTAIN_MASKED_MIN) {
      failures.push(`the latch probe only had ${f0(latch.buildMs)} ms of build to press into — it did not test anything`);
    }
    if (!latch.survived || latch.phase !== 'intro') {
      failures.push('a key pressed while the world was being built destroyed the intro card — the unarmed latch is inert, and a child who taps during the freeze loses the card unread');
    }
    if (!latch.dismissable) {
      failures.push('the intro card could not be dismissed after arming — a curtain a child cannot raise is worse than the freeze it replaced');
    }
  }
  const masked = Math.max(...curtain.map(c => c.blockTotal));
  console.log(`  longest build masked by the curtain (of the three): ${f0(masked)} ms`);
  if (masked < CURTAIN_MASKED_MIN) {
    failures.push(`no track had a build longer than ${f0(masked)} ms behind the curtain (< ${CURTAIN_MASKED_MIN} ms) — there was nothing to mask, so this section proved nothing`);
  }
}

if (errs.length) {
  console.error('\n  page errors / mismatches:');
  for (const e of errs.slice(0, 10)) console.error('   ' + e);
}
if (a.json) {
  mkdirSync(dirname(resolve(root, a.json)), { recursive: true });
  writeFileSync(resolve(root, a.json), JSON.stringify({ BUDGET, COLD_BUDGET, CURTAIN_BUDGET, QUALITY, cold, warm, curtain, latch, bakes, caches, errs }, null, 2));
}

if (!warm.length) {
  console.error('\n  TRANSITIONTEST: no measurements taken');
  process.exit(2);
}
if (failures.length || errs.length) {
  console.error('\n  TRANSITIONTEST FAILED');
  for (const f of failures) console.error('   ✗ ' + f);
  process.exit(1);
}
console.log('\n  TRANSITIONTEST PASSED — no transition blocks the main thread past the budget\n');

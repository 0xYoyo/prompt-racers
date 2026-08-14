// ─────────────────────────────────────────────────────────────────────────────
// IDLE GATE — "the home screen must cost nothing to leave open"
//
// Wave 5.1 item 3. The report was physical: the title screen starts cool and the
// fans on an M4 spin up after a few minutes of nobody touching anything. School
// hardware is weaker than that machine, and a classroom of laptops with the fans
// at full tilt is the first impression this game makes.
//
// Two independent failure shapes live behind that symptom, and this gate exists
// because BOTH are silent — nothing on screen changes, no test goes red, and the
// only witness is a fan and a battery meter:
//
//   1. THE IDLE FRAME IS NOT FREE. The home screen's backdrop is a live slice of
//      the oasis track (scenes.js). MEASURED before the fix: 552 draw calls and
//      1.2M triangles, presented 60 times a second, forever, behind a still
//      picture that is deliberately out of focus. So: presents are capped
//      (engine.draw honours a scene's `maxFps`), and this gate counts the
//      renderer's own calls over a real window driven by the engine's real loop.
//
//   2. SCENE RE-ENTRY LEAKS. Every hop between the title, racer select and the
//      collection used to build that entire race scene again and throw the old
//      one away — MEASURED at ~1.8s of work per hop under SwiftShader — and any
//      bus subscription, window listener or ResizeObserver that the teardown
//      missed accumulates one copy per hop for the rest of the session. So the
//      backdrop is now ONE instance, shared and refcounted, and this gate walks
//      20 scripted scene cycles asserting that everything countable comes back
//      to the same number: bus subscriptions, DOM listeners, ResizeObservers,
//      THREE geometries/textures/programs, DOM nodes, and the JS heap.
//
// HOW THE COUNTING WORKS. bus.js and addEventListener are wrapped FROM OUTSIDE,
// after boot, by identity: a Set of live handlers per event, added on `on` and
// removed on `off`. No product code is modified to be measurable, and the counts
// are of real registrations rather than of a number some module reports about
// itself.
//
// WHY THE SOAK IS COMPRESSED. Five real idle minutes is 18,000 frames of a race
// simulation, and a gate nobody runs is a gate that catches nothing. The soak
// therefore runs 5 minutes of SIMULATED time through the real update path
// (__DEBUG.advance(300) — the same fixed 1/60 steps the loop would have taken)
// plus a shorter window of REAL rAF frames, which is what actually exercises the
// present path, the timers and the DOM. Between them every per-frame allocation
// a five-minute idle would make is made here: 18,000 sim steps is not fewer
// steps than five minutes, it is the same steps without the waiting.
//
//   node tools/idletest.mjs [--dist path/to/index.html] [--cycles 20]
// ─────────────────────────────────────────────────────────────────────────────
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) a[k.slice(2)] = (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--')) ? true : process.argv[++i];
}
// --dist aims the gate at another built file, so the mutation runs that prove
// these assertions bite never leave a broken dist/ standing in a shared tree.
const dist = resolve(root, a.dist || 'dist/index.html');
const CYCLES = +(a.cycles || 20);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(dist)) { console.error('dist missing — npm run build'); process.exit(2); }

// The engine's own loop must run at a real frame rate for the present-count and
// the soak to mean anything, so this is a real (headless) compositor with
// --expose-gc, which is what makes the heap readings comparable rather than
// "whatever the collector felt like doing".
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars',
    '--mute-audio', '--js-flags=--expose-gc'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
page.setDefaultNavigationTimeout(120000);
page.setDefaultTimeout(120000);
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

let fails = 0;
const ok = (n, v, d = '') => {
  if (!v) fails++;
  console.log(`  ${v ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n.padEnd(64)} \x1b[2m${d}\x1b[0m`);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const evalp = (fn, ...x) => page.evaluate(fn, ...x);

await page.goto('file://' + dist, { waitUntil: 'load' });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 120000 });

/* ── instrumentation, from outside, by handler identity ──────────────────── */
await evalp(() => {
  const S = window.__IDLE__ = { bus: new Map(), dom: new Map(), ro: 0, renders: 0 };
  const set = (m, k) => { let v = m.get(k); if (!v) m.set(k, v = new Set()); return v; };
  const bus = window.__DEBUG.bus;
  const on = bus.on.bind(bus), off = bus.off.bind(bus);
  bus.on = (e, f) => { set(S.bus, e).add(f); return on(e, f); };
  bus.off = (e, f) => { S.bus.get(e)?.delete(f); return off(e, f); };
  for (const [target, tag] of [[window, 'win'], [document, 'doc']]) {
    const ael = target.addEventListener.bind(target), rel = target.removeEventListener.bind(target);
    target.addEventListener = (t, f, o) => { set(S.dom, tag + ':' + t).add(f); return ael(t, f, o); };
    target.removeEventListener = (t, f, o) => { S.dom.get(tag + ':' + t)?.delete(f); return rel(t, f, o); };
  }
  const RO = window.ResizeObserver;
  window.ResizeObserver = class extends RO {
    constructor(f) { super(f); S.ro++; }
    disconnect() { S.ro--; return super.disconnect(); }
  };
  // Every present the renderer performs, counted at the renderer itself — the
  // number the GPU and the fan actually see, not one the engine reports.
  const r = window.__DEBUG.engine.renderer;
  const real = r.render.bind(r);
  r.render = (...args) => { S.renders++; return real(...args); };
  // Timer callbacks that actually FIRE. A chained setTimeout or a forgotten
  // setInterval on an idle menu is the classic "it gets hot after a few
  // minutes" bug, and it is invisible to a gate that only counts allocations.
  S.timerTicks = 0;
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.setTimeout = (f, ms, ...rest) =>
    st(typeof f === 'function' ? (...a) => { S.timerTicks++; return f(...a); } : f, ms, ...rest);
  window.setInterval = (f, ms, ...rest) =>
    si(typeof f === 'function' ? (...a) => { S.timerTicks++; return f(...a); } : f, ms, ...rest);
  // …and DOM churn in the UI overlay, which is the half engine.js concedes
  // "animates at the full rate regardless" and which nothing else measures.
  S.mutations = 0;
  S.mo = new MutationObserver(recs => { S.mutations += recs.length; });
});

const snap = async () => {
  const s = await evalp(async () => {
    if (window.gc) { window.gc(); await new Promise(r => setTimeout(r, 50)); window.gc(); }
    const S = window.__IDLE__, e = window.__DEBUG.engine, m = e.renderer.info.memory;
    return {
      bus: [...S.bus.values()].reduce((n, v) => n + v.size, 0),
      busBy: [...S.bus].map(([k, v]) => [k, v.size]).filter(([, n]) => n > 0),
      dom: [...S.dom.values()].reduce((n, v) => n + v.size, 0),
      domBy: [...S.dom].map(([k, v]) => [k, v.size]).filter(([, n]) => n > 0),
      ro: S.ro,
      geometries: m.geometries, textures: m.textures,
      programs: e.renderer.info.programs?.length ?? -1,
      nodes: document.getElementsByTagName('*').length,
      quality: e.q.name, scene: e.activeName,
    };
  });
  return { ...s, heap: (await page.metrics()).JSHeapUsedSize };
};

const goto = async (scene, o = {}) => {
  const t0 = Date.now();
  await evalp((s, x) => window.__DEBUG.goto(s, x), scene, { lang: 'he', ...o });
  return Date.now() - t0;
};

/**
 * Drive `frames` frames of a 60Hz DISPLAY through the engine's own step+draw and
 * count how many of them the renderer actually PRESENTS.
 *
 * The display clock is virtualised, and that is the one liberty this gate takes:
 * SwiftShader cannot produce sixty real frames a second of a 552-draw-call race
 * scene — measured at 7-13 — so against a real clock a 30fps cap has nothing to
 * skip and would pass on a machine that never had it. `performance.now` is
 * therefore advanced by exactly one 60Hz frame per pumped frame, which is the
 * input a real display gives the cap. Everything downstream is the real thing:
 * engine.step, engine.draw, the scene's own `maxFps`, and renderer.render, which
 * is where the presents are counted.
 */
const observeIdle = async (frames = 180) => {
  const r = await evalp(async (n) => {
    const e = window.__DEBUG.engine, S = window.__IDLE__;
    const wasHeadless = e._headless;
    e._headless = false;
    S.renders = 0;
    const realNow = performance.now.bind(performance);
    let vt = realNow();
    const t0 = realNow();
    let busy = 0;
    performance.now = () => vt;
    try {
      for (let i = 0; i < n; i++) {
        vt += 1000 / 60;
        const a = realNow();
        e.step(1 / 60);
        e.draw();
        busy += realNow() - a;
        // Yield to the event loop every so often so the page stays responsive
        // and the GPU process is not starved into one enormous batch.
        if (i % 20 === 19) await new Promise(r => setTimeout(r, 0));
      }
    } finally {
      performance.now = realNow;
    }
    e._headless = wasHeadless;
    return { frames: n, renders: S.renders, busyMs: busy, wallMs: realNow() - t0 };
  }, frames);
  return { ...r, virtualSecs: r.frames / 60, rendersPerVirtualSec: r.renders / (r.frames / 60),
    presentRatio: r.renders / Math.max(1, r.frames), msPerPresent: r.busyMs / Math.max(1, r.renders) };
};

console.log(`\n  IDLE GATE — menu heat, scene-cycle leaks, hidden tab`);
console.log(`  ${a.dist ? a.dist : 'dist/index.html'}   ${CYCLES} cycles`);
console.log('  ' + '─'.repeat(78));

/* ── 1. the idle home screen is cheap ────────────────────────────────────── */
console.log('\n  1. the idle home screen');
await goto('menu');
await wait(400);
const base = await snap();
ok('the home screen is up', base.scene === 'menu', `q=${base.quality}`);

const idle = await observeIdle(180);
console.log(`      ${idle.frames} frames of a 60Hz display (${idle.virtualSecs.toFixed(1)}s) → ${idle.renders} presents, ${idle.msPerPresent.toFixed(1)}ms of work each`);
// THE assertion. The engine's loop runs at the display rate; what must not run
// at the display rate is the present of a 552-call race scene behind a static
// menu. 35/s leaves room for the odd extra frame and still fails hard at 60.
ok('the backdrop is presented at ~30fps, not at the display rate',
  idle.rendersPerVirtualSec <= 35, `${idle.rendersPerVirtualSec.toFixed(1)} presents per second of display time`);
ok('…which is at most every other frame of a 60Hz display',
  idle.presentRatio <= 0.6, `${idle.renders}/${idle.frames} frames presented (${(idle.presentRatio * 100).toFixed(0)}%)`);
// …and it is still a live picture, not a frozen one: a cap that presented
// nothing would pass every assertion above and ship a still image.
ok('…but it IS still animating (roughly half the frames, not none)',
  idle.presentRatio >= 0.3, `${idle.renders}/${idle.frames} frames presented`);

/* ── 2. the backdrop is ONE instance, reused ─────────────────────────────── */
console.log('\n  2. one backdrop, reused across screens — and released on the way out');
{
  const same = await evalp(async () => {
    const e = window.__DEBUG.engine;
    const a = e.active.scene;
    await window.__DEBUG.goto('collection', { lang: 'he' });
    const b = e.active.scene;
    await window.__DEBUG.goto('menu', { lang: 'he' });
    const c = e.active.scene;
    return { ab: a === b, ac: a === c, uuid: a.uuid };
  });
  ok('hopping menu → collection keeps the SAME backdrop scene object', same.ab, same.uuid);
  ok('…and hopping back does too (it is not rebuilt per screen)', same.ac);

  // The other half of the trade: it must NOT be immortal, or a race runs with a
  // second track and eight extra karts resident on the machine least able to
  // afford them. Asserted by IDENTITY rather than by renderer.info: GPU memory
  // counts what has been uploaded, and a scene the harness never renders reads
  // as zero whether it is alive or not.
  const kept = same.uuid;
  await goto('race', { track: 0, seed: 7 });
  await wait(300);
  const raced = await evalp(() => window.__DEBUG.engine.activeName);
  await goto('menu');
  await wait(300);
  const rebuilt = await evalp(() => window.__DEBUG.engine.active.scene.uuid);
  ok('leaving the menus for a race RELEASES it (coming back builds a new one)',
    raced === 'race' && rebuilt !== kept, `${kept.slice(0, 8)} → ${rebuilt.slice(0, 8)}`);
}

/* ── 3. twenty scene cycles: everything countable comes back ─────────────── */
console.log(`\n  3. ${CYCLES} scripted scene cycles`);
const CYCLE = ['select', 'collection', 'menu'];
const rows = [];
const gotos = [];
for (let i = 0; i < CYCLES; i++) {
  for (const s of CYCLE) gotos.push(await goto(s));
  await wait(60);
  rows.push(await snap());
}
const first = rows[0], mid = rows[Math.floor(CYCLES / 2)], last = rows.at(-1);
const med = arr => [...arr].sort((x, y) => x - y)[arr.length >> 1];
console.log(`      goto: median ${med(gotos)}ms, max ${Math.max(...gotos)}ms over ${gotos.length} navigations`);
console.log(`      heap: ${(first.heap / 1e6).toFixed(2)} → ${(mid.heap / 1e6).toFixed(2)} → ${(last.heap / 1e6).toFixed(2)} MB`);

// Steady state, not "never grows": the first cycles legitimately warm caches and
// compile shaders. What must not happen is a slope that keeps going.
const perCycle = (last.heap - mid.heap) / Math.max(1, CYCLES - Math.floor(CYCLES / 2) - 1);
ok('the JS heap reaches a steady state (second half grows < 250KB/cycle)',
  perCycle < 250e3, `${(perCycle / 1e3).toFixed(1)} KB/cycle over the last ${CYCLES - Math.floor(CYCLES / 2)} cycles`);
ok('…and never doubles across the whole run', last.heap < first.heap * 2,
  `${(first.heap / 1e6).toFixed(2)} → ${(last.heap / 1e6).toFixed(2)} MB`);

// The counts that a leak shows up in FIRST, and long before the heap moves: one
// missed unsubscribe is 8 bytes of heap and a permanent extra handler.
ok('bus subscriptions return to a steady count', last.bus === first.bus && last.bus === mid.bus,
  `${first.bus} → ${mid.bus} → ${last.bus}  ${JSON.stringify(last.busBy)}`);
ok('window/document listeners return to a steady count',
  last.dom === first.dom && last.dom === mid.dom,
  `${first.dom} → ${mid.dom} → ${last.dom}  ${JSON.stringify(last.domBy)}`);
ok('ResizeObservers return to a steady count', last.ro === first.ro && last.ro === mid.ro,
  `${first.ro} → ${mid.ro} → ${last.ro}`);
ok('THREE geometries return to a steady count', last.geometries === mid.geometries,
  `${first.geometries} → ${mid.geometries} → ${last.geometries}`);
ok('THREE textures return to a steady count', last.textures === mid.textures,
  `${first.textures} → ${mid.textures} → ${last.textures}`);
ok('compiled programs return to a steady count', last.programs === mid.programs,
  `${first.programs} → ${mid.programs} → ${last.programs}`);
ok('the DOM does not accumulate nodes', last.nodes <= first.nodes + 4,
  `${first.nodes} → ${last.nodes} elements`);
// Re-entry got cheap because the scene stopped being rebuilt; a regression that
// rebuilds it is visible here as seconds, in a place a human will read.
ok('a menu re-entry is fast (the backdrop is not rebuilt per screen)',
  med(gotos) < 400, `median ${med(gotos)}ms`);

/* ── 3b. re-entrant navigation: the double-click ─────────────────────────── */
//
// A scene factory is asynchronous and the race's takes ~1.8s under SwiftShader.
// Anything that fires a second navigation inside that window used to dispose the
// already-disposed old scene a second time AND orphan the scene the first call
// was building — MEASURED at menu bus handlers 10 → 37, permanently, per
// occurrence: one whole race scene's subscriptions, listeners and GPU resources,
// alive with nothing pointing at it. Sequential cycles cannot see this, which is
// exactly why it survived; these gotos are deliberately NOT awaited.
console.log('\n  3b. overlapping navigation (a double-click during a slow build)');
await goto('menu');
await wait(200);
const dbl0 = await snap();
for (let i = 0; i < 5; i++) {
  await evalp(async () => {
    const D = window.__DEBUG;
    const a = D.goto('race', { track: 0, seed: 5, lang: 'he' });   // slow factory
    const b = D.goto('menu', { lang: 'he' });                       // …superseded by this
    await Promise.all([a, b]);
  });
  await wait(120);
}
await goto('menu');
await wait(200);
const dbl1 = await snap();
ok('the last navigation wins (the screen is the one asked for last)',
  dbl1.scene === 'menu', dbl1.scene);
ok('5 overlapping navigations leak no bus subscriptions', dbl1.bus === dbl0.bus,
  `${dbl0.bus} → ${dbl1.bus}  ${JSON.stringify(dbl1.busBy)}`);
ok('…no window/document listeners', dbl1.dom === dbl0.dom,
  `${dbl0.dom} → ${dbl1.dom}  ${JSON.stringify(dbl1.domBy)}`);
ok('…no ResizeObservers', dbl1.ro === dbl0.ro, `${dbl0.ro} → ${dbl1.ro}`);
ok('…and no DOM nodes', dbl1.nodes <= dbl0.nodes + 2, `${dbl0.nodes} → ${dbl1.nodes}`);
ok('…and the heap comes back (< 4MB after five orphaned race builds)',
  dbl1.heap - dbl0.heap < 4e6, `${((dbl1.heap - dbl0.heap) / 1e6).toFixed(2)} MB`);

/* ── 4. the compressed idle soak ─────────────────────────────────────────── */
//
// TWO soaks, and the assertion is on the SECOND one. A first pass legitimately
// allocates: shaders compile, geometry uploads, and a decorative race fires
// effects it had not fired yet (measured: +7 geometries over the first five
// simulated minutes, then flat for the next twenty-five). "Grew at all" would
// therefore cry wolf, and a gate that cries wolf gets deleted. "Grew AGAIN, by
// the same amount, on an identical second pass" is the shape of a real leak, and
// it is the shape this asserts.
console.log('\n  4. idle soak — 2 x 5 simulated minutes + driven frames');
await goto('menu');
await wait(300);
await evalp(() => window.__DEBUG.advance(30));
await observeIdle(60);

const soak = async () => {
  const wall = await evalp(() => {
    const t = performance.now();
    window.__DEBUG.advance(300);          // 18,000 fixed 1/60 steps = 5 minutes
    return performance.now() - t;
  });
  const frames = await observeIdle(180);
  return { wall, frames };
};
const soak0 = await snap();
const s1 = await soak();
const soak1 = await snap();
const s2 = await soak();
const soak2 = await snap();
console.log(`      advance(300) = 18000 fixed steps in ${(s1.wall / 1000).toFixed(1)}s / ${(s2.wall / 1000).toFixed(1)}s wall`);
console.log(`      heap ${(soak0.heap / 1e6).toFixed(2)} → ${(soak1.heap / 1e6).toFixed(2)} → ${(soak2.heap / 1e6).toFixed(2)} MB`);

ok('ten simulated idle minutes leak no bus subscriptions',
  soak2.bus === soak0.bus && soak1.bus === soak0.bus, `${soak0.bus} → ${soak1.bus} → ${soak2.bus}`);
ok('…no window/document listeners',
  soak2.dom === soak0.dom && soak1.dom === soak0.dom, `${soak0.dom} → ${soak1.dom} → ${soak2.dom}`);
ok('…no ResizeObservers', soak2.ro === soak0.ro && soak1.ro === soak0.ro,
  `${soak0.ro} → ${soak1.ro} → ${soak2.ro}`);
ok('…and no DOM nodes', soak2.nodes <= soak0.nodes + 2,
  `${soak0.nodes} → ${soak1.nodes} → ${soak2.nodes}`);
// The slope, not the step: whatever the first five minutes allocated once, the
// second five must not allocate again.
ok('the SECOND five minutes allocate no further geometries or textures',
  soak2.geometries - soak1.geometries <= 2 && soak2.textures - soak1.textures === 0,
  `geo ${soak0.geometries}→${soak1.geometries}→${soak2.geometries}, tex ${soak0.textures}→${soak1.textures}→${soak2.textures}`);
ok('…and the heap does not slope either (< 3MB over the second soak)',
  soak2.heap - soak1.heap < 3e6, `${((soak2.heap - soak1.heap) / 1e6).toFixed(2)} MB`);
ok('…and the screen is still capped after ten minutes',
  s2.frames.presentRatio <= 0.6, `${s2.frames.renders}/${s2.frames.frames} frames presented`);

/* ── 4b. a REAL idle: wall-clock seconds, the real rAF loop ──────────────── */
//
// The compressed soak above buys sim steps cheaply, and that is all it buys.
// `__DEBUG.advance()` calls the scene's update() in a bare loop: it never calls
// engine.draw, and it passes ZERO wall time. So a regression whose cost is per
// PRESENT or per REAL SECOND — a forgotten setInterval, a chained setTimeout
// rotating a hint, an allocation inside the backdrop's render path — is
// invisible to it, and that is precisely the shape of the report this whole item
// came from: "minutes of idling ramp the fans". At 1KB per present a real
// five-minute idle allocates ~9MB and the compressed soak sees ~0.4MB of it.
//
// So one pass burns real seconds with the engine's own rAF loop, and measures
// the three things that only real time can show: presents, timer callbacks that
// actually fired, and DOM churn in the overlay.
//
// HOW SENSITIVE THIS IS, stated rather than implied: SwiftShader gives only
// ~30 real presents in 25s here (a real machine gives thousands), so anything
// measured PER PRESENT has almost no resolution and is reported rather than
// asserted. The sharp instruments in this pass are the ones that do not depend
// on the rasteriser at all and are exact counts rather than sampled sizes:
// timer callbacks that fired, DOM mutations, and live subscriptions/listeners.
console.log('\n  4b. a real idle — wall-clock seconds on the real loop');
await goto('menu');
await wait(300);
await observeIdle(60);            // warm: pay the first-frame uploads before measuring
const real0 = await snap();
const REAL_SECS = +(a.soak || 25);
const live = await (async () => {
  await evalp(() => {
    const e = window.__DEBUG.engine, S = window.__IDLE__;
    S.renders = 0; S.timerTicks = 0; S.mutations = 0;
    S.wasHeadless = e._headless;
    e._headless = false;          // hand the loop back to the engine, for real
    S.mo.observe(e.ui, { childList: true, subtree: true, attributes: true, characterData: true });
    S.t0 = performance.now();
  });
  await wait(REAL_SECS * 1000);
  return evalp(() => {
    const e = window.__DEBUG.engine, S = window.__IDLE__;
    const secs = (performance.now() - S.t0) / 1000;
    S.mo.disconnect();
    e._headless = S.wasHeadless;
    return { secs, renders: S.renders, timerTicks: S.timerTicks, mutations: S.mutations };
  });
})();
const real1 = await snap();
const grew = real1.heap - real0.heap;
console.log(`      ${live.secs.toFixed(1)}s idle: ${live.renders} real presents, ${live.timerTicks} timer callbacks, ${live.mutations} DOM mutations`);
console.log(`      heap ${(real0.heap / 1e6).toFixed(2)} → ${(real1.heap / 1e6).toFixed(2)} MB  (${(grew / Math.max(1, live.renders) / 1024).toFixed(2)} KB/present)`);

// Liveness only. The absolute number is a property of SwiftShader (it reaches
// 7-13 rAF/s on this scene, halved again by the cap); what matters here is that
// real frames really happened, so the per-second assertions below mean something.
ok('the engine\'s own loop really ran for real seconds', live.renders >= 15 && live.secs >= REAL_SECS - 2,
  `${live.renders} presents in ${live.secs.toFixed(1)}s`);
// KB/present is REPORTED, not asserted, and the reason is worth writing down:
// with ~30 real presents available here the number's denominator is far too
// small for its numerator (heap noise survives a forced GC at ~0.1-0.4MB), and
// it swung 0.3 → 10.5 KB/present across identical runs. A gate that flaky
// teaches people to re-run gates, which is the habit that lets a real failure
// through. What IS asserted is retained heap over real wall time — and retained
// is the right word: transient per-frame garbage is collected, so it shows up as
// GC pressure rather than growth, while the cost that made the fans audible is
// the present itself, which section 1 caps and asserts directly.
console.log(`      (informational) ${(grew / Math.max(1, live.renders) / 1024).toFixed(2)} KB retained per present — too few presents here to assert on`);
ok('…and the heap holds over real wall time (< 1MB)', grew < 1e6,
  `${(grew / 1e6).toFixed(2)} MB in ${live.secs.toFixed(0)}s`);
// A timer nobody cancelled is the classic "it gets hot after a few minutes".
// The idle menu should be running essentially none: CSS does its animation.
// MEASURED baseline: 11.1/s, and it is exactly one thing — the music
// sequencer's 90ms scheduling pump (audio.js `start()`), which stop() clears.
// The bound is set just above one pump, so a SECOND pump left running by a
// scene that did not stop its music — the most likely leak of this shape — puts
// it at 22/s and fails.
ok('an idle menu fires almost no timer callbacks (one music pump, no more)',
  live.timerTicks / live.secs < 15, `${(live.timerTicks / live.secs).toFixed(1)}/s (one pump = 11.1/s)`);
// The DOM half — the part engine.js concedes "animates at the full rate
// regardless". A CSS animation mutates nothing; a JS class-flipper or marquee
// shows up here and nowhere else.
ok('…and mutates almost no DOM', live.mutations / live.secs < 20,
  `${(live.mutations / live.secs).toFixed(1)} mutations/s`);
ok('…while leaking no subscriptions, listeners or observers over real time',
  real1.bus === real0.bus && real1.dom === real0.dom && real1.ro === real0.ro,
  `bus ${real0.bus}→${real1.bus}, dom ${real0.dom}→${real1.dom}, ro ${real0.ro}→${real1.ro}`);
// Deliberately NO geometry/texture assertion here. This pass runs straight after
// 18,000 simulated steps, and THREE counts a geometry when it is UPLOADED, not
// when it is created — so the first real presents afterwards flush whatever
// those steps created, and a rate measured across them cannot tell a flush from
// a leak (measured: +22 on a pass that is followed by a flat one). The
// geometry slope is section 4's job, where it is a like-for-like two-pass
// comparison. What this pass uniquely sees — presents, timers, mutations, heap
// per real second — is asserted above.
console.log(`      (informational) geo ${real0.geometries}→${real1.geometries}, tex ${real0.textures}→${real1.textures}`);

/* ── 5. a hidden tab costs nothing, and comes back on a clean clock ──────── */
console.log('\n  5. the hidden tab');
{
  // document.hidden cannot be produced headlessly, so it is emulated — but
  // everything downstream of it is real: the engine's own `visibilitychange`
  // listener, its own rAF loop, and a real second of wall time.
  const hidden = await evalp(async () => {
    const e = window.__DEBUG.engine, S = window.__IDLE__;
    let suspends = 0, resumes = 0;
    const offA = window.__DEBUG.bus.on('audio:suspend', () => suspends++);
    const offB = window.__DEBUG.bus.on('audio:resume', () => resumes++);
    e._headless = false;
    let hid = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hid });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hid ? 'hidden' : 'visible') });

    hid = true;
    document.dispatchEvent(new Event('visibilitychange'));
    const t0 = e.time, r0 = S.renders;
    await new Promise(r => setTimeout(r, 1200));
    const simWhileHidden = e.time - t0, drawsWhileHidden = S.renders - r0;
    const engineSaysHidden = e.hidden;

    // Come back after a long absence: the accumulator must not carry it.
    e._acc = 0.9;
    hid = false;
    document.dispatchEvent(new Event('visibilitychange'));
    const accAfter = e._acc;
    const t1 = e.time;
    await new Promise(r => setTimeout(r, 120));
    const catchUp = e.time - t1;

    offA(); offB();
    delete document.hidden; delete document.visibilityState;
    e._headless = true;
    return { simWhileHidden, drawsWhileHidden, engineSaysHidden, suspends, resumes, accAfter, catchUp };
  });
  ok('the engine hears the real visibilitychange', hidden.engineSaysHidden);
  ok('a hidden tab simulates nothing for 1.2 real seconds', hidden.simWhileHidden === 0,
    `${hidden.simWhileHidden.toFixed(3)}s of sim`);
  ok('…and draws nothing', hidden.drawsWhileHidden === 0, `${hidden.drawsWhileHidden} presents`);
  ok("…and suspends the audio exactly once", hidden.suspends === 1, `${hidden.suspends} suspends`);
  ok('coming back resumes the audio once', hidden.resumes === 1, `${hidden.resumes} resumes`);
  ok('…on a cleared accumulator', hidden.accAfter === 0, `_acc = ${hidden.accAfter}`);
  // The catch-up burst: 8 fixed steps is the engine's hard guard (D5/D11), and
  // 0.15s of game time in the first 120ms is well inside it.
  ok('…with no catch-up burst for the missing 1.2s', hidden.catchUp < 0.2,
    `${hidden.catchUp.toFixed(3)}s of sim in the first 120ms back`);
}

ok('no page errors', errs.length === 0, errs[0] || '');
console.log('\n  ' + '─'.repeat(78));
console.log(fails ? `  \x1b[31m${fails} FAILED\x1b[0m\n` : '  \x1b[32mthe idle screen is cheap and leaks nothing\x1b[0m\n');
await browser.close();
process.exit(fails ? 1 : 0);

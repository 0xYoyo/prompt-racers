// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE GATE (Wave 5, item 7)
//
// The bug class this exists to stop is not a crash — it is a budget quietly
// coming untethered from the quality tier. Every regression this file pins has
// actually happened in this codebase or in one exactly like it:
//
//   1. A tier knob that reads devicePixelRatio at MODULE LOAD, so no later
//      change of scale — a monitor swap, a browser zoom, a headless viewport
//      override — ever reaches the renderer.
//   2. A tier table whose fields are not monotonic, so "low" is somewhere
//      heavier than "medium" and nobody notices because both run on the
//      developer's machine.
//   3. A budget hardcoded as a constant instead of read from engine.q, which
//      makes the low tier a label rather than a saving. README's constraints
//      table promises the opposite in writing.
//   4. An automatic tier probe that overrules a tier the player chose by hand.
//   5. A backgrounded tab that keeps simulating, keeps the synth running, and
//      returns with a stalled clock to catch up on.
//
//   node tests/perf.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  TIERS, AUTO_TIER, PROBE, engine,
  effectivePixelRatio, tierFromFrameTime, resolveInitialTier, automationDetected,
} from '../src/core/engine.js';
import { bus } from '../src/core/bus.js';
import { save } from '../src/core/save.js';

// Enough of a 2D canvas for the procedural sprite atlases to run headless. They
// only ever read back an ImageData they wrote themselves, so nothing here has to
// rasterise anything — the assertion below is about pool CAPACITY, not pixels.
if (typeof document === 'undefined') {
  const imgData = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const ctx2d = () => ({
    createImageData: imgData, getImageData: (x, y, w, h) => imgData(w, h), putImageData() {},
    fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    moveTo() {}, lineTo() {}, closePath() {}, drawImage() {}, fillText() {},
    measureText: () => ({ width: 8 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  });
  globalThis.document = {
    createElement(tag) {
      const el = { tagName: String(tag).toUpperCase(), style: {}, width: 0, height: 0,
        appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {} };
      if (tag === 'canvas') el.getContext = ctx2d;
      return el;
    },
    addEventListener() {}, removeEventListener() {}, hidden: false,
  };
}
const { createEffects } = await import('../src/gfx/particles.js');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = p => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(62)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};

console.log('\n  PERFORMANCE GATE');
console.log('  ' + '─'.repeat(78));

// ── 1. the pixel-ratio cap ───────────────────────────────────────────────────
console.log('\n  \x1b[1mpixel ratio\x1b[0m');

ok('נמוך declares pixelRatio exactly 1', TIERS.low.pixelRatio === 1, `= ${TIERS.low.pixelRatio}`);
ok('גבוה caps pixelRatio at <= 1.5', TIERS.high.pixelRatio <= 1.5, `= ${TIERS.high.pixelRatio}`);
ok('no tier caps above 1.5',
  Object.values(TIERS).every(t => t.pixelRatio <= 1.5),
  Object.values(TIERS).map(t => `${t.name}:${t.pixelRatio}`).join(' '));

// נמוך is pinned at 1.0 on EVERY display, including a browser zoomed out below
// 1 — the low tier's contract is a fixed, predictable cost, not "whatever the
// window manager says".
ok('נמוך resolves to exactly 1.0 at dpr 0.5/1/2/3',
  [0.5, 1, 2, 3].every(d => effectivePixelRatio(TIERS.low, d) === 1),
  [0.5, 1, 2, 3].map(d => `${d}→${effectivePixelRatio(TIERS.low, d)}`).join(' '));
ok('גבוה resolves to 1.0 on a non-retina display', effectivePixelRatio(TIERS.high, 1) === 1);
ok('גבוה resolves to 1.5 (not 2) on a retina display', effectivePixelRatio(TIERS.high, 2) === 1.5);
ok('גבוה resolves to 1.5 on a 3x display', effectivePixelRatio(TIERS.high, 3) === 1.5);
ok('effectivePixelRatio survives a missing/garbage devicePixelRatio',
  effectivePixelRatio(TIERS.high, NaN) >= 1 && effectivePixelRatio(TIERS.high, 0) >= 1);

// The regression that motivated this: `pixelRatio: Math.min(devicePixelRatio||1, 2)`
// evaluated once, at import. Any read of devicePixelRatio inside the TIERS
// literal is that bug returning, whatever number it caps at.
const engineSrc = src('src/core/engine.js');
const tierBlock = engineSrc.slice(engineSrc.indexOf('export const TIERS'),
  engineSrc.indexOf('export function effectivePixelRatio'));
ok('the TIERS table itself reads no devicePixelRatio (resolved per-resize, not at load)',
  !/devicePixelRatio/.test(tierBlock));
ok('resize() re-resolves the pixel ratio',
  /resize\(\)\s*\{[\s\S]{0,600}?effectivePixelRatio\(this\.q\)/.test(engineSrc));

// ── 2. tier ordering ─────────────────────────────────────────────────────────
console.log('\n  \x1b[1mtier table\x1b[0m');

ok('shadows are OFF at נמוך', TIERS.low.shadows === false);
ok('shadows are ON at בינוני and גבוה', TIERS.medium.shadows === true && TIERS.high.shadows === true);
ok('נמוך disables antialias, reflections and grass', TIERS.low.antialias === false
  && TIERS.low.reflections === false && TIERS.low.grassBlades === 0);
ok('reflections (PMREM) are גבוה-only',
  TIERS.low.reflections === false && TIERS.medium.reflections === false && TIERS.high.reflections === true);

for (const k of ['drawDistance', 'propDensity', 'crowdDensity', 'particles', 'texSize', 'shadowSize', 'grassBlades']) {
  const [l, m, h] = [TIERS.low[k], TIERS.medium[k], TIERS.high[k]];
  ok(`${k} is strictly ordered low < medium < high`, l < m && m < h, `${l} < ${m} < ${h}`);
}

// ── 3. budgets read engine.q, not constants ──────────────────────────────────
// README's constraints table promises "all prop/particle/texture budgets read
// engine.q.*". A tier field nobody reads is a lie told in a table — so every
// knob must be consumed by at least one module that is not engine.js.
console.log('\n  \x1b[1mbudgets are wired to engine.q\x1b[0m');

const CONSUMERS = ['src/gfx/props.js', 'src/gfx/particles.js', 'src/gfx/sky.js', 'src/gfx/textures.js',
  'src/race/race.js', 'src/race/quiz.js', 'src/race/introcard.js', 'src/track/trackbuild.js',
  'src/kart/kartmodel.js', 'src/garage/garage.js'];
const consumerSrc = CONSUMERS.map(p => { try { return src(p); } catch { return ''; } }).join('\n');
for (const k of ['propDensity', 'crowdDensity', 'particles', 'texSize', 'shadowSize', 'drawDistance', 'shadows', 'reflections']) {
  const re = new RegExp(`(engine\\??\\.)?q\\.${k}\\b|engine\\.q\\.${k}\\b`);
  ok(`some module outside engine.js reads q.${k}`, re.test(consumerSrc));
}

// The functional half of the same claim: the particle system's pool capacity
// must actually scale with the tier, not merely mention it.
const fakeEngine = q => ({ q, ui: null });
const fx = {
  low: createEffects(fakeEngine(TIERS.low), { screen: false, events: false }),
  medium: createEffects(fakeEngine(TIERS.medium), { screen: false, events: false }),
  high: createEffects(fakeEngine(TIERS.high), { screen: false, events: false }),
};
const cap = t => fx[t].stats().capSoft + fx[t].stats().capGlow;
ok('particle pool capacity scales with the tier', cap('low') < cap('medium') && cap('medium') < cap('high'),
  `${cap('low')} < ${cap('medium')} < ${cap('high')}`);
ok('נמוך drops the rich particle families (speed lines / ambient dust)',
  fx.low.stats().rich === false && fx.high.stats().rich === true);
ok('the particle system is 2 draw calls at every tier',
  ['low', 'medium', 'high'].every(t => fx[t].stats().drawCalls === 2));
for (const t of Object.keys(fx)) fx[t].dispose();

// ── 4. the auto tier probe ───────────────────────────────────────────────────
console.log('\n  \x1b[1mauto tier probe\x1b[0m');

// Comments stripped: this file explains at length why the old heuristic was
// wrong, and a gate that cannot tell prose from code would fail on the
// explanation of its own existence.
const engineCode = engineSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
ok('the guess-probe is gone (no deviceMemory / hardwareConcurrency heuristic)',
  !/deviceMemory|hardwareConcurrency/.test(engineCode));
ok('a fast frame keeps גבוה', tierFromFrameTime(8) === 'high');
ok('a 25ms frame picks בינוני', tierFromFrameTime(25) === 'medium');
ok('a 50ms frame picks נמוך', tierFromFrameTime(50) === 'low');
ok('the thresholds are ordered and sane', PROBE.highMs < PROBE.mediumMs && PROBE.highMs >= 16);
ok('a nonsense measurement falls back to the fixed tier, never to a random one',
  tierFromFrameTime(NaN) === AUTO_TIER && tierFromFrameTime(0) === AUTO_TIER && tierFromFrameTime(-1) === AUTO_TIER);
ok('the probe window is cheap (< 100 frames total)',
  PROBE.warmupFrames + PROBE.sampleFrames < 100, `${PROBE.warmupFrames}+${PROBE.sampleFrames}`);
ok('the probe discards warm-up frames (shader compile is not the steady state)',
  PROBE.warmupFrames >= 10);

// A tier the player chose by hand must survive every later boot untouched.
ok("save 'auto' starts at the fixed tier and stays probe-eligible",
  resolveInitialTier('auto').name === AUTO_TIER && resolveInitialTier('auto').autoTier === true);
ok("no save at all behaves like 'auto'",
  resolveInitialTier(undefined).name === AUTO_TIER && resolveInitialTier(undefined).autoTier === true);
for (const t of ['low', 'medium', 'high']) {
  const r = resolveInitialTier(t);
  ok(`an explicit '${t}' reboots as '${t}' and is NOT probe-eligible`,
    r.name === t && r.autoTier === false);
}
ok('a corrupt saved tier falls back to the fixed tier, probe-eligible',
  resolveInitialTier('ultra').name === AUTO_TIER && resolveInitialTier('ultra').autoTier === true);

// Gates and previews must land on a FIXED tier. Under an automation harness the
// probe is never armed at all — a screenshot taken at a probed tier would read
// as a rendering regression in every other reviewer's diff.
ok('automation is detected, so gates/previews never get a probed tier',
  typeof automationDetected() === 'boolean'
  && /automationDetected\(\)/.test(engineSrc)
  && /this\.autoTier && !automationDetected\(\)/.test(engineSrc));

// ── 5. the hidden document ───────────────────────────────────────────────────
console.log('\n  \x1b[1mbackgrounded tab\x1b[0m');

// The singleton, with just enough stubbed around it to step. init() needs a real
// WebGL context, which node has not got — everything asserted below is reachable
// without one, which is the point of keeping the visibility path out of the
// renderer.
let updates = 0;
engine.active = { update() { updates++; }, scene: null, camera: null };
engine.paused = false;
engine.hidden = false;
engine._acc = 0;

const heard = [];
const offS = bus.on('audio:suspend', () => heard.push('suspend'));
const offR = bus.on('audio:resume', () => heard.push('resume'));

updates = 0;
engine.step(0.5);
const visibleSteps = updates;
ok('a visible engine steps', visibleSteps > 0, `${visibleSteps} steps`);

engine.setHidden(true);
ok("hiding the document emits 'audio:suspend'", heard.at(-1) === 'suspend');
updates = 0;
engine.step(0.5);
ok('a hidden engine runs no simulation steps at all', updates === 0, `${updates} steps`);

engine._acc = 0.9;
engine.setHidden(false);
ok("showing the document emits 'audio:resume'", heard.at(-1) === 'resume');
ok('resuming clears the accumulator — no stalled time to catch up on', engine._acc === 0,
  `_acc = ${engine._acc}`);
ok('setHidden is idempotent (no duplicate suspend/resume storms)',
  (() => { const n = heard.length; engine.setHidden(false); engine.setHidden(false); return heard.length === n; })());

// D5/D11: the fixed-timestep accumulator must bound catch-up. MAX_FRAME clamps
// one frame; the 8-step guard is what actually bounds a stall, and it has to
// hold on the frame right after a tab comes back.
updates = 0;
engine.step(10);
ok('a 10s stall cannot fire an unbounded burst of fixed steps', updates <= 8, `${updates} steps (guard 8)`);
ok('the loop skips work while hidden and keeps _last current',
  /if \(this\.hidden\) \{ this\._last = now; return; \}/.test(engineSrc));
ok('the visibility listener is removed on teardown',
  /removeEventListener\('visibilitychange', this\._onVisibility\)/.test(engineSrc));

offS(); offR();
engine.active = null;

// ── 6. an explicit choice is persisted as a tier, never as 'auto' ────────────
console.log('\n  \x1b[1msettings override\x1b[0m');

save._replace({ quality: 'auto' });
engine.autoTier = true;
engine._probe = { warm: 1, samples: [] };
engine.renderer = { setPixelRatio() {}, getPixelRatio: () => 1, setSize() {}, shadowMap: {} };
engine.el = { clientWidth: 800, clientHeight: 600 };
engine.setQuality('low');
ok("choosing a tier writes that tier (not 'auto') to the save", save.read('quality') === 'low');
ok('choosing a tier ends the probe for this session', engine._probe === null);
ok('choosing a tier clears autoTier, so no later boot re-probes', engine.autoTier === false);
ok('the chosen tier reboots unchanged', resolveInitialTier(save.read('quality')).name === 'low');
save._replace({ quality: 'auto' });

console.log('\n  ' + '─'.repeat(78));
console.log(failed ? `  \x1b[31m${failed} FAILED\x1b[0m\n` : '  \x1b[32mall performance invariants hold\x1b[0m\n');
process.exit(failed ? 1 : 0);

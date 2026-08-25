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
//   4. An automatic tier probe that overrules a tier the player chose by hand,
//      or one that reaches גבוה on its own (Wave 5.1: auto tops out at בינוני).
//   5. A backgrounded tab that keeps simulating, keeps the synth running, and
//      returns with a stalled clock to catch up on.
//
//   node tests/perf.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import {
  TIERS, AUTO_TIER, AUTO_START_TIER, AUTO_MAX_TIER, PROBE, engine,
  effectivePixelRatio, tierFromFrameTime, resolveInitialTier,
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
    // section 7 rasterises the kart's number-plate texture headlessly
    arcTo() {}, strokeText() {}, strokeRect() {}, rect() {},
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
const mainSrc = src('src/main.js');
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
ok('a fast frame keeps בינוני', tierFromFrameTime(8) === 'medium');
ok('a 25ms frame keeps בינוני', tierFromFrameTime(25) === 'medium');
ok('a 50ms frame picks נמוך', tierFromFrameTime(50) === 'low');
ok('the threshold is sane (~30fps at בינוני)', PROBE.mediumMs >= 20 && PROBE.mediumMs <= 40,
  `${PROBE.mediumMs}ms`);
ok('a nonsense measurement falls back to the auto START tier, never to a random one',
  tierFromFrameTime(NaN) === AUTO_START_TIER && tierFromFrameTime(0) === AUTO_START_TIER
  && tierFromFrameTime(-1) === AUTO_START_TIER);

// ── the Wave 5.1 policy: automatic detection tops out at בינוני ──────────────
//
// The bug this forbids is not a crash either — it is a strong laptop being
// handed גבוה, running the fans up in a classroom, and (worse) a session that
// starts on גבוה and drops a second later IN FRONT OF THE CHILD, shadows and
// reflections popping off as if something had broken. Four assertions, because
// each fails to a different plausible way of reintroducing it: the pure
// function; the whole reachable input domain of that function; the tier an auto
// session actually BOOTS at; and the player's own choice, which must still win.
console.log('\n  \x1b[1mauto never reaches גבוה (Wave 5.1)\x1b[0m');

ok('the auto ceiling is בינוני, and it is below גבוה',
  AUTO_MAX_TIER === 'medium' && TIERS[AUTO_MAX_TIER].drawDistance < TIERS.high.drawDistance,
  `${AUTO_MAX_TIER}`);
// Every frame time a real machine can produce, plus the garbage. 800 samples is
// a sweep, not a spot check: a threshold table that grows a `high` branch again
// is caught wherever that branch sits.
const sweep = [NaN, Infinity, -Infinity, 0, -1, -0.0001];
for (let ms = 0.1; ms <= 400; ms += 0.5) sweep.push(ms);
const promoted = sweep.filter(ms => tierFromFrameTime(ms) === 'high');
ok('tierFromFrameTime can NEVER return high, at any frame time',
  promoted.length === 0, `${promoted.length}/${sweep.length} inputs promoted (${promoted.slice(0, 4).join(', ')})`);
ok('…and it always returns a tier that exists',
  sweep.every(ms => !!TIERS[tierFromFrameTime(ms)]));
ok('a probing (auto) boot starts at בינוני, not גבוה',
  resolveInitialTier('auto', { probing: true }).name === AUTO_START_TIER
  && AUTO_START_TIER !== 'high',
  resolveInitialTier('auto', { probing: true }).name);
ok('…so does a boot with no save at all',
  resolveInitialTier(undefined, { probing: true }).name === AUTO_START_TIER);
ok('…and a corrupt saved tier',
  resolveInitialTier('ultra', { probing: true }).name === AUTO_START_TIER);
// The other half of the policy: גבוה is still REACHABLE, by hand, forever.
ok("an explicit 'high' still resolves to high even on a probing boot",
  resolveInitialTier('high', { probing: true }).name === 'high'
  && resolveInitialTier('high', { probing: true }).autoTier === false);
// enableQualityProbe() is what applies the start tier, so that a gate — which
// never calls it — keeps landing on the fixed AUTO_TIER. Asserted on the source,
// because the alternative regression (moving it into init()) is invisible to any
// unit that has no WebGL context to init against.
ok('the auto start tier is applied when the PROBE is armed, not in init()',
  /enableQualityProbe\(\)\s*\{[\s\S]{0,900}?resolveInitialTier\([\s\S]{0,80}?probing:\s*true/.test(engineSrc)
  && !/init\(mountEl\)\s*\{[\s\S]{0,400}?probing:\s*true/.test(engineSrc));

// THE COMPATIBILITY ASSERTION. Gates, previews and the capture harness must keep
// rendering at the tier every screenshot baseline in this repo was captured at.
// They get it because they never arm the probe — and, since Wave 5.1, because
// the harness says so explicitly instead of inheriting it (core/harness.js).
const harnessSrc = src('src/core/harness.js');
ok('a NON-probing boot still lands on the historical fixed tier',
  resolveInitialTier('auto').name === AUTO_TIER && AUTO_TIER === 'high',
  `${resolveInitialTier('auto').name}`);
ok('…the harness pins that same tier by name, at its own call site',
  /HARNESS_TIER\s*=\s*AUTO_TIER/.test(harnessSrc) && /pinQuality\(HARNESS_TIER\)/.test(harnessSrc));
ok('…and pinning records no player choice (the save is untouched)',
  !/pinQuality\(name\)\s*\{[\s\S]{0,400}?save\.set/.test(engineSrc));
ok('…but a run that asked for a tier of its own keeps it',
  /engine\.autoTier/.test(harnessSrc) && /if \(o\.quality\) engine\.setQuality\(o\.quality\)/.test(harnessSrc));
ok('the probe window is cheap (< 100 frames total)',
  PROBE.warmupFrames + PROBE.sampleFrames < 100, `${PROBE.warmupFrames}+${PROBE.sampleFrames}`);
ok('the probe discards warm-up frames (shader compile is not the steady state)',
  PROBE.warmupFrames >= 10);

// A tier the player chose by hand must survive every later boot untouched.
ok("save 'auto' starts at the fixed tier (non-probing) and stays probe-eligible",
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

// Gates and previews must land on a FIXED tier — a screenshot taken at a probed
// tier reads as a rendering regression in every other reviewer's diff. The way
// that is guaranteed is the thing to assert: the probe is OPT-IN, armed only by
// an explicit `enableQualityProbe()`, never by `init()` and never by sniffing
// for a test harness. Three assertions, because each fails to a different
// plausible mistake:
//   * init() must not arm it        — the regression that reintroduces the leak
//   * no navigator.webdriver sniff  — the D35 mechanism, rejected here too
//   * main.js must actually call it — or production silently never probes
ok('init() does not arm the probe — it is opt-in',
  !/this\._probe\s*=\s*\{[^}]*\}/.test(engineSrc.split('enableQualityProbe')[0].split('init(mountEl)')[1] || ''));
// Comments are stripped first: the note above AUTO_TIER explains at length WHY
// there is no webdriver sniff, and an assertion that cannot tell the explanation
// from the thing explained would forbid documenting the decision.
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('the probe does not sniff for an automation harness (D35)',
  !/navigator\s*\.\s*webdriver/.test(stripComments(engineSrc)));
ok('…and the production entry point is what arms it',
  /engine\.enableQualityProbe\(\)/.test(mainSrc));

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

// ── the probe, driven frame by frame ────────────────────────────────────────
// The assertions above are about pure functions; this one drives the real loop
// hook, because the policy has to hold in the object a child actually runs, and
// the two ways it could break there are both invisible to a pure function: an
// auto session that boots on גבוה before the probe has measured anything, and a
// fast machine promoted back up once it has.
const armed = () => {
  engine.autoTier = true;
  engine._headless = false;
  engine.hidden = false;
  engine.q = TIERS.high;                 // whatever init() left behind
  engine.probedFrameMs = 0;
  engine.enableQualityProbe();
  return engine;
};
const runProbe = ms => {
  armed();
  const start = engine.q.name;
  for (let i = 0; i < PROBE.warmupFrames + PROBE.sampleFrames; i++) engine._probeFrame(ms / 1000);
  return { start, end: engine.q.name };
};
const fast = runProbe(6), slow = runProbe(60), edge = runProbe(PROBE.mediumMs - 1);
ok('arming the probe drops an auto session to בינוני before the first frame',
  fast.start === AUTO_START_TIER, `started at ${fast.start}`);
ok('a fast machine is NOT promoted to גבוה by the probe', fast.end === AUTO_MAX_TIER,
  `6ms frames → ${fast.end}`);
ok('…nor by a frame time right on the threshold', edge.end === AUTO_MAX_TIER,
  `${PROBE.mediumMs - 1}ms frames → ${edge.end}`);
ok('a machine that cannot hold בינוני IS dropped to נמוך', slow.end === 'low',
  `60ms frames → ${slow.end}`);
ok('…and the probe reports what it measured', engine.probedFrameMs > 0,
  `${engine.probedFrameMs.toFixed(1)}ms`);
// The player's choice still ends it, exactly as before.
armed();
engine.setQuality('high');
for (let i = 0; i < 200; i++) engine._probeFrame(0.5);
ok("a hand-picked גבוה survives 200 slow frames (the probe is over)",
  engine.q.name === 'high' && engine._probe === null && engine.autoTier === false,
  `q=${engine.q.name}`);
// …and arming the probe again in that session must not undo it.
engine.enableQualityProbe();
ok('…and re-arming does nothing once a tier was chosen by hand',
  engine.q.name === 'high' && engine._probe === null);
save._replace({ quality: 'auto' });
engine.autoTier = true;
engine._probe = null;
engine._headless = false;

// ── 7. the AI kart LOD (Wave 5) ──────────────────────────────────────────────
//
// Eight karts were measured at 95% of the frame's draw calls, and the cheap
// build that was supposed to prevent that reduced NOTHING: race.js asks for it
// with `lod: 1`, a number, and every test inside createKart is a string compare
// against 'low'. `1 === 'low'` is false, so each "cheap" opponent was built at
// MID detail — 235 meshes against the player's own 144 at the נמוך tier — and
// no test anywhere compared the two builds, which is why it survived a wave.
//
// So the assertions below are, in order: the numeric LOD resolves; the cheap
// build is MATERIALLY cheaper than the full one (the missing assertion); it is
// under an absolute bound with margin; the PLAYER's kart is never reduced or
// welded; the weld is lossless (same triangles, same vertices, same materials);
// setParts on a welded kart still produces the right kart; and the things that
// have to keep moving — wheels, steering, body roll — survived the weld.
console.log('\n  \x1b[1mAI kart LOD\x1b[0m');

const KM = await import('../src/kart/kartmodel.js');
const eng = t => ({ q: TIERS[t] });
const P2 = { engine: 2, tires: 2, wing: 2, chassis: 2, exhaust: 2 };

function census(kart) {
  let meshes = 0, tris = 0, verts = 0, welds = 0;
  const mats = new Set();
  kart.group.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    if (o.name === 'weld') welds++;
    const m = o.material;
    // EVERY field that changes how the material renders belongs in this signature.
    // It used to stop at opacity/map, which let a weld that quietly substituted a
    // CLONE — same colour, envMapIntensity zeroed, so noticeably duller bodywork
    // and a per-kart material dispose() never frees — pass as "substitutes no
    // material". The chrome on this kart is 90% envMap.
    mats.add([m.type, m.color.getHexString(), m.roughness, m.metalness,
      m.emissive?.getHexString() ?? '-', m.emissiveIntensity, m.envMapIntensity,
      m.flatShading, m.side, m.transparent, m.opacity, m.depthWrite, m.alphaTest,
      m.map ? 'map' : '-'].join('|'));
    const g = o.geometry;
    const t = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
    tris += t * (o.isInstancedMesh ? o.count : 1);
    verts += g.attributes.position ? g.attributes.position.count : 0;
  });
  return { meshes, tris: Math.round(tris), verts, welds, mats: [...mats].sort() };
}

ok('a numeric lod resolves to the cheap build (1 → low)', KM.normalizeLod(1) === 'low',
  `normalizeLod(1) = ${JSON.stringify(KM.normalizeLod(1))}`);
ok('lod 0 means "no override" — the tier decides', KM.normalizeLod(0) === null);
ok('a string lod still works', KM.normalizeLod('low') === 'low' && KM.normalizeLod('junk') === null);

// The kart race.js actually builds for an opponent at נמוך, and the player's.
const aiLow = KM.createKartLOD({ engine: eng('low'), parts: P2, lod: 1 });
const playerLow = KM.createKart({ engine: eng('low'), parts: P2 });
const playerHigh = KM.createKart({ engine: eng('high'), parts: P2 });
const cAi = census(aiLow), cPlayerLow = census(playerLow), cPlayerHigh = census(playerHigh);

// THE assertion nothing had. Whatever the numbers become, the cheap build must
// stay dramatically cheaper than the full one, or it is not a LOD.
ok('createKartLOD(lod:1) draws less than HALF the meshes of createKart',
  cAi.meshes * 2 < cPlayerHigh.meshes,
  `${cAi.meshes} vs ${cPlayerHigh.meshes} meshes`);
ok('…and less than half of the PLAYER\'s kart at the same נמוך tier',
  cAi.meshes * 2 < cPlayerLow.meshes, `${cAi.meshes} vs ${cPlayerLow.meshes}`);

// An absolute ceiling with real margin (measured: 50 at parts tier 2, 64 at the
// hero tier). Seven opponents live under this number.
let worstLod = 0;
for (let t = 0; t < 4; t++) {
  const k = KM.createKartLOD({ engine: eng('low'), lod: 1,
    parts: { engine: t, tires: t, wing: t, chassis: t, exhaust: t } });
  worstLod = Math.max(worstLod, census(k).meshes);
  k.dispose();
}
ok('an opponent is under 90 draw calls at every part tier', worstLod <= 90, `worst = ${worstLod}`);

// The player's kart is the game's hero art and is on screen at 3–8 m in every
// frame. It must not be reduced, and it must never be welded — a welded kart
// cannot have one slot swapped, which is the whole garage.
ok('the player\'s kart keeps its full detail at גבוה', cPlayerHigh.meshes >= 200, `${cPlayerHigh.meshes} meshes`);
ok('the player\'s kart keeps its נמוך detail (the LOD did not leak into it)',
  cPlayerLow.meshes >= 140, `${cPlayerLow.meshes} meshes`);
ok('no kart built by createKart is ever welded',
  cPlayerLow.welds === 0 && cPlayerHigh.welds === 0,
  `${cPlayerLow.welds}/${cPlayerHigh.welds} welded meshes`);
ok('the opponent IS welded', cAi.welds > 0, `${cAi.welds} welded meshes`);

// Lossless: the weld may change how many buffers are bound and nothing else.
// The twin is the same build with the weld switched off.
const aiTwin = KM.createKart({ engine: eng('low'), parts: P2, lod: 'low', shadows: false, plates: true, merge: false });
const cTwin = census(aiTwin);
ok('the weld keeps every triangle', cAi.tris === cTwin.tris, `${cAi.tris} vs ${cTwin.tris}`);
ok('the weld keeps every vertex', cAi.verts === cTwin.verts, `${cAi.verts} vs ${cTwin.verts}`);
ok('the weld substitutes no material',
  cAi.mats.length === cTwin.mats.length && cAi.mats.every((m, i) => m === cTwin.mats[i]),
  `${cAi.mats.length} vs ${cTwin.mats.length} distinct materials`);

// …and the assertion all of the above was missing. Triangles, vertices and
// materials are QUANTITIES the weld cannot change even when it is broken: the
// weld's whole job is to bake each mesh's world transform into its vertices, so
// the thing that can actually go wrong is WHERE those vertices land and WHICH WAY
// they face. Two classic weld bugs used to pass this section 18/18 green:
//   * skip applyMatrix4 for an item whose local offset looks like a no-op → every
//     wheel collapses onto the kart's centre line as a black slab through the
//     bodywork (4.97% of the pixels in a rear shot)
//   * transform the positions but flip a normal's Y → the shading inverts, chrome
//     goes matte and the paint lights from below (7.5% of the pixels)
// So: sample every vertex of the welded kart and of its unwelded twin in WORLD
// space and require the two point clouds to be the same multiset — every vertex
// of one matched, one-for-one, to a vertex of the other within 10 µm of position
// and 0.001 of normal. Order-independent (the weld concatenates in bucket order)
// and tolerance-correct, which a quantised hash is NOT: welding re-associates the
// matrix multiplies, which moves a vertex by up to ~5e-8 m, and this kart's
// coordinates are round numbers that sit exactly ON a quantiser's boundary — 1852
// of 72766 vertices flip cell there, for a difference of 53 nanometres. A gate
// that cries wolf gets deleted; this one only fires on real movement.
function worldVerts(kart) {
  kart.group.updateMatrixWorld(true);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  const box = new THREE.Box3(), c = new THREE.Vector3();
  const rows = [];
  kart.group.traverse(o => {
    // InstancedMesh (the tread blocks) is never welded — visit() keeps it out, and
    // the mesh census asserts that separately.
    if (!o.isMesh || o.isInstancedMesh) return;
    const g = o.geometry, p = g?.attributes?.position;
    if (!p) return;
    const na = g.attributes.normal;
    nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      if (na) n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); else n.set(0, 0, 0);
      box.expandByPoint(v);
      c.add(v);
      rows.push([v.x, v.y, v.z, n.x, n.y, n.z]);
    }
  });
  c.divideScalar(rows.length || 1);
  return { rows, box, centroid: c };
}
// Unmatched vertices of `b`, hashed into 1 mm cells and matched against the 27
// neighbouring cells so a vertex on a cell boundary still finds its partner.
function vertexMismatch(a, b, posTol = 1e-5, norTol = 1e-3) {
  const cells = new Map();
  const ci = x => Math.round(x * 1000);
  for (const r of a.rows) {
    const k = `${ci(r[0])},${ci(r[1])},${ci(r[2])}`;
    let arr = cells.get(k); if (!arr) cells.set(k, arr = []);
    arr.push(r);
  }
  let miss = 0;
  for (const r of b.rows) {
    const x = ci(r[0]), y = ci(r[1]), z = ci(r[2]);
    let hit = null;
    search:
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = cells.get(`${x + dx},${y + dy},${z + dz}`);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (Math.abs(s[0] - r[0]) <= posTol && Math.abs(s[1] - r[1]) <= posTol && Math.abs(s[2] - r[2]) <= posTol
          && Math.abs(s[3] - r[3]) <= norTol && Math.abs(s[4] - r[4]) <= norTol && Math.abs(s[5] - r[5]) <= norTol) {
          hit = arr; arr.splice(i, 1); break search;
        }
      }
    }
    if (!hit) miss++;
  }
  return miss;
}

const wAi = worldVerts(aiLow), wTwin = worldVerts(aiTwin);
const missAi = vertexMismatch(wAi, wTwin);
ok('every welded vertex lands where the unwelded one did (position + normal)',
  missAi === 0, `${missAi}/${wTwin.rows.length} vertices moved or flipped`);
const near = (a, b) => Math.abs(a - b) < 1e-4;
ok('…and the welded kart fills exactly the same world box',
  ['x', 'y', 'z'].every(k => near(wAi.box.min[k], wTwin.box.min[k]) && near(wAi.box.max[k], wTwin.box.max[k]))
  && ['x', 'y', 'z'].every(k => near(wAi.centroid[k], wTwin.centroid[k])),
  `centroid ${wAi.centroid.toArray().map(n => n.toFixed(4)).join(',')}`);

// A weld that BAKES a hidden mesh is the same bug wearing a different hat: the
// original is detached, the copy is stuck invisible, and update() then toggles an
// orphan. Nothing on a still frame changes, which is exactly why it needs a gate.
let weldedInvisible = 0;
aiLow.group.traverse(o => { if (o.isMesh && o.name === 'weld' && !o.visible) weldedInvisible++; });
ok('no welded mesh is baked invisible (the hidden-mesh trap)', weldedInvisible === 0,
  `${weldedInvisible} invisible welds`);

// The behavioural half: the exhaust flame starts hidden and update() shows it.
// If the weld swallowed or orphaned it, the kart can never light it again.
const boostKart = KM.createKartLOD({ engine: eng('low'), lod: 1, parts: P2 });
const visibleMeshes = k => { let n = 0; k.group.traverse(o => { if (o.isMesh && o.visible) n++; }); return n; };
const idleVis = visibleMeshes(boostKart);
for (let i = 0; i < 30; i++) boostKart.update(1 / 60, { steer: 0, speed01: 1, drifting: false, driftCharge01: 1, airborne: false, boosting: true });
ok('a welded kart can still light its exhaust flame (the registry is attached)',
  visibleMeshes(boostKart) > idleVis, `${idleVis} → ${visibleMeshes(boostKart)} visible meshes`);

// Every material a welded kart draws with must be one the kart OWNS, or dispose()
// leaks it — seven opponents rebuilt per race. Patching dispose() on each material
// in use catches a clone the weld introduced behind the constructor's back.
const leakKart = KM.createKartLOD({ engine: eng('low'), lod: 1, parts: P2 });
const inUse = new Set();
leakKart.group.traverse(o => { if (o.isMesh && o.material) inUse.add(o.material); });
const freed = new Set();
for (const m of inUse) { const d = m.dispose.bind(m); m.dispose = () => { freed.add(m); d(); }; }
leakKart.dispose();
ok('dispose() frees every material the welded kart draws with (no cloned leak)',
  freed.size === inUse.size, `${freed.size}/${inUse.size} freed`);

// P1: the low build's tyre must still read as a TYRE at 3.5 m — the distance a
// rival sits at on the standing start of every race. Count the distinct facet
// angles around the outer profile of a welded wheel: an 8-gon is a flat black
// octagon 150 px across, which is what round 1 shipped.
const outerFacets = w => {
  const angles = new Set();
  const pts = [];
  w.visual.updateMatrixWorld(true);
  w.visual.traverse(o => {
    const p = o.geometry?.attributes?.position;
    if (!o.isMesh || o.isInstancedMesh || !p) return;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); pts.push([Math.hypot(v.y, v.z), Math.atan2(v.z, v.y)]); }
  });
  const maxR = Math.max(...pts.map(p => p[0]));
  for (const [r, a] of pts) if (r > maxR * 0.97) angles.add(Math.round(a * 200));
  return angles.size;
};
const facets = Math.min(...aiLow.wheels.map(outerFacets));
ok('the cheap kart\'s tyre is still round at 3.5 m (>= 12 facets, not an octagon)',
  facets >= 12, `${facets} facets on the outer profile`);

// P4: the player is the only kart the chase camera stares at all race, and it was
// the only kart with blank plate mounts at נמוך.
const plateMeshes = k => { let n = 0; k.group.traverse(o => { if (o.isMesh && o.material?.map) n++; }); return n; };
ok('the player\'s kart carries its number plates at נמוך too',
  plateMeshes(playerLow) >= 3, `${plateMeshes(playerLow)} plate meshes`);
ok('…and at גבוה', plateMeshes(playerHigh) >= 3, `${plateMeshes(playerHigh)} plate meshes`);

// ── the weld WITHOUT the detail drop ────────────────────────────────────────
// The two halves of createKartLOD are independent, and this is the combination
// that matters at בינוני/גבוה, where there are draw calls to spare but no art to
// spare: the full-detail kart, welded. Supported only if it is gated — same
// triangles, same vertices, same materials, same vertex positions as the player's
// own kart, materially fewer meshes.
const weldHigh = KM.createKartLOD({ engine: eng('high'), parts: P2, lod: 'high', merge: true, shadows: true });
const cWeldHigh = census(weldHigh);
ok('{lod:high, merge:true} keeps every triangle and vertex of the full kart',
  cWeldHigh.tris === cPlayerHigh.tris && cWeldHigh.verts === cPlayerHigh.verts,
  `${cWeldHigh.tris}t/${cWeldHigh.verts}v vs ${cPlayerHigh.tris}t/${cPlayerHigh.verts}v`);
ok('…substitutes no material either',
  cWeldHigh.mats.length === cPlayerHigh.mats.length && cWeldHigh.mats.every((m, i) => m === cPlayerHigh.mats[i]),
  `${cWeldHigh.mats.length} vs ${cPlayerHigh.mats.length} distinct materials`);
const missHigh = vertexMismatch(worldVerts(weldHigh), worldVerts(playerHigh));
ok('…lands every vertex in the same place', missHigh === 0,
  `${missHigh}/${cPlayerHigh.verts} vertices moved or flipped`);
ok('…and draws it in less than HALF the meshes (the win at בינוני/גבוה)',
  cWeldHigh.meshes * 2 < cPlayerHigh.meshes && cWeldHigh.welds > 0,
  `${cWeldHigh.meshes} vs ${cPlayerHigh.meshes} meshes`);

// A welded kart whose parts change must still end up as the kart it was asked
// for — the weld throws the slot half away and rebuilds it whole.
const swapped = KM.createKartLOD({ engine: eng('low'), lod: 1,
  parts: { engine: 1, tires: 1, wing: 1, chassis: 1, exhaust: 1 } });
swapped.setParts({ wing: 3, engine: 3 });
const fresh = KM.createKartLOD({ engine: eng('low'), lod: 1,
  parts: { engine: 3, tires: 1, wing: 3, chassis: 1, exhaust: 1 } });
const cSwap = census(swapped), cFresh = census(fresh);
ok('setParts on a welded kart rebuilds it correctly (no stale welded geometry)',
  cSwap.tris === cFresh.tris && cSwap.meshes === cFresh.meshes,
  `${cSwap.meshes}m/${cSwap.tris}t vs ${cFresh.meshes}m/${cFresh.tris}t`);

// Whatever moves must have stayed outside the weld. Wheels spin and steer, the
// body rolls: a weld that swallowed a frame would freeze one of them.
for (let i = 0; i < 30; i++) aiLow.update(1 / 60, { steer: 1, speed01: 0.9, drifting: false, driftCharge01: 0, airborne: false, boosting: false });
const spun = aiLow.wheels.every(w => Math.abs(w.spin.rotation.x) > 0.1);
const steered = aiLow.wheels.filter(w => w.kind === 'front').every(w => Math.abs(w.steer.rotation.y) > 0.05);
const wheelMeshes = aiLow.wheels.every(w => { let n = 0; w.spin.traverse(o => { if (o.isMesh) n++; }); return n > 0; });
ok('welded wheels still spin', spun, aiLow.wheels.map(w => w.spin.rotation.x.toFixed(2)).join(' '));
ok('welded front wheels still steer', steered);
ok('every wheel still owns geometry (the weld did not eat one)', wheelMeshes);
ok('the welded body still rolls and the driver still leans',
  Math.abs(aiLow.bodyPivot.rotation.z) > 0.01 && Math.abs(aiLow.driverPivot.rotation.z) > 0.01,
  `body ${aiLow.bodyPivot.rotation.z.toFixed(3)} driver ${aiLow.driverPivot.rotation.z.toFixed(3)}`);

for (const k of [aiLow, playerLow, playerHigh, aiTwin, swapped, fresh, boostKart, weldHigh]) k.dispose();

console.log('\n  ' + '─'.repeat(78));
console.log(failed ? `  \x1b[31m${failed} FAILED\x1b[0m\n` : '  \x1b[32mall performance invariants hold\x1b[0m\n');
process.exit(failed ? 1 : 0);

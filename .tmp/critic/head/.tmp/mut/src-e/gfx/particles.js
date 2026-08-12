// particles.js — the JUICE layer for מרוץ הפרומפטים.
//
// One system owns every particle in the race and every screen-level feedback
// flash. It is driven per-frame from the player's KartBody state plus a short,
// EXPLICIT list of bus events (see EVENTS below — nothing else is subscribed).
//
// ── performance contract ────────────────────────────────────────────────────
// * Two draw calls total for the world FX: one alpha-blended "soft" layer
//   (smoke, dust, spray, landing puffs) and one additive "glow" layer (flames,
//   sparks, sparkles, speed lines). Both are InstancedBufferGeometry quads
//   billboarded in the vertex shader.
// * Zero allocation in the update path. Every particle lives in preallocated
//   typed arrays (structure of arrays); a free-list of indices recycles slots;
//   the instance attributes are written in place and the instance count is set
//   to the live count, so dead particles cost nothing on the GPU either.
// * Every budget is `engine.q.particles`-scaled. The low tier drops the
//   optional families entirely (speed lines, ambient tyre dust, the screen
//   streak layer) rather than running everything at a token rate.
// * `prefers-reduced-motion` disables the animated screen effects; the
//   position-change flash degrades to a short static tint.
//
// ── why quads and not THREE.Points ──────────────────────────────────────────
// Point sprites are cheaper, but a point is culled by the centre of its sprite,
// so a big near-camera smoke puff pops out of existence the moment its centre
// leaves the frustum. That is precisely the case here (the chase camera sits a
// couple of metres behind the tyres), so the instanced quad is worth it.
//
// ── why smoke does not read as a flat sprite ────────────────────────────────
// Four things, all of them necessary: (1) a 2x2 atlas of four DIFFERENT lumpy
// puff shapes with internal light/dark shading, not one radial blob; (2) per
// particle rotation AND rotation drift, so no two puffs share a silhouette;
// (3) size growth plus drag, so a puff bursts then billows and slows; (4) a
// colour ramp — a tinted puff at birth desaturating toward pale dust as it
// dies, which is what makes a cloud read as depth rather than as decals.
import * as THREE from 'three';
import { bus } from '../core/bus.js';
import { makeRng, makeNoise2D, fbm } from '../core/rng.js';
import { asphaltTexture, sandTexture, curbTexture } from './textures.js';
import { applyTheme } from './sky.js';

// ---------------------------------------------------------------------------
// events this module subscribes to (opts.events:false turns ALL of them off)
// ---------------------------------------------------------------------------
export const EVENTS = [
  'race:position',    // {from,to} -> screen sweep (gain = gold, loss = red)
  'drift:boost',      // {tier}    -> mini-boost flame burst + boost screen pulse
  'quiz:correct',     // {}        -> quiz turbo: bigger, gold-tinted flame burst
  'kart:collide',     // {kind,speed} -> collision sparks at the tracked kart
  'token:pickup',     // {}        -> fallback sparkle at the kart (see opts.tokenAuto)
  'quality:changed',  // engine.q  -> rebuild budgets
];

const UP_Y = 1;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// particle modes — drive the alpha/size curves in step()
const M_SMOKE = 0, M_DUST = 1, M_SPARK = 2, M_FLAME = 3, M_SPARKLE = 4, M_STREAK = 5;

// atlas cells (2x2). soft: 4 puff variants. glow: glow / star / flame / streak.
const CELL = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];
const G_GLOW = 0, G_STAR = 1, G_FLAME = 2, G_LINE = 3;

// Drift tier colours mirror DRIFT_TIERS in kart/kartphysics.js. Duplicated as
// literals on purpose: this module must not import the physics to draw smoke.
const TIER_COL = [0x59c8ff, 0xff9a2e, 0xc06bff];
// The same tiers as SMOKE tints: pushed further from white, because a puff is
// a low-alpha wash over a warm road and a literal UI colour vanishes into it.
const TIER_SMOKE = [[0.16, 0.60, 1.0], [1.0, 0.42, 0.06], [0.64, 0.26, 1.0]];

// Off-track surfaces. `sand` and `grass` come from KartBody.offSurface; `cloud`
// is track 3, where the runoff is luminous vapour rather than dirt.
const SURFACE = {
  asphalt: { r: 0.62, g: 0.60, b: 0.58, glow: 0 },
  sand: { r: 0.85, g: 0.70, b: 0.46, glow: 0 },
  grass: { r: 0.46, g: 0.48, b: 0.26, glow: 0 },
  cloud: { r: 0.86, g: 0.92, b: 1.00, glow: 1 },
};

// ---------------------------------------------------------------------------
// procedural sprite atlases
// ---------------------------------------------------------------------------

function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function texOf(canvas, name) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;   // alpha shape + luminance detail only
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  // NO MIPMAPS. These are 2x2 sprite ATLASES: the coarse mip levels average all
  // four cells together, so a distant puff degrades into a uniform grey SQUARE
  // with a hard edge — the single worst artifact this file can produce. The
  // sprites are soft and small, so point-sampling the top level is stable.
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.anisotropy = 1;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/**
 * 2x2 atlas of lumpy smoke puffs. Each cell: a union of gaussian lobes (the
 * silhouette), eroded by fbm (the broken edge), shaded by a fixed key direction
 * (the volume) and feathered by a radial falloff (so nothing ever clips square).
 */
function smokeAtlas(size = 512) {
  const cv = canvasOf(size), ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const C = size / 2;                        // cell size
  const noise = makeNoise2D(7717);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = ((cell / 2) | 0) * C;
    const rng = makeRng(3100 + cell * 37);
    // lobes: a handful of overlapping blobs give an irregular silhouette that a
    // single radial gradient can never produce.
    const NL = 9;
    const lx = new Float32Array(NL), ly = new Float32Array(NL), lr = new Float32Array(NL);
    for (let i = 0; i < NL; i++) {
      const a = rng() * Math.PI * 2, dd = Math.pow(rng(), 0.7) * 0.26;
      lx[i] = 0.5 + Math.cos(a) * dd;
      ly[i] = 0.5 + Math.sin(a) * dd;
      lr[i] = rng.range(0.15, 0.30);
    }
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C, v = (y + 0.5) / C;
        let a = 0;
        for (let i = 0; i < NL; i++) {
          const dx = u - lx[i], dy = v - ly[i];
          const t = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) / lr[i]);
          if (t > 0) a = Math.max(a, t * t * (3 - 2 * t));
        }
        // erode the edge with two octaves of noise so the boundary is torn
        const n = fbm(noise, u * 5.5 + cell * 11, v * 5.5 - cell * 7, 4, 2, 0.5);
        a *= clamp(0.35 + (n - 0.34) * 1.9, 0, 1);
        // hard radial feather — guarantees the cell edge is empty
        const rr = Math.hypot(u - 0.5, v - 0.5) * 2;
        a *= clamp(1 - Math.pow(clamp(rr, 0, 1), 2.4), 0, 1);
        a = clamp(a * 1.25, 0, 1);
        // volume shading: key from upper-left, plus internal noise structure so
        // the interior is not a flat disc of colour.
        // Volume shading. The RANGE here is what stops a puff reading as a
        // flat decal: a lit shoulder toward the key light, a genuinely dark
        // underside, and fbm structure inside so the middle is not one value.
        const shade = clamp(0.46 + (0.5 - u) * 0.72 + (0.5 - v) * 0.80
          + (fbm(noise, u * 3.4 + 40, v * 3.4 - 19, 4, 2, 0.55) - 0.5) * 1.30
          + (fbm(noise, u * 9.0 - 12, v * 9.0 + 31, 3, 2, 0.5) - 0.5) * 0.55, 0.04, 1.0);
        const l = shade * 255;
        const j = ((oy + y) * size + (ox + x)) * 4;
        d[j] = l; d[j + 1] = l; d[j + 2] = l; d[j + 3] = a * 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return texOf(cv, 'fx.smoke');
}

/** 2x2 additive atlas: soft glow, 4-point star, flame teardrop, speed streak. */
function glowAtlas(size = 256) {
  const cv = canvasOf(size), ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const C = size / 2;
  const noise = makeNoise2D(4241);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = ((cell / 2) | 0) * C;
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C, v = (y + 0.5) / C;
        const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
        const r = Math.hypot(dx, dy);
        let a = 0, l = 1;
        if (cell === G_GLOW) {
          a = Math.pow(clamp(1 - r, 0, 1), 2.6);
          a += Math.pow(clamp(1 - r * 2.6, 0, 1), 2) * 0.7;   // hot core
        } else if (cell === G_STAR) {
          const core = Math.pow(clamp(1 - r * 1.7, 0, 1), 2.2);
          const ax = Math.pow(clamp(1 - Math.abs(dy) * 9, 0, 1), 1.6) * Math.pow(clamp(1 - Math.abs(dx), 0, 1), 2.2);
          const ay = Math.pow(clamp(1 - Math.abs(dx) * 9, 0, 1), 1.6) * Math.pow(clamp(1 - Math.abs(dy), 0, 1), 2.2);
          const dg = 0.45 * Math.pow(clamp(1 - Math.abs(dx - dy) * 11, 0, 1), 1.6) * Math.pow(clamp(1 - r, 0, 1), 2.4)
            + 0.45 * Math.pow(clamp(1 - Math.abs(dx + dy) * 11, 0, 1), 1.6) * Math.pow(clamp(1 - r, 0, 1), 2.4);
          a = clamp(core + ax + ay + dg, 0, 1);
        } else if (cell === G_FLAME) {
          // Teardrop with a NARROW tip (v=0, screen-up once flipY is applied)
          // and a rounded base. Its width goes to zero at BOTH ends, which is
          // what keeps the cell edges empty — a sprite whose alpha survives to
          // the cell boundary renders as a hard-edged rectangle on screen, and
          // that is the ugliest artifact this whole file can produce.
          const w = 0.44 * Math.pow(v, 0.5) * (1 - Math.pow(v, 5)) + 0.02;
          a = Math.pow(clamp(1 - Math.abs(u - 0.5) / w, 0, 1), 1.25);
          a *= clamp(0.55 + (fbm(noise, u * 7, v * 3.5, 3, 2, 0.5) - 0.42) * 2.4, 0, 1.15);
          a *= Math.pow(Math.sin(Math.PI * clamp(v, 0, 1)), 0.35);
          l = clamp(0.75 + v * 0.6, 0, 1.4);     // hotter toward the base
        } else {
          // speed streak: a thin line along the cell's +V axis, feathered at
          // both ends, likewise empty at every cell edge
          a = Math.pow(clamp(1 - Math.abs(u - 0.5) / 0.11, 0, 1), 1.5)
            * Math.pow(Math.sin(Math.PI * clamp(v, 0, 1)), 0.7);
        }
        a = clamp(a, 0, 1);
        const j = ((oy + y) * size + (ox + x)) * 4;
        const lv = clamp(l, 0, 1.4) * 255;
        d[j] = Math.min(255, lv); d[j + 1] = Math.min(255, lv); d[j + 2] = Math.min(255, lv);
        d[j + 3] = a * 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return texOf(cv, 'fx.glow');
}

// ---------------------------------------------------------------------------
// GPU layer: one instanced quad batch
// ---------------------------------------------------------------------------

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec4 iCol;      // rgb + alpha
attribute vec4 iParam;    // size, rotation, stretch, unused
attribute vec2 iUv;       // atlas cell offset
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float s = iParam.x, rot = iParam.y, st = iParam.z;
  vec2 p = vec2(position.x * s, position.y * s * st);
  float c = cos(rot), sn = sin(rot);
  mv.xy += vec2(p.x * c - p.y * sn, p.x * sn + p.y * c);
  gl_Position = projectionMatrix * mv;
  vUv = uv * 0.5 + iUv;
  vCol = iCol;
}`;

const FRAG = /* glsl */`
#include <common>
uniform sampler2D uMap;
uniform float uAdd;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vCol.a;
  if (a < 0.004) discard;
  // t.r carries the sprite's internal shading; on the additive layer it is a
  // straight multiplier, on the soft layer it is a gentle light/shade term so
  // smoke keeps volume instead of reading as one flat value.
  vec3 rgb = vCol.rgb * mix(0.20 + 1.55 * t.r, t.r, uAdd);
  gl_FragColor = vec4(rgb, a);
  #include <colorspace_fragment>
}`;

function makeBatch(cap, map, additive, renderOrder) {
  const geo = new THREE.InstancedBufferGeometry();
  // unit quad, centred
  geo.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  const aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  const aPar = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  const aUv = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
  for (const a of [aPos, aCol, aPar, aUv]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos);
  geo.setAttribute('iCol', aCol);
  geo.setAttribute('iParam', aPar);
  geo.setAttribute('iUv', aUv);
  geo.instanceCount = 0;
  // The batch is written in world space and never moves, so a bounding sphere
  // big enough to cover the action beats recomputing one every frame.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uAdd: { value: additive ? 1 : 0 } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.matrixAutoUpdate = false;
  return { geo, mat, mesh, aPos, aCol, aPar, aUv, cap };
}

// ---------------------------------------------------------------------------
// pool: structure of arrays + free list. No allocation after construction.
// ---------------------------------------------------------------------------

function makePool(cap) {
  return {
    cap,
    n: 0,
    live: new Int32Array(cap),      // indices of live particles
    free: new Int32Array(cap),      // stack of free indices
    freeN: cap,
    px: new Float32Array(cap), py: new Float32Array(cap), pz: new Float32Array(cap),
    vx: new Float32Array(cap), vy: new Float32Array(cap), vz: new Float32Array(cap),
    life: new Float32Array(cap), ttl: new Float32Array(cap),
    s0: new Float32Array(cap), s1: new Float32Array(cap),
    r0: new Float32Array(cap), g0: new Float32Array(cap), b0: new Float32Array(cap),
    r1: new Float32Array(cap), g1: new Float32Array(cap), b1: new Float32Array(cap),
    a0: new Float32Array(cap),
    rot: new Float32Array(cap), rotv: new Float32Array(cap),
    drag: new Float32Array(cap), grav: new Float32Array(cap),
    stretch: new Float32Array(cap),
    mode: new Uint8Array(cap), cell: new Uint8Array(cap),
    dropped: 0,
    init() { for (let i = 0; i < cap; i++) this.free[i] = i; return this; },
  };
}

// ---------------------------------------------------------------------------
// screen layer (DOM)
// ---------------------------------------------------------------------------

const FX_CSS = `
.fx-root{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}
.fx-root>div{position:absolute;inset:0;opacity:0}
.fx-speed{
  background:radial-gradient(ellipse 62% 58% at 50% 50%,rgba(0,0,0,0) 55%,rgba(24,12,4,.55) 100%);
  transition:opacity .22s linear}
.fx-streak{
  /* Boost rim. Deliberately NOT another dark vignette (the HUD already owns
     one): this brightens the frame edges gold, so boost reads as the screen
     lighting up rather than as the screen closing in. A conic "speed rays"
     layer was tried and dropped — masked composited layers tile-band badly on
     the software renderer the capture harness uses. */
  background:
    radial-gradient(ellipse 62% 58% at 50% 52%,rgba(255,200,110,0) 56%,rgba(255,186,84,.50) 100%),
    radial-gradient(ellipse 130% 52% at 50% 112%,rgba(255,150,40,.34),rgba(255,150,40,0) 72%);
  transition:opacity .1s linear}
.fx-sweep{background-repeat:no-repeat;background-size:100% 260%}
.fx-sweep.up{background-image:linear-gradient(0deg,rgba(255,194,71,.95),rgba(255,224,150,.42) 22%,rgba(255,224,150,0) 52%)}
.fx-sweep.down{background-image:linear-gradient(180deg,rgba(255,72,64,.9),rgba(255,120,90,.34) 22%,rgba(255,120,90,0) 52%)}
.fx-sweep.up.go{animation:fxSweepUp .8s cubic-bezier(.2,.7,.3,1) 1}
.fx-sweep.down.go{animation:fxSweepDown .8s cubic-bezier(.2,.7,.3,1) 1}
/* The sweep travels by moving its own BACKGROUND, not by transforming the
   element: a transformed full-screen div over the WebGL canvas is promoted to
   its own compositor layer and composites in visible tiles on the software
   renderer the capture harness uses. */
@keyframes fxSweepUp{
  0%{opacity:0;background-position:50% 100%}
  16%{opacity:1}
  100%{opacity:0;background-position:50% 0%}}
@keyframes fxSweepDown{
  0%{opacity:0;background-position:50% 0%}
  16%{opacity:1}
  100%{opacity:0;background-position:50% 100%}}
@media (prefers-reduced-motion:reduce){
  .fx-root *{animation:none !important;transition-duration:.01ms !important}
}
`;

function injectFxCSS() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pr-fx-style')) return;
  const el = document.createElement('style');
  el.id = 'pr-fx-style';
  el.textContent = FX_CSS;
  document.head.appendChild(el);
}

const REDUCED = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

function makeScreen(host, q, opts) {
  if (!host || typeof document === 'undefined') return null;
  injectFxCSS();
  const reduced = opts.reducedMotion ?? REDUCED();
  const root = document.createElement('div');
  root.className = 'fx-root';
  const speed = document.createElement('div'); speed.className = 'fx-speed';
  const streak = document.createElement('div'); streak.className = 'fx-streak';
  const sweep = document.createElement('div'); sweep.className = 'fx-sweep';
  // The low tier and reduced-motion both skip the animated streak layer: it is
  // a full-screen composited gradient, which is the single most expensive
  // screen effect here on an integrated GPU.
  const useStreak = q.particles >= 0.5 && !reduced;
  root.appendChild(speed);
  if (useStreak) root.appendChild(streak);
  root.appendChild(sweep);
  host.appendChild(root);

  let curSpeed = -1, curStreak = -1, sweepT = 0;
  return {
    root, reduced,
    /** @param {number} v 0..1 speed vignette  @param {number} b 0..1 boost streaks */
    set(v, b) {
      const qv = Math.round(v * 20) / 20;
      if (qv !== curSpeed) { curSpeed = qv; speed.style.opacity = qv; }
      if (!useStreak) return;
      // The boost rim pulses by writing OPACITY, never by animating transform
      // or filter: an animated full-screen layer gets promoted to its own
      // compositor layer, and that composites in visible tiles over the WebGL
      // canvas on software renderers (it shows up as a bright rectangle).
      const qb = Math.round(b * 10) / 10;
      if (qb !== curStreak) { curStreak = qb; streak.style.opacity = qb * 0.55; }
    },
    flash(dir) {
      sweep.classList.remove('go', 'up', 'down');
      sweep.classList.add(dir >= 0 ? 'up' : 'down');
      if (reduced) { sweep.style.opacity = 0.5; sweepT = 0.35; return; }
      void sweep.offsetWidth;          // restart the animation
      sweep.classList.add('go');
      sweepT = 0;
    },
    tick(dt) {
      if (sweepT > 0) { sweepT -= dt; if (sweepT <= 0) sweep.style.opacity = 0; }
    },
    dispose() { root.remove(); },
  };
}

// ---------------------------------------------------------------------------
// PUBLIC: createEffects
// ---------------------------------------------------------------------------

/**
 * Build the effects system.
 *
 * @param {object} engine                  reads engine.q.{particles,texSize}
 * @param {object} o
 * @param {THREE.Camera} o.camera          used to orient speed lines (optional)
 * @param {function}     o.rng             makeRng(seed) instance (optional)
 * @param {HTMLElement}  o.ui              host for the DOM screen layer; default engine.ui
 * @param {boolean}      o.events          false = subscribe to nothing (default true)
 * @param {boolean}      o.tokenAuto       false = ignore 'token:pickup' (default true)
 * @param {boolean}      o.screen          false = no DOM layer at all (default true)
 * @param {boolean}      o.reducedMotion   force the reduced-motion path
 * @returns {{group:THREE.Group, update:Function, emitFor:Function, spawn:Function,
 *            flash:Function, setQuality:Function, stats:Function, dispose:Function}}
 */
export function createEffects(engine, o = {}) {
  const q = engine?.q || { particles: 1, texSize: 1024 };
  const rng = o.rng || makeRng(0x5eed);
  const camera = o.camera || null;

  const group = new THREE.Group();
  group.name = 'fx';
  group.matrixAutoUpdate = false;

  const texSize = q.texSize >= 1024 ? 512 : q.texSize >= 512 ? 512 : 256;
  const smokeTex = smokeAtlas(texSize);
  const glowTex = glowAtlas(texSize >= 512 ? 256 : 128);

  // ── budgets ──────────────────────────────────────────────────────────────
  // Measured (see .tmp/fxbench.mjs): at the high tier a sustained drift +
  // boost + collisions holds ~330 soft and ~150 glow live particles.
  let P = q.particles ?? 1;
  const capSoft = Math.max(24, Math.round(430 * P));
  const capGlow = Math.max(16, Math.round(300 * P));
  const rich = P >= 0.5;                 // speed lines / ambient dust / streaks

  const soft = makePool(capSoft).init();
  const glow = makePool(capGlow).init();
  const bSoft = makeBatch(capSoft, smokeTex, false, 8);
  const bGlow = makeBatch(capGlow, glowTex, true, 9);
  group.add(bSoft.mesh, bGlow.mesh);

  const screen = o.screen === false ? null : makeScreen(o.ui ?? engine?.ui, q, o);

  // Emission is STATELESS: floor(rate*dt) particles plus one more with the
  // fractional probability. A per-emitter accumulator would have to be keyed by
  // kart — with one shared accumulator, two karts in different states wipe each
  // other's fraction and neither ever emits.
  function nEmit(rate, dt) {
    const e = rate * dt;
    const n = e | 0;
    return n + (rng() < e - n ? 1 : 0);
  }
  // last-known tracked kart state, so bus events can place themselves
  const last = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, speed01: 0, valid: false };
  const prev = { squash: 0, airborne: false, wall: 0, kart: 0, boosting: false, tier: 0 };
  let boostFlash = 0;                    // seconds of extra-hot boost FX left
  let time = 0;

  // ── spawn ────────────────────────────────────────────────────────────────
  // One allocation-free primitive. Everything else is a wrapper around it.
  function push(pool, mode, cell, x, y, z, vx, vy, vz, ttl, s0, s1, a0,
    r0, g0, b0, r1, g1, b1, drag, grav, rot, rotv, stretch) {
    if (pool.freeN === 0) { pool.dropped++; return -1; }
    const i = pool.free[--pool.freeN];
    pool.live[pool.n++] = i;
    pool.px[i] = x; pool.py[i] = y; pool.pz[i] = z;
    pool.vx[i] = vx; pool.vy[i] = vy; pool.vz[i] = vz;
    pool.life[i] = 0; pool.ttl[i] = ttl;
    pool.s0[i] = s0; pool.s1[i] = s1; pool.a0[i] = a0;
    pool.r0[i] = r0; pool.g0[i] = g0; pool.b0[i] = b0;
    pool.r1[i] = r1; pool.g1[i] = g1; pool.b1[i] = b1;
    pool.drag[i] = drag; pool.grav[i] = grav;
    pool.rot[i] = rot; pool.rotv[i] = rotv; pool.stretch[i] = stretch;
    pool.mode[i] = mode; pool.cell[i] = cell;
    return i;
  }

  // ── families ─────────────────────────────────────────────────────────────

  /**
   * Screen-space angle that puts a particle's local +Y along a WORLD direction.
   * Computed once at spawn (not per frame) — a flame tongue or a speed line
   * lives for a fraction of a second, and the camera barely turns in that time.
   */
  // camera basis, refreshed once per update() — reading matrixWorldInverse at
  // spawn time is a trap: outside a render pass it is a frame stale, and in the
  // headless harness it is never updated at all.
  const cam = { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 };
  function refreshCam() {
    if (!camera) return;
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.elements;
    cam.rx = m[0]; cam.ry = m[1]; cam.rz = m[2];
    cam.ux = m[4]; cam.uy = m[5]; cam.uz = m[6];
  }
  function screenRot(dx, dz) {
    if (!camera) return 0;
    const sx = dx * cam.rx + dz * cam.rz;
    const sy = dx * cam.ux + dz * cam.uz;
    return Math.atan2(-sx, sy);
  }

  function driftPuff(x, y, z, dirX, dirZ, outX, outZ, tier, charge, spd) {
    // tint: dust at tier 0, saturating toward the tier colour as it charges
    const c = TIER_SMOKE[Math.min(Math.max(tier, 1), 3) - 1];
    const tr = c[0], tg = c[1], tb = c[2];
    const k = tier > 0 ? clamp(0.58 + charge * 0.38, 0, 0.96) : 0;
    // Base tyre smoke is warm grey; the tier tint is mixed IN rather than
    // replacing it, so the smoke still reads as smoke at every tier.
    // Warm bias: unlit smoke under a golden-hour key has to be tinted by hand
    // or it reads as a grey hole punched in the sunset.
    const br = lerp(0.92, tr, k), bg = lerp(0.86, tg, k), bb = lerp(0.78, tb, k);
    const j = rng.gauss();
    push(soft, M_SMOKE, rng.int(0, 3),
      x + j * 0.16, y + rng.range(0, 0.14), z + rng.gauss() * 0.16,
      -dirX * rng.range(1.2, 3.4) + outX * rng.range(0.8, 2.6) + rng.gauss() * 0.5,
      rng.range(0.5, 1.5),
      -dirZ * rng.range(1.2, 3.4) + outZ * rng.range(0.8, 2.6) + rng.gauss() * 0.5,
      rng.range(0.75, 1.20) + charge * 0.30,
      rng.range(0.38, 0.72), rng.range(2.1, 3.3) + charge * 0.9,
      rng.range(0.34, 0.58) * (0.55 + spd * 0.6),
      br, bg, bb,
      0.90, 0.86, 0.82,                      // dissipates to pale dust
      2.1, 0.35, rng() * 6.28, rng.gauss() * 1.5, 1);
    // charge embers: the additive spark that makes a tier read instantly
    if (tier > 0 && rng() < 0.34 + charge * 0.4) {
      push(glow, M_SPARK, G_STAR,
        x + rng.gauss() * 0.2, y + rng.range(0.05, 0.3), z + rng.gauss() * 0.2,
        -dirX * rng.range(1, 4) + rng.gauss() * 2.2, rng.range(1.4, 4.4),
        -dirZ * rng.range(1, 4) + rng.gauss() * 2.2,
        rng.range(0.28, 0.6), rng.range(0.20, 0.42), 0.03, rng.range(0.7, 1.2),
        tr, tg, tb, 1, 0.92, 0.7, 1.2, -9, rng() * 6.28, rng.gauss() * 6, 1);
    }
  }

  function sprayPuff(x, y, z, dirX, dirZ, kind, spd) {
    const s = SURFACE[kind] || SURFACE.sand;
    push(soft, M_DUST, rng.int(0, 3),
      x + rng.gauss() * 0.2, y + 0.05, z + rng.gauss() * 0.2,
      -dirX * rng.range(2, 6) * spd + rng.gauss() * 1.4, rng.range(1.0, 3.2) * (0.5 + spd),
      -dirZ * rng.range(2, 6) * spd + rng.gauss() * 1.4,
      rng.range(0.7, 1.25),
      rng.range(0.4, 0.8), rng.range(2.2, 3.8),
      rng.range(0.22, 0.44) * (0.35 + spd * 0.85),
      s.r * rng.range(0.9, 1.1), s.g * rng.range(0.92, 1.08), s.b * rng.range(0.9, 1.1),
      s.r * 1.06, s.g * 1.06, s.b * 1.08,
      1.9, s.glow ? -0.4 : 1.6, rng() * 6.28, rng.gauss() * 1.8, 1);
    // grit: a few heavy grains thrown clear of the cloud
    if (rng() < 0.4) {
      push(soft, M_DUST, rng.int(0, 3),
        x, y + 0.1, z,
        -dirX * rng.range(4, 11) + rng.gauss() * 2.5, rng.range(2, 5),
        -dirZ * rng.range(4, 11) + rng.gauss() * 2.5,
        rng.range(0.35, 0.7), rng.range(0.10, 0.20), rng.range(0.14, 0.26),
        0.7, s.r * 0.8, s.g * 0.8, s.b * 0.8, s.r, s.g, s.b,
        0.6, -12, rng() * 6.28, rng.gauss() * 8, 1);
    }
  }

  function flameJet(x, y, z, dirX, dirZ, heat) {
    // Flame tongues LICK UPWARD off the rear deck rather than streaming
    // straight back. The camera in this game lives directly behind the kart, so
    // a backward-pointing tongue is foreshortened into a featureless blob; an
    // upward one keeps its silhouette from exactly the angle the player has.
    const rot = rng.gauss() * 0.42;
    push(glow, M_FLAME, G_FLAME,
      x + rng.gauss() * 0.14, y + rng.gauss() * 0.06, z + rng.gauss() * 0.14,
      -dirX * rng.range(2.6, 6.5) + rng.gauss() * 1.1, rng.range(1.3, 3.0),
      -dirZ * rng.range(2.6, 6.5) + rng.gauss() * 1.1,
      rng.range(0.26, 0.42), rng.range(0.44, 0.74) * heat, rng.range(0.10, 0.20),
      rng.range(0.40, 0.62),
      1.0, 0.78, 0.34,                      // white-gold core
      1.0, 0.22, 0.05,                      // cooling to deep orange
      3.0, 2.2, rot, rng.gauss() * 0.9, rng.range(1.9, 2.8));
    // nozzle heat: a small hot glow pinned at the exhaust mouth. Without it the
    // tongues read as separate sprites instead of as one jet.
    if (rng() < 0.6) {
      push(glow, M_SPARKLE, G_GLOW, x, y, z, -dirX * 1.5, 0.3, -dirZ * 1.5,
        0.16, rng.range(0.55, 0.95) * heat, rng.range(0.20, 0.40), 0.22,
        1.0, 0.72, 0.38, 1.0, 0.45, 0.16, 2, 0, 0, 0, 1);
    }
    if (rng() < 0.5) {
      push(soft, M_SMOKE, rng.int(0, 3),
        x, y + 0.1, z,
        -dirX * rng.range(1, 3), rng.range(0.6, 1.6), -dirZ * rng.range(1, 3),
        rng.range(0.5, 0.9), 0.4, rng.range(1.4, 2.4), 0.16,
        0.95, 0.72, 0.48, 0.8, 0.78, 0.76, 2.4, 0.5, rng() * 6.28, rng.gauss() * 2, 1);
    }
  }

  /** Screen-aligned speed lines rushing past the camera. */
  function speedLine(cx, cy, cz, dirX, dirZ, heat) {
    if (!rich) return;
    // spawn on a ring around the kart, streaking backwards past the camera
    const a = rng() * Math.PI * 2, rad = rng.range(2.6, 6.5);
    const ux = Math.cos(a) * rad, uy = rng.range(0.15, 1.5), uz = Math.sin(a) * rad;
    // Rotation is screen-space; align the streak with the kart's travel as
    // projected into camera space, computed once at spawn.
    const rot = screenRot(dirX, dirZ);
    push(glow, M_STREAK, G_LINE,
      cx + ux, cy + uy, cz + uz,
      -dirX * rng.range(14, 30), rng.gauss() * 0.4, -dirZ * rng.range(14, 30),
      rng.range(0.16, 0.28), rng.range(0.10, 0.17), rng.range(0.10, 0.17),
      rng.range(0.22, 0.42) * heat,
      1.0, 0.90, 0.62, 1.0, 0.72, 0.36, 0.3, 0, rot, 0, rng.range(14, 24));
  }

  function burstSpark(x, y, z, n, power, warm) {
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, e = rng.range(0.1, 1.1);
      const sp = rng.range(4, 15) * power;
      push(glow, M_SPARK, rng() < 0.3 ? G_STAR : G_GLOW,
        x, y, z,
        Math.cos(a) * sp, e * sp * 0.9, Math.sin(a) * sp,
        rng.range(0.30, 0.72), rng.range(0.16, 0.34), rng.range(0.05, 0.12),
        rng.range(0.7, 1.0),
        1.0, warm ? 0.92 : 0.98, warm ? 0.62 : 0.86,
        1.0, 0.42, 0.12,
        1.1, -19, rng() * 6.28, rng.gauss() * 7, rng.range(1, 3.4));
    }
    // impact flash + a scuff of smoke, so a hit has weight and not just glitter
    push(glow, M_SPARKLE, G_GLOW, x, y, z, 0, 0, 0,
      0.20, 0.5 * power, 2.4 * power, 0.85, 1, 0.85, 0.55, 1, 0.5, 0.2, 0, 0, 0, 0, 1);
    for (let i = 0; i < 3; i++) {
      push(soft, M_SMOKE, rng.int(0, 3), x, y, z,
        rng.gauss() * 2.5, rng.range(0.5, 2), rng.gauss() * 2.5,
        rng.range(0.5, 0.9), 0.35, 1.6, 0.22,
        0.85, 0.80, 0.74, 0.9, 0.88, 0.86, 2.4, 0.4, rng() * 6.28, rng.gauss() * 3, 1);
    }
  }

  function burstToken(x, y, z) {
    const n = Math.max(5, Math.round(20 * P));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.gauss() * 0.3;
      const sp = rng.range(3, 8);
      push(glow, M_SPARKLE, G_STAR,
        x + rng.gauss() * 0.2, y + rng.gauss() * 0.2, z + rng.gauss() * 0.2,
        Math.cos(a) * sp, rng.range(1.5, 6), Math.sin(a) * sp,
        rng.range(0.5, 0.9), rng.range(0.45, 0.9), rng.range(0.08, 0.22), 1.0,
        1.0, 0.86, 0.40,                     // gold #ffc247-ish
        1.0, 0.98, 0.86,
        1.6, -5.5, rng() * 6.28, rng.gauss() * 8, 1);
    }
    // expanding ring flash
    push(glow, M_SPARKLE, G_GLOW, x, y, z, 0, 1.2, 0,
      0.40, 0.9, 5.6, 1.0, 1.0, 0.84, 0.42, 1.0, 0.95, 0.8, 0, 0, 0, 0, 1);
  }

  function burstLanding(x, y, z, power, kind) {
    const s = SURFACE[kind] || SURFACE.asphalt;
    const n = Math.max(3, Math.round(16 * P * (0.4 + power)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.gauss() * 0.4;
      const sp = rng.range(3, 9) * (0.5 + power);
      push(soft, M_DUST, rng.int(0, 3),
        x + Math.cos(a) * 0.4, y + 0.06, z + Math.sin(a) * 0.4,
        Math.cos(a) * sp, rng.range(0.4, 2.2), Math.sin(a) * sp,
        rng.range(0.55, 1.0), rng.range(0.4, 0.8), rng.range(2.4, 4.0),
        rng.range(0.28, 0.5) * (0.5 + power * 0.6),
        s.r, s.g, s.b, s.r * 1.08, s.g * 1.08, s.b * 1.08,
        2.6, 0.4, rng() * 6.28, rng.gauss() * 2.2, 1);
    }
  }

  function burstBoost(x, y, z, dirX, dirZ, power) {
    const n = Math.max(4, Math.round(18 * P * power));
    for (let i = 0; i < n; i++) flameJet(x, y, z, dirX, dirZ, 1.2 * power);
    push(glow, M_SPARKLE, G_GLOW, x, y, z, -dirX * 2, 0.6, -dirZ * 2,
      0.26, 0.9 * power, 3.4 * power, 0.8, 1, 0.78, 0.4, 1, 0.45, 0.15, 0, 0, 0, 0, 1);
    for (let i = 0; i < n * 0.6; i++) speedLine(x, y, z, dirX, dirZ, 1);
  }

  // ── per-frame emission from kart state ───────────────────────────────────

  /**
   * Emit for ONE kart. The race scene calls update() for the player; call this
   * directly (with a small weight) for AI karts if you want their tyre smoke.
   * @param {object} body   KartBody or any object with the same read-only state
   * @param {number} dt
   * @param {number} weight 0..1 emission scale (AI karts look right around 0.5)
   */
  function emitFor(body, dt, weight = 1, edges = false) {
    if (!body || !body.position) return;
    const p = body.position;
    let fx = 0, fz = 1;
    if (body.forward) { fx = body.forward.x; fz = body.forward.z; }
    else if (body.velocity) {
      const m = Math.hypot(body.velocity.x, body.velocity.z) || 1;
      fx = body.velocity.x / m; fz = body.velocity.z / m;
    }
    const rx = -fz, rz = fx;                     // right = forward x UP
    const spd = body.speed01 ?? 0;
    const w = weight * P;

    // rear tyre contact patches
    const tx = p.x - fx * 0.85, tz = p.z - fz * 0.85, ty = p.y + 0.12;

    // ---- drift smoke -----------------------------------------------------
    if (body.drifting && spd > 0.15) {
      const charge = body.driftCharge01 ?? 0;
      const dir = body.driftDir || 1;
      for (let e = nEmit((15 + charge * 15) * w, dt); e > 0; e--) {
        const side = rng() < 0.5 ? 1 : -1;
        driftPuff(tx + rx * 0.72 * side, ty, tz + rz * 0.72 * side,
          fx, fz, rx * dir, rz * dir, body.driftTier || 0, charge, spd);
      }
    }

    // ---- surface spray ---------------------------------------------------
    if (body.offTrack && spd > 0.12 && !body.airborne) {
      for (let e = nEmit((16 + spd * 34) * w, dt); e > 0; e--) {
        const side = rng() < 0.5 ? 1 : -1;
        sprayPuff(tx + rx * 0.72 * side, ty, tz + rz * 0.72 * side, fx, fz,
          body.surfaceKind || 'sand', spd);
      }
    }

    // ---- ambient tyre dust on asphalt at speed (rich tiers only) ----------
    if (rich && !body.offTrack && !body.airborne && spd > 0.55 && !body.drifting) {
      for (let e = nEmit((spd - 0.5) * 9 * w, dt); e > 0; e--) {
        const side = rng() < 0.5 ? 1 : -1;
        push(soft, M_DUST, rng.int(0, 3),
          tx + rx * 0.72 * side, ty, tz + rz * 0.72 * side,
          -fx * rng.range(1, 3), rng.range(0.3, 1.0), -fz * rng.range(1, 3),
          rng.range(0.5, 0.9), 0.3, rng.range(1.4, 2.2), rng.range(0.05, 0.12),
          0.78, 0.74, 0.70, 0.85, 0.84, 0.82, 2.2, 0.3, rng() * 6.28, rng.gauss() * 2, 1);
      }
    }

    // ---- boost flame + speed lines ---------------------------------------
    const boosting = !!body.boosting;
    if (boosting || boostFlash > 0) {
      const heat = boosting ? 1 : 0.6;
      const ex = p.x - fx * 1.45, ez = p.z - fz * 1.45, ey = p.y + 0.60;
      for (let e = nEmit((26 + spd * 16) * w * heat, dt); e > 0; e--) {
        const side = rng() < 0.5 ? 1 : -1;
        flameJet(ex + rx * 0.42 * side, ey, ez + rz * 0.42 * side, fx, fz, heat);
      }
      if (rich) {
        for (let e = nEmit(52 * w * heat, dt); e > 0; e--) speedLine(p.x, p.y, p.z, fx, fz, heat);
      }
    }

    // One-shot edges (landing, collisions, boost start) are only tracked for
    // the kart passed to update() — one shared `prev` cannot serve eight karts,
    // and cross-talk would fire a spark burst on the wrong kart.
    if (!edges) {
      last.x = p.x; last.y = p.y; last.z = p.z;
      last.fx = fx; last.fy = 0; last.fz = fz;
      last.speed01 = spd; last.valid = true;
      return;
    }

    // ---- landing puff (rising edge of landingSquash after air) -----------
    const sq = body.landingSquash ?? 0;
    if (sq > 0.06 && sq > prev.squash + 0.02 && !body.airborne) {
      burstLanding(p.x, p.y, p.z, clamp(sq, 0, 1),
        body.offTrack ? (body.surfaceKind || 'sand') : 'asphalt');
    }
    prev.squash = sq;
    prev.airborne = !!body.airborne;

    // ---- collisions (rising edge; the bus event fires for the player too,
    //      so the guard below keeps a hit from double-bursting) -------------
    const wh = body.wallHit ?? 0, kh = body.kartHit ?? 0;
    if (wh > 0.05 && prev.wall <= 0.05) {
      burstSpark(p.x - fx * 0.2, p.y + 0.45, p.z - fz * 0.2,
        Math.max(3, Math.round(16 * P * wh + 4)), 0.6 + wh, true);
    }
    if (kh > 0.05 && prev.kart <= 0.05) {
      burstSpark(p.x, p.y + 0.5, p.z, Math.max(3, Math.round(12 * P * kh + 3)), 0.5 + kh, false);
    }
    prev.wall = wh; prev.kart = kh;

    // ---- boost transitions ----------------------------------------------
    if (boosting && !prev.boosting) {
      burstBoost(p.x - fx * 1.05, p.y + 0.42, p.z - fz * 1.05, fx, fz, 1);
    }
    prev.boosting = boosting;

    // remember where the tracked kart is, so bus events can place themselves
    last.x = p.x; last.y = p.y; last.z = p.z;
    last.fx = fx; last.fy = 0; last.fz = fz;
    last.speed01 = spd; last.valid = true;
  }

  // ── simulation ───────────────────────────────────────────────────────────

  function step(pool, batch, dt, add) {
    const { px, py, pz, vx, vy, vz, life, ttl, s0, s1, a0, r0, g0, b0, r1, g1, b1,
      rot, rotv, drag, grav, stretch, mode, cell, live } = pool;
    const aPos = batch.aPos.array, aCol = batch.aCol.array;
    const aPar = batch.aPar.array, aUv = batch.aUv.array;
    let w = 0;
    for (let k = 0; k < pool.n; k++) {
      const i = live[k];
      const t = (life[i] += dt);
      const T = ttl[i];
      if (t >= T) {                     // recycle: swap-back removal
        pool.live[k] = pool.live[--pool.n];
        pool.free[pool.freeN++] = i;
        k--;
        continue;
      }
      const u = t / T;
      // integrate
      const dmp = 1 - drag[i] * dt;
      const d = dmp < 0 ? 0 : dmp;
      let ax = vx[i] * d, ay = vy[i] * d + grav[i] * dt, az = vz[i] * d;
      vx[i] = ax; vy[i] = ay; vz[i] = az;
      px[i] += ax * dt; py[i] += ay * dt; pz[i] += az * dt;
      rot[i] += rotv[i] * dt;

      // curves per mode
      const m = mode[i];
      let alpha, size;
      if (m === M_SMOKE) {
        alpha = a0[i] * Math.min(1, u * 9) * (1 - u) * (1 - u * 0.55);
        size = lerp(s0[i], s1[i], Math.pow(u, 0.55));
      } else if (m === M_DUST) {
        alpha = a0[i] * Math.min(1, u * 12) * (1 - u) * (1 - u);
        size = lerp(s0[i], s1[i], Math.pow(u, 0.5));
      } else if (m === M_SPARK) {
        alpha = a0[i] * (1 - u) * (1 - u * 0.3);
        size = lerp(s0[i], s1[i], u);
      } else if (m === M_FLAME) {
        alpha = a0[i] * Math.min(1, u * 14) * Math.pow(1 - u, 1.3);
        size = lerp(s0[i], s1[i], Math.pow(u, 0.7));
      } else if (m === M_SPARKLE) {
        alpha = a0[i] * Math.pow(1 - u, 1.6) * (0.6 + 0.4 * Math.sin(u * 34));
        size = lerp(s0[i], s1[i], Math.pow(u, 0.4));
      } else {                                   // M_STREAK
        alpha = a0[i] * Math.sin(u * 3.14159);
        size = lerp(s0[i], s1[i], u);
      }
      if (alpha <= 0.002) continue;

      const o3 = w * 3, o4 = w * 4, o2 = w * 2;
      aPos[o3] = px[i]; aPos[o3 + 1] = py[i]; aPos[o3 + 2] = pz[i];
      aCol[o4] = lerp(r0[i], r1[i], u);
      aCol[o4 + 1] = lerp(g0[i], g1[i], u);
      aCol[o4 + 2] = lerp(b0[i], b1[i], u);
      aCol[o4 + 3] = alpha;
      aPar[o4] = size; aPar[o4 + 1] = rot[i]; aPar[o4 + 2] = stretch[i]; aPar[o4 + 3] = 0;
      const c = CELL[cell[i]];
      aUv[o2] = c[0]; aUv[o2 + 1] = c[1];
      w++;
    }
    batch.geo.instanceCount = w;
    if (w > 0) {
      batch.aPos.needsUpdate = true; batch.aCol.needsUpdate = true;
      batch.aPar.needsUpdate = true; batch.aUv.needsUpdate = true;
    }
    void add;
    return w;
  }

  // ── public update ────────────────────────────────────────────────────────

  /**
   * Call every frame. Safe with `body === null` and with nothing alive.
   * @param {number} dt
   * @param {object|null} body  the player's KartBody (or a state snapshot)
   * @param {object} [ctx]      { camera?, boost01?, speed01? } — all optional
   */
  function update(dt, body, ctx) {
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;                 // never let a stall dump a cloud
    time += dt;
    refreshCam();
    if (boostFlash > 0) boostFlash -= dt;
    if (body) emitFor(body, dt, 1, true);
    step(soft, bSoft, dt, 0);
    step(glow, bGlow, dt, 1);
    if (screen) {
      const spd = ctx?.speed01 ?? (body ? (body.speed01 ?? 0) : last.speed01);
      const boosting = ctx?.boost01 ?? ((body?.boosting || boostFlash > 0) ? 1 : 0);
      // vignette only in the top third of the speed range, and gently
      screen.set(clamp((spd - 0.62) / 0.38, 0, 1) * 0.75, boosting);
      screen.tick(dt);
    }
  }

  // ── explicit spawns for the race scene ───────────────────────────────────

  /**
   * @param {'token'|'spark'|'land'|'boost'|'smoke'|'flash'} kind
   * @param {{x:number,y:number,z:number}} pos
   * @param {object} [op]  {power?, dirX?, dirZ?, surface?, warm?}
   */
  function spawn(kind, pos, op) {
    const x = pos?.x ?? last.x, y = pos?.y ?? last.y, z = pos?.z ?? last.z;
    const power = op?.power ?? 1;
    if (kind === 'token') burstToken(x, y, z);
    else if (kind === 'spark') burstSpark(x, y, z, Math.max(3, Math.round(16 * P * power)), power, op?.warm !== false);
    else if (kind === 'land') burstLanding(x, y, z, power, op?.surface || 'asphalt');
    else if (kind === 'boost') {
      burstBoost(x, y, z, op?.dirX ?? last.fx, op?.dirZ ?? last.fz, power);
      boostFlash = Math.max(boostFlash, 0.35 * power);
    } else if (kind === 'smoke') {
      driftPuff(x, y, z, op?.dirX ?? last.fx, op?.dirZ ?? last.fz, 0, 0, op?.tier ?? 0, power, 1);
    } else if (kind === 'flash') screen?.flash(op?.dir ?? 1);
  }

  // ── bus wiring — EXACTLY the events in EVENTS, and nothing else ──────────
  const offs = [];
  if (o.events !== false) {
    offs.push(bus.on('race:position', e => {
      // to < from means a place GAINED (position 3 -> 2)
      screen?.flash((e?.to ?? 0) <= (e?.from ?? 0) ? 1 : -1);
    }));
    offs.push(bus.on('drift:boost', e => {
      boostFlash = Math.max(boostFlash, 0.4);
      if (last.valid) {
        burstBoost(last.x - last.fx * 1.05, last.y + 0.42, last.z - last.fz * 1.05,
          last.fx, last.fz, 0.7 + 0.25 * (e?.tier ?? 1));
      }
    }));
    offs.push(bus.on('quiz:correct', () => {
      boostFlash = Math.max(boostFlash, 0.8);
      if (last.valid) {
        burstBoost(last.x - last.fx * 1.05, last.y + 0.42, last.z - last.fz * 1.05,
          last.fx, last.fz, 1.4);
        burstToken(last.x, last.y + 0.9, last.z);
      }
    }));
    offs.push(bus.on('kart:collide', e => {
      if (!last.valid) return;
      const wall = e?.kind === 'wall';
      burstSpark(last.x - last.fx * (wall ? 0.6 : 0), last.y + 0.45, last.z - last.fz * (wall ? 0.6 : 0),
        Math.max(3, Math.round((wall ? 16 : 11) * P)), wall ? 1 : 0.7, wall);
    }));
    if (o.tokenAuto !== false) {
      offs.push(bus.on('token:pickup', () => {
        if (last.valid) burstToken(last.x + last.fx * 0.6, last.y + 0.9, last.z + last.fz * 0.6);
      }));
    }
    offs.push(bus.on('quality:changed', nq => setQuality(nq)));
  }

  /** Rebuild the emission budget in place. Pool capacity is fixed at build. */
  function setQuality(nq) {
    P = nq?.particles ?? P;
    if (screen) screen.set(0, 0);
  }

  function dispose() {
    for (const off of offs) off();
    offs.length = 0;
    bSoft.geo.dispose(); bSoft.mat.dispose();
    bGlow.geo.dispose(); bGlow.mat.dispose();
    smokeTex.dispose(); glowTex.dispose();
    group.clear();
    screen?.dispose();
  }

  return {
    group,
    update,
    /**
     * Extra emitters (AI karts). Continuous families only — landing puffs,
     * collision sparks and boost bursts are edge-detected and belong to the ONE
     * kart passed to update(), so they are deliberately unavailable here.
     */
    emitFor: (body, dt, weight = 0.5) => emitFor(body, dt, weight, false),
    spawn,
    flash: dir => screen?.flash(dir ?? 1),
    setQuality,
    /** Live counts + budgets; used by the bench and any perf overlay. */
    stats() {
      return {
        soft: soft.n, glow: glow.n, live: soft.n + glow.n,
        capSoft, capGlow, drawCalls: 2,
        dropped: soft.dropped + glow.dropped,
        particles: P, rich, time,
      };
    },
    dispose,
  };
}

// ===========================================================================
// previews
// ===========================================================================

/** A stand-in for a KartBody: enough state to drive every emitter. */
function fakeBody(x, z) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(0, 0, 0),
    forward: new THREE.Vector3(0, 0, 1),
    speed01: 0.8, drifting: false, driftDir: 1, driftTier: 0, driftCharge01: 0,
    boosting: false, airborne: false, landingSquash: 0,
    offTrack: false, surfaceKind: 'sand', wallHit: 0, kartHit: 0,
  };
}

/** Boxy kart proxy — the FX are the subject; this is just something to attach to. */
function kartProxy(color, sink) {
  const g = new THREE.Group();
  const add = (w, h, d, col, x, y, z) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.15 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true;
    sink.push(geo, mat); g.add(m); return m;
  };
  add(1.3, 0.42, 2.2, color, 0, 0.44, 0);
  add(1.05, 0.34, 0.62, 0xff7a2f, 0, 0.78, -0.35);
  add(0.55, 0.34, 0.34, 0xf6e7c8, 0, 1.02, -0.35);
  add(0.62, 0.30, 0.30, 0xff7a2f, 0, 0.50, 1.25);
  const wheel = (wx, wz, r) => add(0.34, r * 2, r * 2, 0x22242e, wx, r, wz);
  wheel(0.80, -0.72, 0.46); wheel(-0.80, -0.72, 0.46);
  wheel(0.72, 0.80, 0.32); wheel(-0.72, 0.80, 0.32);
  return g;
}

// Golden-hour rig + a track-like ground so the FX are judged in context and not
// on black. Deliberately mirrors the art-bible lighting split (warm key, cool
// sky fill, horizon-tinted fog).
function buildPreviewScene(engine, sink) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.2, 900);
  const rig = applyTheme(scene, 'oasis', engine);

  const size = engine?.q?.texSize || 512;
  const road = asphaltTexture({ size, tint: 0x5f5a52 });
  const rmap = road.map.clone(); rmap.repeat.set(3, 26); rmap.needsUpdate = true;
  const rn = road.normalMap.clone(); rn.repeat.set(3, 26); rn.needsUpdate = true;
  const rr = road.roughnessMap.clone(); rr.repeat.set(3, 26); rr.needsUpdate = true;
  const roadGeo = new THREE.PlaneGeometry(24, 220);
  const roadMat = new THREE.MeshStandardMaterial({ map: rmap, normalMap: rn, roughnessMap: rr, roughness: 1 });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.rotation.x = -Math.PI / 2; roadMesh.position.y = 0.01; roadMesh.receiveShadow = true;
  scene.add(roadMesh);

  const sand = sandTexture({ size });
  const smap = sand.map.clone(); smap.repeat.set(16, 60); smap.needsUpdate = true;
  const groundGeo = new THREE.PlaneGeometry(400, 400);
  const groundMat = new THREE.MeshStandardMaterial({ map: smap, roughness: 1 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  // kerbs down both edges — instant "this is a race track" cue
  const curb = curbTexture({ size: 256, stripes: 3, axis: 'v' });
  const cmap = curb.map.clone(); cmap.repeat.set(1, 44); cmap.needsUpdate = true;
  const curbGeo = new THREE.BoxGeometry(1.1, 0.12, 220);
  const curbMat = new THREE.MeshStandardMaterial({ map: cmap, roughness: 0.9 });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(curbGeo, curbMat);
    m.position.set(s * 12.4, 0.06, 0); m.receiveShadow = true;
    scene.add(m);
  }
  // white edge lines
  const lineGeo = new THREE.PlaneGeometry(0.28, 220);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.85 });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(lineGeo, lineMat);
    m.rotation.x = -Math.PI / 2; m.position.set(s * 11.4, 0.03, 0);
    scene.add(m);
  }
  sink.push(roadGeo, roadMat, groundGeo, groundMat, curbGeo, curbMat, lineGeo, lineMat,
    rmap, rn, rr, smap, cmap);
  return { scene, camera, rig };
}

/** Everything at once: drift, boost, off-track spray, sparkles, sparks, landing. */
export function preview(engine) {
  const sink = [];
  const { scene, camera, rig } = buildPreviewScene(engine, sink);
  camera.fov = 52; camera.updateProjectionMatrix();
  camera.position.set(-7.0, 2.4, 4.5);
  camera.lookAt(3.0, 0.85, -9);

  const rng = makeRng(31337);
  // The screen layer is ON here so the speed vignette, the boost streaks and
  // the position-change sweep are judged in the same frame as the particles.
  const shadowFocus = new THREE.Vector3(2, 0, -6);
  const fx = createEffects(engine, { camera, rng });
  scene.add(fx.group);

  // Three karts, three states, driving AWAY from the camera so every trail
  // reads down the track instead of piling up on the lens.
  const lanes = [-4.0, 3.0, 15.0];    // third kart is out on the sand
  const bodies = lanes.map(x => fakeBody(x, 0));
  const proxies = bodies.map((b, i) => {
    const g = kartProxy([0xffc247, 0x59c8ff, 0xe8563f][i], sink);
    scene.add(g); return g;
  });
  bodies[0].drifting = true; bodies[0].driftTier = 3; bodies[0].driftCharge01 = 0.95; bodies[0].driftDir = 1;
  bodies[1].boosting = true; bodies[1].speed01 = 1;
  bodies[2].offTrack = true; bodies[2].surfaceKind = 'sand'; bodies[2].speed01 = 0.9;

  let t = 0, burst = 0, swept = false;
  return {
    scene, camera,
    update(dt) {
      t += dt;
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        // heading points down the track (-Z); weave a little so the trail curves
        const a = Math.PI + Math.sin(t * 0.6 + i * 1.7) * (i === 0 ? 0.30 : 0.10);
        b.forward.set(Math.sin(a), 0, Math.cos(a));
        b.position.x += b.forward.x * dt * 9;
        b.position.z += b.forward.z * dt * 9;
        if (b.position.z < -16) { b.position.z = 0; b.position.x = lanes[i]; }
        proxies[i].position.copy(b.position);
        proxies[i].rotation.y = a;
        proxies[i].rotation.z = i === 0 ? 0.09 : 0;
        fx.emitFor(b, dt, 1);
      }
      // one-shots on a short cycle so a capture at any t catches them
      burst += dt;
      if (burst > 0.5) {
        burst = 0;
        fx.spawn('token', { x: -0.5, y: 1.2, z: -4.0 });
        fx.spawn('spark', { x: -11.4, y: 0.7, z: -6.0 }, { power: 1.2 });
        if (rng() < 0.5) fx.spawn('land', { x: 8.0, y: 0.05, z: -11.0 }, { power: 1, surface: 'asphalt' });
      }
      // drive the screen layer as if the player were flat out and boosting
      fx.update(dt, null, { speed01: 0.97, boost01: 1 });
      // fire the position-change sweep late enough that the capture catches it
      if (!swept && t > 2.2) { swept = true; fx.flash(1); }
      // Keep the (deliberately tight) shadow box on the action — without this
      // its 44 m footprint is visible as a rectangle of shadowed ground.
      rig.setShadowFocus?.(shadowFocus);
      rig.update?.(dt, camera);
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { fx.dispose(); rig.dispose?.(); for (const d of sink) d.dispose?.(); },
  };
}

/** The three drift tiers side by side, held at charge. */
export function previewDrift(engine) {
  const sink = [];
  const { scene, camera, rig } = buildPreviewScene(engine, sink);
  camera.fov = 46; camera.updateProjectionMatrix();
  camera.position.set(0.4, 2.9, 5.0);
  camera.lookAt(0.2, 0.9, -9);

  const shadowFocus = new THREE.Vector3(0, 0, -8);
  const fx = createEffects(engine, { camera, rng: makeRng(9001), screen: false });
  scene.add(fx.group);

  const lanes = [-6.2, 0.2, 6.6];
  const bodies = lanes.map(x => fakeBody(x, -6));
  const proxies = bodies.map((b, i) => {
    const g = kartProxy([0x59c8ff, 0xff9a2e, 0xc06bff][i], sink);
    scene.add(g); return g;
  });
  bodies.forEach((b, i) => {
    b.drifting = true; b.driftTier = i + 1; b.driftDir = 1;
    b.driftCharge01 = [0.30, 0.65, 1.0][i]; b.speed01 = 0.92;
  });

  let t = 0;
  return {
    scene, camera,
    update(dt) {
      t += dt;
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        // a held right-hand drift: nose cocked in, path sweeping down the track
        const a = Math.PI - 0.34 + Math.sin(t * 0.8 + i) * 0.06;
        b.forward.set(Math.sin(a), 0, Math.cos(a));
        b.position.x += Math.sin(a + 0.34) * dt * 9;
        b.position.z += Math.cos(a + 0.34) * dt * 9;
        if (b.position.z < -16) { b.position.z = -4; b.position.x = lanes[i]; }
        proxies[i].position.copy(b.position);
        proxies[i].rotation.y = a;
        proxies[i].rotation.z = 0.11;
        fx.emitFor(b, dt, 1);
      }
      fx.update(dt, null);
      // Keep the (deliberately tight) shadow box on the action — without this
      // its 44 m footprint is visible as a rectangle of shadowed ground.
      rig.setShadowFocus?.(shadowFocus);
      rig.update?.(dt, camera);
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { fx.dispose(); rig.dispose?.(); for (const d of sink) d.dispose?.(); },
  };
}

/** Mini-boost release: flames, speed lines and the release burst, from behind. */
export function previewBoost(engine) {
  const sink = [];
  const { scene, camera, rig } = buildPreviewScene(engine, sink);
  camera.fov = 50; camera.updateProjectionMatrix();
  // Looking down-sun-side: the kart runs away from the low sun, so the flames
  // are read against shaded asphalt instead of against the glare.
  camera.position.set(0.9, 1.95, -5.0);
  camera.lookAt(-0.35, 0.88, 7);

  const shadowFocus = new THREE.Vector3(-0.4, 0, 0);
  const fx = createEffects(engine, { camera, rng: makeRng(4242), screen: false });
  scene.add(fx.group);

  const b = fakeBody(-0.4, 0);
  const proxy = kartProxy(0xffc247, sink);
  scene.add(proxy);
  b.boosting = true; b.speed01 = 1;

  let t = 0, re = 0;
  return {
    scene, camera,
    update(dt) {
      t += dt; re += dt;
      const a = Math.sin(t * 0.5) * 0.08;
      b.forward.set(Math.sin(a), 0, Math.cos(a));
      // the kart holds station; the world streams past it (see the speed lines)
      proxy.position.copy(b.position);
      proxy.rotation.y = a;
      fx.emitFor(b, dt, 1);
      if (re > 0.62) {
        re = 0;
        fx.spawn('boost', { x: b.position.x - b.forward.x * 1.05, y: b.position.y + 0.42, z: b.position.z - b.forward.z * 1.05 },
          { power: 1.3, dirX: b.forward.x, dirZ: b.forward.z });
      }
      fx.update(dt, null);
      // Keep the (deliberately tight) shadow box on the action — without this
      // its 44 m footprint is visible as a rectangle of shadowed ground.
      rig.setShadowFocus?.(shadowFocus);
      rig.update?.(dt, camera);
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { fx.dispose(); rig.dispose?.(); for (const d of sink) d.dispose?.(); },
  };
}

void UP_Y;

/** Debug: the two sprite atlases, alpha-composited over a mid-grey card. */
export function previewAtlas(engine) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2f3a);
  const camera = new THREE.OrthographicCamera(-2, 2, 1.125, -1.125, 0.1, 10);
  camera.position.z = 3;
  const a = smokeAtlas(512), b = glowAtlas(256);
  const mk = (tex, x) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    m.position.set(x, 0, 0); scene.add(m); return m;
  };
  const m1 = mk(a, -1), m2 = mk(b, 1);
  return { scene, camera, update() {}, dispose() { [m1, m2].forEach(m => { m.geometry.dispose(); m.material.dispose(); }); a.dispose(); b.dispose(); } };
}

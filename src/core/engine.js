// Engine: owns the WebGL renderer, the UI overlay root, quality tiers and the
// fixed-timestep loop. Scenes are plain objects — the game loop never touches the
// DOM shell beyond the single mount element, which is what makes the React port easy.
import * as THREE from 'three';
import { bus } from './bus.js';
import { save } from './save.js';
// style.js is deliberately dependency-free (see the modal-registry header in
// it), so core may import it without creating a cycle. This is the only thing
// engine.js takes from the UI layer.
import { clearModals } from '../ui/style.js';

// Quality tiers. `auto` starts at AUTO_START_TIER and is corrected DOWNWARD by a
// MEASURED probe (see below); the player can override in settings, and an
// explicit override is permanent — it is the only way to reach גבוה. Builders
// MUST read engine.q.* rather than hardcoding counts, so the low tier actually
// holds 60fps on a school laptop.
//
// `pixelRatio` is a CAP, not a ratio. It used to be resolved with
// `Math.min(devicePixelRatio, 2)` at MODULE LOAD, which meant two things: a
// retina machine paid for 4x the fragments at the high tier, and any later
// change of devicePixelRatio — dragging the window to a non-retina monitor, or a
// headless viewport override, which is how every gate sets its scale — could
// never reach the renderer, because the number had already been baked. The cap
// is now a plain constant and the effective ratio is resolved in
// effectivePixelRatio(), which setQuality() and resize() both call.
//
// 1.5 rather than 2 at the high tier: 2 costs 1.78x the fragments of 1.5 for a
// difference that is invisible at arm's length on the resolutions the layout
// gate uses (measured, see the Wave 5 perf report). נמוך is pinned at exactly 1.
export const TIERS = {
  low: {
    name: 'low', pixelRatio: 1, shadows: false, shadowSize: 512, antialias: false,
    propDensity: 0.35, crowdDensity: 0.25, particles: 0.3, drawDistance: 260,
    grassBlades: 0, reflections: false, texSize: 256,
  },
  medium: {
    name: 'medium', pixelRatio: 1, shadows: true, shadowSize: 1024, antialias: true,
    propDensity: 0.7, crowdDensity: 0.6, particles: 0.7, drawDistance: 420,
    grassBlades: 1, reflections: false, texSize: 512,
  },
  high: {
    name: 'high', pixelRatio: 1.5, shadows: true, shadowSize: 2048,
    antialias: true, propDensity: 1, crowdDensity: 1, particles: 1, drawDistance: 700,
    grassBlades: 2, reflections: true, texSize: 1024,
  },
};

/**
 * Effective device pixel ratio for a tier: the display's ratio, capped by the
 * tier, floored at 1 so נמוך is exactly 1.0 on every machine (a browser zoomed
 * out to dpr 0.8 must not silently render the low tier softer still).
 */
export function effectivePixelRatio(q, dpr) {
  const d = Number.isFinite(dpr) ? dpr
    : (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
  return Math.min(Math.max(d, 1), q.pixelRatio);
}

// ── automatic tier selection ────────────────────────────────────────────────
// The old probe read navigator.deviceMemory / hardwareConcurrency and handed
// `high` to almost every machine, including ones with eight weak cores and no
// GPU worth the name — the exact laptop a school actually owns. Those numbers
// describe the CPU and say nothing about the thing that is slow here, which is
// the renderer. So we measure instead: the tier starts at AUTO_START_TIER and
// the loop samples the frame times it is already producing.
//
// Cheap by construction — it allocates one array of 60 numbers and reads a `dt`
// the loop had computed anyway. It cannot stall the first paint because it does
// no work before a frame; the first PROBE.warmupFrames are discarded so that
// shader compilation and texture upload, which happen once, are not mistaken for
// the steady state.
//
// THREE tier constants, and the difference between them is the whole policy:
//
//   AUTO_TIER       the FIXED tier a boot lands on when nobody arms the probe.
//                   Gates, previews and the capture harness get this — see the
//                   opt-in note below — and it must not move, or every
//                   screenshot baseline in the repo silently shifts.
//   AUTO_START_TIER where an AUTO session (a real child, probe armed) begins.
//   AUTO_MAX_TIER   the ceiling automatic detection may ever reach.
//
// Wave 5.1 policy change: automatic detection selects AT MOST בינוני. גבוה is
// manual-only. Two reasons, and the second is the one that decided it:
//   * the measured probe picked גבוה on a strong laptop and then the machine ran
//     hot — a fan at full tilt in a classroom is a worse experience than a
//     slightly softer sky;
//   * a session that starts at גבוה and is demoted 60 frames later CHANGES ON
//     SCREEN in front of the child. Shadows and reflections pop off a second
//     after the title lands, which reads as a bug. So an auto session starts at
//     בינוני and the probe may only lower it — never raise it.
// An explicit choice of גבוה in settings still works and still outranks the
// probe forever; see setQuality().
export const AUTO_TIER = 'high';
export const AUTO_START_TIER = 'medium';
export const AUTO_MAX_TIER = 'medium';
// 20 + 40 frames: a third of a second on a machine that is fine, and — the case
// that matters — only 60 frames on one that is not, which at 5fps is still a
// twelve-second wait before the tier is corrected. Longer windows measure no
// better; the median of 40 already survives a GC pause.
//
// `mediumMs` is now the only threshold: the probe runs AT בינוני and answers one
// question — can this machine hold it? 34ms is ~30fps. (There was a `highMs`
// here, for "fast enough to stay at גבוה". Automatic selection can no longer
// reach גבוה at all, so a threshold for it would be a knob wired to nothing,
// which is exactly the lie this file's own gate exists to forbid.)
export const PROBE = { warmupFrames: 20, sampleFrames: 40, mediumMs: 34 };

/**
 * Median real frame time (ms) measured at AUTO_START_TIER -> the tier that
 * machine should run. Never returns 'high': automatic detection is capped at
 * AUTO_MAX_TIER by policy, and a garbage measurement falls back to the tier the
 * session already started on rather than promoting anything.
 */
export function tierFromFrameTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return AUTO_START_TIER;
  if (ms <= PROBE.mediumMs) return AUTO_MAX_TIER;   // >= 30fps at בינוני: stay
  return 'low';                                     // it cannot hold בינוני
}

// THE PROBE IS OPT-IN, AND THAT IS WHY THERE IS NO `navigator.webdriver` HERE.
//
// A probe that reacts to measured frame time would hand every gate and every
// preview whatever tier SwiftShader happened to be slow enough to earn that
// minute, and a screenshot silently taken at a different tier reads as a
// rendering regression in someone else's review. So gates must land on a fixed
// tier — but the way to get that is NOT to ask the page whether it is being
// automated. D35 rejected `navigator.webdriver` for changing what a gate sees,
// and the honest reading of that decision is about the MECHANISM, not only the
// symptom: a build that behaves one way for a child and another for a gate is
// the defect, whichever direction the difference runs.
//
// Inverted instead: nothing arms the probe unless someone explicitly asks. The
// production entry point (main.js) calls `engine.enableQualityProbe()`; the
// capture harness and every gate simply never call it, and get AUTO_TIER by
// construction rather than by detection. The game and the gate then run the
// same code, and the difference is one line the reader can see at the call
// site instead of a sniff buried three files away.

/**
 * What tier a boot starts at, given the saved `quality` key.
 * `auto` (the default) means nobody has chosen and the probe may correct it;
 * a tier name is the player's own choice and outranks any measurement, forever.
 *
 * `probing` says whether this boot will actually arm the probe — i.e. whether a
 * child is playing (main.js) or a gate is capturing (everything else). Only the
 * probing answer is subject to the AUTO_START_TIER policy; a non-probing boot
 * lands on the fixed AUTO_TIER exactly as it always has, which is what keeps
 * every screenshot baseline in the repo where it is.
 */
export function resolveInitialTier(saved, { probing = false } = {}) {
  const explicit = !!(saved && saved !== 'auto' && TIERS[saved]);
  if (explicit) return { name: saved, autoTier: false };
  return { name: probing ? AUTO_START_TIER : AUTO_TIER, autoTier: true };
}

const FIXED = 1 / 60;         // physics step
const MAX_FRAME = 0.25;       // never simulate more than this after a stall

class Engine {
  constructor() {
    this.scenes = new Map();
    this.active = null;
    this.activeName = null;
    this.paused = false;
    this.time = 0;
    this._acc = 0;
    this._last = 0;
    this._raf = 0;
    this._headless = false;   // when true the harness drives stepping manually
    this.hidden = false;      // document.hidden — no step, no draw, audio suspended
    this.autoTier = true;     // false once the player has chosen a tier by hand
    this._probe = null;       // live frame-time probe, or null
    this.probedFrameMs = 0;   // what the probe measured, for the report/overlay
    this.fps = 60;
    this._fpsSamples = [];
    this._lastDraw = 0;      // wall clock of the last presented frame (scene maxFps)
    this._gotoTicket = 0;    // monotonic navigation ticket — the last caller wins
  }

  init(mountEl) {
    this.el = mountEl;
    const start = resolveInitialTier(save.read('quality'));
    this.autoTier = start.autoTier;
    this.q = TIERS[start.name];

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'gl';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    mountEl.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.q.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(effectivePixelRatio(this.q));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES gives the warm filmic rolloff the reference art has in its skies.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // UI overlay root — all HUD/menus are DOM, which is the only sane way to get
    // correct RTL Hebrew text shaping and accessible focus order.
    this.ui = document.createElement('div');
    this.ui.id = 'ui';
    Object.assign(this.ui.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    mountEl.appendChild(this.ui);

    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
    // A window `resize` event is not the only way the canvas changes size, and
    // relying on it left `width`/`height` — and the renderer's backing store —
    // stuck at their boot values for as long as one was never delivered. Two
    // real cases: the mount element resizing while the window does not (the
    // React embedding this project advertises), and headless Chrome, which does
    // not reliably fire `resize` for the first viewport override — measured
    // `engine.width === 800` on a 1920px page, which is how a stale layout
    // reached a gate. Observe the element itself; the window listener stays for
    // device-pixel-ratio changes that do not alter the element's box.
    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this.el);
    }

    // A backgrounded tab must cost nothing: no simulation, no draw, no synth.
    // Chrome already throttles rAF when hidden, so without this the game did not
    // burn much — but it did keep the audio graph running, and it came back with
    // a stalled clock.
    if (typeof document !== 'undefined') {
      this._onVisibility = () => this.setHidden(!!document.hidden);
      document.addEventListener('visibilitychange', this._onVisibility);
      this.hidden = !!document.hidden;
    }

    this.resize();
    return this;
  }

  /**
   * Arm the measured quality probe. Called by main.js and by nothing else — see
   * the note above `AUTO_TIER`. A no-op when the player has chosen a tier
   * explicitly (their choice outranks any measurement, forever) and when the
   * harness is driving the loop by hand, where there is no real frame time to
   * measure in the first place.
   */
  enableQualityProbe() {
    if (!this.autoTier || this._headless) return this;
    // The auto session's starting tier is applied HERE, before the first frame
    // is ever drawn, rather than in init(): init() is shared with every gate and
    // preview, and they must keep landing on the fixed AUTO_TIER. Applying it at
    // the moment the probe is armed is also what makes "never visibly starts on
    // גבוה and drops" true — nothing has been rendered yet.
    const start = resolveInitialTier(save.read('quality'), { probing: true });
    if (start.name !== this.q?.name) this._applyTier(start.name);
    this._probe = { warm: PROBE.warmupFrames, samples: [] };
    return this;
  }

  /**
   * Pin a tier for the CAPTURE HARNESS: apply it, end any probe, and record
   * nothing as a player choice (so the save is untouched and a later boot is
   * unaffected). core/harness.js calls this so the tier a gate or a preview
   * screenshot renders at is STATED at one visible call site, instead of being
   * inherited from whatever init() happened to default to — see D35 and the
   * opt-in note above. Never called by the game.
   */
  pinQuality(name) {
    if (!TIERS[name]) return this;
    this._probe = null;
    if (this.q?.name !== name) this._applyTier(name);
    return this;
  }

  /**
   * Apply a tier WITHOUT recording it as the player's choice. Used by the probe.
   * setQuality() is the one that persists — see the 'auto' note in init().
   */
  _applyTier(name) {
    if (!TIERS[name]) return;
    this.q = TIERS[name];
    if (this.renderer) {
      this.renderer.setPixelRatio(effectivePixelRatio(this.q));
      this.renderer.shadowMap.enabled = this.q.shadows;
    }
    this.resize();
    // Scenes rebuild their prop/particle budgets on this signal.
    bus.emit('quality:changed', this.q);
  }

  setQuality(name) {
    if (!TIERS[name]) return;
    // An explicit choice ends the probe permanently, in this session and every
    // later one: `quality` in the save is now a tier name rather than 'auto'.
    this.autoTier = false;
    this._probe = null;
    save.set({ quality: name });
    this._applyTier(name);
  }

  /** Hidden-tab handling. Public so a gate can drive it without a real document. */
  setHidden(hidden) {
    hidden = !!hidden;
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (hidden) {
      bus.emit('audio:suspend');
    } else {
      // Come back on a clean clock. MAX_FRAME clamps one huge frame, and the
      // 8-step guard bounds the catch-up, but neither stops the accumulator
      // from carrying a stale partial step across a five-minute absence — so
      // reset both rather than relying on the clamp alone (D5/D11).
      this._last = typeof performance !== 'undefined' ? performance.now() : 0;
      this._acc = 0;
      bus.emit('audio:resume');
    }
  }

  resize() {
    const w = this.el.clientWidth || innerWidth;
    const h = this.el.clientHeight || innerHeight;
    this.width = w; this.height = h;
    // Resolved here, not at module load: `resize` is exactly the event that
    // fires when devicePixelRatio changes (monitor swap, browser zoom, and the
    // headless viewport overrides the gates use).
    const pr = effectivePixelRatio(this.q);
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.active?.resize) this.active.resize(w, h);
    bus.emit('resize', { w, h });
  }

  register(name, factory) { this.scenes.set(name, factory); return this; }

  // Scene contract: factory(engine, opts) -> {
  //   scene, camera, update(dt), render?(), resize?(w,h), dispose(), enter?(), exit?()
  // }
  /**
   * Change scene.
   *
   * RE-ENTRANCY. A scene factory is asynchronous and some of them are SLOW —
   * the race builds a track, eight karts and their textures (measured at ~1.8s
   * under SwiftShader, hundreds of ms on real hardware). Anything that can fire
   * twice inside that window used to corrupt this method in two ways at once:
   *
   *   * the second call re-entered while `this.active` still pointed at the
   *     scene the FIRST call had already disposed, and disposed it again —
   *     a second `exit()`, a second `dispose()`, and for a menu screen a second
   *     `releaseBackdrop()` against a refcount that had only been taken once;
   *   * the scene the first call was building was then assigned to
   *     `this.active` and immediately overwritten by the second, so it was
   *     never disposed at all. MEASURED: one double-`goto` orphaned an entire
   *     race scene — menu bus handlers 10 → 37 and staying there — with its
   *     input listeners and its GPU geometry, permanently, per occurrence.
   *
   * Both are fixed by two lines that cost nothing: the old scene is FORGOTTEN
   * the moment it is disposed (so nothing can dispose it twice), and every call
   * takes a ticket. The last caller wins — which is the right answer for a
   * child, because the last thing they asked for is the thing they want — and a
   * superseded build is disposed instead of being left running behind the
   * screen. Not a mutex: a navigation that is genuinely wanted (Escape out of a
   * race that is still loading) must not be swallowed by one that is stale.
   */
  async goto(name, opts = {}) {
    const factory = this.scenes.get(name);
    if (!factory) { console.error(`no scene "${name}"`); return; }
    const ticket = ++this._gotoTicket;
    const from = this.activeName;    // captured before `active` is forgotten
    if (this.active) {
      const leaving = this.active;
      this.active = null;              // forgotten BEFORE the await, not after
      this.activeName = null;
      try { leaving.exit?.(); leaving.dispose?.(); } catch (e) { console.error('scene dispose failed', e); }
      this.ui.replaceChildren();
      // Every panel is provably gone — its DOM was just wiped — so the modal
      // registry must say so. A leaked id used to be merely untidy; since the
      // audio ducks on the registry (D31/D34) a phantom id mutes the engine and
      // the world for the rest of the session, with nothing on screen to
      // explain it. Note `dispose()` above runs in a try/catch precisely
      // because it may throw halfway through its own popModal calls.
      clearModals();
    }
    bus.emit('scene:leaving', from);
    const built = await factory(this, opts);
    if (ticket !== this._gotoTicket) {
      // Superseded while we were building. Throw away what we built rather than
      // showing it or, worse, leaving it alive with nothing pointing at it.
      try { built?.exit?.(); built?.dispose?.(); } catch (e) { console.error('superseded scene dispose failed', e); }
      return null;
    }
    this.active = built;
    this.activeName = name;
    this.active.resize?.(this.width, this.height);
    this.active.enter?.();
    this._acc = 0;
    // A new scene always presents its first frame immediately, whatever cap it
    // declares — otherwise the previous scene's last frame stays on screen.
    this._lastDraw = 0;
    bus.emit('scene:entered', name);
    return this.active;
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    const loop = now => {
      this._raf = requestAnimationFrame(loop);
      if (this._headless) return;
      // Backgrounded: keep the frame request alive so the loop resumes by
      // itself, but do no work and — critically — keep `_last` current, so the
      // return frame is one frame long rather than the length of the absence.
      if (this.hidden) { this._last = now; return; }
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (dt > MAX_FRAME) dt = MAX_FRAME;
      this._probeFrame(dt);
      this._fpsSamples.push(dt);
      if (this._fpsSamples.length > 30) {
        this.fps = 1 / (this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length);
        this._fpsSamples.length = 0;
      }
      this.step(dt);
      this.draw();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this._raf); this._raf = 0; }

  /**
   * One frame of the auto-tier probe. Called from the loop with the frame's real
   * dt (seconds), already clamped. Median of `sampleFrames` samples, so a single
   * GC pause or a dropped frame cannot demote a machine that is fine.
   */
  _probeFrame(dt) {
    const p = this._probe;
    if (!p) return;
    // Anything that makes the sample unrepresentative ends the probe rather than
    // pausing it: a harness driving the frames, or a tab that was backgrounded.
    if (this._headless || this.hidden) { this._probe = null; return; }
    if (p.warm > 0) { p.warm--; return; }
    p.samples.push(dt * 1000);
    if (p.samples.length < PROBE.sampleFrames) return;
    this._probe = null;
    const s = p.samples.slice().sort((a, b) => a - b);
    const med = s[s.length >> 1];
    this.probedFrameMs = med;
    const tier = tierFromFrameTime(med);
    if (tier !== this.q.name) this._applyTier(tier);
    bus.emit('quality:probed', { frameMs: med, tier });
  }

  /**
   * Full teardown, as opposed to `stop()`, which only parks the animation frame
   * and is reused for pausing. Called by `boot()`'s `destroy()`; without it a
   * React remount stacks a fresh window listener and ResizeObserver on every
   * mount, each holding a reference to a dead engine.
   */
  teardown() {
    this.stop();
    removeEventListener('resize', this._onResize);
    if (this._onVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibility);
      this._onVisibility = null;
    }
    this._probe = null;
    this._ro?.disconnect();
    this._ro = null;
  }

  // Fixed-timestep accumulator: identical results regardless of framerate, which
  // is what makes the AI and the screenshot harness deterministic.
  step(dt) {
    if (this.paused || this.hidden || !this.active) return;
    this._acc += dt;
    let guard = 0;
    while (this._acc >= FIXED && guard++ < 8) {
      this.time += FIXED;
      try { this.active.update(FIXED); } catch (e) { console.error('scene update failed', e); this.paused = true; }
      this._acc -= FIXED;
    }
  }

  /**
   * Present one frame.
   *
   * A scene may declare `maxFps` to be drawn at less than the display rate. The
   * menus do (30): their backdrop is a live slice of a race, and a title screen
   * left open on a desk was rendering 552 draw calls and 1.2M triangles sixty
   * times a second for as long as the child was away — which is a fan at full
   * tilt for a picture that is deliberately out of focus. Skipping the frame
   * leaves the previous one on screen: nothing is cleared, so the canvas simply
   * holds, and the DOM menu on top of it animates at the full rate regardless.
   *
   * `force` bypasses the cap; the capture harness passes it, because a
   * screenshot must photograph a frame drawn NOW rather than whatever the
   * throttle last left in the buffer.
   */
  draw(force = false) {
    if (!this.active) return;
    const cap = this.active.maxFps;
    if (!force && cap > 0) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (this._lastDraw && now - this._lastDraw < 1000 / cap - 1) return;
      this._lastDraw = now;
    }
    if (this.active.render) this.active.render();
    else if (this.active.scene && this.active.camera) this.renderer.render(this.active.scene, this.active.camera);
  }
}

export const engine = new Engine();
export { THREE };

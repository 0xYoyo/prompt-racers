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

// Quality tiers. `auto` picks on first boot from a quick device probe; the player
// can override in settings. Builders MUST read engine.q.* rather than hardcoding
// counts, so the low tier actually holds 60fps on a school laptop.
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
    name: 'high', pixelRatio: Math.min(devicePixelRatio || 1, 2), shadows: true, shadowSize: 2048,
    antialias: true, propDensity: 1, crowdDensity: 1, particles: 1, drawDistance: 700,
    grassBlades: 2, reflections: true, texSize: 1024,
  },
};

function probeTier() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (mem <= 4 && cores <= 4) return 'medium';
  if (cores <= 2) return 'low';
  return 'high';
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
    this.fps = 60;
    this._fpsSamples = [];
  }

  init(mountEl) {
    this.el = mountEl;
    let q = save.read('quality');
    if (!q || q === 'auto') q = probeTier();
    this.q = TIERS[q] || TIERS.high;

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
    this.renderer.setPixelRatio(this.q.pixelRatio);
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
    this.resize();
    return this;
  }

  setQuality(name) {
    if (!TIERS[name]) return;
    this.q = TIERS[name];
    save.set({ quality: name });
    this.renderer.setPixelRatio(this.q.pixelRatio);
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.resize();
    // Scenes rebuild their prop/particle budgets on this signal.
    bus.emit('quality:changed', this.q);
  }

  resize() {
    const w = this.el.clientWidth || innerWidth;
    const h = this.el.clientHeight || innerHeight;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    if (this.active?.resize) this.active.resize(w, h);
    bus.emit('resize', { w, h });
  }

  register(name, factory) { this.scenes.set(name, factory); return this; }

  // Scene contract: factory(engine, opts) -> {
  //   scene, camera, update(dt), render?(), resize?(w,h), dispose(), enter?(), exit?()
  // }
  async goto(name, opts = {}) {
    const factory = this.scenes.get(name);
    if (!factory) { console.error(`no scene "${name}"`); return; }
    if (this.active) {
      try { this.active.exit?.(); this.active.dispose?.(); } catch (e) { console.error('scene dispose failed', e); }
      this.ui.replaceChildren();
      // Every panel is provably gone — its DOM was just wiped — so the modal
      // registry must say so. A leaked id used to be merely untidy; since the
      // audio ducks on the registry (D31/D34) a phantom id mutes the engine and
      // the world for the rest of the session, with nothing on screen to
      // explain it. Note `dispose()` above runs in a try/catch precisely
      // because it may throw halfway through its own popModal calls.
      clearModals();
    }
    bus.emit('scene:leaving', this.activeName);
    this.active = await factory(this, opts);
    this.activeName = name;
    this.active.resize?.(this.width, this.height);
    this.active.enter?.();
    this._acc = 0;
    bus.emit('scene:entered', name);
    return this.active;
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    const loop = now => {
      this._raf = requestAnimationFrame(loop);
      if (this._headless) return;
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (dt > MAX_FRAME) dt = MAX_FRAME;
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
   * Full teardown, as opposed to `stop()`, which only parks the animation frame
   * and is reused for pausing. Called by `boot()`'s `destroy()`; without it a
   * React remount stacks a fresh window listener and ResizeObserver on every
   * mount, each holding a reference to a dead engine.
   */
  teardown() {
    this.stop();
    removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
    this._ro = null;
  }

  // Fixed-timestep accumulator: identical results regardless of framerate, which
  // is what makes the AI and the screenshot harness deterministic.
  step(dt) {
    if (this.paused || !this.active) return;
    this._acc += dt;
    let guard = 0;
    while (this._acc >= FIXED && guard++ < 8) {
      this.time += FIXED;
      try { this.active.update(FIXED); } catch (e) { console.error('scene update failed', e); this.paused = true; }
      this._acc -= FIXED;
    }
  }

  draw() {
    if (!this.active) return;
    if (this.active.render) this.active.render();
    else if (this.active.scene && this.active.camera) this.renderer.render(this.active.scene, this.active.camera);
  }
}

export const engine = new Engine();
export { THREE };

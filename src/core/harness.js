// Shared boot + capture harness, used by both the real entry point and by the
// isolated module previews that builders/critics screenshot.
import { engine } from './engine.js';
import { Raycaster, Vector3, Quaternion } from 'three';
import { audio } from '../audio/audio.js';   // re-exported for the gates; main.js owns the real import
import { save } from './save.js';
import { applyDir, setLang } from '../ui/i18n.js';
import { injectStyles } from '../ui/style.js';

export function installDebug() {
  const D = {
    ready: false,
    engine,
    async goto(scene, o = {}) {
      // Must go through setLang: it updates i18n's module-level `lang` that t()
      // reads. Only touching save+applyDir flips direction but leaves every
      // string in Hebrew, which silently broke --lang en for all modules.
      if (o.lang) setLang(o.lang);
      if (o.quality) engine.setQuality(o.quality);
      engine._headless = true;
      await engine.goto(scene, o);
      await new Promise(r => setTimeout(r, 60));
    },
    advance(seconds) {
      const FIXED = 1 / 60;
      const steps = Math.round(seconds / FIXED);
      for (let i = 0; i < steps; i++) { engine.time += FIXED; engine.active?.update(FIXED); }
    },
    renderOnce() { engine.draw(); },
    state: () => ({ scene: engine.activeName, fps: engine.fps, quality: engine.q.name }),
  };
  window.__DEBUG = D;
  // Handles the automated P0 gates need (tools/flowtest.mjs). Read-only; no game
  // code depends on these, so they remain strippable.
  // Only the classes the flow gates need. Materialising the whole THREE
  // namespace retains FileLoader/ImageBitmapLoader, whose network calls trip the
  // compliance scan for no runtime reason.
  window.__THREE__ = { Raycaster, Vector3, Quaternion };
  window.__AUDIO__ = audio;
  requestAnimationFrame(() => requestAnimationFrame(() => { D.ready = true; }));
  return D;
}

// Boots a SINGLE scene factory in isolation. This is what lets a subsystem be
// built and judged on its own rendered output before integration.
export function bootPreview(factory) {
  const el = document.getElementById('app');
  el.querySelector('#boot')?.remove();
  injectStyles();
  applyDir();
  engine.init(el);
  engine.register('menu', factory);
  engine.register('preview', factory);
  engine.start();
  engine.goto('preview', {});
  installDebug();
}

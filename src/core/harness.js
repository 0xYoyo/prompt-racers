// Shared boot + capture harness, used by both the real entry point and by the
// isolated module previews that builders/critics screenshot.
import { engine, AUTO_TIER } from './engine.js';
import { bus } from './bus.js';
import { Raycaster, Vector3, Quaternion } from 'three';
import { audio } from '../audio/audio.js';   // re-exported for the gates; main.js owns the real import
import { save } from './save.js';
import { applyDir, setLang } from '../ui/i18n.js';
import { injectStyles, setTeachingClock } from '../ui/style.js';

// THE TIER EVERY GATE, PREVIEW AND SCREENSHOT RENDERS AT.
//
// It has always been `AUTO_TIER`, but it used to arrive by omission: a gate got
// it because nothing had called `enableQualityProbe()`, and because the probe
// that main.js does arm rarely finished before the harness took the loop over.
// Two things then made that inheritance unsafe. Wave 5.1 caps automatic
// detection at בינוני, so "whatever a boot defaults to" is no longer one number;
// and a probe that DID happen to finish first (a slow SwiftShader minute, a
// machine under load) would silently photograph a different tier — a screenshot
// baseline shifting under a reviewer with nothing in the diff to explain it.
//
// So the harness now STATES it. One visible call site, the same value the
// repo's baselines were captured at, and no dependence on which of two callers
// won a race. This is not a `navigator.webdriver` sniff (D35): the game does not
// ask whether it is being automated — the automation says so itself, here, in
// the file that exists only for it.
export const HARNESS_TIER = AUTO_TIER;

/**
 * Pin HARNESS_TIER, unless the run has an explicit tier of its own — a save
 * seeded with `quality: 'low'` (tools/flowtest.mjs does exactly that) is the
 * gate author saying which tier they want, and `engine.autoTier` is already the
 * flag for "nobody has chosen". Pinning over it would be the harness overruling
 * the gate.
 */
function pinHarnessTier() { if (engine.autoTier) engine.pinQuality(HARNESS_TIER); }

export function installDebug() {
  const D = {
    ready: false,
    engine,
    async goto(scene, o = {}) {
      // Must go through setLang: it updates i18n's module-level `lang` that t()
      // reads. Only touching save+applyDir flips direction but leaves every
      // string in Hebrew, which silently broke --lang en for all modules.
      if (o.lang) setLang(o.lang);
      // An explicit `quality` is the caller's own choice (tools/perfprobe.mjs
      // sweeps all three tiers); otherwise pin the harness tier — see above.
      if (o.quality) engine.setQuality(o.quality);
      else pinHarnessTier();
      engine._headless = true;
      await engine.goto(scene, o);
      await new Promise(r => setTimeout(r, 60));
    },
    advance(seconds) {
      const FIXED = 1 / 60;
      const steps = Math.round(seconds / FIXED);
      for (let i = 0; i < steps; i++) { engine.time += FIXED; engine.active?.update(FIXED); }
    },
    // `true` = force: a scene may declare a maxFps (the menus cap their backdrop
    // at 30), and a screenshot must photograph a frame drawn NOW rather than
    // whatever the throttle last left in the buffer.
    renderOnce() { engine.draw(true); },
    state: () => ({ scene: engine.activeName, fps: engine.fps, quality: engine.q.name }),
    // The gates need to inject the events a subsystem reacts to without having
    // to produce the gameplay that normally raises them — the crowd's cheer, for
    // one, cannot otherwise be made live during the countdown, which is exactly
    // the moment its clock jumps backwards.
    bus,
  };
  // The teaching-card cadence (ui/style.js) is wall-clock by default, and every
  // gate steps the sim faster than real time — so under a harness no wall time
  // passes between boxes and every explainer after the first defers forever
  // (measured: flowtest --only=play 34/34 → 31/34, one box a race). `engine.time`
  // is the clock that actually matches "seconds of game the child has watched":
  // it advances by the frame dt in production, by the stepped dt under a gate,
  // and in neither case while the game is paused or the tab is in the background.
  //
  // Deliberately NOT guarded behind `_headless`, though it sits in the harness:
  // a cadence that behaves one way for a child and another way for a gate is
  // precisely D35's rejected `navigator.webdriver` shortcut wearing a different
  // hat, on the one sequence every first race opens with. Same clock for both.
  setTeachingClock(() => engine.time);
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
  // Stated, not inherited — same reason as HARNESS_TIER above. A preview never
  // arms the probe, so this changes nothing about what it renders; it makes the
  // tier a reader can see rather than one they have to derive.
  pinHarnessTier();
  engine.register('menu', factory);
  engine.register('preview', factory);
  engine.start();
  engine.goto('preview', {});
  installDebug();
}

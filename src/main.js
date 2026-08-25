// Entry point + DOM shell boundary.
//
// PORTING NOTE: everything below the boot() call is DOM-shell-free. To drop this
// into React:  useEffect(() => { const g = boot(ref.current); return () => g.destroy(); }, [])
// No globals are required by the game itself — window.__DEBUG exists only for the
// automated screenshot harness and is stripped-safe (nothing reads it internally).
import { engine } from './core/engine.js';
import { bus } from './core/bus.js';
import { installDebug } from './core/harness.js';
import { applyDir } from './ui/i18n.js';
import { injectStyles } from './ui/style.js';
// PRODUCTION IMPORT — do not remove. audio.js self-wires to the bus and is not
// referenced by name anywhere, so without an explicit import esbuild tree-shakes the
// entire synth engine out of the bundle and the game ships completely silent. That
// exact bug shipped once (dist contained zero `createOscillator` calls). It briefly
// survived only because the debug capture harness imported it, which a stripped
// release build would have removed again.
import { audio } from './audio/audio.js';
import { SCENES } from './scenes.js';

export function boot(mountEl, opts = {}) {
  injectStyles();
  audio.init();
  applyDir();
  engine.init(mountEl);
  // The measured quality probe is armed HERE and nowhere else: this is the only
  // entry point a child ever comes through, so gates and previews get the fixed
  // AUTO_TIER by construction rather than by sniffing for a test harness (see
  // the note above AUTO_TIER in engine.js, and D35).
  engine.enableQualityProbe();
  for (const [name, factory] of Object.entries(SCENES)) engine.register(name, factory);
  engine.start();
  engine.goto(opts.scene || 'menu', opts.sceneOpts || {});

  return {
    engine,
    destroy() {
      engine.teardown();
      bus.clear();
      mountEl.replaceChildren();
    },
  };
}

const el = document.getElementById('app');
if (el) {
  el.querySelector('#boot')?.remove();
  try {
    boot(el);
    installDebug();   // capture harness only; no game code depends on it
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div style="color:#ff8080;font:14px/1.5 monospace;padding:24px;direction:ltr">BOOT FAILED\n${e.stack || e.message}</div>`;
  }
}

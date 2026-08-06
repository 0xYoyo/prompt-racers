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
import { SCENES } from './scenes.js';

export function boot(mountEl, opts = {}) {
  injectStyles();
  applyDir();
  engine.init(mountEl);
  for (const [name, factory] of Object.entries(SCENES)) engine.register(name, factory);
  engine.start();
  engine.goto(opts.scene || 'menu', opts.sceneOpts || {});

  return {
    engine,
    destroy() {
      engine.stop();
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

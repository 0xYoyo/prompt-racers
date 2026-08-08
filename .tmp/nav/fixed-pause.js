// PAUSE — the overlay a child reaches with Escape, plus the small controller that
// owns the paused state.
//
// Split deliberately in two:
//   • pauseOverlay()        — pure UI. It owns NOTHING about the simulation; it
//                             just calls back. It can be previewed on its own.
//   • attachPauseControl()  — the state owner. It freezes the sim, emits
//                             race:pause / race:resume, and toggles on Escape.
//
// The freeze is two things, because pausing only one of them is a bug we already
// shipped once elsewhere: `engine.paused = true` halts the fixed-step clock (no
// time debt accumulates — Engine.step() returns before touching the accumulator),
// and `scene.setPaused(true)` disables input so a held throttle cannot leak
// through. Rendering keeps running, so the overlay sits over a frozen frame.
import { h, pushModal, popModal, modalHas } from './style.js';
import { registerStrings, t } from './i18n.js';
import { bus } from '../core/bus.js';
import { overlayRoot, appendAll, settingsOverlay, backdropScene, attachHomeControl } from './menus.js';

/* ═════════════════════════════════════════════════════════════════ strings ══ */
// Same voice as the rest of the game: impersonal present tense, gender-neutral.
// "יציאה", "ממשיכים", "יוצאים" — never "צא" / "אתה".
registerStrings({
  he: {
    'menu.pause.title': 'הפסקה',
    'menu.pause.sub': 'המרוץ עוצר ומחכה',
    'menu.pause.resume': 'ממשיכים',
    'menu.pause.settings': 'הגדרות',
    'menu.pause.quit': 'יציאה למסך הבית',
    'menu.pause.hint': 'לוחצים Esc כדי לחזור למרוץ',
    // A child WILL hit "quit" mid-race by accident, so it always asks first.
    'menu.pause.quitAsk': 'לצאת מהמרוץ?',
    'menu.pause.quitWarn': 'המרוץ הזה ייעצר ויתחיל מחדש בפעם הבאה. הטוקנים והחלקים שכבר נשמרו נשארים.',
    'menu.pause.quitNo': 'לא, ממשיכים במרוץ',
    'menu.pause.quitYes': 'כן, יוצאים',
  },
  en: {
    'menu.pause.title': 'Paused',
    'menu.pause.sub': 'The race is waiting',
    'menu.pause.resume': 'Resume',
    'menu.pause.settings': 'Settings',
    'menu.pause.quit': 'Quit to Home',
    'menu.pause.hint': 'Press Esc to get back to the race',
    'menu.pause.quitAsk': 'Leave the race?',
    'menu.pause.quitWarn': 'This race stops and starts over next time. Tokens and parts already saved stay saved.',
    'menu.pause.quitNo': 'No, keep racing',
    'menu.pause.quitYes': 'Yes, leave',
  },
});

/* ═════════════════════════════════════════════════════════════════════ css ══ */

const PAUSE_CSS = `
.mn-dialog.pause{width:min(420px,100%);text-align:center}
.pz-head{display:flex;flex-direction:column;align-items:center;gap:2px}
.pz-title{font-size:clamp(26px,min(3.4vw,5vh),40px);font-weight:900;line-height:1}
.pz-sub{font-size:13px;font-weight:700;color:var(--txt-dim);margin-block-start:2px}
.pz-bars{display:flex;gap:7px;justify-content:center;margin-block:10px 4px}
.pz-bars i{display:block;width:14px;height:34px;border-radius:4px;
  background:linear-gradient(180deg,var(--gold-1),var(--gold-3));
  box-shadow:0 3px 0 rgba(0,0,0,.45),0 0 22px -4px rgba(255,194,71,.9)}
.pz-menu{display:flex;flex-direction:column;gap:10px;align-items:stretch;margin-block-start:20px}
.pz-menu .btn{width:100%}
.pz-hint{margin-block-start:14px;font-size:12px;font-weight:700;color:var(--txt-dim)}
.pz-warn{margin-block-start:8px;font-size:14px;line-height:1.5;color:rgba(244,241,234,.86);
  max-width:34ch;margin-inline:auto}
.btn.ghost.pz-quit{background:rgba(255,107,107,.13);border-color:rgba(255,107,107,.45);color:#ffd5d5}
.btn.ghost.pz-quit:hover{background:rgba(255,107,107,.25)}
@media (prefers-reduced-motion:reduce){ .mn-dialog.pause{animation:none} }
`;

function injectPauseCSS() {
  if (document.getElementById('pr-pause-style')) return;
  const el = document.createElement('style');
  el.id = 'pr-pause-style';
  el.textContent = PAUSE_CSS;
  document.head.appendChild(el);
}

/* ═════════════════════════════════════════════════════════════════ overlay ══ */

/**
 * The pause dialog. Pure UI: it does not pause anything and does not know what
 * "paused" means — whoever opens it already froze the world.
 *
 * @param {object}   opts
 * @param {object}   [opts.engine]     engine, for the settings overlay
 * @param {Function} [opts.onResume]   called once when the overlay closes without quitting
 * @param {Function} [opts.onQuit]     called once after the child CONFIRMS quitting
 * @returns {{close:Function, dialog:HTMLElement}} overlay handle
 */
export function pauseOverlay(opts = {}) {
  injectPauseCSS();
  const o = overlayRoot('pause');
  let view = 'menu';          // 'menu' | 'confirm'
  let outcome = 'resume';     // what onClose should report

  const build = () => {
    o.dialog.replaceChildren();
    if (view === 'menu') {
      appendAll(o.dialog,
        h('div.pz-head', null,
          h('div.pz-bars', null, h('i'), h('i')),
          h('h2.pz-title.display-white', { id: o.titleId }, t('menu.pause.title')),
          h('div.pz-sub', null, t('menu.pause.sub'))),
        h('div.pz-menu', null,
          h('button.btn', { onclick: () => o.close() }, t('menu.pause.resume')),
          h('button.btn.ghost', {
            onclick: () => settingsOverlay({ engine: opts.engine }),
          }, t('menu.pause.settings')),
          h('button.btn.ghost.pz-quit', {
            onclick: () => { view = 'confirm'; build(); },
          }, t('menu.pause.quit'))),
        h('div.pz-hint', null, t('menu.pause.hint')));
    } else {
      appendAll(o.dialog,
        h('div.pz-head', null,
          h('h2.pz-title.display-white', { id: o.titleId }, t('menu.pause.quitAsk'))),
        h('p.pz-warn', null, t('menu.pause.quitWarn')),
        h('div.pz-menu', null,
          // The safe answer is the primary button AND the first focus stop.
          h('button.btn', { onclick: () => { view = 'menu'; build(); } }, t('menu.pause.quitNo')),
          h('button.btn.ghost.pz-quit', {
            onclick: () => { outcome = 'quit'; o.close(); },
          }, t('menu.pause.quitYes'))));
    }
    o.focusFirst();
  };

  // Escape inside the confirmation steps BACK to the pause menu rather than
  // quitting or resuming — otherwise the accidental-quit guard has a hole in it.
  o.onEscape = () => {
    if (view === 'confirm') { view = 'menu'; build(); return; }
    o.close();
  };

  build();
  o.watchLang(build);
  // Registered so the quiz stops taking 1/2/3 (and stops counting down) behind
  // the pause menu, and so a beacon cannot open a question under it.
  pushModal('pause');
  o.onClose = () => {
    popModal('pause');
    (outcome === 'quit' ? opts.onQuit : opts.onResume)?.();
  };
  return o;
}

/* ══════════════════════════════════════════════════════════════ controller ══ */

/**
 * Owns the paused state for one race and wires Escape to it.
 *
 * The lead calls this once, right after building the race scene:
 *
 *   const s = raceScene(eng, {...});
 *   const pause = attachPauseControl({
 *     engine: eng, scene: s,
 *     canPause: () => !s.state.finished,
 *     onQuit:   () => eng.goto('menu'),
 *   });
 *   const disposeScene = s.dispose.bind(s);
 *   s.dispose = () => { pause.dispose(); disposeScene(); };
 *
 * @param {object}   opts
 * @param {object}   opts.engine        the engine (its `paused` flag halts the sim clock)
 * @param {object}   [opts.scene]       scene exposing setPaused(bool)
 * @param {Function} [opts.setPaused]   override the whole freeze: setPaused(bool)
 * @param {Function} [opts.canPause]    guard, e.g. () => !s.state.finished
 * @param {Function} [opts.onQuit]      confirmed quit; defaults to engine.goto('menu')
 * @returns {{open:Function, close:Function, toggle:Function, isPaused:Function, dispose:Function}}
 */
export function attachPauseControl(opts = {}) {
  const engine = opts.engine || null;
  const scene = opts.scene || null;
  let ov = null;
  let paused = false;
  let disposed = false;

  // Three independent stops, because there are three ways time gets into a scene
  // and stopping only one leaves the race running underneath the menu:
  //   1. engine.paused    — the real game loop (Engine.step) returns immediately.
  //   2. scene.update     — wrapped here, because the debug harness and the P0
  //                         flow gate call scene.update(dt) DIRECTLY, which never
  //                         passes through Engine.step and so never sees (1).
  //   3. scene.setPaused  — the scene's own input gate, so a held throttle key
  //                         cannot leak into the frame we resume on.
  // (2) is a wrapper rather than a change to race.js so the freeze works for any
  // scene, and it is undone on dispose. Pass freezeUpdate:false to opt out.
  let unwrapUpdate = () => {};
  if (scene && typeof scene.update === 'function' && opts.freezeUpdate !== false) {
    const original = scene.update.bind(scene);
    const wrapped = dt => { if (paused) return; original(dt); };
    scene.update = wrapped;
    unwrapUpdate = () => { if (scene.update === wrapped) scene.update = original; };
  }

  function freeze(p) {
    paused = p;
    if (typeof opts.setPaused === 'function') { opts.setPaused(p); return; }
    if (engine) engine.paused = p;               // stops Engine.step() entirely
    try { scene?.setPaused?.(p); } catch (e) { console.error('setPaused failed', e); }
  }

  function open() {
    if (ov || disposed) return;
    if (opts.canPause && !opts.canPause()) return;
    // A one-time explainer already owns the screen AND already froze the sim.
    // Opening over it was a real trap: closing the pause menu called
    // scene.setPaused(false), so the race started running again underneath a
    // modal the child was still reading, with input disabled. The explainer has
    // its own button and its own Escape, so nothing is unreachable.
    //
    // Named explicitly rather than "is anything open": a QUIZ panel must still
    // be pausable over. Wave 2's reason was that the quiz only slowed the world;
    // Wave 3 freezes it, and the reason became the opposite one — the quiz's
    // feedback now waits for Space with no time limit, so a quiz panel can be
    // the last thing on screen indefinitely and Settings/Quit must stay
    // reachable from it. The quiz holds its own freeze while the pause menu sits
    // on top, and race.js's setPaused() will not hand input back underneath it.
    // See the policy block in ui/style.js.
    if (modalHas('token') || modalHas('meet')) return;
    freeze(true);
    bus.emit('race:pause');                       // audio ducks on this
    ov = pauseOverlay({
      engine,
      onResume() { ov = null; resume(); },
      onQuit() {
        ov = null;
        freeze(false);                            // never hand a paused engine to the next scene
        bus.emit('race:resume');
        bus.emit('race:quit');
        if (opts.onQuit) opts.onQuit(); else engine?.goto?.('menu');
      },
    });
  }

  function resume() {
    if (!paused) return;
    freeze(false);
    bus.emit('race:resume');
  }

  function close() {
    if (ov) { ov.close(); return; }               // its onClose resumes for us
    resume();
  }

  const toggle = () => (ov ? close() : open());

  // input.js already emits this on Escape / P and nothing was listening — that
  // was the P0. While the overlay is open its own capture-phase Escape handler
  // stops the event before input.js ever sees it, so this can never double-fire.
  const offBus = bus.on('input:pause', toggle);

  // The visible half of the same door. Escape was the ONLY way out of a race —
  // a keyboard shortcut a child never discovers, on the one screen where being
  // stuck matters most. This is the shared route-home pill (ui/menus.js), except
  // that it opens the pause menu rather than leaving at once: quitting a race in
  // progress must keep going through the confirmation step, so a mis-tap cannot
  // throw away three laps. Pass `homeButton:false` to opt out (the preview
  // harness renders the dialog with no race behind it).
  const home = opts.homeButton === false ? null : attachHomeControl({
    // '❚❚' rather than '⏸': the pause pictograph falls back to a tofu-ish glyph
    // in system-ui on the machines this ships to, and two heavy bars are the
    // symbol every child already knows anyway.
    engine, below: true, escape: false, glyph: '❚❚',
    labelKey: 'menu.pause.title', onActivate: open,
  });
  // A scene change while paused (quit, or a race that completes) must never leave
  // the engine frozen for whatever comes next.
  const offLeave = bus.on('scene:leaving', () => { if (ov) { ov.close(); } else { resume(); } });

  return {
    open, close, toggle,
    isPaused: () => paused,
    dispose() {
      if (disposed) return;
      disposed = true;
      offBus(); offLeave();
      home?.dispose();
      if (ov) { const o = ov; ov = null; o.close(); }
      freeze(false);
      unwrapUpdate();
    },
  };
}

/* ═══════════════════════════════════════════════════════════════ previews ══ */

function overBackdrop(engine, opts, openOverlay) {
  const s = backdropScene(engine, { instant: true, ...opts });
  const ov = openOverlay();
  const dispose = s.dispose;
  s.dispose = () => {
    try { ov?.close?.(); } catch (e) { /* already gone */ }
    document.querySelectorAll('.mn-ov').forEach(n => n.remove());
    dispose();
  };
  return s;
}

export const preview = (engine, opts = {}) =>
  overBackdrop(engine, opts, () => pauseOverlay({ engine }));

export const previewQuit = (engine, opts = {}) =>
  overBackdrop(engine, opts, () => {
    const o = pauseOverlay({ engine });
    o.dialog.querySelector('.pz-quit')?.click();
    return o;
  });

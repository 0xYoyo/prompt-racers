// Shared design system. Every UI subsystem (HUD, menus, garage) MUST build from
// these tokens and utility classes — this is what keeps parallel work looking like
// one game. Art direction: warm golden-hour arcade. Dark, softly-shadowed rounded
// panels; gold as the single accent; chunky condensed display type.
//
// No runtime font fetches: display weight comes from system-ui at 800/900 plus
// layered text-shadow + stroke, which reads as a bespoke arcade face in both
// Hebrew and Latin.

export const CSS = `
:root{
  --gold:#ffc247;
  --gold-1:#ffe9a8; --gold-2:#ffc247; --gold-3:#f59310;
  --ink:#12121c; --ink-2:#1c1c2b;
  --panel:rgba(22,22,34,.82); --panel-solid:#191926;
  --stroke:rgba(255,255,255,.10); --stroke-hi:rgba(255,255,255,.22);
  --txt:#f4f1ea; --txt-dim:#a8a29a;
  --good:#7ee081; --warn:#ffb347; --bad:#ff6b6b; --info:#6fc3ff;
  --token:#ffd66b;
  --r-s:10px; --r-m:16px; --r-l:24px; --r-pill:999px;
  --sh-panel:0 10px 28px rgba(0,0,0,.55), 0 2px 0 rgba(255,255,255,.06) inset;
  --sh-pop:0 18px 50px rgba(0,0,0,.6);
  --ease:cubic-bezier(.22,.9,.3,1);
  --font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
*,*::before,*::after{box-sizing:border-box}
#ui{font-family:var(--font);color:var(--txt);}
#ui *{pointer-events:none}
#ui .on{pointer-events:auto}

/* ---- layout helpers that flip correctly under RTL ---- */
.row{display:flex;align-items:center;gap:10px}
.col{display:flex;flex-direction:column;gap:10px}
.fill{position:absolute;inset:0}
.center{display:flex;align-items:center;justify-content:center}

/* Logical properties everywhere so a single rule serves both directions. */
.hud-tl{position:absolute;inset-block-start:18px;inset-inline-start:18px}
.hud-tr{position:absolute;inset-block-start:18px;inset-inline-end:18px}
.hud-bl{position:absolute;inset-block-end:18px;inset-inline-start:18px}
.hud-br{position:absolute;inset-block-end:18px;inset-inline-end:18px}
/* Centred by auto margins between two insets, NOT by translateX(-50%) — see the
   popIn note below: transform is animation territory and a persisting keyframe
   would delete the centring half of the rule. */
.hud-tc{position:absolute;inset-block-start:14px;inset-inline:0;margin-inline:auto;
  inline-size:fit-content;max-inline-size:100%}

/* ---- surfaces ---- */
.panel{
  background:linear-gradient(180deg,rgba(40,40,58,.9),rgba(18,18,28,.92));
  border:1px solid var(--stroke); border-radius:var(--r-m);
  box-shadow:var(--sh-panel); backdrop-filter:blur(8px);
}
.panel-lift{background:linear-gradient(180deg,rgba(52,52,72,.94),rgba(24,24,36,.96));
  border:1px solid var(--stroke-hi); border-radius:var(--r-l); box-shadow:var(--sh-pop)}

/* ---- type ---- */
.display{
  font-weight:900; letter-spacing:-.02em; line-height:.92;
  background:linear-gradient(180deg,var(--gold-1) 8%,var(--gold-2) 52%,var(--gold-3) 100%);
  -webkit-background-clip:text; background-clip:text; color:transparent;
  filter:drop-shadow(0 4px 0 rgba(0,0,0,.55)) drop-shadow(0 12px 24px rgba(0,0,0,.5));
  paint-order:stroke fill;
}
.display-white{background:linear-gradient(180deg,#fff 20%,#e8e2d4 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.label{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--txt-dim)}
.rtl .label{letter-spacing:.04em}     /* Hebrew has no case; wide tracking hurts it */
.num{font-variant-numeric:tabular-nums;font-weight:900;direction:ltr;unicode-bidi:isolate}

/* ---- buttons ---- */
.btn{
  font-family:var(--font);font-weight:800;font-size:17px;color:#2a1c00;
  padding:14px 34px;border:0;border-radius:var(--r-pill);cursor:pointer;
  background:linear-gradient(180deg,var(--gold-1),var(--gold-2) 55%,var(--gold-3));
  box-shadow:0 6px 0 #a4620a, 0 12px 26px rgba(0,0,0,.45), 0 1px 0 rgba(255,255,255,.6) inset;
  transition:transform .12s var(--ease), box-shadow .12s var(--ease), filter .12s;
}
.btn:hover{transform:translateY(-2px);filter:brightness(1.06);
  box-shadow:0 8px 0 #a4620a,0 16px 32px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.6) inset}
.btn:active{transform:translateY(3px);box-shadow:0 2px 0 #a4620a,0 6px 14px rgba(0,0,0,.45)}
.btn.ghost{background:rgba(255,255,255,.07);color:var(--txt);
  border:1px solid var(--stroke-hi);box-shadow:none;font-weight:700}
.btn.ghost:hover{background:rgba(255,255,255,.14)}
.btn:focus-visible{outline:3px solid var(--info);outline-offset:3px}

/* ---- misc ---- */
.bar{height:8px;border-radius:var(--r-pill);background:rgba(255,255,255,.10);overflow:hidden}
.bar>i{display:block;height:100%;border-radius:var(--r-pill);
  background:linear-gradient(90deg,var(--gold-2),var(--gold-1));transition:width .45s var(--ease)}
.rtl .bar>i{background:linear-gradient(270deg,var(--gold-2),var(--gold-1))}

.fade-in{animation:fadeIn .35s var(--ease) both}
.pop-in{animation:popIn .4s var(--ease) both}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
/* popIn animates the INDIVIDUAL transform properties (scale/translate), never
   the transform shorthand.
   It used to end on to{transform:none} and is applied with both, so its final
   frame PERSISTED as transform:none and won every cascade fight for the rest of
   the element's life. Anything that also used transform on a .pop-in element
   lost silently: the podium's .mn-side (translateY(-50%)) and .mn-bottom
   (translateX(-50%)) were never pulled back, so the standings panel hung from the
   vertical centre downwards and the button row started at the horizontal centre —
   in English they printed on top of each other. .btn:hover/:active lifts and
   .mn-card.sel's selected-card lift were dead for the same reason, invisibly.
   scale/translate compose with transform instead of replacing it, so the
   only remaining rule is: DO NOT centre anything with translate: on an element
   that can also pop in — centre with auto margins between two insets, as
   .hud-tc above and .mn-side/.mn-bottom in menus.js now do. */
@keyframes popIn{from{opacity:0;scale:.9;translate:0 10px}to{opacity:1;scale:1;translate:0 0}}

@media (prefers-reduced-motion:reduce){
  .fade-in,.pop-in{animation:none}
  *{transition-duration:.01ms !important}
}
`;

export function injectStyles() {
  if (document.getElementById('pr-style')) return;
  const el = document.createElement('style');
  el.id = 'pr-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL TRAFFIC CONTROL
//
// Wave 2 added three things that can interrupt a race — the one-time token
// explainer (pauses the sim), Boreg's one-time introduction, and the quiz panel
// (slows the sim) — plus the pause overlay on top of all of them. Nothing
// coordinated them, so they could stack: a token popup could land on top of a
// live quiz whose timer kept running behind it, and the digit keys 1/2/3 still
// answered that hidden question while the pause menu was up.
//
// This is the single source of truth for "is a blocking panel open". It lives in
// style.js because every UI module already imports style.js and nothing else is
// shared by all of race/, garage/ and ui/ — a registry with imports would create
// a cycle. Deliberately dependency-free.
//
//   const off = pushModal('quiz');   // on open
//   off();                           // on close (popModal('quiz') also works)
//   if (modalOpen('quiz')) return;   // "is anything OTHER than me open?"
//   if (modalOpen()) return;         // "is anything at all open?"
//
// ── THE POLICY (Wave 3; supersedes the D15/D18 table) ────────────────────────
// The registry is a Set of ids and nothing more; the policy is a design choice
// and lives here, next to it, because it is otherwise spread across four files.
// Ids in play: 'quiz', 'pause', 'token' (first-token explainer), 'meet' (Boreg).
//
//   quiz        DEFERS behind anything else. Its beacon respawns, so nothing is
//               lost — the question simply comes later. (quiz.js: openQuestion)
//   token/meet  DEFER behind anything else; the save flag is untouched, so the
//               next token shows the explainer. (garage.js)
//   pause       May open over a QUIZ. May NOT open over token/meet.
//
// The pause-over-quiz rule survived Wave 3 but for the opposite reason, and the
// reason is worth writing down because it flipped:
//
//   Wave 2: the quiz only SLOWED the world, so refusing to pause would have left
//           a child unable to stop a moving kart for twenty seconds.
//   Wave 3: the quiz FREEZES the world (zero fixed steps) and its feedback waits
//           for Space with no time limit at all. So the race is no longer the
//           thing a child needs rescuing from — but "no time limit" means a quiz
//           panel can be the last thing on screen indefinitely, and Settings and
//           Quit have to be reachable from there. Refusing Esc would make the
//           one key a child already knows do nothing, in the one state they can
//           be stuck in. So: Esc over an open quiz opens the pause menu ON TOP,
//           the quiz stays exactly as it is underneath, and Esc again returns to
//           it. token/meet are still refused: they freeze the sim too, but they
//           are one-time, short, and have their own button and their own Escape.
//
// Three consequences that are load-bearing, each of which was a real bug once:
//   • `1/2/3` must not answer, and Space must not dismiss, a quiz that is behind
//     the pause menu — quiz.js's key handler returns early on modalOpen('quiz').
//   • The quiz's own clocks (answer timer, resume countdown) must not advance
//     behind the pause menu — same check, in quiz.update().
//   • Resuming from the pause menu must NOT hand input back if a quiz is still
//     frozen underneath. race.js's setPaused() consults its own quizFrozen flag
//     rather than assuming pause is the only thing that can hold the world.
// Pinned by tools/modaltest.mjs.
// ─────────────────────────────────────────────────────────────────────────────
const _modals = new Set();

// ── SUBSCRIPTION (Wave 4) ───────────────────────────────────────────────────
// Anything that must react to "a panel owns the screen" now subscribes here
// instead of being wired modal-by-modal. Added for audio ducking: the engine
// and the world must go silent while ANY modal is up, and doing that at each
// of the five call sites guarantees the sixth modal someone adds next wave
// forgets. Subscribers are called with the current boolean whenever the set
// transitions between empty and non-empty, and once immediately on subscribe.
//
// Deliberately still dependency-free: a Set, a Set of callbacks, no imports.
const _modalSubs = new Set();
let _lastAnyOpen = false;

function _notifyModalChange() {
  const any = _modals.size > 0;
  if (any === _lastAnyOpen) return;
  _lastAnyOpen = any;
  for (const fn of _modalSubs) {
    try { fn(any); } catch (e) { console.error(e); }
  }
}

/**
 * Subscribe to "is any modal open". Called immediately with the current value,
 * then on every empty↔non-empty transition. Returns an unsubscribe function.
 */
export function onModalChange(fn) {
  if (typeof fn !== 'function') return () => {};
  _modalSubs.add(fn);
  try { fn(_modals.size > 0); } catch (e) { console.error(e); }
  return () => { _modalSubs.delete(fn); };
}

export function pushModal(id) {
  _modals.add(id);
  _notifyModalChange();
  return () => popModal(id);
}
export function popModal(id) { _modals.delete(id); _notifyModalChange(); }
/** @param {string} [except] ignore this id — pass your own to ask about others. */
export function modalOpen(except) {
  for (const m of _modals) if (m !== except) return true;
  return false;
}
/** Is this specific panel open? */
export function modalHas(id) { return _modals.has(id); }
/** Teardown safety valve: a disposed scene must not leave a phantom modal. */
export function clearModals() { _modals.clear(); _notifyModalChange(); }

// Small helper used across UI modules: h('div.panel.row', {onclick}, ...children)
export function h(sel, props, ...kids) {
  const [tag, ...cls] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') { el.addEventListener(k.slice(2), v); el.classList.add('on'); }
    else if (k === 'html') el.innerHTML = v;
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(k) : k);
  }
  return el;
}

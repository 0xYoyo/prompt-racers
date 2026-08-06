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
.hud-tc{position:absolute;inset-block-start:14px;left:50%;transform:translateX(-50%)}

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
@keyframes popIn{from{opacity:0;transform:scale(.9) translateY(10px)}to{opacity:1;transform:none}}

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
// ─────────────────────────────────────────────────────────────────────────────
const _modals = new Set();

export function pushModal(id) {
  _modals.add(id);
  return () => popModal(id);
}
export function popModal(id) { _modals.delete(id); }
/** @param {string} [except] ignore this id — pass your own to ask about others. */
export function modalOpen(except) {
  for (const m of _modals) if (m !== except) return true;
  return false;
}
/** Is this specific panel open? */
export function modalHas(id) { return _modals.has(id); }
/** Teardown safety valve: a disposed scene must not leave a phantom modal. */
export function clearModals() { _modals.clear(); }

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

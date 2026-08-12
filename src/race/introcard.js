// ═════════════════════════════════════════════════════════════════════════════
// PRE-RACE INTRO CARD — "ברוכים הבאים אל …" + one הידעתם line
// ═════════════════════════════════════════════════════════════════════════════
//
// Shown before the countdown, EVERY race (this is not a one-time explainer — it
// is the curtain going up, and a child should get the same little ceremony each
// time). It carries one piece of ambient curriculum: a single fact that ties the
// track's own theme to how AI actually works, so the world itself teaches
// something before anyone has been asked a question.
//
//   נווה הנתונים  → data
//   עיר הנוירונים  → the neural network behind an answer
//   פסגת הענן     → cloud computing
//
// ── THE THREE RULES THIS FILE EXISTS TO KEEP ────────────────────────────────
//
// 1. THE TRACK NAME IS NEVER HARD-CODED. It is read from `trackdef.js`
//    (`nameHe`/`nameEn`) at render time. Wave 4 renamed עיר המעגלים → עיר
//    הנוירונים while this card was being written; a copy of the name here would
//    have rotted silently and printed the old name over the new city forever.
//    Only the הידעתם lines live here, keyed by the STABLE `def.id`
//    (oasis/circuit/cloud) — the ids are persisted in saves and never change,
//    the display names may change any wave. `tests/introcard.test.mjs` scans
//    this file for the literal names and fails if one ever appears.
//
// 2. THE WORLD DOES NOT MOVE BEHIND IT. race.js keeps the scene in phase
//    'intro' while the card is up, and phase 'intro' contributes a time scale of
//    ZERO to the accumulator (D11/D20): no fixed steps, so the countdown has not
//    started, `raceTime` and `lapTime` are provably 0, and the child is not
//    already losing while they read.
//
// 3. `e.repeat` ON SPACE IS IGNORED. Space is also the drift key. A child who
//    holds it — or who was holding it as the previous panel closed — must not
//    skip a card they never read. This is D20's bug class exactly.
//
// ── MODAL REGISTRY (D15/D18, policy block in ui/style.js) ───────────────────
// Id: 'intro'. It behaves like 'token'/'meet', not like 'quiz':
//   • it DEFERS — if anything at all is already open when the race is built the
//     card is not shown at all and the race goes straight to the countdown
//     (`createIntroCard` returns null). There is nothing to lose by skipping it:
//     it is a welcome, and stacking a welcome on top of a panel a child is still
//     reading is the exact Wave-2 failure the registry was created to end.
//   • nothing may stack ON it — it freezes the world and owns the screen. Its
//     scrim swallows pointer events and it takes Escape in the CAPTURE phase, so
//     Escape dismisses the card instead of falling through to input.js and
//     opening the pause menu over it.
// NOTE for the lead: pause.js refuses to open over `modalHas('token') ||
// modalHas('meet')` by name. 'intro' is not in that list. In practice the pause
// menu is unreachable while the card is up (Escape is taken in capture, the
// scrim swallows clicks) and even if it did open the freeze holds — phase is
// still 'intro', so `setPaused(false)` cannot start the race underneath it. It
// should still be added to that list when pause.js is next touched.
import * as THREE from 'three';
import { getTrack, TRACKS } from '../track/trackdef.js';
import { h, injectStyles, pushModal, popModal, modalOpen } from '../ui/style.js';
import { registerStrings, t, num, getLang } from '../ui/i18n.js';
import { applyTheme } from '../gfx/sky.js';
import { buildTrack } from '../track/trackbuild.js';

// ── strings ─────────────────────────────────────────────────────────────────
// House voice: impersonal plural, gender-neutral (D26/D27) — "ברוכים הבאים",
// "הידעתם", "לוחצים". No second-person singular anywhere.
//
// The facts are keyed by def.id, never by name. Two lines each, concrete rather
// than definitional: each one gives a child an image (water, lit streets, a
// round trip) they can carry into the race, not a textbook sentence.
// Kept as a named pack as well as registered, so `introContent(def, lang)` can
// resolve a language EXPLICITLY. `t()` reads i18n's module-level language and
// has no per-call override, which meant a gate could not compare the Hebrew and
// English copy in one process — and the English half of the card would have
// shipped unchecked.
const PACK = {
  he: {
    'intro.welcome': 'ברוכים הבאים אל',
    'intro.kicker': 'מסלול {n} מתוך {of} · {laps} הקפות',
    'intro.know': 'הידעתם?',
    'intro.go': 'יוצאים לדרך',
    'intro.hint': 'רווח או נגיעה במסך',
    'intro.fact.oasis':
      'נתונים הם המים של הבינה המלאכותית — היא לומדת רק מהדוגמאות שמראים לה. ' +
      'נווה קטן ונקי שווה לה יותר מאגם ענק ובוצי.',
    'intro.fact.circuit':
      'מאחורי כל תשובה של בינה מלאכותית עומדת רשת נוירונים: מיליוני חיבורים זעירים שנדלקים יחד, ' +
      'כמו רחובות שנדלקים בעיר בלילה. אף אחד מהם לא יודע את התשובה לבד.',
    'intro.fact.cloud':
      'הענן הוא בסך הכול מחשבים ענקיים שיושבים במקום אחר בעולם. ' +
      'הפרומפט שלכם טס אליהם, נענה שם, וחוזר — הכול בשנייה אחת.',
  },
  en: {
    'intro.welcome': 'Welcome to',
    'intro.kicker': 'Track {n} of {of} · {laps} laps',
    'intro.know': 'Did you know?',
    'intro.go': "Let's go",
    'intro.hint': 'Space or tap the screen',
    'intro.fact.oasis':
      'Data is the water an AI grows on — it only ever learns from the examples it is shown. ' +
      'A small clean oasis is worth more to it than a huge muddy lake.',
    'intro.fact.circuit':
      'Behind every AI answer stands a neural network: millions of tiny connections lighting up together, ' +
      'like streets switching on across a city at night. Not one of them knows the answer alone.',
    'intro.fact.cloud':
      'The cloud is really just enormous computers sitting somewhere else in the world. ' +
      'Your prompt flies over to them, gets answered there, and comes back — all in about a second.',
  },
};
registerStrings(PACK);

/**
 * `t()` for the active language, or a specific one when asked. The registered
 * table stays authoritative for the active language, so a later copy pass that
 * re-registers a key still wins on screen.
 */
function tr(key, lang, vars) {
  let s = lang ? (PACK[lang]?.[key] ?? PACK.he[key] ?? key) : t(key, vars);
  if (lang && vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}

// Per-theme accent, carried as a CLASS and defined in CSS below — never as an
// inline custom property. `h()` applies inline styles with Object.assign, and
// Object.assign CANNOT set a CSS custom property on a CSSStyleDeclaration (only
// setProperty can): the first version of this file passed `--ic-accent` inline
// and every track silently fell back to gold. Caught in the screenshots.
const ACCENT_CLASS = { oasis: 'ic-oasis', circuit: 'ic-circuit', cloud: 'ic-cloud' };

const INTRO_CSS = `
.ic-root{position:absolute;inset:0;z-index:40}
/* The card is the first thing a child sees each race, so it should already
   smell of the track behind it: warm gold at the oasis, neon cyan in the city,
   cool sky at the peak. Gold stays the house accent — the button, the rule and
   the chip never change — so this only tints the halo and the kicker. */
.ic-oasis{--ic-accent:#ffc247}
.ic-circuit{--ic-accent:#6fe8ff}
.ic-cloud{--ic-accent:#a9d8ff}
.ic-scrim{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding:clamp(16px,4vh,40px);font-family:var(--font);
  background:radial-gradient(120% 90% at 50% 42%,rgba(10,8,22,.52),rgba(4,4,12,.88));
  backdrop-filter:blur(3px);cursor:pointer}
.ic-card{position:relative;inline-size:min(680px,94%);
  padding:clamp(20px,3.4vh,34px) clamp(22px,3.4vw,40px) clamp(18px,2.8vh,28px);
  display:flex;flex-direction:column;align-items:center;text-align:center;gap:clamp(8px,1.4vh,14px);
  border-radius:var(--r-l);border:1px solid rgba(255,194,71,.28);
  background:linear-gradient(180deg,rgba(52,42,52,.95),rgba(20,17,26,.97));
  box-shadow:var(--sh-pop),0 0 110px -14px var(--ic-accent,var(--gold)),
    0 1px 0 rgba(255,255,255,.12) inset;
  overflow:hidden}
/* The gold house focus ring: --info blue is the global default and fights the
   golden-hour palette on this card, which is the one panel that is pure poster. */
.ic-card .btn:focus-visible{outline:3px solid rgba(255,255,255,.92);outline-offset:3px}
/* A slow gold sweep across the panel: an arcade attract-mode shine, so the card
   reads as a curtain going up rather than as a dialog box. */
.ic-card::after{content:'';position:absolute;inset-block:0;inset-inline-start:-40%;inline-size:38%;
  background:linear-gradient(100deg,transparent,rgba(255,255,255,.11),transparent);
  animation:icSweep 3.6s var(--ease) .35s infinite}
@keyframes icSweep{0%{translate:-60% 0}55%,100%{translate:420% 0}}
.ic-glow{position:absolute;inset-block-start:-58%;inset-inline:0;block-size:100%;
  background:radial-gradient(50% 50% at 50% 50%,var(--ic-accent,var(--gold)),transparent 70%);
  opacity:.28;pointer-events:none}
/* 12px floor: layoutcheck flags anything smaller as tiny-text at 1024x640, and
   this line carries "which race is this" — a child should not have to lean in. */
.ic-kicker{position:relative;font-size:clamp(12px,1.35vh,13px);font-weight:900;letter-spacing:.10em;
  color:var(--ic-accent,var(--gold));text-transform:uppercase}
.rtl .ic-kicker{letter-spacing:.03em}
.ic-welcome{position:relative;font-size:clamp(15px,2.1vh,20px);font-weight:800;color:var(--txt-dim)}
.ic-title{position:relative;font-size:clamp(38px,7.2vh,68px);padding-block-end:.06em}
.ic-rule{position:relative;inline-size:min(320px,72%);block-size:3px;border-radius:var(--r-pill);
  background:linear-gradient(90deg,transparent,var(--gold-2),transparent);margin-block:clamp(2px,.8vh,8px)}
.ic-know{position:relative;display:flex;flex-direction:column;align-items:center;gap:9px;
  padding:clamp(12px,1.8vh,18px) clamp(14px,2vw,22px);border-radius:var(--r-m);
  background:rgba(255,255,255,.045);border:1px solid var(--stroke)}
.ic-chip{display:inline-flex;align-items:center;gap:7px;padding:5px 14px;border-radius:var(--r-pill);
  font-size:clamp(11px,1.5vh,13px);font-weight:900;color:#1a1305;
  background:linear-gradient(180deg,var(--gold-1),var(--gold-2) 60%,var(--gold-3));
  box-shadow:0 2px 0 rgba(0,0,0,.35)}
.ic-fact{margin:0;font-size:clamp(14px,2vh,18px);font-weight:700;line-height:1.55;color:#eceff6;
  max-inline-size:52ch;text-wrap:balance}
.ic-foot{position:relative;display:flex;align-items:center;justify-content:center;
  flex-wrap:wrap;gap:clamp(10px,1.8vw,18px);margin-block-start:clamp(2px,1vh,8px)}
.ic-foot .btn{min-block-size:clamp(44px,5.6vh,54px);touch-action:manipulation;
  -webkit-tap-highlight-color:transparent}
.ic-hint{font-size:clamp(11px,1.5vh,13px);font-weight:800;color:var(--txt-dim);
  animation:icPulse 1.9s var(--ease) infinite}
@keyframes icPulse{0%,100%{opacity:.45}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){
  .ic-card::after,.ic-hint{animation:none}
}
`;

function injectIntroCSS() {
  injectStyles();
  if (document.getElementById('pr-intro-style')) return;
  const el = document.createElement('style');
  el.id = 'pr-intro-style';
  el.textContent = INTRO_CSS;
  document.head.appendChild(el);
}

// ── content ─────────────────────────────────────────────────────────────────
/** The display name for a track def, in the active language. Never hard-coded. */
export function trackName(def, lang = getLang()) {
  if (!def) return '';
  return (lang === 'en' ? def.nameEn : def.nameHe) || def.nameHe || def.nameEn || def.id;
}

/**
 * Everything the card prints, resolved from a track def. Exported so a gate can
 * check the copy (and the trackdef seam, by passing a stubbed def) without a DOM.
 * @param {object} def  a trackdef entry — or a stub with the same shape
 */
export function introContent(def, lang = null) {
  const idx = TRACKS.findIndex(x => x.id === def?.id);
  const factKey = `intro.fact.${def?.id}`;
  return {
    id: def?.id,
    name: trackName(def, lang || getLang()),
    welcome: tr('intro.welcome', lang),
    kicker: tr('intro.kicker', lang, {
      n: num(idx >= 0 ? idx + 1 : 1), of: num(TRACKS.length), laps: num(def?.laps ?? 3),
    }),
    knowLabel: tr('intro.know', lang),
    // Falls back to the oasis line rather than printing a raw key if a track is
    // ever added without one — a missing fact must not look like a bug on screen.
    fact: tr(factKey, lang) === factKey ? tr('intro.fact.oasis', lang) : tr(factKey, lang),
    accentClass: ACCENT_CLASS[def?.theme] || ACCENT_CLASS.oasis,
    go: tr('intro.go', lang),
    hint: tr('intro.hint', lang),
  };
}

/**
 * Should this race show an intro card at all?
 *
 * ON for real play. OFF for anything that drives a race mechanically, because a
 * card that owns the screen would either block the gate or land in its
 * screenshot:
 *   • backdrop  — the title screen's live race behind the menu. Chrome-less by
 *                 definition (race.js's `if (!backdrop)` discipline).
 *   • autopilot — flowtest, modaltest, the AI measurement harness.
 *   • headless  — `engine._headless`, set by core/harness.js's `__DEBUG.goto`
 *                 and by nothing else. Covers shot.mjs, layoutcheck, modaltest
 *                 and flowtest's P0 gates, all of which jump straight into a
 *                 race, without any of them having to know this file exists.
 *   • webdriver — an automated browser is driving the page. This one is not
 *                 belt-and-braces, it is load-bearing: flowtest's PLAYABILITY
 *                 slice reaches a race by CLICKING the real menu buttons, so it
 *                 never calls `__DEBUG.goto` and `_headless` is still false —
 *                 the card blocked it at "countdown completed, kart is moving,
 *                 phase=intro" and took thirteen downstream checks with it. A
 *                 tool that drives the real UI is indistinguishable from a child
 *                 by every in-game signal there is; `navigator.webdriver` is the
 *                 one honest difference, and it is not `window.__DEBUG` (which
 *                 D3 forbids game code from reading).
 *                 FOR THE LEAD: the durable version of this is one line in
 *                 flowtest's playability slice — either `introCard:false` on the
 *                 race it starts, or a Space press after "reaches race scene",
 *                 which would also let that slice gate the card on the real
 *                 player path. When that lands, this clause can be deleted.
 * An explicit `opts.introCard` boolean overrides all of it in both directions,
 * which is how the gate drives the real built game through the real card.
 */
export function introCardEnabled(opts = {}, engine = null) {
  if (typeof opts.introCard === 'boolean') return opts.introCard;
  if (opts.backdrop || opts.autopilot) return false;
  if (engine && engine._headless) return false;
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  return true;
}

/**
 * Mount the card. Returns null if it DEFERS (something else already owns the
 * screen) — the caller then goes straight to the countdown.
 *
 * @param o {track?:number|string, def?:object, mount:HTMLElement, onSkip?:fn}
 * @returns {{el:HTMLElement, open:boolean, skip:Function, dispose:Function}|null}
 */
export function createIntroCard(o = {}) {
  if (modalOpen()) return null;                 // defer; see the policy note above
  const def = o.def || getTrack(o.track ?? 0).def;
  const c = introContent(def);
  injectIntroCSS();

  let open = true;
  const release = pushModal('intro');

  // ONE code path for both inputs (keys and pointer), deliberately: two
  // implementations of "skip" drift, and only one of them ends up carrying the
  // e.repeat guard.
  function skip(source = 'unknown') {
    if (!open) return;
    open = false;
    removeEventListener('keydown', onKey, true);
    root.remove();
    release();                                   // popModal('intro')
    o.onSkip?.(source);
  }

  function onKey(e) {
    if (!open) return;
    const isSpace = e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
    const isGo = isSpace || e.key === 'Enter';
    if (!isGo && e.key !== 'Escape') return;
    // D20, exactly: Space is the drift key. A held Space auto-repeats, and a
    // child who is holding it (or who was holding it when the card appeared)
    // must not skip a card they have not read.
    if (e.repeat) { e.preventDefault(); return; }
    e.preventDefault();
    e.stopPropagation();                         // Escape must not reach input.js
    skip(e.key === 'Escape' ? 'escape' : 'key');
  }
  addEventListener('keydown', onKey, true);

  const btn = h('button.btn', { type: 'button', onclick: e => { e.stopPropagation(); skip('button'); } }, c.go);

  // `.on` restores pointer events (style.js disables them across #ui), so the
  // scrim swallows taps instead of letting them fall through to the world. Here
  // a stray tap SHOULD dismiss — the brief asks for click/tap to skip, and this
  // is a welcome rather than a teaching card that must be acknowledged.
  const card = h(`div.ic-card.pop-in.${c.accentClass}`, null,
    h('div.ic-glow'),
    h('div.ic-kicker', null, c.kicker),
    h('div.ic-welcome', null, c.welcome),
    h('div.display.ic-title', null, c.name),
    h('div.ic-rule'),
    h('div.ic-know', null,
      h('span.ic-chip', null, c.knowLabel),
      h('p.ic-fact', null, c.fact)),
    h('div.ic-foot', null, h('span.ic-hint', null, c.hint), btn));

  const scrim = h('div.ic-scrim.on.fade-in', { onclick: () => skip('pointer') }, card);
  const root = h('div.ic-root', null, scrim);
  o.mount?.appendChild(root);
  btn.focus?.({ preventScroll: true });

  return {
    el: root,
    get open() { return open; },
    skip,
    dispose() { skip('dispose'); },
  };
}

// ── preview ────────────────────────────────────────────────────────────────
// The card over a real track, so it is judged against the world it covers.
function previewScene(engine, o = {}) {
  const trackIndex = o.track ?? 0;
  const scene = new THREE.Scene();
  const { def, spline } = getTrack(trackIndex);
  const rig = applyTheme(scene, def.theme, engine);
  const track = buildTrack(trackIndex, engine);
  scene.add(track.group);

  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.25, Math.max(900, engine.q.drawDistance * 1.5));
  const look = spline.offsetPoint((def.startT + 0.02) % 1, 0);
  look.y += 1.4;
  const cp = spline.offsetPoint((def.startT - 22 / spline.length + 1) % 1, 2.6);
  cp.y += 3.2;
  camera.position.copy(cp);
  camera.lookAt(look);

  const card = createIntroCard({ track: trackIndex, mount: engine.ui });

  let clock = 0;
  return {
    scene, camera,
    update(dt) { clock += dt; track.update(clock); rig.update?.(dt, camera); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    card,
    dispose() { card?.dispose(); track.dispose(); rig.dispose?.(); scene.clear(); },
  };
}

/** The card as it ships, over the first track. */
export function preview(engine) { return previewScene(engine, { track: 0 }); }
export function previewCircuit(engine) { return previewScene(engine, { track: 1 }); }
export function previewCloud(engine) { return previewScene(engine, { track: 2 }); }

/** All three cards side by side — for judging the copy in one frame. */
export function previewAll(engine) {
  const s = previewScene(engine, { track: 0 });
  s.card?.skip('preview');
  injectIntroCSS();
  const row = h('div.fill', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: '12px', padding: '12px', background: 'rgba(6,6,14,.82)',
    },
  });
  for (const def of TRACKS) {
    const c = introContent(def);
    row.appendChild(h(`div.ic-card.${c.accentClass}`, { style: { inlineSize: '33%' } },
      h('div.ic-glow'),
      h('div.ic-kicker', null, c.kicker),
      h('div.ic-welcome', null, c.welcome),
      h('div.display.ic-title', { style: { fontSize: '30px' } }, c.name),
      h('div.ic-rule'),
      h('div.ic-know', null,
        h('span.ic-chip', null, c.knowLabel),
        h('p.ic-fact', { style: { fontSize: '14px' } }, c.fact)),
      h('div.ic-foot', null, h('span.ic-hint', null, c.hint))));
  }
  engine.ui.appendChild(row);
  const dispose = s.dispose.bind(s);
  s.dispose = () => { row.remove(); dispose(); };
  return s;
}

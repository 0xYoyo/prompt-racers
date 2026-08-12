// ═══════════════════════════════════════════════════════════════════════════
// האוסף שלי — one screen, two tabs (Wave 4, item 12).
//
//   תגים     ~15 achievements. Locked: greyed icon + the condition, in words.
//            Unlocked: full colour, gold rim, an "earned" chip.
//   מילון AI 12 kid-level AI words. Locked: a hint about WHERE to meet the idea,
//            never the definition. Unlocked: two friendly Hebrew lines.
//
// The data, the tracking and the unlock toast live in core/badges.js — this file
// only draws. It reads the save; it never writes a badge (opening a screen must
// not be able to award anything).
//
// Mount it like any other scene:
//     import { collectionScene } from './ui/collection.js';
//     SCENES.collection = (eng, o) => collectionScene(eng, o);
// and give the home menu a button that does api.go('collection').
// ═══════════════════════════════════════════════════════════════════════════
import { h } from './style.js';
import { registerStrings, t, num } from './i18n.js';
import { save } from '../core/save.js';
import { bus } from '../core/bus.js';
import { backdropScene, attachHomeControl } from './menus.js';
import {
  BADGES, GLOSSARY, ICONS, BADGE_STRINGS, GLOSSARY_STRINGS,
  getStats, evaluate, showBadgeToast,
} from '../core/badges.js';

/* ═════════════════════════════════════════════════════════════════ strings ══ */
// The badge and glossary copy is registered by core/badges.js's tables (the data
// module owns its own words, so the toast can name a badge without this screen
// ever being loaded). This file registers only its own chrome.
registerStrings({
  he: {
    ...BADGE_STRINGS.he, ...GLOSSARY_STRINGS.he,
    'col.title': 'האוסף שלי',
    'col.tab.badges': 'תגים',
    'col.tab.glossary': 'מילון AI',
    'col.earned': 'הושג',
    'col.howto': 'איך פותחים',
    'col.empty.badges': 'עוד לא נפתח אף תג. יוצאים למרוץ — הראשון מגיע מהר.',
    'col.empty.glossary': 'המילון נפתח תוך כדי משחק: כל מושג שנתקלים בו בדרך נוסף לכאן.',
    'col.lede.badges': 'כל תג נפתח לבד ברגע שעושים את מה שכתוב עליו.',
    'col.lede.glossary': 'מילים מעולם הבינה המלאכותית — נפתחות כשפוגשים אותן במשחק.',
    'col.progress': '{n} / {total}',
  },
  en: {
    ...BADGE_STRINGS.en, ...GLOSSARY_STRINGS.en,
    'col.title': 'My Collection',
    'col.tab.badges': 'Badges',
    'col.tab.glossary': 'AI Glossary',
    'col.earned': 'Earned',
    'col.howto': 'How to unlock',
    'col.empty.badges': 'No badge yet. Go race — the first one comes fast.',
    'col.empty.glossary': 'The glossary fills up as you play: every idea you meet is added here.',
    'col.lede.badges': 'Each badge unlocks by itself the moment you do what it says.',
    'col.lede.glossary': 'Words from the world of AI — unlocked when you meet them in the game.',
    'col.progress': '{n} / {total}',
  },
});

/* ═════════════════════════════════════════════════════════════════════ css ══ */
// Logical properties only, so RTL mirrors for free.

const COL_CSS = `
#ui .col-root, #ui .col-root *{pointer-events:auto}
.col-root{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;
  padding:clamp(64px,9vh,86px) clamp(12px,3vw,32px) clamp(12px,2.4vh,24px);
  gap:clamp(8px,1.4vh,14px);overflow:hidden}
/* The golden-hour backdrop is BRIGHT down the middle (the road runs right
   through where the grid sits), and a translucent card printed over it lost the
   whole locked/unlocked distinction — the greyed icons simply disappeared. Every
   other screen in the game solves this with .mn-scrim; this one needs a stronger
   one because it is a wall of small type, not three big buttons. */
.col-scrim{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(130% 95% at 50% 38%,rgba(9,7,14,.58),rgba(9,7,14,.88) 78%)}
.col-head{flex:none;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;
  position:relative}
.col-title{margin:0;font-size:clamp(26px,min(4vw,5.4vh),44px);line-height:1;padding:0 .06em}
.col-lede{margin:0;font-size:clamp(12px,1.5vh,14px);line-height:1.45;color:rgba(244,241,234,.72);
  max-inline-size:60ch}
.col-tabs{flex:none;position:relative;display:flex;gap:6px;padding:5px;border-radius:var(--r-pill);
  background:rgba(0,0,0,.55);border:1px solid var(--stroke);backdrop-filter:blur(6px)}
.col-tabs button{font-family:var(--font);font-weight:800;font-size:15px;color:var(--txt-dim);
  background:transparent;border:0;border-radius:var(--r-pill);padding:9px 22px;cursor:pointer;
  display:inline-flex;align-items:center;gap:8px;transition:color .15s var(--ease),background .15s var(--ease)}
.col-tabs button:hover{color:var(--txt)}
.col-tabs button.act{color:#2a1c00;
  background:linear-gradient(180deg,var(--gold-1),var(--gold-2) 55%,var(--gold-3));
  box-shadow:0 3px 0 #a4620a,0 8px 18px rgba(0,0,0,.4)}
.col-tabs button:focus-visible{outline:3px solid var(--info);outline-offset:3px}
.col-tabs .col-pill{font-size:12px;font-weight:900;padding:1px 9px;border-radius:var(--r-pill);
  background:rgba(0,0,0,.22);color:inherit;direction:ltr;unicode-bidi:isolate}
.col-tabs button:not(.act) .col-pill{background:rgba(255,255,255,.09)}

/* flex:0 1 auto, not 1 1 auto: a short collection sits centred on the screen
   instead of clinging to the top with 250px of dead space under it, and a full
   one still shrinks and scrolls. */
.col-scroll{position:relative;inline-size:min(1120px,100%);min-block-size:0;flex:0 1 auto;
  overflow-y:auto;overflow-x:hidden;padding:2px 4px 8px;scrollbar-width:thin}
.col-grid{display:grid;gap:clamp(8px,1.2vw,12px);
  grid-template-columns:repeat(auto-fill,minmax(224px,1fr))}
.col-grid.wide{grid-template-columns:repeat(auto-fill,minmax(272px,1fr))}

/* ---------- badge card ---------- */
.col-card{position:relative;display:flex;gap:12px;align-items:flex-start;padding:12px 14px;
  border-radius:var(--r-m);border:1px solid var(--stroke);
  background:linear-gradient(180deg,rgba(44,42,60,.80),rgba(20,19,29,.86));
  box-shadow:0 6px 18px rgba(0,0,0,.40)}
.col-card.got{border-color:rgba(255,194,71,.55);
  background:linear-gradient(180deg,rgba(86,64,26,.92),rgba(38,28,14,.92));
  box-shadow:0 6px 20px rgba(0,0,0,.45),0 0 26px -12px rgba(255,194,71,.85)}
.col-ico{flex:none;inline-size:46px;block-size:46px;display:block}
.col-card.locked .col-ico{filter:grayscale(1) brightness(.85) contrast(.85);opacity:.62}
.col-card.got .col-ico{filter:drop-shadow(0 3px 7px rgba(0,0,0,.55))}
.col-txt{min-inline-size:0;display:flex;flex-direction:column;gap:3px}
.col-name{font-size:15px;font-weight:900;line-height:1.2;color:var(--gold-1)}
.col-card.locked .col-name{color:rgba(244,241,234,.62)}
.col-cond{margin:0;font-size:12px;line-height:1.4;color:rgba(244,241,234,.66)}
.col-k{font-size:10px;font-weight:900;letter-spacing:.14em;color:var(--txt-dim)}
.rtl .col-k{letter-spacing:.03em}
.col-chip{align-self:flex-start;margin-block-start:2px;font-size:11.5px;font-weight:900;
  color:#2a1c00;padding:2px 10px;border-radius:var(--r-pill);
  background:linear-gradient(180deg,var(--gold-1),var(--gold-3))}
.col-bar{margin-block-start:5px;block-size:6px;border-radius:var(--r-pill);
  background:rgba(255,255,255,.10);overflow:hidden}
.col-bar>i{display:block;block-size:100%;border-radius:var(--r-pill);
  background:linear-gradient(90deg,var(--gold-3),var(--gold-1))}
.rtl .col-bar>i{background:linear-gradient(270deg,var(--gold-3),var(--gold-1))}
.col-prog{font-size:11.5px;font-weight:900;color:var(--txt-dim);direction:ltr;unicode-bidi:isolate;
  margin-block-start:3px}
.rtl .col-prog{text-align:end}
/* the padlock, drawn in CSS — no glyph, no asset */
.col-lock{position:absolute;inset-block-start:9px;inset-inline-end:10px;inline-size:13px;block-size:11px;
  border-radius:2px;background:rgba(244,241,234,.42)}
.col-lock::before{content:"";position:absolute;inset-block-end:100%;inset-inline-start:50%;
  translate:-50% 0;inline-size:9px;block-size:7px;border:2px solid rgba(244,241,234,.42);
  border-block-end:0;border-start-start-radius:5px;border-start-end-radius:5px}

/* ---------- glossary card ---------- */
.col-term{display:flex;flex-direction:column;gap:6px;padding:13px 15px;border-radius:var(--r-m);
  border:1px solid var(--stroke);box-shadow:0 6px 18px rgba(0,0,0,.40);
  background:linear-gradient(180deg,rgba(44,42,60,.80),rgba(20,19,29,.86))}
/* Gold, not the info blue it started as: style.js's art direction is "gold as
   the SINGLE accent", and a second accent on the second tab made the two halves
   of one screen look like two features. */
.col-term.got{border-color:rgba(255,194,71,.34);
  background:linear-gradient(180deg,rgba(56,48,36,.88),rgba(22,20,28,.92))}
.col-term-h{display:flex;align-items:center;gap:9px}
.col-term-dot{flex:none;inline-size:9px;block-size:9px;border-radius:50%;
  background:rgba(244,241,234,.25)}
.col-term.got .col-term-dot{background:var(--gold-2);box-shadow:0 0 10px rgba(255,194,71,.85)}
.col-term-name{font-size:17px;font-weight:900;line-height:1.15;color:var(--txt)}
.col-term.got .col-term-name{color:var(--gold-1)}
.col-term.locked .col-term-name{color:rgba(244,241,234,.5)}
.col-def{margin:0;font-size:12.5px;line-height:1.5;color:rgba(244,241,234,.84);white-space:pre-line}
.col-hint{margin:0;font-size:12px;line-height:1.45;color:rgba(244,241,234,.58)}
.col-hint b{color:#f6d79a;font-weight:900}
.col-empty{margin:0;padding:18px;text-align:center;font-size:13.5px;line-height:1.5;
  color:rgba(244,241,234,.7)}

@media (max-width:720px){
  .col-root{padding-block-start:clamp(58px,10vh,74px)}
  .col-tabs button{font-size:14px;padding:8px 16px}
  .col-grid{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
}
@media (prefers-reduced-motion:reduce){.col-root .fade-in,.col-root .pop-in{animation:none}}
`;

function injectCollectionCSS() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pr-collection-style')) return;
  const el = document.createElement('style');
  el.id = 'pr-collection-style';
  el.textContent = COL_CSS;
  document.head.appendChild(el);
}

/* ═════════════════════════════════════════════════════════════════ pieces ══ */

function iconSVG(key, cls = 'col-ico') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 48 48');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[key] || ICONS.token;
  return s;
}

function badgeCard(def, unlocked, stats) {
  const name = t(`badge.${def.id}.name`);
  const cond = t(`badge.${def.id}.cond`);
  let bar = null, prog = null;
  if (!unlocked && def.progress) {
    const [cur, goal] = def.progress(stats);
    const pct = Math.max(0, Math.min(100, Math.round((cur / goal) * 100)));
    // Only worth drawing once the child is actually on the way; a 0% bar on
    // every locked card reads as "everything is broken".
    if (cur > 0) {
      bar = h('div.col-bar', null, h('i', { style: { inlineSize: pct + '%' } }));
      prog = h('div.col-prog', null, t('col.progress', { n: num(Math.min(cur, goal)), total: num(goal) }));
    }
  }
  return h('div.col-card.' + (unlocked ? 'got' : 'locked'), {
    role: 'listitem',
    'aria-label': `${name} — ${unlocked ? t('col.earned') : cond}`,
  },
  iconSVG(def.icon),
  h('div.col-txt', null,
    h('div.col-name', null, name),
    unlocked ? h('span.col-chip', null, t('col.earned')) : h('p.col-cond', null, cond),
    bar, prog),
  unlocked ? null : h('i.col-lock', { 'aria-hidden': 'true' }));
}

function termCard(def, unlocked) {
  const term = t(`glos.${def.id}.term`);
  return h('div.col-term.' + (unlocked ? 'got' : 'locked'), { role: 'listitem' },
    h('div.col-term-h', null,
      h('i.col-term-dot', { 'aria-hidden': 'true' }),
      h('div.col-term-name', null, unlocked ? term : term)),
    unlocked
      ? h('p.col-def', null, t(`glos.${def.id}.def`))
      : h('p.col-hint', null, h('b', null, t('col.howto') + ': '), t(`glos.${def.id}.hint`)));
}

/* ══════════════════════════════════════════════════════════════════ screen ══ */

/**
 * האוסף שלי — the whole feature, as a scene.
 *
 * @param {object} engine
 * @param {object} [opts]
 * @param {'badges'|'glossary'} [opts.tab]  which tab opens first
 * @param {boolean} [opts.instant]          skip entry animation (screenshots)
 * @param {Function} [opts.onBack]          default: engine.goto('menu')
 * @returns {object} scene handle — {scene, camera, update, dispose, ...}
 */
export function collectionScene(engine, opts = {}) {
  const base = backdropScene(engine, opts);
  injectCollectionCSS();

  // Opening the screen re-checks the ledger. This awards nothing new on its own
  // (every predicate reads counters the tracker already banked), it just means a
  // save written by an older build catches up the first time it is looked at.
  try { evaluate(getStats(), { silent: true }); } catch (e) { console.error(e); }

  const mount = engine?.ui || document.body;
  const root = h('div.col-root' + (opts.instant ? '' : '.fade-in'));
  mount.appendChild(root);

  let tab = opts.tab === 'glossary' ? 'glossary' : 'badges';

  const build = () => {
    const stats = getStats();
    const badges = Array.isArray(save.read('badges')) ? save.read('badges') : [];
    const terms = Array.isArray(save.read('glossary')) ? save.read('glossary') : [];
    const gotB = BADGES.filter(b => badges.includes(b.id)).length;
    const gotG = GLOSSARY.filter(g => terms.includes(g.id)).length;

    const tabBtn = (id, labelKey, n, total) => h('button' + (tab === id ? '.act' : ''), {
      type: 'button',
      role: 'tab',
      'aria-selected': tab === id ? 'true' : 'false',
      onclick: () => { if (tab !== id) { tab = id; root.replaceChildren(); build(); } },
    }, t(labelKey), h('span.col-pill', null, `${n}/${total}`));

    const list = tab === 'badges'
      ? h('div.col-grid', { role: 'list' },
        ...BADGES.map(b => badgeCard(b, badges.includes(b.id), stats)))
      : h('div.col-grid.wide', { role: 'list' },
        ...GLOSSARY.map(g => termCard(g, terms.includes(g.id))));

    const empty = tab === 'badges' ? gotB === 0 : gotG === 0;

    root.append(
      h('div.col-scrim', { 'aria-hidden': 'true' }),
      h('div.col-head', null,
        h('h1.col-title.display', null, t('col.title')),
        h('p.col-lede', null, t(tab === 'badges' ? 'col.lede.badges' : 'col.lede.glossary'))),
      h('div.col-tabs', { role: 'tablist' },
        tabBtn('badges', 'col.tab.badges', gotB, BADGES.length),
        tabBtn('glossary', 'col.tab.glossary', gotG, GLOSSARY.length)),
      h('div.col-scroll', null,
        empty ? h('p.col-empty', null, t(tab === 'badges' ? 'col.empty.badges' : 'col.empty.glossary')) : null,
        list));
  };

  build();

  // Language flips rebuild in place, exactly like every baseScreen screen.
  const offLang = bus.on('lang:changed', () => { root.replaceChildren(); build(); });
  // A badge earned while this screen is open (possible: nothing here blocks the
  // bus) repaints the grid instead of going stale.
  const offBadge = bus.on('badge:unlocked', () => { root.replaceChildren(); build(); });

  const home = attachHomeControl({ engine, escape: true, onActivate: () => (opts.onBack ? opts.onBack() : engine?.goto?.('menu')) });

  // Left/right (or Tab through the tablist) switch tabs — a child on a keyboard
  // should not have to find the mouse. Deliberately no Escape handler here: the
  // home control owns Escape, so there is exactly one owner of that key.
  const onKey = e => {
    if (document.querySelector('.mn-ov')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tab === 'badges' ? 'glossary' : 'badges';
    tab = next;
    root.replaceChildren();
    build();
    root.querySelector('.col-tabs button.act')?.focus({ preventScroll: true });
  };
  addEventListener('keydown', onKey);

  const disposeBase = base.dispose;
  base.dispose = () => {
    removeEventListener('keydown', onKey);
    try { offLang(); offBadge(); } catch { /* gone */ }
    try { home.dispose(); } catch { /* gone */ }
    root.remove();
    disposeBase?.();
  };
  return base;
}

/* ═══════════════════════════════════════════════════════════════ previews ══ */

// A save that shows BOTH states at once: some badges earned, some locked with a
// visible part-way bar, half the glossary open. Deterministic — no rng, no
// Math.random — so the screenshots are comparable between runs.
const SAMPLE = {
  badges: ['quiz-first', 'quiz-5', 'tokens-50', 'drift-first', 'drift-top', 'prompt-good', 'champ-finish'],
  glossary: ['token', 'prompt', 'ai', 'llm', 'iterate', 'hallucination', 'data'],
  stats: {
    quizAnswered: 19, quizCorrect: 12,
    tokensLifetime: 118, tokensPickups: 46, tokensQuiz: 66,
    driftBoosts: 14, driftBoostsTop: 2, bestDriftTier: 3,
    promptsBuilt: 1, bestPromptScore: 62, expertPrompts: 0,
    racesFinished: 3, bestPlace: 2, champRaces: 3, champPodiums: 2,
    champsFinished: 1, champsWon: 0,
    topicsAnswered: { whatai: 4, prompt: 5, tokens: 3, iterate: 2, mistakes: 3 },
  },
};

function withSampleSave() {
  const s = save.get();
  save._replace({ ...s, ...SAMPLE });
}

export const previewBadges = (engine, opts = {}) => {
  withSampleSave();
  return collectionScene(engine, { instant: true, tab: 'badges', ...opts });
};

export const previewGlossary = (engine, opts = {}) => {
  withSampleSave();
  return collectionScene(engine, { instant: true, tab: 'glossary', ...opts });
};

// The unlock toast, over the live screen, so it can be judged for what it is:
// a strip that does not own the screen. It pushes nothing onto the modal
// registry, so a race behind it keeps running and Escape still belongs to pause.
export const previewToast = (engine, opts = {}) => {
  const s = previewBadges(engine, opts);
  showBadgeToast('champ-win', { sticky: true });
  showBadgeToast('quiz-40', { sticky: true });
  return s;
};

export const preview = previewBadges;

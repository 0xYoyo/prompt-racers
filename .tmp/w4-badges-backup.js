// ═══════════════════════════════════════════════════════════════════════════
// האוסף שלי — the ledger behind the collection screen (Wave 4, item 12).
//
// Two collections, one tracker:
//   • BADGES    ~15 achievements, measured against lifetime counters.
//   • GLOSSARY  12 AI words, unlocked by ENCOUNTERING the idea in play.
//
// This module is the DATA and the TRACKING. It draws nothing (ui/collection.js
// does) except one non-blocking toast, and it imports no subsystem: everything
// arrives over core/bus.js, which is the only way a tracker can watch a race
// without the race knowing it exists.
//
// ── THE TOAST IS NOT A MODAL ────────────────────────────────────────────────
// A badge toast must never freeze the race, never take Escape and never enter
// the modal registry (ui/style.js). It is a pointer-events:none strip on
// document.body — NOT on engine.ui, which engine.goto() wipes on every scene
// change — that fades itself out. The sound is asked for over the bus
// (`badge:unlocked`, plus an `audio:play` so it is audible today) rather than by
// importing audio.js.
//
// ── CALIBRATION ─────────────────────────────────────────────────────────────
// Measured, not guessed. D28 stopwatched the built game: a child is interrupted
// 10 / 8 / 7 times across the three races = 25 questions per championship.
// tests/economy.test.mjs pins the rest: ~15 token pickups per race (45 per
// championship), quiz rewards 3/4/5 by tier, a 6-token win bonus.
//
//   One championship, a child answering ~70% correctly:
//     quiz correct   ~17         (25 asked)
//     tokens         45 pickups + ~68 quiz + ~12 finish  ≈ 125
//     drift boosts   ~12 per race = ~36
//
//   So over 2–3 championships: 35–52 correct, 250–375 tokens, 70–110 boosts.
//   Every threshold below sits inside that envelope EXCEPT the two marked
//   `hard: true` — `prompt-max` (needs expert mode written really well) and
//   `champ-win` (needs beating seven rivals over a whole season). Those two are
//   meant to still be locked after three championships for most children.
//
// The prompt numbers are the garage's own 0–100 quality score (garage/scoring.js):
// tier cuts 30 / 55 / 80, a guided ask can reach at most 84 because the 17-token
// budget is smaller than the 21-token maximum ask, and only free text (expert
// mode) can pass 90. So `prompt-80` reads as "8 out of 10" and `prompt-max` as
// "as good as this game can score".
// ═══════════════════════════════════════════════════════════════════════════
import { bus } from './bus.js';
import { save } from './save.js';

/* ═══════════════════════════════════════════════════════════════════ stats ══ */

/** The lifetime counter shape. save.js reserves `stats` for exactly this. */
export const DEFAULT_STATS = {
  quizAnswered: 0,        // questions actually answered (right or wrong)
  quizCorrect: 0,         // ── quiz badges
  tokensLifetime: 0,      // ── token badges: pickups + quiz rewards + finish bonus
  tokensPickups: 0,
  tokensQuiz: 0,
  driftBoosts: 0,         // ── drift badges: mini-boosts released
  driftBoostsTop: 0,      // released at the top tier (3)
  bestDriftTier: 0,
  promptsBuilt: 0,        // ── prompt badges (needs `garage:built`, see below)
  bestPromptScore: 0,
  expertPrompts: 0,
  racesFinished: 0,       // ── championship badges
  bestPlace: 0,
  champRaces: 0,          // races finished in the CURRENT championship
  champPodiums: 0,        // top-3 finishes in the CURRENT championship
  champsFinished: 0,
  champsWon: 0,
  topicsAnswered: {},     // quiz topic id -> count (drives glossary unlocks)
};

const CHAMP_RACES = 3;    // matches scenes.js / menus.js

/** Live stats object, always merged onto the defaults so an old save is safe. */
export function getStats() {
  const raw = save.read('stats');
  const s = { ...DEFAULT_STATS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.topicsAnswered = { ...(raw?.topicsAnswered || {}) };
  return s;
}

const unlockedBadges = () => (Array.isArray(save.read('badges')) ? save.read('badges') : []);
const unlockedTerms = () => (Array.isArray(save.read('glossary')) ? save.read('glossary') : []);

export const isBadgeUnlocked = id => unlockedBadges().includes(id);
export const isTermUnlocked = id => unlockedTerms().includes(id);

/* ═══════════════════════════════════════════════════════════════════ icons ══ */
// Procedural inline SVG. No asset files, no emoji (an emoji is a font the target
// machine may not have, and it would not match the art direction anyway).
// Drawn on a 0 0 48 48 grid, gold on transparent, so the locked state is just a
// CSS filter away.

const G1 = '#ffe9a8', G2 = '#ffc247', G3 = '#f59310';

const defs = `<defs><linearGradient id="bgGold" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${G1}"/><stop offset="55%" stop-color="${G2}"/>
  <stop offset="100%" stop-color="${G3}"/></linearGradient></defs>`;

/** id -> inner SVG markup for a 48×48 viewBox. */
export const ICONS = {
  // a speech bubble with a question mark — the quiz beacon
  quiz: `${defs}<path d="M8 10h32a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H24l-9 7v-7h-7a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z"
    fill="url(#bgGold)" opacity=".92"/>
    <path d="M19.5 20.5a4.5 4.5 0 1 1 5.8 4.3c-1 .3-1.6 1.1-1.6 2.1v.9" fill="none" stroke="#2a1c00"
      stroke-width="3" stroke-linecap="round"/><circle cx="23.7" cy="31.6" r="1.9" fill="#2a1c00"/>`,
  // three stacked bubbles — a run of right answers
  quizrun: `${defs}<path d="M6 9h26a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H18l-7 5v-5H6a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3z"
    fill="url(#bgGold)" opacity=".45"/>
    <path d="M16 19h26a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3h-8l-7 5v-5h-11a3 3 0 0 1-3-3V22a3 3 0 0 1 3-3z"
      fill="url(#bgGold)"/>
    <path d="M22.5 29.5l3.6 3.6 7.4-7.6" fill="none" stroke="#2a1c00" stroke-width="3.4"
      stroke-linecap="round" stroke-linejoin="round"/>`,
  // a brain-ish wreath of answers
  quizmaster: `${defs}<circle cx="24" cy="24" r="15" fill="url(#bgGold)" opacity=".18"/>
    <circle cx="24" cy="24" r="15" fill="none" stroke="url(#bgGold)" stroke-width="2.4"/>
    <path d="M24 11v26M11 24h26" stroke="url(#bgGold)" stroke-width="1.4" opacity=".5"/>
    <path d="M16 25.5l5.5 5.5L33 18.5" fill="none" stroke="url(#bgGold)" stroke-width="4"
      stroke-linecap="round" stroke-linejoin="round"/>`,
  // one coin
  token: `${defs}<ellipse cx="24" cy="24" rx="15" ry="15" fill="url(#bgGold)"/>
    <ellipse cx="24" cy="24" rx="10.5" ry="10.5" fill="none" stroke="#a4620a" stroke-width="1.6" opacity=".7"/>
    <path d="M20 18.5h8M24 18.5v11M20.5 29.5h7" stroke="#2a1c00" stroke-width="3" stroke-linecap="round"/>`,
  // a stack of coins
  tokenpile: `${defs}<ellipse cx="24" cy="35" rx="15" ry="6" fill="url(#bgGold)" opacity=".55"/>
    <ellipse cx="24" cy="29" rx="14" ry="5.6" fill="url(#bgGold)" opacity=".75"/>
    <ellipse cx="24" cy="22.5" rx="13" ry="5.2" fill="url(#bgGold)"/>
    <ellipse cx="24" cy="22.5" rx="6" ry="2.4" fill="none" stroke="#a4620a" stroke-width="1.5" opacity=".8"/>
    <path d="M24 9v8M20 12.5l4-4 4 4" fill="none" stroke="url(#bgGold)" stroke-width="2.6"
      stroke-linecap="round" stroke-linejoin="round"/>`,
  // a skid arc with smoke puffs
  drift: `${defs}<path d="M7 36c6-16 18-24 34-25" fill="none" stroke="url(#bgGold)" stroke-width="4.5"
      stroke-linecap="round" stroke-dasharray="7 5"/>
    <circle cx="11" cy="31" r="4.2" fill="url(#bgGold)" opacity=".35"/>
    <circle cx="18" cy="26" r="3.2" fill="url(#bgGold)" opacity=".25"/>`,
  // a double skid arc
  driftrun: `${defs}<path d="M5 38c6-16 18-25 33-27" fill="none" stroke="url(#bgGold)" stroke-width="4"
      stroke-linecap="round" stroke-dasharray="6 5"/>
    <path d="M12 42c6-16 18-25 33-27" fill="none" stroke="url(#bgGold)" stroke-width="4" opacity=".55"
      stroke-linecap="round" stroke-dasharray="6 5"/>
    <circle cx="9" cy="33" r="3.6" fill="url(#bgGold)" opacity=".3"/>`,
  // flame — the top-tier boost
  boost: `${defs}<path d="M24 4c1 7-5 9-5 15 0 3 2 5 2 5s-4-1-5-4c-3 3-5 7-5 11a13 13 0 0 0 26 0c0-9-6-13-8-17-1.5-3-2-7-5-10z"
      fill="url(#bgGold)"/>
    <path d="M24 24c2 3 3 5 3 8a3.4 3.4 0 0 1-6.8 0c0-3 2.4-5 3.8-8z" fill="#2a1c00" opacity=".45"/>`,
  // a chat bracket with a spark — a written ask
  prompt: `${defs}<path d="M7 11h34a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H21l-8 6v-6H7a3 3 0 0 1-3-3V14a3 3 0 0 1 3-3z"
      fill="none" stroke="url(#bgGold)" stroke-width="3"/>
    <path d="M11 19h20M11 26h13" stroke="url(#bgGold)" stroke-width="3" stroke-linecap="round"/>
    <path d="M35 17l1.7 4.3L41 23l-4.3 1.7L35 29l-1.7-4.3L29 23l4.3-1.7z" fill="url(#bgGold)"/>`,
  // a rosette — the perfect ask
  promptmax: `${defs}<path d="M24 4l4.8 4.2 6.3-1.1 2 6.1 5.7 2.9-2.5 5.9 2.5 5.9-5.7 2.9-2 6.1-6.3-1.1L24 40l-4.8-4.2-6.3 1.1-2-6.1L5.2 27.9 7.7 22 5.2 16.1l5.7-2.9 2-6.1 6.3 1.1z"
      fill="url(#bgGold)"/>
    <path d="M16.5 22.5l5 5L32 17" fill="none" stroke="#2a1c00" stroke-width="4"
      stroke-linecap="round" stroke-linejoin="round"/>`,
  // a quill/wand — expert mode
  expert: `${defs}<path d="M40 8L18 30l-4 8 8-4L44 12z" fill="url(#bgGold)"/>
    <path d="M18 30l4 4" stroke="#2a1c00" stroke-width="2.4" opacity=".5"/>
    <path d="M9 9l1.4 3.6L14 14l-3.6 1.4L9 19l-1.4-3.6L4 14l3.6-1.4z" fill="url(#bgGold)" opacity=".8"/>
    <path d="M11 33l1 2.8L14.8 37 12 38l-1 2.8L10 38l-2.8-1L10 35.8z" fill="url(#bgGold)" opacity=".6"/>`,
  // chequered flag — a season completed
  flag: `${defs}<path d="M11 6v38" stroke="url(#bgGold)" stroke-width="3.6" stroke-linecap="round"/>
    <path d="M14 9h27v18H14z" fill="url(#bgGold)" opacity=".25"/>
    <path d="M14 9h6.75v6H14zM27.5 9h6.75v6H27.5zM20.75 15h6.75v6h-6.75zM34.25 15h6.75v6h-6.75zM14 21h6.75v6H14zM27.5 21h6.75v6H27.5z"
      fill="url(#bgGold)"/>`,
  // trophy — the season won
  trophy: `${defs}<path d="M15 7h18v10a9 9 0 0 1-18 0z" fill="url(#bgGold)"/>
    <path d="M15 10H9v3a7 7 0 0 0 7 7M33 10h6v3a7 7 0 0 1-7 7" fill="none" stroke="url(#bgGold)" stroke-width="2.6"/>
    <path d="M21 26h6v6h-6z" fill="url(#bgGold)" opacity=".8"/>
    <path d="M14 38h20a2 2 0 0 1 2 2v3H12v-3a2 2 0 0 1 2-2z" fill="url(#bgGold)"/>`,
  // a three-step podium
  podium: `${defs}<path d="M18 18h12v25H18z" fill="url(#bgGold)"/>
    <path d="M4 27h14v16H4z" fill="url(#bgGold)" opacity=".62"/>
    <path d="M30 23h14v20H30z" fill="url(#bgGold)" opacity=".78"/>
    <path d="M24 6l2.1 4.4 4.9.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8-3.5-3.4 4.9-.7z" fill="url(#bgGold)"/>`,
};

/* ══════════════════════════════════════════════════════════════════ badges ══ */
/**
 * @typedef {object} BadgeDef
 * @property {string} id
 * @property {'quiz'|'tokens'|'drift'|'prompt'|'champ'} group
 * @property {string} icon        key into ICONS
 * @property {(s:object)=>boolean} test
 * @property {(s:object)=>[number,number]} [progress]  [current, goal] while locked
 * @property {boolean} [hard]     deliberately out of reach in 2–3 championships
 * @property {boolean} [needs]    blocked on a bus event that does not exist yet
 */
export const BADGES = [
  /* ── quiz: 25 questions asked per championship (D28: 10/8/7) ─────────────── */
  { id: 'quiz-first', group: 'quiz', icon: 'quiz', test: s => s.quizCorrect >= 1 },
  { id: 'quiz-5', group: 'quiz', icon: 'quizrun', test: s => s.quizCorrect >= 5,
    progress: s => [s.quizCorrect, 5] },
  { id: 'quiz-15', group: 'quiz', icon: 'quizrun', test: s => s.quizCorrect >= 15,
    progress: s => [s.quizCorrect, 15] },
  { id: 'quiz-40', group: 'quiz', icon: 'quizmaster', test: s => s.quizCorrect >= 40,
    progress: s => [s.quizCorrect, 40] },

  /* ── tokens: ~125 earned per championship ────────────────────────────────── */
  { id: 'tokens-50', group: 'tokens', icon: 'token', test: s => s.tokensLifetime >= 50,
    progress: s => [s.tokensLifetime, 50] },
  { id: 'tokens-200', group: 'tokens', icon: 'tokenpile', test: s => s.tokensLifetime >= 200,
    progress: s => [s.tokensLifetime, 200] },

  /* ── drift ───────────────────────────────────────────────────────────────── */
  { id: 'drift-first', group: 'drift', icon: 'drift', test: s => s.driftBoosts >= 1 },
  { id: 'drift-25', group: 'drift', icon: 'driftrun', test: s => s.driftBoosts >= 25,
    progress: s => [s.driftBoosts, 25] },
  { id: 'drift-top', group: 'drift', icon: 'boost', test: s => s.driftBoostsTop >= 1 },

  /* ── prompt quality (garage 0–100; cuts at 30/55/80) ─────────────────────── */
  { id: 'prompt-good', group: 'prompt', icon: 'prompt', test: s => s.bestPromptScore >= 55,
    progress: s => [s.bestPromptScore, 55] },
  { id: 'prompt-80', group: 'prompt', icon: 'promptmax', test: s => s.bestPromptScore >= 80,
    progress: s => [s.bestPromptScore, 80] },
  { id: 'prompt-max', group: 'prompt', icon: 'promptmax', hard: true,
    test: s => s.bestPromptScore >= 90, progress: s => [s.bestPromptScore, 90] },
  { id: 'prompt-expert', group: 'prompt', icon: 'expert', test: s => s.expertPrompts >= 1 },

  /* ── championship ────────────────────────────────────────────────────────── */
  // `champsFinished` needs `championship:complete` (see NEEDED_EVENTS); until the
  // lead wires it, three finished races in one season still earns this.
  { id: 'champ-finish', group: 'champ', icon: 'flag',
    test: s => s.champsFinished >= 1 || s.champRaces >= CHAMP_RACES },
  { id: 'champ-podium3', group: 'champ', icon: 'podium', test: s => s.champPodiums >= CHAMP_RACES,
    progress: s => [Math.min(s.champPodiums, CHAMP_RACES), CHAMP_RACES] },
  { id: 'champ-win', group: 'champ', icon: 'trophy', hard: true, test: s => s.champsWon >= 1 },
];

export const BADGE_IDS = BADGES.map(b => b.id);
export const badgeById = id => BADGES.find(b => b.id === id) || null;
/** The ones calibration says should still be locked after 2–3 championships. */
export const HARD_BADGE_IDS = BADGES.filter(b => b.hard).map(b => b.id);

/* ════════════════════════════════════════════════════════════════ glossary ══ */
/**
 * Twelve words, each unlocked by MEETING the idea — never by reading a list.
 * `test` is evaluated against the same stats object as the badges.
 */
export const GLOSSARY = [
  { id: 'token', test: s => s.tokensPickups >= 1 || (s.topicsAnswered.tokens || 0) >= 1 },
  { id: 'prompt', test: s => s.promptsBuilt >= 1 || (s.topicsAnswered.prompt || 0) >= 1 },
  { id: 'ai', test: s => (s.topicsAnswered.whatai || 0) >= 1 },
  { id: 'llm', test: s => s.quizCorrect >= 3 },
  { id: 'training', test: s => s.promptsBuilt >= 2 },
  { id: 'vibe', test: s => (s.topicsAnswered.vibe || 0) >= 1 },
  { id: 'iterate', test: s => (s.topicsAnswered.iterate || 0) >= 1 },
  { id: 'hallucination', test: s => (s.topicsAnswered.mistakes || 0) >= 1 },
  { id: 'data', test: s => s.tokensLifetime >= 25 },
  { id: 'algorithm', test: s => s.bestPlace >= 1 && s.bestPlace <= 3 },
  { id: 'neuron', test: (s, badges) => badges.length >= 3 },
  { id: 'cloud', test: s => s.champsFinished >= 1 || s.champRaces >= CHAMP_RACES },
];

export const GLOSSARY_IDS = GLOSSARY.map(g => g.id);
export const termById = id => GLOSSARY.find(g => g.id === id) || null;

/* ═══════════════════════════════════════════════════════════════════ strings ══ */
// Registered from HERE, not from the screen, so the tracker's toast can name a
// badge without the collection screen ever being opened — and so the gate can
// check both languages in Node, where ui/ cannot be imported (it pulls in three).
//
// House voice (D27): impersonal plural, gender-neutral. Never "אתה", never a
// masculine imperative. Conditions are written as the ACTION, not as a number
// with a verb bolted on.

export const BADGE_STRINGS = {
  he: {
    'badge.quiz-first.name': 'תשובה ראשונה',
    'badge.quiz-first.cond': 'עונים נכון על שאלה אחת במרוץ',
    'badge.quiz-5.name': 'מתחממים',
    'badge.quiz-5.cond': 'עונים נכון על ‎5 שאלות',
    'badge.quiz-15.name': 'ראש פתוח',
    'badge.quiz-15.cond': 'עונים נכון על ‎15 שאלות',
    'badge.quiz-40.name': 'מוח על',
    'badge.quiz-40.cond': 'עונים נכון על ‎40 שאלות',
    'badge.tokens-50.name': 'אספן טוקנים',
    'badge.tokens-50.cond': 'אוספים ‎50 טוקנים בסך הכול',
    'badge.tokens-200.name': 'ארנק כבד',
    'badge.tokens-200.cond': 'אוספים ‎200 טוקנים בסך הכול',
    'badge.drift-first.name': 'החלקה ראשונה',
    'badge.drift-first.cond': 'מסיימים החלקה אחת ומקבלים טורבו',
    'badge.drift-25.name': 'מלך ההחלקות',
    'badge.drift-25.cond': 'מסיימים ‎25 החלקות עם טורבו',
    'badge.drift-top.name': 'טורבו סגול',
    'badge.drift-top.cond': 'מחזיקים החלקה עד הדרגה הגבוהה ביותר',
    'badge.prompt-good.name': 'פרומפט מסודר',
    'badge.prompt-good.cond': 'כותבים לבורג פרומפט באיכות ‎55 ומעלה',
    'badge.prompt-80.name': 'פרומפט מדויק',
    'badge.prompt-80.cond': 'כותבים לבורג פרומפט באיכות ‎80 ומעלה',
    'badge.prompt-max.name': 'אלוף הפרומפטים',
    'badge.prompt-max.cond': 'מגיעים לאיכות ‎90 ומעלה — רק במצב מומחה',
    'badge.prompt-expert.name': 'מצב מומחה',
    'badge.prompt-expert.cond': 'כותבים פרומפט במילים שלכם במצב מומחה',
    'badge.champ-finish.name': 'אליפות בכיס',
    'badge.champ-finish.cond': 'מסיימים אליפות שלמה — שלושה מרוצים',
    'badge.champ-podium3.name': 'שלוש פעמים על הפודיום',
    'badge.champ-podium3.cond': 'מסיימים בשלושת הראשונים בכל שלושת המרוצים',
    'badge.champ-win.name': 'אלופי העונה',
    'badge.champ-win.cond': 'מסיימים אליפות במקום הראשון',
  },
  en: {
    'badge.quiz-first.name': 'First Answer',
    'badge.quiz-first.cond': 'Answer one race question correctly',
    'badge.quiz-5.name': 'Warming Up',
    'badge.quiz-5.cond': 'Answer 5 questions correctly',
    'badge.quiz-15.name': 'Open Mind',
    'badge.quiz-15.cond': 'Answer 15 questions correctly',
    'badge.quiz-40.name': 'Super Brain',
    'badge.quiz-40.cond': 'Answer 40 questions correctly',
    'badge.tokens-50.name': 'Token Collector',
    'badge.tokens-50.cond': 'Collect 50 tokens in total',
    'badge.tokens-200.name': 'Heavy Wallet',
    'badge.tokens-200.cond': 'Collect 200 tokens in total',
    'badge.drift-first.name': 'First Drift',
    'badge.drift-first.cond': 'Finish one drift and get a boost',
    'badge.drift-25.name': 'Drift King',
    'badge.drift-25.cond': 'Finish 25 drifts with a boost',
    'badge.drift-top.name': 'Purple Boost',
    'badge.drift-top.cond': 'Hold a drift all the way to the top tier',
    'badge.prompt-good.name': 'Tidy Prompt',
    'badge.prompt-good.cond': 'Write Boreg a prompt scoring 55 or more',
    'badge.prompt-80.name': 'Precise Prompt',
    'badge.prompt-80.cond': 'Write Boreg a prompt scoring 80 or more',
    'badge.prompt-max.name': 'Prompt Champion',
    'badge.prompt-max.cond': 'Reach a quality of 90 or more — expert mode only',
    'badge.prompt-expert.name': 'Expert Mode',
    'badge.prompt-expert.cond': 'Write a prompt in your own words in expert mode',
    'badge.champ-finish.name': 'Season Done',
    'badge.champ-finish.cond': 'Finish a whole championship — three races',
    'badge.champ-podium3.name': 'Podium Hat-trick',
    'badge.champ-podium3.cond': 'Finish top three in all three races',
    'badge.champ-win.name': 'Season Champions',
    'badge.champ-win.cond': 'Finish a championship in first place',
  },
};

// Two lines, kid-level, house voice. A definition explains the idea with
// something the child has already touched in this game wherever it can.
export const GLOSSARY_STRINGS = {
  he: {
    'glos.token.term': 'טוקן',
    'glos.token.def': 'חתיכה קטנה של טקסט — מילה, חצי מילה או אפילו פסיק.\nמודלים קוראים וכותבים בטוקנים, ובמשחק אוספים אותם על המסלול.',
    'glos.token.hint': 'אוספים טוקן ראשון על המסלול',
    'glos.prompt.term': 'פרומפט',
    'glos.prompt.def': 'הבקשה שכותבים לבינה מלאכותית, במילים רגילות.\nככל שהיא מדויקת יותר, מה שחוזר קרוב יותר למה שרצו.',
    'glos.prompt.hint': 'כותבים פרומפט ראשון במוסך של בורג',
    'glos.ai.term': 'בינה מלאכותית',
    'glos.ai.def': 'תוכנה שלומדת מדוגמאות במקום לקבל הוראות לכל מקרה.\nהיא לא חושבת כמו בן אדם — היא מזהה דפוסים ומנחשת המשך.',
    'glos.ai.hint': 'עונים על שאלה בנושא בינה מלאכותית במרוץ',
    'glos.llm.term': 'מודל שפה',
    'glos.llm.def': 'בינה מלאכותית שאומנה על המון טקסט וכל תפקידה לנחש איזו מילה מתאימה לבוא עכשיו.\nמזה בדיוק נבנות התשובות הארוכות שהיא כותבת.',
    'glos.llm.hint': 'עונים נכון על שלוש שאלות במרוץ',
    'glos.training.term': 'אימון',
    'glos.training.def': 'השלב שבו המודל רואה מיליוני דוגמאות ומשפר את עצמו בכל טעות.\nזה לוקח חודשים ואלפי מחשבים שעובדים יחד.',
    'glos.training.hint': 'בונים שני פרומפטים במוסך',
    'glos.vibe.term': 'וייב קודינג',
    'glos.vibe.def': 'לבנות תוכנה בלי להקליד קוד: מתארים במילים מה רוצים, ובינה מלאכותית כותבת.\nהמשחק הזה נבנה בדיוק ככה.',
    'glos.vibe.hint': 'עונים על שאלה בנושא וייב קודינג במרוץ',
    'glos.iterate.term': 'איטרציה',
    'glos.iterate.def': 'סבב: מבקשים, מסתכלים מה יצא, משנים דבר אחד ומבקשים שוב.\nכמעט אף פעם לא יוצא מושלם בפעם הראשונה, וזה בסדר גמור.',
    'glos.iterate.hint': 'עונים על שאלה בנושא סבבים ותיקונים במרוץ',
    'glos.hallucination.term': 'הזיה',
    'glos.hallucination.def': 'כשמודל ממציא תשובה שנשמעת בטוחה לגמרי — ופשוט לא נכונה.\nלכן תמיד בודקים עובדה חשובה במקום נוסף.',
    'glos.hallucination.hint': 'עונים על שאלה בנושא טעויות של AI במרוץ',
    'glos.data.term': 'נתונים',
    'glos.data.def': 'כל מה שמודל לומד ממנו: טקסטים, תמונות, מספרים.\nנתונים טובים ומגוונים עושים מודל טוב יותר מנתונים רבים וחוזרים.',
    'glos.data.hint': 'אוספים ‎25 טוקנים בסך הכול',
    'glos.algorithm.term': 'אלגוריתם',
    'glos.algorithm.def': 'רשימת צעדים מדויקת לפתרון משימה, כמו מתכון.\nהיריבים במסלול נוסעים לפי אלגוריתם — לכן הם חוזרים על אותו קו בכל הקפה.',
    'glos.algorithm.hint': 'מסיימים מרוץ בשלושת המקומות הראשונים',
    'glos.neuron.term': 'נוירון',
    'glos.neuron.def': 'תא חישוב זעיר ברשת: מקבל מספרים, מחבר אותם ומעביר תוצאה אחת הלאה.\nלבד הוא כמעט כלום, ומיליונים מהם יחד לומדים לזהות ולכתוב.',
    'glos.neuron.hint': 'אוספים שלושה תגים',
    'glos.cloud.term': 'ענן',
    'glos.cloud.def': 'מחשבים חזקים שיושבים רחוק, ואפשר להשתמש בהם דרך האינטרנט.\nרוב המודלים הגדולים רצים שם ולא על המחשב שבבית.',
    'glos.cloud.hint': 'מסיימים אליפות שלמה',
  },
  en: {
    'glos.token.term': 'Token',
    'glos.token.def': 'A small piece of text — a word, half a word, even a comma.\nModels read and write in tokens, and in this game you collect them on track.',
    'glos.token.hint': 'Collect your first token on the track',
    'glos.prompt.term': 'Prompt',
    'glos.prompt.def': 'The request you write to an AI, in plain words.\nThe more precise it is, the closer the answer lands to what you wanted.',
    'glos.prompt.hint': 'Write your first prompt in Boreg\'s garage',
    'glos.ai.term': 'Artificial Intelligence',
    'glos.ai.def': 'Software that learns from examples instead of being told what to do in every case.\nIt does not think like a person — it spots patterns and guesses what comes next.',
    'glos.ai.hint': 'Answer a race question about AI',
    'glos.llm.term': 'Language Model',
    'glos.llm.def': 'An AI trained on huge amounts of text whose whole job is guessing which word fits next.\nEvery long answer it writes is built exactly that way.',
    'glos.llm.hint': 'Answer three race questions correctly',
    'glos.training.term': 'Training',
    'glos.training.def': 'The stage where a model sees millions of examples and improves on every mistake.\nIt takes months and thousands of computers working together.',
    'glos.training.hint': 'Build two prompts in the garage',
    'glos.vibe.term': 'Vibe Coding',
    'glos.vibe.def': 'Building software without typing code: you describe what you want, an AI writes it.\nThis game was built exactly that way.',
    'glos.vibe.hint': 'Answer a race question about vibe coding',
    'glos.iterate.term': 'Iteration',
    'glos.iterate.def': 'A round: ask, look at what came out, change one thing, ask again.\nIt is almost never perfect the first time, and that is completely fine.',
    'glos.iterate.hint': 'Answer a race question about rounds and fixes',
    'glos.hallucination.term': 'Hallucination',
    'glos.hallucination.def': 'When a model invents an answer that sounds totally confident — and simply is not true.\nThat is why an important fact always gets checked somewhere else.',
    'glos.hallucination.hint': 'Answer a race question about AI mistakes',
    'glos.data.term': 'Data',
    'glos.data.def': 'Everything a model learns from: texts, pictures, numbers.\nGood, varied data makes a better model than lots of repeated data.',
    'glos.data.hint': 'Collect 25 tokens in total',
    'glos.algorithm.term': 'Algorithm',
    'glos.algorithm.def': 'An exact list of steps for a task, like a recipe.\nThe rivals on track drive by an algorithm — which is why they repeat the same line every lap.',
    'glos.algorithm.hint': 'Finish a race in the top three',
    'glos.neuron.term': 'Neuron',
    'glos.neuron.def': 'A tiny computing cell in a network: it takes numbers, adds them up and passes one result on.\nAlone it is almost nothing; millions together learn to recognise and to write.',
    'glos.neuron.hint': 'Earn three badges',
    'glos.cloud.term': 'Cloud',
    'glos.cloud.def': 'Powerful computers sitting far away that you reach over the internet.\nMost big models run there, not on the computer at home.',
    'glos.cloud.hint': 'Finish a whole championship',
  },
};

/* ══════════════════════════════════════════════════════════ unlock engine ══ */

/** Bus event a badge unlock announces. audio.js can alias this for its own sound. */
export const UNLOCK_EVENT = 'badge:unlocked';
/** Until audio.js has a dedicated cue, ride its generic `audio:play` door. */
export const UNLOCK_SOUND = 'garage.reveal';

/**
 * Evaluate every badge and term against `stats` and persist anything new.
 * Idempotent by construction: an id already in the save is skipped, so replaying
 * the same event stream can never unlock a badge twice or fire a second toast.
 *
 * @param {object}  [stats]
 * @param {object}  [opts]
 *   {silent:true} persist and say nothing at all — for a catch-up pass over an
 *                 old save, where announcing eight badges at once would be noise.
 *   {toast:false} still emit `badge:unlocked` + the sound, but draw no toast —
 *                 for gates and previews, which have no business drawing DOM.
 * @returns {string[]} badge ids unlocked by THIS call
 */
export function evaluate(stats = getStats(), opts = {}) {
  const badges = [...unlockedBadges()];
  const terms = [...unlockedTerms()];
  const fresh = [];

  for (const b of BADGES) {
    if (badges.includes(b.id)) continue;
    let hit = false;
    try { hit = !!b.test(stats, badges); } catch { hit = false; }
    if (hit) { badges.push(b.id); fresh.push(b.id); }
  }
  // Terms are evaluated after badges so 'neuron' (3 badges) can see this frame's.
  const freshTerms = [];
  for (const g of GLOSSARY) {
    if (terms.includes(g.id)) continue;
    let hit = false;
    try { hit = !!g.test(stats, badges); } catch { hit = false; }
    if (hit) { terms.push(g.id); freshTerms.push(g.id); }
  }

  if (fresh.length || freshTerms.length) save.set({ badges, glossary: terms });

  if (!opts.silent) {
    for (const id of fresh) {
      bus.emit(UNLOCK_EVENT, { id, group: badgeById(id)?.group || null });
      bus.emit('audio:play', { name: UNLOCK_SOUND });
      if (opts.toast !== false) showBadgeToast(id);
    }
    for (const id of freshTerms) bus.emit('glossary:unlocked', { id });
  }
  return fresh;
}

/* ═════════════════════════════════════════════════════════════════ tracker ══ */

let _tracker = null;

/**
 * Subscribe to the bus and keep `save.stats` / `badges` / `glossary` current.
 * Safe to call twice (the second call returns the live handle).
 *
 * Costs, because this runs during a race: one object mutation and ~28 numeric
 * predicates per event, on events that fire at most a few times a second
 * (`token:pickup` is the busiest at ~15 a race). localStorage is written only
 * when something actually unlocks, plus once at each race/scene boundary.
 *
 * @param {object} [opts] {toast:false} to track silently (gates, previews)
 * @returns {{dispose:Function, stats:Function, flush:Function}}
 */
export function startBadgeTracker(opts = {}) {
  if (_tracker) return _tracker;
  const toast = opts.toast !== false;
  const offs = [];
  const on = (evt, fn) => offs.push(bus.on(evt, p => { try { fn(p || {}); } catch (e) { console.error(e); } }));

  let s = getStats();
  let dirty = false;

  const bump = () => {
    dirty = true;
    // The bus announcement and the sound are the CONTRACT, not the decoration:
    // `toast:false` (gates, previews) still emits them and only skips the DOM.
    const fresh = evaluate(s, { toast });
    if (fresh.length) dirty = false;             // evaluate() already persisted
    return fresh;
  };
  const persist = () => { if (dirty) { save.set({ stats: s }); dirty = false; } };
  // evaluate() writes badges+glossary but not stats, so keep them in one object:
  // mutating `s` in place and handing the same reference to save keeps the two
  // from drifting apart.
  save.set({ stats: s });

  /* ── quiz ─────────────────────────────────────────────────────────────── */
  const answered = p => {
    s.quizAnswered++;
    if (p.topic) s.topicsAnswered[p.topic] = (s.topicsAnswered[p.topic] || 0) + 1;
  };
  on('quiz:correct', p => {
    answered(p);
    s.quizCorrect++;
    const got = Number(p.tokens) || 0;
    s.tokensQuiz += got;
    s.tokensLifetime += got;
    bump();
  });
  on('quiz:wrong', p => { answered(p); bump(); });
  // A timeout is not an answer and teaches nothing about the topic — it does not
  // unlock that topic's word.
  on('quiz:timeout', () => { s.quizAnswered++; dirty = true; });

  /* ── tokens ───────────────────────────────────────────────────────────── */
  // One pickup is worth exactly 1 (D17 removed the combo multiplier), so the
  // event count IS the token count — no need to trust the running total, which
  // resets every race.
  on('token:pickup', () => { s.tokensPickups++; s.tokensLifetime++; bump(); });

  /* ── drift ────────────────────────────────────────────────────────────── */
  on('drift:tier', p => {
    const tier = Number(p.tier) || 0;
    if (tier > s.bestDriftTier) { s.bestDriftTier = tier; dirty = true; }
  });
  on('drift:boost', p => {
    s.driftBoosts++;
    // race.js emits drift:boost with the tier that was released.
    if ((Number(p.tier) || 0) >= 3) s.driftBoostsTop++;
    bump();
  });

  /* ── garage (needs `garage:built`, see NEEDED_EVENTS) ─────────────────── */
  on('garage:built', p => {
    s.promptsBuilt++;
    const score = Number(p.score) || 0;
    if (score > s.bestPromptScore) s.bestPromptScore = score;
    if (p.expert) s.expertPrompts++;
    bump();
    persist();
  });

  /* ── races & championship ─────────────────────────────────────────────── */
  on('race:complete', p => {
    s.racesFinished++;
    s.champRaces++;
    const place = Number(p.place) || 0;
    if (place > 0 && (s.bestPlace === 0 || place < s.bestPlace)) s.bestPlace = place;
    if (place > 0 && place <= 3) s.champPodiums++;
    const bonus = Number(p.tokensFinishBonus ?? p.finishBonus) || 0;
    s.tokensLifetime += bonus;
    bump();
    persist();
  });
  on('championship:complete', p => {
    s.champsFinished++;
    if ((Number(p.place) || 0) === 1) s.champsWon++;
    bump();
    persist();
  });
  // A new season zeroes only the per-season counters. Everything else is a
  // lifetime number and deliberately survives (save.js keeps badges/glossary/
  // stats outside resetChampionship for the same reason).
  on('championship:reset', () => { s.champRaces = 0; s.champPodiums = 0; persist(); });

  /* ── boundaries: cheap places to write to disk ────────────────────────── */
  on('scene:entered', persist);
  on('race:finish', persist);
  // The settings screen's full wipe. Re-read rather than keep stale counters, and
  // write the fresh object straight back: save.reset() re-uses the DEFAULTS
  // object graph, so continuing to mutate whatever is in there would poison the
  // defaults for the rest of the session.
  on('save:reset', () => { s = { ...DEFAULT_STATS, topicsAnswered: {} }; dirty = false; save.set({ stats: s }); });

  _tracker = {
    dispose() { for (const off of offs) { try { off(); } catch { /* gone */ } } _tracker = null; },
    stats: () => s,
    flush: persist,
    /** Force a re-check (used by the collection screen when it opens). */
    check: () => bump(),
  };
  return _tracker;
}

/** The live tracker, or null. */
export const badgeTracker = () => _tracker;

/* ═══════════════════════════════════════════════════════════════════ toast ══ */
// Deliberately NOT a modal: no pushModal, no key handler, no focus steal, no
// pointer events. It cannot freeze the race and it cannot take Escape.

const TOAST_CSS = `
#pr-badge-toasts{position:fixed;inset-block-start:16px;inset-inline:0;margin-inline:auto;
  inline-size:fit-content;max-inline-size:min(420px,92vw);z-index:9000;pointer-events:none;
  display:flex;flex-direction:column;gap:8px;align-items:center}
#pr-badge-toasts *{pointer-events:none}
.pr-toast{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:999px;
  background:linear-gradient(180deg,rgba(52,44,30,.96),rgba(24,20,14,.96));
  border:1px solid rgba(255,194,71,.55);
  box-shadow:0 12px 34px rgba(0,0,0,.55),0 0 26px -12px rgba(255,194,71,.9);
  color:#f4f1ea;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
  animation:prToastIn .38s cubic-bezier(.22,.9,.3,1) both, prToastOut .5s ease-in 3.9s both}
.pr-toast svg{inline-size:34px;block-size:34px;flex:none;
  filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))}
.pr-toast .k{font-size:11px;font-weight:900;letter-spacing:.12em;color:#ffc247}
.rtl .pr-toast .k{letter-spacing:.03em}
.pr-toast .v{font-size:15px;font-weight:900;line-height:1.2}
@keyframes prToastIn{from{opacity:0;translate:0 -14px;scale:.94}to{opacity:1;translate:0 0;scale:1}}
@keyframes prToastOut{to{opacity:0;translate:0 -10px}}
@media (prefers-reduced-motion:reduce){.pr-toast{animation:prToastIn .01s both,prToastOut .01s 4.2s both}}
`;

const TOAST_LABEL = { he: 'תג חדש', en: 'New badge' };

function toastHost() {
  if (typeof document === 'undefined') return null;
  let host = document.getElementById('pr-badge-toasts');
  if (host) return host;
  if (!document.getElementById('pr-badge-style')) {
    const st = document.createElement('style');
    st.id = 'pr-badge-style';
    st.textContent = TOAST_CSS;
    document.head.appendChild(st);
  }
  host = document.createElement('div');
  host.id = 'pr-badge-toasts';
  host.setAttribute('role', 'status');        // announced, never focused
  host.setAttribute('aria-live', 'polite');
  // document.body, NOT engine.ui: engine.goto() calls ui.replaceChildren().
  document.body.appendChild(host);
  return host;
}

/**
 * Announce a freshly earned badge. Non-blocking, self-dismissing, stacks.
 * Exported so the lead (or a gate) can fire one without faking an unlock.
 */
export function showBadgeToast(id) {
  const b = badgeById(id);
  const host = toastHost();
  if (!b || !host) return null;
  const lang = (save.read('lang') === 'en') ? 'en' : 'he';
  const name = (BADGE_STRINGS[lang] || BADGE_STRINGS.he)[`badge.${id}.name`] || id;

  const el = document.createElement('div');
  el.className = 'pr-toast';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 48 48');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ICONS[b.icon] || ICONS.token;
  const txt = document.createElement('div');
  const k = document.createElement('div');
  k.className = 'k';
  k.textContent = TOAST_LABEL[lang];
  const v = document.createElement('div');
  v.className = 'v';
  v.textContent = name;
  txt.append(k, v);
  el.append(icon, txt);
  host.appendChild(el);

  const kill = () => { el.remove(); if (!host.children.length) host.remove(); };
  el.addEventListener('animationend', e => { if (e.animationName === 'prToastOut') kill(); });
  setTimeout(kill, 6000);   // belt and braces: animations can be disabled
  return el;
}

/* ══════════════════════════════════════════════ events the lead must add ══ */
/**
 * Events this tracker listens for that DO NOT EXIST YET. Listed as data so the
 * lead can grep it, and so a future gate can assert they arrived.
 *
 * Nothing here is emitted by this module: adding an emit to a file this agent
 * does not own is exactly the silent seam the project keeps getting burned by.
 */
export const NEEDED_EVENTS = [
  {
    event: 'garage:built',
    payload: '{ score:number 0-100, tier:0-3, expert:boolean, slotKey:string, coherent:boolean }',
    file: 'src/garage/garage.js — at the reveal, where the part is handed to onDone()',
    alternative: 'src/scenes.js — inside SCENES.garage onDone(part, gain), which already reads part.score',
    why: 'The three prompt-quality badges (prompt-good / prompt-80 / prompt-max), the '
       + 'expert-mode badge, and the אימון glossary term have no other source. '
       + 'garage.js is preferred over scenes.js so free-play prompts count too.',
  },
  {
    event: 'championship:complete',
    payload: '{ place:number 1-8, points:number, races:number, championship:number }',
    file: 'src/scenes.js — SCENES.podium, in the block that increments championshipsDone',
    why: 'champ-win cannot be derived from race results: final standings are computed '
       + 'in scenes.js from totalPoints() and include the seven AI racers. '
       + 'champ-finish and the ענן term already fall back to "three races finished".',
  },
];

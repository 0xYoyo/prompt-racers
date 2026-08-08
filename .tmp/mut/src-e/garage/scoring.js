// THE GARAGE — deterministic quality computation.
//
// Nothing in this file is random. Same prompt in, same part out, every time —
// which is what lets a child form the rule "more specific → better part" by
// experiment, and what keeps the screenshot harness reproducible.
import { SLOT_BY_KEY, optionById } from './prompts.js';
import { pickTips } from './tips.js';

// The kart's stat baseline before any garage part is installed.
export const BASE_STATS = { speed: 52, accel: 48, handling: 50, weight: 50 };

// Stat keys, in the order the UI draws its bars.
export const STAT_KEYS = ['speed', 'accel', 'handling', 'weight'];

// For `weight`, LOWER is better. Everything else: higher is better.
export const LOWER_IS_BETTER = { weight: true };

// tier → the visual variant string the kart model consumes when it attaches the
// part. Exported so kart/kartmodel.js can switch on it without importing scoring
// logic. (Lead wires this up.)
export const VISUAL_TIER = ['scrappy', 'basic', 'tuned', 'pro'];
export const visualTierFor = tier => VISUAL_TIER[clamp(tier | 0, 0, 3)];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ─────────────────────────────────────────────────────────────────────────────
// THE FORMULA (guided mode)
//
//   score = 8                       base — a vague prompt still yields a part
//         + 12 × goalSpec           (0..36)  what/when/where is the biggest lever
//         +  9 × constraintSpec     (0..27)  what must not break
//         +  6 × styleSpec          (0..18)  how it looks / context
//         +  6 if constraintSpec>=1 constraint bonus — the core lesson of the
//                                   game is that a limit makes the output better
//         +  7 if coherent          the chosen constraint is one this goal
//                                   actually depends on (declared per goal option
//                                   as `coherentWith`). Each goal names DIFFERENT
//                                   partners, so a mismatched goal/limit pair
//                                   really does lose these 7 points — "make the
//                                   goal and the limit agree" is a live rule, not
//                                   a restatement of "buy the expensive limit".
//
//   Min  =   8 (all-vague)          → tier 0, a working but comedic part
//   Max  = 100 (all-specific + both bonuses) — but see DEFAULT_BUDGET: the token
//         budget (17) is smaller than the maximum ask (21), so buying the most
//         precise option in every row is impossible. Of the 57 affordable
//         combinations exactly TWO reach tier 3, and both of them are coherent:
//           goal ●●● + limit ●●● , no style          → 84
//           goal ●●  + limit ●●  + style ●●●         → 81
//         i.e. the ceiling is not "buy the expensive things", it is "spend where
//         it counts and make the two halves agree".
//
//   Slot 1 (which part) does NOT feed the score: choosing "engine" is not more
//   or less specific than choosing "tires", it only decides WHICH stats move.
//
// Tier cuts: 0: <30   1: 30–54   2: 55–79   3: 80+
// ─────────────────────────────────────────────────────────────────────────────
export const WEIGHTS = { goal: 12, constraint: 9, style: 6, base: 8, constraintBonus: 6, coherenceBonus: 7 };

export function tierForScore(score) {
  if (score >= 80) return 3;
  if (score >= 55) return 2;
  if (score >= 30) return 1;
  return 0;
}

function specOf(slotKey, id) { return optionById(slotKey, id)?.specificity ?? 0; }

export function isCoherent(selection) {
  const goal = optionById('goal', selection.goal);
  if (!goal || !goal.coherentWith) return false;
  return goal.coherentWith.includes(selection.constraint);
}

/**
 * Score a guided (four-slot) prompt.
 * @param selection {part, goal, constraint, style} — option ids, may be partial
 * @param ctx       {visit, seen, buildsThisVisit}
 * @returns {score, tier, stats, deltas, flavourKeyHe, tips, breakdown, coherent, complete}
 */
export function scorePrompt(selection = {}, ctx = {}) {
  const goalSpec = specOf('goal', selection.goal);
  const constraintSpec = specOf('constraint', selection.constraint);
  const styleSpec = specOf('style', selection.style);
  const coherent = isCoherent(selection);

  const breakdown = {
    base: WEIGHTS.base,
    goal: WEIGHTS.goal * goalSpec,
    constraint: WEIGHTS.constraint * constraintSpec,
    style: WEIGHTS.style * styleSpec,
    constraintBonus: constraintSpec >= 1 ? WEIGHTS.constraintBonus : 0,
    coherenceBonus: coherent ? WEIGHTS.coherenceBonus : 0,
  };
  const score = clamp(Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0)), 0, 100);
  const tier = tierForScore(score);

  const slotKey = selection.part || 'engine';
  const deltas = partStatsFor(slotKey, tier);

  const tips = pickTips(selection, {
    goalSpec, constraintSpec, styleSpec, coherent, expert: false, lowFreeText: false,
    unspent: ctx.unspent || 0,
  }, ctx);

  return {
    score, tier, coherent, breakdown, deltas,
    specs: { goal: goalSpec, constraint: constraintSpec, style: styleSpec },
    stats: applyStats(BASE_STATS, deltas),
    slotKey,
    visualTier: visualTierFor(tier),
    flavourKeyHe: `garage.flavour.${slotKey}.${tier}`,
    tips,
    complete: !!(selection.part && selection.goal && selection.constraint && selection.style),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STAT TABLE — tier differences are gameplay, not decoration.
//
// Read a row as: what this part does at tier 0 / 1 / 2 / 3.
// Tier 0 always DOES the thing it was asked for (a vague "make it fast" engine
// really is fast) and always pays an unasked-for price somewhere else — that is
// the joke and the lesson in the same number.
// `weight` is a burden: positive = heavier = worse.
// ─────────────────────────────────────────────────────────────────────────────
export const STAT_TABLE = {
  engine: [
    { speed: 6, accel: 3, handling: -5, weight: 6 },
    { speed: 10, accel: 6, handling: -3, weight: 4 },
    { speed: 15, accel: 11, handling: 0, weight: 1 },
    { speed: 19, accel: 16, handling: 3, weight: -2 },
  ],
  tires: [
    { speed: 2, accel: 5, handling: 3, weight: 5 },
    { speed: 3, accel: 8, handling: 7, weight: 3 },
    { speed: 5, accel: 12, handling: 13, weight: 1 },
    { speed: 7, accel: 15, handling: 19, weight: -1 },
  ],
  wing: [
    { speed: -4, accel: 1, handling: 6, weight: 5 },
    { speed: -1, accel: 2, handling: 10, weight: 3 },
    { speed: 3, accel: 4, handling: 15, weight: 1 },
    { speed: 6, accel: 6, handling: 20, weight: -1 },
  ],
  chassis: [
    { speed: 3, accel: 4, handling: 2, weight: -2 },
    { speed: 5, accel: 7, handling: 6, weight: -6 },
    { speed: 8, accel: 11, handling: 10, weight: -11 },
    { speed: 11, accel: 15, handling: 14, weight: -16 },
  ],
};

/** Stat deltas a part of this kart slot and tier applies to the kart. */
export function partStatsFor(slotKey, tier) {
  const row = STAT_TABLE[slotKey] || STAT_TABLE.engine;
  return { ...row[clamp(tier | 0, 0, 3)] };
}

export function applyStats(base, deltas) {
  const out = {};
  for (const k of STAT_KEYS) out[k] = clamp((base[k] || 0) + (deltas[k] || 0), 0, 100);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPERT MODE — free text, scored by a transparent client-side heuristic.
//
// Design rules: reward concreteness, punish filler, never humiliate. The floor
// is 18 (a usable tier-0 part), so a child who writes something silly still
// drives away with a working — and funny — part.
//
//   length       up to 22   ~1.6 per word, so ~14 words maxes it
//   concrete     up to 24   +8 per distinct concrete racing noun
//   numbers      up to 16   +10 for a digit, +6 more for a unit (ק"ג, קמ"ש…)
//   constraint   up to 22   +14 for a constraint word, +8 for a second one
//   style        up to 16   +9 for a style/colour word, +7 for a second
//   filler       up to −18  −6 per vague word ("טוב", "מגניב", "משהו"…)
//   → clamp to 18..100
//
// The UI shows this breakdown as a checklist, so the heuristic is not a black
// box — the child can see exactly which box they have not ticked yet.
// ─────────────────────────────────────────────────────────────────────────────
export const HEURISTIC_CAPS = { length: 22, concrete: 24, numbers: 16, constraint: 22, style: 16, filler: -18 };
export const FREE_TEXT_FLOOR = 18;

// ── Lexicons ──────────────────────────────────────────────────────────────────
// Each entry is a CONCEPT — a group of surface forms that all mean the same
// thing. Scoring counts distinct concepts, never surface forms, so writing
// "צמיגים" cannot score twice for being both "צמיג" and "צמיגים".
//
// Matching is on tokenised WORDS, not substrings. Substring matching made
// 'בלי' (without) a hit inside 'בלימה' (braking) — so "אחרי בלימה" silently
// collected 14 constraint points for a prompt with no constraint in it. Hebrew
// has no case, but it does glue the particles ו/ה/ב/ל/מ/כ/ש onto the front of a
// word, so a token matches if it equals a form OR equals a form after stripping
// up to two leading particles ("ובצבע" → "בצבע" → "צבע"). Multi-word entries are
// matched as whole-word phrases against the token stream.
const CONCRETE = [
  ['מנוע', 'מנועים', 'engine', 'engines'],
  ['צמיג', 'צמיגים', 'צמיגי', 'tire', 'tires', 'tyre', 'tyres'],
  ['כנף', 'כנפיים', 'wing', 'wings'],
  ['שלדה', 'שילדה', 'chassis'],
  ['בלם', 'בלמים', 'בלימה', 'בלימות', 'לבלום', 'brake', 'brakes', 'braking'],
  ['סיבוב', 'סיבובים', 'עיקול', 'עיקולים', 'פנייה', 'corner', 'corners', 'turn', 'turns'],
  ['יציאה', 'exit'],
  ['כניסה', 'entry'],
  ['מהירות', 'speed'],
  ['אחיזה', 'גריפ', 'grip', 'traction'],
  ['משקל', 'weight'],
  ['דלק', 'fuel'],
  ['האצה', 'תאוצה', 'להאיץ', 'שאאיץ', 'accelerate', 'acceleration', 'accelerating', 'accel'],
  ['יציבות', 'stability', 'stable'],
  ['ישר', 'ישורת', 'straight', 'straights'],
  ['חול', 'sand'],
  ['רטוב', 'גשם', 'wet', 'rain'],
  ['הילוך', 'הילוכים', 'gear', 'gears'],
  ['מתלה', 'מתלים', 'suspension'],
  ['זווית', 'זוויות', 'angle', 'angles'],
  ['גלגל', 'גלגלים', 'wheel', 'wheels'],
];
const UNITS = [
  ['ק"ג', 'קג', 'קילו', 'קילוגרם', 'kg', 'kilo', 'kilos'],
  ['קמ"ש', 'קמש', 'kmh', 'km/h', 'mph'],
  ['שניות', 'שנייה', 'שניה', 'sec', 'second', 'seconds'],
  ['מעלות', 'מעלה', 'degree', 'degrees'],
  ['אחוז', 'אחוזים', 'percent', '%'],
  ['מטר', 'מטרים', 'ס"מ', 'meter', 'metre', 'meters', 'cm'],
];
const CONSTRAINT = [
  ['בלי', 'מבלי', 'without'],
  ['לא יותר', 'no more than', 'not more than'],
  ['לכל היותר', 'מקסימום', 'at most', 'max'],
  ['תוך שמירה', 'תוך שמירת', 'while keeping'],
  ['אבל שלא', 'ושלא', 'but not'],
  ['בלבד', 'only'],
  ['למרות', 'despite'],
];
const STYLE = [
  ['סטייל', 'סגנון', 'style'],
  ['צבע', 'צבעים', 'colour', 'color', 'colours', 'colors'],
  ['ייראה', 'יראה', 'נראה', 'נראית', 'look', 'looks'],
  ['עיצוב', 'design'],
  ['אווירה', 'vibe', 'mood'],
  ['כתום', 'orange'],
  ['כחול', 'blue'],
  ['אדום', 'red'],
  ['זהב', 'זהוב', 'gold', 'golden'],
  ['שחור', 'black'],
  ['ניאון', 'neon'],
  ['מדבר', 'מדברי', 'desert'],
  ['ברגים', 'טלאים', 'bolts', 'patches'],
  ['פסים', 'stripes', 'striped'],
  ['מבריק', 'מט', 'glossy', 'matte'],
];
const FILLER = [
  ['טוב', 'טובה', 'good'],
  ['מגניב', 'אחלה', 'סבבה', 'cool', 'awesome'],
  ['משהו', 'something', 'stuff'],
  ['כאילו'],
  ['הכי', 'best', 'super'],
  ['מדהים', 'amazing', 'great'],
  ['יפה', 'nice', 'pretty'],
  ['סתם', 'וואלה'],
  ['ממש', 'מאוד', 'מאד', 'very', 'really'],
];

// Hebrew proclitics. Stripped at most twice ("ובצבע" → "בצבע" → "צבע"), and only
// from words long enough that stripping cannot invent a different word.
const PARTICLES = new Set(['ו', 'ה', 'ב', 'ל', 'מ', 'כ', 'ש']);

/** Split into words. Keeps " and ' (they live inside ק"ג, קמ"ש) and splits off %. */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/%/g, ' % ')
    .replace(/[^֐-תa-z0-9"'%/]+/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^['"]+|['"]+$/g, ''))
    .filter(Boolean);
}

/** Every form a token could be standing in for, once its particles come off. */
function tokenForms(word) {
  const forms = [word];
  let w = word;
  for (let i = 0; i < 2 && w.length > 3 && PARTICLES.has(w[0]); i++) {
    w = w.slice(1);
    forms.push(w);
  }
  return forms;
}

/**
 * How many distinct CONCEPTS from `groups` appear in `text`.
 * Word-boundary matching for single words, whole-phrase matching for phrases.
 */
function countConcepts(text, groups) {
  const tokens = tokenize(text);
  const bag = new Set();
  for (const tk of tokens) for (const f of tokenForms(tk)) bag.add(f);
  const joined = ' ' + tokens.join(' ') + ' ';
  let n = 0;
  for (const group of groups) {
    for (const form of group) {
      const hit = form.includes(' ')
        ? joined.includes(' ' + form + ' ')
        : bag.has(form);
      if (hit) { n++; break; }
    }
  }
  return n;
}

/**
 * Score free text. Same return shape as scorePrompt() so the reveal UI does not
 * care which mode produced the part.
 * @param text     the child's prompt
 * @param slotKey  which kart slot they are building (defaults to engine)
 */
export function scoreFreeText(text, slotKey = 'engine', ctx = {}) {
  const raw = String(text || '');
  const words = raw.trim().split(/\s+/).filter(Boolean).length;

  const lengthPts = Math.min(HEURISTIC_CAPS.length, Math.round(words * 1.6));

  const concreteHits = countConcepts(raw, CONCRETE);
  const concretePts = Math.min(HEURISTIC_CAPS.concrete, concreteHits * 8);

  const hasDigit = /\d/.test(raw);
  const unitHits = countConcepts(raw, UNITS);
  const numberPts = Math.min(HEURISTIC_CAPS.numbers, (hasDigit ? 10 : 0) + (unitHits ? 6 : 0));

  const constraintHits = countConcepts(raw, CONSTRAINT);
  const constraintPts = Math.min(HEURISTIC_CAPS.constraint, constraintHits >= 2 ? 22 : constraintHits ? 14 : 0);

  const styleHits = countConcepts(raw, STYLE);
  const stylePts = Math.min(HEURISTIC_CAPS.style, styleHits >= 2 ? 16 : styleHits ? 9 : 0);

  const fillerHits = countConcepts(raw, FILLER);
  const fillerPts = Math.max(HEURISTIC_CAPS.filler, -6 * fillerHits);

  const breakdown = {
    length: lengthPts, concrete: concretePts, numbers: numberPts,
    constraint: constraintPts, style: stylePts, filler: fillerPts,
  };
  const rawScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = clamp(Math.round(Math.max(FREE_TEXT_FLOOR, rawScore)), 0, 100);
  const tier = tierForScore(score);
  const deltas = partStatsFor(slotKey, tier);

  const tips = pickTips({ part: slotKey }, {
    goalSpec: concretePts >= 16 ? 3 : concretePts >= 8 ? 2 : 0,
    constraintSpec: constraintPts >= 22 ? 3 : constraintPts ? 2 : 0,
    styleSpec: stylePts >= 16 ? 3 : stylePts ? 2 : 0,
    coherent: constraintPts > 0 && concretePts > 0,
    expert: true,
    lowFreeText: score < 55,
  }, ctx);

  return {
    score, tier, breakdown, deltas, slotKey, words,
    specs: {
      goal: concretePts >= 16 ? 3 : concretePts >= 8 ? 2 : 0,
      constraint: constraintPts >= 22 ? 3 : constraintPts ? 2 : 0,
      style: stylePts >= 16 ? 3 : stylePts ? 2 : 0,
    },
    coherent: constraintPts > 0 && concretePts > 0,
    stats: applyStats(BASE_STATS, deltas),
    visualTier: visualTierFor(tier),
    flavourKeyHe: `garage.flavour.${slotKey}.${tier}`,
    tips,
    // What the UI's live checklist ticks off.
    checks: {
      concrete: concretePts > 0,
      numbers: numberPts > 0,
      constraint: constraintPts > 0,
      style: stylePts > 0,
      length: words >= 8,
      filler: fillerPts === 0,
    },
    complete: words >= 3,
  };
}

/**
 * Tokens earned for a finished part. Expert mode pays ~60% more — that is the
 * incentive for older kids to leave the training wheels.
 */
/**
 * Bonus tokens for a well-built prompt.
 *
 * MUST STAY BELOW THE SPEND. At the previous rates (0.22 guided / 0.35 expert) a
 * score of 84 refunded 18 tokens against a garage spend of ~13 — so every visit
 * turned a profit, the wallet compounded, and the budget stopped binding after the
 * first garage. That silently cancels the thing the garage exists to teach:
 * "precision costs something, so choose where it is worth spending". A reward the
 * player can farm is not a reward, it is an exploit with a friendly name.
 *
 * The real prize for a good prompt is the better part. This is a partial rebate on
 * top — generous enough to feel earned, never enough to remove next visit's choice.
 * Expert mode keeps a meaningfully larger rate, as specified.
 */
export function tokenReward(score, expert = false) {
  const raw = score * (expert ? 0.16 : 0.10);
  return Math.min(expert ? 12 : 8, Math.round(raw));
}

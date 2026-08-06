// THE GARAGE — slot content. Hebrew is the source language here: every `he`
// string was written natively for 8–15 year olds, then an English equivalent was
// written next to it. Nothing here is a translation of English.
//
// ── Why the fragments look the way they do ────────────────────────────────────
// The four picks are glued into ONE readable Hebrew sentence:
//
//   בורג, בנה לי {part} {goal}, {constraint} {style}.
//
// Hebrew has gender/number agreement, so a naive template ("מנוע ש*יישאר* יציב"
// vs "כנף ש*תישאר* יציבה") breaks the moment the player changes the part. The
// fragments are therefore designed so that NO fragment ever agrees with the part:
//
//   • goal       → "כדי ש…" clause whose subject is the PLAYER, in future tense,
//                  which is gender-neutral in Hebrew (אאיץ / אסע), or impersonal
//                  ("כדי שיהיה טוב").
//   • constraint → "בלי + שם פועל" (infinitive). Infinitives never inflect.
//   • style      → "ו + מילת יחס" (a prepositional phrase). Also never inflects.
//
// Result: all 4 × 4 × 4 × 4 = 256 combinations are grammatical Hebrew.
// The style fragment carries the list-final "ו" so the sentence ends like a real
// Hebrew list ("X, Y ו-Z") instead of a comma-spliced pile.
//
// ── Prices ────────────────────────────────────────────────────────────────────
// Prices are NOT a second copy of the specificity answer. Two rules:
//   1. Slot 1 (which part) costs the same whatever you pick — choosing a part is
//      not a quality decision, so it must not read like one.
//   2. Across rows, the same price buys a DIFFERENT amount of precision: 4 tokens
//      buys "light" (a real, measurable limit) but only "desert style" (nice, and
//      worth far fewer points). Price therefore cannot tell you what is good; only
//      trying it and watching the stat bars can.
// Within a row price never falls as specificity rises — otherwise the cheaper
// option would strictly dominate and the row would have a dead end in it.
//
// MAX_COST is 21 against a default budget of 17 (see garage.js), so roughly a
// quarter of the maximum ask has to be given up. Which quarter is the lesson.
import { registerStrings } from '../ui/i18n.js';

// Slot 1 ids are EXACTLY the kart attachment keys the kart model exposes.
export const KART_SLOTS = ['engine', 'tires', 'wing', 'chassis'];

// specificity: 0 = vague, 3 = precise & measurable. cost = tokens.
export const SLOTS = [
  {
    key: 'part',
    hue: 'part',
    he: 'איזה חלק?',
    en: 'Which part?',
    blankHe: 'איזה חלק?',
    blankEn: 'which part?',
    teachHe: 'קודם כול — על מה בכלל מדברים.',
    teachEn: 'First — what are we even talking about.',
    // Not scored: picking "engine" is not more specific than picking "tires".
    scored: false,
    options: [
      {
        id: 'engine', specificity: 1, cost: 4,
        he: 'מנוע', en: 'Engine',
        subHe: 'כוח ומהירות שיא', subEn: 'Power and top speed',
        sentenceFragmentHe: 'מנוע חדש', sentenceFragmentEn: 'a new engine',
      },
      {
        id: 'tires', specificity: 1, cost: 4,
        he: 'צמיגים', en: 'Tires',
        subHe: 'אחיזה ויציאה מסיבוב', subEn: 'Grip and corner exit',
        sentenceFragmentHe: 'סט צמיגים חדש', sentenceFragmentEn: 'a new set of tires',
      },
      {
        id: 'wing', specificity: 1, cost: 4,
        he: 'כנף', en: 'Wing',
        subHe: 'יציבות במהירות גבוהה', subEn: 'Stability at speed',
        sentenceFragmentHe: 'כנף אחורית חדשה', sentenceFragmentEn: 'a new rear wing',
      },
      {
        id: 'chassis', specificity: 1, cost: 4,
        he: 'שלדה', en: 'Chassis',
        subHe: 'משקל וזריזות', subEn: 'Weight and agility',
        sentenceFragmentHe: 'שלדה חדשה', sentenceFragmentEn: 'a new chassis',
      },
    ],
  },

  {
    key: 'goal',
    hue: 'goal',
    he: 'מה לשפר?',
    en: 'What should it improve?',
    blankHe: 'מה לשפר?',
    blankEn: 'improve what?',
    teachHe: 'ככל שאומרים לבורג מתי ואיפה, כך הוא יידע טוב יותר מה לבנות.',
    teachEn: 'The more Boreg is told when and where, the better he knows what to build.',
    scored: true,
    axisHe: 'מתי ואיפה',
    axisEn: 'when and where',
    options: [
      {
        id: 'good', specificity: 0, cost: 0,
        he: 'שיהיה טוב', en: 'Make it good',
        subHe: 'בורג ינחש. בהצלחה.', subEn: 'Boreg will guess. Good luck.',
        sentenceFragmentHe: 'כדי שיהיה טוב',
        sentenceFragmentEn: 'so it will be good',
      },
      {
        id: 'faster', specificity: 1, cost: 3,
        he: 'שאסע מהר יותר', en: 'So I go faster',
        subHe: 'כיוון כללי, בלי מתי ואיפה', subEn: 'A direction, but no when or where',
        sentenceFragmentHe: 'כדי שאסע מהר יותר',
        sentenceFragmentEn: 'so I go faster',
        // Going faster everywhere is a weight problem before it is anything else.
        coherentWith: ['light'],
      },
      {
        id: 'accel-brake', specificity: 2, cost: 5,
        he: 'שאאיץ מהר יותר אחרי בלימה', en: 'So I accelerate faster after braking',
        subHe: 'כבר יש כאן רגע מדויק', subEn: 'Now there is an exact moment',
        sentenceFragmentHe: 'כדי שאאיץ מהר יותר אחרי בלימה',
        sentenceFragmentEn: 'so I accelerate faster after braking',
        // Accelerating out of a stop is pure weight. Stability is not the issue.
        coherentWith: ['light'],
      },
      {
        id: 'accel-corner', specificity: 3, cost: 7,
        he: 'שאאיץ מהר יותר ביציאה מסיבוב', en: 'So I accelerate faster out of a corner',
        subHe: 'מתי, איפה, ומה נמדד', subEn: 'When, where, and what gets measured',
        sentenceFragmentHe: 'כדי שאאיץ מהר יותר ביציאה מסיבוב',
        sentenceFragmentEn: 'so I accelerate faster coming out of a corner',
        // A corner exit is weight AND grip at speed at the same time — only the
        // two-sided limit is talking about the same problem as this goal.
        coherentWith: ['balanced'],
      },
    ],
  },

  {
    key: 'constraint',
    hue: 'limit',
    he: 'מה אסור להרוס?',
    en: 'What must not break?',
    blankHe: 'מה אסור להרוס?',
    blankEn: 'what must not break?',
    teachHe: 'הגבלה זה לא עונש — זה מה שהופך רעיון לחלק שבאמת עובד.',
    teachEn: 'A limit is not a punishment — it is what turns an idea into a real part.',
    scored: true,
    axisHe: 'מה אסור להרוס',
    axisEn: 'what must not break',
    options: [
      {
        id: 'none', specificity: 0, cost: 0,
        he: 'בלי הגבלות', en: 'No limits',
        subHe: 'מותר לו הכול. גם דברים מוזרים.', subEn: 'Anything goes. Including weird things.',
        sentenceFragmentHe: 'בלי הגבלות', sentenceFragmentEn: 'with no limits',
      },
      {
        id: 'nothing-else', specificity: 1, cost: 2,
        he: 'בלי לקלקל שום דבר אחר', en: 'Without breaking anything else',
        subHe: 'הגבלה — אבל בורג לא יודע מה "אחר"', subEn: 'A limit — but "anything" is not a thing',
        sentenceFragmentHe: 'בלי לקלקל שום דבר אחר',
        sentenceFragmentEn: 'without breaking anything else',
      },
      {
        id: 'light', specificity: 2, cost: 4,
        he: 'בלי להוסיף משקל', en: 'Without adding weight',
        subHe: 'הגבלה אמיתית ומדידה', subEn: 'A real, measurable limit',
        sentenceFragmentHe: 'בלי להוסיף משקל',
        sentenceFragmentEn: 'without adding any weight',
      },
      {
        id: 'balanced', specificity: 3, cost: 6,
        he: 'בלי להוסיף משקל ובלי לאבד יציבות',
        en: 'Without adding weight and without losing stability',
        subHe: 'שתי הגבלות שמושכות לכיוונים הפוכים', subEn: 'Two limits pulling opposite ways',
        sentenceFragmentHe: 'בלי להוסיף משקל ובלי לאבד יציבות במהירות גבוהה',
        sentenceFragmentEn: 'without adding weight and without losing stability at high speed',
      },
    ],
  },

  {
    key: 'style',
    hue: 'style',
    he: 'איך זה ייראה?',
    en: 'How should it look?',
    blankHe: 'איך זה ייראה?',
    blankEn: 'looking how?',
    teachHe: 'גם לסגנון צריך כיוון, אחרת בורג בוחר בעצמו. ובורג אוהב סגול.',
    teachEn: 'Style needs direction too, or Boreg picks for you. Boreg likes purple.',
    scored: true,
    axisHe: 'איך זה ייראה',
    axisEn: 'how it looks',
    options: [
      {
        id: 'any', specificity: 0, cost: 0,
        he: 'לא משנה', en: "Doesn't matter",
        subHe: 'בורג יבחר. אמרנו סגול?', subEn: 'Boreg will choose. We said purple?',
        sentenceFragmentHe: 'ולא משנה לי איך זה ייראה',
        sentenceFragmentEn: 'and it does not matter how it looks',
      },
      {
        id: 'orange', specificity: 1, cost: 2,
        he: 'בצבע כתום זוהר', en: 'In glowing orange',
        subHe: 'צבע זה כבר משהו', subEn: 'A colour is already something',
        sentenceFragmentHe: 'ובצבע כתום זוהר',
        sentenceFragmentEn: 'and in a glowing orange',
      },
      {
        id: 'desert', specificity: 2, cost: 3,
        he: 'בסטייל מרוצי מדבר, עם פסים ואבק', en: 'Desert-racing style, stripes and dust',
        subHe: 'סגנון שיש לו כיוון ברור', subEn: 'A style with a clear direction',
        sentenceFragmentHe: 'ובסטייל מרוצי מדבר, עם פסים ואבק',
        sentenceFragmentEn: 'and in a desert-racing style, with stripes and dust',
      },
      {
        id: 'workshop', specificity: 3, cost: 4,
        he: 'בסטייל מוסך ישן, עם טלאים וברגים בולטים',
        en: 'Old-workshop style, patches and visible bolts',
        subHe: 'סגנון עם סיפור מאחוריו', subEn: 'A style with a story behind it',
        sentenceFragmentHe: 'ובסטייל של מוסך ישן, עם טלאים וברגים בולטים',
        sentenceFragmentEn: 'and in an old-workshop style, with patches and visible bolts',
      },
    ],
  },
];

export const SLOT_BY_KEY = Object.fromEntries(SLOTS.map(s => [s.key, s]));

export function optionsFor(slotKey) { return SLOT_BY_KEY[slotKey]?.options || []; }

export function optionById(slotKey, id) {
  return optionsFor(slotKey).find(o => o.id === id) || null;
}

export function costOf(selection) {
  let c = 0;
  for (const s of SLOTS) {
    const o = optionById(s.key, selection[s.key]);
    if (o) c += o.cost;
  }
  return c;
}

export const MAX_COST = SLOTS.reduce((a, s) => a + Math.max(...s.options.map(o => o.cost)), 0);

// The token budget a garage visit starts with. Deliberately well under MAX_COST:
// the child cannot buy the most precise option in every row, so every visit is a
// question of WHICH row deserves the precision.
export const DEFAULT_BUDGET = 17;

// ── Counterfactual prompts (the garage's ghost-preview card) ──────────────────
// The debrief shows the child what the SAME visit would have produced from a
// different prompt. Both helpers return real, legal selections — never an
// invented outcome — so the ghost card can be scored by the same scorePrompt()
// that scored the real one.

/** The vaguest legal version of this prompt: every scored row at its lowest specificity. */
export function vaguestSelection(selection = {}) {
  const out = { ...selection };
  for (const s of SLOTS) {
    if (!s.scored) continue;
    out[s.key] = s.options.reduce((a, b) => (b.specificity < a.specificity ? b : a)).id;
  }
  return out;
}

/**
 * The sharpest prompt the SAME token budget could actually have bought.
 * Upgrades one row at a time, always taking the best score gain per token, and
 * never exceeding `budget` — so the card is an achievable invitation, not a
 * fantasy the child could not have afforded.
 *
 * `scoreOf(selection) -> number` is injected so this file stays free of any
 * scoring import (scoring.js already imports from here).
 */
export function bestAffordable(selection, budget, scoreOf) {
  let cur = { ...vaguestSelection(selection) };
  for (let guard = 0; guard < 12; guard++) {
    let best = null;
    for (const s of SLOTS) {
      if (!s.scored) continue;
      const now = optionById(s.key, cur[s.key]);
      for (const o of s.options) {
        if (now && o.specificity <= now.specificity) continue;
        const next = { ...cur, [s.key]: o.id };
        if (costOf(next) > budget) continue;
        const gain = scoreOf(next) - scoreOf(cur);
        if (gain <= 0) continue;
        const rate = gain / Math.max(1, o.cost - (now ? now.cost : 0));
        if (!best || rate > best.rate) best = { next, rate };
      }
    }
    if (!best) break;
    cur = best.next;
  }
  return cur;
}

// ── The assembled sentence ────────────────────────────────────────────────────
// Returns an array of parts so the UI can render unfilled slots as tappable
// blanks inside the sentence itself:  [{slot, text, filled}]
export function sentenceParts(selection, lang = 'he') {
  const he = lang !== 'en';
  const piece = key => {
    const slot = SLOT_BY_KEY[key];
    const o = optionById(key, selection[key]);
    if (!o) return { slot: key, filled: false, text: he ? slot.blankHe : slot.blankEn };
    return {
      slot: key, filled: true, spec: o.specificity,
      text: he ? o.sentenceFragmentHe : o.sentenceFragmentEn,
    };
  };
  const lead = he ? 'בורג, בנה לי' : 'Boreg, build me';
  return [
    { slot: null, filled: true, text: lead, lead: true },
    piece('part'),
    piece('goal'),
    { slot: null, filled: true, text: ',', punct: true },
    piece('constraint'),
    piece('style'),
    { slot: null, filled: true, text: '.', punct: true },
  ];
}

export function sentenceText(selection, lang = 'he') {
  let out = '';
  for (const p of sentenceParts(selection, lang)) {
    if (p.punct) out = out.replace(/\s+$/, '') + p.text + ' ';
    else out += p.text + ' ';
  }
  return out.trim();
}

// ── Part names & flavour, by kart slot and quality tier ───────────────────────
// Tier 0 is never a failure: it is a part that technically does the thing and is
// also very funny about it.
export const PART_NAMES = {
  engine: ['מנוע "בערך"', 'מנוע רעם', 'מנוע רעם מכויל', 'מנוע רעם — דגם יציאה מסיבוב'],
  tires: ['צמיגי "יהיה בסדר"', 'צמיגי חול', 'צמיגי חול דביקים', 'צמיגי חול דביקים עם חריצי סיבוב'],
  wing: ['כנף "כאילו כנף"', 'כנף אחורית', 'כנף אחורית מכווננת', 'כנף אחורית מכווננת דו־שלבית'],
  chassis: ['שלדת "מה שהיה במחסן"', 'שלדה קלה', 'שלדת סיבים קלה', 'שלדת סיבים קלה עם משולש חיזוק'],
};

export const PART_NAMES_EN = {
  engine: ['The "Sure, Fine" Engine', 'Thunder Engine', 'Tuned Thunder Engine', 'Thunder Engine — Corner-Exit Spec'],
  tires: ['"It\'ll Be OK" Tires', 'Sand Tires', 'Sticky Sand Tires', 'Sticky Sand Tires, Corner-Grooved'],
  wing: ['The "Wing-ish" Wing', 'Rear Wing', 'Adjustable Rear Wing', 'Two-Stage Adjustable Rear Wing'],
  chassis: ['The "Whatever Was In The Shed" Chassis', 'Light Chassis', 'Light Fibre Chassis', 'Light Fibre Chassis with Brace'],
};

export function partName(slotKey, tier, lang = 'he') {
  const table = lang === 'en' ? PART_NAMES_EN : PART_NAMES;
  return (table[slotKey] || table.engine)[Math.max(0, Math.min(3, tier))];
}

// Flavour lines. Key format: garage.flavour.<slot>.<tier> — scoring.js returns
// the key, garage.js renders it with t().
// Boreg addresses the player in the plural, which is gender-neutral in Hebrew;
// he never says "אתה".
const FLAVOUR = {
  he: {
    'garage.flavour.engine.0': 'סיימתי! הוא באמת מהיר. הוא גם מתנתק אחרי שני סיבובים, אבל מהר מאוד.',
    'garage.flavour.engine.1': 'הנה. חזק, רועש, ושותה דלק כמו גמל אחרי חופשה.',
    'garage.flavour.engine.2': 'זה כבר מנוע רציני. כיילתי אותו בדיוק לפי הפרומפט.',
    'garage.flavour.engine.3': 'זה המנוע הכי מדויק שבניתי. ידעתי בדיוק מה למדוד — כי זה היה כתוב בפרומפט.',
    'garage.flavour.tires.0': 'צמיגים! עגולים! אחד מהם קצת יותר עגול, אבל זה בטח בסדר.',
    'garage.flavour.tires.1': 'אוחזים יפה. בחול קצת פחות, אז עדיף לא לנסוע בחול.',
    'garage.flavour.tires.2': 'תערובת דביקה, בדיוק לפי התיאור. אפשר להרגיש את זה כבר בסיבוב הראשון.',
    'garage.flavour.tires.3': 'חריצים בזווית מדויקת ליציאה מסיבוב. זה מה שהיה בפרומפט, וזה מה שיצא.',
    'garage.flavour.wing.0': 'כנף! היא לא ממש עושה כלום, אבל היא נראית מהירה כשעומדים.',
    'garage.flavour.wing.1': 'לוחצת אותך לכביש. גם מאטה קצת בישר. ככה זה.',
    'garage.flavour.wing.2': 'כיוונתי את הזווית לפי המהירות שהופיעה בפרומפט. הרבה יותר יציב.',
    'garage.flavour.wing.3': 'שני שלבים: לוחצת בסיבוב, משתטחת בישר. בלי לוותר על כלום.',
    'garage.flavour.chassis.0': 'קלה מאוד! כי חסרים בה כמה חלקים. אבל קלה, כמו שכתוב.',
    'garage.flavour.chassis.1': 'הורדתי משקל איפה שיכולתי. עדיין קצת מתפתלת.',
    'garage.flavour.chassis.2': 'סיבים במקומות הנכונים. קלה וגם לא מתפתלת בבלימה.',
    'garage.flavour.chassis.3': 'משולש חיזוק בדיוק במקום שמרגישים בו את הסיבוב. גאה בזה.',
  },
  en: {
    'garage.flavour.engine.0': 'Done! It really is fast. It also detaches after two laps, but very fast.',
    'garage.flavour.engine.1': 'There. Strong, loud, and drinks fuel like a camel after a holiday.',
    'garage.flavour.engine.2': 'Now that is a serious engine. Tuned exactly to the prompt.',
    'garage.flavour.engine.3': 'The most precise engine I have built. I knew what to measure — the prompt said so.',
    'garage.flavour.tires.0': 'Tires! Round! One of them is rounder, but that is probably fine.',
    'garage.flavour.tires.1': 'Decent grip. Less so on sand, so best not to drive on sand.',
    'garage.flavour.tires.2': 'Sticky compound, exactly as described. You feel it in corner one.',
    'garage.flavour.tires.3': 'Grooves angled for corner exit. It was in the prompt, so it is in the part.',
    'garage.flavour.wing.0': 'A wing! It does not really do anything, but it looks fast while parked.',
    'garage.flavour.wing.1': 'Pushes you into the road. Also slows you slightly on the straight. That is the deal.',
    'garage.flavour.wing.2': 'Angle set for the speed the prompt mentioned. Much more stable.',
    'garage.flavour.wing.3': 'Two stages: presses in the corner, flattens on the straight. Giving nothing up.',
    'garage.flavour.chassis.0': 'Very light! Because several parts are missing. But light, as written.',
    'garage.flavour.chassis.1': 'Took weight out where I could. Still flexes a bit.',
    'garage.flavour.chassis.2': 'Fibre in the right places. Light, and no flex under braking.',
    'garage.flavour.chassis.3': 'A brace exactly where the corner is felt. I am proud of this one.',
  },
};

registerStrings(FLAVOUR);

// A second, shorter line spoken by Boreg while he builds.
registerStrings({
  he: {
    'garage.build.0': 'רגע… בטח יהיה בסדר.',
    'garage.build.1': 'עובד על זה!',
    'garage.build.2': 'מודד. חותך. מודד שוב.',
    'garage.build.3': 'זה ייצא מדויק. אני מרגיש את זה בברגים.',
  },
  en: {
    'garage.build.0': 'One sec… it will probably be fine.',
    'garage.build.1': 'On it!',
    'garage.build.2': 'Measure. Cut. Measure again.',
    'garage.build.3': 'This one is coming out precise. I feel it in my bolts.',
  },
});

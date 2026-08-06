// THE GARAGE — teaching tip cards.
//
// Rules these cards follow (they are the whole pedagogy of the game):
//   1. 1–2 sentences. A 10-year-old reads them without effort.
//   2. They refer to what JUST happened on screen, never to "prompt engineering".
//   3. They explain WHY, concretely. No jargon, no scolding, no "you were wrong".
//   4. One idea per card.
//   5. **A card never asserts something the game did not do.** Anything a card
//      claims about the result is interpolated from the ACTUAL computed deltas
//      and the ACTUAL option the player picked — see makeTipVars() below. That is
//      why the bodies contain {gain}, {loss}, {tradeoff}, {goal}, {limit}, {style}
//      instead of hardcoded examples.
//   6. Hebrew is gender-neutral throughout: no masculine imperatives ("תגיד",
//      "כתוב"), no "אתה". Impersonal present tense ("כותבים", "כדאי לזכור") and
//      the neutral possessive "שלך" carry the address instead.
//
// Progression across the three garage visits:
//   visit 1 → specificity          ("say exactly what and when")
//   visit 2 → constraints/trade-offs ("what must NOT break")
//   visit 3 → style/context + putting it all together
//
// `trigger` documents when the card fires; pickTips() implements it.
import { SLOT_BY_KEY, optionById } from './prompts.js';

export const TIPS = [
  // ── VISIT 1 — specificity ───────────────────────────────────────────────────
  {
    id: 'spec.vague', visit: 1,
    trigger: 'player picked the vague goal ("שיהיה טוב")',
    titleHe: 'מה זה "טוב"?',
    titleEn: 'What does "good" mean?',
    bodyHe: 'בורג לא יודע מה זה "טוב", אז הוא ניחש לבד — והניחוש שלו הפעם היה {gain}. אולי בדיוק מה שהיה צריך, אולי לא. ברגע שכתוב מה בדיוק לשפר, זה מפסיק להיות הגרלה.',
    bodyEn: 'Boreg has no idea what "good" means, so he guessed on his own — and this time the guess was {gain}. Maybe exactly right, maybe not. The moment the ask says what to improve, it stops being a lottery.',
  },
  {
    id: 'spec.when-where', visit: 1,
    trigger: 'goal specificity >= 2 (the goal names a moment on the track)',
    titleHe: 'מתי ואיפה',
    titleEn: 'When and where',
    bodyHe: 'בבקשה שלך היה רגע מדויק — "{goal}" — ולכן בורג ידע איזה חלק בדיוק לחזק. בקשה מדויקת, חלק מדויק.',
    bodyEn: 'Your ask named an exact moment — "{goal}" — so Boreg knew exactly what to strengthen. Precise ask, precise part.',
  },
  {
    id: 'budget.tradeoff', visit: 1,
    trigger: 'the build finished with tokens left over',
    titleHe: 'הטוקנים לא מספיקים להכול',
    titleEn: 'The tokens never cover everything',
    bodyHe: 'אין מספיק טוקנים בשביל השורה הכי מדויקת בכל ארבע השורות, וזה בכוונה. השאלה האמיתית היא באיזו שורה הדיוק שווה הכי הרבה — ואת זה רואים בפסים של הקארט.',
    bodyEn: 'There are never enough tokens for the most precise option in all four rows, and that is on purpose. The real question is which row the precision is worth the most in — and the kart bars answer it.',
  },
  {
    id: 'spec.compare', visit: 1,
    trigger: 'player built a second part in the same visit (comparison moment)',
    titleHe: 'שווה להשוות',
    titleEn: 'Worth comparing',
    bodyHe: 'אותו חלק, בקשה אחרת — ותוצאה אחרת לגמרי. בורג לא השתנה בין הבנייה הקודמת לזאת. הבקשה כן.',
    bodyEn: 'Same part, different ask, completely different result. Boreg did not change between those two builds. The ask did.',
  },

  // ── VISIT 2 — constraints & trade-offs ──────────────────────────────────────
  {
    id: 'constraint.none', visit: 2,
    trigger: 'player left the constraint slot at "בלי הגבלות"',
    titleHe: 'בלי הגבלות = בלי בלמים',
    titleEn: 'No limits = no brakes',
    bodyHe: 'בלי שורה של "מה אסור להרוס", בורג בחר לבד: הוא הוסיף {gain} {tradeoff}',
    bodyEn: 'With no "what must not break" line, Boreg chose on his own: he added {gain} {tradeoff}',
  },
  {
    id: 'constraint.first', visit: 2,
    trigger: 'player picked a real constraint (specificity >= 2)',
    titleHe: 'הגבלה דווקא עוזרת',
    titleEn: 'A limit actually helps',
    bodyHe: 'ההגבלה שנוספה לבקשה — "{limit}" — אילצה את בורג למצוא פתרון חכם יותר. הגבלה לא מקטינה את הבקשה, היא מחדדת אותה.',
    bodyEn: 'The limit added to the ask — "{limit}" — forced Boreg into a cleverer answer. A limit does not shrink the ask, it sharpens it.',
  },
  {
    id: 'constraint.coherent', visit: 2,
    trigger: 'goal and constraint pull on the same thing (coherence bonus earned)',
    titleHe: 'המטרה וההגבלה מסתדרות ביניהן',
    titleEn: 'The goal and the limit get along',
    bodyHe: 'המטרה "{goal}" וההגבלה "{limit}" מושכות בדיוק לאותו כיוון, ולכן החלק יצא טוב יותר מסכום שתי הבקשות. כששני החצאים מדברים אותה שפה, התוצאה קופצת.',
    bodyEn: 'The goal "{goal}" and the limit "{limit}" pull in exactly the same direction, so the part beat the sum of its two halves. When both halves speak the same language, the result jumps.',
  },
  {
    id: 'constraint.mismatch', visit: 2,
    trigger: 'a real constraint was chosen but it is not one this goal depends on',
    titleHe: 'ההגבלה לא על אותו דבר',
    titleEn: 'The limit is about something else',
    bodyHe: 'המטרה הייתה "{goal}", וההגבלה הייתה "{limit}" — הגבלה טובה, אבל היא לא נוגעת באותו דבר. שווה לנסות הגבלה שמדברת בדיוק על מה שהמטרה רוצה.',
    bodyEn: 'The goal was "{goal}", and the limit was "{limit}" — a fine limit, but not about the same thing. Worth trying a limit that talks about exactly what the goal wants.',
  },

  // ── VISIT 3 — style, context, and the whole thing together ──────────────────
  {
    id: 'style.matters', visit: 3,
    trigger: 'player picked a style with specificity >= 2',
    titleHe: 'סגנון זה גם מידע',
    titleEn: 'Style is information too',
    bodyHe: '"{style}" נתן לבורג תמונה בראש, אז החלק יצא אישי ולא סתם אפור. גם "איך זה נראה" הוא חלק מהבקשה.',
    bodyEn: '"{style}" gave Boreg a picture in his head, so the part came out personal instead of generic grey. How it looks is part of the ask too.',
  },
  {
    id: 'style.default', visit: 3,
    trigger: 'player left style at "לא משנה"',
    titleHe: 'מי שלא בוחר, בוחרים בשבילו',
    titleEn: 'Skip the choice and it gets made for you',
    bodyHe: 'בשורת הסגנון היה כתוב "לא משנה", אז בורג בחר לבד — והוא תמיד בוחר סגול. אם יש תמונה בראש, כדאי לכתוב אותה.',
    bodyEn: 'The style row said "doesn\'t matter", so Boreg chose — and he always chooses purple. If there is a picture in your head, it is worth putting it in the ask.',
  },
  {
    id: 'combo.all', visit: 3,
    trigger: 'all three scored slots at specificity >= 2 (the full recipe)',
    titleHe: 'המתכון המלא',
    titleEn: 'The full recipe',
    bodyHe: 'מה, מתי, מה אסור להרוס, ואיך זה נראה — ארבעה חלקים שהופכים בקשה מעורפלת לבקשה שאפשר לבנות ממנה.',
    bodyEn: 'What, when, what must not break, and how it looks — four pieces that turn a fuzzy wish into something buildable.',
  },
  {
    id: 'expert.intro', visit: 3,
    trigger: 'player opened expert mode',
    titleHe: 'עכשיו במילים שלך',
    titleEn: 'Now in your own words',
    bodyHe: 'עכשיו כותבים לבורג ישירות. כדאי לזכור את ארבעת החלקים: מה, מתי, מה אסור להרוס ואיך זה נראה — וזה גם משלם יותר טוקנים.',
    bodyEn: 'Now you write to Boreg directly. Keep the four pieces in mind: what, when, what must not break, how it looks — and it pays more tokens too.',
  },
  {
    id: 'expert.filler', visit: 3,
    trigger: 'free text scored low because it is short or full of filler words',
    titleHe: 'מילים גדולות, מידע קטן',
    titleEn: 'Big words, small information',
    bodyHe: 'מילים כמו "מדהים" ו"הכי חזק" נשמעות טוב אבל לא אומרות לבורג כלום. מספר אחד ("‎3 ק"ג פחות") שווה יותר מעשר מחמאות.',
    bodyEn: 'Words like "amazing" and "the strongest" sound great but tell Boreg nothing. One number ("3 kg lighter") beats ten compliments.',
  },
];

export const TIP_BY_ID = Object.fromEntries(TIPS.map(x => [x.id, x]));
export const tipById = id => TIP_BY_ID[id] || null;
export const tipsForVisit = visit => TIPS.filter(x => x.visit <= visit);

// ── Derived wording ───────────────────────────────────────────────────────────
// Stat nouns, in the form the tip prose needs them. Kept local (not in the i18n
// table) because these are prose words, not UI labels — "האצה" reads as a noun
// inside a sentence, while the bar label may be abbreviated later.
const STAT_WORD = {
  he: { speed: 'מהירות', accel: 'האצה', handling: 'אחיזה', weight: 'משקל' },
  en: { speed: 'speed', accel: 'acceleration', handling: 'grip', weight: 'weight' },
};
// For `weight`, lower is better.
const IMPROVED = (k, d) => (k === 'weight' ? -d : d);

/**
 * Turn the ACTUAL result into the fragments the tip bodies interpolate.
 * Nothing here is hardcoded to a particular option or a particular stat table.
 *
 * @param sel    {part,goal,constraint,style} option ids
 * @param deltas the stat deltas that were actually applied
 * @param lang   'he' | 'en'
 */
export function makeTipVars(sel = {}, deltas = {}, lang = 'he') {
  const he = lang !== 'en';
  const w = STAT_WORD[he ? 'he' : 'en'];
  const label = (slotKey) => {
    const o = optionById(slotKey, sel[slotKey]);
    if (o) return he ? o.he : o.en;
    const s = SLOT_BY_KEY[slotKey];
    return s ? (he ? s.blankHe : s.blankEn) : '';
  };

  // Biggest genuine improvement / biggest genuine regression, from the numbers
  // the player is looking at right now.
  let bestK = null, bestV = 0, worstK = null, worstV = 0;
  for (const k of Object.keys(deltas)) {
    const v = IMPROVED(k, deltas[k] || 0);
    if (v > bestV) { bestV = v; bestK = k; }
    if (v < worstV) { worstV = v; worstK = k; }
  }
  const gain = bestK ? w[bestK] : (he ? 'משהו' : 'something');
  const loss = worstK ? w[worstK] : '';

  // Carries the branch as well as the words: a tip must not say "he paid for it"
  // when the numbers say nothing got worse.
  const tradeoff = worstK
    ? (he
      ? `ושילם על זה ב${loss}. תמיד יש מחיר — השאלה היחידה היא מי בוחר אותו.`
      : `and paid for it in ${loss}. There is always a price — the only question is who picks it.`)
    : (he
      ? 'ובמזל, הפעם לא נשבר שום דבר אחר. בפעם הבאה זה כבר לא בטוח, אז עדיף להגיד מראש מה אסור להרוס.'
      : 'and by luck, nothing else broke this time. Next time is not a promise, so it is worth saying up front what must not break.');

  return {
    gain, loss, tradeoff,
    goal: label('goal'), limit: label('constraint'), style: label('style'), part: label('part'),
  };
}

/** Interpolate a tip body with the vars from makeTipVars(). */
export function tipBody(tip, lang = 'he', vars = {}) {
  const s = (lang === 'en' ? tip.bodyEn : tip.bodyHe) || '';
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : ''));
}

export function tipTitle(tip, lang = 'he') {
  return (lang === 'en' ? tip.titleEn : tip.titleHe) || '';
}

/**
 * Which tip cards should fire for this build?
 *
 * @param sel   {part,goal,constraint,style} option ids
 * @param facts {goalSpec, constraintSpec, styleSpec, coherent, expert, lowFreeText, unspent}
 * @param ctx   {visit, seen:[tipId], buildsThisVisit}
 * @returns tip ids, most relevant first, filtered to tips this visit has unlocked.
 *
 * Only ONE card is shown at a time in the UI (kids do not read walls of text);
 * the extras are returned so the caller can queue them / mark them seen.
 *
 * Cards that quote a chosen option are gated on `!facts.expert` — in expert mode
 * there is no chosen option to quote, and a card must never quote something the
 * player did not pick.
 */
export function pickTips(sel, facts, ctx = {}) {
  const visit = ctx.visit || 1;
  const seen = new Set(ctx.seen || []);
  const guided = !facts.expert;
  const out = [];
  const add = id => {
    const tip = TIP_BY_ID[id];
    if (tip && tip.visit <= visit && !out.includes(id)) out.push(id);
  };

  // Expert mode talks about itself first — it is the thing the player just did.
  if (facts.expert) {
    if (facts.lowFreeText) add('expert.filler');
    add('expert.intro');
  }

  // Visit 3 lesson: the whole recipe, then style.
  if (facts.goalSpec >= 2 && facts.constraintSpec >= 2 && facts.styleSpec >= 2) add('combo.all');
  if (guided && facts.styleSpec >= 2) add('style.matters');
  else if (guided && facts.styleSpec === 0) add('style.default');

  // Visit 2 lesson: constraints, and whether the limit is about the same thing
  // as the goal.
  if (guided && facts.coherent) add('constraint.coherent');
  if (guided && facts.constraintSpec >= 2 && !facts.coherent && facts.goalSpec >= 1) add('constraint.mismatch');
  if (guided && facts.constraintSpec >= 2) add('constraint.first');
  if (guided && facts.constraintSpec === 0) add('constraint.none');

  // Visit 1 lesson: specificity and where to spend.
  if (guided && facts.goalSpec === 0) add('spec.vague');
  if (guided && facts.goalSpec >= 2) add('spec.when-where');
  if (guided && (facts.unspent || 0) >= 4) add('budget.tradeoff');
  if ((ctx.buildsThisVisit || 0) >= 1) add('spec.compare');

  // Prefer a card the player has not read yet; otherwise repeat the best match.
  const fresh = out.filter(id => !seen.has(id));
  return fresh.length ? fresh.concat(out.filter(id => seen.has(id))) : out;
}

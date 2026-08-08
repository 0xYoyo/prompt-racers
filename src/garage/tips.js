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
    bodyEn: 'Boreg has no idea what "good" means, so he guessed on his own — and this time the guess was {gain}. Maybe exactly right, maybe not. The moment the prompt says what to improve, it stops being a lottery.',
  },
  {
    id: 'spec.when-where', visit: 1,
    trigger: 'goal specificity >= 2 (the goal names a moment on the track)',
    titleHe: 'מתי ואיפה',
    titleEn: 'When and where',
    bodyHe: 'בפרומפט שלך היה רגע מדויק — "{goal}" — ולכן בורג ידע איזה חלק בדיוק לחזק. פרומפט מדויק, חלק מדויק.',
    bodyEn: 'Your prompt named an exact moment — "{goal}" — so Boreg knew exactly what to strengthen. Precise prompt, precise part.',
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
    bodyHe: 'אותו חלק, פרומפט אחר — ותוצאה אחרת לגמרי. בורג לא השתנה בין הבנייה הקודמת לזאת. הפרומפט כן.',
    bodyEn: 'Same part, different prompt, completely different result. Boreg did not change between those two builds. The prompt did.',
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
    bodyHe: 'ההגבלה שנוספה לפרומפט — "{limit}" — אילצה את בורג למצוא פתרון חכם יותר. הגבלה לא מקטינה את הפרומפט, היא מחדדת אותו.',
    bodyEn: 'The limit added to the prompt — "{limit}" — forced Boreg into a cleverer answer. A limit does not shrink the prompt, it sharpens it.',
  },
  {
    id: 'constraint.coherent', visit: 2,
    trigger: 'goal and constraint pull on the same thing (coherence bonus earned)',
    titleHe: 'המטרה וההגבלה מסתדרות ביניהן',
    titleEn: 'The goal and the limit get along',
    bodyHe: 'המטרה "{goal}" וההגבלה "{limit}" מושכות בדיוק לאותו כיוון, ולכן החלק יצא טוב יותר מסכום שני החצאים. כששני החצאים מדברים אותה שפה, התוצאה קופצת.',
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
    bodyHe: '"{style}" נתן לבורג תמונה בראש, אז החלק יצא אישי ולא סתם אפור. גם "איך זה נראה" הוא חלק מהפרומפט.',
    bodyEn: '"{style}" gave Boreg a picture in his head, so the part came out personal instead of generic grey. How it looks is part of the prompt too.',
  },
  {
    id: 'style.default', visit: 3,
    trigger: 'player left style at "לא משנה"',
    titleHe: 'מי שלא בוחר, בוחרים בשבילו',
    titleEn: 'Skip the choice and it gets made for you',
    bodyHe: 'בשורת הסגנון היה כתוב "לא משנה", אז בורג בחר לבד — והוא תמיד בוחר סגול. אם יש תמונה בראש, כדאי לכתוב אותה.',
    bodyEn: 'The style row said "doesn\'t matter", so Boreg chose — and he always chooses purple. If there is a picture in your head, it is worth putting it in the prompt.',
  },
  {
    id: 'combo.all', visit: 3,
    trigger: 'all three scored slots at specificity >= 2 (the full recipe)',
    titleHe: 'המתכון המלא',
    titleEn: 'The full recipe',
    bodyHe: 'מה, מתי, מה אסור להרוס, ואיך זה נראה — ארבעה חלקים שהופכים פרומפט מעורפל לפרומפט שאפשר לבנות ממנו.',
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

// ── WIZARD STEP TIPS (Wave 3) ────────────────────────────────────────────────
// The garage is a four-step wizard, and Boreg has exactly one thing to say at
// any moment: something about THE STEP THE CHILD IS ON, and — the instant they
// pick a card — about THE CARD THEY JUST PICKED. There is no other text on the
// screen, so this table is the whole of Boreg's voice during the build.
//
// Two shapes per step:
//   ask            → nothing chosen yet in this row: what this row is for.
//   bySpec[0..3]   → chosen: what THAT level of precision just did.
// Step 1 (the part) is not scored, so it keys by part id instead.
//
// {choice} is the card's own label and {part} is the part being built, so a tip
// can never describe an option the child did not pick. Bodies stay to 1–2 short
// sentences — the rule the whole tips file is built on.
const STEP_TIPS = {
  part: {
    ask: {
      titleHe: 'על מה מדברים?', titleEn: 'What are we talking about?',
      bodyHe: 'לפני הכול צריך להגיד לי במה נוגעים. אותו פרומפט על מנוע ועל צמיגים הוא שני דברים שונים לגמרי.',
      bodyEn: 'First tell me what we are touching. The same prompt about an engine and about tires is two different things.',
    },
    byPart: {
      engine: {
        titleHe: 'מנוע — כוח', titleEn: 'Engine — power',
        bodyHe: 'מנוע נותן מהירות שיא, וגורר איתו משקל. תכף נחליט מתי בדיוק הכוח הזה צריך להגיע.',
        bodyEn: 'An engine buys top speed and drags weight along. Next we decide exactly when that power is needed.',
      },
      tires: {
        titleHe: 'צמיגים — אחיזה', titleEn: 'Tires — grip',
        bodyHe: 'צמיגים קובעים כמה חזק אפשר לפנות. ככל שהם רכים יותר הם אוחזים חזק יותר — ונשחקים מהר יותר.',
        bodyEn: 'Tires decide how hard you can turn. Softer means more grip — and faster wear.',
      },
      wing: {
        titleHe: 'כנף — יציבות', titleEn: 'Wing — stability',
        bodyHe: 'כנף לוחצת את הקארט לכביש בסיבוב מהיר, ומאטה קצת בישורת. זו עסקה, לא מתנה.',
        bodyEn: 'A wing presses the kart down in fast corners and slows it a little on the straight. A deal, not a gift.',
      },
      chassis: {
        titleHe: 'שלדה — זריזות', titleEn: 'Chassis — agility',
        bodyHe: 'שלדה זה משקל. כל גרם שיורד ממנה עוזר — עד שהיא מתחילה להתפתל.',
        bodyEn: 'A chassis is weight. Every gram off helps — right up until it starts to flex.',
      },
    },
  },
  goal: {
    ask: {
      titleHe: 'מה בדיוק לשפר?', titleEn: 'Improve what, exactly?',
      bodyHe: 'עכשיו החלק המעניין: מה {part} אמור לעשות טוב יותר. ככל שיש כאן מתי ואיפה, כך אני צריך פחות לנחש.',
      bodyEn: 'Now the interesting bit: what should {part} do better? The more when and where, the less I guess.',
    },
    bySpec: [
      {
        titleHe: 'זה עוד לא אומר לי כלום', titleEn: 'That still tells me nothing',
        bodyHe: '"{choice}" נשמע נחמד, אבל אני לא יודע מה למדוד. אני אנחש — ולפעמים ניחוש יוצא מצחיק.',
        bodyEn: '"{choice}" sounds nice, but I have nothing to measure. I will guess — and guesses come out funny.',
      },
      {
        titleHe: 'כיוון, בלי כתובת', titleEn: 'A direction, no address',
        bodyHe: '"{choice}" — עכשיו יש כיוון. עוד לא אמרתם מתי ואיפה על המסלול, אז את זה עוד אשלים לבד.',
        bodyEn: '"{choice}" — now there is a direction. Still no when or where on track, so that part I fill in myself.',
      },
      {
        titleHe: 'יש רגע מדויק', titleEn: 'There is an exact moment',
        bodyHe: '"{choice}" מצביע על רגע אמיתי בנסיעה, ולכן אני יודע איזה חלק לחזק. זה בדיוק ההבדל.',
        bodyEn: '"{choice}" points at a real moment in the lap, so I know what to strengthen. That is the difference.',
      },
      {
        titleHe: 'מתי, איפה, ומה נמדד', titleEn: 'When, where and what is measured',
        bodyHe: '"{choice}" — זה כבר תיאור שאפשר לבנות לפיו בלי לנחש אפילו פעם אחת. יקר, ומרגישים את זה.',
        bodyEn: '"{choice}" — that I can build from without guessing even once. Expensive, and you will feel it.',
      },
    ],
  },
  constraint: {
    ask: {
      titleHe: 'מה אסור לי להרוס?', titleEn: 'What am I not allowed to break?',
      bodyHe: 'כל שיפור לוקח משהו ממקום אחר. אם לא כתוב מה אסור להרוס — אני בוחר לבד, ואני בוחר את הדרך הקלה.',
      bodyEn: 'Every improvement takes something from somewhere. If nothing says what must not break, I choose — and I choose easy.',
    },
    bySpec: [
      {
        titleHe: 'אז מותר לי הכול', titleEn: 'So anything goes',
        bodyHe: 'בלי הגבלה אני אלך על הפתרון הקל. הוא יעבוד, ומשהו אחר בקארט ישלם על זה.',
        bodyEn: 'With no limit I take the easy answer. It will work, and something else on the kart pays for it.',
      },
      {
        titleHe: 'הגבלה בלי כתובת', titleEn: 'A limit with no address',
        bodyHe: '"{choice}" זו כבר הגבלה, ותודה עליה — אבל היא לא אומרת לי מה בדיוק לשמור.',
        bodyEn: '"{choice}" is a limit, and I will take it — but it does not tell me what exactly to protect.',
      },
      {
        titleHe: 'עכשיו יש לי גבול', titleEn: 'Now I have a boundary',
        bodyHe: '"{choice}" — דבר אחד שאסור לי לגעת בו. זה מכריח אותי לפתרון חכם במקום לפתרון קל.',
        bodyEn: '"{choice}" — one thing I may not touch. That forces a clever answer instead of an easy one.',
      },
      {
        titleHe: 'שתי הגבלות ביחד', titleEn: 'Two limits at once',
        bodyHe: '"{choice}" — שתיהן ביחד מושכות לכיוונים הפוכים, וזה בדיוק מה שמוציא ממני את העבודה הכי טובה.',
        bodyEn: '"{choice}" — the two pull opposite ways, and that is exactly what gets my best work out of me.',
      },
    ],
  },
  style: {
    ask: {
      titleHe: 'ואיך זה ייראה?', titleEn: 'And how should it look?',
      bodyHe: 'גם סגנון זה מידע. אם לא תגידו איך {part} ייראה — אבחר בעצמי, ואני בוחר סגול.',
      bodyEn: 'Style is information too. If nothing says how {part} should look, I pick — and I pick purple.',
    },
    bySpec: [
      {
        titleHe: 'אז אני בוחר', titleEn: 'Then I choose',
        bodyHe: 'מי שלא בוחר, בוחרים בשבילו. אצלי זה תמיד יוצא סגול.',
        bodyEn: 'Skip the choice and it gets made for you. With me it always comes out purple.',
      },
      {
        titleHe: 'צבע זה התחלה', titleEn: 'A colour is a start',
        bodyHe: '"{choice}" — עכשיו יש לי לפחות צבע בראש. את שאר התמונה עוד אמציא לבד.',
        bodyEn: '"{choice}" — now I have a colour in my head. The rest of the picture is still mine to invent.',
      },
      {
        titleHe: 'תמונה בראש', titleEn: 'A picture in my head',
        bodyHe: '"{choice}" — זה כבר סגנון עם כיוון, אז החלק ייצא שלכם ולא סתם אפור.',
        bodyEn: '"{choice}" — that is a style with a direction, so the part comes out yours instead of generic grey.',
      },
      {
        titleHe: 'סגנון עם סיפור', titleEn: 'A style with a story',
        bodyHe: '"{choice}" — יש כאן סיפור שלם, ואני יודע בדיוק איך זה צריך להרגיש. את זה כיף לרתך.',
        bodyEn: '"{choice}" — there is a whole story here, and I know exactly how it should feel. Fun to weld.',
      },
    ],
  },
};

/**
 * Boreg's line for the CURRENT wizard step and the CURRENT selection in it.
 * Pure: same (slot, selection, lang) always gives the same card, and the `id`
 * changes whenever either the step or the choice inside it changes — which is
 * what stops a stale tip from surviving a step change.
 *
 * @param slotKey   the row the wizard is showing
 * @param selection {part, goal, constraint, style} option ids
 * @returns {id, title, body}
 */
export function stepTip(slotKey, selection = {}, lang = 'he') {
  const he = lang !== 'en';
  const table = STEP_TIPS[slotKey];
  if (!table) return { id: 'step.none', title: '', body: '' };
  const chosen = optionById(slotKey, selection[slotKey]);
  const partOpt = optionById('part', selection.part);
  const vars = {
    choice: chosen ? (he ? chosen.he : chosen.en) : '',
    part: partOpt ? (he ? partOpt.he : partOpt.en) : (he ? 'החלק' : 'the part'),
  };
  let card, id;
  if (!chosen) { card = table.ask; id = `step.${slotKey}.ask`; }
  else if (slotKey === 'part') {
    card = table.byPart[chosen.id] || table.ask;
    id = `step.part.${chosen.id}`;
  } else {
    const spec = Math.max(0, Math.min(3, chosen.specificity | 0));
    card = table.bySpec[spec];
    id = `step.${slotKey}.${spec}`;
  }
  const fill = s => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : ''));
  return {
    id,
    title: fill(he ? card.titleHe : card.titleEn),
    body: fill(he ? card.bodyHe : card.bodyEn),
  };
}

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
 * @param ctx   {visit, seen:[tipId], buildsThisVisit, scarce}
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
  // `scarce !== false` so a caller that does not pass it keeps the old behaviour;
  // the garage passes false when the wallet covers the most expensive prompt,
  // in which case this card would be telling the child something untrue.
  if (guided && ctx.scarce !== false && (facts.unspent || 0) >= 4) add('budget.tradeoff');
  if ((ctx.buildsThisVisit || 0) >= 1) add('spec.compare');

  // Prefer a card the player has not read yet; otherwise repeat the best match.
  const fresh = out.filter(id => !seen.has(id));
  return fresh.length ? fresh.concat(out.filter(id => seen.has(id))) : out;
}

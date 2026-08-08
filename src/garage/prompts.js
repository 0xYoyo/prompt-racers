// THE GARAGE — slot content. Hebrew is the source language here: every `he`
// string was written natively for 8–15 year olds, then an English equivalent was
// written next to it. Nothing here is a translation of English.
//
// ── Why the fragments look the way they do ────────────────────────────────────
// The four picks are glued into ONE readable Hebrew sentence:
//
//   בורג, בנה לי {part} {goal}, {constraint} {style}.
//
// ── Wave 3: the catalog is PER PART ──────────────────────────────────────────
// Until Wave 3 the last three rows were the same four cards whatever part the
// child was building, so "improve"/"protect"/"style" read as a form to fill in
// rather than as a conversation about an engine, a set of tires, a wing or a
// chassis. Every option below now belongs to exactly one kart slot (`part`), and
// each slot's four options talk about that part's own physics:
//
//   engine   → power, and the weight it drags in with it
//   tires    → grip, and the wear that buys it
//   wing     → downforce, and the drag it costs on the straight
//   chassis  → agility, and the flex that comes with taking metal out
//
// Because each option now agrees with a known part, the fragments may inflect —
// but they are still written so the SUBJECT is either the player (future tense,
// which is gender-neutral in Hebrew: אאיץ / אסע) or the part itself, and never
// the reader. The style fragment carries the list-final "ו" so the sentence ends
// like a real Hebrew list.
//
// ── Prices (unchanged by the Wave-3 rewrite — D17's token economy is tuned to
//     these exact numbers) ───────────────────────────────────────────────────
// Every part costs 4. Every goal ladder is 0/3/5/7, every limit ladder 0/2/4/6,
// every style ladder 0/2/3/4 — identical across the four parts, so switching part
// never changes what a given amount of precision costs.
//   cheapest complete ask = 4      (a part, and "whatever" in all three rows)
//   most expensive ask    = 21     (MAX_COST) against a 17-token budget
// Price is deliberately NOT a second copy of the specificity answer: 4 tokens
// buys a real measurable limit in one row and only a colour in another. Only
// trying it and watching the stat bars can tell you what is worth buying.
import { registerStrings } from '../ui/i18n.js';

// Slot 1 ids are EXACTLY the kart attachment keys the kart model exposes.
export const KART_SLOTS = ['engine', 'tires', 'wing', 'chassis'];

// Cost ladders, one per row, shared by all four parts. Kept as named constants
// so the token economy is auditable in one place.
const GOAL_COST = [0, 3, 5, 7];
const LIMIT_COST = [0, 2, 4, 6];
const STYLE_COST = [0, 2, 3, 4];
export const PART_COST = 4;

/** Compact option builder: (part, id, spec, he, en, subHe, subEn, fragHe, fragEn) */
const opt = (part, costs) => (id, specificity, he, en, subHe, subEn, fragHe, fragEn, coherentWith) => ({
  id: `${part}.${id}`, part, specificity, cost: costs[specificity],
  he, en, subHe, subEn,
  sentenceFragmentHe: fragHe, sentenceFragmentEn: fragEn,
  ...(coherentWith ? { coherentWith: coherentWith.map(c => `${part}.${c}`) } : {}),
});

// ── GOALS ────────────────────────────────────────────────────────────────────
const G = {};
{
  const e = opt('engine', GOAL_COST);
  G.engine = [
    e('good', 0, 'שיהיה חזק', 'Make it strong',
      'בורג ינחש מה זה חזק. בהצלחה.', 'Boreg will guess what strong means. Good luck.',
      'כדי שיהיה חזק', 'so it will be strong'),
    e('fast', 1, 'שאסע מהר יותר', 'So I go faster',
      'כיוון כללי, בלי מתי ואיפה', 'A direction, but no when or where',
      'כדי שאסע מהר יותר', 'so I go faster', ['light']),
    e('brake', 2, 'שאאיץ מהר יותר אחרי בלימה', 'So I accelerate faster after braking',
      'כבר יש כאן רגע מדויק', 'Now there is an exact moment',
      'כדי שאאיץ מהר יותר אחרי בלימה', 'so I accelerate faster after braking', ['light']),
    e('exit', 3, 'שאאיץ מהר יותר ביציאה מסיבוב', 'So I accelerate faster out of a corner',
      'מתי, איפה, ומה נמדד', 'When, where, and what gets measured',
      'כדי שאאיץ מהר יותר ביציאה מסיבוב', 'so I accelerate faster coming out of a corner', ['balanced']),
  ];
  const r = opt('tires', GOAL_COST);
  G.tires = [
    r('good', 0, 'שיהיה לי טוב בסיבובים', 'Make corners feel good',
      '"טוב" זה לא מידה. בורג ינחש.', '"Good" is not a measurement. Boreg will guess.',
      'כדי שיהיה לי טוב בסיבובים', 'so corners feel good'),
    r('slip', 1, 'שאחליק פחות', 'So I slide less',
      'כיוון ברור, בלי מתי ואיפה', 'A clear direction, but no when or where',
      'כדי שאחליק פחות', 'so I slide less', ['wear']),
    r('late', 2, 'שאבלום מאוחר יותר לפני סיבוב', 'So I can brake later into a corner',
      'כבר יש כאן רגע מדויק על המסלול', 'Now there is an exact moment on track',
      'כדי שאבלום מאוחר יותר לפני הכניסה לסיבוב', 'so I can brake later going into a corner', ['wear']),
    r('sand', 3, 'שלא אאבד אחיזה על חול ביציאה מסיבוב', 'So I keep grip on sand out of a corner',
      'מתי, איפה, ועל איזה משטח', 'When, where, and on what surface',
      'כדי שלא אאבד אחיזה על החול ביציאה מסיבוב', 'so I do not lose grip on the sand coming out of a corner', ['hotwear']),
  ];
  const w = opt('wing', GOAL_COST);
  G.wing = [
    w('good', 0, 'שתהיה מרשימה', 'Make it impressive',
      '"מרשימה" זה לא מספר. בורג ינחש.', '"Impressive" is not a number. Boreg will guess.',
      'כדי שתהיה מרשימה', 'so it looks impressive'),
    w('stable', 1, 'שהקארט יהיה יציב יותר', 'So the kart is steadier',
      'כיוון כללי, בלי מתי ואיפה', 'A direction, but no when or where',
      'כדי שהקארט יהיה יציב יותר', 'so the kart is steadier', ['drag']),
    w('brake', 2, 'שהקארט לא ירקוד בבלימה חזקה', 'So the kart does not dance under hard braking',
      'רגע מדויק שאפשר להרגיש', 'An exact moment you can feel',
      'כדי שהקארט לא ירקוד בבלימה חזקה', 'so the kart does not dance under hard braking', ['drag']),
    w('fastcorner', 3, 'שאעבור סיבוב מהיר בלי להרים גלגל', 'So I take a fast corner without lifting a wheel',
      'מתי, איפה, ומה נמדד', 'When, where, and what gets measured',
      'כדי שאעבור סיבוב מהיר בלי להרים גלגל', 'so I can take a fast corner without lifting a wheel', ['both']),
  ];
  const c = opt('chassis', GOAL_COST);
  G.chassis = [
    c('good', 0, 'שתהיה שלדה טובה', 'Make it a good chassis',
      'בורג ינחש מה זה "טובה".', 'Boreg will guess what "good" means.',
      'כדי שתהיה טובה', 'so it will be good'),
    c('agile', 1, 'שאסתובב מהר יותר', 'So I turn quicker',
      'כיוון ברור, בלי מתי ואיפה', 'A clear direction, but no when or where',
      'כדי שאסתובב מהר יותר', 'so I turn quicker', ['flex']),
    c('slalom', 2, 'שאחליף כיוון מהר בשרשרת עיקולים', 'So I switch direction fast through a chain of bends',
      'רגע מדויק על המסלול', 'An exact moment on track',
      'כדי שאחליף כיוון מהר בשרשרת עיקולים', 'so I switch direction fast through a chain of bends', ['flex']),
    c('kerb', 3, 'שלא אאבד שליטה כשאני עולה על סוללת שפה', 'So I keep control when I ride a kerb',
      'מתי, איפה, ומה בדיוק קורה', 'When, where, and exactly what happens',
      'כדי שלא אאבד שליטה כשאני עולה על סוללת שפה בסיבוב', 'so I do not lose control riding a kerb in a corner', ['both']),
  ];
}

// ── LIMITS ───────────────────────────────────────────────────────────────────
// Each part's limits are about the price THAT part actually pays: an engine pays
// in weight, tires pay in wear, a wing pays in drag, a chassis pays in flex.
const C = {};
{
  const e = opt('engine', LIMIT_COST);
  C.engine = [
    e('none', 0, 'בלי הגבלות', 'No limits',
      'מותר לו הכול. גם דברים מוזרים.', 'Anything goes. Including weird things.',
      'בלי הגבלות', 'with no limits'),
    e('nothing', 1, 'בלי לקלקל שום דבר אחר', 'Without breaking anything else',
      'הגבלה — אבל מה זה "אחר"?', 'A limit — but "anything" is not a thing',
      'בלי לקלקל שום דבר אחר', 'without breaking anything else'),
    e('light', 2, 'בלי להוסיף משקל', 'Without adding weight',
      'הגבלה אמיתית שאפשר למדוד', 'A real, measurable limit',
      'בלי להוסיף משקל', 'without adding any weight'),
    e('balanced', 3, 'בלי להוסיף משקל ובלי לאבד יציבות', 'Without adding weight and without losing stability',
      'שתי הגבלות שמושכות לכיוונים הפוכים', 'Two limits pulling opposite ways',
      'בלי להוסיף משקל ובלי לאבד יציבות במהירות גבוהה',
      'without adding weight and without losing stability at high speed'),
  ];
  const r = opt('tires', LIMIT_COST);
  C.tires = [
    r('none', 0, 'בלי שום תנאי', 'No conditions',
      'מותר להם הכול. גם להימס.', 'Anything goes. Including melting.',
      'בלי שום תנאי', 'with no conditions at all'),
    r('nothing', 1, 'בלי לקלקל את שאר הנסיעה', 'Without spoiling the rest of the drive',
      'הגבלה — אבל "שאר" זה לא משהו', 'A limit — but "the rest" is not a thing',
      'בלי לקלקל את שאר הנסיעה', 'without spoiling the rest of the drive'),
    r('wear', 2, 'בלי שיישחקו אחרי סיבוב אחד', 'Without wearing out after one lap',
      'הגבלה אמיתית שאפשר למדוד', 'A real, measurable limit',
      'בלי שיישחקו אחרי סיבוב אחד', 'without wearing out after a single lap'),
    r('hotwear', 3, 'בלי שיישחקו ובלי לאבד אחיזה כשהם מתחממים',
      'Without wearing out and without losing grip when hot',
      'שתי הגבלות שמושכות לכיוונים הפוכים', 'Two limits pulling opposite ways',
      'בלי שיישחקו מהר ובלי לאבד אחיזה כשהם מתחממים',
      'without wearing out fast and without losing grip once they heat up'),
  ];
  const w = opt('wing', LIMIT_COST);
  C.wing = [
    w('none', 0, 'בלי שום כלל', 'No rules',
      'מותר לה הכול. גם להיות דלת.', 'Anything goes. Including becoming a door.',
      'בלי שום כלל', 'with no rules at all'),
    w('nothing', 1, 'בלי לפגוע בשאר הקארט', 'Without hurting the rest of the kart',
      'הגבלה — אבל בלי לומר במה', 'A limit — but it never says in what',
      'בלי לפגוע בשאר הקארט', 'without hurting the rest of the kart'),
    w('drag', 2, 'בלי להאט אותי בישורת', 'Without slowing me on the straight',
      'הגבלה אמיתית שאפשר למדוד', 'A real, measurable limit',
      'בלי להאט אותי בישורת', 'without slowing me down on the straight'),
    w('both', 3, 'בלי להאט אותי בישורת ובלי משקל מאחור',
      'Without slowing me on the straight and without weight at the back',
      'שתי הגבלות שמושכות לכיוונים הפוכים', 'Two limits pulling opposite ways',
      'בלי להאט אותי בישורת ובלי להוסיף משקל מאחור',
      'without slowing me on the straight and without adding weight at the back'),
  ];
  const c = opt('chassis', LIMIT_COST);
  C.chassis = [
    c('none', 0, 'בלי אף מגבלה', 'No restrictions',
      'מותר לה הכול. גם להתפרק.', 'Anything goes. Including falling apart.',
      'בלי אף מגבלה', 'with no restriction of any kind'),
    c('nothing', 1, 'בלי שיישבר לי משהו בדרך', 'Without something breaking on me',
      'הגבלה — אבל בלי לומר מה', 'A limit — but it never says what',
      'בלי שיישבר לי משהו בדרך', 'without anything breaking on the way'),
    c('flex', 2, 'בלי שהיא תתפתל בבלימה', 'Without it flexing under braking',
      'הגבלה אמיתית שאפשר למדוד', 'A real, measurable limit',
      'בלי שהיא תתפתל בבלימה', 'without it flexing under braking'),
    c('both', 3, 'בלי שהיא תתפתל ובלי להוסיף גרם אחד',
      'Without flexing and without adding a single gram',
      'שתי הגבלות שמושכות לכיוונים הפוכים', 'Two limits pulling opposite ways',
      'בלי שהיא תתפתל בבלימה ובלי להוסיף אפילו גרם אחד',
      'without flexing under braking and without adding even one gram'),
  ];
}

// ── STYLES ───────────────────────────────────────────────────────────────────
// Style is information too, so each part gets styles that only make sense ON
// that part — a tire cannot have copper pipes and an engine has no sidewall.
const S = {};
{
  const e = opt('engine', STYLE_COST);
  S.engine = [
    e('any', 0, 'לא משנה', "Doesn't matter",
      'בורג יבחר. אמרנו סגול?', 'Boreg will choose. We said purple?',
      'ולא משנה לי איך הוא ייראה', 'and it does not matter how it looks'),
    e('orange', 1, 'בכתום זוהר', 'In glowing orange',
      'צבע זה כבר משהו', 'A colour is already something',
      'ובצבע כתום זוהר', 'and in a glowing orange'),
    e('desert', 2, 'בסטייל מרוצי מדבר, עם פסים ואבק', 'Desert-racing style, stripes and dust',
      'סגנון שיש לו כיוון ברור', 'A style with a clear direction',
      'ובסטייל מרוצי מדבר, עם פסים ואבק', 'and in a desert-racing style, with stripes and dust'),
    e('forge', 3, 'בסטייל בית יציקה, עם צינורות נחושת', 'Foundry style, with copper pipes',
      'סגנון עם סיפור מאחוריו', 'A style with a story behind it',
      'ובסטייל של בית יציקה ישן, עם צינורות נחושת וברגים בולטים',
      'and in an old-foundry style, with copper pipes and visible bolts'),
  ];
  const r = opt('tires', STYLE_COST);
  S.tires = [
    r('any', 0, 'שייראו איך שייראו', 'However they come out',
      'בורג יבחר. אמרנו סגול?', 'Boreg will choose. We said purple?',
      'ולא משנה לי איך הם ייראו', 'and it does not matter how they look'),
    r('sand', 1, 'עם דופן בצבע חול', 'With sand-coloured sidewalls',
      'צבע זה כבר משהו', 'A colour is already something',
      'ועם דופן בצבע חול', 'and with sand-coloured sidewalls'),
    r('stripe', 2, 'עם פס צהוב על הדופן, כמו בצמיגי מרוץ', 'With a yellow sidewall stripe, like race rubber',
      'סגנון שיש לו כיוון ברור', 'A style with a clear direction',
      'ועם פס צהוב על הדופן, כמו בצמיגי מרוץ', 'and with a yellow stripe on the sidewall, like race rubber'),
    r('dusty', 3, 'מאובקים מהמסלול, עם חריצים שרואים מקרוב', 'Track-dusted, with grooves you can see up close',
      'סגנון עם סיפור מאחוריו', 'A style with a story behind it',
      'ומאובקים מהמסלול, עם חריצים שרואים מקרוב', 'and dusted from the track, with grooves you can see up close'),
  ];
  const w = opt('wing', STYLE_COST);
  S.wing = [
    w('any', 0, 'לא חשוב איך', 'Never mind how',
      'בורג יבחר. אמרנו סגול?', 'Boreg will choose. We said purple?',
      'ולא חשוב לי איך היא תיראה', 'and I do not mind how it looks'),
    w('neon', 1, 'בכחול ניאון', 'In neon blue',
      'צבע זה כבר משהו', 'A colour is already something',
      'ובצבע כחול ניאון', 'and in a neon blue'),
    w('city', 2, 'בסטייל עיר לילה, עם קו אור לאורך הקצה', 'Night-city style, a light line along the edge',
      'סגנון שיש לו כיוון ברור', 'A style with a clear direction',
      'ובסטייל של עיר לילה, עם קו אור לאורך הקצה', 'and in a night-city style, with a light line along the edge'),
    w('sponsors', 3, 'עם מספר ענק ומדבקות חסות מצחיקות', 'With a huge number and funny sponsor stickers',
      'סגנון עם סיפור מאחוריו', 'A style with a story behind it',
      'ועם מספר ענק ומדבקות של חסויות מצחיקות', 'and with a huge race number and funny sponsor stickers'),
  ];
  const c = opt('chassis', STYLE_COST);
  S.chassis = [
    c('any', 0, 'שיהיה מה שיהיה', 'Whatever it turns out',
      'בורג יבחר. אמרנו סגול?', 'Boreg will choose. We said purple?',
      'ולא אכפת לי איך היא תיראה', 'and I do not care how it looks'),
    c('gold', 1, 'בזהב מט', 'In matte gold',
      'צבע זה כבר משהו', 'A colour is already something',
      'ובצבע זהב מט', 'and in a matte gold'),
    c('workshop', 2, 'בסטייל מוסך ישן, עם טלאים וברגים', 'Old-workshop style, patches and bolts',
      'סגנון שיש לו כיוון ברור', 'A style with a clear direction',
      'ובסטייל של מוסך ישן, עם טלאים וברגים בולטים', 'and in an old-workshop style, with patches and visible bolts'),
    c('cloud', 3, 'בסטייל פסגת הענן, לבן־תכלת עם קווי רוח', 'Cloud-Peak style, white and sky-blue wind lines',
      'סגנון עם סיפור מאחוריו', 'A style with a story behind it',
      'ובסטייל של פסגת הענן, לבן־תכלת עם קווי רוח',
      'and in a Cloud-Peak style, white and sky-blue with wind lines'),
  ];
}

const flat = table => KART_SLOTS.flatMap(p => table[p]);

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
    stepHe: 'בוחרים חלק',
    stepEn: 'Pick a part',
    // Not scored: picking "engine" is not more specific than picking "tires".
    scored: false,
    options: [
      {
        id: 'engine', part: null, specificity: 1, cost: PART_COST,
        he: 'מנוע', en: 'Engine',
        subHe: 'כוח ומהירות שיא — ומשקל שמגיע איתם', subEn: 'Power and top speed — and the weight that comes with it',
        sentenceFragmentHe: 'מנוע חדש', sentenceFragmentEn: 'a new engine',
      },
      {
        id: 'tires', part: null, specificity: 1, cost: PART_COST,
        he: 'צמיגים', en: 'Tires',
        subHe: 'אחיזה ויציאה מסיבוב — ושחיקה שמשלמת עליה', subEn: 'Grip and corner exit — paid for in wear',
        sentenceFragmentHe: 'סט צמיגים חדש', sentenceFragmentEn: 'a new set of tires',
      },
      {
        id: 'wing', part: null, specificity: 1, cost: PART_COST,
        he: 'כנף', en: 'Wing',
        subHe: 'יציבות בסיבוב מהיר — במחיר של ישורת', subEn: 'Stability in fast corners — at the cost of the straight',
        sentenceFragmentHe: 'כנף אחורית חדשה', sentenceFragmentEn: 'a new rear wing',
      },
      {
        id: 'chassis', part: null, specificity: 1, cost: PART_COST,
        he: 'שלדה', en: 'Chassis',
        subHe: 'משקל וזריזות — וכמה מתכת אפשר להוריד', subEn: 'Weight and agility — and how much metal can go',
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
    stepHe: 'מה לשפר',
    stepEn: 'Improve',
    scored: true,
    axisHe: 'מתי ואיפה',
    axisEn: 'when and where',
    options: flat(G),
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
    stepHe: 'מה לשמור',
    stepEn: 'Protect',
    scored: true,
    axisHe: 'מה אסור להרוס',
    axisEn: 'what must not break',
    options: flat(C),
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
    stepHe: 'איך ייראה',
    stepEn: 'Style',
    scored: true,
    axisHe: 'איך זה ייראה',
    axisEn: 'how it looks',
    options: flat(S),
  },
];

export const SLOT_BY_KEY = Object.fromEntries(SLOTS.map(s => [s.key, s]));

/**
 * The options a row offers. Rows 2–4 are per-part, so they need to know which
 * part is being built; with no part chosen yet they offer nothing (the wizard
 * cannot reach them anyway — step 1 is the part).
 */
export function optionsFor(slotKey, partId) {
  const slot = SLOT_BY_KEY[slotKey];
  if (!slot) return [];
  if (!slot.scored && slotKey === 'part') return slot.options;
  if (!partId) return [];
  return slot.options.filter(o => o.part === partId);
}

export function optionById(slotKey, id) {
  if (!id) return null;
  return (SLOT_BY_KEY[slotKey]?.options || []).find(o => o.id === id) || null;
}

/** Which part does this option belong to? (null for the part row itself.) */
export const partOfOption = (slotKey, id) => optionById(slotKey, id)?.part || null;

export function costOf(selection) {
  let c = 0;
  for (const s of SLOTS) {
    const o = optionById(s.key, selection[s.key]);
    if (o) c += o.cost;
  }
  return c;
}

// The most expensive complete ask, for any part: 4 + 7 + 6 + 4 = 21.
export const MAX_COST = PART_COST + Math.max(...KART_SLOTS.map(p =>
  ['goal', 'constraint', 'style'].reduce((a, k) =>
    a + Math.max(...optionsFor(k, p).map(o => o.cost)), 0)));

// The cheapest complete ask: a part, and the free option in every other row.
export const MIN_COMPLETE_COST = PART_COST;

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
  const part = selection.part;
  for (const s of SLOTS) {
    if (!s.scored) continue;
    const list = optionsFor(s.key, part);
    if (!list.length) continue;
    out[s.key] = list.reduce((a, b) => (b.specificity < a.specificity ? b : a)).id;
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
  const part = selection.part;
  for (let guard = 0; guard < 12; guard++) {
    let best = null;
    for (const s of SLOTS) {
      if (!s.scored) continue;
      const now = optionById(s.key, cur[s.key]);
      for (const o of optionsFor(s.key, part)) {
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

/**
 * Drop any row whose chosen option belongs to a different part. Changing the
 * part in step 1 must not leave a wing's limit sitting inside an engine prompt —
 * the sentence would still read, and would be a lie.
 */
export function pruneSelection(selection = {}) {
  const out = { part: selection.part || null, goal: null, constraint: null, style: null };
  for (const k of ['goal', 'constraint', 'style']) {
    const o = optionById(k, selection[k]);
    if (o && o.part === out.part) out[k] = o.id;
  }
  return out;
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

// THE GARAGE (המוסך) — the teaching scene between races.
//
// The player has a token budget earned by racing. They assemble a prompt for
// בורג (Boreg), the workshop robot, out of four slots:
//
//     [what part] + [performance goal] + [trade-off] + [style]
//
// The four picks glue into ONE large, live-updating Hebrew sentence. That
// sentence is the actual lesson: kids read it, change one word, and watch the
// stat bars move before they commit. Specificity is deterministic, visible and
// paid for in tokens.
//
// ── Two rules this screen is built around ────────────────────────────────────
// 1. **The screen must never display the answer.** Option cards therefore do NOT
//    show a specificity rating; the dots appear only in the reveal, where they
//    explain a result instead of pre-announcing it. And the budget (17) is far
//    below the cost of the most precise ask (21), so "pick the expensive one in
//    every row" is not a strategy — the child has to decide WHICH row deserves
//    the precision, and find out from the stat bars whether they were right.
// 2. **One idea at a time.** Rows appear one after another: row 2 only after row
//    1 is answered. Earlier rows collapse to a single line with a Change button,
//    so going back is one click and the screen never holds 16 cards at once.
//
// 3D: the kart model is owned by another agent. See mountKartPreview() below —
// it is the single hook the lead wires the real kart into. Until then a clearly
// marked placeholder rotates in the preview window.
import * as THREE from 'three';
import { h, pushModal, popModal, modalOpen } from '../ui/style.js';
import { registerStrings, t, num, getLang, isRTL, setLang } from '../ui/i18n.js';
import { save } from '../core/save.js';
import {
  SLOTS, optionById, costOf, sentenceParts, partName, DEFAULT_BUDGET, MAX_COST,
  vaguestSelection, bestAffordable,
} from './prompts.js';
import {
  scorePrompt, scoreFreeText, tokenReward,
  BASE_STATS, STAT_KEYS, LOWER_IS_BETTER, VISUAL_TIER,
} from './scoring.js';
import { tipById, tipBody, tipTitle, makeTipVars } from './tips.js';

// ─────────────────────────────────────────────────────────────────────────────
// Strings (all under the `garage.` prefix)
//
// Hebrew here is gender-neutral by construction, the same discipline the
// assembled sentence uses: no masculine imperative ("בחר", "תגיד", "כתוב"), no
// "אתה". Instead — impersonal present tense ("בוחרים", "כדאי"), plural
// ("בואו נרכיב"), or a noun phrase ("הבקשה שלך").
// ─────────────────────────────────────────────────────────────────────────────
registerStrings({
  he: {
    'garage.title': 'המוסך',
    'garage.kicker': 'כותבים פרומפט, בורג בונה חלק',
    'garage.budget': 'תקציב',
    'garage.spent': 'עולה',
    'garage.left': 'נשארו',
    'garage.budget.note': 'לא מספיק לכול — צריך לבחור איפה להשקיע',
    // Shown instead when the wallet actually covers the most expensive prompt
    // possible. The line above then simply is not true, and a screen that says
    // something a child can see is false stops being believed about anything.
    'garage.budget.plenty': 'הפעם יש מספיק לכול — אז שווה ללכת על הפרומפט הכי מדויק',
    'garage.boreg': 'בורג',
    'garage.intro.1': 'אני בורג, ואני בונה בדיוק מה שכתוב בפרומפט. בדיוק. אז בואו נרכיב יחד פרומפט טוב.',
    'garage.intro.2': 'חזרתם! היום לומדים את הסוד שלי — מה אסור להרוס. זה מה שהופך חלק טוב לחלק מעולה.',
    'garage.intro.3': 'המרוץ האחרון. כבר ידוע הכול: מה, מתי, מה אסור להרוס ואיך זה ייראה. קדימה, בואו נראה.',
    'garage.sentence.label': 'הפרומפט שלך לבורג',
    'garage.sentence.hint': 'שורה אחרי שורה — הפרומפט נבנה מול העיניים',
    'garage.stats.label': 'איך זה ישפיע על הקארט',
    'garage.stat.speed': 'מהירות',
    // 'תאוצה' — the same word the select screen and the roster use. This panel
    // said 'האצה', so the bar a child watched move in the garage did not share a
    // name with the bar they picked their racer by.
    'garage.stat.accel': 'תאוצה',
    'garage.stat.handling': 'אחיזה',
    'garage.stat.weight': 'משקל',
    'garage.stat.weightNote': 'פחות = טוב יותר',
    'garage.quality': 'איכות הפרומפט',
    'garage.build': 'בורג, תבנה!',
    'garage.buildBlocked': 'צריך לבחור בכל ארבע השורות',
    'garage.building': 'בורג בונה…',
    'garage.reset': 'מתחילים מחדש',
    'garage.frag': 'ייכנס לפרומפט',
    'garage.step.change': 'שינוי',
    'garage.step.next': 'בהמשך',
    'garage.step.of': 'שלב {n} מתוך ‎4',
    'garage.tier.0': 'דרגה ‎0 — עובד, בערך',
    'garage.tier.1': 'דרגה ‎1 — בסדר גמור',
    'garage.tier.2': 'דרגה ‎2 — מכויל',
    'garage.tier.3': 'דרגה ‎3 — מדויק בטירוף',
    'garage.reveal.title': 'בורג בנה לך',
    'garage.reveal.ask': 'זה היה הפרומפט שלך',
    'garage.reveal.spec': 'כמה פירוט היה בכל חלק של הפרומפט',
    'garage.reveal.deltas': 'מה השתנה בקארט',
    'garage.reveal.tokens': 'הרווחת {n} טוקנים',
    'garage.reveal.install': 'התקנה והמשך',
    'garage.reveal.again': 'פרומפט אחר',
    'garage.expert.toggle': 'מצב מומחה',
    'garage.expert.badge': 'לא חובה · גילאי ‎12+',
    'garage.expert.label': 'כותבים לבורג במילים שלכם',
    'garage.expert.ph': 'לדוגמה: בורג, תחזק לי את המנוע ליציאה מסיבוב, בלי להוסיף יותר מ‎2 ק"ג, ובצבע כתום מאובק',
    'garage.expert.check.concrete': 'מילים קונקרטיות',
    'garage.expert.check.numbers': 'מספר או יחידה',
    'garage.expert.check.constraint': 'הגבלה',
    'garage.expert.check.style': 'סגנון',
    'garage.expert.check.length': 'מספיק פרטים',
    'garage.expert.check.filler': 'בלי מילים ריקות',
    'garage.expert.bonus': 'פי ‎1.6 טוקנים',
    'garage.tip.label': 'טיפ מבורג',
    // Shown before the first choice, when there is no real tip to give yet. It
    // used to reprint garage.sentence.hint, which sits about 20px away on the
    // same screen — the card read as a bug rather than as an invitation.
    'garage.tip.waiting': 'בוחרים משהו בשורה הראשונה, ואני אסביר בדיוק מה זה שינה בקארט.',
    'garage.visit': 'ביקור {n} מתוך ‎3',
    'garage.free': 'חינם',
    'garage.recipe.label': 'מתכון לפרומפט טוב',
    'garage.recipe.what': 'מה בדיוק',
    'garage.recipe.when': 'מתי ואיפה',
    'garage.recipe.limit': 'מה אסור להרוס',
    'garage.recipe.look': 'איך זה ייראה',

    // ── Boreg introduces himself as an AI (first visit only) ────────────────
    'garage.meet.kicker': 'רגע לפני שמתחילים',
    'garage.meet.title': 'נעים מאוד, אני בורג',
    'garage.meet.1': 'אני בינה מלאכותית. זאת מכונה שיודעת להבין מילים — ובמקרה שלי, גם לרתך.',
    'garage.meet.2': 'זה עובד ככה: אומרים לי במילים מה רוצים, ואני בונה. בדיוק את מה שכתוב, לא את מה שחשבתם בראש.',
    'garage.meet.3': 'למילים האלה קוראים פרומפט. ככל שהפרומפט מדויק יותר, החלק יוצא טוב יותר — וזה עובד בדיוק אותו דבר עם כל בינה מלאכותית שתפגשו במחשב.',
    'garage.meet.go': 'מתחילים!',
    'garage.meet.word': 'פרומפט = מה שמבקשים מבינה מלאכותית, במילים',

    // ── First token ever picked up (one-time popup, mounted by the lead) ────
    'garage.token.kicker': 'הטוקן הראשון',
    'garage.token.title': 'טוקנים — המטבע של הבינה המלאכותית',
    'garage.token.1': 'כל פרומפט שמבקשים מבינה מלאכותית עולה טוקנים. גם אצל בורג במוסך, וגם באמת.',
    'garage.token.2': 'לכן שווה לאסוף אותם במרוץ — ולחשוב רגע לפני שמבקשים.',
    'garage.token.go': 'הבנתי!',

    // ── The debrief ─────────────────────────────────────────────────────────
    'garage.debrief.label': 'בורג מסביר',
    'garage.debrief.title': 'מה כל שורה בפרומפט עשתה',
    'garage.debrief.p.goal': 'דיוק — מתי ואיפה',
    'garage.debrief.p.limit': 'הגבלה משפרת את התוצאה',
    'garage.debrief.p.style': 'סגנון והקשר מעצבים את התוצאה',
    'garage.debrief.pts': '‎+{n} לאיכות הפרומפט',
    'garage.debrief.pts0': 'בלי נקודות',
    'garage.debrief.goal.0': 'בשורת המטרה לא היה כתוב מתי ואיפה, אז ניחשתי לבד. ניחוש זה לא בנייה.',
    'garage.debrief.goal.1': 'היה כתוב "{goal}" — כיוון כללי. זה כבר עזר, אבל את הרגע המדויק על המסלול עוד ניחשתי.',
    'garage.debrief.goal.2': 'היה כתוב "{goal}" — רגע מדויק על המסלול, אז ידעתי בדיוק מה לחזק.',
    'garage.debrief.limit.0': 'לא נאמר לי מה אסור להרוס, אז בחרתי לבד: הוספתי {gain}, {cost}',
    'garage.debrief.cost.some': 'ובדרך שילמתי על זה ב{loss}. תמיד יש מחיר — השאלה היחידה היא מי בוחר אותו.',
    'garage.debrief.cost.none': 'והפעם, במקרה, לא נשבר שום דבר אחר. בפעם הבאה זה כבר לא מובטח, אז עדיף להגיד מראש מה אסור להרוס.',
    'garage.debrief.limit.1': '"{limit}" זו הגבלה, אבל היא לא אומרת מה בדיוק. גם עליה קיבלתם נקודות — הגבלה תמיד עוזרת לי.',
    'garage.debrief.limit.2': 'זה נשמע הפוך, אבל דווקא "{limit}" — מה שאסור לי — הוא שהקפיץ את התוצאה. כשאסור לי לרמות, אני חייב למצוא פתרון חכם.',
    'garage.debrief.limit.coherent': 'ועוד ‎7 נקודות, כי המטרה וההגבלה דיברו בדיוק על אותו דבר.',
    'garage.debrief.style.0': 'לא נאמר איך זה ייראה, אז בחרתי בעצמי. אני בוחר סגול. תמיד סגול.',
    'garage.debrief.style.1': '"{style}" נתן לי תמונה בראש, ולכן החלק יצא אישי ולא סתם אפור. גם "איך זה ייראה" זה מידע.',
    'garage.debrief.x.concrete.on': 'היו בפרומפט מילים קונקרטיות מהמסלול, אז ידעתי מה בדיוק למדוד.',
    'garage.debrief.x.concrete.off': 'לא הופיעו בפרומפט מילים קונקרטיות מהמסלול, אז ניחשתי מה לחזק.',
    'garage.debrief.x.limit.on': 'הופיעה בפרומפט הגבלה, וזה מה שאילץ אותי לפתרון חכם במקום פתרון קל.',
    'garage.debrief.x.limit.off': 'לא הופיעה שום הגבלה, אז שום דבר לא עצר אותי. גם לא מלקלקל דברים אחרים.',
    'garage.debrief.x.style.on': 'הופיע גם סגנון, אז הייתה לי תמונה בראש לפני שהתחלתי לרתך.',
    'garage.debrief.x.style.off': 'לא הופיע סגנון, אז בחרתי לבד. סגול, מן הסתם.',

    // ── Ghost preview ───────────────────────────────────────────────────────
    'garage.ghost.title': 'אם הפרומפט היה כללי, זה מה שהיה יוצא',
    'garage.ghost.invite': 'עם אותם טוקנים בדיוק, פרומפט מדויק יותר היה נותן את זה',
    'garage.ghost.note': 'אותו מוסך, אותם טוקנים. מה שהשתנה זה רק הפרומפט.',
    'garage.ghost.noteInvite': 'אותו מוסך, אותם טוקנים — רק פרומפט מדויק יותר. שווה לנסות עוד אחד.',

    // ── Free play ───────────────────────────────────────────────────────────
    'garage.freeplay.chip': 'מצב תרגול',
    'garage.freeplay.note': 'טוקנים על חשבון בורג — אפשר לנסות כמה פרומפטים שרוצים',
    'garage.freeplay.kicker': 'מתאמנים על פרומפטים, בלי מרוץ',
    'garage.freeplay.intro': 'המוסך פתוח סתם ככה! כאן הטוקנים עליי, שום דבר לא נשמר, ואפשר לנסות פרומפטים עד שמשתעממים.',
    'garage.freeplay.again': 'עוד פרומפט',
    'garage.freeplay.exit': 'חזרה לתפריט',
    'garage.freeplay.unlimited': 'ללא הגבלה',
  },
  en: {
    'garage.title': 'The Garage',
    'garage.kicker': 'Write a prompt, Boreg builds a part',
    'garage.budget': 'Budget',
    'garage.spent': 'Costs',
    'garage.left': 'Left',
    'garage.budget.note': 'never enough for everything — choose where it counts',
    'garage.budget.plenty': 'enough for everything this time — so go for the sharpest prompt',
    'garage.boreg': 'Boreg',
    'garage.intro.1': "I'm Boreg, and I build exactly what the prompt says. Exactly. So let's put together a good prompt.",
    'garage.intro.2': "You're back! Today we learn my secret — what must NOT break. That is what makes a part great.",
    'garage.intro.3': 'Final race. It is all known by now: what, when, what must not break, and how it looks.',
    'garage.sentence.label': 'Your prompt for Boreg',
    'garage.sentence.hint': 'one row at a time — the prompt builds in front of you',
    'garage.stats.label': 'Effect on your kart',
    'garage.stat.speed': 'Speed',
    'garage.stat.accel': 'Accel',
    'garage.stat.handling': 'Handling',
    'garage.stat.weight': 'Weight',
    'garage.stat.weightNote': 'less is better',
    'garage.quality': 'Prompt quality',
    'garage.build': 'Boreg, build it!',
    'garage.buildBlocked': 'Answer all four rows',
    'garage.building': 'Boreg is building…',
    'garage.reset': 'Start over',
    'garage.frag': 'goes into the prompt',
    'garage.step.change': 'Change',
    'garage.step.next': 'next',
    'garage.step.of': 'Step {n} of 4',
    'garage.tier.0': 'Tier 0 — works, sort of',
    'garage.tier.1': 'Tier 1 — perfectly fine',
    'garage.tier.2': 'Tier 2 — tuned',
    'garage.tier.3': 'Tier 3 — ridiculously precise',
    'garage.reveal.title': 'Boreg built you',
    'garage.reveal.ask': 'This was your prompt',
    'garage.reveal.spec': 'How much detail each piece carried',
    'garage.reveal.deltas': 'What changed on your kart',
    'garage.reveal.tokens': 'You earned {n} tokens',
    'garage.reveal.install': 'Install and continue',
    'garage.reveal.again': 'A different prompt',
    'garage.expert.toggle': 'Expert mode',
    'garage.expert.badge': 'optional · ages 12+',
    'garage.expert.label': 'Write to Boreg in your own words',
    'garage.expert.ph': 'e.g. Boreg, strengthen the engine for corner exit, without adding more than 2 kg, in dusty orange',
    'garage.expert.check.concrete': 'Concrete words',
    'garage.expert.check.numbers': 'A number or unit',
    'garage.expert.check.constraint': 'A limit',
    'garage.expert.check.style': 'A style',
    'garage.expert.check.length': 'Enough detail',
    'garage.expert.check.filler': 'No empty words',
    'garage.expert.bonus': '1.6× tokens',
    'garage.tip.label': 'Tip from Boreg',
    'garage.tip.waiting': 'Pick something in the first row and I will explain exactly what it changed on the kart.',
    'garage.visit': 'Visit {n} of 3',
    'garage.free': 'free',
    'garage.recipe.label': 'Recipe for a good prompt',
    'garage.recipe.what': 'What exactly',
    'garage.recipe.when': 'When and where',
    'garage.recipe.limit': 'What must not break',
    'garage.recipe.look': 'How it looks',

    'garage.meet.kicker': 'Before we start',
    'garage.meet.title': 'Hello, I am Boreg',
    'garage.meet.1': 'I am an artificial intelligence. A machine that understands words — and in my case, welds too.',
    'garage.meet.2': 'It works like this: you tell me in words what you want, and I build it. Exactly what is written, not what you pictured in your head.',
    'garage.meet.3': 'Those words are called a prompt. The sharper the prompt, the better the part — and it works exactly the same way with every AI you will meet on a computer.',
    'garage.meet.go': "Let's start!",
    'garage.meet.word': 'prompt = what you ask an AI for, in words',

    'garage.token.kicker': 'Your first token',
    'garage.token.title': 'Tokens — the currency of AI',
    'garage.token.1': 'Every prompt you send to an AI costs tokens. In Boreg\'s garage, and in real life too.',
    'garage.token.2': 'So they are worth collecting on track — and worth a moment of thought before you spend them.',
    'garage.token.go': 'Got it!',

    'garage.debrief.label': 'Boreg explains',
    'garage.debrief.title': 'What each line of the prompt did',
    'garage.debrief.p.goal': 'Specificity — when and where',
    'garage.debrief.p.limit': 'A limit improves the result',
    'garage.debrief.p.style': 'Context and style shape the output',
    'garage.debrief.pts': '+{n} prompt quality',
    'garage.debrief.pts0': 'no points',
    'garage.debrief.goal.0': 'The goal line never said when or where, so I guessed. Guessing is not building.',
    'garage.debrief.goal.1': 'It said "{goal}" — a direction. That helped, but I still guessed the exact moment on track.',
    'garage.debrief.goal.2': 'It said "{goal}" — an exact moment on track, so I knew exactly what to strengthen.',
    'garage.debrief.limit.0': 'Nobody told me what must not break, so I chose for myself: I added {gain}, {cost}',
    'garage.debrief.cost.some': 'and paid for it in {loss}. There is always a price — the only question is who picks it.',
    'garage.debrief.cost.none': 'and this time, by luck, nothing else broke. Next time is not a promise, so it is worth saying up front what must not break.',
    'garage.debrief.limit.1': '"{limit}" is a limit, but it does not say what exactly. It still scored — a limit always helps me.',
    'garage.debrief.limit.2': 'Sounds backwards, but "{limit}" — the thing I was NOT allowed to do — is what lifted the result. When I cannot cheat, I have to be clever.',
    'garage.debrief.limit.coherent': 'Plus 7 more, because the goal and the limit were about exactly the same thing.',
    'garage.debrief.style.0': 'Nothing said how it should look, so I chose. I choose purple. Always purple.',
    'garage.debrief.style.1': '"{style}" gave me a picture in my head, so the part came out personal instead of generic grey. How it looks is information too.',
    'garage.debrief.x.concrete.on': 'The prompt used concrete words from the track, so I knew what to measure.',
    'garage.debrief.x.concrete.off': 'The prompt had no concrete track words in it, so I guessed what to strengthen.',
    'garage.debrief.x.limit.on': 'The prompt carried a limit, and that is what pushed me to a clever answer instead of an easy one.',
    'garage.debrief.x.limit.off': 'There was no limit at all, so nothing stopped me. Including from breaking other things.',
    'garage.debrief.x.style.on': 'There was a style too, so I had a picture in my head before I started welding.',
    'garage.debrief.x.style.off': 'No style, so I picked one. Purple, obviously.',

    'garage.ghost.title': 'If the prompt had been vague, this is what you would have got',
    'garage.ghost.invite': 'For those exact same tokens, a sharper prompt would have got you this',
    'garage.ghost.note': 'Same garage, same tokens. The only thing that changed is the prompt.',
    'garage.ghost.noteInvite': 'Same garage, same tokens — just a sharper prompt. Worth another go.',

    'garage.freeplay.chip': 'Practice mode',
    'garage.freeplay.note': 'tokens are on Boreg — try as many prompts as you like',
    'garage.freeplay.kicker': 'Practising prompts, no race attached',
    'garage.freeplay.intro': 'The garage is open just for fun! Tokens are on me, nothing is saved, and you can try prompts until you get bored.',
    'garage.freeplay.again': 'Another prompt',
    'garage.freeplay.exit': 'Back to menu',
    'garage.freeplay.unlimited': 'unlimited',
  },
});

// Each slot row owns a colour. Cards, the row number, the chosen-chip and the
// selection glow all use it, so "which question am I answering" is readable at a
// glance and from across a classroom — the reference screenshot's trick.
// (The values live in GARAGE_CSS as .grg-hue-* classes — h() assigns style
// properties with Object.assign, which cannot set CSS custom properties.)
const hueClass = key => '.grg-hue-' + (['part', 'goal', 'limit', 'style'].includes(key) ? key : 'part');

// ─────────────────────────────────────────────────────────────────────────────
// Scene-local CSS. style.js is lead-owned, so the garage brings its own sheet
// and removes it on dispose. Everything is built on the shared tokens.
// ─────────────────────────────────────────────────────────────────────────────
const GARAGE_CSS = `
.grg-root{position:absolute;inset:0;display:flex;flex-direction:column;gap:14px;
  padding:18px 26px 20px;font-family:var(--font)}
.grg-top{display:flex;align-items:center;gap:16px}
.grg-title{font-size:40px;line-height:1}
.grg-kicker{font-size:12px;font-weight:800;color:var(--txt-dim);letter-spacing:.02em}
.grg-visit{font-size:12px;font-weight:800;color:var(--gold-1);
  background:rgba(255,194,71,.12);border:1px solid rgba(255,194,71,.3);
  border-radius:var(--r-pill);padding:5px 12px}
.grg-spacer{flex:1}
.grg-budget{display:flex;align-items:center;gap:14px;padding:9px 18px;border-radius:var(--r-pill);
  box-shadow:var(--sh-panel),0 0 26px rgba(255,214,107,.18)}
.grg-coin{width:22px;height:22px;border-radius:50%;flex:none;
  background:radial-gradient(circle at 35% 30%,#fff3cf,var(--token) 45%,#c98a12);
  box-shadow:0 0 12px rgba(255,214,107,.55),0 1px 0 rgba(255,255,255,.6) inset}
.grg-bignum{font-size:28px;line-height:1}
.grg-sub{font-size:11.5px;font-weight:800;color:var(--txt-dim)}
.grg-budgetnote{font-size:11.5px;font-weight:800;color:var(--token);opacity:.85;max-width:190px;
  line-height:1.25}

.grg-body{flex:1;display:flex;gap:18px;min-height:0}
.grg-main{flex:1.66;display:flex;flex-direction:column;gap:13px;min-width:0}
.grg-side{flex:1;max-width:372px;display:flex;flex-direction:column;gap:13px;min-width:0}

/* Boreg's line */
.grg-boreg{display:flex;align-items:center;gap:13px;padding:10px 16px}
.grg-face{width:44px;height:44px;flex:none;border-radius:14px;position:relative;
  background:linear-gradient(180deg,#8fa4c8,#5c6b8f);
  box-shadow:0 2px 0 rgba(255,255,255,.25) inset,0 6px 14px rgba(0,0,0,.45)}
.grg-face::before,.grg-face::after{content:"";position:absolute;top:15px;width:8px;height:10px;
  border-radius:4px;background:var(--gold-1);box-shadow:0 0 8px var(--gold-2)}
.grg-face::before{left:9px}.grg-face::after{right:9px}
.grg-antenna{position:absolute;top:-9px;left:50%;width:3px;height:9px;margin-left:-1.5px;
  background:#8fa4c8;border-radius:2px}
.grg-antenna::after{content:"";position:absolute;top:-6px;left:-3px;width:9px;height:9px;
  border-radius:50%;background:var(--gold-2);box-shadow:0 0 10px var(--gold-2)}
.grg-boreg-line{font-size:15px;font-weight:700;line-height:1.35}

/* The sentence — the centrepiece. */
.grg-sentence{padding:14px 20px 16px;position:relative;overflow:hidden;
  background:linear-gradient(180deg,rgba(60,50,27,.94),rgba(26,22,14,.96));
  border:1px solid rgba(255,194,71,.34);border-radius:var(--r-l);
  box-shadow:var(--sh-pop),0 0 0 1px rgba(255,194,71,.10) inset,0 0 44px rgba(255,194,71,.08)}
.grg-sentence-txt{font-size:26px;font-weight:800;line-height:1.55;letter-spacing:-.01em}
.ltr .grg-sentence-txt{font-size:23px}
.grg-w{color:#fff6e2}
.grg-w.lead{color:var(--gold-1)}
.grg-blank{display:inline-block;padding:0 10px;border-radius:9px;font-size:.78em;
  color:#ffdb92;background:rgba(255,194,71,.10);
  border:2px dashed rgba(255,194,71,.45);vertical-align:2px}
.grg-blank.now{background:rgba(255,194,71,.22);border-style:solid;color:#fff2d4;
  box-shadow:0 0 20px rgba(255,194,71,.4)}
.grg-fill{border-radius:7px;padding:0 3px;background:rgba(255,194,71,.13)}

/* Steps — each row owns a colour identity (header gradient, number chip,
   selection bloom), so "which question is this" reads from across the room. */
.grg-hue-part{--rc1:#63a6e6;--rc2:#2f5f9e;--rcg:rgba(99,166,230,.5);--rci:#bcdcff}
.grg-hue-goal{--rc1:#f79055;--rc2:#b8442a;--rcg:rgba(247,144,85,.5);--rci:#ffd2b4}
.grg-hue-limit{--rc1:#5fc884;--rc2:#2c7a4e;--rcg:rgba(95,200,132,.46);--rci:#bdf0cf}
.grg-hue-style{--rc1:#ac7ce6;--rc2:#5d3ba0;--rcg:rgba(172,124,230,.5);--rci:#dcc8ff}
.grg-steps{display:flex;flex-direction:column;gap:12px;flex:1;min-height:0;justify-content:flex-start}
.grg-step{border-radius:var(--r-m)}
.grg-step-head{display:flex;align-items:center;gap:10px}
.grg-n{width:26px;height:26px;flex:none;border-radius:9px;font-size:13px;font-weight:900;
  color:#0f1018;background:linear-gradient(180deg,var(--rc1),var(--rc2));
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 14px var(--rcg),0 1px 0 rgba(255,255,255,.35) inset}
.grg-slot-title{font-size:16px;font-weight:900;color:var(--txt)}
.grg-slot-teach{font-size:12.5px;font-weight:700;color:var(--txt-dim)}

/* active step */
.grg-step.active{flex:0 1 auto;min-height:0;margin-block:auto;display:flex;flex-direction:column;gap:11px}
.grg-opts{display:flex;gap:13px;flex:1;min-height:186px;max-height:268px}
/* expert mode only needs the "which part" row, so it gets a compact variant */
.grg-opts.compact{flex:none;min-height:0;max-height:none}
.grg-opts.compact .grg-opt-head{min-height:54px}
.grg-opt{position:relative;flex:1 1 0;min-width:0;cursor:pointer;font-family:var(--font);
  color:var(--txt);padding:0;border-radius:16px;overflow:hidden;text-align:start;
  display:flex;flex-direction:column;
  background:linear-gradient(180deg,rgba(32,32,46,.94),rgba(12,12,19,.96));
  border:2px solid rgba(255,255,255,.09);box-shadow:0 10px 22px rgba(0,0,0,.5);
  transition:transform .14s var(--ease),border-color .14s,box-shadow .14s}
.grg-opt-head{position:relative;min-height:92px;display:flex;align-items:center;
  padding:11px 15px;background:linear-gradient(155deg,var(--rc1),var(--rc2));
  box-shadow:0 2px 0 rgba(255,255,255,.22) inset}
.grg-opt-head::after{content:"";position:absolute;inset:0;opacity:.16;pointer-events:none;
  background:repeating-linear-gradient(118deg,rgba(255,255,255,.7) 0 9px,transparent 9px 21px)}
.grg-opt-he{position:relative;font-size:16.5px;font-weight:900;line-height:1.22;color:#fff;
  text-shadow:0 2px 6px rgba(0,0,0,.45)}
.grg-opt-body{padding:12px 15px 13px;display:flex;flex-direction:column;gap:10px;flex:1}
.grg-opt-sub{font-size:12.5px;font-weight:700;color:#b6b0a7;line-height:1.38}
/* The exact words this card will drop into the sentence. Reading it is the
   point: the child sees their own Hebrew sentence being assembled, word by word. */
.grg-opt-frag{margin-block-start:auto;font-size:12.5px;font-weight:800;line-height:1.35;
  color:var(--rci);background:rgba(255,255,255,.05);border-radius:11px;padding:8px 11px;
  border:1px dashed rgba(255,255,255,.15)}
/* 11px is the floor for every Hebrew micro-label in the game — see the same
   note in race/hud.js. Below that Hebrew loses its stem contrast fast, and this
   audience starts at eight years old. */
.grg-opt-fragl{display:block;font-size:11px;font-weight:900;letter-spacing:.02em;
  color:var(--txt-dim);margin-block-end:3px}
.grg-opt:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3);
  box-shadow:0 16px 30px rgba(0,0,0,.55),0 0 26px var(--rcg)}
.grg-opt:focus-visible{outline:3px solid var(--info);outline-offset:3px}
.grg-opt[aria-pressed="true"]{border-color:var(--gold-2);
  box-shadow:0 0 0 3px rgba(255,194,71,.30),0 0 40px 6px var(--rcg),0 12px 26px rgba(0,0,0,.5)}
.grg-opt[aria-pressed="true"] .grg-opt-head::after{opacity:.3}
.grg-opt.locked{opacity:.3;cursor:not-allowed;filter:saturate(.35)}
.grg-cost{font-size:13px;font-weight:900;color:var(--token);
  display:flex;align-items:center;gap:6px}
.grg-cost i{width:12px;height:12px;border-radius:50%;display:block;
  background:radial-gradient(circle at 35% 30%,#fff3cf,var(--token) 50%,#c98a12);
  box-shadow:0 0 8px rgba(255,214,107,.5)}
.grg-cost.free{color:var(--txt-dim)}

/* done step — one compact line with a Change button */
.grg-step.done{display:flex;align-items:center;gap:11px;padding:8px 13px;flex:none;
  background:linear-gradient(180deg,rgba(34,34,48,.72),rgba(16,16,24,.78));
  border:1px solid var(--stroke);border-inline-start:4px solid var(--rc1)}
.grg-done-title{font-size:12.5px;font-weight:800;color:var(--txt-dim);flex:none}
.grg-done-pick{font-size:14.5px;font-weight:900;color:var(--rci);min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grg-change{margin-inline-start:auto;flex:none;font-family:var(--font);cursor:pointer;
  font-size:12px;font-weight:800;color:var(--txt);padding:6px 14px;border-radius:var(--r-pill);
  background:rgba(255,255,255,.07);border:1px solid var(--stroke-hi)}
.grg-change:hover{background:rgba(255,255,255,.15)}
.grg-change:focus-visible{outline:3px solid var(--info);outline-offset:2px}

/* upcoming step — a quiet placeholder so the child sees the shape of the task */
.grg-step.todo{display:flex;align-items:center;gap:11px;padding:8px 13px;flex:none;opacity:.42;
  border:1px dashed var(--stroke-hi)}
.grg-step.todo .grg-n{background:rgba(255,255,255,.12);color:var(--txt-dim);box-shadow:none}
.grg-todo-tag{margin-inline-start:auto;font-size:11px;font-weight:800;color:var(--txt-dim)}

/* Side column */
.grg-kart{flex:1;min-height:168px;max-height:270px;position:relative;overflow:hidden;
  background:radial-gradient(120% 90% at 50% 30%,rgba(80,70,110,.34),rgba(12,12,20,.42) 70%)}
.grg-panel-pad{padding:12px 15px}
.grg-statrow{display:flex;align-items:center;gap:9px}
.grg-statname{width:64px;flex:none;font-size:11.5px;font-weight:800;color:var(--txt-dim)}
.ltr .grg-statname{width:74px}
.grg-track{flex:1;height:12px;border-radius:var(--r-pill);background:rgba(255,255,255,.09);
  display:flex;overflow:hidden}
.grg-track>span{display:block;height:100%;transition:width .4s var(--ease)}
.grg-cur{background:linear-gradient(90deg,#6f7ba0,#9fb0d8)}
.grg-up{background:linear-gradient(90deg,#5fc96a,#a6f0a8);box-shadow:0 0 12px rgba(126,224,129,.6)}
.grg-dn{background:linear-gradient(90deg,#ff6b6b,#ffa3a3)}
.grg-statval{width:44px;flex:none;text-align:end;font-size:12.5px}
.grg-delta{font-size:12px;font-weight:900;width:34px;text-align:end}
.grg-delta.good{color:var(--good)}.grg-delta.bad{color:var(--bad)}
.grg-delta.zero{color:var(--txt-dim)}

.grg-quality{display:flex;align-items:center;gap:10px;margin-top:5px}
.grg-qbar{flex:1;height:10px;border-radius:var(--r-pill);background:rgba(255,255,255,.1);overflow:hidden}
.grg-qbar>i{display:block;height:100%;border-radius:var(--r-pill);
  background:linear-gradient(90deg,var(--gold-3),var(--gold-1));transition:width .4s var(--ease);
  box-shadow:0 0 14px rgba(255,194,71,.55)}

/* Tip card */
.grg-tip{padding:12px 15px;border-inline-start:4px solid var(--gold-2)}
.grg-side>.grg-tip{flex:1;min-height:124px}
.grg-tip-label{font-size:11px;font-weight:900;letter-spacing:.02em;color:var(--gold-1)}
.grg-tip-title{font-size:15.5px;font-weight:900;margin-top:2px}
.grg-tip-body{font-size:13px;font-weight:600;line-height:1.45;color:#e6e0d3;margin-top:4px}

/* Build button — real bloom, like the reference's primary CTA */
.grg-build{width:100%;padding:16px 20px;font-size:19px}
.grg-build:not(:disabled){box-shadow:0 6px 0 #a4620a,0 12px 26px rgba(0,0,0,.45),
  0 0 42px rgba(255,194,71,.5),0 1px 0 rgba(255,255,255,.6) inset}
.grg-build:not(:disabled):hover{box-shadow:0 8px 0 #a4620a,0 16px 32px rgba(0,0,0,.5),
  0 0 56px rgba(255,194,71,.62),0 1px 0 rgba(255,255,255,.6) inset}

/* Expert */
.grg-expertbar{display:flex;align-items:center;gap:10px;margin-block-start:auto}
.grg-toggle{display:flex;align-items:center;gap:9px;cursor:pointer;font-family:var(--font);
  padding:8px 14px;border-radius:var(--r-pill);font-size:13px;font-weight:800;color:var(--txt);
  background:rgba(255,255,255,.06);border:1px solid var(--stroke-hi)}
.grg-toggle:focus-visible{outline:3px solid var(--info);outline-offset:2px}
.grg-sw{width:32px;height:17px;border-radius:999px;background:rgba(255,255,255,.16);
  position:relative;flex:none;transition:background .15s}
.grg-sw::after{content:"";position:absolute;top:2px;inset-inline-start:2px;width:13px;height:13px;
  border-radius:50%;background:#cfd4e0;transition:transform .15s var(--ease)}
.grg-toggle[aria-pressed="true"] .grg-sw{background:var(--gold-3)}
.ltr .grg-toggle[aria-pressed="true"] .grg-sw::after{background:#fff;transform:translateX(15px)}
.rtl .grg-toggle[aria-pressed="true"] .grg-sw::after{background:#fff;transform:translateX(-15px)}
.grg-badge{font-size:11px;font-weight:800;color:var(--txt-dim)}
.grg-bonus{font-size:11px;font-weight:900;color:var(--token);
  background:rgba(255,214,107,.12);border-radius:var(--r-pill);padding:4px 10px}
.grg-expertbox{padding:13px 15px;display:flex;flex-direction:column;gap:9px;flex:1;min-height:0}
.grg-recipe{padding:13px 15px;display:flex;flex-direction:column;gap:9px;flex:none}
.grg-recipe-row{display:flex;gap:8px;flex-wrap:wrap}
.grg-recipe-chip{font-size:13px;font-weight:800;padding:8px 14px;border-radius:var(--r-pill);
  color:#ffe3ab;background:rgba(255,194,71,.10);border:1px solid rgba(255,194,71,.28)}
.grg-ta{width:100%;flex:1;min-height:150px;resize:none;font-family:var(--font);font-size:15.5px;
  font-weight:700;line-height:1.4;color:var(--txt);padding:11px 13px;border-radius:var(--r-s);
  background:rgba(10,10,16,.6);border:2px solid var(--stroke-hi)}
.grg-ta:focus{outline:none;border-color:var(--gold-2)}
.grg-ta::placeholder{color:#7d7a72}
.grg-checks{display:flex;flex-wrap:wrap;gap:7px}
.grg-chk{font-size:11.5px;font-weight:800;padding:5px 11px;border-radius:var(--r-pill);
  background:rgba(255,255,255,.06);color:var(--txt-dim);border:1px solid var(--stroke)}
.grg-chk.ok{background:rgba(126,224,129,.16);color:#bff0c1;border-color:rgba(126,224,129,.45)}

/* Reveal */
.grg-scrim{position:absolute;inset:0;background:rgba(6,6,12,.66);backdrop-filter:blur(2px);
  display:flex;align-items:center;justify-content:center;padding:22px}
.grg-reveal{width:min(1060px,96%);max-height:96%;padding:18px 24px 18px;
  display:flex;flex-direction:column;gap:10px;overflow:hidden}
.grg-tierbadge{align-self:flex-start;font-size:12.5px;font-weight:900;padding:6px 15px;
  border-radius:var(--r-pill);color:#2a1c00;
  background:linear-gradient(180deg,var(--gold-1),var(--gold-3));
  box-shadow:0 0 26px rgba(255,194,71,.45)}
/* The ask that caused all this, reprinted at the top of the reveal — the modal
   must never be the moment the cause disappears. */
.grg-recap{padding:12px 16px;border-radius:var(--r-m);line-height:1.55;
  background:rgba(0,0,0,.34);border:1px solid rgba(255,194,71,.24);
  font-size:17px;font-weight:800;color:#ded7c7}
.ltr .grg-recap{font-size:16px}
.grg-recap .hi{color:#fff6e2;background:rgba(255,194,71,.20);border-radius:7px;padding:1px 5px;
  box-shadow:0 0 0 1px rgba(255,194,71,.32)}
.grg-specrow{display:flex;gap:8px;flex-wrap:wrap}
.grg-specchip{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;
  color:var(--txt-dim);padding:6px 12px;border-radius:var(--r-pill);
  background:rgba(255,255,255,.05);border:1px solid var(--stroke)}
.grg-dots{display:flex;gap:4px}
.grg-dot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.16)}
.grg-dot.lit{background:var(--gold-2);box-shadow:0 0 8px rgba(255,194,71,.75)}
.grg-partname{font-size:34px;line-height:1.1}
.grg-flavour{font-size:15px;font-weight:700;line-height:1.45;color:#f0ebdf}
.grg-deltagrid{display:flex;gap:9px}
.grg-deltacard{flex:1;padding:9px 12px;border-radius:var(--r-s);background:rgba(255,255,255,.055);
  border:1px solid var(--stroke);display:flex;flex-direction:column;gap:3px}
.grg-revactions{display:flex;gap:10px;align-items:center;margin-top:2px}
.grg-tokgain{display:flex;align-items:center;gap:8px;font-size:14.5px;font-weight:900;
  color:var(--token);margin-inline-start:auto}

/* ── Meet Boreg: the one-time "I am an AI" introduction ──────────────────── */
.grg-meet{width:min(680px,92%);max-height:94%;overflow:auto;padding:24px 28px 22px;
  display:flex;flex-direction:column;gap:12px}
.grg-meet-top{display:flex;align-items:center;gap:15px}
.grg-face.big{width:70px;height:70px;border-radius:21px}
.grg-face.big::before,.grg-face.big::after{top:25px;width:12px;height:15px}
.grg-face.big::before{left:15px}.grg-face.big::after{right:15px}
.grg-face.big .grg-antenna{top:-13px;width:4px;height:13px;margin-left:-2px}
.grg-face.big .grg-antenna::after{top:-8px;left:-4px;width:12px;height:12px}
.grg-meet-title{font-size:34px;line-height:1}
.grg-meet-p{font-size:16.5px;font-weight:700;line-height:1.5;color:#efe9dc}
.grg-meet-p b{color:var(--gold-1);font-weight:900}
.grg-meet-word{align-self:flex-start;font-size:13.5px;font-weight:900;color:#ffe3ab;
  padding:9px 15px;border-radius:var(--r-pill);background:rgba(255,194,71,.12);
  border:1px solid rgba(255,194,71,.32)}
.grg-meet-actions{display:flex;justify-content:flex-end;margin-top:4px}

/* ── The part card + its ghost twin ──────────────────────────────────────── */
.grg-cardrow{display:flex;gap:12px;align-items:stretch}
.grg-partcard{flex:1.32;min-width:0;padding:13px 16px 14px;border-radius:var(--r-m);
  display:flex;flex-direction:column;gap:7px;
  background:linear-gradient(180deg,rgba(64,53,29,.92),rgba(24,20,14,.95));
  border:1px solid rgba(255,194,71,.32);box-shadow:0 0 30px rgba(255,194,71,.10) inset}
.grg-partcard.ghost{flex:1;filter:saturate(.6);opacity:.72;
  background:linear-gradient(180deg,rgba(44,44,58,.6),rgba(14,14,20,.7));
  border:1px dashed rgba(255,255,255,.2);box-shadow:none}
.grg-partcard .grg-partname{font-size:27px;line-height:1.12}
.grg-partcard.ghost .grg-partname{font-size:21px}
.ltr .grg-partcard .grg-partname{font-size:23px}
.ltr .grg-partcard.ghost .grg-partname{font-size:18px}
.grg-mini{display:flex;gap:6px;flex-wrap:wrap;margin-top:1px}
.grg-ministat{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;
  color:var(--txt-dim);padding:5px 9px;border-radius:9px;
  background:rgba(255,255,255,.06);border:1px solid var(--stroke)}
.grg-ministat b{font-size:13.5px;font-weight:900}
.grg-ministat.good b{color:var(--good)}
.grg-ministat.bad b{color:var(--bad)}
.grg-ministat.zero b{color:var(--txt-dim)}
.grg-ghosthead{font-size:12.5px;font-weight:900;color:#c9d2e4;line-height:1.3}
.grg-ghostnote{font-size:12px;font-weight:700;color:var(--txt-dim);line-height:1.35;margin-top:auto}
.grg-tierbadge.dim{background:rgba(255,255,255,.12);color:#d8d3c8;box-shadow:none}

/* ── The debrief: one row per filled slot, one prompting idea each ───────── */
.grg-debrief{display:flex;flex-direction:column;gap:7px}
.grg-dbrow{display:flex;gap:11px;align-items:flex-start;padding:9px 13px;border-radius:var(--r-s);
  background:rgba(255,255,255,.05);border:1px solid var(--stroke);
  border-inline-start:4px solid var(--rc1)}
.grg-dbicon{width:26px;height:26px;flex:none;border-radius:9px;color:#0f1018;
  background:linear-gradient(180deg,var(--rc1),var(--rc2));
  display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;
  box-shadow:0 0 12px var(--rcg)}
.grg-dbmain{min-width:0;display:flex;flex-direction:column;gap:2px}
.grg-dbp{font-size:11.5px;font-weight:900;color:var(--rci)}
.grg-dbtxt{font-size:13.5px;font-weight:700;line-height:1.4;color:#ece6d9}
.grg-dbpts{margin-inline-start:auto;flex:none;font-size:11.5px;font-weight:900;color:var(--gold-1);
  background:rgba(255,194,71,.12);border:1px solid rgba(255,194,71,.28);
  border-radius:var(--r-pill);padding:4px 10px;white-space:nowrap}
.grg-dbpts.zero{color:var(--txt-dim);background:rgba(255,255,255,.05);border-color:var(--stroke)}
.grg-rev-scroll{overflow:auto;min-height:0;display:flex;flex-direction:column;gap:10px;
  padding-inline-end:4px}

/* ── Free play + the bottom recipe strip that fills the lower band ───────── */
.grg-visit.practice{color:#bdf0cf;background:rgba(95,200,132,.14);border-color:rgba(95,200,132,.36)}
.grg-recipe.strip{flex-direction:row;align-items:center;gap:14px;padding:10px 15px;flex:none}
.grg-recipe.strip .grg-recipe-row{flex:1}
.grg-recipe.strip .grg-recipe-chip{font-size:12.5px;padding:7px 12px}

/* Small school-laptop panels (1024x640 and friends). Without this the option
   cards of the open row fall off the bottom edge — i.e. the child cannot answer
   the question they are being asked. Detail text goes first, the cards stay. */
@media (max-height:700px){
  .grg-opts{min-height:132px;max-height:190px}
  .grg-opt-head{min-height:46px}
  .grg-opt-he{font-size:15px}
  .grg-opt-sub{display:none}
  .grg-opt-body{padding:9px 12px 10px;gap:7px}
  .grg-opt-frag{font-size:11.5px;padding:6px 9px}
  .grg-recipe.strip{display:none}
  .grg-boreg{padding:6px 13px}
  .grg-boreg-line{font-size:13px}
  .grg-sentence{padding:9px 16px 11px}
  .grg-slot-teach{display:none}
  .grg-expertbar{gap:8px}
}

@media (max-height:790px){
  .grg-title{font-size:32px}
  .grg-meet-title{font-size:28px}
  .grg-meet-p{font-size:15px}
  .grg-dbtxt{font-size:12.5px}
  .grg-partcard .grg-partname{font-size:23px}
  .grg-recipe.strip{padding:7px 13px}
  .grg-sentence-txt{font-size:22px}
  .ltr .grg-sentence-txt{font-size:20px}
  .grg-opt-head{min-height:66px}
  .grg-opt-he{font-size:16px}
  .grg-root{gap:11px;padding:14px 20px 15px}
  .grg-body{gap:14px}
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FIRST-TOKEN POPUP
//
// The very first time a child ever picks up a token, they should learn what a
// token IS: the thing every request to an AI costs. This is the one piece of the
// education layer that fires OUTSIDE the garage, so it ships as a standalone
// mountable element the race scene can drop in:
//
//   import { firstTokenPopup, shouldShowFirstTokenPopup } from './garage/garage.js';
//   if (shouldShowFirstTokenPopup()) {
//     const pop = firstTokenPopup({ onClose: () => resumeRace() });
//     engine.ui.appendChild(pop);      // pop.close() also works from the caller
//   }
//
// Calling firstTokenPopup() marks the one-time flag in save.js immediately, so a
// double-fire in the same frame cannot show it twice. Pass {persist:false} to
// show it without touching the save (used by the preview).
// ─────────────────────────────────────────────────────────────────────────────
export const TOKEN_INTRO_FLAG = 'garageTokenIntroSeen';
export const MEET_BOREG_FLAG = 'garageMetBoreg';

// Deliberately also false while ANY other panel owns the screen. The race asks
// this question inside its token-pickup branch, and a child can very well drive
// through a token while a quiz panel is open — the world is only slowed, not
// stopped. Answering "not now" defers the explainer to the next token rather
// than stacking a second modal on the first (and the flag is untouched, so it
// is not lost). There are ~28 tokens on a lap; the next one is seconds away.
export const shouldShowFirstTokenPopup = () => !save.read(TOKEN_INTRO_FLAG) && !modalOpen();
export const markFirstTokenPopupSeen = () => { save.set({ [TOKEN_INTRO_FLAG]: true }); };
export const shouldShowBoregIntro = () => !save.read(MEET_BOREG_FLAG);
export const markBoregIntroSeen = () => { save.set({ [MEET_BOREG_FLAG]: true }); };

const TOKEN_CSS = `
.grgtok-scrim{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding:22px;background:rgba(6,6,12,.6);backdrop-filter:blur(2px);font-family:var(--font)}
.grgtok-card{width:min(520px,92%);padding:22px 26px 20px;display:flex;flex-direction:column;gap:11px;
  border-radius:var(--r-l);border:1px solid rgba(255,214,107,.34);
  background:linear-gradient(180deg,rgba(58,48,26,.96),rgba(22,19,13,.97));
  box-shadow:var(--sh-pop),0 0 60px rgba(255,214,107,.22)}
.grgtok-top{display:flex;align-items:center;gap:13px}
.grgtok-coin{width:44px;height:44px;border-radius:50%;flex:none;
  background:radial-gradient(circle at 35% 30%,#fff3cf,var(--token) 45%,#c98a12);
  box-shadow:0 0 26px rgba(255,214,107,.6),0 1px 0 rgba(255,255,255,.6) inset}
.grgtok-kicker{font-size:11px;font-weight:900;letter-spacing:.04em;color:var(--gold-1)}
.grgtok-title{font-size:26px;line-height:1.05}
.grgtok-p{font-size:15.5px;font-weight:700;line-height:1.5;color:#efe9dc}
.grgtok-p b{color:var(--gold-1);font-weight:900}
.grgtok-actions{display:flex;justify-content:flex-end;margin-top:3px}
`;

let tokenCssUsers = 0;
function useTokenCss(on) {
  if (on) {
    tokenCssUsers++;
    if (!document.getElementById('grg-tok-style')) {
      const el = document.createElement('style');
      el.id = 'grg-tok-style';
      el.textContent = TOKEN_CSS;
      document.head.appendChild(el);
    }
  } else if (--tokenCssUsers <= 0) {
    tokenCssUsers = 0;
    document.getElementById('grg-tok-style')?.remove();
  }
}

/**
 * The one-time "what is a token" popup.
 * @param o {onClose?:fn, persist?:boolean}
 * @returns HTMLElement with an extra `close()` method.
 */
export function firstTokenPopup(o = {}) {
  useTokenCss(true);
  if (o.persist !== false) markFirstTokenPopupSeen();
  pushModal('token');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    popModal('token');
    removeEventListener('keydown', onKey, true);
    root.remove();
    useTokenCss(false);
    o.onClose?.();
  };
  // Escape closes this rather than falling through to input.js, which would
  // open the pause menu ON TOP of it — and the pause menu's resume then
  // un-freezes the race underneath a modal the child is still reading. Capture
  // phase + stopPropagation, the same discipline ui/menus.js overlays use.
  const onKey = e => {
    if (e.key !== 'Escape' || closed) return;
    e.preventDefault(); e.stopPropagation();
    close();
  };
  addEventListener('keydown', onKey, true);
  const btn = h('button.btn', { type: 'button', onclick: close }, t('garage.token.go'));
  const root = h('div.grgtok-scrim.fade-in', null,
    h('div.grgtok-card.pop-in', null,
      h('div.grgtok-top', null,
        h('div.grgtok-coin'),
        h('div', null,
          h('div.grgtok-kicker', null, t('garage.token.kicker')),
          h('div.display.grgtok-title', null, t('garage.token.title')))),
      h('div.grgtok-p', null, t('garage.token.1')),
      h('div.grgtok-p', null, t('garage.token.2')),
      h('div.grgtok-actions', null, btn)));
  root.close = close;
  root.focusButton = () => btn.focus({ preventScroll: true });
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// KART PREVIEW HOOK — the one seam between this scene and kart/kartmodel.js.
//
//   import { setKartPreviewMounter } from './garage/garage.js';
//   setKartPreviewMounter((container, api) => {
//     const kart = buildKart(...);        // THREE.Object3D
//     container.add(kart);
//     return {
//       // called whenever the previewed part/tier changes
//       setPart(slotKey, visualTier) { … },   // visualTier ∈ VISUAL_TIER
//       update(dt) { … },
//       dispose() { … },
//     };
//   });
//
// `container` is a THREE.Group already positioned and scaled to sit inside the
// preview window in the side panel. Until a mounter is registered, a clearly
// marked placeholder is used.
// ─────────────────────────────────────────────────────────────────────────────
let kartMounter = null;
export function setKartPreviewMounter(fn) { kartMounter = fn; }

function mountKartPreview(container, api) {
  if (kartMounter) return kartMounter(container, api) || null;
  return placeholderKart(container);
}

// PLACEHOLDER ONLY — delete once the real kart is wired in.
function placeholderKart(container) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc247, roughness: 0.42, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.34, 1.85), mat);
  body.position.y = 0.38; g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.24, 0.55), mat);
  nose.position.set(0, 0.42, 1.15); g.add(nose);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.42, 0.46), dark);
  seat.position.set(0, 0.72, -0.32); g.add(seat);
  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.26, 14);
  const wheelGeoF = new THREE.CylinderGeometry(0.23, 0.23, 0.2, 14);
  for (const [x, z, big] of [[-0.72, -0.62, 1], [0.72, -0.62, 1], [-0.62, 0.78, 0], [0.62, 0.78, 0]]) {
    const w = new THREE.Mesh(big ? wheelGeo : wheelGeoF, dark);
    w.rotation.z = Math.PI / 2; w.position.set(x, big ? 0.3 : 0.23, z); g.add(w);
  }
  container.add(g);
  return {
    setPart() { /* placeholder ignores part changes */ },
    update(dt, time) { g.rotation.y = time * 0.55; g.position.y = Math.sin(time * 1.3) * 0.03; },
    dispose() {
      [mat, dark, wheelGeo, wheelGeoF].forEach(o => o.dispose());
      g.traverse(o => o.geometry?.dispose?.());
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backdrop. PLACEHOLDER — the lead wires a real 3D workshop behind this scene at
// integration time. Until then it is at least a lit room and not a flat wash:
// vertical golden-hour gradient, a warm pool of light where the kart sits, a
// darker floor band, and canvas grain so nothing is a flat untextured colour.
function backdropTexture(size) {
  const s = Math.max(128, Math.min(512, size | 0 || 256));
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const g = c.getContext('2d');

  const grad = g.createLinearGradient(0, 0, 0, s);
  grad.addColorStop(0, '#140f1f');
  grad.addColorStop(0.42, '#241a30');
  grad.addColorStop(0.66, '#4a3324');
  grad.addColorStop(0.78, '#2a1d1e');
  grad.addColorStop(1, '#0d0a11');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);

  // Warm work-lamp pool, low and central: gives the flat backdrop a light source.
  const glow = g.createRadialGradient(s * 0.5, s * 0.68, 0, s * 0.5, s * 0.68, s * 0.55);
  glow.addColorStop(0, 'rgba(255,190,110,.34)');
  glow.addColorStop(0.5, 'rgba(255,150,80,.11)');
  glow.addColorStop(1, 'rgba(255,150,80,0)');
  g.fillStyle = glow; g.fillRect(0, 0, s, s);

  // Corner vignette — pushes the panels forward.
  const vig = g.createRadialGradient(s * 0.5, s * 0.5, s * 0.22, s * 0.5, s * 0.5, s * 0.78);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = vig; g.fillRect(0, 0, s, s);

  // Grain. Deterministic (no Math.random) so screenshots are reproducible.
  const img = g.getImageData(0, 0, s, s);
  const d = img.data;
  let seed = 0x2f6f2b1;
  for (let i = 0; i < d.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const n = ((seed >>> 16) & 15) - 7;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const L = () => (getLang() === 'en' ? 'en' : 'he');
const pick = (o, k) => (L() === 'en' ? o[k + 'En'] : o[k + 'He']);

// ─────────────────────────────────────────────────────────────────────────────
export function garageScene(engine, opts = {}) {
  const visit = clamp(opts.visit || 1, 1, 3);
  // FREE PLAY: a sandbox reachable from the home menu. Tokens are on the house
  // (the budget covers the most expensive prompt possible, so nothing is ever
  // locked), nothing is written to the championship, and the debrief still fires
  // — the whole point of the mode is to rebuild and compare.
  const freePlay = !!opts.freePlay;
  const budget = opts.tokens != null ? opts.tokens
    : freePlay ? MAX_COST : DEFAULT_BUDGET;
  // The screenshot harness passes `lang` in opts (it only writes it to save,
  // which i18n reads once at boot), so honour it here through the public API.
  if (opts.lang && opts.lang !== getLang()) setLang(opts.lang);
  const lang = L();
  const rtl = isRTL();

  // ── state ──────────────────────────────────────────────────────────────────
  const st = {
    sel: { part: opts.selection?.part || null, goal: opts.selection?.goal || null,
      constraint: opts.selection?.constraint || null, style: opts.selection?.style || null },
    phase: 'select',            // select | building | reveal
    expert: !!opts.expert,
    freeText: opts.freeText || '',
    buildTimer: 0,
    buildsThisVisit: 0,
    seenTips: (opts.seenTips || []).slice(),
    activeTip: opts.tip || null,
    result: null,
    focusHint: null,
    // The one-time "I am an AI" introduction. Shown on the very first garage
    // visit ever (free play counts — a child may well open the sandbox first).
    meet: opts.meet != null ? !!opts.meet : shouldShowBoregIntro(),
  };

  // ── 3D ─────────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  const bgTex = backdropTexture(engine.q.texSize || 512);
  scene.background = bgTex;
  scene.fog = new THREE.FogExp2(0x241a20, 0.035);

  // A long lens: the kart preview sits far off-axis in the side panel, and a
  // narrow FOV keeps it from shearing out there.
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 200);
  const CAM_D = 9.0, CAM_Y = 0.75;
  camera.position.set(0, CAM_Y + 0.85, CAM_D);
  camera.lookAt(0, CAM_Y, 0);

  scene.add(new THREE.HemisphereLight(0xffd9a0, 0x25203a, 0.85));
  const key = new THREE.DirectionalLight(0xffd0a0, 2.2);
  key.position.set(4, 6, 5);
  key.castShadow = engine.q.shadows;
  if (key.castShadow) { key.shadow.mapSize.set(engine.q.shadowSize, engine.q.shadowSize); key.shadow.camera.far = 30; }
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fa8ff, 0.85);
  rim.position.set(-5, 2.5, -4);
  scene.add(rim);

  // The group the kart (real or placeholder) lives in; repositioned each frame
  // so it lands inside the DOM preview window, whatever the aspect ratio.
  const kartAnchor = new THREE.Group();
  scene.add(kartAnchor);
  const kartApi = mountKartPreview(kartAnchor, { engine, visualTiers: VISUAL_TIER });

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2e2437, roughness: 0.95 });
  const floorGeo = new THREE.CircleGeometry(2.2, 32);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  kartAnchor.add(floor);

  // ── DOM ────────────────────────────────────────────────────────────────────
  let styleEl = document.getElementById('grg-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'grg-style';
    styleEl.textContent = GARAGE_CSS;
    document.head.appendChild(styleEl);
  }

  const root = h('div.grg-root.fade-in');
  engine.ui.appendChild(root);

  let kartWindow = null;      // DOM node the 3D kart is aimed at
  let navGrid = [];           // [[el,…],…] for arrow-key navigation

  // ── derived ────────────────────────────────────────────────────────────────
  const spent = () => costOf(st.sel);
  const remaining = () => budget - spent();
  const ctx = () => ({
    visit, seen: st.seenTips, buildsThisVisit: st.buildsThisVisit, unspent: remaining(),
    // The "you can never afford everything" tip is only true while that is true.
    // Race payouts can hand the garage a wallet that covers the whole ask, and a
    // teaching card that contradicts the screen it sits on teaches nothing.
    scarce: budget < MAX_COST,
  });
  const liveResult = () => (st.expert
    ? scoreFreeText(st.freeText, st.sel.part || 'engine', ctx())
    : scorePrompt(st.sel, ctx()));

  /** Index of the row the player is answering right now. */
  function activeIndex() {
    const i = SLOTS.findIndex(s => !st.sel[s.key]);
    return i === -1 ? SLOTS.length - 1 : i;   // all answered → keep the last open
  }

  function affordable(slotKey, opt) {
    const cur = optionById(slotKey, st.sel[slotKey]);
    return spent() - (cur ? cur.cost : 0) + opt.cost <= budget;
  }

  function choose(slotKey, opt) {
    // Safety net: if anything ever reaches the board while the introduction is
    // still up, the introduction has plainly been read.
    if (st.meet) { popModal('meet'); st.meet = false; markBoregIntroSeen(); }
    if (st.phase !== 'select') return;
    if (!affordable(slotKey, opt)) return;
    st.sel[slotKey] = st.sel[slotKey] === opt.id ? null : opt.id;
    // Tips fire live so the lesson lands at the moment of the choice. Marking the
    // card seen HERE is what stops pickTips' fresh-first ordering from serving the
    // same card on every single click.
    const r = liveResult();
    if (r.tips.length) {
      st.activeTip = r.tips[0];
      if (!st.seenTips.includes(r.tips[0])) st.seenTips.push(r.tips[0]);
    }
    st.focusHint = `${activeIndex()}:0`;
    render();
  }

  function clearSlot(slotKey) {
    if (st.phase !== 'select') return;
    st.sel[slotKey] = null;
    st.focusHint = `${activeIndex()}:0`;
    render();
  }

  function startBuild() {
    const r = liveResult();
    if (!r.complete) return;
    st.result = r;
    st.phase = 'building';
    st.buildTimer = 0;
    render();
  }

  function finishBuild() {
    st.phase = 'reveal';
    st.buildsThisVisit++;
    const r = st.result;
    if (r.tips.length) { st.activeTip = r.tips[0]; if (!st.seenTips.includes(r.tips[0])) st.seenTips.push(r.tips[0]); }
    kartApi?.setPart?.(r.slotKey, r.visualTier);
    render();
  }

  // ── render ─────────────────────────────────────────────────────────────────
  function render() {
    const navKey = st.focusHint || document.activeElement?.dataset?.nav || null;
    st.focusHint = null;
    root.replaceChildren();
    navGrid = [];
    root.appendChild(topBar());
    root.appendChild(bodyRow());
    if (st.phase === 'reveal' && st.result) root.appendChild(revealOverlay());
    if (st.meet) root.appendChild(meetOverlay());
    if (navKey && st.phase === 'select') {
      const again = root.querySelector(`[data-nav="${navKey.replace(':', '\\3a ')}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  }

  function nav(el, r, c) {
    el.dataset.nav = `${r}:${c}`;
    (navGrid[r] ||= [])[c] = el;
    return el;
  }

  // ── Boreg introduces himself as an AI ──────────────────────────────────────
  // Once, ever. Short, in character, and concrete: he does not define "machine
  // learning", he explains what HE does — which is the same thing every AI the
  // child will meet does. The word פרומפט is named here and never dropped again.
  function meetOverlay() {
    pushModal('meet');
    const go = h('button.btn', {
      type: 'button',
      onclick: () => { popModal('meet'); st.meet = false; markBoregIntroSeen(); render(); },
    }, t('garage.meet.go'));
    // `grg-meet-scrim` is what the end-to-end gate looks for when it dismisses
    // one-time modals; it was checking for a class that did not exist.
    return h('div.grg-scrim.grg-meet-scrim', null,
      h('div.panel-lift.grg-meet.pop-in', null,
        h('div.grg-meet-top', null,
          h('div.grg-face.big', null, h('div.grg-antenna')),
          h('div', null,
            h('div.grg-kicker', null, t('garage.meet.kicker')),
            h('div.display.grg-meet-title', null, t('garage.meet.title')))),
        h('div.grg-meet-p', null, t('garage.meet.1')),
        h('div.grg-meet-p', null, t('garage.meet.2')),
        h('div.grg-meet-p', null, t('garage.meet.3')),
        h('div.grg-meet-word', null, t('garage.meet.word')),
        h('div.grg-meet-actions', null, go)));
  }

  function topBar() {
    return h('header.grg-top',
      null,
      h('div',
        null,
        h('div.grg-kicker', null, t(freePlay ? 'garage.freeplay.kicker' : 'garage.kicker')),
        h('div.display.grg-title', null, t('garage.title'))),
      freePlay
        ? h('div.grg-visit.practice', null, t('garage.freeplay.chip'))
        : h('div.grg-visit', null, t('garage.visit', { n: num(visit) })),
      h('div.grg-spacer'),
      h('div.grg-budgetnote', null, t(freePlay ? 'garage.freeplay.note'
        : budget >= MAX_COST ? 'garage.budget.plenty' : 'garage.budget.note')),
      h('div.panel.grg-budget',
        null,
        h('div.grg-coin'),
        h('div', null,
          h('div.grg-sub', null, t('garage.left')),
          freePlay
            ? h('div.display.grg-bignum', { style: { fontSize: '20px' } }, '∞')
            : h('div.display.grg-bignum.num', null, num(remaining()))),
        h('div', { style: { width: '1px', height: '28px', background: 'var(--stroke-hi)' } }),
        h('div', null,
          h('div.grg-sub', null, t('garage.budget')),
          h('div' + (freePlay ? '' : '.num'), { style: { fontSize: '18px', color: 'var(--txt-dim)', fontWeight: '900' } },
            freePlay ? t('garage.freeplay.unlimited') : num(budget)))));
  }

  function bodyRow() {
    return h('div.grg-body', null, mainCol(), sideCol());
  }

  function mainCol() {
    return h('div.grg-main',
      null,
      boregLine(),
      sentenceBoard(),
      st.expert ? expertBox() : slotList(),
      // The four ideas of a good prompt, kept on screen the whole time. In
      // guided mode this also fills the band the one-row-at-a-time reveal used
      // to leave empty at the bottom of the board.
      st.expert ? null : recipeStrip(),
      expertBar());
  }

  function recipeStrip() {
    return h('div.panel.grg-recipe.strip', null,
      h('div.label', { style: { color: 'var(--gold-1)', flex: 'none' } }, t('garage.recipe.label')),
      h('div.grg-recipe-row', null,
        ...['what', 'when', 'limit', 'look'].map((k, i) =>
          h('span.grg-recipe-chip', null, num(i + 1) + '. ' + t('garage.recipe.' + k)))));
  }

  function boregLine() {
    return h('div.panel.grg-boreg',
      null,
      h('div.grg-face', null, h('div.grg-antenna')),
      h('div', null,
        h('div.label', null, t('garage.boreg')),
        h('div.grg-boreg-line', null,
          st.phase === 'building' ? t('garage.building')
            : freePlay ? t('garage.freeplay.intro')
              : t(`garage.intro.${visit}`))));
  }

  /** The live sentence. `nowSlot` gets a lit-up blank so the eye knows where it is. */
  function sentenceNode(sel, opt = {}) {
    const parts = sentenceParts(sel, lang);
    const txt = h('div' + (opt.recap ? '' : '.grg-sentence-txt'));
    let first = true;
    for (const p of parts) {
      // Punctuation hugs the word before it — no leading space, or Hebrew reads
      // as "…מסיבוב ," instead of "…מסיבוב,".
      if (p.punct) { txt.appendChild(document.createTextNode(p.text)); continue; }
      if (!first) txt.appendChild(document.createTextNode(' '));
      first = false;
      if (!p.filled) {
        txt.appendChild(h('span.grg-blank' + (p.slot === opt.nowSlot ? '.now' : ''), null, p.text));
      } else if (opt.recap) {
        // In the recap, the fragments the player paid for are the ones lit up.
        txt.appendChild(p.spec >= 2 ? h('span.hi', null, p.text) : h('span', null, p.text));
      } else {
        txt.appendChild(h('span.grg-w' + (p.lead ? '.lead' : '.grg-fill'), null, p.text));
      }
    }
    return txt;
  }

  function sentenceBoard() {
    const nowSlot = SLOTS[activeIndex()]?.key;
    return h('div.grg-sentence',
      null,
      h('div.row', { style: { justifyContent: 'space-between', marginBottom: '5px' } },
        h('div.label', { style: { color: 'var(--gold-1)' } }, t('garage.sentence.label')),
        h('div.grg-sub', null, t('garage.sentence.hint'))),
      st.expert
        ? h('div.grg-sentence-txt', null, st.freeText || t('garage.expert.ph'))
        : sentenceNode(st.sel, { nowSlot: st.phase === 'select' ? nowSlot : null }));
  }

  // ── the four steps ─────────────────────────────────────────────────────────
  // One expanded row at a time. Answered rows collapse into a single line that
  // still says what was chosen, and re-opens with one click.
  function slotList() {
    const wrap = h('div.grg-steps');
    const active = activeIndex();
    SLOTS.forEach((slot, i) => {
      if (i === active) wrap.appendChild(activeStep(slot, i));
      else if (st.sel[slot.key]) wrap.appendChild(doneStep(slot, i));
      else wrap.appendChild(todoStep(slot, i));
    });
    return wrap;
  }

  function stepHead(slot, i) {
    return h('div.grg-step-head', null,
      h('div.grg-n.num', null, num(i + 1)),
      h('div.grg-slot-title', null, lang === 'en' ? slot.en : slot.he),
      h('div.grg-slot-teach', null, pick(slot, 'teach')));
  }

  function activeStep(slot, i) {
    const opts = h('div.grg-opts');
    slot.options.forEach((o, j) => {
      const chosen = st.sel[slot.key] === o.id;
      const can = affordable(slot.key, o);
      const btn = h('button.grg-opt' + (can ? '' : '.locked'), {
        type: 'button',
        'aria-pressed': chosen ? 'true' : 'false',
        disabled: can ? null : true,
        onclick: () => choose(slot.key, o),
      },
      h('div.grg-opt-head', null, h('div.grg-opt-he', null, pickLabel(o))),
      h('div.grg-opt-body', null,
        h('div.grg-opt-sub', null, pick(o, 'sub')),
        h('div.grg-opt-frag', null,
          h('span.grg-opt-fragl', null, t('garage.frag')),
          pick(o, 'sentenceFragment')),
        o.cost > 0
          ? h('div.grg-cost', null, h('i'), h('span.num', null, num(o.cost)))
          : h('div.grg-cost.free', null, t('garage.free'))));
      opts.appendChild(nav(btn, i, j));
    });
    return h('div.grg-step.active' + hueClass(slot.hue), null, stepHead(slot, i), opts);
  }

  function doneStep(slot, i) {
    const o = optionById(slot.key, st.sel[slot.key]);
    const change = h('button.grg-change', {
      type: 'button', onclick: () => clearSlot(slot.key),
    }, t('garage.step.change'));
    return h('div.grg-step.done' + hueClass(slot.hue), null,
      h('div.grg-n.num', null, num(i + 1)),
      h('div.grg-done-title', null, lang === 'en' ? slot.en : slot.he),
      h('div.grg-done-pick', null, pickLabel(o)),
      o.cost > 0
        ? h('div.grg-cost', { style: { marginBlockStart: '0' } }, h('i'), h('span.num', null, num(o.cost)))
        : h('div.grg-cost.free', { style: { marginBlockStart: '0' } }, t('garage.free')),
      nav(change, i, 0));
  }

  function todoStep(slot, i) {
    return h('div.grg-step.todo' + hueClass(slot.hue), null,
      h('div.grg-n.num', null, num(i + 1)),
      h('div.grg-done-title', null, lang === 'en' ? slot.en : slot.he),
      h('div.grg-todo-tag', null, t('garage.step.next')));
  }

  // `pick` needs an `He`/`En` suffix; option label fields are plain he/en.
  function pickLabel(o) { return o ? (lang === 'en' ? o.en : o.he) : ''; }

  function expertBar() {
    const toggle = h('button.grg-toggle', {
      type: 'button',
      'aria-pressed': st.expert ? 'true' : 'false',
      onclick: () => {
        st.expert = !st.expert;
        if (st.expert) st.activeTip = 'expert.intro';
        render();
      },
    }, h('span.grg-sw'), h('span', null, t('garage.expert.toggle')));
    return h('div.grg-expertbar',
      null,
      nav(toggle, 4, 0),
      h('span.grg-badge', null, t('garage.expert.badge')),
      h('span.grg-bonus', null, t('garage.expert.bonus')));
  }

  function expertBox() {
    const r = liveResult();
    const ta = h('textarea.grg-ta', {
      placeholder: t('garage.expert.ph'),
      'aria-label': t('garage.expert.label'),
      oninput: e => { st.freeText = e.target.value; syncExpert(); },
    });
    ta.value = st.freeText;
    const checkRow = h('div.grg-checks');
    const CH = ['concrete', 'numbers', 'constraint', 'style', 'length', 'filler'];
    for (const c of CH) {
      checkRow.appendChild(h('span.grg-chk' + (r.checks[c] ? '.ok' : ''), { 'data-chk': c },
        t('garage.expert.check.' + c)));
    }
    const partRow = h('div.grg-opts.compact');
    SLOTS[0].options.forEach((o, j) => {
      const btn = h('button.grg-opt', {
        type: 'button',
        'aria-pressed': st.sel.part === o.id ? 'true' : 'false',
        onclick: () => { st.sel.part = o.id; render(); },
      }, h('div.grg-opt-head', null, h('div.grg-opt-he', null, pickLabel(o))));
      partRow.appendChild(nav(btn, 0, j));
    });
    // Expert mode still needs to know WHICH part is being built.
    return h('div.grg-steps',
      null,
      h('div.grg-step.grg-hue-part', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        stepHead(SLOTS[0], 0),
        partRow),
      h('div.panel.grg-expertbox', null,
        h('div.label', null, t('garage.expert.label')),
        nav(ta, 1, 0),
        checkRow),
      // The same four ideas the guided slots teach, kept visible as a reminder.
      h('div.panel.grg-recipe', null,
        h('div.label', { style: { color: 'var(--gold-1)' } }, t('garage.recipe.label')),
        h('div.grg-recipe-row', null,
          ...['what', 'when', 'limit', 'look'].map((k, i) =>
            h('span.grg-recipe-chip', null, num(i + 1) + '. ' + t('garage.recipe.' + k))))));
  }

  function syncExpert() {
    // Cheap partial update so typing does not rebuild (and blur) the textarea.
    const r = liveResult();
    root.querySelectorAll('[data-chk]').forEach(el => {
      el.classList.toggle('ok', !!r.checks[el.dataset.chk]);
    });
    const sen = root.querySelector('.grg-sentence .grg-sentence-txt');
    if (sen) sen.textContent = st.freeText || t('garage.expert.ph');
    paintStats(r);
    paintBuildBtn(r);
  }

  function sideCol() {
    // No caption. A real kart mounts here via setKartPreviewMounter(), so the
    // old "כאן ייכנס הקארט" tag was a build note sitting on top of the finished
    // thing it was a note about.
    kartWindow = h('div.panel.grg-kart');
    return h('aside.grg-side', null, kartWindow, statsPanel(), tipCard(), buildRow());
  }

  let statNodes = {}, qualNodes = {};
  function statsPanel() {
    const r = liveResult();
    statNodes = {};
    const rows = STAT_KEYS.map(k => {
      const cur = h('span.grg-cur'), up = h('span.grg-up'), dn = h('span.grg-dn');
      const val = h('span.grg-statval.num');
      const delta = h('span.grg-delta');
      statNodes[k] = { cur, up, dn, val, delta };
      return h('div.grg-statrow', null,
        h('div.grg-statname', null, t('garage.stat.' + k)),
        h('div.grg-track', null, cur, up, dn),
        val, delta);
    });
    const qi = h('i');
    const qv = h('span.num.display', { style: { fontSize: '22px' } });
    qualNodes = { qi, qv };
    const panel = h('div.panel.grg-panel-pad.col', { style: { gap: '8px' } },
      h('div.row', { style: { justifyContent: 'space-between' } },
        h('div.label', null, t('garage.stats.label')),
        h('div.grg-sub', null, t('garage.stat.weight') + ': ' + t('garage.stat.weightNote'))),
      ...rows,
      h('div.grg-quality', null,
        h('div.label', { style: { color: 'var(--gold-1)' } }, t('garage.quality')),
        h('div.grg-qbar', null, qi), qv));
    paintStats(r);
    return panel;
  }

  function paintStats(r) {
    for (const k of STAT_KEYS) {
      const n = statNodes[k]; if (!n) continue;
      const base = BASE_STATS[k];
      const next = clamp(base + (r.deltas[k] || 0), 0, 100);
      const lo = Math.min(base, next), hi = Math.max(base, next);
      const gained = LOWER_IS_BETTER[k] ? next < base : next > base;
      n.cur.style.width = lo + '%';
      n.up.style.width = (gained ? hi - lo : 0) + '%';
      n.dn.style.width = (!gained && hi > lo ? hi - lo : 0) + '%';
      // When lower is better and we improved, the shrunken part reads as a
      // green "recovered" segment sitting after the current fill.
      if (LOWER_IS_BETTER[k] && gained) { n.cur.style.width = next + '%'; n.up.style.width = (base - next) + '%'; }
      n.val.textContent = num(next);
      const d = r.deltas[k] || 0;
      const good = LOWER_IS_BETTER[k] ? d < 0 : d > 0;
      n.delta.className = 'grg-delta ' + (d === 0 ? 'zero' : good ? 'good' : 'bad');
      n.delta.textContent = d === 0 ? '—' : num((d > 0 ? '+' : '') + d);
    }
    if (qualNodes.qi) qualNodes.qi.style.width = r.score + '%';
    if (qualNodes.qv) qualNodes.qv.textContent = num(r.score);
  }

  // Tip bodies are templates; the fragments come from the ACTUAL deltas and the
  // ACTUAL chosen options, so a card can never describe something that did not
  // happen. See tips.js → makeTipVars().
  function tipParts(tip, result) {
    const vars = makeTipVars(st.sel, result?.deltas || {}, lang);
    return { title: tipTitle(tip, lang), body: tipBody(tip, lang, vars) };
  }

  function tipCard() {
    const tip = tipById(st.activeTip);
    if (!tip) {
      return h('div.panel.grg-tip', { style: { opacity: '.72' } },
        h('div.grg-tip-label', null, t('garage.tip.label')),
        h('div.grg-tip-body', null, t('garage.tip.waiting')));
    }
    const p = tipParts(tip, st.result || liveResult());
    return h('div.panel-lift.grg-tip.pop-in',
      null,
      h('div.grg-tip-label', null, t('garage.tip.label')),
      h('div.grg-tip-title', null, p.title),
      h('div.grg-tip-body', null, p.body));
  }

  let buildBtn = null;
  function buildRow() {
    const r = liveResult();
    buildBtn = h('button.btn.grg-build', {
      type: 'button',
      onclick: startBuild,
    }, r.complete ? t('garage.build') : t('garage.buildBlocked'));
    paintBuildBtn(r);
    return h('div', null, nav(buildBtn, 4, 1));
  }

  function paintBuildBtn(r) {
    if (!buildBtn) return;
    buildBtn.textContent = st.phase === 'building' ? t('garage.building')
      : r.complete ? t('garage.build') : t('garage.buildBlocked');
    buildBtn.disabled = !r.complete || st.phase !== 'select';
    buildBtn.style.opacity = r.complete ? '1' : '.45';
  }

  /** ●●○ meters, shown ONLY here: after the fact, as an explanation. */
  function specChips(r) {
    const row = h('div.grg-specrow');
    for (const slot of SLOTS) {
      if (!slot.scored) continue;
      const n = r.specs?.[slot.key] || 0;
      row.appendChild(h('div.grg-specchip', null,
        h('div.grg-dots', null, [0, 1, 2].map(d => h('span.grg-dot' + (d < n ? '.lit' : '')))),
        h('span', null, pick(slot, 'axis'))));
    }
    return row;
  }

  // ── THE DEBRIEF ────────────────────────────────────────────────────────────
  // One row per scored slot, each naming the prompting idea that slot carries:
  //   goal       → specificity
  //   constraint → a limit makes the output BETTER (the counter-intuitive one)
  //   style      → context and style shape the output
  //
  // Every sentence is chosen by the specificity the child ACTUALLY picked, quotes
  // the option they ACTUALLY chose, and the points chip is read straight out of
  // scorePrompt()'s own breakdown. Nothing here can claim an outcome the game did
  // not compute.
  const DEBRIEF_HUE = { goal: 'goal', constraint: 'limit', style: 'style' };

  function debriefRows(r) {
    const b = r.breakdown || {};
    if (st.expert) {
      return [
        { slot: 'goal', n: 2, principle: t('garage.debrief.p.goal'),
          text: t('garage.debrief.x.concrete.' + (r.checks?.concrete ? 'on' : 'off')),
          pts: (b.concrete || 0) + (b.numbers || 0) + (b.length || 0) },
        { slot: 'constraint', n: 3, principle: t('garage.debrief.p.limit'),
          text: t('garage.debrief.x.limit.' + (r.checks?.constraint ? 'on' : 'off')),
          pts: b.constraint || 0 },
        { slot: 'style', n: 4, principle: t('garage.debrief.p.style'),
          text: t('garage.debrief.x.style.' + (r.checks?.style ? 'on' : 'off')),
          pts: b.style || 0 },
      ];
    }
    // {gain}/{loss} are read out of the deltas the child is looking at right
    // now, and the "and it cost you…" clause only appears when something really
    // did get worse — see tips.js for the same rule.
    const vars = makeTipVars(st.sel, r.deltas || {}, lang);
    vars.cost = t(vars.loss ? 'garage.debrief.cost.some' : 'garage.debrief.cost.none', { loss: vars.loss });
    const g = r.specs?.goal || 0;
    const c = r.specs?.constraint || 0;
    const s = r.specs?.style || 0;
    let limitText = t(`garage.debrief.limit.${Math.min(2, c)}`, vars);
    if (b.coherenceBonus) limitText += ' ' + t('garage.debrief.limit.coherent');
    return [
      { slot: 'goal', n: 2, principle: t('garage.debrief.p.goal'),
        text: t(`garage.debrief.goal.${Math.min(2, g)}`, vars), pts: b.goal || 0 },
      { slot: 'constraint', n: 3, principle: t('garage.debrief.p.limit'),
        text: limitText,
        pts: (b.constraint || 0) + (b.constraintBonus || 0) + (b.coherenceBonus || 0) },
      { slot: 'style', n: 4, principle: t('garage.debrief.p.style'),
        text: t(`garage.debrief.style.${Math.min(1, s)}`, vars), pts: b.style || 0 },
    ];
  }

  function debriefPanel(r) {
    const wrap = h('div.grg-debrief');
    for (const row of debriefRows(r)) {
      wrap.appendChild(h('div.grg-dbrow' + hueClass(DEBRIEF_HUE[row.slot]), null,
        h('div.grg-dbicon.num', null, num(row.n)),
        h('div.grg-dbmain', null,
          h('div.grg-dbp', null, row.principle),
          h('div.grg-dbtxt', null, row.text)),
        h('div.grg-dbpts' + (row.pts > 0 ? '' : '.zero'), null,
          row.pts > 0 ? t('garage.debrief.pts', { n: num(row.pts) }) : t('garage.debrief.pts0'))));
    }
    return wrap;
  }

  // ── The ghost card ─────────────────────────────────────────────────────────
  // The vaguest legal version of the SAME prompt, scored by the same function —
  // so the side-by-side is a real comparison, not an illustration. If the child
  // already picked the vague path there is nothing worse to show them, so it
  // flips into an invitation: the sharpest prompt those same tokens could have
  // bought.
  function ghostFor(r) {
    const vagueSel = vaguestSelection(st.sel);
    const vagueRes = scorePrompt(vagueSel, ctx());
    if (vagueRes.score < r.score) return { res: vagueRes, invite: false };
    const betterSel = bestAffordable(st.sel, budget, s => scorePrompt(s, ctx()).score);
    return { res: scorePrompt(betterSel, ctx()), invite: true };
  }

  function miniStat(k, d) {
    const good = LOWER_IS_BETTER[k] ? d < 0 : d > 0;
    return h('span.grg-ministat.' + (d === 0 ? 'zero' : good ? 'good' : 'bad'), null,
      h('span', null, t('garage.stat.' + k)),
      h('b.num', null, d === 0 ? '—' : num((d > 0 ? '+' : '') + d)));
  }

  function partCard(res, o = {}) {
    return h('div.grg-partcard' + (o.ghost ? '.ghost' : ''), null,
      h(o.ghost ? 'div.grg-ghosthead' : 'div.label', null,
        o.ghost ? o.title : t('garage.reveal.title')),
      h('div.grg-tierbadge' + (o.ghost ? '.dim' : ''), null, t('garage.tier.' + res.tier)),
      h('div.display.grg-partname', null, partName(res.slotKey, res.tier, lang)),
      !o.ghost && h('div.grg-flavour', null, t(res.flavourKeyHe)),
      h('div.grg-mini', null, ...STAT_KEYS.map(k => miniStat(k, res.deltas[k] || 0))),
      o.ghost && h('div.grg-ghostnote', null, o.note));
  }

  function revealOverlay() {
    const r = st.result;
    const gain = tokenReward(r.score, st.expert);
    const ghost = ghostFor(r);
    // The caller needs BOTH halves of the transaction: what the prompt cost and
    // what the build paid. Reporting only `gain` is how the token economy ended
    // up running backwards (see scenes.js onDone).
    const install = h('button.btn', {
      type: 'button',
      onclick: () => opts.onDone?.({ ...r, selection: { ...st.sel }, cost: spent() }, gain),
    }, t('garage.reveal.install'));
    const again = h('button.btn' + (freePlay ? '' : '.ghost'), {
      type: 'button',
      onclick: () => { st.phase = 'select'; st.result = null; render(); },
    }, t(freePlay ? 'garage.freeplay.again' : 'garage.reveal.again'));
    // Free play commits nothing to the championship: no install, just rebuild or
    // leave.
    const exit = h('button.btn.ghost', {
      type: 'button', onclick: () => opts.onExit?.(),
    }, t('garage.freeplay.exit'));
    const recap = st.expert
      ? h('div.grg-recap', null, st.freeText)
      : h('div.grg-recap', null, sentenceNode(st.sel, { recap: true }));
    return h('div.grg-scrim',
      null,
      h('div.panel-lift.grg-reveal.pop-in',
        null,
        h('div.grg-rev-scroll', null,
          // Cause first, then effect. The prompt is reprinted here because the
          // modal covers the board, and this is the exact moment the link matters.
          h('div.label', null, t('garage.reveal.ask')),
          recap,
          specChips(r),
          // The thing they received, and — dimmed beside it — the thing a
          // different prompt would have handed them instead.
          h('div.grg-cardrow', null,
            partCard(r),
            partCard(ghost.res, {
              ghost: true,
              title: t(ghost.invite ? 'garage.ghost.invite' : 'garage.ghost.title'),
              note: t(ghost.invite ? 'garage.ghost.noteInvite' : 'garage.ghost.note'),
            })),
          h('div.label', null, t('garage.debrief.title')),
          debriefPanel(r)),
        h('div.grg-revactions', null,
          ...(freePlay ? [again, exit] : [install, again]),
          !freePlay && h('div.grg-tokgain', null, h('div.grg-coin'),
            t('garage.reveal.tokens', { n: num(gain) })))));
  }

  // ── keyboard ───────────────────────────────────────────────────────────────
  function onKey(e) {
    if (st.meet && (e.key === 'Escape' || e.key === 'Enter')) {
      st.meet = false; markBoregIntroSeen(); render(); e.preventDefault(); return;
    }
    if (st.phase === 'reveal' && e.key === 'Escape') {
      st.phase = 'select'; st.result = null; render(); e.preventDefault(); return;
    }
    const el = document.activeElement;
    if (e.target?.tagName === 'TEXTAREA') return;
    const pos = el?.dataset?.nav;
    if (!pos) return;
    let [r, c] = pos.split(':').map(Number);
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    let moved = true;
    if (e.key === 'ArrowDown') r++;
    else if (e.key === 'ArrowUp') r--;
    else if (e.key === fwd) c++;
    else if (e.key === back) c--;
    else moved = false;
    if (!moved) return;
    e.preventDefault();
    const rows = navGrid.filter(Boolean);
    r = clamp(r, 0, navGrid.length - 1);
    while (r >= 0 && r < navGrid.length && !navGrid[r]) r += (e.key === 'ArrowUp' ? -1 : 1);
    const row = navGrid[r] || navGrid[navGrid.length - 1];
    if (!row || !rows.length) return;
    const target = row[clamp(c, 0, row.length - 1)] || row[0];
    target?.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', onKey);

  // ── kart window placement ──────────────────────────────────────────────────
  // Project the DOM preview window's centre into world space so the kart sits
  // exactly inside it at any aspect ratio.
  function layoutKart() {
    if (!kartWindow) return;
    const w = engine.width || innerWidth, hgt = engine.height || innerHeight;
    const rect = kartWindow.getBoundingClientRect();
    if (!rect.width) return;
    const nx = ((rect.left + rect.width / 2) / w) * 2 - 1;
    const ny = -(((rect.top + rect.height / 2) / hgt) * 2 - 1);
    const halfH = Math.tan((camera.fov / 2) * Math.PI / 180) * CAM_D;
    const halfW = halfH * (camera.aspect || w / hgt);
    // world units per screen pixel at the kart's depth
    const perPx = (halfH * 2) / hgt;
    // The kart occupies roughly KART_W × KART_H world units once it spins;
    // fit it inside the window on BOTH axes so it never spills onto the panels.
    const KART_H = 1.6, KART_W = 2.6;
    const fit = clamp(Math.min(
      (rect.height * 0.52 * perPx) / KART_H,
      (rect.width * 0.64 * perPx) / KART_W,
    ), 0.2, 1.2);
    kartAnchor.scale.setScalar(fit);
    kartAnchor.position.set(nx * halfW, CAM_Y + ny * halfH - 0.42 * fit, 0);
  }

  // opts.phase === 'reveal' jumps straight to the reveal moment (used by the
  // previews and by "show me what I built" deep links).
  if (opts.phase === 'reveal') {
    st.result = liveResult();
    if (st.result.complete) {
      st.phase = 'reveal';
      if (!st.activeTip && st.result.tips.length) st.activeTip = st.result.tips[0];
      kartApi?.setPart?.(st.result.slotKey, st.result.visualTier);
    }
  }

  render();

  let time = 0;
  return {
    scene, camera,
    update(dt) {
      time += dt;
      layoutKart();
      kartApi?.update?.(dt, time);
      if (st.phase === 'building') {
        st.buildTimer += dt;
        if (st.buildTimer >= 1.1) finishBuild();
      }
    },
    resize(w, hgt) {
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
      layoutKart();
    },
    enter() { layoutKart(); },
    dispose() {
      popModal('meet');            // never leave a phantom behind a torn-down scene
      document.removeEventListener('keydown', onKey);
      root.remove();
      document.getElementById('grg-style')?.remove();
      kartApi?.dispose?.();
      bgTex.dispose(); floorGeo.dispose(); floorMat.dispose();
      scene.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    },
    // exposed for the lead / tests
    _state: st,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FREE PLAY — "המוסך של בורג" on the home menu.
//
// Register it as its own scene, so nothing about the championship is involved:
//
//   engine.register('freeplay', (e, o = {}) =>
//     freePlayScene(e, { ...o, onExit: () => e.goto('menu') }));
//
// Tokens are unlimited, no `onDone` is called, and nothing is written to save.js
// except the two one-time teaching flags. `onExit` is the only seam it needs.
// ─────────────────────────────────────────────────────────────────────────────
export function freePlayScene(engine, opts = {}) {
  return garageScene(engine, { ...opts, freePlay: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Previews
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: the previews forward the harness's opts (it passes `lang`/`quality`
// through engine.goto) on top of their own setup.
export function preview(engine, o = {}) {
  return garageScene(engine, {
    visit: 2,
    meet: false,
    selection: { part: 'engine', goal: 'accel-corner', constraint: null, style: null },
    tip: 'spec.when-where',
    ...o,
  });
}

export function previewReveal(engine, o = {}) {
  return garageScene(engine, {
    visit: 2,
    meet: false,
    phase: 'reveal',
    selection: { part: 'tires', goal: 'accel-brake', constraint: 'light', style: 'desert' },
    ...o,
  });
}

/** The debrief after a deliberately vague prompt — the invitation branch. */
export function previewRevealVague(engine, o = {}) {
  return garageScene(engine, {
    visit: 1,
    meet: false,
    phase: 'reveal',
    selection: { part: 'engine', goal: 'good', constraint: 'none', style: 'any' },
    ...o,
  });
}

/** Boreg's one-time "I am an AI" introduction. */
export function previewIntro(engine, o = {}) {
  return garageScene(engine, {
    visit: 1,
    meet: true,
    selection: { part: null, goal: null, constraint: null, style: null },
    ...o,
  });
}

/** The free-play sandbox, reachable from the home menu. */
export function previewFreePlay(engine, o = {}) {
  return garageScene(engine, {
    freePlay: true,
    meet: false,
    selection: { part: 'chassis', goal: 'accel-brake', constraint: null, style: null },
    tip: 'constraint.first',
    ...o,
  });
}

/** The debrief after a free-text (expert-mode) prompt. */
export function previewExpertReveal(engine, o = {}) {
  return garageScene(engine, {
    visit: 3,
    meet: false,
    expert: true,
    phase: 'reveal',
    selection: { part: 'engine', goal: null, constraint: null, style: null },
    freeText: 'בורג, תחזק לי את המנוע ליציאה מסיבוב, בלי להוסיף יותר מ‎2 ק"ג משקל, ובצבע כתום מאובק',
    ...o,
  });
}

/** The one-time first-token popup, over the garage it explains. */
export function previewTokenPopup(engine, o = {}) {
  const sc = garageScene(engine, {
    visit: 1,
    meet: false,
    selection: { part: 'engine', goal: null, constraint: null, style: null },
    ...o,
  });
  const pop = firstTokenPopup({ persist: false });
  engine.ui.appendChild(pop);
  const dispose = sc.dispose;
  sc.dispose = () => { pop.close(); dispose(); };
  return sc;
}

export function previewExpert(engine, o = {}) {
  return garageScene(engine, {
    visit: 3,
    expert: true,
    selection: { part: 'engine', goal: null, constraint: null, style: null },
    freeText: 'בורג, תחזק לי את המנוע ליציאה מסיבוב, בלי להוסיף יותר מ‎2 ק"ג משקל, ובצבע כתום מאובק',
    tip: 'expert.intro',
    ...o,
  });
}

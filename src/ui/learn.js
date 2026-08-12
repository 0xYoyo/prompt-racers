// LEARN — the three screens that carry the educational weight, plus the AI facts
// shown during loading and between races.
//
//   1. howBuiltOverlay()    "איך נבנה המשחק הזה?" — this game was vibe-coded, and
//                           here are three concrete, true beats from building it.
//   2. certificateOverlay() "תעודת פרומפטר" — the end-of-championship award. Names
//                           what was learned and quotes the player's own best prompt.
//   3. AI facts             ~15 one-line true facts, exported for any transition.
//
// Rules these screens follow, same as the garage tips:
//   • One idea per card, 1–3 sentences, no jargon, no lecturing.
//   • Hebrew is gender-neutral: impersonal present ("בוחרים", "כדאי") and plural,
//     never a masculine imperative and never "אתה".
//   • Nothing is claimed that the game did not do. The build beats below are real
//     events from this repository's history (see DECISIONS.md, core/input.js).
//   • NO PERSONAL DATA. This is the contest-disqualifying rule, and the
//     certificate is the one screen where a designer's instinct says "ask for a
//     name". It never does. The identity on the certificate is the ROSTER RACER
//     the child chose (ניצוץ, זוזי, פלדה…) — an identity the game already owns —
//     and the fun title is picked from a fixed preset list, stored as an ID.
//     There is no <input>, no <textarea>, no contenteditable anywhere in here,
//     and tests/certificate.test.mjs fails loudly if one ever appears.
//   • The certificate CAN be downloaded (Wave 4, item 15), as a PNG drawn by
//     this file into a <canvas> and handed to the child through a blob: URL.
//     No library, no server, no network — it works from a file:// page, which is
//     how the deliverable is actually opened.
import { h } from './style.js';
import { registerStrings, t, num, getLang } from './i18n.js';
import { save } from '../core/save.js';
import { byId as racerById, racerNumber, ROSTER } from '../kart/roster.js';
import { ICONS, BADGE_STRINGS, BADGE_IDS, badgeById } from '../core/badges.js';
import { overlayRoot, appendAll, backdropScene } from './menus.js';

/* ═════════════════════════════════════════════════════════════════ strings ══ */

registerStrings({
  he: {
    /* ---- how this game was built ---- */
    'learn.built.title': 'איך נבנה המשחק הזה?',
    'learn.built.lede': 'את המשחק הזה אף אחד לא הקליד שורה־שורה. מישהו כתב פרומפטים — בקשות במילים רגילות — ובינה מלאכותית כתבה את הקוד. בדיוק כמו במוסך של בורג: פרומפט מעורפל מחזיר משהו מוזר, פרומפט מדויק מחזיר משהו שעובד.',
    'learn.built.b1.t': 'היריבים נסעו זיגזג',
    'learn.built.b1.b': `הפרומפט הראשון היה "שהיריבים יסעו יפה במסלול". הם נסעו זיגזג וסיימו הקפה ב־${num(100)} שניות. הפרומפט הבא אמר בדיוק איפה לחתוך כל סיבוב — ומאז הם נוסעים בקו אחד.`,
    'learn.built.b2.t': 'אין כאן אף תמונה',
    'learn.built.b2.b': 'כל מה שרואים מצויר בקוד תוך כדי משחק: השמיים, גרגרי החול שבאספלט, הצמיגים, המטבעות. אפס קבצי תמונה, אפס קבצי צליל. הכול נוסחאות שרצות עכשיו.',
    'learn.built.b3.t': 'ורגע אחד נסעו אחורה',
    'learn.built.b3.b': 'בגרסה אחת חץ ימינה סיבב שמאלה, כי לסימולציה בפנים יש כיוון משלה. התיקון היה מספר אחד — מינוס — בשורה אחת בדיוק. גם ככה זה נראה, וזה בסדר גמור.',
    'learn.built.cta.t': 'גם ככה אפשר לבנות',
    'learn.built.cta.b': 'לא צריך לדעת לתכנת כדי להתחיל. בוחרים רעיון קטן, מתארים אותו במילים מדויקות, מסתכלים מה יצא, ומתקנים בסבבים עד שזה עובד. זה כל הסוד — וזה בדיוק מה שמתאמנים עליו כאן בכל ביקור במוסך.',
    'learn.built.close': 'מגניב, קדימה',

    /* ---- certificate ---- */
    'learn.cert.badge': 'תעודה',
    'learn.cert.title': 'תעודת פרומפטר',
    'learn.cert.awarded': 'מוענקת לצוות של',
    'learn.cert.champ': 'אליפות מס׳ {n}',
    'learn.cert.meta': '{races} מרוצים · {points} נקודות · מקום {place}',
    'learn.cert.learned': 'מה שנלמד בדרך',
    'learn.cert.l1.t': 'דיוק',
    'learn.cert.l1.b': 'לכתוב מה בדיוק, איפה ומתי',
    'learn.cert.l2.t': 'מגבלות',
    'learn.cert.l2.b': 'להגיד גם מה אסור לשבור',
    'learn.cert.l3.t': 'סגנון והקשר',
    'learn.cert.l3.b': 'להסביר בשביל מי ובשביל מה',
    'learn.cert.l4.t': 'סבבים',
    'learn.cert.l4.b': 'לבדוק, לתקן ולבקש שוב',
    'learn.cert.best': 'הפרומפט הכי חזק שנכתב כאן',
    // Same name the garage gives this exact number ('garage.quality'), so the
    // certificate quotes a measure the child has already watched move.
    'learn.cert.score': 'איכות הפרומפט',
    'learn.cert.noBest': 'בביקור הבא במוסך, הפרומפט הכי חזק שנכתב יופיע בדיוק כאן.',
    'learn.cert.seal': 'מרוץ הפרומפטים',
    'learn.cert.foot': 'התעודה נשמרת רק במחשב הזה, בלי שם ובלי חשבון.',
    'learn.cert.close': 'סגירה',
    'learn.cert.menu': 'למסך הבית',

    /* ---- certificate: racer, title picker, badges, download (Wave 4) ---- */
    'learn.cert.racer': 'הדמות שנבחרה',
    'learn.cert.titlePick': 'תואר לתעודה — בוחרים אחד, או נשארים בלי',
    'learn.cert.titleNone': 'בלי תואר',
    // Presets only. Free text would be a personal-data entry point, which the
    // contest forbids — and every title is written in both grammatical genders
    // or in a gender-neutral form (D27), because half the players are girls.
    'learn.cert.t.champ': 'אלוף/ת הפרומפטים',
    'learn.cert.t.wordsmith': 'מהנדס/ת מילים',
    'learn.cert.t.drifter': 'אלוף/ת ההחלקות',
    'learn.cert.t.curious': 'ראש סקרן',
    'learn.cert.t.fixer': 'מתקן/ת בסבבים',
    'learn.cert.t.robotfriend': 'חבר/ה של רובוטים',
    'learn.cert.badges': 'תגים שנאספו',
    'learn.cert.badges.none': 'עוד לא נפתחו תגים. כל תג שייפתח יופיע כאן בתעודה הבאה.',
    'learn.cert.badges.more': 'ועוד {n}',
    'learn.cert.download': 'הורדה',
    'learn.cert.downloading': 'מציירים…',
    'learn.cert.downloaded': 'נשמר במחשב',
    'learn.cert.downloadFail': 'הדפדפן הזה לא מאפשר שמירה. אפשר לצלם מסך.',

    /* ---- did-you-know ---- */
    'learn.fact.title': 'הידעת?',
    'learn.fact.1': 'מודל שפה לא "יודע" עובדות — הוא מנחש איזו מילה הכי מתאימה לבוא עכשיו.',
    'learn.fact.2': 'אותה שאלה בדיוק יכולה לקבל תשובה אחרת בכל פעם, כי בבחירת המילה יש קצת אקראיות.',
    'learn.fact.3': 'טוקן הוא לא בהכרח מילה שלמה — לפעמים הוא חצי מילה, ולפעמים רק פסיק.',
    'learn.fact.4': 'תוכנה שמזהה חתולים בתמונות לא ראתה חתול מימיה. היא ראתה מיליוני מספרים.',
    'learn.fact.5': `מחשב ניצח אלוף שחמט כבר ב־${num(1997)}, ובמשחק גו — רק כמעט ${num(20)} שנה אחר כך.`,
    'learn.fact.6': 'כשמבקשים ממודל לפתור "צעד אחר צעד", הוא באמת טועה פחות.',
    'learn.fact.7': 'מספיק לפתוח פרומפט במילים "התפקיד שלך: מדריך טיולים" כדי לשנות את כל סגנון התשובה.',
    'learn.fact.8': 'מודל לא זוכר את השיחה של אתמול. מישהו צריך לשמור אותה ולצרף אותה מחדש.',
    'learn.fact.9': 'לפעמים מודל ממציא תשובה בביטחון מלא. קוראים לזה הזיה, וכדאי תמיד לבדוק.',
    'learn.fact.10': 'AI שמצייר תמונה מתחיל מרעש אקראי ומנקה אותו שוב ושוב, עד שמתגלה ציור.',
    'learn.fact.11': 'מודלים הופכים מילים למספרים. במרחב הזה "מלך" ו"מלכה" יושבות ממש קרוב זו לזו.',
    'learn.fact.12': 'אימון של מודל גדול לא רץ על מחשב אחד אלא על אלפי מעבדים שעובדים יחד חודשים.',
    'learn.fact.13': 'תרגום מכונה עבד פעם לפי מילון וכללים. היום הוא לומד ממיליוני זוגות משפטים.',
    'learn.fact.14': 'קול מלאכותי נבנה מאפס: המחשב מייצר את גל הקול עצמו, עשרות אלפי מספרים לכל שנייה.',
    'learn.fact.15': 'מודל שלומד רק מטקסטים באנגלית יהיה חלש בעברית — הוא טוב במה שראה הרבה ממנו.',
  },

  en: {
    'learn.built.title': 'How was this game built?',
    'learn.built.lede': 'Nobody typed this game out line by line. A person wrote prompts — asks, in plain words — and an AI wrote the code. Exactly like Boreg\'s garage: a vague prompt returns something strange, a precise prompt returns something that works.',
    'learn.built.b1.t': 'The rivals drove in zig-zags',
    'learn.built.b1.b': `The first prompt was "make the rivals drive nicely around the track". They zig-zagged, and a lap took them ${num(100)} seconds. The next prompt said exactly where to cut each corner — and they have driven one clean line ever since.`,
    'learn.built.b2.t': 'There is not one picture here',
    'learn.built.b2.b': 'Everything you see is drawn by code while you play: the sky, the grit in the asphalt, the tyres, the coins. Zero image files, zero sound files. All of it is formulas, running right now.',
    'learn.built.b3.t': 'And once they drove backwards',
    'learn.built.b3.b': 'In one version the right arrow turned left, because the simulation inside has a direction of its own. The fix was one number — a minus — on exactly one line. That is what building looks like, and it is completely fine.',
    'learn.built.cta.t': 'You can build this way too',
    'learn.built.cta.b': 'You do not need to know how to code to start. Pick a small idea, describe it in precise words, look at what came out, and fix it in rounds until it works. That is the whole secret — and it is exactly what every garage visit here practises.',
    'learn.built.close': 'Cool, let\'s go',

    'learn.cert.badge': 'Certificate',
    'learn.cert.title': 'Prompter Certificate',
    'learn.cert.awarded': 'Awarded to the crew of',
    'learn.cert.champ': 'Championship No. {n}',
    'learn.cert.meta': '{races} races · {points} points · {place} place',
    'learn.cert.learned': 'What was learned along the way',
    'learn.cert.l1.t': 'Precision',
    'learn.cert.l1.b': 'Say what exactly, where and when',
    'learn.cert.l2.t': 'Constraints',
    'learn.cert.l2.b': 'Say what must not break, too',
    'learn.cert.l3.t': 'Style & context',
    'learn.cert.l3.b': 'Explain who it is for and why',
    'learn.cert.l4.t': 'Iteration',
    'learn.cert.l4.b': 'Check it, fix it, ask again',
    'learn.cert.best': 'The strongest prompt written here',
    'learn.cert.score': 'Prompt quality',
    'learn.cert.noBest': 'Next garage visit, the strongest prompt written will show up right here.',
    'learn.cert.seal': 'Prompt Racers',
    'learn.cert.foot': 'This certificate is stored on this computer only — no name, no account.',
    'learn.cert.close': 'Close',
    'learn.cert.menu': 'Main Menu',

    'learn.cert.racer': 'The racer chosen',
    'learn.cert.titlePick': 'A title for the certificate — pick one, or stay without',
    'learn.cert.titleNone': 'No title',
    'learn.cert.t.champ': 'Prompt Champion',
    'learn.cert.t.wordsmith': 'Word Engineer',
    'learn.cert.t.drifter': 'Drift Ace',
    'learn.cert.t.curious': 'Curious Mind',
    'learn.cert.t.fixer': 'Round-by-Round Fixer',
    'learn.cert.t.robotfriend': 'Friend of Robots',
    'learn.cert.badges': 'Badges collected',
    'learn.cert.badges.none': 'No badges yet. Every badge earned will show up here on the next certificate.',
    'learn.cert.badges.more': 'and {n} more',
    'learn.cert.download': 'Download',
    'learn.cert.downloading': 'Drawing…',
    'learn.cert.downloaded': 'Saved to this computer',
    'learn.cert.downloadFail': 'This browser will not save the file. A screenshot works too.',

    'learn.fact.title': 'Did you know?',
    'learn.fact.1': 'A language model does not "know" facts — it guesses which word fits best next.',
    'learn.fact.2': 'The exact same question can get a different answer each time, because picking a word has some randomness in it.',
    'learn.fact.3': 'A token is not always a whole word — sometimes it is half a word, sometimes just a comma.',
    'learn.fact.4': 'Software that spots cats in photos has never seen a cat. It has seen millions of numbers.',
    'learn.fact.5': `Computers have beaten chess champions since ${num(1997)} — but Go took them almost ${num(20)} more years.`,
    'learn.fact.6': 'Ask a model to solve something "step by step" and it genuinely makes fewer mistakes.',
    'learn.fact.7': 'Opening a prompt with "your role: tour guide" changes the whole style of the answer.',
    'learn.fact.8': 'A model does not remember yesterday\'s chat. Someone has to save it and hand it back.',
    'learn.fact.9': 'Sometimes a model invents an answer with total confidence. That is called a hallucination — always check.',
    'learn.fact.10': 'An AI that draws pictures starts from random noise and cleans it, over and over, until a picture appears.',
    'learn.fact.11': 'Models turn words into numbers. In that space, "king" and "queen" sit remarkably close together.',
    'learn.fact.12': 'Training a big model does not run on one computer but on thousands of processors, together, for months.',
    'learn.fact.13': 'Machine translation once ran on a dictionary and rules. Today it learns from millions of sentence pairs.',
    'learn.fact.14': 'A synthetic voice is built from scratch: the computer generates the sound wave itself, tens of thousands of numbers every second.',
    'learn.fact.15': 'A model trained only on English text will be weak in Hebrew — it is good at whatever it saw a lot of.',
  },
});

// The badge names the strip prints live in core/badges.js. ui/collection.js
// registers the same table; registerStrings() merges, and both sides read the
// one source, so the certificate can name a badge even in a build where the
// collection screen was never opened (or, in the gate, never imported).
registerStrings({ he: { ...BADGE_STRINGS.he }, en: { ...BADGE_STRINGS.en } });

/* ═════════════════════════════════════════════════════════════════════ css ══ */

const LEARN_CSS = `
/* ---------- how it was built ---------- */
.mn-dialog.built{width:min(880px,100%);max-height:calc(100vh - 40px);
  display:flex;flex-direction:column;gap:10px;padding:clamp(14px,2.2vh,24px) clamp(14px,2.2vw,28px)}
.lr-scroll{min-height:0;overflow-y:auto;overflow-x:hidden;padding-inline-end:2px}
.lr-lede{margin:0;font-size:clamp(13px,1.5vh,15px);line-height:1.55;color:rgba(244,241,234,.86);max-width:70ch}
.lr-beats{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-block-start:12px}
.lr-beat{position:relative;padding:12px 14px 12px 14px;border-radius:var(--r-m);
  background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.02));
  border:1px solid var(--stroke);display:flex;flex-direction:column;gap:5px}
.lr-beat::before{content:"";position:absolute;inset-block:12px;inset-inline-start:0;width:3px;
  border-radius:var(--r-pill);background:linear-gradient(180deg,var(--gold-1),var(--gold-3))}
.lr-beat b{font-size:15px;font-weight:900;color:var(--gold-1)}
.lr-beat p{margin:0;font-size:13px;line-height:1.5;color:rgba(244,241,234,.82)}
.lr-beat .lr-n{font-weight:900;color:rgba(255,194,71,.55);margin-inline-end:2px}
.lr-cta{margin-block-start:12px;padding:13px 16px;border-radius:var(--r-m);
  background:linear-gradient(180deg,rgba(255,194,71,.17),rgba(255,194,71,.05));
  border:1px solid rgba(255,194,71,.42);display:flex;gap:12px;align-items:flex-start}
.lr-cta .lr-spark{flex:none;width:38px;height:38px}
.lr-cta b{display:block;font-size:15px;font-weight:900;color:var(--gold-1);margin-block-end:3px}
.lr-cta p{margin:0;font-size:13px;line-height:1.5;color:rgba(244,241,234,.88)}

/* ---------- certificate ---------- */
/* Deliberately NOT a .panel: a certificate should not look like the rest of the
   UI chrome. Warm parchment-dark, double gold rule, printed-looking type. */
.mn-ov.cert-ov{background:rgba(4,3,9,.80)}
.mn-dialog.cert{width:min(700px,100%);max-height:calc(100vh - 40px);
  display:flex;flex-direction:column;padding:0;overflow:hidden;
  /* Warm parchment-dark with a procedural guilloche weave — the faint engine-
     turned pattern real certificates use, drawn here in gradients. */
  background:
    repeating-conic-gradient(from 0deg at 50% 40%,rgba(255,194,71,.012) 0 4deg,transparent 4deg 9deg),
    repeating-linear-gradient(38deg,rgba(255,255,255,.014) 0 1px,transparent 1px 8px),
    repeating-linear-gradient(-38deg,rgba(255,255,255,.010) 0 1px,transparent 1px 8px),
    radial-gradient(120% 78% at 50% 0%,rgba(255,194,71,.13),transparent 62%),
    linear-gradient(180deg,#2b2334,#191320 58%,#221a29);
  border:1px solid rgba(255,194,71,.60);border-radius:var(--r-l);
  box-shadow:0 0 0 5px rgba(255,194,71,.10),0 0 0 6px rgba(255,194,71,.38),
    0 0 60px -10px rgba(255,194,71,.30),0 26px 70px rgba(0,0,0,.7)}
.lr-cert-in{position:relative;display:flex;flex-direction:column;min-height:0;
  margin:7px;border:1px dashed rgba(255,194,71,.34);border-radius:calc(var(--r-l) - 6px);
  padding:clamp(12px,2vh,20px) clamp(14px,2.4vw,28px) clamp(8px,1.4vh,14px)}
/* Four gold corner brackets, inside the dashed rule. */
.lr-corner{position:absolute;width:18px;height:18px;pointer-events:none;
  border:2px solid rgba(255,194,71,.62)}
.lr-corner.c1{inset-block-start:7px;inset-inline-start:7px;border-width:2px 0 0 0;
  border-inline-start-width:2px;border-start-start-radius:6px}
.lr-corner.c2{inset-block-start:7px;inset-inline-end:7px;border-width:2px 0 0 0;
  border-inline-end-width:2px;border-start-end-radius:6px}
.lr-corner.c3{inset-block-end:7px;inset-inline-start:7px;border-width:0 0 2px 0;
  border-inline-start-width:2px;border-end-start-radius:6px}
.lr-corner.c4{inset-block-end:7px;inset-inline-end:7px;border-width:0 0 2px 0;
  border-inline-end-width:2px;border-end-end-radius:6px}
/* A thin chequered ribbon under the title: this award comes from a racing game. */
.lr-flag{flex:none;height:10px;width:min(240px,62%);margin:8px auto 0;border-radius:2px;
  background:repeating-conic-gradient(#efe9dc 0% 25%,#1a1523 0% 50%) 0 0/10px 10px;
  opacity:.85;box-shadow:0 2px 8px rgba(0,0,0,.55),0 0 0 1px rgba(255,194,71,.25)}
.lr-cert-head{text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px;flex:none}
.lr-cert-badge{font-size:11px;font-weight:900;letter-spacing:.34em;color:rgba(255,194,71,.72)}
.rtl .lr-cert-badge{letter-spacing:.12em}
.lr-cert-title{font-size:clamp(24px,min(3.4vw,4.6vh),40px);font-weight:900;line-height:1.02;padding:0 .06em}
.lr-rule{width:min(320px,80%);height:1px;margin:7px auto;flex:none;
  background:linear-gradient(90deg,transparent,rgba(255,194,71,.75),transparent);position:relative}
.lr-rule::after{content:"";position:absolute;inset-block-start:-2.5px;left:50%;margin-inline-start:-3px;
  width:6px;height:6px;transform:rotate(45deg);background:var(--gold-2)}
.lr-cert-body{min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;
  gap:clamp(6px,1.2vh,12px);padding-block-start:clamp(8px,1.6vh,14px)}
.lr-awarded{text-align:center}
.lr-awarded .k{font-size:11px;font-weight:800;letter-spacing:.16em;color:var(--txt-dim)}
.rtl .lr-awarded .k{letter-spacing:.04em}
.lr-awarded .v{font-size:clamp(20px,min(2.6vw,3.6vh),30px);font-weight:900;line-height:1.15}
.lr-meta{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;font-size:12px;font-weight:800;
  color:rgba(244,241,234,.72)}
.lr-meta span{padding:3px 11px;border-radius:var(--r-pill);background:rgba(255,255,255,.06);
  border:1px solid var(--stroke)}
.lr-sect{display:flex;align-items:center;gap:10px;margin-block-end:2px}
.lr-sect b{flex:none;font-size:11px;font-weight:900;letter-spacing:.16em;color:#f6d79a}
.rtl .lr-sect b{letter-spacing:.04em;font-size:12px}
.lr-sect i{flex:1 1 auto;height:1px;background:linear-gradient(90deg,rgba(255,194,71,.5),transparent)}
.rtl .lr-sect i{background:linear-gradient(270deg,rgba(255,194,71,.5),transparent)}
.lr-learned{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:7px}
.lr-l{display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border-radius:var(--r-s);
  background:rgba(255,255,255,.045);border:1px solid var(--stroke)}
.lr-l svg{flex:none;width:17px;height:17px;margin-block-start:1px}
.lr-l b{display:block;font-size:13px;font-weight:900;color:var(--gold-1);line-height:1.25}
.lr-l i{font-style:normal;font-size:11.5px;line-height:1.35;color:rgba(244,241,234,.74)}
.lr-quote{position:relative;padding:11px 15px;border-radius:var(--r-m);
  background:linear-gradient(180deg,rgba(255,214,107,.15),rgba(255,214,107,.035));
  border:1px solid rgba(255,214,107,.38);
  box-shadow:0 0 26px -10px rgba(255,194,71,.55) inset}
.lr-quote::before{content:"”";position:absolute;inset-block-start:-2px;inset-inline-end:12px;
  font-size:46px;line-height:1;font-weight:900;color:rgba(255,194,71,.22);pointer-events:none}
.lr-quote .k{font-size:11px;font-weight:900;letter-spacing:.14em;color:#f6d79a;margin-block-end:5px}
.rtl .lr-quote .k{letter-spacing:.03em}
.lr-quote q{display:block;font-size:clamp(14px,1.9vh,17px);line-height:1.5;font-weight:800;color:#fff3d8;
  position:relative}
.lr-qfoot{display:flex;align-items:center;gap:8px;margin-block-start:8px}
.lr-chip{font-size:11px;font-weight:900;color:#2a1c00;padding:2px 10px;border-radius:var(--r-pill);
  background:linear-gradient(180deg,var(--gold-1),var(--gold-3))}
.lr-none{font-size:13px;line-height:1.45;color:rgba(244,241,234,.7);margin:0}
.lr-cert-foot{flex:none;display:flex;align-items:center;gap:12px;justify-content:space-between;
  margin-block-start:clamp(8px,1.6vh,14px);padding-block-start:clamp(6px,1.2vh,12px);
  border-block-start:1px solid rgba(255,194,71,.20);flex-wrap:wrap}
.lr-seal{display:flex;align-items:center;gap:11px;flex:none}
.lr-seal svg{width:clamp(46px,8vh,66px);height:auto;
  filter:drop-shadow(0 5px 12px rgba(0,0,0,.6))}
.lr-seal .s1{font-size:13px;font-weight:900;color:var(--gold-1);line-height:1.2}
.lr-seal .s2{font-size:11px;font-weight:800;color:#e0b978;letter-spacing:.1em}
.rtl .lr-seal .s2{letter-spacing:.02em}
.lr-cert-acts{display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end;flex:1 1 auto}
/* GAPS.md: these were 36px tall against 46–52px on every other screen — above
   the layout gate's 24px floor, so it passed, but small for an 8-year-old on the
   one screen that is meant to feel like an award, and visibly lighter than the
   podium buttons it sits over. 17px type over 15px block padding measures ~48px,
   mid-range for the game. Pinned in tests/certificate.test.mjs. */
.lr-cert-acts .btn{font-size:17px;padding:15px 26px;min-height:48px;
  display:inline-flex;align-items:center;gap:8px}
.lr-cert-acts .btn svg{width:17px;height:17px;flex:none}

/* ---------- certificate: racer portrait, title picker, badge strip ---------- */
.lr-hero{display:flex;align-items:center;gap:clamp(10px,2vw,18px);justify-content:center}
.lr-face{flex:none;width:clamp(74px,11vh,104px);height:clamp(74px,11vh,104px);
  border-radius:var(--r-m);background:radial-gradient(75% 75% at 50% 42%,rgba(255,194,71,.16),rgba(0,0,0,.28));
  border:1px solid rgba(255,194,71,.34);box-shadow:0 8px 22px rgba(0,0,0,.45)}
.lr-hero .lr-awarded{text-align:start}
.lr-fun{margin-block-start:3px;display:inline-block;font-size:clamp(12px,1.6vh,14px);font-weight:900;
  color:#2a1c00;padding:3px 12px;border-radius:var(--r-pill);
  background:linear-gradient(180deg,var(--gold-1),var(--gold-3));box-shadow:0 3px 10px rgba(0,0,0,.35)}
.lr-titles{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
/* Chips, not a text field: the ONLY way to put a title on this certificate is to
   pick one of these. See the header comment — free text is a personal-data entry
   point and the contest forbids it. */
.lr-tchip{font-family:var(--font);font-size:12.5px;font-weight:800;color:var(--txt);cursor:pointer;
  padding:9px 13px;min-height:36px;border-radius:var(--r-pill);background:rgba(255,255,255,.06);
  border:1px solid var(--stroke-hi);transition:transform .12s var(--ease),background .12s}
.lr-tchip:hover{background:rgba(255,255,255,.12);transform:translateY(-1px)}
.lr-tchip[aria-pressed="true"]{color:#2a1c00;border-color:transparent;
  background:linear-gradient(180deg,var(--gold-1),var(--gold-3))}
.lr-badges{display:flex;flex-wrap:wrap;gap:7px;justify-content:center}
.lr-bg{display:flex;align-items:center;gap:7px;padding:5px 11px 5px 7px;border-radius:var(--r-pill);
  background:rgba(255,255,255,.055);border:1px solid rgba(255,194,71,.28)}
.rtl .lr-bg{padding:5px 7px 5px 11px}
.lr-bg svg{flex:none;width:22px;height:22px}
.lr-bg span{font-size:12px;font-weight:800;color:#f6d79a;white-space:nowrap}
.lr-more{align-self:center;font-size:12px;font-weight:800;color:var(--txt-dim)}
.lr-dl-msg{font-size:12px;font-weight:800;color:#f6d79a;align-self:center;margin-inline-end:auto}
.lr-note{flex:none;text-align:center;font-size:11px;line-height:1.35;color:var(--txt-dim);
  margin-block-start:6px}

/* ---------- did-you-know strip ---------- */
.lr-fact{display:flex;align-items:center;gap:11px;padding:11px 16px;border-radius:var(--r-pill);
  background:rgba(18,18,28,.78);border:1px solid rgba(255,194,71,.30);
  box-shadow:0 10px 28px rgba(0,0,0,.5);backdrop-filter:blur(8px);max-width:min(760px,92vw)}
.lr-fact .k{flex:none;font-size:11px;font-weight:900;letter-spacing:.1em;color:#2a1c00;
  background:linear-gradient(180deg,var(--gold-1),var(--gold-3));padding:3px 11px;border-radius:var(--r-pill)}
.rtl .lr-fact .k{letter-spacing:.02em}
.lr-fact .v{font-size:14px;font-weight:700;line-height:1.4;color:var(--txt)}

@media (prefers-reduced-motion:reduce){ .mn-dialog.cert,.mn-dialog.built{animation:none} }
`;

function injectLearnCSS() {
  if (document.getElementById('pr-learn-style')) return;
  const el = document.createElement('style');
  el.id = 'pr-learn-style';
  el.textContent = LEARN_CSS;
  document.head.appendChild(el);
}

/* ═══════════════════════════════════════════════════════════════════ art ══ */

const svg = (vb, inner, cls) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', vb);
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = inner;
  return s;
};

const checkSVG = () => svg('0 0 24 24',
  `<circle cx="12" cy="12" r="10" fill="rgba(255,194,71,.18)" stroke="rgba(255,194,71,.65)" stroke-width="1.5"/>
   <path d="M7.5 12.4l3 3 6-6.4" fill="none" stroke="#ffc247" stroke-width="2.4"
     stroke-linecap="round" stroke-linejoin="round"/>`);

const sparkSVG = () => svg('0 0 40 40',
  `<defs><linearGradient id="lrSp" x1="0" y1="0" x2="0" y2="1">
     <stop offset="0" stop-color="#ffe9a8"/><stop offset="100%" stop-color="#f59310"/></linearGradient></defs>
   <path d="M20 2l4.4 11.2L36 18l-11.6 4.8L20 34l-4.4-11.2L4 18l11.6-4.8z" fill="url(#lrSp)"/>
   <circle cx="20" cy="18" r="4" fill="#2a1c00" opacity=".22"/>`, 'lr-spark');

// A scalloped wax-seal disc. The bumps are computed, not drawn by hand, and the
// loop is deterministic — no Math.random anywhere in this project.
function sealSVG() {
  const R = 40, r = 34, bumps = 20;
  let d = '';
  for (let i = 0; i <= bumps * 2; i++) {
    const a = (i / (bumps * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    const x = (50 + Math.cos(a) * rad).toFixed(2);
    const y = (46 + Math.sin(a) * rad).toFixed(2);
    d += (i === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
  }
  // Ribbon tails first so the disc overlaps them, as a real wax seal does.
  return svg('0 0 100 128',
    `<defs>
       <linearGradient id="lrSeal" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="#ffe9a8"/><stop offset="52%" stop-color="#ffc247"/>
         <stop offset="100%" stop-color="#d97a06"/></linearGradient>
       <linearGradient id="lrRib" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="#c8790e"/><stop offset="100%" stop-color="#7a4703"/></linearGradient>
     </defs>
     <path d="M34 62 L26 122 L43 110 L52 124 L58 62 Z" fill="url(#lrRib)"/>
     <path d="M58 62 L74 118 L60 112 L50 122 L44 64 Z" fill="url(#lrRib)" opacity=".8"/>
     <path d="${d}Z" fill="url(#lrSeal)" stroke="#8a5205" stroke-width="1.6" stroke-linejoin="round"/>
     <circle cx="50" cy="46" r="27" fill="none" stroke="rgba(122,71,3,.45)" stroke-width="1.6"/>
     <circle cx="50" cy="46" r="23" fill="none" stroke="rgba(122,71,3,.35)" stroke-width="1"/>
     <path d="M41 35l11 11-11 11" fill="none" stroke="#7a4703" stroke-width="6"
       stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M56 57h9" stroke="#7a4703" stroke-width="6" stroke-linecap="round"/>`);
}

/* ═══════════════════════════════════════════════════ 1. how it was built ══ */

/**
 * "איך נבנה המשחק הזה?" — reachable from the home menu.
 * @param {object} [opts] {onClose}
 * @returns {object} overlay handle
 */
export function howBuiltOverlay(opts = {}) {
  injectLearnCSS();
  const o = overlayRoot('built');

  const build = () => {
    o.dialog.replaceChildren();
    const beat = (n, tk, bk) => h('div.lr-beat', null,
      h('b', null, h('span.lr-n', null, num(n) + '.'), ' ' + t(tk)),
      h('p', null, t(bk)));

    appendAll(o.dialog,
      h('h2.display-white', { id: o.titleId, style: { margin: '0', textAlign: 'center' } }, t('learn.built.title')),
      h('div.lr-scroll', null,
        h('p.lr-lede', null, t('learn.built.lede')),
        h('div.lr-beats', null,
          beat(1, 'learn.built.b1.t', 'learn.built.b1.b'),
          beat(2, 'learn.built.b2.t', 'learn.built.b2.b'),
          beat(3, 'learn.built.b3.t', 'learn.built.b3.b')),
        h('div.lr-cta', null, sparkSVG(),
          h('div', null,
            h('b', null, t('learn.built.cta.t')),
            h('p', null, t('learn.built.cta.b')))),
        h('div', { style: { display: 'flex', justifyContent: 'center', marginBlockStart: '12px' } },
          factElement())),
      h('div.mn-acts', { style: { marginBlockStart: '0' } },
        h('button.btn', { onclick: () => o.close() }, t('learn.built.close'))));
    o.focusFirst();
  };

  build();
  o.watchLang(build);
  o.onClose = () => opts.onClose?.();
  return o;
}

/* ══════════════════════════════════════════════════════ 2. certificate ══ */

/* ── the preset titles ──────────────────────────────────────────────────────
 * The certificate offers a fun title and the child picks one of THESE. There is
 * no other way to get a title onto it. Two reasons, and only the first is
 * negotiable:
 *   1. a picker is faster and kinder for an 8-year-old than typing;
 *   2. a text field is a personal-data entry point, and the contest forbids
 *      collecting any. That is the rule, not a preference.
 * What is persisted is the ID below, never a string that came from outside —
 * see sanitizeFunTitle(), which is the only door into save.funTitle.
 * Every title is written in both grammatical genders (אלוף/ת) or in a form that
 * has no gender (ראש סקרן), per D27: half the audience is girls. */
export const CERT_TITLE_IDS = ['champ', 'wordsmith', 'drifter', 'curious', 'fixer', 'robotfriend'];

/** i18n key for a preset title id. */
export const certTitleKey = id => `learn.cert.t.${id}`;

/**
 * The ONLY writer of `funTitle`. Anything that is not one of the six preset ids
 * — a typed string, an injected id, an object — collapses to null (no title).
 * @returns {string|null}
 */
export function sanitizeFunTitle(id) {
  return typeof id === 'string' && CERT_TITLE_IDS.includes(id) ? id : null;
}

/** Reads the saved title, laundered through the preset list on the way out. */
export const readFunTitle = () => sanitizeFunTitle(save.read('funTitle'));

/** Writes the chosen title. Rejects anything not in the preset list. */
export function writeFunTitle(id) {
  const clean = sanitizeFunTitle(id);
  save.set({ funTitle: clean });
  return clean;
}

/** Unlocked badge ids, filtered to ones core/badges.js still defines. */
function earnedBadgeIds() {
  const raw = save.read('badges');
  return Array.isArray(raw) ? raw.filter(id => BADGE_IDS.includes(id)) : [];
}

/**
 * Normalises whatever the lead has on hand into the one shape this screen draws.
 * Accepts a plain string, or {text|prompt|sentence, score, slotKey, tier}.
 */
function normalizeBestPrompt(bp) {
  if (!bp) return null;
  if (typeof bp === 'string') return bp.trim() ? { text: bp.trim(), score: null } : null;
  const text = (bp.text ?? bp.prompt ?? bp.sentence ?? bp.sentenceText ?? '').toString().trim();
  if (!text) return null;
  const score = Number(bp.score);
  return { text, score: Number.isFinite(score) ? Math.round(score) : null };
}

/**
 * Everything the certificate prints, resolved once, so the screen and the
 * downloaded PNG can never disagree about what the child achieved.
 *
 * The championship result is READ from the canonical standings shape (D19) —
 * `{place, racerId, racer, name, points, wins, bestFinal, isPlayer}` sorted
 * best→worst — via `standings.find(s => s.isPlayer)`. It is never recomputed
 * here; that recomputation is exactly the bug D19 exists to prevent.
 */
export function certificateData(opts = {}) {
  const he = getLang() === 'he';
  const standings = Array.isArray(opts.standings) ? opts.standings : null;
  const me = standings ? standings.find(s => s && s.isPlayer) || null : null;

  const racerId = opts.racerId || me?.racerId || save.read('racerId') || ROSTER[0].id;
  const racer = racerById(racerId);
  const name = opts.racerName || me?.name || (he ? racer.nameHe : racer.nameEn);

  const champN = Number(opts.championship) || (Number(save.read('championshipsDone')) || 0) + 1;
  const races = Number.isFinite(opts.races)
    ? opts.races : ((save.read('results') || []).filter(Boolean).length || 3);
  const points = Number.isFinite(opts.points) ? opts.points
    : (Number.isFinite(me?.points) ? me.points : null);
  const place = Number.isFinite(opts.place) ? opts.place
    : (Number.isFinite(me?.place) ? me.place : null);

  return {
    he, racer, racerId, name,
    champN, races, points, place,
    best: normalizeBestPrompt(opts.bestPrompt ?? save.read('bestPrompt')),
    funTitle: sanitizeFunTitle(opts.funTitle !== undefined ? opts.funTitle : save.read('funTitle')),
    badges: earnedBadgeIds(),
  };
}

/* ═══════════════════════════════════════════ the racer, drawn from data ══ */
// Not a mounted 3D kart. A certificate is a flat printed thing that has to
// survive being drawn a second time into an export canvas, and a WebGL kart
// would need a second render target, a mounter seam and a readback the PNG path
// cannot do synchronously. So the character is drawn with 2D primitives from
// roster.js's own colours and `body` variant — ONE routine, used by both the
// on-screen portrait and the PNG, which is what guarantees they match.
// Deterministic: shapes only, no Math.random.

const CANVAS_FONT = '"Arial Hebrew","Noto Sans Hebrew",-apple-system,"Segoe UI",system-ui,sans-serif';
const hexCss = n => '#' + (n >>> 0).toString(16).padStart(6, '0');

function rr(ctx, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

// Silhouettes, one per roster `body`, on the same 100x100 grid.
const PORTRAIT_BODY = {
  spark: { w: 54, h: 44, r: 16, head: 17, hy: 34 },
  slim: { w: 38, h: 50, r: 15, head: 15, hy: 28 },
  tank: { w: 72, h: 40, r: 12, head: 16, hy: 34 },
  lamp: { w: 52, h: 40, r: 15, head: 20, hy: 30 },
  twin: { w: 50, h: 44, r: 16, head: 16, hy: 33 },
  round: { w: 64, h: 48, r: 24, head: 13, hy: 30 },
  button: { w: 68, h: 36, r: 14, head: 15, hy: 36 },
  horn: { w: 56, h: 42, r: 14, head: 16, hy: 33 },
};

/**
 * Draw a roster racer's portrait into `ctx`, centred on (x,y), `s` px square.
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawRacerPortrait(ctx, x, y, s, racer) {
  const R = racer || ROSTER[0];
  const B = PORTRAIT_BODY[R.body] || PORTRAIT_BODY.spark;
  const c1 = hexCss(R.color), c2 = hexCss(R.color2);
  const TAU = Math.PI * 2;
  ctx.save();
  ctx.translate(x - s / 2, y - s / 2);
  ctx.scale(s / 100, s / 100);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  const halo = ctx.createRadialGradient(50, 48, 4, 50, 48, 54);
  halo.addColorStop(0, 'rgba(255,194,71,.30)');
  halo.addColorStop(1, 'rgba(255,194,71,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, 100, 100);

  ctx.fillStyle = 'rgba(0,0,0,.40)';
  ctx.beginPath(); ctx.ellipse(50, 89, B.w * 0.42, 5, 0, 0, TAU); ctx.fill();

  const top = 86 - B.h, hy = B.hy;

  /* ---- what sticks out behind the body, per silhouette ---- */
  if (R.body === 'spark') {
    ctx.strokeStyle = c2; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(50, hy - B.head + 2); ctx.lineTo(50, 14); ctx.stroke();
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(50, 10, 5.6, 0, TAU); ctx.fill();
  } else if (R.body === 'twin') {
    ctx.strokeStyle = c2; ctx.lineWidth = 3;
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(50 + d * 6, hy - B.head + 4);
      ctx.quadraticCurveTo(50 + d * 22, 18, 50 + d * 15, 10);
      ctx.stroke();
      ctx.fillStyle = c2;
      ctx.beginPath(); ctx.arc(50 + d * 15, 9, 4, 0, TAU); ctx.fill();
    }
  } else if (R.body === 'horn') {
    ctx.fillStyle = c2;
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(50 + d * (B.w / 2 - 5), top + 8);
      ctx.lineTo(50 + d * (B.w / 2 + 12), top + 1);
      ctx.lineTo(50 + d * (B.w / 2 + 12), top + 21);
      ctx.closePath(); ctx.fill();
    }
  } else if (R.body === 'slim') {
    ctx.strokeStyle = c2; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(50, hy + 8); ctx.lineTo(50, top + 4); ctx.stroke();
  } else if (R.body === 'tank') {
    ctx.fillStyle = c2;
    for (const d of [-1, 1]) { rr(ctx, 50 + d * (B.w / 2 - 3) - (d > 0 ? 0 : 9), top + 3, 9, 16, 4); ctx.fill(); }
  }

  /* ---- body ---- */
  const bg = ctx.createLinearGradient(0, top, 0, 86);
  bg.addColorStop(0, c1); bg.addColorStop(1, c2);
  ctx.fillStyle = bg;
  rr(ctx, 50 - B.w / 2, top, B.w, B.h, B.r); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.30)'; ctx.lineWidth = 1.4; ctx.stroke();

  // Race number plate — the same number the kart wears on track.
  const py = top + B.h * 0.34;
  ctx.fillStyle = 'rgba(247,244,236,.92)';
  rr(ctx, 39, py, 22, 15, 5); ctx.fill();
  ctx.fillStyle = 'rgba(20,14,8,.78)';
  ctx.direction = 'ltr'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 12px ${CANVAS_FONT}`;
  ctx.fillText(String(racerNumber(R)), 50, py + 8.2);

  /* ---- head ---- */
  if (R.body === 'button') { ctx.fillStyle = c2; rr(ctx, 36, hy - 17, 28, 12, 6); ctx.fill(); }
  const hg = ctx.createLinearGradient(0, hy - B.head, 0, hy + B.head);
  hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.10, c1); hg.addColorStop(1, c2);
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(50, hy, B.head, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.26)'; ctx.lineWidth = 1.4; ctx.stroke();
  if (R.body === 'lamp') {
    const lg = ctx.createRadialGradient(50, hy, 2, 50, hy, B.head + 9);
    lg.addColorStop(0, 'rgba(255,244,214,.50)'); lg.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(50, hy, B.head + 9, 0, TAU); ctx.fill();
  }

  /* ---- face: a visor with two lit eyes and a smile ---- */
  ctx.fillStyle = 'rgba(18,14,26,.88)';
  rr(ctx, 50 - B.head * 0.80, hy - B.head * 0.36, B.head * 1.60, B.head * 0.86, B.head * 0.40);
  ctx.fill();
  ctx.fillStyle = '#ffe9a8';
  for (const d of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(50 + d * B.head * 0.34, hy - B.head * 0.02, B.head * 0.17, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,233,168,.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(50, hy + B.head * 0.16, B.head * 0.32, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

/** A DOM-ready portrait canvas, crisp on hi-dpi screens. */
function portraitEl(racer, cssPx = 104) {
  const dpr = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
  const c = h('canvas.lr-face', { 'aria-hidden': 'true' });
  c.width = Math.round(cssPx * dpr);
  c.height = Math.round(cssPx * dpr);
  const ctx = c.getContext('2d');
  if (ctx) drawRacerPortrait(ctx, c.width / 2, c.height / 2, c.width, racer);
  return c;
}

/* ══════════════════════════════════════════════ the certificate as a PNG ══ */
// Drawn here, by hand, into a 2D canvas: no html2canvas, no library, no network,
// nothing that would need a server. `toBlob` → object URL → <a download> is the
// whole delivery path, and it works from a file:// page, which is how a child
// actually opens dist/index.html.
//
// HEBREW ON CANVAS is the hazard (Wave 4 item 7 was a mirrored-Hebrew bug in the
// 3D banners). The model is trackbuild.js's brandTexture: `ctx.direction='rtl'`
// plus a Hebrew-capable font stack, and then LOOK at the output. Canvas runs the
// full bidi algorithm per fillText call, so the rule is: one call per logical
// line, direction set to the line's own base direction, numbers left as plain
// digits (never the num() isolates, which are invisible controls on a canvas).

const CERT_W = 1000, CERT_H = 1460;
const GOLD = '#ffc247', GOLD_HI = '#ffe9a8', INK = '#f7f2e6', DIM = 'rgba(247,242,230,.72)';

function setFont(ctx, weight, size, rtl) {
  ctx.font = `${weight} ${size}px ${CANVAS_FONT}`;
  ctx.direction = rtl ? 'rtl' : 'ltr';
}

function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function pill(ctx, text, cx, y, { pad = 20, hgt = 40, fill, color, size = 19, rtl }) {
  setFont(ctx, '800', size, rtl);
  const w = ctx.measureText(text).width + pad * 2;
  ctx.fillStyle = fill;
  rr(ctx, cx - w / 2, y, w, hgt, hgt / 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y + hgt / 2 + 1);
  return w;
}

function sectionRule(ctx, label, y, rtl) {
  setFont(ctx, '900', 19, rtl);
  ctx.fillStyle = GOLD_HI;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, CERT_W / 2, y);
  const w = ctx.measureText(label).width;
  const g = ctx.createLinearGradient(120, 0, CERT_W - 120, 0);
  g.addColorStop(0, 'rgba(255,194,71,0)');
  g.addColorStop(0.5, 'rgba(255,194,71,.55)');
  g.addColorStop(1, 'rgba(255,194,71,0)');
  ctx.fillStyle = g;
  ctx.fillRect(120, y - 1, CERT_W / 2 - w / 2 - 140, 1.5);
  ctx.fillRect(CERT_W / 2 + w / 2 + 20, y - 1, CERT_W / 2 - w / 2 - 140, 1.5);
}

// The wax seal, same construction as sealSVG() above: computed scallops.
function drawSeal(ctx, cx, cy, R) {
  const TAU = Math.PI * 2, bumps = 20, r = R * 0.85;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= bumps * 2; i++) {
    const a = (i / (bumps * 2)) * TAU - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  g.addColorStop(0, GOLD_HI); g.addColorStop(0.52, GOLD); g.addColorStop(1, '#d97a06');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#8a5205'; ctx.lineWidth = R * 0.05; ctx.stroke();
  ctx.strokeStyle = 'rgba(122,71,3,.45)'; ctx.lineWidth = R * 0.04;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.67, 0, TAU); ctx.stroke();
  // the ">_" prompt mark the SVG seal wears
  ctx.strokeStyle = '#7a4703'; ctx.lineWidth = R * 0.15;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.22, cy - R * 0.27);
  ctx.lineTo(cx + R * 0.05, cy);
  ctx.lineTo(cx - R * 0.22, cy + R * 0.27);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + R * 0.15, cy + R * 0.27);
  ctx.lineTo(cx + R * 0.38, cy + R * 0.27);
  ctx.stroke();
  ctx.restore();
}

/**
 * core/badges.js's icons are inline SVG markup. Rasterise them through a data:
 * URI Image — no file, no network (data: is not a request; tools/verify.mjs's
 * interceptor exempts data:/blob:/file: for exactly this reason). If a browser
 * refuses, the caller falls back to plain gold medallions and the export still
 * happens; a certificate that will not download is worse than one with simpler
 * badges.
 */
function loadIcon(id) {
  const inner = ICONS[badgeById(id)?.icon] || '';
  if (!inner) return Promise.resolve(null);
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">${inner}</svg>`;
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
    setTimeout(() => res(img.complete ? img : null), 1500);
  });
}

function drawBadgeMedal(ctx, cx, cy, R) {
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  g.addColorStop(0, GOLD_HI); g.addColorStop(0.55, GOLD); g.addColorStop(1, '#f59310');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(122,71,3,.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2); ctx.stroke();
}

/**
 * Paint the whole certificate. Synchronous — `icons` is a pre-resolved
 * id → HTMLImageElement|null map so nothing in here can await mid-draw.
 */
function paintCertificate(ctx, d, icons) {
  const rtl = d.he;
  const W = CERT_W, H = CERT_H, cx = W / 2;

  /* ---- ground ---- */
  const bgG = ctx.createLinearGradient(0, 0, 0, H);
  bgG.addColorStop(0, '#2b2334'); bgG.addColorStop(0.58, '#191320'); bgG.addColorStop(1, '#221a29');
  ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(cx, 0, 40, cx, 0, H * 0.72);
  glow.addColorStop(0, 'rgba(255,194,71,.16)'); glow.addColorStop(1, 'rgba(255,194,71,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  // the same engine-turned weave the on-screen panel draws in CSS gradients
  ctx.save();
  ctx.globalAlpha = 0.05; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  for (let i = -H; i < W + H; i += 14) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - H, H); ctx.stroke();
  }
  ctx.restore();

  /* ---- frame: double gold rule + corner brackets, as on screen ---- */
  ctx.strokeStyle = 'rgba(255,194,71,.85)'; ctx.lineWidth = 5;
  rr(ctx, 22, 22, W - 44, H - 44, 26); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,194,71,.35)'; ctx.lineWidth = 2;
  rr(ctx, 38, 38, W - 76, H - 76, 18); ctx.stroke();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = 'rgba(255,194,71,.30)'; ctx.lineWidth = 1.5;
  rr(ctx, 52, 52, W - 104, H - 104, 14); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,194,71,.75)'; ctx.lineWidth = 4;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = sx > 0 ? 52 : W - 52, y = sy > 0 ? 52 : H - 52;
    ctx.beginPath();
    ctx.moveTo(x + sx * 34, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * 34);
    ctx.stroke();
  }

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  /* ---- head ---- */
  let y = 118;
  setFont(ctx, '900', 20, rtl);
  ctx.fillStyle = 'rgba(255,194,71,.78)';
  ctx.fillText(t('learn.cert.badge'), cx, y);
  y += 62;
  setFont(ctx, '900', 62, rtl);
  ctx.fillStyle = INK;
  ctx.fillText(t('learn.cert.title'), cx, y);
  y += 44;
  // chequered ribbon
  const fw = 300, fh = 14, fx = cx - fw / 2;
  for (let i = 0; i < fw / 14; i++) {
    for (let j = 0; j < 1; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#1a1523' : '#efe9dc';
      ctx.fillRect(fx + i * 14, y + j * fh, 14, fh);
    }
  }
  y += 58;

  /* ---- who ---- */
  drawRacerPortrait(ctx, cx, y + 78, 190, d.racer);
  y += 182;
  setFont(ctx, '800', 20, rtl);
  ctx.fillStyle = DIM;
  ctx.fillText(t('learn.cert.awarded'), cx, y);
  y += 50;
  setFont(ctx, '900', 52, rtl);
  ctx.fillStyle = INK;
  ctx.fillText(d.name, cx, y);
  y += 40;
  if (d.funTitle) {
    pill(ctx, t(certTitleKey(d.funTitle)), cx, y, {
      fill: GOLD, color: '#2a1c00', size: 24, hgt: 46, pad: 26, rtl,
    });
    y += 66;
  } else {
    y += 12;
  }

  /* ---- the result (D19 numbers, already resolved) ---- */
  const chips = [t('learn.cert.champ', { n: d.champN })];
  chips.push(d.he ? `${d.races} מרוצים` : `${d.races} races`);
  if (d.points != null) chips.push(d.he ? `${d.points} נק׳` : `${d.points} pts`);
  if (d.place != null) chips.push(d.he ? `מקום ${d.place}` : `#${d.place}`);
  setFont(ctx, '800', 19, rtl);
  const widths = chips.map(c => ctx.measureText(c).width + 36);
  const gap = 12;
  let x = cx - (widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1)) / 2;
  chips.forEach((c, i) => {
    pill(ctx, c, x + widths[i] / 2, y, {
      fill: 'rgba(255,255,255,.08)', color: INK, size: 19, hgt: 40, pad: 18, rtl,
    });
    x += widths[i] + gap;
  });
  y += 86;

  /* ---- the best prompt ---- */
  sectionRule(ctx, t('learn.cert.best'), y, rtl);
  y += 34;
  if (d.best) {
    setFont(ctx, '800', 26, rtl);
    const lines = wrapLines(ctx, d.best.text, W - 260).slice(0, 4);
    const boxH = lines.length * 38 + (d.best.score != null ? 62 : 30);
    ctx.fillStyle = 'rgba(255,214,107,.13)';
    rr(ctx, 100, y, W - 200, boxH, 20); ctx.fill();
    ctx.strokeStyle = 'rgba(255,214,107,.42)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff3d8';
    let ly = y + 30;
    for (const ln of lines) { ctx.fillText(ln, cx, ly); ly += 38; }
    if (d.best.score != null) {
      pill(ctx, `${t('learn.cert.score')} ${d.best.score}`, cx, ly - 4, {
        fill: GOLD, color: '#2a1c00', size: 19, hgt: 36, pad: 18, rtl,
      });
    }
    y += boxH + 44;
  } else {
    setFont(ctx, '700', 22, rtl);
    ctx.fillStyle = DIM;
    const lines = wrapLines(ctx, t('learn.cert.noBest'), W - 260);
    for (const ln of lines) { ctx.fillText(ln, cx, y + 26); y += 34; }
    y += 46;
  }

  /* ---- the badges ---- */
  sectionRule(ctx, t('learn.cert.badges'), y, rtl);
  y += 30;
  if (d.badges.length) {
    const shown = d.badges.slice(0, 6);
    const cols = Math.min(shown.length, 6);
    const cellW = Math.min(150, (W - 200) / cols);
    let bx = cx - (cols * cellW) / 2 + cellW / 2;
    for (const id of shown) {
      const img = icons[id];
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      rr(ctx, bx - cellW / 2 + 5, y + 6, cellW - 10, 106, 18); ctx.fill();
      ctx.strokeStyle = 'rgba(255,194,71,.30)'; ctx.lineWidth = 1.5; ctx.stroke();
      if (img) ctx.drawImage(img, bx - 26, y + 18, 52, 52);
      else drawBadgeMedal(ctx, bx, y + 44, 25);
      setFont(ctx, '800', 15, rtl);
      ctx.fillStyle = '#f6d79a';
      const nm = t(`badge.${id}.name`);
      const nmLines = wrapLines(ctx, nm, cellW - 18).slice(0, 2);
      let ny = y + 84;
      for (const ln of nmLines) { ctx.fillText(ln, bx, ny); ny += 17; }
      bx += cellW;
    }
    y += 122;
    if (d.badges.length > shown.length) {
      setFont(ctx, '800', 17, rtl);
      ctx.fillStyle = DIM;
      ctx.fillText(t('learn.cert.badges.more', { n: d.badges.length - shown.length }), cx, y);
      y += 26;
    }
  } else {
    // An empty strip must still look finished, not broken: the row keeps its
    // height and says what will fill it.
    setFont(ctx, '700', 20, rtl);
    ctx.fillStyle = DIM;
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    rr(ctx, 150, y + 6, W - 300, 66, 18); ctx.fill();
    ctx.strokeStyle = 'rgba(255,194,71,.20)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = DIM;
    const lines = wrapLines(ctx, t('learn.cert.badges.none'), W - 340).slice(0, 2);
    let ny = y + 30 + (lines.length === 1 ? 9 : 0);
    for (const ln of lines) { ctx.fillText(ln, cx, ny); ny += 27; }
    y += 100;
  }

  /* ---- what was learned ---- */
  y = Math.max(y + 14, H - 250);
  sectionRule(ctx, t('learn.cert.learned'), y, rtl);
  y += 40;
  const learned = [1, 2, 3, 4].map(i => [t(`learn.cert.l${i}.t`), t(`learn.cert.l${i}.b`)]);
  const colW = (W - 200) / 2;
  learned.forEach(([tt, bb], i) => {
    const lx = cx + (i % 2 === 0 ? -colW / 2 : colW / 2);
    const ly = y + Math.floor(i / 2) * 52;
    setFont(ctx, '900', 20, rtl);
    ctx.fillStyle = GOLD;
    ctx.fillText(tt, lx, ly);
    setFont(ctx, '700', 16, rtl);
    ctx.fillStyle = DIM;
    ctx.fillText(bb, lx, ly + 24);
  });
  y += 118;

  /* ---- seal + footer ---- */
  drawSeal(ctx, 150, H - 118, 52);
  setFont(ctx, '900', 24, rtl);
  ctx.fillStyle = GOLD;
  ctx.textAlign = d.he ? 'right' : 'left';
  const sx = d.he ? W - 230 : 230;
  ctx.fillText(t('learn.cert.seal'), sx, H - 132);
  setFont(ctx, '800', 18, rtl);
  ctx.fillStyle = '#e0b978';
  ctx.fillText(t('learn.cert.champ', { n: d.champN }), sx, H - 104);
  ctx.textAlign = 'center';
  setFont(ctx, '700', 16, rtl);
  ctx.fillStyle = 'rgba(247,242,230,.55)';
  ctx.fillText(t('learn.cert.foot'), cx, H - 62);
}

/**
 * Render the certificate to an offscreen canvas.
 * @param {object} d certificateData()
 * @param {object} [o] {scale, icons:false}
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderCertificateCanvas(d, o = {}) {
  const scale = o.scale || 2;
  const icons = {};
  if (o.icons !== false) {
    for (const id of d.badges.slice(0, 6)) icons[id] = await loadIcon(id);
  }
  const canvas = document.createElement('canvas');
  canvas.width = CERT_W * scale;
  canvas.height = CERT_H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  paintCertificate(ctx, d, icons);
  return canvas;
}

/** The file the child gets. Deliberately generic — a filename is data too. */
export const CERT_FILENAME = 'prompt-racers-certificate.png';

/**
 * Draw the certificate and hand it to the browser's download machinery.
 * Entirely local: canvas → blob → object URL → <a download>. Works from
 * file://, which is the only way this game is actually opened.
 * @returns {Promise<{ok:boolean, reason?:string, size?:number}>}
 */
export async function downloadCertificatePNG(d, o = {}) {
  let canvas;
  try {
    canvas = await renderCertificateCanvas(d, o);
  } catch (e) {
    return { ok: false, reason: 'render: ' + e.message };
  }
  const blob = await new Promise(res => {
    // A canvas tainted by a rasterised icon would throw here; retry without.
    try { canvas.toBlob(res, 'image/png'); } catch { res(null); }
  }).catch(() => null);
  if (!blob) {
    if (o.icons === false) return { ok: false, reason: 'toBlob returned nothing' };
    return downloadCertificatePNG(d, { ...o, icons: false });
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: CERT_FILENAME, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    return { ok: true, size: blob.size };
  } catch (e) {
    return { ok: false, reason: 'download: ' + e.message };
  }
}

const dlSVG = () => svg('0 0 24 24',
  `<path d="M12 3v11m0 0l-4.2-4.2M12 14l4.2-4.2" fill="none" stroke="currentColor" stroke-width="2.2"
     stroke-linecap="round" stroke-linejoin="round"/>
   <path d="M4.5 16.5v2.2A2.3 2.3 0 0 0 6.8 21h10.4a2.3 2.3 0 0 0 2.3-2.3v-2.2" fill="none"
     stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`);

/**
 * "תעודת פרומפטר" — the end-of-championship award.
 *
 * NO NAME ENTRY. The identity printed here is the roster racer the child chose,
 * and the optional title comes from CERT_TITLE_IDS. There is no text field on
 * this screen and there must never be one — see the header comment and
 * tests/certificate.test.mjs.
 *
 * @param {object}        opts
 * @param {string|object} [opts.bestPrompt]   the run's highest-scoring prompt:
 *                                            {text, score} (or a bare string)
 * @param {Array}         [opts.standings]    canonical standings (D19) — the
 *                                            player's row is READ, never recomputed
 * @param {string}        [opts.racerId]      roster id of the character driven
 * @param {string}        [opts.racerName]    its display name, if already resolved
 * @param {number}        [opts.championship] which championship this is (1-based)
 * @param {number}        [opts.races]        races completed
 * @param {number}        [opts.points]       championship points
 * @param {number}        [opts.place]        final championship position
 * @param {Function}      [opts.onClose] @param {Function} [opts.onMenu]
 * @returns {object} overlay handle
 */
export function certificateOverlay(opts = {}) {
  injectLearnCSS();
  const o = overlayRoot('cert');
  o.ov.classList.add('cert-ov');

  let chosen = sanitizeFunTitle(opts.funTitle !== undefined ? opts.funTitle : save.read('funTitle'));

  const build = () => {
    o.dialog.replaceChildren();
    const d = certificateData({ ...opts, funTitle: chosen });
    const he = d.he;
    const learned = (tk, bk) => h('div.lr-l', null, checkSVG(),
      h('div', null, h('b', null, t(tk)), h('i', null, t(bk))));

    // Dated by championship, never by a real date — a date is one more thing
    // about a child that does not need to exist anywhere. Note the numerals go
    // through num() and the chips are NOT .num: forcing LTR on a whole chip
    // reorders "מקום 1" into "1 מקום".
    const meta = h('div.lr-meta', null,
      h('span', null, t('learn.cert.champ', { n: num(d.champN) })),
      h('span', null, he ? `${num(d.races)} מרוצים` : `${num(d.races)} races`),
      d.points != null ? h('span', null, he ? `${num(d.points)} נק׳` : `${num(d.points)} pts`) : null,
      d.place != null ? h('span', null, he ? `מקום ${num(d.place)}` : `#${num(d.place)}`) : null);

    // Title picker. Buttons — there is no field to type into anywhere here.
    const titleRow = h('div.lr-titles', { role: 'group', 'aria-label': t('learn.cert.titlePick') });
    const chip = (id, label) => h('button.lr-tchip', {
      type: 'button',
      'aria-pressed': (chosen === id) ? 'true' : 'false',
      'data-title-id': id === null ? '' : id,
      onclick: () => { chosen = writeFunTitle(id); build(); },
    }, label);
    titleRow.append(chip(null, t('learn.cert.titleNone')));
    for (const id of CERT_TITLE_IDS) titleRow.append(chip(id, t(certTitleKey(id))));

    const badgeStrip = d.badges.length
      ? h('div.lr-badges', null,
        ...d.badges.slice(0, 6).map(id => h('div.lr-bg', null,
          badgeIconSVG(id), h('span', null, t(`badge.${id}.name`)))),
        d.badges.length > 6
          ? h('div.lr-more', null, t('learn.cert.badges.more', { n: num(d.badges.length - 6) }))
          : null)
      : h('p.lr-none', { style: { textAlign: 'center' } }, t('learn.cert.badges.none'));

    const dlMsg = h('div.lr-dl-msg', { role: 'status', 'aria-live': 'polite' });
    const dlBtn = h('button.btn.ghost', {
      type: 'button',
      onclick: async () => {
        dlBtn.disabled = true;
        dlMsg.textContent = t('learn.cert.downloading');
        const r = await downloadCertificatePNG(certificateData({ ...opts, funTitle: chosen }));
        dlMsg.textContent = r.ok ? t('learn.cert.downloaded') : t('learn.cert.downloadFail');
        dlBtn.disabled = false;
      },
    }, dlSVG(), t('learn.cert.download'));

    const menuBtn = opts.onMenu
      ? h('button.btn', { onclick: () => { o.close(); opts.onMenu(); } }, t('learn.cert.menu'))
      : null;

    appendAll(o.dialog, h('div.lr-cert-in', null,
      h('i.lr-corner.c1'), h('i.lr-corner.c2'), h('i.lr-corner.c3'), h('i.lr-corner.c4'),
      h('div.lr-cert-head', null,
        h('div.lr-cert-badge', null, t('learn.cert.badge')),
        h('h2.lr-cert-title.display', { id: o.titleId }, t('learn.cert.title')),
        h('div.lr-flag')),
      h('div.lr-cert-body', null,
        h('div.lr-hero', null,
          portraitEl(d.racer),
          h('div.lr-awarded', null,
            h('div.k', null, t('learn.cert.awarded')),
            h('div.v.display-white', null, d.name),
            d.funTitle ? h('div.lr-fun', null, t(certTitleKey(d.funTitle))) : null)),
        meta,
        h('div', null,
          h('div.lr-sect', null, h('b', null, t('learn.cert.titlePick')), h('i')),
          titleRow),
        h('div.lr-quote', null,
          h('div.k', null, t('learn.cert.best')),
          d.best ? h('q', { dir: 'auto' }, d.best.text) : h('p.lr-none', null, t('learn.cert.noBest')),
          d.best && d.best.score != null
            ? h('div.lr-qfoot', null,
              h('span.lr-chip', null, `${t('learn.cert.score')} ${num(d.best.score)}`))
            : null),
        h('div', null,
          h('div.lr-sect', null, h('b', null, t('learn.cert.badges')), h('i')),
          badgeStrip),
        h('div', null,
          h('div.lr-sect', null, h('b', null, t('learn.cert.learned')), h('i')),
          h('div.lr-learned', null,
            learned('learn.cert.l1.t', 'learn.cert.l1.b'),
            learned('learn.cert.l2.t', 'learn.cert.l2.b'),
            learned('learn.cert.l3.t', 'learn.cert.l3.b'),
            learned('learn.cert.l4.t', 'learn.cert.l4.b')))),
      h('div.lr-cert-foot', null,
        h('div.lr-seal', null, sealSVG(),
          h('div', null,
            h('div.s1', null, t('learn.cert.seal')),
            h('div.s2', null, t('learn.cert.champ', { n: num(d.champN) })))),
        // The documented flow ends at the main menu, so THAT is the gold button
        // and the primary focus target; "close" is the way back to the podium and
        // reads as the secondary action it is. The emphasis used to be inverted,
        // pointing the child at the one button that goes nowhere.
        h('div.lr-cert-acts', null, dlMsg, dlBtn, menuBtn,
          h('button.btn.ghost', { onclick: () => o.close() }, t('learn.cert.close')))),
      h('div.lr-note', null, t('learn.cert.foot'))));

    // Not o.focusFirst(): the first focusable is now a title chip, and the
    // primary action is still the way home.
    requestAnimationFrame(() => (menuBtn || dlBtn || o.dialog).focus({ preventScroll: true }));
  };

  build();
  o.watchLang(build);
  o.onClose = () => opts.onClose?.();
  return o;
}

function badgeIconSVG(id) {
  return svg('0 0 48 48', ICONS[badgeById(id)?.icon] || ICONS.token || '');
}

/* ═════════════════════════════════════════════════════════ 3. AI facts ══ */

/** i18n keys for the "הידעת?" one-liners. Each reads in about three seconds. */
export const AI_FACT_KEYS = Array.from({ length: 15 }, (_, i) => `learn.fact.${i + 1}`);

/** How many facts there are. */
export const factCount = () => AI_FACT_KEYS.length;

/** Localised text of fact #i (wraps, so any counter or seed is safe to pass). */
export function factText(i = 0) {
  const n = AI_FACT_KEYS.length;
  const idx = ((Math.floor(Number(i) || 0) % n) + n) % n;
  return t(AI_FACT_KEYS[idx]);
}

// Deterministic rotation: never Math.random, and never the same fact twice in a
// row across a session (screenshots stay reproducible because index 0 is first).
let _factCursor = 0;
export function nextFactText() { return factText(_factCursor++); }
export function resetFacts() { _factCursor = 0; }

/**
 * Ready-to-mount "הידעת?" strip for loading screens and between races.
 *   host.appendChild(factElement());              // next fact in the rotation
 *   host.appendChild(factElement({ index: 4 }));  // a specific one
 * @returns {HTMLElement}
 */
export function factElement(opts = {}) {
  injectLearnCSS();
  const text = opts.text || (Number.isFinite(opts.index) ? factText(opts.index) : nextFactText());
  return h('div.lr-fact' + (opts.instant ? '' : '.fade-in'), { role: 'note' },
    h('span.k', null, t('learn.fact.title')),
    h('span.v', null, text));
}

/* ═══════════════════════════════════════════════════════════════ previews ══ */

function overBackdrop(engine, opts, open) {
  const s = backdropScene(engine, { instant: true, ...opts });
  const ov = open();
  const dispose = s.dispose;
  s.dispose = () => {
    try { ov?.close?.(); } catch (e) { /* already gone */ }
    document.querySelectorAll('.mn-ov').forEach(n => n.remove());
    dispose();
  };
  return s;
}

const SAMPLE_PROMPT_HE = 'בורג, בנה לי מנוע שיוציא אותי מהר מהסיבוב האחרון, בלי להוסיף משקל, בסגנון של קארט מדבר.';
const SAMPLE_PROMPT_EN = 'Boreg, build me an engine that pulls me out of the last corner fast, without adding weight, in a desert-kart style.';

export const previewHowBuilt = (engine, opts = {}) =>
  overBackdrop(engine, opts, () => howBuiltOverlay());

// A canonical-shape standings array (D19), so the preview exercises the same
// read path the podium uses rather than a hand-fed place/points pair.
const SAMPLE_STANDINGS = [
  { place: 1, racerId: 'nitzotz', name: 'ניצוץ', points: 24, wins: 2, bestFinal: 1, isPlayer: true },
  { place: 2, racerId: 'plada', name: 'פלדה', points: 21, wins: 1, bestFinal: 2, isPlayer: false },
  { place: 3, racerId: 'zuzi', name: 'זוזי', points: 17, wins: 0, bestFinal: 3, isPlayer: false },
];

export const previewCertificate = (engine, opts = {}) => {
  // Two badges unlocked, so the strip is exercised. The preview owns the save
  // state it renders — the harness starts from a clean one.
  if (!(save.read('badges') || []).length) save.set({ badges: ['quiz-5', 'drift-first'] });
  return overBackdrop(engine, opts, () => certificateOverlay({
    bestPrompt: { text: getLang() === 'he' ? SAMPLE_PROMPT_HE : SAMPLE_PROMPT_EN, score: 86 },
    standings: SAMPLE_STANDINGS,
    racerId: 'nitzotz',
    racerName: getLang() === 'he' ? 'ניצוץ' : 'Spark',
    championship: 1, races: 3,
    funTitle: 'champ',
    onMenu: () => {},
    ...opts,
  }));
};

/** The empty case: no badges, no best prompt, no title. Must still look finished. */
export const previewCertificateBare = (engine, opts = {}) => {
  save.set({ badges: [], funTitle: null });
  return overBackdrop(engine, opts, () => certificateOverlay({
    standings: SAMPLE_STANDINGS, racerId: 'plada',
    championship: 1, races: 3, funTitle: null,
    onMenu: () => {},
    ...opts,
  }));
};

export const previewFacts = (engine, opts = {}) => {
  const s = backdropScene(engine, { instant: true, ...opts });
  injectLearnCSS();
  const col = h('div.col', {
    style: {
      position: 'absolute', inset: '0', alignItems: 'center', justifyContent: 'center',
      gap: '12px', padding: '24px', pointerEvents: 'none',
    },
  }, ...AI_FACT_KEYS.slice(0, 6).map((_, i) => factElement({ index: i, instant: true })));
  (engine?.ui || document.body).appendChild(col);
  const dispose = s.dispose;
  s.dispose = () => { col.remove(); dispose(); };
  return s;
};

export const preview = previewHowBuilt;

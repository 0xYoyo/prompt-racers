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
//   • No personal data, no name entry, no download, no sharing. localStorage only.
import { h } from './style.js';
import { registerStrings, t, num, getLang } from './i18n.js';
import { save } from '../core/save.js';
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
/* 36px tall against 46–52px on every other screen — passing the layout gate's
   24px floor, but small for an 8-year-old on the one screen that is meant to
   feel like an award, and visibly lighter than the podium buttons it sits over.
   16px/13px lands at ~45px, inside the range the rest of the game uses. */
.lr-cert-acts .btn{font-size:16px;padding:13px 26px}
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
 * "תעודת פרומפטר" — the end-of-championship award. On screen only: no download,
 * no share, no name entry, nothing leaves localStorage.
 *
 * @param {object}        opts
 * @param {string|object} [opts.bestPrompt]   the run's highest-scoring prompt:
 *                                            {text, score} (or a bare string)
 * @param {string}        [opts.racerName]    the character driven, e.g. 'ניצוץ'
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

  const best = normalizeBestPrompt(opts.bestPrompt);
  const champN = Number(opts.championship) || (Number(save.read('championshipsDone')) || 0) + 1;
  const races = Number.isFinite(opts.races) ? opts.races : ((save.read('results') || []).filter(Boolean).length || 3);
  const points = Number.isFinite(opts.points) ? opts.points : null;
  const place = Number.isFinite(opts.place) ? opts.place : null;

  const build = () => {
    o.dialog.replaceChildren();
    const learned = (tk, bk) => h('div.lr-l', null, checkSVG(),
      h('div', null, h('b', null, t(tk)), h('i', null, t(bk))));

    // Dated by championship, never by a real date — a date is one more thing
    // about a child that does not need to exist anywhere. Note the numerals go
    // through num() and the chips are NOT .num: forcing LTR on a whole chip
    // reorders "מקום 1" into "1 מקום".
    const he = getLang() === 'he';
    const meta = h('div.lr-meta', null,
      h('span', null, t('learn.cert.champ', { n: num(champN) })),
      h('span', null, he ? `${num(races)} מרוצים` : `${num(races)} races`),
      points != null ? h('span', null, he ? `${num(points)} נק׳` : `${num(points)} pts`) : null,
      place != null ? h('span', null, he ? `מקום ${num(place)}` : `#${num(place)}`) : null);

    appendAll(o.dialog, h('div.lr-cert-in', null,
      h('i.lr-corner.c1'), h('i.lr-corner.c2'), h('i.lr-corner.c3'), h('i.lr-corner.c4'),
      h('div.lr-cert-head', null,
        h('div.lr-cert-badge', null, t('learn.cert.badge')),
        h('h2.lr-cert-title.display', { id: o.titleId }, t('learn.cert.title')),
        h('div.lr-flag')),
      h('div.lr-cert-body', null,
        h('div.lr-awarded', null,
          h('div.k', null, t('learn.cert.awarded')),
          h('div.v.display-white', null, opts.racerName || (he ? 'ניצוץ' : 'Spark'))),
        meta,
        h('div.lr-quote', null,
          h('div.k', null, t('learn.cert.best')),
          best ? h('q', { dir: 'auto' }, best.text) : h('p.lr-none', null, t('learn.cert.noBest')),
          best && best.score != null
            ? h('div.lr-qfoot', null,
              h('span.lr-chip', null, `${t('learn.cert.score')} ${num(best.score)}`))
            : null),
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
            h('div.s2', null, t('learn.cert.champ', { n: num(champN) })))),
        // The documented flow ends at the main menu, so THAT is the gold button
        // and the primary focus target; "close" is the way back to the podium and
        // reads as the secondary action it is. The emphasis used to be inverted,
        // pointing the child at the one button that goes nowhere.
        h('div.lr-cert-acts', null,
          opts.onMenu ? h('button.btn', {
            onclick: () => { o.close(); opts.onMenu(); },
          }, t('learn.cert.menu')) : null,
          h('button.btn.ghost', { onclick: () => o.close() }, t('learn.cert.close')))),
      h('div.lr-note', null, t('learn.cert.foot'))));
    o.focusFirst();
  };

  build();
  o.watchLang(build);
  o.onClose = () => opts.onClose?.();
  return o;
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

export const previewCertificate = (engine, opts = {}) =>
  overBackdrop(engine, opts, () => certificateOverlay({
    bestPrompt: { text: getLang() === 'he' ? SAMPLE_PROMPT_HE : SAMPLE_PROMPT_EN, score: 86 },
    racerName: getLang() === 'he' ? 'ניצוץ' : 'Spark',
    championship: 1, races: 3, points: 24, place: 1,
    onMenu: () => {},
    ...opts,
  }));

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

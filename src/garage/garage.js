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
import { h } from '../ui/style.js';
import { registerStrings, t, num, getLang, isRTL, setLang } from '../ui/i18n.js';
import {
  SLOTS, optionById, costOf, sentenceParts, partName, DEFAULT_BUDGET,
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
    'garage.kicker': 'בונים חלק עם בורג',
    'garage.budget': 'תקציב',
    'garage.spent': 'עולה',
    'garage.left': 'נשארו',
    'garage.budget.note': 'לא מספיק לכול — צריך לבחור איפה להשקיע',
    'garage.boreg': 'בורג',
    'garage.intro.1': 'אני בורג, ואני בונה בדיוק מה שכתוב בבקשה. בדיוק. אז בואו נרכיב יחד בקשה טובה.',
    'garage.intro.2': 'חזרתם! היום לומדים את הסוד שלי — מה אסור להרוס. זה מה שהופך חלק טוב לחלק מעולה.',
    'garage.intro.3': 'המרוץ האחרון. כבר ידוע הכול: מה, מתי, מה אסור להרוס ואיך זה ייראה. קדימה, בואו נראה.',
    'garage.sentence.label': 'הבקשה שלך לבורג',
    'garage.sentence.hint': 'שורה אחרי שורה — המשפט נבנה מול העיניים',
    'garage.stats.label': 'איך זה ישפיע על הקארט',
    'garage.stat.speed': 'מהירות',
    // 'תאוצה' — the same word the select screen and the roster use. This panel
    // said 'האצה', so the bar a child watched move in the garage did not share a
    // name with the bar they picked their racer by.
    'garage.stat.accel': 'תאוצה',
    'garage.stat.handling': 'אחיזה',
    'garage.stat.weight': 'משקל',
    'garage.stat.weightNote': 'פחות = טוב יותר',
    'garage.quality': 'איכות הבקשה',
    'garage.build': 'בורג, תבנה!',
    'garage.buildBlocked': 'צריך לבחור בכל ארבע השורות',
    'garage.building': 'בורג בונה…',
    'garage.reset': 'מתחילים מחדש',
    'garage.frag': 'ייכנס למשפט',
    'garage.step.change': 'שינוי',
    'garage.step.next': 'בהמשך',
    'garage.step.of': 'שלב {n} מתוך ‎4',
    'garage.tier.0': 'דרגה ‎0 — עובד, בערך',
    'garage.tier.1': 'דרגה ‎1 — בסדר גמור',
    'garage.tier.2': 'דרגה ‎2 — מכויל',
    'garage.tier.3': 'דרגה ‎3 — מדויק בטירוף',
    'garage.reveal.title': 'בורג בנה לך',
    'garage.reveal.ask': 'זאת הייתה הבקשה שלך',
    'garage.reveal.spec': 'כמה פירוט היה בכל חלק של הבקשה',
    'garage.reveal.deltas': 'מה השתנה בקארט',
    'garage.reveal.tokens': 'הרווחת {n} טוקנים',
    'garage.reveal.install': 'התקנה והמשך',
    'garage.reveal.again': 'בקשה אחרת',
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
    'garage.recipe.label': 'מתכון לבקשה טובה',
    'garage.recipe.what': 'מה בדיוק',
    'garage.recipe.when': 'מתי ואיפה',
    'garage.recipe.limit': 'מה אסור להרוס',
    'garage.recipe.look': 'איך זה ייראה',
  },
  en: {
    'garage.title': 'The Garage',
    'garage.kicker': 'Build a part with Boreg',
    'garage.budget': 'Budget',
    'garage.spent': 'Costs',
    'garage.left': 'Left',
    'garage.budget.note': 'never enough for everything — choose where it counts',
    'garage.boreg': 'Boreg',
    'garage.intro.1': "I'm Boreg, and I build exactly what the ask says. Exactly. So let's put together a good ask.",
    'garage.intro.2': "You're back! Today we learn my secret — what must NOT break. That is what makes a part great.",
    'garage.intro.3': 'Final race. It is all known by now: what, when, what must not break, and how it looks.',
    'garage.sentence.label': 'Your ask to Boreg',
    'garage.sentence.hint': 'one row at a time — the sentence builds in front of you',
    'garage.stats.label': 'Effect on your kart',
    'garage.stat.speed': 'Speed',
    'garage.stat.accel': 'Accel',
    'garage.stat.handling': 'Handling',
    'garage.stat.weight': 'Weight',
    'garage.stat.weightNote': 'less is better',
    'garage.quality': 'Ask quality',
    'garage.build': 'Boreg, build it!',
    'garage.buildBlocked': 'Answer all four rows',
    'garage.building': 'Boreg is building…',
    'garage.reset': 'Start over',
    'garage.frag': 'goes into the sentence',
    'garage.step.change': 'Change',
    'garage.step.next': 'next',
    'garage.step.of': 'Step {n} of 4',
    'garage.tier.0': 'Tier 0 — works, sort of',
    'garage.tier.1': 'Tier 1 — perfectly fine',
    'garage.tier.2': 'Tier 2 — tuned',
    'garage.tier.3': 'Tier 3 — ridiculously precise',
    'garage.reveal.title': 'Boreg built you',
    'garage.reveal.ask': 'This was your ask',
    'garage.reveal.spec': 'How much detail each piece carried',
    'garage.reveal.deltas': 'What changed on your kart',
    'garage.reveal.tokens': 'You earned {n} tokens',
    'garage.reveal.install': 'Install and continue',
    'garage.reveal.again': 'A different ask',
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
    'garage.recipe.label': 'Recipe for a good ask',
    'garage.recipe.what': 'What exactly',
    'garage.recipe.when': 'When and where',
    'garage.recipe.limit': 'What must not break',
    'garage.recipe.look': 'How it looks',
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
.grg-reveal{width:min(780px,94%);max-height:96%;overflow:auto;padding:20px 26px 22px;
  display:flex;flex-direction:column;gap:11px}
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
.grg-dot.on{background:var(--gold-2);box-shadow:0 0 8px rgba(255,194,71,.75)}
.grg-partname{font-size:34px;line-height:1.1}
.grg-flavour{font-size:15px;font-weight:700;line-height:1.45;color:#f0ebdf}
.grg-deltagrid{display:flex;gap:9px}
.grg-deltacard{flex:1;padding:9px 12px;border-radius:var(--r-s);background:rgba(255,255,255,.055);
  border:1px solid var(--stroke);display:flex;flex-direction:column;gap:3px}
.grg-revactions{display:flex;gap:10px;align-items:center;margin-top:2px}
.grg-tokgain{display:flex;align-items:center;gap:8px;font-size:14.5px;font-weight:900;
  color:var(--token);margin-inline-start:auto}

@media (max-height:790px){
  .grg-title{font-size:32px}
  .grg-sentence-txt{font-size:22px}
  .ltr .grg-sentence-txt{font-size:20px}
  .grg-opt-head{min-height:66px}
  .grg-opt-he{font-size:16px}
  .grg-root{gap:11px;padding:14px 20px 15px}
  .grg-body{gap:14px}
}
`;

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
  const budget = opts.tokens != null ? opts.tokens : DEFAULT_BUDGET;
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

  function topBar() {
    return h('header.grg-top',
      null,
      h('div',
        null,
        h('div.grg-kicker', null, t('garage.kicker')),
        h('div.display.grg-title', null, t('garage.title'))),
      h('div.grg-visit', null, t('garage.visit', { n: num(visit) })),
      h('div.grg-spacer'),
      h('div.grg-budgetnote', null, t('garage.budget.note')),
      h('div.panel.grg-budget',
        null,
        h('div.grg-coin'),
        h('div', null,
          h('div.grg-sub', null, t('garage.left')),
          h('div.display.grg-bignum.num', null, num(remaining()))),
        h('div', { style: { width: '1px', height: '28px', background: 'var(--stroke-hi)' } }),
        h('div', null,
          h('div.grg-sub', null, t('garage.budget')),
          h('div.num', { style: { fontSize: '18px', color: 'var(--txt-dim)' } }, num(budget)))));
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
      expertBar());
  }

  function boregLine() {
    return h('div.panel.grg-boreg',
      null,
      h('div.grg-face', null, h('div.grg-antenna')),
      h('div', null,
        h('div.label', null, t('garage.boreg')),
        h('div.grg-boreg-line', null,
          st.phase === 'building' ? t('garage.building') : t(`garage.intro.${visit}`))));
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
        h('div.grg-dots', null, [0, 1, 2].map(d => h('span.grg-dot' + (d < n ? '.on' : '')))),
        h('span', null, pick(slot, 'axis'))));
    }
    return row;
  }

  function revealOverlay() {
    const r = st.result;
    const name = partName(r.slotKey, r.tier, lang);
    const gain = tokenReward(r.score, st.expert);
    const tip = tipById(st.activeTip);
    const tp = tip ? tipParts(tip, r) : null;
    const cards = STAT_KEYS.map(k => {
      const d = r.deltas[k] || 0;
      const good = LOWER_IS_BETTER[k] ? d < 0 : d > 0;
      return h('div.grg-deltacard', null,
        h('div.grg-sub', null, t('garage.stat.' + k)),
        h('div.grg-delta.' + (d === 0 ? 'zero' : good ? 'good' : 'bad'),
          { style: { fontSize: '20px', width: 'auto', textAlign: 'start' } },
          d === 0 ? '—' : num((d > 0 ? '+' : '') + d)));
    });
    // The caller needs BOTH halves of the transaction: what the ask cost and
    // what the build paid. Reporting only `gain` is how the token economy ended
    // up running backwards (see scenes.js onDone).
    const install = h('button.btn', {
      type: 'button',
      onclick: () => opts.onDone?.({ ...r, selection: { ...st.sel }, cost: spent() }, gain),
    }, t('garage.reveal.install'));
    const again = h('button.btn.ghost', {
      type: 'button',
      onclick: () => { st.phase = 'select'; st.result = null; render(); },
    }, t('garage.reveal.again'));
    const recap = st.expert
      ? h('div.grg-recap', null, st.freeText)
      : h('div.grg-recap', null, sentenceNode(st.sel, { recap: true }));
    return h('div.grg-scrim',
      null,
      h('div.panel-lift.grg-reveal.pop-in',
        null,
        // Cause first, then effect. The ask is reprinted here because the modal
        // covers the board, and this is the exact moment the link matters.
        h('div.label', null, t('garage.reveal.ask')),
        recap,
        specChips(r),
        h('div.grg-tierbadge', null, t('garage.tier.' + r.tier)),
        h('div.label', null, t('garage.reveal.title')),
        h('div.display.grg-partname', null, name),
        h('div.grg-flavour', null, t(r.flavourKeyHe)),
        h('div.label', { style: { marginTop: '2px' } }, t('garage.reveal.deltas')),
        h('div.grg-deltagrid', null, ...cards),
        tp && h('div.panel.grg-tip', { style: { marginTop: '2px' } },
          h('div.grg-tip-label', null, t('garage.tip.label')),
          h('div.grg-tip-title', null, tp.title),
          h('div.grg-tip-body', null, tp.body)),
        h('div.grg-revactions', null, install, again,
          h('div.grg-tokgain', null, h('div.grg-coin'),
            t('garage.reveal.tokens', { n: num(gain) })))));
  }

  // ── keyboard ───────────────────────────────────────────────────────────────
  function onKey(e) {
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
// Previews
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: the previews forward the harness's opts (it passes `lang`/`quality`
// through engine.goto) on top of their own setup.
export function preview(engine, o = {}) {
  return garageScene(engine, {
    visit: 2,
    selection: { part: 'engine', goal: 'accel-corner', constraint: null, style: null },
    tip: 'spec.when-where',
    ...o,
  });
}

export function previewReveal(engine, o = {}) {
  return garageScene(engine, {
    visit: 2,
    phase: 'reveal',
    selection: { part: 'tires', goal: 'accel-brake', constraint: 'light', style: 'desert' },
    ...o,
  });
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

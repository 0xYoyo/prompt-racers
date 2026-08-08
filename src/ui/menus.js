// Front-of-house screens: title, racer select, results, podium, plus the reusable
// settings / pause / how-to-play overlays.
//
// Everything here is DOM built with h() and the tokens in ui/style.js, floating over
// a 3D backdrop. The backdrop is a procedural golden-hour "blurred gameplay" quad
// until the lead wires a real scene in via setBackdrop() — the reference title screen
// gets most of its richness from sitting over live gameplay, so the seam is kept
// deliberately thin.
//
// RTL is the default and the arrow-key mapping is written visually, not by index:
// under RTL the grid flows right-to-left, so ArrowLeft advances the array.
import * as THREE from 'three';
import { h, injectStyles, modalOpen } from './style.js';
import { registerStrings, t, num, ordinal, formatTime, setLang, getLang, isRTL } from './i18n.js';
import { save } from '../core/save.js';
import { bus } from '../core/bus.js';
import { makeRng } from '../core/rng.js';
import { ROSTER as ROSTER_IMPORT } from '../kart/roster.js';
// learn.js builds on overlayRoot() from this file, so these two modules import
// each other. That is safe here and only here: every binding crossing the cycle
// is a hoisted function declaration, and neither module calls into the other
// while its top level is still running.
import { howBuiltOverlay, certificateOverlay } from './learn.js';

/* ══════════════════════════════════════════════════════════════════ roster ══ */

// Same shape as src/kart/roster.js. Kept so this module renders standalone and so
// a partially-written roster entry can never blank a card.
export const FALLBACK_ROSTER = [
  { id: 'nitzotz', nameHe: 'ניצוץ', nameEn: 'Spark', color: 0xffc247, color2: 0xff7a2f, body: 'spark', stats: { speed: 3, accel: 4, handling: 4, weight: 3 }, personality: 'balanced' },
  { id: 'zuzi', nameHe: 'זוזי', nameEn: 'Zuzi', color: 0x9fe053, color2: 0x147d6b, body: 'slim', stats: { speed: 2, accel: 5, handling: 5, weight: 1 }, personality: 'erratic' },
  { id: 'plada', nameHe: 'פלדה', nameEn: 'Steel', color: 0x5f82b4, color2: 0xf0812c, body: 'tank', stats: { speed: 5, accel: 2, handling: 2, weight: 5 }, personality: 'blocker' },
  { id: 'nurit', nameHe: 'נורית', nameEn: 'Nurit', color: 0xef4436, color2: 0xffe2b0, body: 'lamp', stats: { speed: 3, accel: 3, handling: 5, weight: 2 }, personality: 'steady' },
  { id: 'zamzum', nameHe: 'זמזום', nameEn: 'Buzz', color: 0xe257c9, color2: 0x6a45c8, body: 'twin', stats: { speed: 5, accel: 4, handling: 1, weight: 3 }, personality: 'aggressive' },
  { id: 'tipa', nameHe: 'טיפה', nameEn: 'Droplet', color: 0x29c2df, color2: 0xf2fbff, body: 'round', stats: { speed: 3, accel: 5, handling: 3, weight: 2 }, personality: 'drifter' },
  { id: 'kaftor', nameHe: 'כפתור', nameEn: 'Button', color: 0x6b4fd8, color2: 0xffd53d, body: 'button', stats: { speed: 4, accel: 2, handling: 4, weight: 4 }, personality: 'steady' },
  { id: 'raash', nameHe: 'רעש', nameEn: 'Rumble', color: 0x9aa3b0, color2: 0xff5a3c, body: 'horn', stats: { speed: 4, accel: 4, handling: 2, weight: 4 }, personality: 'aggressive' },
];

function normalizeRacer(r, i) {
  const f = FALLBACK_ROSTER[i] || FALLBACK_ROSTER[0];
  const s = r?.stats || {};
  return {
    id: r?.id || f.id,
    nameHe: r?.nameHe || f.nameHe || r?.nameEn || '—',
    nameEn: r?.nameEn || f.nameEn || r?.nameHe || '—',
    color: Number.isFinite(r?.color) ? r.color : f.color,
    color2: Number.isFinite(r?.color2) ? r.color2 : (Number.isFinite(r?.color) ? r.color : f.color2),
    body: r?.body || f.body,
    stats: {
      speed: clamp01to5(s.speed ?? f.stats.speed),
      accel: clamp01to5(s.accel ?? f.stats.accel),
      handling: clamp01to5(s.handling ?? f.stats.handling),
      weight: clamp01to5(s.weight ?? f.stats.weight),
    },
    personality: r?.personality || f.personality,
  };
}
const clamp01to5 = v => Math.max(0, Math.min(5, Number(v) || 0));

export const RACERS = (Array.isArray(ROSTER_IMPORT) && ROSTER_IMPORT.length
  ? ROSTER_IMPORT : FALLBACK_ROSTER).map(normalizeRacer);

const racerAt = i => RACERS[((i % RACERS.length) + RACERS.length) % RACERS.length];
const racerById = id => RACERS.find(r => r.id === id) || RACERS[0];
const racerName = r => (getLang() === 'he' ? (r.nameHe || r.nameEn) : (r.nameEn || r.nameHe));
// Name for a standings row. Resolved from the live roster so a language switch
// re-renders it, and falls back to the name the ledger already resolved rather
// than to an unrelated racer.
const displayName = s => {
  const r = RACERS.find(x => x.id === s.racerId);
  return r ? racerName(r) : (s.name || '—');
};
const hex = c => '#' + (c >>> 0).toString(16).padStart(6, '0');
const mixHex = (a, b, k) => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return `rgb(${Math.round(ar + (br - ar) * k)},${Math.round(ag + (bg - ag) * k)},${Math.round(ab + (bb - ab) * k)})`;
};

const CHAMP_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
const pointsFor = place => CHAMP_POINTS[Math.max(0, (place | 0) - 1)] ?? 0;

// How many races a championship is. Only used to tell "mid-championship" from
// "finished" on the title screen; the authoritative table is track/trackdef.js,
// which this module deliberately does not import (it must render standalone).
const CHAMP_RACES = 3;
const champRace = () => Number(save.read('championshipRace')) || 0;
const champInProgress = () => champRace() > 0 && champRace() < CHAMP_RACES;
const champFinished = () => champRace() >= CHAMP_RACES;

/**
 * Start a fresh championship — the ONE place that clears the ledger.
 *
 * Every key the championship writes has to go, or the new run starts with the
 * old run's wallet, the old run's parts bolted to a kart the child has not built
 * yet, and a certificate quoting a prompt from a championship that is over.
 * `championshipCounted` is the podium's once-per-ledger guard for the
 * championshipsDone counter (see SCENES.podium in scenes.js).
 *
 * Deliberately NOT cleared: lang / quality / muted (preferences), tipsSeen and
 * expertUnlocked (things the child has already been taught — re-teaching them is
 * patronising), and bestLap (a personal record, not championship state).
 */
export function resetChampionship() {
  save.set({
    championshipRace: 0,
    results: [],
    tokens: 0,
    parts: {},
    bestPrompt: null,
    championshipCounted: false,
    // The quiz's cross-race memory. Left behind, a new championship would open
    // with race 1 already "having asked" 20 questions and would start drawing
    // from the tier-2 overflow on its gentlest race.
    championshipAsked: [],
  });
  bus.emit('championship:reset');
}

const REDUCED = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ═════════════════════════════════════════════════════════════════ strings ══ */

registerStrings({
  he: {
    'menu.tagline': 'כותבים פרומפט טוב — ומנצחים במרוץ',
    // One voice across the whole game: impersonal present tense ("מתחילים",
    // "בוחרים", "לוחצים"). It is warm, it is how a 10-year-old is spoken to,
    // and — the reason it is a rule and not a taste — it is gender-neutral,
    // which a masculine imperative ("התחל", "בחר") is not. Half the audience
    // is girls. The garage already worked this way; the rest now matches.
    'menu.start': 'מתחילים אליפות',
    'menu.newChamp': 'אליפות חדשה',
    'menu.continue': 'ממשיכים באליפות',
    'menu.viewPodium': 'לטבלת האליפות',
    'menu.howto': 'איך משחקים',
    'menu.freePlay': 'המוסך של בורג',
    'menu.settings': 'הגדרות',
    'menu.back': 'חזרה',
    'menu.enterHint': 'לוחצים Enter כדי להתחיל',
    'menu.key.steer': 'היגוי',
    'menu.key.gas': 'גז',
    'menu.key.drift': 'החלקה',
    'menu.key.pause': 'הפסקה',
    'menu.key.select': 'בחירה',
    'menu.key.back': 'חזרה',

    'menu.select.title': 'מי נוסע?',
    // Two steps, said in the order a child does them. The old copy ("ולוחצים
    // Enter") described a screen that started the race the moment you picked;
    // choosing and starting are now separate on purpose.
    'menu.select.sub': 'בוחרים דמות בעכבר או בחצים — ואז לוחצים על הכפתור הגדול',
    'menu.select.go': 'לזינוק!',
    'menu.select.you': 'זה אני',
    'menu.select.player': 'הדמות שלכם',
    'menu.select.picked': 'בחרתם:',
    'menu.select.confirm': 'בחירה',
    'menu.stat.speed': 'מהירות',
    'menu.stat.accel': 'תאוצה',
    'menu.stat.handling': 'אחיזה',
    'menu.stat.weight': 'משקל',

    'menu.results.title': 'סיימנו!',
    'menu.results.place': 'מקום',
    'menu.results.racer': 'דמות',
    'menu.results.time': 'זמן',
    'menu.results.gap': 'פער',
    'menu.results.tokens': 'טוקנים שהרווחתם',
    'menu.results.bestlap': 'ההקפה המהירה שלכם',
    'menu.results.garage': 'למוסך',
    'menu.results.next': 'המרוץ הבא',
    'menu.results.menu': 'לתפריט',
    'menu.results.youPlaced': 'סיימתם במקום ה{p}',
    'menu.results.tokenHint': 'טוקנים הם הדלק של המוסך — קונים איתם שדרוגים',

    'menu.podium.champ': 'אלוף האליפות!',
    'menu.podium.done': 'סוף האליפות',
    'menu.podium.congratsWin': 'כל הכבוד, {name}! לקחתם את גביע מרוץ הפרומפטים.',
    'menu.podium.congrats': 'סיימתם את האליפות במקום ה{p}, {name}. מרוץ יפה!',
    'menu.podium.table': 'טבלת האליפות',
    'menu.podium.points': 'נק׳',
    'menu.podium.total': 'סך הנקודות שלכם',
    'menu.podium.again': 'אליפות חדשה',
    'menu.podium.menu': 'לתפריט הראשי',

    'menu.set.title': 'הגדרות',
    'menu.set.lang': 'שפה',
    'menu.set.quality': 'איכות תמונה',
    'menu.set.q.low': 'נמוך',
    'menu.set.q.medium': 'בינוני',
    'menu.set.q.high': 'גבוה',
    'menu.set.sound': 'צלילים',
    'menu.set.on': 'דולק',
    'menu.set.off': 'כבוי',
    'menu.set.reset': 'איפוס התקדמות',
    'menu.set.resetAsk': 'למחוק את כל ההתקדמות? אין דרך חזרה.',
    'menu.set.resetYes': 'כן, למחוק הכול',
    'menu.set.resetNo': 'לא, להשאיר',
    'menu.set.resetDone': 'הכול אופס. מתחילים מחדש!',
    'menu.set.close': 'סגירה',

    // menu.pause.* is registered by ui/pause.js, which owns that screen.

    'menu.how.title': 'איך משחקים',
    'menu.how.driveT': 'נוהגים',
    'menu.how.driveB': 'חצים ימינה ושמאלה מסובבים, חץ למעלה נותן גז.',
    'menu.how.driftT': 'מחליקים',
    'menu.how.driftB': 'רווח בתוך סיבוב = החלקה, ובסוף מקבלים דחיפה.',
    'menu.how.tokenT': 'אוספים טוקנים',
    'menu.how.tokenB': 'כל מרוץ מזכה בטוקנים לפי המקום שסיימתם בו.',
    'menu.how.garageT': 'משדרגים במוסך',
    'menu.how.garageB': 'במוסך כותבים לבורג פרומפט, והוא בונה לכם חלק. פרומפט מדויק = חלק חזק יותר.',
    'menu.how.boreg': 'אני בורג, נעים מאוד!',
    'menu.how.got': 'הבנתי, קדימה!',
  },
  en: {
    'menu.tagline': 'Write a sharper prompt — win the race',
    'menu.start': 'Start Championship',
    'menu.newChamp': 'New Championship',
    'menu.continue': 'Continue Championship',
    'menu.viewPodium': 'Championship Standings',
    'menu.howto': 'How to Play',
    'menu.freePlay': "Boreg's Garage",
    'menu.settings': 'Settings',
    'menu.back': 'Back',
    'menu.enterHint': 'Press Enter to start',
    'menu.key.steer': 'Steer',
    'menu.key.gas': 'Accelerate',
    'menu.key.drift': 'Drift',
    'menu.key.pause': 'Pause',
    'menu.key.select': 'Select',
    'menu.key.back': 'Back',

    'menu.select.title': 'Choose Your Racer',
    'menu.select.sub': 'Pick with the mouse or the arrow keys — then press the big button',
    'menu.select.go': "Let's Race!",
    'menu.select.you': 'YOU',
    'menu.select.player': 'Your racer',
    'menu.select.picked': 'You picked:',
    'menu.select.confirm': 'Choose',
    'menu.stat.speed': 'Speed',
    'menu.stat.accel': 'Accel',
    'menu.stat.handling': 'Handling',
    'menu.stat.weight': 'Weight',

    'menu.results.title': 'Race Complete',
    'menu.results.place': 'Pos',
    'menu.results.racer': 'Racer',
    'menu.results.time': 'Time',
    'menu.results.gap': 'Gap',
    'menu.results.tokens': 'Tokens earned',
    'menu.results.bestlap': 'Your best lap',
    'menu.results.garage': 'To the Garage',
    'menu.results.next': 'Next Race',
    'menu.results.menu': 'Main Menu',
    'menu.results.youPlaced': 'You finished {p}',
    'menu.results.tokenHint': 'Tokens are garage fuel — spend them on upgrades',

    'menu.podium.champ': 'Champion!',
    'menu.podium.done': 'Championship Complete',
    'menu.podium.congratsWin': 'Nice one, {name}! The Prompt Racers cup is yours.',
    'menu.podium.congrats': 'You finished the championship in {p} place, {name}. Great racing!',
    'menu.podium.table': 'Championship Standings',
    'menu.podium.points': 'PTS',
    'menu.podium.total': 'Your total points',
    'menu.podium.again': 'New Championship',
    'menu.podium.menu': 'Main Menu',

    'menu.set.title': 'Settings',
    'menu.set.lang': 'Language',
    'menu.set.quality': 'Graphics',
    'menu.set.q.low': 'Low',
    'menu.set.q.medium': 'Medium',
    'menu.set.q.high': 'High',
    'menu.set.sound': 'Sound',
    'menu.set.on': 'On',
    'menu.set.off': 'Off',
    'menu.set.reset': 'Reset progress',
    'menu.set.resetAsk': 'Erase all progress? There is no undo.',
    'menu.set.resetYes': 'Yes, erase it',
    'menu.set.resetNo': 'No, keep it',
    'menu.set.resetDone': 'All reset. Fresh start!',
    'menu.set.close': 'Close',

    'menu.how.title': 'How to Play',
    'menu.how.driveT': 'Drive',
    'menu.how.driveB': 'Left and right arrows steer, up arrow gives it gas.',
    'menu.how.driftT': 'Drift',
    'menu.how.driftB': 'Hold Space through a corner to drift, then get a boost.',
    'menu.how.tokenT': 'Collect tokens',
    'menu.how.tokenB': 'Every race pays out tokens based on where you finish.',
    'menu.how.garageT': 'Upgrade in the garage',
    'menu.how.garageB': 'Write Boreg a prompt and he builds you a part. Sharper prompt, stronger part.',
    'menu.how.boreg': "I'm Boreg, nice to meet you!",
    'menu.how.got': 'Got it, go!',
  },
});

/* ═════════════════════════════════════════════════════════════════════ css ══ */

const MENU_CSS = `
#ui .mn-root, #ui .mn-root *{pointer-events:auto}
.mn-root{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  overflow:hidden;font-family:var(--font);color:var(--txt);--pad:clamp(10px,min(3vw,3.2vh),40px)}
.mn-scrim{position:absolute;inset:0;pointer-events:none;
  background:
    radial-gradient(115% 80% at 50% 34%,rgba(0,0,0,0) 40%,rgba(7,5,12,.55) 100%),
    linear-gradient(180deg,rgba(9,7,16,.52) 0%,rgba(9,7,16,.02) 38%,rgba(6,4,11,.70) 100%);}
.mn-stage{position:relative;width:100%;height:100%;display:flex;flex-direction:column;
  align-items:center;padding:var(--pad);gap:clamp(6px,1.6vh,20px);overflow-y:auto;overflow-x:hidden}

/* warm focus ring — the token blue fights the gold on these screens */
.mn-root .btn:focus-visible,.mn-root .mn-card:focus-visible,
.mn-ov .btn:focus-visible,.mn-ov .mn-seg button:focus-visible,.mn-ov .mn-danger:focus-visible{
  outline:3px solid rgba(255,255,255,.92);outline-offset:3px}

/* ---------- title ---------- */
.mn-center{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:clamp(6px,1.6vh,18px);width:100%}
.mn-hero{position:relative;display:flex;flex-direction:column;align-items:center}
.mn-burst{position:absolute;inset:-14% -22%;pointer-events:none;opacity:.5;
  background:
    radial-gradient(52% 52% at 50% 52%,rgba(255,194,71,.30),rgba(255,140,40,.08) 55%,transparent 72%),
    conic-gradient(from -14deg at 50% 52%,rgba(255,205,110,.16) 0 5deg,transparent 5deg 22deg,
      rgba(255,205,110,.13) 22deg 27deg,transparent 27deg 46deg,rgba(255,205,110,.16) 46deg 51deg,
      transparent 51deg 70deg,rgba(255,205,110,.12) 70deg 75deg,transparent 75deg 96deg);
  filter:blur(3px)}
.mn-swoosh{position:absolute;inset-block-end:2%;inset-inline:2%;height:26%;pointer-events:none;
  background:radial-gradient(60% 100% at 50% 50%,rgba(255,196,80,.85),rgba(255,150,40,.22) 45%,transparent 74%);
  filter:blur(14px);opacity:.7;transform:rotate(-2deg)}
/* Flat chequer at mid-grey reads as a Photoshop transparency grid. Perspective
   tapers the squares and near-black/near-white restores the flag contrast. */
.mn-ribbon{position:absolute;inset-block-end:1%;inset-inline:13%;height:clamp(28px,4.6vh,50px);
  pointer-events:none;transform-origin:50% 100%;
  transform:rotate(-2.6deg) perspective(320px) rotateX(56deg);
  background:repeating-conic-gradient(#ffffff 0% 25%,#0d0b14 0% 50%) 0 0/26px 26px;
  -webkit-mask-image:radial-gradient(72% 120% at 50% 40%,#000 30%,transparent 78%);
  mask-image:radial-gradient(72% 120% at 50% 40%,#000 30%,transparent 78%);
  filter:drop-shadow(0 4px 10px rgba(0,0,0,.65))}
.mn-ribbon.two{inset-block-end:9%;inset-inline-start:auto;inset-inline-end:6%;width:26%;
  height:clamp(18px,3vh,32px);transform:rotate(6deg) perspective(280px) rotateX(62deg);
  background-size:18px 18px;opacity:.85}
.mn-logo{position:relative;text-align:center;display:flex;flex-direction:column;align-items:center;
  line-height:.86}
/* Hebrew system faces stop at Bold, so 900 buys nothing: the extra weight has to
   come from a same-hue stroke that fattens the stems without shifting colour. */
.mn-logo .l1,.mn-logo .l2{transform-origin:50% 60%}
.mn-logo .l1{font-size:clamp(38px,min(8vw,10.5vh),112px);letter-spacing:.24em;
  transform:rotate(1.2deg) scaleY(1.06);-webkit-text-stroke:.055em #14111d;
  padding-inline-start:.24em;padding-inline-end:.06em;margin-block-end:.06em}
.mn-logo .l2{font-size:clamp(50px,min(12.2vw,17vh),172px);margin-block-start:-.06em;
  transform:rotate(-1.8deg) scaleY(1.07);-webkit-text-stroke:.048em #16121f;padding:0 .06em}
.rtl .mn-logo .l1,.rtl .mn-logo .l2,.rtl .mn-root .display{letter-spacing:.015em}
.rtl .mn-logo .l1{letter-spacing:.16em}
.mn-tagline{margin-block-start:clamp(6px,1.4vh,18px);font-size:clamp(12px,min(1.6vw,2.2vh),20px);
  font-weight:800;letter-spacing:.2em;color:#ffd99a;text-shadow:0 2px 12px rgba(0,0,0,.85)}
.rtl .mn-tagline{letter-spacing:.03em}
.mn-menu{display:flex;flex-direction:column;align-items:center;gap:12px;margin-block-start:clamp(8px,2.4vh,28px)}
.mn-btn-xl{font-size:clamp(16px,min(1.7vw,2.4vh),23px);padding:clamp(12px,1.9vh,18px) clamp(32px,4.4vw,56px);
  box-shadow:0 6px 0 #a4620a,0 0 46px -8px rgba(255,194,71,.85),0 12px 26px rgba(0,0,0,.5),
    0 1px 0 rgba(255,255,255,.6) inset}
.mn-btn-row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
.mn-press{font-size:12px;font-weight:800;letter-spacing:.2em;color:rgba(244,241,234,.72);
  margin-block-start:6px;animation:mnPulse 2.4s var(--ease) infinite}
.rtl .mn-press{letter-spacing:.04em}
@keyframes mnPulse{0%,100%{opacity:.45}50%{opacity:1}}
.mn-spacer{flex:1 1 auto}
.mn-keys{display:flex;gap:clamp(8px,1.4vw,18px);flex-wrap:wrap;justify-content:center;
  align-items:center;padding-block-end:6px}
.mn-key{display:flex;align-items:center;gap:7px}
.mn-key b{font-size:11px;font-weight:800;letter-spacing:.12em;color:rgba(244,241,234,.62);text-transform:uppercase}
.rtl .mn-key b{letter-spacing:.02em}
.mn-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:28px;
  padding:0 8px;border-radius:8px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.2);
  box-shadow:0 2px 0 rgba(0,0,0,.45),0 1px 0 rgba(255,255,255,.15) inset;
  font-size:12px;font-weight:800;color:#f4f1ea;direction:ltr;unicode-bidi:isolate}

/* ---------- shared screen head ---------- */
.mn-head{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.mn-h1{font-size:clamp(26px,min(5.2vw,7.4vh),70px);padding:0 .08em;
  text-shadow:
    0 -1px 0 rgba(255,255,255,.5),
    .038em 0 0 #16121f,-.038em 0 0 #16121f,0 .038em 0 #16121f,0 -.038em 0 #16121f,
    .027em .027em 0 #16121f,-.027em .027em 0 #16121f,
    .027em -.027em 0 #16121f,-.027em -.027em 0 #16121f,
    .034em .015em 0 #16121f,-.034em .015em 0 #16121f,
    .015em .034em 0 #16121f,-.015em .034em 0 #16121f,
    .034em -.015em 0 #16121f,-.034em -.015em 0 #16121f,
    0 .055em 0 rgba(0,0,0,.45)}
.mn-sub{font-size:clamp(12px,1.2vw,15px);font-weight:700;letter-spacing:.13em;color:rgba(244,241,234,.66)}
.rtl .mn-sub{letter-spacing:.02em}

/* ---------- shared back button ---------- */
/* The head keeps its centred title; the back button floats at the inline start so
   it never steals width from it, and falls back into the flow when there is none. */
.mn-headrow{position:relative;width:100%;display:flex;justify-content:center;align-items:center;
  gap:10px;flex-wrap:wrap}
.mn-headrow .mn-head{flex:1 1 auto}
.mn-back{display:inline-flex;align-items:center;gap:6px;font-size:14px;padding:9px 18px;flex:none}
.mn-back span{font-size:15px;line-height:1;opacity:.8;direction:ltr;unicode-bidi:isolate}
@media (min-width:900px){
  /* z-index, because the centred .mn-head next to it spans the FULL row width
     and therefore overlaps this button's rectangle. Paint order alone kept the
     button on top only while .mn-head's opacity was exactly 1 — during its
     .35s fade-in the animated opacity gives it a stacking context of its own
     and it swallows every click aimed at "back". A child who reaches for the
     back button the moment the screen appears hits nothing. Caught by the
     hit-test in tools/selecttest.mjs section 7. */
  .mn-back{position:absolute;inset-inline-start:0;inset-block-start:0;z-index:2}
}

/* ---------- the global route home (attachHomeControl) ---------- */
/* Screens that are not built by baseScreen() — the race and the garage — used to
   have no visible way out at all: the race only answered the Escape key and the
   garage answered nothing, so a child who opened the garage from the home menu
   was stuck inside it until they finished a four-step prompt. This is the one
   affordance they all now share: same pill, same inline-start corner, same word
   as the racer-select back button, mounted into engine.ui (NOT into the scene's
   own DOM, which those two modules rebuild from scratch on every interaction). */
/* Solid, not ghost: this one floats over bright gameplay (a desert sky at noon),
   where the translucent-white ghost fill is invisible. Same card treatment the
   HUD uses, so it still reads as part of the same product. */
#ui .mn-home{position:absolute;z-index:20;inset-block-start:18px;inset-inline-start:18px;
  pointer-events:auto;color:var(--txt);border:1px solid var(--stroke-hi);
  background:linear-gradient(180deg,rgba(52,52,72,.94),rgba(20,20,31,.96));
  box-shadow:0 0 0 1px rgba(0,0,0,.45),0 8px 20px rgba(0,0,0,.5)}
#ui .mn-home:hover{background:linear-gradient(180deg,rgba(70,70,96,.96),rgba(30,30,44,.97))}
#ui .mn-home span{opacity:1}
/* The race's own lap card owns the top corner, so the race copy drops below it. */
#ui .mn-home.below{inset-block-start:calc(18px + 4.7em)}
/* The garage top bar starts in that corner; give the button its own lane rather
   than floating on top of the title. */
#ui .grg-root .grg-top{padding-inline-start:104px}
/* Anything that owns the screen hides it: a dialog, a garage scrim (Boreg's
   introduction, the token explainer, the reveal) all have their own way out, and
   a button floating over a modal is exactly the "covered control" this audit was
   called to kill. The QUIZ is deliberately absent — D20 keeps the pause menu
   reachable from a frozen quiz, so the race's button must stay live over it. */
#ui:has(.mn-ov) .mn-home,
#ui:has(.grg-scrim) .mn-home,
#ui:has(.grgtok-scrim) .mn-home{display:none}

/* ---------- racer select ---------- */
/* The card is deliberately a TRANSPARENT frame with an opaque lower body: the
   upper .mn-view is a window punched through the overlay so the real 3D kart,
   drawn on the GL canvas underneath, is seen through it. Anything opaque or
   backdrop-filtered over that rectangle (the old card background did both) puts
   frosted glass in front of the kart. See makeKartStage() in racerSelectScene. */
/* The column count is CSS's job, not JavaScript's.
   It used to be an inline grid-template-columns written from the width handed
   to resize(), which meant the roster's ROW COUNT — and therefore the height of
   the whole screen — was a piece of JS state that could go stale. When the
   resize signal did not arrive (headless Chrome does not always deliver a
   window resize event for a viewport change, and engine.width stayed at the boot
   800), the grid kept the 3 columns it was built with while the viewport was
   1600 or 1920 wide: 8 cards became 3 rows instead of 2, ~290px taller, and the
   "לזינוק!" CTA — the only door off this screen — was pushed under the bottom
   edge. That is why the failure looked width-dependent and skipped 1440x900 at
   the same height as a failing 1600x900: it was not the height maths, it was
   which resize events happened to land.
   Media queries cannot go stale, so the row count can no longer drift from the
   viewport. The breakpoints mirror colsFor() exactly; JS now READS the column
   count back off the layout for keyboard navigation instead of dictating it. */
.mn-grid{display:grid;gap:clamp(8px,min(1.1vw,1.6vh),16px);width:min(1360px,100%);margin:0 auto;
  grid-template-columns:repeat(1,minmax(0,1fr))}
@media (min-width:520px){ .mn-grid{grid-template-columns:repeat(2,minmax(0,1fr))} }
@media (min-width:740px){ .mn-grid{grid-template-columns:repeat(3,minmax(0,1fr))} }
@media (min-width:1000px){ .mn-grid{grid-template-columns:repeat(4,minmax(0,1fr))} }
.mn-card{position:relative;border-radius:var(--r-m);cursor:pointer;background:none;border:0;padding:0;
  display:flex;flex-direction:column;
  transition:transform .16s var(--ease)}
.mn-card::after{content:"";position:absolute;inset:-3px;border-radius:calc(var(--r-m) + 3px);
  border:3px solid var(--sel);box-shadow:0 0 0 2px rgba(0,0,0,.45),0 0 42px 2px var(--sel);
  opacity:0;transition:opacity .16s var(--ease);pointer-events:none}
.mn-card:hover{transform:translateY(-3px)}
.mn-card.sel{transform:translateY(-6px) scale(1.035);z-index:2}
.mn-card.sel::after{opacity:1}
.mn-card.dim .mn-cname{color:rgba(244,241,234,.86)}
.mn-card.dim .mn-fill{filter:saturate(.85) brightness(.92);box-shadow:none}
.mn-card:focus-visible{outline:3px solid var(--info);outline-offset:4px}
/* the window onto the 3D kart — no background, no blur, nothing in front of it */
.mn-view{position:relative;height:clamp(74px,min(9.6vw,13vh),150px);
  border-radius:var(--r-m) var(--r-m) 0 0;border:1px solid var(--stroke);border-block-end:0}
.mn-card.sel .mn-view{border-color:var(--sel)}
/* Unselected karts are scrimmed rather than desaturated: a CSS filter cannot
   reach pixels drawn on the canvas below, and a dark veil is the clearest
   "these are the ones you did NOT pick" a 8-year-old can read at a glance. */
/* .40, not the .52 this started at: the whole point of the screen is that a
   child can tell eight racers apart at a glance, and a veil heavy enough to
   settle the "which one is picked" question was also heavy enough to turn the
   other seven into silhouettes. The selected card carries a gold ring, a lift,
   a tick and the "זה אני" badge — the veil only has to be the quietest of the
   four cues, not the loudest. Measured by tools/selecttest.mjs, which fails if
   any two card windows stop being visually distinguishable. */
.mn-view::after{content:"";position:absolute;inset:0;border-radius:inherit;
  background:rgba(7,6,13,.40);opacity:0;transition:opacity .18s var(--ease)}
.mn-card.dim .mn-view::after{opacity:1}
.mn-card.dim:hover .mn-view::after{opacity:.30}
.mn-body{position:relative;padding:8px 10px 11px;border-radius:0 0 var(--r-m) var(--r-m);
  background:linear-gradient(180deg,rgba(38,36,54,.86),rgba(14,13,22,.94));
  backdrop-filter:blur(7px);
  border:1px solid var(--stroke);border-block-start:0;
  box-shadow:0 12px 26px rgba(0,0,0,.55),0 1px 0 rgba(255,255,255,.07) inset}
.mn-card.sel .mn-body{border-color:var(--sel)}
.mn-you{position:absolute;z-index:3;inset-block-start:8px;inset-inline-end:8px;
  background:linear-gradient(180deg,var(--gold-1),var(--gold-3));color:#2a1c00;
  font-size:12px;font-weight:900;letter-spacing:.06em;padding:3px 10px;border-radius:var(--r-pill);
  box-shadow:0 2px 8px rgba(0,0,0,.5)}
.mn-tick{position:absolute;z-index:3;inset-block-start:6px;inset-inline-start:6px;display:none;
  width:26px;height:26px;border-radius:50%;align-items:center;justify-content:center;
  background:linear-gradient(180deg,#8fe38a,#2a9b46);color:#08210f;font-size:16px;font-weight:900;
  box-shadow:0 2px 10px rgba(0,0,0,.6),0 0 0 2px rgba(255,255,255,.35) inset}
.mn-card.sel .mn-tick{display:flex}
.mn-cname{font-size:clamp(14px,min(1.5vw,2.3vh),21px);font-weight:900;letter-spacing:-.01em}
/* the picked-racer readout above the start button — the screen must say out
   loud who is about to drive, because the button no longer names it by itself */
.mn-picked{display:flex;align-items:center;justify-content:center;gap:10px;
  margin-block-start:clamp(4px,1vh,10px);font-size:clamp(13px,1.5vh,16px);font-weight:800;
  color:var(--txt-dim)}
.mn-picked b{font-size:clamp(16px,2.2vh,23px);font-weight:900;color:var(--gold-1)}
.mn-picked i{width:14px;height:14px;border-radius:5px;font-style:normal;
  box-shadow:0 0 10px -2px currentColor}
.mn-ctag{font-size:11px;font-weight:600;color:var(--txt-dim);min-height:14px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mn-stats{margin-block-start:8px;display:flex;flex-direction:column;gap:5px}
.mn-stat{display:grid;grid-template-columns:minmax(46px,auto) 1fr;align-items:center;gap:8px}
.mn-stat span{font-size:11px;font-weight:800;letter-spacing:.06em;color:rgba(244,241,234,.72);
  text-transform:uppercase}
.rtl .mn-stat span{letter-spacing:0;font-size:11.5px}
.mn-track{height:7px;border-radius:var(--r-pill);background:rgba(255,255,255,.09);overflow:hidden}
.mn-fill{display:block;height:100%;border-radius:var(--r-pill);width:0;
  transition:width .5s var(--ease);box-shadow:0 0 10px -2px currentColor}
.mn-go{margin-block-start:clamp(6px,1.6vh,16px)}
.mn-go .btn{box-shadow:0 6px 0 #a4620a,0 0 40px -6px rgba(255,194,71,.75),0 12px 26px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.6) inset}
/* Racer select is the tallest screen in the game — eight cards, a CTA and a key
   legend — and it was overflowing the stage by 6px at 1366x768, 23px at
   1280x720 and 46px at 1024x640, which pushed the legend clean off the bottom.
   The layout gate did not see it because it only fails on clipped INTERACTIVE
   elements and a key hint is a span.
   Everything given back below is chrome: stage gaps, card padding, stat spacing.
   The kart windows are deliberately untouched — a child telling eight racers
   apart at 1024x640 is the entire purpose of the screen, and shrinking the one
   thing it exists for to save a legend would be the wrong trade. */
@media (max-height:790px){
  .mn-select .mn-stage{gap:clamp(4px,1vh,12px);padding:clamp(8px,2vh,20px)}
  .mn-select .mn-body{padding:6px 9px 8px}
  .mn-select .mn-stats{margin-block-start:5px;gap:3px}
  .mn-select .mn-ctag{min-height:0}
  .mn-select .mn-picked{margin-block-start:2px}
  .mn-select .mn-go{margin-block-start:clamp(4px,1vh,10px)}
}

/* ---------- results ---------- */
.mn-rows{min-height:0;overflow-y:auto;overflow-x:hidden}
.mn-sheet{display:flex;flex-direction:column;min-height:0;width:min(820px,100%);padding:clamp(10px,min(1.6vw,2vh),20px);border-radius:var(--r-l)}
.mn-tablehead,.mn-row{display:grid;grid-template-columns:46px 1fr 96px 84px;gap:10px;align-items:center}
.mn-tablehead{padding:0 12px 6px;font-size:10px;font-weight:800;letter-spacing:.12em;
  color:var(--txt-dim);text-transform:uppercase}
.mn-tablehead>:nth-child(3),.mn-tablehead>:nth-child(4){text-align:start}
.rtl .mn-tablehead{letter-spacing:.02em;font-size:11px}
.mn-row{padding:clamp(2px,.7vh,6px) 12px;border-radius:11px;background:rgba(255,255,255,.035);
  margin-block-end:clamp(3px,.6vh,5px);
  border:1px solid transparent}
.mn-row.me{background:linear-gradient(90deg,rgba(255,194,71,.20),rgba(255,194,71,.07));
  border-color:rgba(255,194,71,.55);box-shadow:0 0 22px -6px rgba(255,194,71,.6)}
.mn-pos{width:clamp(26px,4.4vh,34px);height:clamp(26px,4.4vh,34px);border-radius:9px;display:flex;
  align-items:center;justify-content:center;font-weight:900;font-size:clamp(13px,2.2vh,16px);
  background:rgba(255,255,255,.07);color:#f4f1ea}
.mn-pos.p1{background:linear-gradient(180deg,#ffe9a8,#f59310);color:#2a1c00}
.mn-pos.p2{background:linear-gradient(180deg,#e9edf4,#9aa3b0);color:#22222e}
.mn-pos.p3{background:linear-gradient(180deg,#f0bf8e,#b9713a);color:#2a1c00}
.mn-who{display:flex;align-items:center;gap:9px;min-width:0}
.mn-chip{width:14px;height:14px;border-radius:5px;flex:none;box-shadow:0 0 10px -2px currentColor}
.mn-who b{font-size:clamp(13px,2.2vh,16px);font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mn-time{font-size:clamp(12px,2.1vh,15px)}
.mn-gap{font-size:13px;color:var(--txt-dim);text-align:start}
.mn-reveal{animation:mnRow .34s var(--ease) both}
/* Individual properties, not the transform shorthand — a both-filled keyframe
   ending on transform:none outranks every hover/positioning transform on the
   element forever. Same rule as popIn in ui/style.js. */
@keyframes mnRow{from{opacity:0;translate:0 10px;scale:.98}to{opacity:1;translate:0 0;scale:1}}
.mn-awards{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-block-start:clamp(6px,1.2vh,10px)}
.mn-award{flex:1 1 220px;display:flex;align-items:center;gap:12px;padding:clamp(5px,1.2vh,9px) 16px;border-radius:var(--r-m);
  background:linear-gradient(180deg,rgba(255,214,107,.16),rgba(255,214,107,.04));
  border:1px solid rgba(255,214,107,.35)}
.mn-award .k{font-size:11px;font-weight:800;letter-spacing:.1em;color:#f6d79a}
.rtl .mn-award .k{letter-spacing:.02em}
.mn-award .v{font-size:clamp(18px,min(2.2vw,3.2vh),30px);line-height:1.05;color:var(--gold-1)}
.mn-coin{width:clamp(28px,5vh,40px);height:clamp(28px,5vh,40px);flex:none;filter:drop-shadow(0 4px 10px rgba(0,0,0,.5))}
.mn-hint{margin-block-start:clamp(4px,1vh,8px);text-align:center;font-size:12px;color:var(--txt-dim)}

/* ---------- podium ---------- */
.mn-podium-top{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;
  padding:10px clamp(20px,5vw,70px) 16px;margin-block-start:clamp(2px,1.5vh,14px);
  text-shadow:0 3px 18px rgba(0,0,0,.85)}
.mn-podium-top::before{content:"";position:absolute;inset:-30% -10%;pointer-events:none;
  background:radial-gradient(58% 62% at 50% 46%,rgba(8,6,14,.82),rgba(8,6,14,.45) 55%,transparent 78%)}
.mn-podium-top>*{position:relative}
/* text-wrap:balance so the English sentence cannot break mid-phrase
   ("…in 2nd place, Spark. Great / racing!"): balanced lines split at the widest
   available break, which for this copy is the sentence boundary. */
.mn-congrats{font-size:clamp(12px,min(1.5vw,2.2vh),19px);font-weight:700;color:#ffeec4;
  max-width:44ch;text-align:center;text-wrap:balance}
/* Vertically centred by AUTO MARGINS between two insets, never by
   translateY(-50%): .mn-side carries .pop-in, whose keyframe used to persist
   transform:none and delete the centring half of the rule — the panel then hung
   from the vertical middle downwards, overlapping .mn-bottom in English and
   pushing the total row off the bottom edge below 768px. See the popIn note in
   ui/style.js. The two insets double as the height guard: the panel can never
   start above --mn-side-top, and --mn-side-bot reserves the band the button row
   lives in, so at 1024x640 and below it shrinks (and scrolls, last resort)
   instead of running off the screen. */
.mn-side{position:absolute;
  --mn-side-top:clamp(8px,2vh,20px);
  --mn-side-bot:clamp(76px,13vh,124px);
  inset-block-start:var(--mn-side-top);inset-block-end:var(--mn-side-bot);
  block-size:fit-content;margin-block:auto;
  max-block-size:calc(100% - var(--mn-side-top) - var(--mn-side-bot));overflow-y:auto;
  inset-inline-end:clamp(14px,3vw,44px);width:min(340px,32vw);padding:14px 16px}
.mn-side h3{margin:0 0 10px;font-size:12px;font-weight:800;letter-spacing:.12em;color:var(--txt-dim);
  text-transform:uppercase}
.rtl .mn-side h3{letter-spacing:.02em;font-size:13px}
.mn-prow{display:grid;grid-template-columns:26px 1fr auto;gap:10px;align-items:center;
  padding:6px 8px;border-radius:9px;font-size:14px}
.mn-prow.me{background:rgba(255,194,71,.18);box-shadow:inset 0 0 0 1px rgba(255,194,71,.45)}
.mn-prow i{font-style:normal;font-weight:900;color:var(--txt-dim);font-variant-numeric:tabular-nums}
.mn-prow.me i{color:var(--gold-1)}
.mn-prow b{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mn-prow em{font-style:normal;font-weight:900;color:var(--gold-1);font-variant-numeric:tabular-nums}
.mn-total{margin-block-start:10px;padding-block-start:10px;border-block-start:1px solid var(--stroke);
  display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.mn-total b{font-size:12px;color:var(--txt-dim);font-weight:800}
.mn-total em{font-style:normal;font-size:26px;color:var(--gold-1)}
/* Same story horizontally: auto margins between inset-inline:0, not
   translateX(-50%), because .mn-bottom is a .pop-in too. */
.mn-bottom{position:absolute;inset-block-end:clamp(16px,4vh,46px);inset-inline:0;
  inline-size:fit-content;max-inline-size:calc(100% - 28px);margin-inline:auto;
  display:flex;gap:12px;flex-wrap:wrap;justify-content:center}

/* ---------- overlays ---------- */
.mn-ov{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
  background:rgba(6,5,12,.68);backdrop-filter:blur(10px);font-family:var(--font);color:var(--txt);
  animation:fadeIn .18s var(--ease) both;padding:20px;overflow:auto}
/* #ui sets a blanket pointer-events:none via an id selector, which outranks a bare
   class, so overlays mounted inside #ui must re-enable hit testing at that weight. */
.mn-ov *{pointer-events:auto}
#ui .mn-ov,#ui .mn-ov *{pointer-events:auto}
.mn-dialog{width:min(560px,100%);padding:clamp(18px,2.4vw,30px);animation:popIn .22s var(--ease) both}
.mn-dialog.wide{width:min(880px,100%)}
.mn-dialog h2{margin:0 0 4px;font-size:clamp(20px,min(2.6vw,3.6vh),32px);font-weight:900}
.mn-drow{display:flex;align-items:center;justify-content:space-between;gap:14px;
  padding:12px 4px;border-block-end:1px solid var(--stroke)}
.mn-drow>span{font-size:15px;font-weight:700}
.mn-seg{display:flex;gap:6px;background:rgba(0,0,0,.35);padding:4px;border-radius:var(--r-pill);
  border:1px solid var(--stroke)}
.mn-seg button{font-family:var(--font);font-size:13px;font-weight:800;color:var(--txt-dim);
  padding:7px 15px;border:0;border-radius:var(--r-pill);background:transparent;cursor:pointer;
  transition:color .14s,background .14s}
.mn-seg button:hover{color:var(--txt)}
.mn-seg button.act{background:linear-gradient(180deg,var(--gold-1),var(--gold-2) 60%,var(--gold-3));
  color:#2a1c00;box-shadow:0 2px 8px rgba(0,0,0,.45)}
.mn-seg button:focus-visible{outline:3px solid var(--info);outline-offset:2px}
.mn-danger{background:rgba(255,107,107,.14);border:1px solid rgba(255,107,107,.5);color:#ffd5d5;
  font-weight:800;font-size:14px;padding:11px 20px;border-radius:var(--r-pill);cursor:pointer;
  font-family:var(--font)}
.mn-danger:hover{background:rgba(255,107,107,.24)}
.mn-danger:focus-visible{outline:3px solid var(--info);outline-offset:2px}
.mn-ok{color:var(--good);font-size:13px;font-weight:800}
.mn-acts{display:flex;gap:10px;justify-content:center;margin-block-start:18px;flex-wrap:wrap}
.mn-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-block-start:14px}
.mn-hcard{position:relative;padding:16px 14px;border-radius:var(--r-m);
  background:linear-gradient(180deg,color-mix(in srgb,var(--hue) 20%,transparent),rgba(255,255,255,.02));
  border:1px solid color-mix(in srgb,var(--hue) 45%,transparent);
  display:flex;flex-direction:column;gap:8px;align-items:center;text-align:center}
.mn-hcard::before{content:"";position:absolute;inset-block-start:0;inset-inline:18%;height:3px;
  border-radius:0 0 3px 3px;background:var(--hue)}
.mn-hcard svg{width:74px;height:74px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.5))}
.mn-hcard b{font-size:17px;font-weight:900;color:var(--hue)}
.mn-boregrow{display:flex;align-items:center;gap:10px;margin-block-start:14px}
.mn-boreg{width:58px;height:58px;flex:none;filter:drop-shadow(0 4px 10px rgba(0,0,0,.55))}
.mn-bubble{position:relative;font-size:14px;font-weight:800;color:#0e0c16;
  background:linear-gradient(180deg,var(--gold-1),var(--gold-2));
  padding:9px 16px;border-radius:var(--r-pill);box-shadow:0 4px 14px rgba(0,0,0,.45)}
.mn-bubble::before{content:"";position:absolute;inset-block-end:10px;inset-inline-start:-6px;
  width:12px;height:12px;background:var(--gold-1);transform:rotate(45deg)}
.mn-hcard p{margin:0;font-size:13px;line-height:1.45;color:rgba(244,241,234,.82)}

/* previews/screenshots: settle instantly so a still frame shows the final layout */
.mn-instant *,.mn-instant{animation-duration:.001s !important;animation-delay:0s !important}
@media (prefers-reduced-motion:reduce){
  .mn-root *,.mn-ov *{animation-duration:.001s !important;animation-delay:0s !important}
  .mn-press{animation:none;opacity:.85}
}
@media (max-width:640px){
  .mn-side{position:static;inset:auto;block-size:auto;max-block-size:none;overflow-y:visible;
    margin-block:12px 0;margin-inline:0;width:100%}
}
`;

function injectMenuCSS() {
  injectStyles();
  if (document.getElementById('pr-menus-style')) return;
  const el = document.createElement('style');
  el.id = 'pr-menus-style';
  el.textContent = MENU_CSS;
  document.head.appendChild(el);
}

/* ════════════════════════════════════════════════════════════════ backdrop ══ */

let _backdropFactory = null;

/** Lead wires the real blurred-gameplay scene in here: setBackdrop(engine => sceneObj). */
export function setBackdrop(threeSceneFactory) { _backdropFactory = threeSceneFactory || null; }

const BACKDROP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform int uTaps;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// soft blob — nothing in this backdrop has a hard edge: it must read as a
// depth-of-field blurred gameplay frame, not as flat vector art.
float blob(vec2 uv, vec2 c, vec2 r){
  vec2 d = (uv - c) / r;
  return 1.0 - smoothstep(0.35, 1.0, length(d));
}

const float HZ = 0.575;

vec3 sceneCol(vec2 P){
  float x = P.x, y = P.y;
  float hz = HZ;

  // --- sky: multi-stop, structured, warm at the horizon ---
  vec3 top  = vec3(0.080, 0.072, 0.160);
  vec3 mid  = vec3(0.300, 0.196, 0.246);
  vec3 haze = vec3(0.960, 0.590, 0.270);
  float sk = clamp((y - hz) / (1.0 - hz), 0.0, 1.0);
  vec3 col = mix(mix(haze, mid, smoothstep(0.0, 0.40, sk)), top, smoothstep(0.32, 1.0, sk));

  // banded cloud structure
  float band = sin((y * 22.0) + sin(x * 2.7 + uTime * 0.03) * 1.8 + uTime * 0.05);
  col += vec3(0.13, 0.07, 0.03) * smoothstep(0.45, 1.0, band) * smoothstep(0.02, 0.55, sk) * (1.0 - sk * 0.65);

  // --- sun disc + bloom, low and warm ---
  vec2 sp = vec2(0.700, hz + 0.050);
  float sd = length((vec2(x, y) - sp) * vec2(1.0, 1.25));
  col += vec3(1.0, 0.72, 0.36) * (0.46 * exp(-sd * 6.0) + 0.90 * exp(-sd * 28.0));

  // --- far mesas, lifted toward the sky colour (atmospheric perspective) ---
  float ridge = hz + 0.090 + 0.048 * sin(x * 3.6 + 0.7) + 0.030 * sin(x * 8.3 + 2.1)
              + 0.060 * smoothstep(0.26, 0.0, abs(x - 0.16));
  float m = smoothstep(ridge + 0.006, ridge - 0.010, y) * smoothstep(hz - 0.02, hz + 0.01, y);
  col = mix(col, mix(vec3(0.40, 0.235, 0.205), haze, 0.46), m * 0.95);

  // glowing haze right on the horizon line — the single cheapest depth cue
  col += haze * 0.34 * exp(-abs(y - hz) * 42.0);

  // --- ground plane, fogged toward the horizon ---
  float g = smoothstep(hz + 0.008, hz - 0.010, y);
  float depth = clamp((hz - y) / hz, 0.0, 1.0);
  vec3 ground = mix(mix(haze * 0.88, vec3(0.325, 0.180, 0.130), smoothstep(0.0, 0.42, depth)),
                    vec3(0.150, 0.092, 0.082), smoothstep(0.28, 1.0, depth));
  col = mix(col, ground, g);
  // sand speckle / aggregate grain (the blur taps average this into fine texture)
  float grainAmt = uTaps > 1 ? 0.16 : 0.055;
  col *= 1.0 + (hash(floor(vec2(x, y) * 420.0)) - 0.5) * grainAmt * g;

  // --- the road: a wide asphalt wedge sweeping away to the right ---
  float s = depth;
  float w = 0.028 + 0.60 * s * s + 0.11 * s;
  float cx = 0.50 + 0.40 * s * s - 0.05 * s;
  float dx = abs(x - cx);
  float road = g * (1.0 - smoothstep(w * 0.88, w * 1.10, dx));
  vec3 asphalt = mix(vec3(0.285, 0.230, 0.235), vec3(0.105, 0.086, 0.100), smoothstep(0.0, 0.85, s));
  asphalt *= 1.0 + (hash(floor(vec2(x, y) * 260.0 + 7.0)) - 0.5) * (grainAmt * 1.4);
  col = mix(col, asphalt, road * 0.95);

  // white edge lines + red/white curbing
  float edge = smoothstep(0.030 * (0.22 + s), 0.0, abs(dx - w * 0.96));
  col += vec3(0.88, 0.82, 0.74) * edge * road * 0.55;
  float curb = smoothstep(0.060 * (0.28 + s), 0.0, abs(dx - w * 1.14)) * g;
  float stripe = step(0.5, fract((s * 8.0) + (x * 2.4) + uTime * 0.10));
  col = mix(col, mix(vec3(0.88, 0.85, 0.80), vec3(0.70, 0.15, 0.13), stripe), curb * 0.50);

  // --- barrier + crowd band along the horizon ---
  float bandTop = hz + 0.022 + 0.007 * sin(x * 47.0) + 0.005 * sin(x * 19.0 + 1.4);
  float crowd = smoothstep(bandTop, bandTop - 0.010, y) * smoothstep(hz - 0.008, hz + 0.006, y);
  col = mix(col, mix(vec3(0.22, 0.14, 0.17), haze, 0.34), crowd * 0.78);

  // --- distant palms: small, hazy, sitting ON the horizon ---
  for (int i = 0; i < 5; i++){
    float fi = float(i);
    float px = -0.10 + fi * 0.300 + 0.045 * sin(fi * 3.7);
    float hh = 0.030 + 0.013 * sin(fi * 2.3);
    float trunk = (1.0 - smoothstep(0.0016, 0.0042, abs(x - px)))
                * smoothstep(hz + hh, hz + hh - 0.008, y)
                * smoothstep(hz - 0.010, hz + 0.004, y);
    float crown = blob(vec2(x, y), vec2(px, hz + hh), vec2(0.030, 0.014))
                + blob(vec2(x, y), vec2(px - 0.020, hz + hh - 0.006), vec2(0.018, 0.009))
                + blob(vec2(x, y), vec2(px + 0.022, hz + hh - 0.005), vec2(0.016, 0.008));
    float pm = clamp(trunk + crown, 0.0, 1.0);
    col = mix(col, mix(vec3(0.15, 0.095, 0.105), haze, 0.26), pm * 0.88);
  }

  // --- blurred karts up the road (motion, no readable detail) ---
  for (int i = 0; i < 4; i++){
    float fi = float(i);
    float k = fract(0.12 + fi * 0.25 + uTime * 0.030);
    float ks = 0.30 + k * 0.52;
    float kw = 0.016 + (1.0 - ks) * 0.070;
    vec2 kc = vec2(0.50 + 0.40 * (1.0 - ks) * (1.0 - ks) - 0.05 * (1.0 - ks) + (fi - 1.5) * kw * 1.4,
                   hz * (1.0 - ks) * 1.0 + kw * 0.55);
    float b = blob(vec2(x, y), kc, vec2(kw, kw * 0.62));
    vec3 kcol = mix(vec3(0.98, 0.55, 0.16), vec3(0.36, 0.50, 0.92), fract(fi * 0.41));
    col = mix(col, mix(vec3(0.07, 0.05, 0.08), kcol, 0.58), b * 0.90);
    col += kcol * b * 0.22;
    float sh = blob(vec2(x, y), vec2(kc.x, kc.y - kw * 0.55), vec2(kw * 1.2, kw * 0.20));
    col = mix(col, vec3(0.05, 0.035, 0.045), sh * 0.35);
  }

  return col;
}

void main(){
  vec2 uv = vUv;
  float x = (uv.x - 0.5) * uAspect + 0.5;
  vec2 P = vec2(x, uv.y);

  // Depth of field: the plate is sharpest around the horizon and melts toward the
  // near foreground and the sky, which is what sells "blurred live gameplay".
  float r = 0.0035 + 0.055 * pow(max(0.0, HZ - uv.y) / HZ, 1.6)
          + 0.014 * smoothstep(HZ, 1.0, uv.y);
  vec3 c = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 5; i++){
    if (i >= uTaps) break;
    float a = float(i) * 2.399963 + hash(uv * 91.7) * 6.2831;
    float rad = r * (0.25 + float(i) * 0.22);
    vec2 off = vec2(cos(a), sin(a)) * rad;
    c += sceneCol(P + off);
    wsum += 1.0;
  }
  vec3 col = c / max(wsum, 1.0);

  // near-foreground silhouettes, heavily out of focus (frames the menu)
  float fg = blob(vec2(uv.x, uv.y), vec2(-0.04, 0.02), vec2(0.32, 0.30))
           + blob(vec2(uv.x, uv.y), vec2(1.05, -0.02), vec2(0.36, 0.28))
           + blob(vec2(uv.x, uv.y), vec2(0.30, -0.14), vec2(0.28, 0.18))
           + blob(vec2(uv.x, uv.y), vec2(0.76, -0.16), vec2(0.32, 0.17));
  col = mix(col, vec3(0.050, 0.036, 0.046), clamp(fg, 0.0, 1.0) * 0.88);

  // grade: warm lift, vignette, film grain
  col *= 0.82;
  col = pow(col, vec3(1.04, 1.02, 1.0));
  float vig = 1.0 - 0.74 * pow(length((uv - 0.5) * vec2(1.15, 1.05)), 2.1);
  col *= clamp(vig, 0.0, 1.0);
  col += (hash(uv * 900.0 + floor(uTime * 12.0)) - 0.5) * 0.022;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

const BACKDROP_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Procedural stand-in for the real blurred gameplay backdrop.
function makeProceduralBackdrop(engine) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      uTime: { value: 9.3 },
      uAspect: { value: 16 / 9 },
      // DOF taps scale with the quality tier: the low tier must stay genuinely cheap.
      uTaps: { value: ({ low: 1, medium: 3, high: 5 })[engine?.q?.name] ?? 5 },
    },
  });
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const offQ = bus.on('quality:changed', q => {
    mat.uniforms.uTaps.value = ({ low: 1, medium: 3, high: 5 })[q?.name] ?? 5;
  });
  return {
    scene, camera,
    update(dt) { mat.uniforms.uTime.value += dt; },
    resize(w, h) { mat.uniforms.uAspect.value = (w || 16) / (h || 9); },
    dispose() { offQ(); geo.dispose(); mat.dispose(); },
  };
}

function makeBackdrop(engine) {
  if (_backdropFactory) {
    try {
      const b = _backdropFactory(engine);
      if (b && b.scene && b.camera) return b;
    } catch (e) { console.error('custom backdrop failed, falling back', e); }
  }
  return makeProceduralBackdrop(engine);
}

/* ══════════════════════════════════════════════════════════════ scene base ══ */

let _engine = null;   // last engine seen — lets the standalone overlays reach setQuality

// One level up from each screen. 'menu' is the root and deliberately absent.
const BACK_TO = {
  select: 'menu',
  results: 'menu',
  garage: 'menu',
  podium: 'menu',
};

// Shared plumbing: backdrop, DOM root, keyboard, language rebuild, teardown.
function baseScreen(engine, opts, build) {
  _engine = engine || _engine;
  injectMenuCSS();
  // The screenshot harness (and any external flow) can flip the saved language
  // without going through setLang(); re-sync so dir/strings never drift apart.
  const savedLang = save.read('lang');
  if (savedLang && savedLang !== getLang()) setLang(savedLang);
  const instant = !!opts?.instant || REDUCED();
  const backdrop = makeBackdrop(engine);
  const mount = engine?.ui || document.body;

  const root = h('div.mn-root' + (instant ? '.mn-instant' : ''));
  const scrim = h('div.mn-scrim');
  const stage = h('div.mn-stage');
  root.append(scrim, stage);
  mount.appendChild(root);

  const cleanups = [];
  const api = {
    engine, opts: opts || {}, instant, root, stage, backdrop,
    onKey(fn) {
      const handler = e => fn(e);
      addEventListener('keydown', handler);
      cleanups.push(() => removeEventListener('keydown', handler));
    },
    onCleanup(fn) { cleanups.push(fn); },
    // Language switches rebuild the screen in place so RTL/LTR flips instantly.
    rebuildOnLang(rebuild) {
      cleanups.push(bus.on('lang:changed', () => { stage.replaceChildren(); rebuild(); }));
    },
    go(name, o) { if (engine?.goto) engine.goto(name, o); else bus.emit('menu:goto', { name, opts: o }); },
    // Back-navigation, one level up. There must be no screen a player can get
    // stuck on, so every screen either has a parent here or is already the root.
    back(from) {
      const parent = BACK_TO[from] ?? BACK_TO[engine?.activeName];
      if (parent) api.go(parent);
    },
    // True while any overlay is on top of this screen — the screen's own key
    // handler must then keep its hands off the keyboard.
    overlayOpen: () => !!document.querySelector('.mn-ov'),
  };

  const extra = build(api) || {};

  return {
    scene: backdrop.scene,
    camera: backdrop.camera,
    update(dt) { backdrop.update?.(dt); extra.update?.(dt); },
    render: extra.render,
    resize(w, h2) { backdrop.resize?.(w, h2); extra.resize?.(w, h2); },
    enter() { extra.enter?.(); },
    exit() { extra.exit?.(); },
    dispose() {
      for (const c of cleanups) { try { c(); } catch (e) { console.error(e); } }
      try { extra.dispose?.(); } catch (e) { console.error(e); }
      backdrop.dispose?.();
      root.remove();
    },
    ...(extra.expose || {}),
  };
}

/* ══════════════════════════════════════════════════════ the route home ══ */
/**
 * Mount the shared "route home" pill for a scene that does NOT come from
 * baseScreen(). Two screens are in that position and both were dead ends:
 *
 *   • the RACE   — its only exit was the Escape key, which a child does not know.
 *   • the GARAGE — no exit at all, keyboard or otherwise. Opened from the home
 *                  menu mid-championship, the only way out was to finish a
 *                  four-step prompt and install the part.
 *
 * The button is appended to `engine.ui`, not to the scene's DOM: race.js rebuilds
 * its HUD and garage.js calls `root.replaceChildren()` on literally every click,
 * so anything living inside them would vanish. It carries the same classes, the
 * same corner and the same word as the racer-select back button.
 *
 * @param {object}   opts
 * @param {object}   opts.engine       engine (its `.ui` layer hosts the button)
 * @param {string}   [opts.labelKey]   i18n key for the label (default 'menu.back')
 * @param {string}   [opts.glyph]      leading glyph; default is the back arrow
 * @param {Function} [opts.onActivate] default: engine.goto('menu')
 * @param {boolean}  [opts.below]      drop below the top-corner HUD card (race)
 * @param {boolean}  [opts.escape]     also route Escape here (default false —
 *                                     the race's Escape belongs to the pause menu)
 * @returns {{el:HTMLElement, dispose:Function}}
 */
export function attachHomeControl(opts = {}) {
  injectMenuCSS();
  const engine = opts.engine || _engine;
  const mount = engine?.ui || document.body;
  const go = () => (opts.onActivate ? opts.onActivate()
    : engine?.goto ? engine.goto('menu') : bus.emit('menu:goto', { name: 'menu' }));

  const el = h('button.btn.ghost.mn-back.mn-home' + (opts.below ? '.below' : ''), {
    type: 'button', onclick: go,
  });
  const paint = () => {
    el.replaceChildren(
      h('span', { 'aria-hidden': 'true' }, opts.glyph || (isRTL() ? '→' : '←')),
      document.createTextNode(t(opts.labelKey || 'menu.back')));
  };
  paint();
  mount.appendChild(el);
  const offLang = bus.on('lang:changed', paint);

  // Escape, for the screens whose Escape nobody else claims. Ordered defensively:
  // garage.js's own handler (Boreg's introduction, backing out of the reveal)
  // runs on `document` and calls preventDefault, so `defaultPrevented` is the
  // signal that the screen has already answered the key. Any modal — including
  // the one-time explainers, which own their own dismissal (D20) — outranks us.
  const onKey = e => {
    if (!opts.escape || e.key !== 'Escape' || e.defaultPrevented) return;
    if (modalOpen() || document.querySelector('.mn-ov')) return;
    if (getComputedStyle(el).display === 'none') return;   // a scrim owns the screen
    e.preventDefault();
    go();
  };
  addEventListener('keydown', onKey);

  return {
    el,
    dispose() { offLang(); removeEventListener('keydown', onKey); el.remove(); },
  };
}

/**
 * Just the golden-hour backdrop, no screen furniture. ui/pause.js previews the
 * pause dialog over this, and the lead can use it as a loading/transition plate.
 */
export function backdropScene(engine, opts = {}) {
  return baseScreen(engine, opts, () => ({}));
}

/* ═══════════════════════════════════════════════════════════ small pieces ══ */

const ARROW = { left: '←', right: '→', up: '↑', down: '↓' };

function keyHint(keys, labelKey) {
  return h('div.mn-key', null,
    ...keys.map(k => h('span.mn-kbd', null, k)),
    h('b', null, t(labelKey)));
}

function controlHints() {
  return h('div.mn-keys', null,
    keyHint([ARROW.left, ARROW.right], 'menu.key.steer'),
    keyHint([ARROW.up], 'menu.key.gas'),
    // Space AND Shift are both drift (see core/input.js KEYS.drift). This row
    // used to advertise Shift as "שיגור" / "Item" — a control that does not
    // exist in Wave 1, so a child pressing it got nothing and concluded the
    // game was broken. It is one binding, so it is one hint.
    keyHint(['Space', 'Shift'], 'menu.key.drift'),
    keyHint(['Esc'], 'menu.key.pause'));
}

function coinSVG(size = 42) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 48 48');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('class', 'mn-coin');
  s.innerHTML = `<defs><linearGradient id="mnCoinG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe9a8"/><stop offset="55%" stop-color="#ffc247"/>
      <stop offset="100%" stop-color="#e2820c"/></linearGradient></defs>
    <circle cx="24" cy="24" r="21" fill="url(#mnCoinG)" stroke="#8a5205" stroke-width="2"/>
    <circle cx="24" cy="24" r="15" fill="none" stroke="rgba(138,82,5,.45)" stroke-width="2"/>
    <path d="M18 18l7 6-7 6" fill="none" stroke="#7a4703" stroke-width="3.6"
      stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M27.5 31h5" stroke="#7a4703" stroke-width="3.6" stroke-linecap="round"/>`;
  return s;
}

// Inline icons for how-to-play — drawn, never fetched.
// Chunky filled icons for how-to-play — an 8-year-old meets this screen before
// any gameplay, so these are solid shapes with their own hue, not hairlines.
function howIcon(kind, hue) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 64 64');
  const gid = 'hg' + kind;
  const G = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity=".55"/>
    <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>`;
  const art = {
    drive: `<circle cx="32" cy="33" r="21" fill="${hue}"/>
      <circle cx="32" cy="33" r="21" fill="url(#${gid})"/>
      <circle cx="32" cy="33" r="8.5" fill="#14111f"/>
      <path d="M11.5 30h12v6h-12zM40.5 30h12v6h-12zM29 41h6v12h-6z" fill="#14111f"/>`,
    drift: `<path d="M4 50c14 6 26 4 34-4" fill="none" stroke="${hue}" stroke-opacity=".40"
        stroke-width="7" stroke-linecap="round"/>
      <path d="M6 59c16 5 30 2 39-8" fill="none" stroke="${hue}" stroke-opacity=".20"
        stroke-width="6" stroke-linecap="round"/>
      <rect x="16" y="16" width="32" height="16" rx="7" fill="${hue}"/>
      <rect x="16" y="16" width="32" height="16" rx="7" fill="url(#${gid})"/>
      <rect x="26" y="8" width="14" height="10" rx="4" fill="${hue}"/>
      <circle cx="21" cy="39" r="8" fill="#14111f"/><circle cx="45" cy="39" r="8" fill="#14111f"/>`,
    token: `<circle cx="32" cy="32" r="22" fill="${hue}"/>
      <circle cx="32" cy="32" r="22" fill="url(#${gid})"/>
      <circle cx="32" cy="32" r="15.5" fill="none" stroke="#14111f" stroke-opacity=".3" stroke-width="2.5"/>
      <path d="M25 24l8 8-8 8" fill="none" stroke="#14111f" stroke-width="5.5"
        stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M37 41h7" stroke="#14111f" stroke-width="5.5" stroke-linecap="round"/>`,
    garage: `<path d="M6 30 32 10l26 20v24H6z" fill="${hue}"/>
      <path d="M6 30 32 10l26 20v24H6z" fill="url(#${gid})"/>
      <rect x="17" y="34" width="30" height="20" rx="3" fill="#14111f"/>
      <path d="M17 40h30M17 46h30" stroke="${hue}" stroke-opacity=".55" stroke-width="3"/>`,
  }[kind] || '';
  s.innerHTML = G + art;
  return s;
}

// בורג (Bolt) — the garage robot the contract locks in as the player's guide.
// Rounded helper-robot creature: dome head, antenna bulb, two friendly eyes.
function boregSVG() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 64 64');
  s.setAttribute('class', 'mn-boreg');
  s.innerHTML = `<defs><linearGradient id="mnBoregB" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fd6ff"/><stop offset="100%" stop-color="#3f7fb8"/></linearGradient></defs>
    <path d="M32 8v6" stroke="#8fd6ff" stroke-width="3" stroke-linecap="round"/>
    <circle cx="32" cy="7" r="4" fill="#ffc247"/>
    <rect x="12" y="14" width="40" height="34" rx="15" fill="url(#mnBoregB)"/>
    <rect x="17" y="19" width="30" height="18" rx="9" fill="#14111f"/>
    <circle cx="26" cy="28" r="4.4" fill="#ffe9a8"/><circle cx="38" cy="28" r="4.4" fill="#ffe9a8"/>
    <path d="M26 41c4 3 8 3 12 0" stroke="#14111f" stroke-opacity=".5" stroke-width="3"
      stroke-linecap="round" fill="none"/>
    <rect x="20" y="48" width="24" height="9" rx="4.5" fill="#2f6491"/>
    <circle cx="9" cy="32" r="5" fill="#3f7fb8"/><circle cx="55" cy="32" r="5" fill="#3f7fb8"/>`;
  return s;
}

/* ═════════════════════════════════════════════════════════════ 1. title ══ */

export function titleScene(engine, opts = {}) {
  return baseScreen(engine, opts, api => {
    const build = () => {
      // Three states, not two. "ממשיכים באליפות" is offered ONLY mid-championship:
      // once the last race is on the books there is no next race, and the button
      // used to send the player to race index 3 of a 3-race season — a scene with
      // no track behind it, i.e. a black screen with no way back.
      const inProgress = champInProgress();
      const finished = champFinished();

      const logo = h('div.mn-logo', null,
        h('div.l1.display.display-white', null, getLang() === 'he' ? 'מרוץ' : 'PROMPT'),
        h('div.l2.display', null, getLang() === 'he' ? 'הפרומפטים' : 'RACERS'));

      const hero = h('div.mn-hero.fade-in', null,
        h('div.mn-burst'), h('div.mn-ribbon'), h('div.mn-ribbon.two'), h('div.mn-swoosh'), logo);

      const startNew = () => { resetChampionship(); api.go('select', { fresh: true }); };

      const primary = h('button.btn.mn-btn-xl.pop-in', {
        onclick: () => (finished ? startNew() : api.go('select')),
        style: { animationDelay: '.08s' },
      }, t(finished ? 'menu.newChamp' : inProgress ? 'menu.continue' : 'menu.start'));

      const secondary = h('div.mn-btn-row.pop-in', { style: { animationDelay: '.14s' } },
        // Mid-championship: a way to abandon it. Finished: the podium (and with
        // it the certificate) stays reachable, since the primary CTA has become
        // "new championship" and would otherwise erase it out of reach.
        inProgress ? h('button.btn.ghost', { onclick: startNew }, t('menu.newChamp')) : null,
        finished ? h('button.btn.ghost', { onclick: () => api.go('podium') }, t('menu.viewPodium')) : null,
        // Free play: the garage with no race attached and no token pressure, so a
        // child can practise writing asks without a championship riding on it.
        // Routes to the registry's 'freeplay' scene (scenes.js → freePlayScene),
        // and still passes freePlay:true so a garage reached any other way behaves
        // the same.
        h('button.btn.ghost', { onclick: () => api.go('freeplay', { freePlay: true }) }, t('menu.freePlay')),
        h('button.btn.ghost', { onclick: () => howToPlayOverlay() }, t('menu.howto')),
        h('button.btn.ghost', { onclick: () => howBuiltOverlay() }, t('learn.built.title')),
        h('button.btn.ghost', { onclick: () => settingsOverlay({ engine }) }, t('menu.settings')));

      appendAll(api.stage,
        h('div.mn-center', null,
          hero,
          h('div.mn-tagline.fade-in', { style: { animationDelay: '.1s' } }, t('menu.tagline')),
          h('div.mn-menu', null, primary, secondary, h('div.mn-press', null, t('menu.enterHint')))),
        controlHints());

      requestAnimationFrame(() => primary.focus({ preventScroll: true }));
    };

    build();
    api.rebuildOnLang(build);

    api.onKey(e => {
      if (api.overlayOpen()) return;
      // Enter is the primary CTA, so it must mean the same thing the button does —
      // including "start a fresh championship" once the last one is finished.
      if (e.key === 'Enter') {
        e.preventDefault();
        if (champFinished()) { resetChampionship(); api.go('select', { fresh: true }); }
        else api.go('select');
      } else if (e.key === 'h' || e.key === '?') howToPlayOverlay();
      else if (e.key === 'b') howBuiltOverlay();
      else if (e.key === 's') settingsOverlay({ engine });
      // Escape on the title screen: this is the root, so there is nowhere to go
      // back to. Put focus on the primary CTA instead of silently doing nothing.
      else if (e.key === 'Escape') {
        e.preventDefault();
        api.stage.querySelector('.mn-btn-xl')?.focus({ preventScroll: true });
      }
    });
  });
}

/* ══════════════════════════════════════════════════════ 2. racer select ══ */

const STAT_KEYS = ['speed', 'accel', 'handling', 'weight'];

/* ---------------------------------------------------------------------------
 * KART SEAM for racer select.
 *
 * This module must never import kart/kartmodel.js — it would stop rendering
 * standalone under tools/preview.mjs, which is the whole reason every subsystem
 * can be judged on its own. So racer select asks for karts through a mounter the
 * lead fills in from scenes.js (exactly like the garage's setKartPreviewMounter),
 * and falls back to the block placeholder the podium already uses when nobody
 * has filled it in.
 *
 *   setSelectKartMounter((holder, {racerId, parts, engine}) => {
 *     const kart = createKart({...});   // { group, dispose() }
 *     kart.group.name = 'kart:' + kart.racer.id;   // ← the gate reads this back
 *     holder.add(kart.group);
 *     return kart;
 *   });
 *
 * WHOEVER BUILDS THE KART NAMES IT, from the racer it actually resolved — not
 * from the id it was asked for. Eight cards silently showing eight copies of the
 * player's kart is the failure this screen is most exposed to (the garage
 * mounter defaults `racerId` to the save), and a name written by the caller
 * would assert nothing. tools/selecttest.mjs reads mountedKarts() off the live
 * scene graph and fails if any card is not wearing its own racer.
 * ------------------------------------------------------------------------- */
let _selectKartMounter = null;
export function setSelectKartMounter(fn) { _selectKartMounter = fn; }

/** Optional: (renderer) => {texture, dispose}. Without it MeshStandardMaterial
 *  bodywork has no specular response and the karts read as matte resin. */
let _selectEnvFactory = null;
export function setSelectEnvironment(fn) { _selectEnvFactory = fn; }

// The 3/4 showroom pose. The kart model is -Z forward (D9), so π faces the
// camera; the extra 0.55 turns it off-square into a hero three-quarter view.
const SELECT_BASE_YAW = Math.PI + 0.55;
const SELECT_PITCH = 0.34;

// Per-racer backdrop plate, drawn behind its kart INSIDE the 3D pass rather than
// as a CSS background. The card's kart window has to be a genuine hole in the
// overlay (anything opaque or backdrop-filtered over it frosts the kart), so the
// racer's colour block has to live in the 3D layer too.
function selectPlateTexture(r) {
  const W = 256, H = 176, RAD = 26;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.beginPath();
  x.moveTo(RAD, 0); x.lineTo(W - RAD, 0); x.quadraticCurveTo(W, 0, W, RAD);
  x.lineTo(W, H); x.lineTo(0, H); x.lineTo(0, RAD); x.quadraticCurveTo(0, 0, RAD, 0);
  x.closePath(); x.clip();

  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, hex(r.color));
  g.addColorStop(1, mixHex(r.color, r.color2, 0.85));
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  x.globalAlpha = 0.13; x.strokeStyle = '#fff'; x.lineWidth = 17;
  for (let i = -H; i < W + H; i += 42) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + H, H); x.stroke(); }
  x.globalAlpha = 1;

  const sh = x.createLinearGradient(0, 0, 0, H);
  sh.addColorStop(0, 'rgba(255,255,255,.30)');
  sh.addColorStop(0.5, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,.42)');
  x.fillStyle = sh; x.fillRect(0, 0, W, H);

  // a pool of shade under where the kart stands, so the model has something to
  // separate from instead of floating on a flat colour
  const vg = x.createRadialGradient(W / 2, H * 0.78, 8, W / 2, H * 0.78, W * 0.55);
  vg.addColorStop(0, 'rgba(0,0,0,.38)');
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = vg; x.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function racerSelectScene(engine, opts = {}) {
  return baseScreen(engine, opts, api => {
    let index = Math.max(0, RACERS.findIndex(r => r.id === (opts.racerId || RACERS[0].id)));
    let cards = [];
    let grid = null;
    let pickedName = null;
    let pickedChip = null;
    let goBtn = null;

    // Four columns keeps the roster two rows deep, which matters far more on a
    // short 1024x640 laptop than the extra card width three columns would buy.
    // These thresholds live in CSS (see .mn-grid above); this is only the
    // fallback for the case where the grid is not in the document yet.
    const colsFor = w => (w >= 1000 ? 4 : w >= 740 ? 3 : w >= 520 ? 2 : 1);
    // Arrow-key navigation needs to know the column count. Read it off the real
    // layout rather than remembering it: whatever the browser actually laid out
    // is the truth, and it cannot be one resize event behind.
    const colCount = () => {
      const tpl = grid && getComputedStyle(grid).gridTemplateColumns;
      const n = tpl && tpl !== 'none' ? tpl.trim().split(/\s+/).length : 0;
      return n > 0 ? n : colsFor(innerWidth);
    };

    /* ------------------------------------------------------ 3D kart stage ── */
    // Eight live karts, one per card, drawn on the GL canvas UNDER the overlay
    // and clipped to each card's window with the scissor rectangle.
    //
    // Why one shared scene in CSS-pixel space rather than eight little scenes:
    // the camera is orthographic with 1 world unit = 1 CSS pixel, so a card's
    // getBoundingClientRect() IS the kart's position — the model can never drift
    // away from the card it belongs to, at any resolution or column count, and a
    // language flip that re-lays-out the grid needs no 3D bookkeeping at all.
    //
    // Cost control (engine.q, measured — see the report in tools/selecttest.mjs):
    //  • one draw pass per card, each scissored to ~200x120 px, with the other
    //    seven kart subtrees marked invisible so three skips them at cull time.
    //    Total geometry drawn per frame is eight karts — the same as a race — but
    //    the shaded area is a fraction of the screen.
    //  • karts are built at the tier's own LOD (createKart reads engine.q), and
    //    shadow casting is off: nothing here receives a shadow.
    //  • low tier animates only the selected kart; the other seven hold the hero
    //    pose, so seven per-frame driver/wheel rigs are skipped entirely.
    const LOW = (engine?.q?.name || 'high') === 'low';
    const stage3D = new THREE.Scene();
    // We drive updateMatrixWorld ourselves, once per frame, instead of letting
    // each of the eight render() calls walk the same graph again.
    stage3D.matrixWorldAutoUpdate = false;
    const cam3D = new THREE.OrthographicCamera(0, 1, 0, -1, -4000, 4000);
    cam3D.position.set(0, 0, 1000);

    stage3D.add(new THREE.HemisphereLight(0xffe4bd, 0x2b2340, 1.15));
    const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.3);
    keyLight.position.set(-3, 6, 7);
    stage3D.add(keyLight);
    if (!LOW) {
      const rimLight = new THREE.DirectionalLight(0x9fc2ff, 0.9);
      rimLight.position.set(5, 2, -6);
      stage3D.add(rimLight);
    }

    let env3D = null;
    if (_selectEnvFactory && engine?.renderer) {
      try { env3D = _selectEnvFactory(engine.renderer); stage3D.environment = env3D?.texture || null; }
      catch (e) { console.error('select environment failed', e); env3D = null; }
    }

    const plateGeo = new THREE.PlaneGeometry(1, 1);
    const phRng = makeRng(4242);
    const _box = new THREE.Box3();
    const _v3 = new THREE.Vector3();
    const _size = new THREE.Vector2();

    const slots = RACERS.map(r => {
      const root = new THREE.Group();
      const anchor = new THREE.Group();
      const pitch = new THREE.Group();
      const spin = new THREE.Group();
      pitch.add(spin); anchor.add(pitch); root.add(anchor);

      const tex = selectPlateTexture(r);
      const plateMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.renderOrder = -2;
      root.add(plate);
      stage3D.add(root);

      let mounted = null;
      let obj = null;
      if (_selectKartMounter) {
        try { mounted = _selectKartMounter(spin, { racerId: r.id, parts: {}, engine }) || null; }
        catch (e) { console.error('select kart mounter failed', e); mounted = null; }
        obj = mounted?.group || spin.children[0] || null;
      }
      if (!obj) {
        // Standalone preview / unwired build. Deliberately named differently so
        // a gate can tell "the seam is filled" from "the seam quietly is not".
        obj = makePlaceholderKart(r, phRng);
        obj.name = 'placeholder:' + r.id;
        spin.add(obj);
      }

      // Measure the model flat (before the pitch is applied) so the fit maths
      // below is about the kart, not about the pose.
      spin.rotation.y = 0;
      root.updateMatrixWorld(true);
      // Measure the KART, not its contact shadow. The model carries a soft 2.9 x
      // 3.4m ground blob at renderOrder -1 — 40% wider than the kart itself — and
      // fitting to that shrank every card's model to about half the window it had
      // to itself. Anything drawn behind the kart is excluded from the fit.
      _box.makeEmpty();
      obj.traverse(o => { if (o.isMesh && o.renderOrder >= 0) _box.expandByObject(o, true); });
      if (_box.isEmpty()) _box.setFromObject(obj);
      const size = _box.getSize(new THREE.Vector3());
      const centre = _box.getCenter(_v3);
      obj.position.set(-centre.x, -centre.y, -centre.z);

      // Worst case across a full turntable revolution: a w×l footprint rotated
      // about Y is never wider than hypot(w, l).
      const spanW = Math.max(0.4, Math.hypot(size.x, size.z));
      const spanH = Math.max(0.3, size.z * Math.sin(SELECT_PITCH) + size.y * Math.cos(SELECT_PITCH));

      pitch.rotation.x = SELECT_PITCH;
      spin.rotation.y = SELECT_BASE_YAW;
      return { racer: r, root, anchor, pitch, spin, plate, plateMat, tex, mounted, obj, spanW, spanH, rect: null };
    });

    /** Park every kart's window over its card, in CSS pixels. */
    function layoutKarts() {
      const canvas = engine?.renderer?.domElement;
      if (!canvas) return false;
      const cr = canvas.getBoundingClientRect();
      if (cr.width < 2 || cr.height < 2) return false;
      cam3D.left = 0; cam3D.right = cr.width;
      cam3D.top = 0; cam3D.bottom = -cr.height;
      cam3D.updateProjectionMatrix();

      let any = false;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const el = cards[i]?.querySelector('.mn-view');
        const r = el?.getBoundingClientRect();
        if (!r || r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > cr.height) { s.rect = null; continue; }
        const x = r.left - cr.left + r.width / 2;
        const y = r.top - cr.top + r.height / 2;
        s.root.position.set(x, -y, 0);
        s.plate.scale.set(r.width, r.height, 1);
        const fit = Math.min(r.width / (s.spanW * 1.02), r.height / (s.spanH * 1.06));
        s.anchor.scale.setScalar(fit);
        s.plate.position.z = -(s.spanW * fit) / 2 - 8;
        s.rect = { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
        any = true;
      }
      stage3D.updateMatrixWorld();
      return any;
    }

    function disposeKarts() {
      for (const s of slots) {
        try { s.mounted?.dispose?.(); } catch (e) { console.error(e); }
        if (!s.mounted) s.obj?.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
        s.plateMat.dispose();
        s.tex.dispose();
      }
      plateGeo.dispose();
      env3D?.dispose?.();
      stage3D.clear();
    }

    function paintStats(card, racer, animate) {
      const fills = card.querySelectorAll('.mn-fill');
      STAT_KEYS.forEach((k, i) => {
        const el = fills[i];
        if (!el) return;
        const pct = (racer.stats[k] / 5) * 100;
        if (animate && !api.instant) {
          el.style.width = '0%';
          requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = pct + '%'; }));
        } else {
          el.style.width = pct + '%';
        }
      });
    }

    function select(i, animate = true) {
      index = ((i % RACERS.length) + RACERS.length) % RACERS.length;
      cards.forEach((c, j) => {
        const on = j === index;
        c.classList.toggle('sel', on);
        c.classList.toggle('dim', !on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
        c.tabIndex = on ? 0 : -1;
        // "אתה" marks the racer you are about to drive, so it follows the cursor.
        const badge = c.querySelector('.mn-you');
        if (badge) badge.style.display = on ? '' : 'none';
        if (on) { paintStats(c, racerAt(j), animate); c.focus({ preventScroll: true }); }
      });
      const r = racerAt(index);
      if (pickedName) pickedName.textContent = racerName(r);
      if (pickedChip) pickedChip.style.background = hex(r.color);
      bus.emit('menu:racer', r);
    }

    function makeCard(r, i) {
      const c1 = hex(r.color);
      const card = h('div.mn-card', {
        role: 'radio', tabindex: -1,
        'aria-label': racerName(r),
        'data-racer': r.id,
        // A click PICKS. It does not race. A child exploring the roster with the
        // mouse used to start race 1 the instant they clicked the card that was
        // already highlighted — the one interaction on this screen that cannot be
        // undone. Starting lives on the start button and nowhere else.
        onclick: () => select(i),
        onfocus: () => { if (index !== i) select(i); },
        style: { '--sel': c1 },
      },
        h('div.mn-view', null,
          h('div.mn-you', { style: { display: 'none' } }, t('menu.select.you')),
          h('div.mn-tick', { 'aria-hidden': 'true' }, '✓')),
        h('div.mn-body', null,
          h('div.mn-cname', null, racerName(r)),
          h('div.mn-ctag', null, t(`racer.${r.id}.tag`) === `racer.${r.id}.tag` ? '' : t(`racer.${r.id}.tag`)),
          h('div.mn-stats', null, ...STAT_KEYS.map(k =>
            h('div.mn-stat', null,
              h('span', null, t('menu.stat.' + k)),
              h('div.mn-track', null,
                h('i.mn-fill', {
                  style: {
                    color: c1,
                    background: `linear-gradient(${isRTL() ? 270 : 90}deg,${c1},${mixHex(r.color, 0xffffff, .35)})`,
                    width: ((r.stats[k] / 5) * 100) + '%',
                  },
                })))))));
      // Ensure the selection ring tint reads even if color2 is missing.
      card.style.setProperty('--sel', c1);
      return card;
    }

    function start() {
      bus.emit('menu:start', { racer: racerAt(index) });
      api.go('race', { racerId: racerAt(index).id, track: Number(save.read('championshipRace')) || 0 });
    }

    const focusStart = () => goBtn?.focus({ preventScroll: true });

    // Scopes the short-viewport compaction above to this screen only — every
    // other menu shares .mn-stage and none of them is anywhere near overflowing.
    api.root.classList.add('mn-select');

    const build = () => {
      cards = RACERS.map(makeCard);
      grid = h('div.mn-grid', { role: 'radiogroup', 'aria-label': t('menu.select.title') }, ...cards);
      cards.forEach((c, i) => { c.classList.add('pop-in'); c.style.animationDelay = (0.02 * i).toFixed(2) + 's'; });

      pickedChip = h('i', { 'aria-hidden': 'true' });
      pickedName = h('b');
      goBtn = h('button.btn.mn-btn-xl.mn-start', { onclick: start }, t('menu.select.go'));
      const go = h('div.mn-go.pop-in', { style: { animationDelay: '.22s' } },
        h('div.mn-picked', { 'aria-live': 'polite' }, t('menu.select.picked'), pickedChip, pickedName),
        goBtn);

      appendAll(api.stage,
        // A visible way back, not only Escape: plenty of children play this with
        // a mouse or a touchpad and never touch a key they were not told about.
        h('div.mn-headrow', null,
          h('button.btn.ghost.mn-back', { onclick: () => api.back('select') },
            h('span', { 'aria-hidden': 'true' }, isRTL() ? '→' : '←'), t('menu.back')),
          h('div.mn-head.fade-in', null,
            h('div.mn-h1.display', null, t('menu.select.title')),
            h('div.mn-sub', null, t('menu.select.sub')))),
        grid,
        go,
        h('div.mn-spacer'),
        h('div.mn-keys', null,
          keyHint([ARROW.left, ARROW.right, ARROW.up, ARROW.down], 'menu.key.select'),
          keyHint(['Enter'], 'menu.select.confirm'),
          keyHint(['Esc'], 'menu.key.back')));

      select(index, false);
      layoutKarts();
    };

    build();
    api.rebuildOnLang(build);

    api.onKey(e => {
      if (api.overlayOpen()) return;
      // Visual movement, not index movement: under RTL the grid runs right-to-left,
      // so pressing ← walks FORWARD through the array.
      const fwd = isRTL() ? 1 : -1;   // delta applied by ArrowLeft
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); select(index + fwd); break;
        case 'ArrowRight': e.preventDefault(); select(index - fwd); break;
        case 'ArrowDown': e.preventDefault(); select(index + colCount()); break;
        case 'ArrowUp': e.preventDefault(); select(index - colCount()); break;
        case 'Home': e.preventDefault(); select(0); break;
        case 'End': e.preventDefault(); select(RACERS.length - 1); break;
        // Enter/Space on a CARD confirms the pick and hands focus to the start
        // button; it never starts a race. On the button itself we get out of the
        // way and let the browser's own activation fire onclick, so there is
        // exactly one code path into a race from this screen.
        case 'Enter': case ' ':
          if (document.activeElement === goBtn) break;
          e.preventDefault(); focusStart(); break;
        case 'Escape': e.preventDefault(); api.back('select'); break;
        default: break;
      }
    });

    return {
      // Nothing to re-apply: the column count is a media query now, so the only
      // thing a resize can invalidate is where the 3D karts are parked.
      resize() { layoutKarts(); },
      update(dt) {
        const animateAll = !REDUCED() && !api.instant && !LOW;
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          const on = i === index;
          if (REDUCED() || api.instant) { s.spin.rotation.y = SELECT_BASE_YAW; continue; }
          if (!on && !animateAll) { s.spin.rotation.y = SELECT_BASE_YAW; continue; }
          s.spin.rotation.y += dt * (on ? 0.45 : 0.20);
          // Only the picked kart runs its driver/wheel rig — seven idle rigs a
          // frame is the one avoidable cost on this screen.
          if (on) s.mounted?.update?.(dt, { speed01: 0 });
        }
      },
      // Backdrop first, then one scissored pass per card. The scissor is what
      // keeps a kart inside its own window: the 3D layer spans the whole canvas
      // and nothing in the DOM above it can clip a pixel that is drawn below it.
      render() {
        const r = engine?.renderer;
        if (!r) return;
        r.autoClear = true;
        r.render(api.backdrop.scene, api.backdrop.camera);
        if (!layoutKarts()) return;
        r.getSize(_size);
        r.autoClear = false;
        r.setScissorTest(true);
        for (const s of slots) {
          if (!s.rect) continue;
          for (const o of slots) o.root.visible = (o === s);
          r.setScissor(s.rect.x, _size.y - s.rect.y - s.rect.h, s.rect.w, s.rect.h);
          r.clearDepth();
          r.render(stage3D, cam3D);
        }
        r.setScissorTest(false);
        for (const o of slots) o.root.visible = true;
        r.autoClear = true;
      },
      dispose: disposeKarts,
      expose: {
        // What is ACTUALLY standing in each card window, read back off the scene
        // graph — see the seam note above. Same contract as the podium's.
        mountedKarts() {
          return slots.map((s, i) => ({
            index: i,
            racerId: s.racer.id,
            name: s.spin.children[0]?.name || null,
            visible: !!s.rect,
          }));
        },
        selectedRacerId: () => racerAt(index).id,
        // Turntable angles, in roster order. tools/selecttest.mjs samples these
        // across a step to prove the LOW tier really does animate only the
        // picked kart — a claim a comment cannot make and a screenshot of a
        // static frame cannot disprove.
        kartSpins: () => slots.map(s => s.spin.rotation.y),
      },
    };
  });
}

/* ═════════════════════════════════════════════════════════════ 3. results ══ */

function countUp(el, to, instant, onDone) {
  if (instant || REDUCED() || !to) { el.textContent = num(to || 0); onDone?.(); return () => {}; }
  const dur = 900, t0 = performance.now();
  let raf = 0;
  const tick = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = num(Math.round(to * e));
    if (p < 1) raf = requestAnimationFrame(tick); else onDone?.();
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function resultsScene(engine, opts = {}) {
  return baseScreen(engine, opts, api => {
    // race.js names these `timeMs` / `tokens` / `bestLapMs`; this screen was
    // written against `time` / `tokensEarned` / `bestLap`. Nothing threw — every
    // number simply rendered as "--:--" or 0, which is exactly the class of seam
    // that only shows up when you play the whole thing in one sitting. Accept
    // both vocabularies here so neither side can silently blank the sheet again.
    const standings = (opts.standings?.length ? opts.standings : sampleRaceStandings())
      .slice()
      .map(s => ({ ...s, time: s.time ?? s.timeMs ?? null }))
      .sort((a, b) => (a.place || 99) - (b.place || 99));
    const winner = standings[0];
    const me = standings.find(s => s.isPlayer) || standings[0];
    const tokens = Number(opts.tokensEarned ?? opts.tokens) || 0;
    const bestLap = opts.bestLap ?? opts.bestLapMs ?? null;
    let stopCount = () => {};

    const build = () => {
      const rows = standings.map((s, i) => {
        const r = racerById(s.racerId);
        const gapMs = (s.time != null && winner?.time != null) ? s.time - winner.time : null;
        const row = h('div.mn-row' + (s.isPlayer ? '.me' : '') + '.mn-reveal', {
          style: { animationDelay: (0.05 + i * 0.055).toFixed(3) + 's' },
        },
          h('div.mn-pos' + (s.place <= 3 ? '.p' + s.place : ''), null, h('span.num', null, num(s.place ?? i + 1))),
          h('div.mn-who', null,
            h('i.mn-chip', { style: { background: hex(r.color), color: hex(r.color) } }),
            h('b', null, racerName(r)),
            s.isPlayer ? h('span.mn-you', { style: { position: 'static' } }, t('menu.select.you')) : null),
          h('div.mn-time', null, h('span.num', null, formatTime(s.time))),
          h('div.mn-gap', null, h('span.num', null,
            i === 0 ? '—' : (gapMs != null ? '+' + formatTime(gapMs) : '—'))));
        return row;
      });

      const tokenVal = h('div.v.num', null, num(0));
      const sheet = h('div.panel-lift.mn-sheet.fade-in', null,
        h('div.mn-tablehead', null,
          h('div', null, t('menu.results.place')),
          h('div', null, t('menu.results.racer')),
          h('div', null, t('menu.results.time')),
          h('div', null, t('menu.results.gap'))),
        h('div.mn-rows', null, ...rows),
        h('div.mn-awards', null,
          h('div.mn-award', null, coinSVG(),
            h('div', null, h('div.k', null, t('menu.results.tokens')), tokenVal)),
          h('div.mn-award', { style: { background: 'linear-gradient(180deg,rgba(111,195,255,.14),rgba(111,195,255,.04))', borderColor: 'rgba(111,195,255,.35)' } },
            h('div', null,
              h('div.k', { style: { color: '#bfe4ff' } }, t('menu.results.bestlap')),
              h('div.v.num', { style: { color: '#dcefff' } }, formatTime(bestLap))))),
        h('div.mn-hint', null, t('menu.results.tokenHint')));

      const primary = h('button.btn.mn-btn-xl.pop-in', {
        style: { animationDelay: '.3s' },
        onclick: () => api.go('garage'),
      }, t('menu.results.garage'));
      const secondary = h('button.btn.ghost.pop-in', {
        style: { animationDelay: '.34s' },
        onclick: () => api.go(opts.isChampionship ? 'race' : 'menu'),
      }, t(opts.isChampionship ? 'menu.results.next' : 'menu.results.menu'));

      appendAll(api.stage,
        h('div.mn-head.fade-in', null,
          h('div.mn-h1.display', null, t('menu.results.title')),
          h('div.mn-sub', null,
            (opts.trackName ? opts.trackName + ' · ' : '') +
            t('menu.results.youPlaced', { p: ordinal(me?.place || 1) }))),
        sheet,
        h('div.row', { style: { marginBlockStart: 'clamp(6px,1.4vh,16px)', gap: '12px', flex: 'none' } },
          primary, secondary));

      stopCount();
      stopCount = countUp(tokenVal, tokens, api.instant);
      requestAnimationFrame(() => primary.focus({ preventScroll: true }));
    };

    build();
    api.rebuildOnLang(build);
    api.onCleanup(() => stopCount());

    api.onKey(e => {
      if (api.overlayOpen()) return;
      if (e.key === 'Enter') { e.preventDefault(); api.go('garage'); }
      if (e.key === 'Escape') { e.preventDefault(); api.back('results'); }
    });
  });
}

/* ══════════════════════════════════════════════════════════════ 4. podium ══ */

/** Set by podiumScene while it is alive; the lead can call the module-level hook. */
let _activePodium = null;

/**
 * Swap the placeholder kart on a podium step for the real model.
 * @param {1|2|3} place  podium step
 * @param {THREE.Object3D} container3D  kart root; positioned/scaled by the podium
 */
export function mountKartOnPodium(place, container3D) {
  if (!_activePodium) return false;
  return _activePodium.mountKartOnPodium(place, container3D);
}

function makePlaceholderKart(racer, rng) {
  const g = new THREE.Group();
  const c1 = new THREE.Color(racer ? racer.color : 0xffc247);
  const c2 = new THREE.Color(racer ? racer.color2 : 0xff7a2f);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.42, 1.6),
    new THREE.MeshLambertMaterial({ color: c1 }));
  body.position.y = 0.36;
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.80, 0.24, 0.55),
    new THREE.MeshLambertMaterial({ color: c1 }));
  nose.position.set(0, 0.32, 0.88);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.44, 1.4),
    new THREE.MeshLambertMaterial({ color: c2 }));
  stripe.position.set(0, 0.37, 0.1);
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.34, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x2b2b3c }));
  seat.position.set(0, 0.62, -0.35);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.30, 18, 14),
    new THREE.MeshLambertMaterial({ color: c2 }));
  head.position.set(0, 0.98, -0.18);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.33, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
    new THREE.MeshLambertMaterial({ color: c1 }));
  helmet.position.set(0, 1.0, -0.18);
  g.add(body, nose, stripe, seat, head, helmet);

  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x191922 });
  const mk = (x, z, r, w) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), wheelMat);
    m.rotation.z = Math.PI / 2;
    m.position.set(x, r, z);
    return m;
  };
  g.add(mk(-0.62, -0.52, 0.34, 0.34), mk(0.62, -0.52, 0.34, 0.34),
    mk(-0.52, 0.72, 0.24, 0.22), mk(0.52, 0.72, 0.24, 0.22));
  g.userData.isPlaceholder = true;
  return g;
}

function numberPlateTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#1b1826'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(255,194,71,.55)'; x.lineWidth = 6; x.strokeRect(9, 9, 110, 110);
  const g = x.createLinearGradient(0, 24, 0, 108);
  g.addColorStop(0, '#ffe9a8'); g.addColorStop(1, '#f59310');
  x.fillStyle = g;
  x.font = '900 84px system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Normalise whatever arrived into the canonical standings shape documented next
 * to totalPoints() in scenes.js: `{place, racerId, racer, name, points, wins,
 * bestFinal, isPlayer}`, sorted best → worst with `place === index + 1`.
 *
 * The lead already hands over exactly that. This exists so the podium can never
 * again render a row it did not understand: a missing `place` used to print the
 * literal string "undefined" in every row of the table, and the header then
 * fell back to a hard-coded "second" while the table showed the player first.
 * The order that arrives is authoritative — the tie-break lives in ONE place
 * (scenes.js) and is not second-guessed here.
 */
function normalizeStandings(list) {
  return list.slice()
    .sort((a, b) => (Number.isFinite(a.place) ? a.place : 99) - (Number.isFinite(b.place) ? b.place : 99))
    .map((s, i) => {
      const racer = racerById(s.racerId);
      return {
        ...s,
        place: Number.isFinite(s.place) ? s.place : i + 1,
        racerId: s.racerId ?? racer.id,
        name: s.name || racerName(racer),
        points: Number.isFinite(s.points) ? s.points : pointsFor(s.place ?? i + 1),
        isPlayer: !!s.isPlayer,
      };
    });
}

export function podiumScene(engine, opts = {}) {
  return baseScreen(engine, opts, api => {
    const q = engine?.q || { particles: 1 };
    const standings = normalizeStandings(opts.standings?.length ? opts.standings : samplePodiumStandings());
    // ONE source of truth for "where did the player come": the sorted array the
    // ledger produced. The header used to derive this separately and contradict
    // the table it sits above.
    const me = standings.find(s => s.isPlayer) || standings[0];
    const rng = makeRng(7331);

    /* ---- 3D stage ---- */
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 120);
    camera.position.set(0, 3.5, 10.4);
    camera.lookAt(0, 1.7, 0);

    scene.add(new THREE.HemisphereLight(0xffd9a0, 0x2b2340, 0.85));
    const key = new THREE.DirectionalLight(0xffd9a0, 1.5);
    key.position.set(-4, 7, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb0ff, 0.6);
    rim.position.set(5, 3, -6);
    scene.add(rim);

    const disposables = [];
    const track = o => { disposables.push(o); return o; };

    const stageMat = new THREE.MeshLambertMaterial({ color: 0x201d2c });
    const stageGeo = new THREE.CylinderGeometry(7.2, 7.6, 0.5, 48);
    const disc = new THREE.Mesh(track(stageGeo), track(stageMat));
    disc.position.y = -0.25;
    scene.add(disc);


    // 1st centre, 2nd to its left, 3rd to its right — a podium reads the same in
    // both directions, so it is deliberately NOT mirrored under RTL.
    const STEP = [
      { place: 1, x: 0, hgt: 2.0, z: 0 },
      { place: 2, x: -2.55, hgt: 1.45, z: 0.15 },
      { place: 3, x: 2.55, hgt: 1.05, z: 0.15 },
    ];
    const slots = new Map();

    for (const st of STEP) {
      const g = new THREE.Group();
      g.position.set(st.x, 0, st.z);
      const boxGeo = new THREE.BoxGeometry(2.3, st.hgt, 2.3);
      const boxMat = new THREE.MeshLambertMaterial({ color: st.place === 1 ? 0x33304a : 0x2a2839 });
      const box = new THREE.Mesh(track(boxGeo), track(boxMat));
      box.position.y = st.hgt / 2;
      g.add(box);

      const capGeo = new THREE.BoxGeometry(2.44, 0.12, 2.44);
      const capMat = new THREE.MeshLambertMaterial({
        color: st.place === 1 ? 0xffc247 : st.place === 2 ? 0xc9d2de : 0xc07a3c,
      });
      const cap = new THREE.Mesh(track(capGeo), track(capMat));
      cap.position.y = st.hgt + 0.06;
      g.add(cap);

      const plateTex = numberPlateTexture(st.place);
      const plateMat = new THREE.MeshBasicMaterial({ map: track(plateTex), transparent: false });
      const plate = new THREE.Mesh(track(new THREE.PlaneGeometry(0.95, 0.95)), track(plateMat));
      plate.position.set(0, Math.max(0.55, st.hgt * 0.45), 1.161);
      g.add(plate);

      // celebratory light shaft
      const shaftGeo = new THREE.ConeGeometry(1.5, 7.5, 20, 1, true);
      const shaftMat = new THREE.MeshBasicMaterial({
        color: st.place === 1 ? 0xffd070 : 0xffb9d8, transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const shaft = new THREE.Mesh(track(shaftGeo), track(shaftMat));
      shaft.position.y = st.hgt + 4.0;
      g.add(shaft);

      const holder = new THREE.Group();
      holder.position.y = st.hgt + 0.12;
      const entry = standings.find(s => s.place === st.place);
      const ph = makePlaceholderKart(entry ? racerById(entry.racerId) : null, rng);
      ph.rotation.y = st.place === 1 ? 0 : (st.x > 0 ? 0.30 : -0.30);
      ph.scale.setScalar(0.92);
      holder.add(ph);
      ph.traverse(o => { if (o.geometry) disposables.push(o.geometry); if (o.material) disposables.push(o.material); });
      g.add(holder);
      scene.add(g);
      slots.set(st.place, { holder, group: g, base: st.hgt + 0.12 });
    }

    /* ---- confetti ---- */
    // One InstancedMesh per confetti colour — cheaper and more portable than
    // per-instance colour attributes, and still only six draw calls.
    const PAL = [0xffc247, 0xff7a2f, 0x7ee081, 0x6fc3ff, 0xe257c9, 0xf4f1ea];
    const CONF = Math.max(48, Math.round(360 * (q.particles ?? 1)));
    const perColor = Math.ceil(CONF / PAL.length);
    const confGeo = track(new THREE.PlaneGeometry(0.14, 0.23));
    const confMeshes = PAL.map(c => {
      const m = new THREE.InstancedMesh(confGeo,
        track(new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })), perColor);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    const parts = [];
    const tmpO = new THREE.Object3D();
    for (let i = 0; i < perColor * PAL.length; i++) {
      parts.push({
        g: i % PAL.length, li: Math.floor(i / PAL.length),
        x: rng.range(-9, 9), y: rng.range(-1, 13), z: rng.range(-5, 6),
        vy: rng.range(-1.1, -2.4), vx: rng.range(-0.35, 0.35),
        rx: rng.range(0, 6.28), ry: rng.range(0, 6.28), rz: rng.range(0, 6.28),
        sx: rng.range(1.6, 3.4), sy: rng.range(1.4, 3.0), sw: rng.range(0.6, 1.5),
        ph: rng.range(0, 6.28),
      });
    }

    let clock = 0;
    function stepConfetti(dt) {
      clock += dt;
      for (const p of parts) {
        p.y += p.vy * dt;
        p.x += (p.vx + Math.sin(clock * p.sw + p.ph) * 0.5) * dt;
        p.rx += p.sx * dt; p.ry += p.sy * dt;
        if (p.y < -2.4) { p.y = rng.range(9, 14); p.x = rng.range(-9, 9); }
        tmpO.position.set(p.x, p.y, p.z);
        tmpO.rotation.set(p.rx, p.ry, p.rz);
        tmpO.updateMatrix();
        confMeshes[p.g].setMatrixAt(p.li, tmpO.matrix);
      }
      for (const m of confMeshes) m.instanceMatrix.needsUpdate = true;
    }
    // Pre-warm so a still frame (t=0) already shows a full sky of confetti.
    for (let i = 0; i < (REDUCED() ? 240 : 300); i++) stepConfetti(1 / 60);

    /* ---- DOM overlay ---- */
    // The certificate is the pay-off for the whole championship, so the podium
    // offers it as the primary action. The lead passes the run's best prompt in
    // through opts.bestPrompt (see certificateOverlay in ui/learn.js).
    function openCertificate() {
      const meRacer = racerById(me.racerId);
      return certificateOverlay({
        bestPrompt: opts.bestPrompt,
        racerName: racerName(meRacer),
        championship: opts.championship,
        races: Array.isArray(opts.races) ? opts.races.filter(Boolean).length : undefined,
        points: Number.isFinite(opts.totalPoints) ? opts.totalPoints : me.points,
        place: me.place,
        onMenu: () => api.go('menu'),
      });
    }

    const build = () => {
      const meRacer = racerById(me.racerId);
      const won = me.place === 1;
      const rows = standings.map(s => h('div.mn-prow' + (s.isPlayer ? '.me' : ''), null,
        h('i.num', null, num(s.place)),
        h('b', null, displayName(s)),
        h('em.num', null, num(s.points))));

      const total = Number.isFinite(opts.totalPoints) ? opts.totalPoints : me.points;

      appendAll(api.stage,
        h('div.mn-podium-top', null,
          h('div.mn-h1.display.pop-in', null, t(won ? 'menu.podium.champ' : 'menu.podium.done')),
          // Header place comes from the SAME sorted array as the table row above,
          // never from a second computation.
          h('div.mn-congrats.fade-in', { style: { animationDelay: '.12s' } },
            won ? t('menu.podium.congratsWin', { name: racerName(meRacer) })
              : t('menu.podium.congrats', { p: ordinal(me.place), name: racerName(meRacer) }))));

      appendAll(api.root,
        h('div.panel-lift.mn-side.pop-in', { style: { animationDelay: '.18s' } },
          h('h3', null, t('menu.podium.table')),
          ...rows,
          h('div.mn-total', null,
            h('b', null, t('menu.podium.total')),
            h('em.num', null, num(total)))),
        h('div.mn-bottom.pop-in', { style: { animationDelay: '.26s' } },
          h('button.btn.mn-btn-xl', { onclick: openCertificate }, t('learn.cert.title')),
          h('button.btn.ghost', { onclick: () => api.go('menu') }, t('menu.podium.menu')),
          // A new championship is a full reset (wallet, parts, best prompt and
          // the ledger) and lands on racer select. Clearing only two of those
          // keys left championshipRace at 0 with three finished races still on
          // the books, which is not a state any screen was written for.
          h('button.btn.ghost', {
            onclick: () => { resetChampionship(); api.go('select', { fresh: true }); },
          }, t('menu.podium.again'))));
    };

    const rebuild = () => {
      api.root.querySelectorAll('.mn-side,.mn-bottom').forEach(n => n.remove());
      build();
    };
    build();
    api.rebuildOnLang(rebuild);
    // The lead can have the award appear by itself once the podium has settled.
    if (opts.showCertificate) requestAnimationFrame(openCertificate);

    api.onKey(e => {
      if (api.overlayOpen()) return;
      if (e.key === 'Enter') { e.preventDefault(); openCertificate(); }
      else if (e.key === 'Escape') { e.preventDefault(); api.back('podium'); }
    });

    const podiumApi = {
      mountKartOnPodium(place, obj) {
        const slot = slots.get(Number(place));
        if (!slot || !obj) return false;
        slot.holder.clear();
        slot.holder.add(obj);
        return true;
      },
      // What is ACTUALLY standing on each step, read back off the scene graph.
      // The three steps once held three copies of the player's kart and nothing
      // on screen said so, so the flow gate asserts this rather than trusting
      // that the mount was asked for. Whoever mounts names the object.
      mountedKarts() {
        return [...slots.keys()].sort((a, b) => a - b).map(place => ({
          place, name: slots.get(place).holder.children[0]?.name || null,
        }));
      },
    };
    _activePodium = podiumApi;

    return {
      expose: podiumApi,
      update(dt) {
        if (!REDUCED()) {
          stepConfetti(dt);
          const w = clock * 0.35;
          camera.position.x = Math.sin(w) * 0.85;
          camera.position.y = 3.5 + Math.sin(w * 1.4) * 0.12;
          camera.lookAt(0, 1.7, 0);
          for (const [place, slot] of slots) {
            slot.holder.position.y = slot.base + Math.sin(clock * 2.4 + place) * 0.05;
            slot.holder.rotation.y = Math.sin(clock * 0.6 + place) * 0.10;
          }
        }
      },
      resize(w, h2) { camera.aspect = (w || 16) / (h2 || 9); camera.updateProjectionMatrix(); },
      // Backdrop first, then the podium stage composited on top of it.
      render() {
        const r = engine.renderer;
        r.autoClear = true;
        r.render(api.backdrop.scene, api.backdrop.camera);
        r.autoClear = false;
        r.clearDepth();
        r.render(scene, camera);
        r.autoClear = true;
      },
      dispose() {
        _activePodium = null;
        for (const m of confMeshes) m.dispose?.();
        for (const d of disposables) { try { d.dispose?.(); } catch (e) { /* already gone */ } }
        scene.clear();
      },
    };
  });
}

/* ═══════════════════════════════════════════════════════════════ overlays ══ */

// Element.append() would stringify a null child into the literal text "null".
export function appendAll(parent, ...kids) {
  for (const k of kids.flat()) if (k != null && k !== false) parent.append(k);
  return parent;
}

let _dlgSeq = 0;

/**
 * The one overlay mechanism in the game — ui/pause.js and ui/learn.js build on
 * this rather than growing a second one. Handles: modal semantics, focus trap,
 * focus restored to whatever opened it, Escape-to-close, backdrop click, and
 * language rebuild.
 *
 * @param {string} [dialogClass] extra class on the dialog box
 * @returns {{ov, dialog, titleId, close, focusFirst, watchLang, onClose, onEscape}}
 *   `onClose` runs after teardown. `onEscape`, if set, REPLACES the default
 *   close-on-Escape (a nested step can then step back instead of closing).
 */
export function overlayRoot(dialogClass = '') {
  injectMenuCSS();
  const host = document.getElementById('ui') || document.body;
  const opener = document.activeElement;   // restored on close, so Tab order survives
  const titleId = 'mn-dlg-' + (++_dlgSeq);
  const dialog = h('div.panel-lift.mn-dialog' + (dialogClass ? '.' + dialogClass : ''),
    { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: -1 });
  const ov = h('div.mn-ov', null, dialog);
  host.appendChild(ov);

  const focusables = () => [...dialog.querySelectorAll('button,[href],input,select,[tabindex]:not([tabindex="-1"])')]
    .filter(e => !e.disabled && e.offsetParent !== null);

  let closed = false;
  const api = {
    ov, dialog, titleId,
    onClose: null,
    onEscape: null,
    close() {
      if (closed) return;
      closed = true;
      removeEventListener('keydown', onKey, true);
      offLang();
      ov.remove();
      if (opener && opener.isConnected && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
      api.onClose?.();
    },
    focusFirst() { requestAnimationFrame(() => (focusables()[0] || dialog).focus({ preventScroll: true })); },
  };

  function onKey(e) {
    // Every open overlay listens on window in the capture phase, so without this
    // guard one Escape closed the whole stack at once (settings opened from the
    // pause menu took the pause menu down with it, unpausing the race).
    if (!isTopOverlay(ov)) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (api.onEscape) api.onEscape(); else api.close();
      return;
    }
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      const nextI = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
      f[nextI].focus({ preventScroll: true });
    }
  }
  addEventListener('keydown', onKey, true);
  ov.addEventListener('click', e => { if (e.target === ov) api.close(); });
  ov.classList.add('on');

  let offLang = () => {};
  api.watchLang = rebuild => { offLang = bus.on('lang:changed', rebuild); };
  return api;
}

// The last .mn-ov in document order is the one on top.
function isTopOverlay(ov) {
  const all = document.querySelectorAll('.mn-ov');
  return !all.length || all[all.length - 1] === ov;
}

function segmented(options, current, onPick) {
  const wrap = h('div.mn-seg');
  for (const o of options) {
    const b = h('button' + (o.value === current ? '.act' : ''), {
      onclick: () => onPick(o.value),
      'aria-pressed': o.value === current ? 'true' : 'false',
    }, o.label);
    wrap.appendChild(b);
  }
  return wrap;
}

/** Reusable settings overlay. settingsOverlay() works standalone; pass {engine} to be safe. */
export function settingsOverlay(opts = {}) {
  const engine = opts.engine || _engine;
  const o = overlayRoot();
  let confirming = false;
  let doneMsg = false;

  const build = () => {
    o.dialog.replaceChildren();
    const quality = save.read('quality') || 'auto';
    const muted = !!save.read('muted');

    appendAll(o.dialog,
      h('h2.display-white', { id: o.titleId }, t('menu.set.title')),
      h('div.mn-drow', null,
        h('span', null, t('menu.set.lang')),
        segmented([{ value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }], getLang(), v => {
          setLang(v);           // bus 'lang:changed' triggers the rebuild below
        })),
      h('div.mn-drow', null,
        h('span', null, t('menu.set.quality')),
        segmented([
          { value: 'low', label: t('menu.set.q.low') },
          { value: 'medium', label: t('menu.set.q.medium') },
          { value: 'high', label: t('menu.set.q.high') },
        ], quality === 'auto' ? (engine?.q?.name || 'high') : quality, v => {
          if (engine?.setQuality) engine.setQuality(v); else save.set({ quality: v });
          build();
        })),
      h('div.mn-drow', null,
        h('span', null, t('menu.set.sound')),
        segmented([
          { value: 'on', label: t('menu.set.on') },
          { value: 'off', label: t('menu.set.off') },
        ], muted ? 'off' : 'on', v => {
          save.set({ muted: v === 'off' });
          bus.emit('audio:mute', v === 'off');
          build();
        })),
      h('div.mn-drow', { style: { borderBlockEnd: 'none' } },
        h('span', null, t('menu.set.reset')),
        doneMsg ? h('span.mn-ok', null, t('menu.set.resetDone'))
          : confirming
            ? h('div.row', null,
              h('button.mn-danger', {
                onclick: () => { save.reset(); bus.emit('save:reset'); confirming = false; doneMsg = true; build(); },
              }, t('menu.set.resetYes')),
              h('button.btn.ghost', { onclick: () => { confirming = false; build(); } }, t('menu.set.resetNo')))
            : h('button.mn-danger', { onclick: () => { confirming = true; build(); } }, t('menu.set.reset'))),
      confirming ? h('div.mn-hint', { style: { color: '#ffb3b3' } }, t('menu.set.resetAsk')) : null,
      h('div.mn-acts', null, h('button.btn', { onclick: () => o.close() }, t('menu.set.close'))));
    o.focusFirst();
  };

  build();
  o.watchLang(build);
  return o;
}

// NOTE: the pause overlay now lives in ui/pause.js, together with the controller
// that actually owns the paused state (see attachPauseControl there). It builds on
// overlayRoot() above, so there is still exactly one overlay mechanism.

/** Short, visual, kid-facing explainer. */
export function howToPlayOverlay(opts = {}) {
  const o = overlayRoot('wide');

  const build = () => {
    o.dialog.replaceChildren();
    const card = (icon, hue, tk, bk) => {
      const el = h('div.mn-hcard', null, howIcon(icon, hue), h('b', null, t(tk)), h('p', null, t(bk)));
      el.style.setProperty('--hue', hue);   // Object.assign(style, …) drops custom props
      return el;
    };
    appendAll(o.dialog,
      h('h2.display-white', { id: o.titleId, style: { textAlign: 'center' } }, t('menu.how.title')),
      h('div.mn-cards', null,
        card('drive', '#6fc3ff', 'menu.how.driveT', 'menu.how.driveB'),
        card('drift', '#7ee081', 'menu.how.driftT', 'menu.how.driftB'),
        card('token', '#ffd66b', 'menu.how.tokenT', 'menu.how.tokenB'),
        card('garage', '#ffb347', 'menu.how.garageT', 'menu.how.garageB')),
      h('div.mn-boregrow', null, boregSVG(), h('span.mn-bubble', null, t('menu.how.boreg'))),
      h('div', { style: { marginBlockStart: '16px' } }, controlHints()),
      h('div.mn-acts', null, h('button.btn', { onclick: () => o.close() }, t('menu.how.got'))));
    o.focusFirst();
  };

  build();
  o.watchLang(build);
  return o;
}

/* ═══════════════════════════════════════════════════════════════ previews ══ */

const SAMPLE_TIMES = [92340, 93980, 95410, 97220, 99050, 101330, 104780, 108120];

function sampleRaceStandings(playerFirst = false) {
  const o = RACERS.map(r => r.id);
  // deterministic, plausible finishing order
  const ids = playerFirst
    ? [o[0], o[4], o[2], o[6], o[1], o[5], o[7], o[3]]
    : [o[4], o[0], o[2], o[6], o[1], o[5], o[7], o[3]];
  return ids.map((id, i) => ({
    racerId: id, place: i + 1, time: SAMPLE_TIMES[i], isPlayer: id === RACERS[0].id,
  }));
}

function samplePodiumStandings() {
  // championship points accumulated over three races, so they are not just 10/8/6…
  const bonus = [17, 14, 12, 9, 8, 6, 4, 3];
  return sampleRaceStandings(true).map((x, i) => ({ ...x, points: pointsFor(x.place) + bonus[i] }));
}

export const preview = (engine, opts = {}) => titleScene(engine, { ...opts, instant: true });
export const previewSelect = (engine, opts = {}) => racerSelectScene(engine, { ...opts, instant: true });
export const previewResults = (engine, opts = {}) => resultsScene(engine, {
  instant: true,
  trackName: getLang() === 'he' ? 'נווה הנתונים' : 'Data Oasis',
  standings: sampleRaceStandings(),
  tokensEarned: 340,
  bestLap: 29870,
  isChampionship: true,
  ...opts,
});
export const previewPodium = (engine, opts = {}) => podiumScene(engine, {
  instant: true, standings: samplePodiumStandings(), totalPoints: 27, ...opts,
});
export const previewSettings = (engine, opts = {}) => {
  const s = titleScene(engine, { ...opts, instant: true });
  settingsOverlay({ engine });
  const dispose = s.dispose;
  s.dispose = () => { document.querySelectorAll('.mn-ov').forEach(n => n.remove()); dispose(); };
  return s;
};
export const previewHowTo = (engine, opts = {}) => {
  const s = titleScene(engine, { ...opts, instant: true });
  howToPlayOverlay();
  const dispose = s.dispose;
  s.dispose = () => { document.querySelectorAll('.mn-ov').forEach(n => n.remove()); dispose(); };
  return s;
};

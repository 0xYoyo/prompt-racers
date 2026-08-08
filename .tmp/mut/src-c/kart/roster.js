// ROSTER — the eight racers of מרוץ הפרומפטים.
//
// Everyone in this game is an original friendly HELPER-ROBOT CREATURE from the
// "AI machine world": rounded, toy-like, built from simple primitives, each with
// its own silhouette (`body`) and two-colour identity. No mascots, no humans,
// no resemblance to anything that exists.
//
// Index 0 is the player, ניצוץ (Nitzotz, "Spark") — locked by the contract.
//
// Stats are 1..5 and deliberately traded off: no racer dominates another on
// (speed, accel, handling). `weight` is a neutral trait — heavy racers win
// bumps and hold top speed, light racers get shoved around but turn on a coin.
//
// `personality` is a driving-style key consumed later by src/kart/ai.js.
import { registerStrings } from '../ui/i18n.js';

// Driving styles the AI is expected to implement. Keep this list authoritative.
export const PERSONALITIES = ['balanced', 'aggressive', 'steady', 'erratic', 'blocker', 'drifter'];

// Silhouette variants understood by createKart() in ./kartmodel.js.
export const BODY_VARIANTS = ['spark', 'slim', 'tank', 'lamp', 'twin', 'round', 'button', 'horn'];

export const ROSTER = [
  {
    id: 'nitzotz',
    nameHe: 'ניצוץ', nameEn: 'Spark',
    color: 0xffc247, color2: 0xff7a2f,
    body: 'spark',                 // antenna with a little spark bulb on top
    stats: { speed: 3, accel: 4, handling: 4, weight: 3 },
    personality: 'balanced',
    player: true,
  },
  {
    id: 'zuzi',
    nameHe: 'זוזי', nameEn: 'Zuzi',
    color: 0x9fe053, color2: 0x147d6b,
    body: 'slim',                  // tall skinny springy body
    stats: { speed: 2, accel: 5, handling: 5, weight: 1 },
    personality: 'erratic',
  },
  {
    id: 'plada',
    nameHe: 'פלדה', nameEn: 'Steel',
    color: 0x5f82b4, color2: 0xe9eef5,
    body: 'tank',                  // wide boxy shoulders, heavy
    stats: { speed: 5, accel: 2, handling: 2, weight: 5 },
    personality: 'blocker',
  },
  {
    id: 'nurit',
    nameHe: 'נורית', nameEn: 'Nurit',
    color: 0xef4436, color2: 0x8fd8c6,
    body: 'lamp',                  // glowing dome head
    stats: { speed: 3, accel: 3, handling: 5, weight: 2 },
    personality: 'steady',
  },
  {
    id: 'zamzum',
    nameHe: 'זמזום', nameEn: 'Buzz',
    color: 0xe257c9, color2: 0x6a45c8,
    body: 'twin',                  // two waggling antennae
    stats: { speed: 5, accel: 4, handling: 1, weight: 3 },
    personality: 'aggressive',
  },
  {
    id: 'tipa',
    nameHe: 'טיפה', nameEn: 'Droplet',
    color: 0x29c2df, color2: 0x123a63,
    body: 'round',                 // fat round belly, tiny head
    stats: { speed: 3, accel: 5, handling: 3, weight: 2 },
    personality: 'drifter',
  },
  {
    id: 'kaftor',
    nameHe: 'כפתור', nameEn: 'Button',
    color: 0x6b4fd8, color2: 0xffd53d,
    body: 'button',                // short and wide with a pressable cap
    stats: { speed: 4, accel: 2, handling: 4, weight: 4 },
    personality: 'steady',
  },
  {
    id: 'raash',
    nameHe: 'רעשן', nameEn: 'Rattle',
    color: 0x9aa3b0, color2: 0x2f6bd8,
    body: 'horn',                  // speaker cones on the shoulders
    stats: { speed: 4, accel: 4, handling: 2, weight: 4 },
    personality: 'aggressive',
  },
];

export const PLAYER_RACER = ROSTER[0];

export const byId = id => ROSTER.find(r => r.id === id) || ROSTER[0];
export const racerIndex = id => Math.max(0, ROSTER.findIndex(r => r.id === id));

// Number worn on the kart livery (1..8).
export const racerNumber = racer => racerIndex(racer?.id ?? racer) + 1;

// Convenience for the select screen / HUD: 'racer.<id>.name', 'racer.<id>.tag'.
export const nameKey = id => `racer.${id}.name`;
export const tagKey = id => `racer.${id}.tag`;

const HE_TAGS = {
  nitzotz: 'קטן, מהיר ותמיד בעניינים',
  zuzi: 'לא עוצר לרגע',
  plada: 'כבד כמו דלת, חזק כמו דלת',
  nurit: 'נוסעת נקי ובלי טעויות',
  zamzum: 'מזמזם ומשתולל בקו הישר',
  tipa: 'מחליקה בסיבובים בכיף',
  kaftor: 'לוחץ על עצמו וזה עובד',
  raash: 'שומעים אותו לפני שרואים אותו',
};
const EN_TAGS = {
  nitzotz: 'Small, quick, always up for it',
  zuzi: 'Never stops moving',
  plada: 'Heavy as a door, strong as a door',
  nurit: 'Clean laps, no mistakes',
  zamzum: 'Buzzes flat out on the straights',
  tipa: 'Drifts through corners for fun',
  kaftor: 'Presses his own button, it works',
  raash: 'You hear him before you see him',
};

const he = {}, en = {};
for (const r of ROSTER) {
  he[nameKey(r.id)] = r.nameHe;
  en[nameKey(r.id)] = r.nameEn;
  he[tagKey(r.id)] = HE_TAGS[r.id] || '';
  en[tagKey(r.id)] = EN_TAGS[r.id] || '';
}
he['racer.stat.speed'] = 'מהירות';
he['racer.stat.accel'] = 'תאוצה';
// "אחיזה", not "שליטה" — the select screen and the garage both already call
// this stat אחיזה, and a stat that changes its name between two screens is a
// different stat as far as a 10-year-old is concerned.
he['racer.stat.handling'] = 'אחיזה';
he['racer.stat.weight'] = 'משקל';
he['racer.you'] = 'זה אני';
en['racer.stat.speed'] = 'Speed';
en['racer.stat.accel'] = 'Accel';
en['racer.stat.handling'] = 'Handling';
en['racer.stat.weight'] = 'Weight';
en['racer.you'] = 'You';

registerStrings({ he, en });

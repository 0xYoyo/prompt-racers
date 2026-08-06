// Hebrew-first i18n. Hebrew is the source language: `he` strings are authored
// natively (not translated from English), `en` is the secondary toggle.
//
// Subsystems register their OWN strings via registerStrings() so no two modules
// ever edit the same table — keeps parallel work conflict-free.
import { bus } from '../core/bus.js';
import { save } from '../core/save.js';

const tables = { he: {}, en: {} };
let lang = save.read('lang') || 'he';

export function registerStrings(pack) {
  for (const l of Object.keys(pack)) Object.assign(tables[l] ||= {}, pack[l]);
}

// t('key') or t('key', {n: 3}) — {n} style interpolation.
export function t(key, vars) {
  let s = tables[lang]?.[key] ?? tables.he?.[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}

export const getLang = () => lang;
export const isRTL = () => lang === 'he';

export function setLang(l) {
  if (l === lang) return;
  lang = l;
  save.set({ lang: l });
  applyDir();
  bus.emit('lang:changed', l);
}

export function applyDir() {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = isRTL() ? 'rtl' : 'ltr';
  html.classList.toggle('rtl', isRTL());
  html.classList.toggle('ltr', !isRTL());
}

// Hebrew digits are the same glyphs, but numbers inside RTL text need isolation
// or the browser reorders them ("3 / 1" instead of "1 / 3"). Wrap all numerals.
export const num = n => `⁦${n}⁩`;

// Ordinal place: Hebrew uses a different construction than English -st/-nd/-th.
export function ordinal(place) {
  if (lang === 'he') {
    const words = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני'];
    return words[place] || `${place}`;
  }
  const s = ['th', 'st', 'nd', 'rd'], v = place % 100;
  return place + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function formatTime(ms) {
  if (ms == null || !isFinite(ms)) return '--:--';
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const h = Math.floor((total % 1000) / 10);
  return `⁦${m}:${String(s).padStart(2, '0')}.${String(h).padStart(2, '0')}⁩`;
}

registerStrings({
  he: {
    'game.title': 'מרוץ הפרומפטים',
    'common.back': 'חזרה',
    'common.continue': 'המשך',
    'common.next': 'הבא',
    'common.close': 'סגירה',
    'common.tokens': 'טוקנים',
    'common.loading': 'טוען…',
  },
  en: {
    'game.title': 'Prompt Racers',
    'common.back': 'Back',
    'common.continue': 'Continue',
    'common.next': 'Next',
    'common.close': 'Close',
    'common.tokens': 'Tokens',
    'common.loading': 'Loading…',
  },
});

// HOME-SCREEN policy gate, against the real dist/index.html.
//
// Wave 4 item: the home screen was decluttered (settings and "how was this built"
// became corner icons, האוסף שלי joined the centre column), the key legend was
// wrong in a way nobody could see in a screenshot they were not looking hard at,
// and there are now TWO destructive confirms that erase different things. Each of
// those is a silent-failure shape:
//
//  1. THE CENTRE COLUMN. "Exactly four entries" is a claim that decays the moment
//     someone adds a fifth button, and the two that moved out can drift back in.
//     Asserted by reading the live DOM of the built game, not the source.
//
//  2. THE ICONS ARE REACHABLE AND SAY WHAT THEY ARE. An icon with no visible
//     label is a guessing game; an icon a keyboard cannot reach is a control a
//     child who does not use a mouse simply does not have. TAB is pressed through
//     the BROWSER (page.keyboard), never dispatched at `window` — the modaltest
//     lesson: a synthetic event delivered where real ones do not arrive exercises
//     nothing. The label's visibility is read on real focus.
//
//  3. THE LEGEND POINTS OUTWARD. This is the assertion that needs geometry, not
//     text: the caps' TEXT was always "←" and "→"; what was wrong was their
//     ORDER on screen under RTL, where the flex row mirrored and printed "→ ←".
//     So the check compares the rendered x of the two caps, in BOTH languages.
//
//  4. THE TWO RESETS DIFFER, AND THE COLLECTION SURVIVES ONE OF THEM. The
//     dangerous seam: badges/glossary/stats live in the same save blob as the
//     championship keys, and resetChampionship() is one `save.set` away from
//     taking them with it. Nothing on screen would say so — the child finds out
//     a week later. Asserted explicitly, from localStorage, after a real click on
//     a real confirm button. Also asserted: nothing is written while the question
//     is still on screen.
//
//  5. THE VOLUME SLIDER PERSISTS. Driven with real arrow keys on the focused
//     input (the child's own path), then survives a reload.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// --dist <path> aims the gate at another built file. It exists for the mutation
// runs that prove these assertions bite: the tree is shared with other agents, so
// a deliberately broken menus.js is built into a throwaway copy under .tmp/ and
// the source is put back at once, rather than leaving a broken dist/ standing for
// the four minutes a full run takes.
const distArg = process.argv.indexOf('--dist');
const dist = distArg >= 0 && process.argv[distArg + 1]
  ? resolve(root, process.argv[distArg + 1]) : resolve(root, 'dist/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(dist)) { console.error('dist missing — npm run build'); process.exit(2); }

const b = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
const page = await b.newPage();
await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

let fails = 0;
const ok = (n, v, d = '') => {
  if (!v) fails++;
  console.log(`  ${v ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n.padEnd(62)} ${d}`);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const evalp = (fn, ...a) => page.evaluate(fn, ...a);

const SAVE_KEY = 'promptracers.v1';
// 30s is puppeteer's default and it is not enough here: the machine runs several
// of these gates at once under swiftshader, and tools/selecttest.mjs has already
// been recorded in GAPS.md crashing on exactly this reload. A gate that flakes
// teaches people to re-run gates until they go green, which is the habit that
// lets a real failure through — so: a long ceiling, and one retry.
page.setDefaultNavigationTimeout(120000);
page.setDefaultTimeout(120000);

/** Boot the built game with a known save, then land on the home screen. */
async function boot(state = {}, lang = 'he', attempt = 0) {
  try {
    await page.goto('file://' + dist, { waitUntil: 'load' });
    await evalp((k, v) => localStorage.setItem(k, JSON.stringify(v)), SAVE_KEY, state);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 120000 });
  } catch (e) {
    if (attempt >= 1) throw e;
    console.log(`  \x1b[2m…boot timed out (${e.message.split('\n')[0]}), retrying once\x1b[0m`);
    return boot(state, lang, attempt + 1);
  }
  await evalp(l => window.__DEBUG.goto('menu', { lang: l }), lang);
  await wait(400);
}
const readSave = () => evalp(k => JSON.parse(localStorage.getItem(k) || '{}'), SAVE_KEY);
// The centre column, as a child reads it: the visible button labels under the logo.
const centreColumn = () => evalp(() => [...document.querySelectorAll('.mn-menu button')]
  .filter(el => el.offsetParent !== null)
  .map(el => (el.textContent || '').trim().replace(/\s+/g, ' ')));
const overlays = () => evalp(() => document.querySelectorAll('.mn-ov').length);
const dialogText = () => evalp(() => {
  const d = [...document.querySelectorAll('.mn-ov .mn-dialog')].pop();
  return d ? (d.textContent || '').replace(/\s+/g, ' ').trim() : '';
});
// Click a visible button by its text, through a real mouse click at its centre —
// geometry included, so a control covered by something else fails here.
async function clickText(sel, re) {
  const box = await evalp((s, src) => {
    const rx = new RegExp(src);
    const el = [...document.querySelectorAll(s)].find(x => x.offsetParent !== null && rx.test(x.textContent || ''));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel, re.source);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await wait(300);
  return true;
}

const SEEDED = {
  lang: 'he', championshipRace: 1, tokens: 24,
  results: [{ track: 0, place: 2, time: 91000 }],
  parts: { engine: { id: 'e1', score: 70 } },
  bestPrompt: 'מנוע חזק ושקט',
  badges: ['first-race', 'clean-lap'],
  glossary: ['prompt', 'token'],
  stats: { races: 1, quizRight: 4 },
  volume: 0.75,
};

console.log('\n  HOME SCREEN: CHROME, LEGEND, RESETS, VOLUME\n  ' + '─'.repeat(76));

/* ── 1. the centre column is only the four things a child came here to do ── */
console.log('\n  1. the centre column');
await boot({ lang: 'he' });
{
  const col = await centreColumn();
  ok('the home screen has a centre column at all', col.length > 0, `${col.length} buttons`);
  ok('it is exactly the four expected entries', col.length === 4, col.join(' | '));
  ok('…championship start', /אליפות/.test(col[0] || ''), col[0] || '');
  ok('…המוסך של בורג', col.some(x => /המוסך של בורג/.test(x)));
  ok('…איך משחקים', col.some(x => /איך משחקים/.test(x)));
  ok('…האוסף שלי', col.some(x => /האוסף שלי/.test(x)));
  ok('Settings is NOT in the centre column', !col.some(x => /^הגדרות$/.test(x)), col.join(' | '));
  ok('"how was this built" is NOT in the centre column', !col.some(x => /נבנה/.test(x)));
}
{
  // Mid-championship the column gains the abandon button and nothing else — the
  // state in which "exactly four" is most likely to quietly become "exactly six".
  await boot(SEEDED);
  const col = await centreColumn();
  ok('mid-championship it gains ONLY "אליפות חדשה"', col.length === 5 && col.some(x => /אליפות חדשה/.test(x)),
    col.join(' | '));
  ok('…and still no settings / how-it-was-built',
    !col.some(x => /^הגדרות$/.test(x) || /נבנה/.test(x)));
}
{
  const col = await centreColumn();
  ok('האוסף שלי navigates by scene name (no import of collection.js)',
    await evalp(() => {
      const el = [...document.querySelectorAll('.mn-menu button')].find(x => /האוסף שלי/.test(x.textContent));
      if (!el) return false;
      let asked = null;
      const real = window.__DEBUG.engine.goto.bind(window.__DEBUG.engine);
      window.__DEBUG.engine.goto = n => { asked = n; return Promise.resolve(); };
      el.click();
      window.__DEBUG.engine.goto = real;
      return asked === 'collection';
    }), `column: ${col.length}`);
}

/* ── 2. the corner icons ─────────────────────────────────────────────────── */
console.log('\n  2. the gear and the info icon');
await boot({ lang: 'he' });
{
  const icons = await evalp(() => [...document.querySelectorAll('.mn-icon')].map(el => ({
    cls: el.className,
    label: (el.getAttribute('aria-label') || '').trim(),
    text: (el.textContent || '').trim(),
    svg: el.querySelectorAll('svg path,svg rect,svg circle').length,
    w: Math.round(el.getBoundingClientRect().width),
    corner: el.parentElement.className,
  })));
  ok('two corner icons exist', icons.length === 2, icons.map(i => i.label).join(' | '));
  ok('…both are drawn as inline SVG shapes (no asset, no emoji)',
    icons.length === 2 && icons.every(i => i.svg >= 2), icons.map(i => `${i.svg} shapes`).join(', '));
  ok('…both are a real tap target (≥40px)', icons.every(i => i.w >= 40), icons.map(i => i.w + 'px').join(', '));
  ok('the gear is the settings icon, at the inline start',
    !!icons.find(i => /הגדרות/.test(i.label) && /\btl\b/.test(i.corner)));
  ok('the info icon is "how was this built", at the inline end',
    !!icons.find(i => /נבנה/.test(i.label) && /\btr\b/.test(i.corner)));
  ok('…and each carries its label as its accessible name AND as text',
    icons.every(i => i.label.length > 2 && i.text === i.label));
}
{
  // TAB, through the browser. A label that only answers the mouse is invisible to
  // the children who need it most, so the reveal is read on real keyboard focus.
  const hidden = await evalp(() => [...document.querySelectorAll('.mn-iconlab')]
    .every(el => getComputedStyle(el).visibility === 'hidden'));
  ok('the labels are hidden until asked for', hidden);

  await evalp(() => document.body.focus());
  let reached = [];
  for (let i = 0; i < 14 && reached.length < 2; i++) {
    await page.keyboard.press('Tab');
    await wait(60);
    const r = await evalp(() => {
      const el = document.activeElement;
      if (!el || !el.classList.contains('mn-icon')) return null;
      const lab = el.querySelector('.mn-iconlab');
      const cs = lab ? getComputedStyle(lab) : null;
      return { label: (el.getAttribute('aria-label') || '').trim(),
        shown: !!cs && cs.visibility === 'visible' && +cs.opacity > 0.9 };
    });
    if (r && !reached.some(x => x.label === r.label)) reached.push(r);
  }
  ok('both icons are reachable by TAB', reached.length === 2, reached.map(r => r.label).join(' | '));
  ok('…and each shows its label on keyboard focus', reached.length === 2 && reached.every(r => r.shown),
    reached.map(r => `${r.label}:${r.shown ? 'shown' : 'HIDDEN'}`).join(', '));
}
{
  await clickText('.mn-icon', /הגדרות/);
  ok('the gear opens settings', /הגדרות/.test(await dialogText()) && (await overlays()) === 1);
  await page.keyboard.press('Escape'); await wait(250);
  await clickText('.mn-icon', /נבנה/);
  ok('the info icon opens "how was this game built"', /נבנה/.test(await dialogText()));
  await page.keyboard.press('Escape'); await wait(250);
  ok('…and both close again', (await overlays()) === 0);
}

/* ── 3. the controls legend, in both languages ───────────────────────────── */
console.log('\n  3. the key legend points outward, in both languages');
// The caps are read by RENDERED POSITION, not by DOM order: the bug was that the
// RTL flex row mirrored a correct DOM order into "→  ←" on screen.
const legend = sel => evalp(s => {
  const strip = [...document.querySelectorAll(s)].find(e => e.offsetParent !== null);
  if (!strip) return null;
  const groups = [...strip.querySelectorAll('.mn-caps')].map(g => ({
    text: (g.textContent || '').replace(/\s+/g, ' ').trim(),
    caps: [...g.querySelectorAll('.mn-kbd')].map(k => ({
      t: (k.textContent || '').trim(), x: k.getBoundingClientRect().left })),
  }));
  return { groups, text: (strip.textContent || '').replace(/\s+/g, ' ').trim() };
}, sel);

for (const lang of ['he', 'en']) {
  await boot({ lang }, lang);
  for (const [where, sel, open] of [['title', '.mn-keys', null], ['how-to-play', '.mn-ov .mn-keys', /איך משחקים|How to Play/]]) {
    if (open) { await clickText('.mn-menu button', open); }
    const L = await legend(sel);
    ok(`[${lang}] the ${where} legend is on screen`, !!L && L.groups.length >= 4,
      L ? `${L.groups.length} groups` : 'MISSING');
    if (L) {
      const steer = L.groups.find(g => /←/.test(g.text) && /→/.test(g.text));
      ok(`[${lang}] ${where}: the steering group exists`, !!steer, steer ? steer.text : L.text.slice(0, 40));
      if (steer) {
        const left = steer.caps.find(c => c.t === '←'), right = steer.caps.find(c => c.t === '→');
        ok(`[${lang}] ${where}: the arrows point OUTWARD (← is drawn left of →)`,
          !!left && !!right && left.x < right.x,
          left && right ? `← at ${Math.round(left.x)}, → at ${Math.round(right.x)}` : 'missing a cap');
      }
      const drift = L.groups.find(g => /Shift/.test(g.text));
      ok(`[${lang}] ${where}: drift reads "Shift / Space"`,
        !!drift && /Shift\s*\/\s*Space/.test(drift.text), drift ? drift.text : 'no Shift group');
      ok(`[${lang}] ${where}: …and Shift is not glued to Space as one chord`,
        !!drift && drift.caps.length === 2, drift ? `${drift.caps.length} caps` : '');
    }
    if (open) { await page.keyboard.press('Escape'); await wait(250); }
  }
}

/* ── 4. אליפות חדשה — championship only, collection survives ─────────────── */
console.log('\n  4. "אליפות חדשה" asks first, and keeps the collection');
await boot(SEEDED);
{
  const before = await readSave();
  ok('precondition: the seeded save really has a championship AND a collection',
    before.championshipRace === 1 && before.tokens === 24 && before.badges.length === 2 &&
    before.glossary.length === 2 && Object.keys(before.parts).length === 1,
    `race ${before.championshipRace}, ${before.tokens} tokens, ${before.badges.length} badges`);

  ok('the button is on screen', await clickText('.mn-menu button', /אליפות חדשה/));
  const txt = await dialogText();
  ok('…and it opens a confirmation rather than resetting', (await overlays()) === 1);
  ok('…whose scope chip says "האליפות בלבד"', /האליפות בלבד/.test(txt), txt.slice(0, 40));
  ok('…which names what it erases', /תוצאות|התוצאות/.test(txt) && /טוקנים/.test(txt) && /חלקים/.test(txt));
  ok('…and says the badges and glossary STAY', /התגים והמילון/.test(txt) && /נשארים/.test(txt));
  ok('…and does not carry the full-wipe wording', !/אין דרך חזרה/.test(txt));

  const during = await readSave();
  ok('NOTHING is written while the question is on screen',
    JSON.stringify(during) === JSON.stringify(before),
    `race ${during.championshipRace}, ${during.tokens} tokens`);

  ok('the safe answer is focused first',
    await evalp(() => /לא,/.test(document.activeElement?.textContent || '')),
    await evalp(() => (document.activeElement?.textContent || '').trim()));

  await clickText('.mn-ov button', /לא,/);
  const after = await readSave();
  ok('cancelling changes nothing at all', (await overlays()) === 0 &&
    JSON.stringify(after) === JSON.stringify(before));

  await clickText('.mn-menu button', /אליפות חדשה/);
  await clickText('.mn-ov button', /כן, אליפות חדשה/);
  await wait(400);
  const done = await readSave();
  ok('confirming clears championshipRace / results / tokens / parts / bestPrompt',
    done.championshipRace === 0 && (done.results || []).length === 0 && done.tokens === 0 &&
    Object.keys(done.parts || {}).length === 0 && !done.bestPrompt,
    `race ${done.championshipRace}, ${done.tokens} tokens, ${(done.results || []).length} results`);
  // THE SEAM. These live in the same blob and one careless key in the reset's
  // save.set() takes them with it, silently, a week before anyone notices.
  ok('…and the BADGES survive', (done.badges || []).length === 2, JSON.stringify(done.badges));
  ok('…and the GLOSSARY survives', (done.glossary || []).length === 2, JSON.stringify(done.glossary));
  ok('…and the lifetime STATS survive', done.stats && done.stats.races === 1, JSON.stringify(done.stats));
}

/* ── 5. settings' full wipe — everything, and it says so ─────────────────── */
console.log('\n  5. the settings full wipe erases the collection too');
await boot(SEEDED);
{
  const before = await readSave();
  ok('precondition: a collection to lose', (before.badges || []).length === 2);
  await clickText('.mn-icon', /הגדרות/);
  ok('settings is open', (await overlays()) === 1);
  await clickText('.mn-ov .mn-danger', /איפוס התקדמות/);
  const txt = await dialogText();
  ok('…the reset button opens a confirmation of its own', (await overlays()) === 2);
  ok('…whose scope chip says "הכול"', /הכול/.test(txt), txt.slice(0, 30));
  ok('…which says the badges and glossary go too',
    /תגים/.test(txt) && /מילון/.test(txt) && /אין דרך חזרה/.test(txt));
  ok('…and is NOT the championship wording', !/נשארים/.test(txt));
  const during = await readSave();
  ok('nothing is written while THIS question is on screen',
    JSON.stringify(during) === JSON.stringify(before));

  await clickText('.mn-ov button', /כן, למחוק הכול/);
  await wait(400);
  const done = await readSave();
  ok('confirming empties the badges', (done.badges || []).length === 0, JSON.stringify(done.badges));
  ok('…and the glossary', (done.glossary || []).length === 0, JSON.stringify(done.glossary));
  ok('…and the championship with it', !done.championshipRace && !done.tokens);
}

/* ── 6. the master volume slider ─────────────────────────────────────────── */
console.log('\n  6. master volume: keyboard, persistence, and the on/off toggle');
await boot({ lang: 'he', volume: 0.75 });
{
  await clickText('.mn-icon', /הגדרות/);
  const info = await evalp(() => {
    const el = document.querySelector('.mn-vol input[type=range]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { value: el.value, w: Math.round(r.width), h: Math.round(r.height),
      label: el.getAttribute('aria-label') || '',
      onOff: [...document.querySelectorAll('.mn-ov .mn-seg button')].some(b => /דולק|כבוי/.test(b.textContent)) };
  });
  ok('the slider exists in settings', !!info, info ? `value ${info.value}` : 'MISSING');
  ok('…alongside the on/off toggle, not instead of it', !!info && info.onOff);
  ok('…starts at the saved volume', info && info.value === '75', info && info.value);
  ok('…is big enough to grab', !!info && info.w >= 100 && info.h >= 24, info && `${info.w}x${info.h}`);
  ok('…and names itself for a screen reader', !!info && info.label.length > 2, info && info.label);

  // Real keys on the focused control. Under RTL the range is mirrored (max at the
  // inline start), so ArrowLeft is the one that RAISES it — that is the native
  // behaviour and the reason the slider is not pinned to LTR.
  await evalp(() => document.querySelector('.mn-vol input[type=range]').focus());
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowLeft'); await wait(60); }
  const raised = await evalp(() => ({
    v: document.querySelector('.mn-vol input[type=range]').value,
    read: (document.querySelector('.mn-volval') || {}).textContent,
    saved: JSON.parse(localStorage.getItem('promptracers.v1') || '{}').volume,
  }));
  ok('arrow keys move it (RTL: ArrowLeft raises)', +raised.v === 90, `${raised.v}%`);
  ok('…the readout follows', raised.read === '90%', String(raised.read));
  ok('…and it is persisted immediately', Math.abs(raised.saved - 0.9) < 1e-6, String(raised.saved));

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 120000 });
  await evalp(() => window.__DEBUG.goto('menu', {}));
  await wait(400);
  await clickText('.mn-icon', /הגדרות/);
  const back = await evalp(() => document.querySelector('.mn-vol input[type=range]')?.value);
  ok('the volume survives a reload', back === '90', String(back));
}

ok('no page errors', errs.length === 0, errs[0] || '');
console.log('  ' + '─'.repeat(76));
console.log(fails ? `\n  \x1b[31m${fails} FAILED\x1b[0m\n` : '\n  \x1b[32mall home-screen checks passed\x1b[0m\n');
await b.close();
process.exit(fails ? 1 : 0);

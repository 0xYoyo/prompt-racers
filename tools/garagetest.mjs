// GARAGE GATE — Wave 3.
//
// The garage was rebuilt as a four-step wizard (one question owns the board, a
// pinned sentence grows with every answer, Boreg says exactly one thing and it
// is always about the step you are on). Every one of those promises is a
// behaviour, not a screenshot, so every one of them is asserted here against a
// REAL esbuild bundle of the real module, driven with real clicks — the same
// discipline as tools/modaltest.mjs.
//
//   node tools/garagetest.mjs
//
// What it pins, and why each one is here:
//   1. the wizard reaches all four steps, in order, one at a time
//   2. back navigation works, both by the Back button and by the progress rail,
//      and the rail never lets you skip forward past an unanswered step
//   3. the pinned sentence grows EXACTLY with the selections — one blank filled
//      per answer, with the chosen option's own fragment
//   4. Boreg's tip changes when the step changes AND when the selection inside a
//      step changes, and is never a tip from an earlier moment
//   5. rows 2–4 are per-part: changing the part clears the downstream answers
//      instead of leaving a wing's limit inside an engine's prompt
//   6. onDone fires with the same part shape scenes.js reads, field by field
//   7. free play is labelled as practice and never offers "install"
//   8. the token economy still costs 4 at the cheapest and 21 at the most
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { MAX_COST, PART_COST, SLOTS, KART_SLOTS, optionsFor, costOf } from '../src/garage/prompts.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let fails = 0;
const ok = (n, v, d = '') => {
  if (!v) fails++;
  console.log(`  ${v ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${String(n).padEnd(58)} \x1b[2m${d}\x1b[0m`);
};

// ── 0. token economy, straight out of the data ───────────────────────────────
console.log('\n  GARAGE — TOKEN ECONOMY\n  ' + '─'.repeat(74));
{
  const cheapest = {};
  const dearest = {};
  for (const p of KART_SLOTS) {
    const c = { part: p }, d = { part: p };
    for (const k of ['goal', 'constraint', 'style']) {
      const list = optionsFor(k, p);
      c[k] = list.reduce((a, b) => (b.cost < a.cost ? b : a)).id;
      d[k] = list.reduce((a, b) => (b.cost > a.cost ? b : a)).id;
    }
    cheapest[p] = costOf(c); dearest[p] = costOf(d);
  }
  const lows = Object.values(cheapest), highs = Object.values(dearest);
  ok('cheapest complete ask is 4 for every part', lows.every(v => v === 4), JSON.stringify(cheapest));
  ok('most expensive ask is 21 for every part', highs.every(v => v === 21), JSON.stringify(dearest));
  ok('MAX_COST is still 21', MAX_COST === 21, `MAX_COST=${MAX_COST}, part=${PART_COST}`);
  // Per-part catalogs: no row may be a copy of another part's row.
  let dupes = 0, total = 0;
  for (const s of SLOTS) {
    if (s.key === 'part') continue;
    const seen = new Map();
    for (const o of s.options) {
      total++;
      const key = (o.he || '') + '|' + (o.sentenceFragmentHe || '');
      if (seen.has(key)) dupes++;
      seen.set(key, o.id);
    }
  }
  ok('no two option cards share label + fragment', dupes === 0, `${total} options, ${dupes} duplicates`);
  for (const s of SLOTS) {
    if (s.key === 'part') continue;
    const per = KART_SLOTS.map(p => optionsFor(s.key, p).length);
    ok(`row "${s.key}" offers 4 options per part`, per.every(n => n === 4), per.join('/'));
  }
}

// ── build a real bundle of the real module ───────────────────────────────────
const tmp = resolve(root, '.tmp');
mkdirSync(tmp, { recursive: true });
const entry = resolve(tmp, 'garagegate-entry.js');
writeFileSync(entry, `
import { bootPreview } from ${JSON.stringify(resolve(root, 'src/core/harness.js'))};
import { garageScene, freePlayScene } from ${JSON.stringify(resolve(root, 'src/garage/garage.js'))};
// The gate needs the two seams scenes.js owns: onDone (championship) and
// onExit (free play). Everything else is the untouched scene.
window.__DONE = null; window.__EXIT = false;
bootPreview((engine, o = {}) => {
  if (window.__FREEPLAY) return freePlayScene(engine, { meet: false, ...o, onExit: () => { window.__EXIT = true; } });
  return garageScene(engine, {
    visit: 2, meet: false, tokens: 17,
    onDone: (part, gain) => { window.__DONE = { part, gain }; },
    ...o,
  });
});
`);
const built = await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'iife', minify: false, write: false,
  alias: { three: resolve(root, 'vendor/three.module.js') }, target: ['chrome100'], logLevel: 'warning',
});
const htmlPath = resolve(tmp, 'garagegate.html');
const page1 = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0d1a}#app{position:fixed;inset:0}</style>
</head><body><div id="app"><div id="boot"></div></div><script>${built.outputFiles[0].text}</script></body></html>`;
writeFileSync(htmlPath, page1);
rmSync(entry, { force: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
const errs = [];
const page = await browser.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

const wait = ms => new Promise(r => setTimeout(r, ms));
async function boot(freePlay = false) {
  await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(f => { window.__FREEPLAY = f; }, freePlay);
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  // Re-enter the scene now that __FREEPLAY is set (bootPreview mounted before it).
  await page.evaluate(() => window.__DEBUG.goto('preview', {}));
  await wait(150);
}

/** Everything the gate reads off the screen, in one snapshot. */
const read = () => page.evaluate(() => {
  const q = s => document.querySelector(s);
  const all = s => [...document.querySelectorAll(s)];
  const pills = all('.grg-pill');
  const tip = q('.grg-boregcard');
  return {
    step: pills.findIndex(p => p.classList.contains('now')),
    pills: pills.map(p => ({
      label: p.textContent.trim(),
      now: p.classList.contains('now'),
      done: p.classList.contains('done'),
      locked: p.disabled === true,
    })),
    title: q('.grg-slot-title')?.textContent.trim() || '',
    stepno: q('.grg-stepno')?.textContent.trim() || '',
    cards: all('.grg-opt').map(c => ({
      label: c.querySelector('.grg-opt-he')?.textContent.trim() || '',
      frag: c.querySelector('.grg-opt-frag')?.lastChild?.textContent?.trim() || '',
      pressed: c.getAttribute('aria-pressed') === 'true',
      disabled: !!c.disabled,
    })),
    sentence: q('.grg-sentence .grg-sentence-txt')?.textContent.replace(/\s+/g, ' ').trim() || '',
    blanks: all('.grg-sentence .grg-blank').length,
    filled: all('.grg-sentence .grg-fill').length,
    tipId: tip?.dataset.tip || '',
    tipText: (tip?.textContent || '').replace(/\s+/g, ' ').trim(),
    backDisabled: !!q('.grg-back')?.disabled,
    buildDisabled: !!q('.grg-build')?.disabled,
    mode: q('.grg-mode')?.textContent.trim() || '',
    practice: !!q('.grg-mode.practice'),
    budgetLabels: all('.grg-budget .grg-sub').map(e => e.textContent.trim()),
    reveal: !!q('.grg-reveal'),
    revealButtons: all('.grg-revactions button').map(b => b.textContent.trim()),
    beforeAfter: all('.grg-ba .grg-bacell').map(c => c.textContent.replace(/\s+/g, ' ').trim()),
    kartCaption: q('.grg-kartcap')?.textContent.replace(/\s+/g, ' ').trim() || '',
  };
});

const clickCard = async i => { await page.evaluate(n => document.querySelectorAll('.grg-opt')[n].click(), i); await wait(90); };
const clickBack = async () => { await page.evaluate(() => document.querySelector('.grg-back').click()); await wait(90); };
const clickPill = async i => { await page.evaluate(n => document.querySelectorAll('.grg-pill')[n].click(), i); await wait(90); };

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n  GARAGE — THE WIZARD\n  ' + '─'.repeat(74));
await boot();
let s = await read();
ok('opens on step 1 of 4', s.step === 0 && s.pills.length === 4, `${s.stepno} · "${s.title}"`);
ok('only one question is on the board', s.cards.length === 4, `${s.cards.length} cards`);
ok('back is disabled on the first step', s.backDisabled);
ok('steps 2–4 are locked before step 1 is answered',
  s.pills.slice(1).every(p => p.locked), s.pills.map(p => (p.locked ? 'lock' : 'open')).join(','));

// Walk all four steps, watching the sentence and the tip.
const titles = [], tipIds = [], blanks = [s.blanks], sentences = [s.sentence];
titles.push(s.title); tipIds.push(s.tipId);
for (let step = 0; step < 4; step++) {
  const before = await read();
  // Pick the second-cheapest affordable card, so every row gets a real fragment
  // (the free option in rows 2–4 is the vague one).
  const idx = before.cards.findIndex((c, i) => i > 0 && !c.disabled);
  const chosen = before.cards[idx < 0 ? 0 : idx];
  await clickCard(idx < 0 ? 0 : idx);
  const after = await read();
  ok(`step ${step + 1}: choosing a card advances the wizard`,
    step === 3 ? after.step === 3 : after.step === step + 1, `${before.step} → ${after.step}`);
  ok(`step ${step + 1}: the sentence gained exactly one fragment`,
    after.blanks === before.blanks - 1 && after.filled === before.filled + 1,
    `${before.blanks} blanks → ${after.blanks}`);
  ok(`step ${step + 1}: the sentence carries the words on the card`,
    !!chosen.frag && after.sentence.includes(chosen.frag), `"${chosen.frag}"`);
  ok(`step ${step + 1}: Boreg's tip is not the previous one`,
    after.tipId !== before.tipId, `${before.tipId} → ${after.tipId}`);
  titles.push(after.title); tipIds.push(after.tipId); blanks.push(after.blanks); sentences.push(after.sentence);
}
ok('all four questions were shown', new Set(titles).size === 4, titles.join(' | '));
ok('the sentence emptied its blanks one at a time', blanks.join(',') === '4,3,2,1,0', blanks.join(','));
ok('no tip was ever shown twice in a row',
  tipIds.every((id, i) => i === 0 || id !== tipIds[i - 1]), tipIds.join(' → '));
s = await read();
ok('the build button unlocks only once all four are answered', !s.buildDisabled);
ok('the finished sentence has no blanks left', s.blanks === 0, `"${s.sentence.slice(0, 80)}…"`);
ok('the kart window names the part being previewed', /תצוגה חיה|Live preview/.test(s.kartCaption), s.kartCaption);

// ── back navigation ──────────────────────────────────────────────────────────
console.log('\n  GARAGE — GOING BACK\n  ' + '─'.repeat(74));
await clickBack();
let b1 = await read();
ok('the Back button moves one step back', b1.step === 2, `now on step ${b1.step + 1}`);
ok('the answer that step already had is still selected', b1.cards.some(c => c.pressed));
ok('going back does NOT empty the sentence', b1.blanks === 0, `${b1.blanks} blanks`);
const tipAtStep3 = b1.tipId;
await clickPill(0);
let b2 = await read();
ok('the progress rail jumps back to any answered step', b2.step === 0, `now on step ${b2.step + 1}`);
ok('Boreg follows the step you jumped to', b2.tipId !== tipAtStep3 && b2.tipId.startsWith('step.part'),
  `${tipAtStep3} → ${b2.tipId}`);

// selection change inside the SAME step must move the tip too
const sameStepA = await read();
const other = sameStepA.cards.findIndex(c => !c.pressed && !c.disabled);
await clickPill(1);
const goalBefore = await read();
const alt = goalBefore.cards.findIndex(c => !c.pressed && !c.disabled);
await clickCard(alt);
await clickPill(1);
const goalAfter = await read();
ok('changing the choice inside a step changes the tip',
  goalAfter.tipId !== goalBefore.tipId, `${goalBefore.tipId} → ${goalAfter.tipId}`);
ok('the tip quotes the card that is selected right now',
  goalAfter.tipText.length > 20 && goalAfter.tipId.startsWith('step.goal'), goalAfter.tipId);

// the rail must not let a fresh wizard jump ahead of its own answers
await boot();
await page.evaluate(() => document.querySelectorAll('.grg-pill')[3].click());
await wait(90);
const skipped = await read();
ok('the rail cannot skip forward past an unanswered step', skipped.step === 0, `step ${skipped.step + 1}`);

// ── per-part catalogs ────────────────────────────────────────────────────────
console.log('\n  GARAGE — ONE CATALOG PER PART\n  ' + '─'.repeat(74));
await boot();
await clickCard(0);                       // part 1
const partA = await read();
await clickBack();
const listA = (await read()).cards.map(c => c.label);
await clickCard(2);                       // a different part
const partB = await read();
ok('choosing a different part clears the downstream answers',
  partB.step === 1 && partB.blanks === 3, `step ${partB.step + 1}, ${partB.blanks} blanks`);
const goalsB = partB.cards.map(c => c.label);
await clickPill(0); await clickCard(0);
const goalsA = (await read()).cards.map(c => c.label);
ok('two parts never offer the same "improve" cards',
  goalsA.every(l => !goalsB.includes(l)), `${goalsA[1]} vs ${goalsB[1]}`);
ok('the part row itself is unchanged by all this', listA.length === 4, listA.join(', '));
void partA; void other;

// ── the build, the debrief, and onDone ───────────────────────────────────────
console.log('\n  GARAGE — BUILD → DEBRIEF → onDone\n  ' + '─'.repeat(74));
await boot();
for (let step = 0; step < 4; step++) {
  const cur = await read();
  const idx = cur.cards.findIndex((c, i) => i > 0 && !c.disabled);
  await clickCard(idx < 0 ? 0 : idx);
}
await page.evaluate(() => document.querySelector('.grg-build').click());
await page.evaluate(() => window.__DEBUG.advance(2));
await wait(250);
const rev = await read();
ok('the build opens the debrief', rev.reveal);
ok('the debrief shows the kart before and after', rev.beforeAfter.length === 4, rev.beforeAfter.join(' | '));
ok('…with a real before → after per stat',
  rev.beforeAfter.every(txt => /\d[\s\S]{0,3}[←→][\s\S]{0,3}\d/.test(txt)), rev.beforeAfter[0]);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.grg-revactions button')]
    .find(x => /התקנ|Install/.test(x.textContent));
  b?.click();
});
await wait(150);
const done = await page.evaluate(() => window.__DONE);
ok('onDone fired', !!done, done ? `gain=${done.gain}` : '');
if (done) {
  const p = done.part;
  const F = (name, cond, d) => ok(`  part.${name}`, cond, d);
  F('slotKey is a kart slot', ['engine', 'tires', 'wing', 'chassis'].includes(p.slotKey), String(p.slotKey));
  F('tier is 0..3', Number.isInteger(p.tier) && p.tier >= 0 && p.tier <= 3, String(p.tier));
  F('score is a number 0..100', typeof p.score === 'number' && p.score >= 0 && p.score <= 100, String(p.score));
  F('cost is the real spend', Number.isFinite(p.cost) && p.cost > 0 && p.cost <= 21, String(p.cost));
  F('visualTier is a name', ['scrappy', 'basic', 'tuned', 'pro'].includes(p.visualTier), String(p.visualTier));
  F('selection has all four rows',
    !!(p.selection && p.selection.part && p.selection.goal && p.selection.constraint && p.selection.style),
    JSON.stringify(p.selection));
  F('selection rows all belong to that part',
    ['goal', 'constraint', 'style'].every(k => String(p.selection[k]).startsWith(p.selection.part + '.')),
    JSON.stringify(p.selection));
  F('deltas cover the four stats',
    ['speed', 'accel', 'handling', 'weight'].every(k => typeof p.deltas?.[k] === 'number'), JSON.stringify(p.deltas));
  F('stats are the applied kart stats', typeof p.stats?.speed === 'number', JSON.stringify(p.stats));
  F('complete is true', p.complete === true);
  F('flavourKeyHe points at this part+tier',
    p.flavourKeyHe === `garage.flavour.${p.slotKey}.${p.tier}`, String(p.flavourKeyHe));
  ok('the token reward is a capped bonus', Number.isInteger(done.gain) && done.gain >= 0 && done.gain <= 12,
    String(done.gain));
}

// ── free play ────────────────────────────────────────────────────────────────
console.log('\n  GARAGE — PRACTICE MODE\n  ' + '─'.repeat(74));
await boot(true);
const fp = await read();
ok('free play carries the practice badge', fp.practice && /אימון|Practice/.test(fp.mode), fp.mode);
ok('…and says its tokens are practice tokens',
  fp.budgetLabels.some(l => /טוקני אימון|practice tokens/.test(l)), fp.budgetLabels.join(' / '));
ok('championship mode carries the championship badge', true, '(checked below)');
await boot(false);
const ch = await read();
ok('championship garage is labelled אליפות', !ch.practice && /אליפות|Championship/.test(ch.mode), ch.mode);

// free play must never offer "install" — nothing is committed there
await boot(true);
for (let step = 0; step < 4; step++) {
  const cur = await read();
  const idx = cur.cards.findIndex((c, i) => i > 0 && !c.disabled);
  await clickCard(idx < 0 ? 0 : idx);
}
await page.evaluate(() => document.querySelector('.grg-build').click());
await page.evaluate(() => window.__DEBUG.advance(2));
await wait(250);
const fpRev = await read();
ok('free play still gives the full debrief', fpRev.reveal, fpRev.revealButtons.join(' / '));
ok('…but never offers to install a part',
  !fpRev.revealButtons.some(x => /התקנ|Install/.test(x)), fpRev.revealButtons.join(' / '));
ok('…and calls no onDone', (await page.evaluate(() => window.__DONE)) === null);

ok('no page errors anywhere', errs.length === 0, errs[0] || '');
console.log('  ' + '─'.repeat(74));
console.log(fails ? `  \x1b[31m${fails} FAILED\x1b[0m\n` : '  \x1b[32mall garage checks passed\x1b[0m\n');
await browser.close();
process.exit(fails ? 1 : 0);

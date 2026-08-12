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
  //
  // This used to hash only label + fragment, and was therefore blind to the line
  // that actually teaches. 27 distinct subtitles covered 48 cards: "הגבלה אמיתית
  // שאפשר למדוד" appeared on all four parts' limit rows, and the whole style row
  // was four templates with the nouns swapped. The second line is where the
  // lesson lives, so it is hashed on its own too, in BOTH languages.
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
  for (const field of ['subHe', 'subEn']) {
    const seen = new Map();
    const clash = [];
    for (const s of SLOTS) {
      for (const o of s.options) {
        const v = (o[field] || '').trim();
        if (!v) continue;
        if (seen.has(v)) clash.push(`${seen.get(v)} = ${o.id}`);
        seen.set(v, o.id);
      }
    }
    ok(`every card's teaching line (${field}) is its own`, clash.length === 0,
      `${seen.size} distinct / 52 cards${clash.length ? ' · ' + clash.slice(0, 3).join(' · ') : ''}`);
  }
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
import { garageScene, freePlayScene, setKartPreviewMounter } from ${JSON.stringify(resolve(root, 'src/garage/garage.js'))};
import { createKart } from ${JSON.stringify(resolve(root, 'src/kart/kartmodel.js'))};
import { ROSTER } from ${JSON.stringify(resolve(root, 'src/kart/roster.js'))};
// THE REAL KART, wired the way scenes.js wires it.
//
// This bundle used to omit the mounter, so mountKartPreview() fell through to
// garage.js's in-file placeholder — whose setPart() is an empty function and
// which has no setParts at all. Every 3D assertion in this file was therefore a
// regex on a DOM caption, and deleting applyKartPreview() entirely still passed
// all 68 checks. A gate that renders nothing cannot see a rendering bug, so the
// gate now renders exactly what the game renders.
setKartPreviewMounter((container3D, o = {}) => {
  const kart = createKart({ racer: ROSTER[0], engine: o.engine, parts: o.parts });
  container3D.add(kart.group);
  return kart;
});
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

// ── the reward moment shows the kart ─────────────────────────────────────────
// The debrief used to throw a scrim over the only 3D on the screen, so at the
// exact moment the game says "look what your prompt made" the child could not
// see it. Two live karts now sit inside the debrief — what they got, and the
// greyed twin a different prompt would have produced. Both are real renders, so
// the gate reads their pixels: blank canvases and two identical canvases both
// fail.
console.log('\n  GARAGE — THE DEBRIEF SHOWS THE KART\n  ' + '─'.repeat(74));
{
  await page.evaluate(async () => {
    window.__FREEPLAY = false;
    await window.__DEBUG.goto('preview', {
      tokens: 99, meet: false, visit: 2, phase: 'reveal',
      selection: { part: 'engine', goal: 'engine.exit', constraint: 'engine.balanced', style: 'engine.forge' },
    });
  });
  await page.evaluate(() => { window.__DEBUG.advance(0.6); window.__DEBUG.renderOnce(); });
  await wait(150);
  const cv = await page.evaluate(() => [...document.querySelectorAll('.grg-reveal .grg-minicv')].map(c => {
    const cx = c.getContext('2d');
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0; const bag = new Set(); let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 24) lit++;
      bag.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
      sum += d[i] + d[i + 1] + d[i + 2];
    }
    return { w: c.width, h: c.height, lit: lit / (d.length / 4), colors: bag.size, sum };
  }));
  ok('the debrief carries two live kart windows', cv.length === 2, `${cv.length} canvases`);
  ok('…and neither of them is blank', cv.length === 2 && cv.every(c => c.lit > 0.06 && c.colors > 24),
    cv.map(c => `${(c.lit * 100).toFixed(0)}% covered / ${c.colors} colours`).join(' · '));
  ok('…and the two karts are not the same picture', cv.length === 2 && cv[0].sum !== cv[1].sum,
    cv.map(c => c.sum).join(' vs '));
}

// ── "before" is the kart the child actually owns ─────────────────────────────
// BASE_STATS is the bare factory kart. From visit 2 the child is wearing parts,
// and the 3D preview already knew it (the mounter reads save.read('parts')) —
// so the panel captioned "your kart" and the debrief's before column were
// describing a kart nobody had driven since race 1. `opts.ownedParts` fixes it
// and defaults to today's behaviour.
console.log('\n  GARAGE — "BEFORE" IS THE KART THE CHILD OWNS\n  ' + '─'.repeat(74));
{
  const digits = s => (s.match(/\d+/g) || []).map(Number);
  const revealWith = async ownedParts => {
    await page.evaluate(async o => {
      window.__FREEPLAY = false;
      window.__DONE = null;
      await window.__DEBUG.goto('preview', {
        tokens: 99, meet: false, visit: 3, phase: 'reveal', ownedParts: o,
        selection: { part: 'tires', goal: 'tires.slip', constraint: 'tires.none', style: 'tires.any' },
      });
    }, ownedParts);
    await wait(120);
    return (await read()).beforeAfter.map(digits);
  };
  const bare = await revealWith({});
  ok('with nothing owned, "before" is still the factory kart 52/48/50/50',
    JSON.stringify(bare.map(d => d[0])) === JSON.stringify([52, 48, 50, 50]), JSON.stringify(bare));
  // engine tier 2 is +15 speed / +11 accel / 0 handling / +1 weight
  const owned = await revealWith({ engine: 2 });
  ok('with a tier-2 engine owned, "before" is 67/59/50/51 — the kart on screen',
    JSON.stringify(owned.map(d => d[0])) === JSON.stringify([67, 59, 50, 51]), JSON.stringify(owned));
  // …and re-fitting a slot the child already owns only promises the DIFFERENCE
  const same = await page.evaluate(async () => {
    window.__DONE = null;
    await window.__DEBUG.goto('preview', {
      tokens: 99, meet: false, visit: 3, phase: 'reveal', ownedParts: { tires: 0 },
      selection: { part: 'tires', goal: 'tires.slip', constraint: 'tires.none', style: 'tires.any' },
    });
    const b = [...document.querySelectorAll('.grg-revactions button')].find(x => /התקנ|Install/.test(x.textContent));
    b?.click();
    return window.__DONE;
  });
  // The same tier-0 tires the kart is already wearing: no change at all, and the
  // screen has to say so instead of re-promising the upgrade a third time.
  ok('re-fitting the tier you already own promises nothing',
    !!same && ['speed', 'accel', 'handling', 'weight'].every(k => same.part.deltas[k] === 0),
    JSON.stringify(same?.part?.deltas));
  ok('…and onDone reports the kart that drives away, not a factory one',
    !!same && same.part.stats.speed === 54 && same.part.stats.handling === 53,
    JSON.stringify(same?.part?.stats));
}

// ═════════════════════════════════════════════════════════════════════════════
// THE 3D PREVIEW — measured in pixels, not in captions.
//
// Everything above this line could pass with a kart that never changes. These
// checks drive the real model to tier 0 and to tier 3 for each of the four
// slots, screenshot the preview window, and count the pixels that moved. The
// same-state noise floor is measured in the same run rather than assumed, so a
// regression to "the caption changed and nothing else did" fails here.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n  GARAGE — THE KART REALLY CHANGES (PIXELS)\n  ' + '─'.repeat(74));

// Per-slot floor. Measured after the chassis kit was made legible; every slot
// clears its own floor with room, and the same-state noise sits under 1%.
const MIN_CHANGE = 0.055;          // 5.5% of the preview window must move
const MAX_NOISE = 0.020;           // two identical frames may differ by 2%
const NOISE_MULT = 2.5;            // …and a real change must beat the noise 2.5×

/** The extreme selections for a part: everything vaguest, or everything sharpest. */
function selectionFor(part, sharp) {
  const sel = { part, goal: null, constraint: null, style: null };
  for (const k of ['goal', 'constraint', 'style']) {
    const list = optionsFor(k, part);
    sel[k] = list.reduce((a, b) => ((sharp ? b.specificity > a.specificity : b.specificity < a.specificity) ? b : a)).id;
  }
  return sel;
}

// HOLD THE FRAME STILL. The kart is projected into the DOM preview window and
// scaled to fit it, so anything that changes that window's box — a sentence that
// wraps to a second line, one of Boreg's longer tips — moves and resizes the
// kart for reasons that have nothing to do with the part. Pinning the two boxes
// above the window makes the comparison about the model and only the model.
// (Gate-only CSS, injected with !important so it survives the scene's own sheet
// being re-appended on every goto.)
async function pinLayout() {
  await page.evaluate(() => {
    if (document.getElementById('gate-pin')) return;
    const el = document.createElement('style');
    el.id = 'gate-pin';
    el.textContent = `.grg-sentence{height:104px!important;overflow:hidden!important}
      .grg-kart{flex:0 0 300px!important;height:300px!important;
        max-height:300px!important;min-height:300px!important}`;
    document.documentElement.appendChild(el);
  });
}

async function showSelection(sel) {
  await page.evaluate(async s => {
    window.__FREEPLAY = false;
    await window.__DEBUG.goto('preview', { selection: s, tokens: 99, meet: false, visit: 2 });
  }, sel);
  await pinLayout();
  // Let the model settle so "the kart is still easing into place" is not read as
  // a change; the garage kart is static once settled, so this makes the floor real.
  await page.evaluate(() => window.__DEBUG.advance(1.2));
  await wait(120);
}

/** Meshes in the live scene — a caption cannot move this number. */
const meshCount = () => page.evaluate(() => {
  let n = 0;
  window.__DEBUG.engine.active.scene.traverse(o => { if (o.isMesh) n++; });
  return n;
});

// `node tools/garagetest.mjs --shots` also writes every preview capture to
// shots/garage-preview-*.png, which is what a critic looks at.
const DUMP = process.argv.includes('--shots');

/** Grab the preview window's pixels and park them in the page under `tag`. */
async function snap(tag) {
  await page.evaluate(() => window.__DEBUG.renderOnce());
  const rect = await page.evaluate(() => {
    const r = document.querySelector('.grg-kart').getBoundingClientRect();
    return { x: Math.round(r.x + 2), y: Math.round(r.y + 2), w: Math.round(r.width - 4), h: Math.round(r.height - 4) };
  });
  const png = await page.screenshot({ encoding: 'base64', type: 'png' });
  if (DUMP) {
    mkdirSync(resolve(root, 'shots'), { recursive: true });
    await page.screenshot({
      path: resolve(root, `shots/garage-preview-${tag}.png`),
      clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
    });
  }
  return page.evaluate(async (b64, r, key) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    (window.__SNAP ||= {})[key] = cx.getImageData(r.x, r.y, r.w, r.h);
    return r;
  }, png, rect, tag);
}

/** Fraction of pixels that differ between two parked snapshots. */
const diffRatio = (a, b) => page.evaluate((ka, kb) => {
  const A = window.__SNAP[ka], B = window.__SNAP[kb];
  if (!A || !B || A.width !== B.width || A.height !== B.height) return 1;
  const da = A.data, db = B.data;
  let changed = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    if (d > 12) changed++;
  }
  return changed / (da.length / 4);
}, a, b);

await boot();
{
  // 1. The mounter really is the real kart. The placeholder is 7 meshes; the
  //    model is ~150. If this ever drops back, every check below is worthless.
  await showSelection(selectionFor('engine', false));
  const n0 = await meshCount();
  ok('the preview mounts the REAL kart, not the placeholder', n0 > 60, `${n0} meshes in the scene`);

  // 2. The noise floor, MEASURED rather than assumed: the same state, entered
  //    twice, with the same settling. The junk tiers have deliberately wobbling
  //    parts, so this is not zero, and a "the kart changed" claim has to beat it.
  await showSelection(selectionFor('chassis', false));
  await snap('noiseA');
  await showSelection(selectionFor('chassis', false));
  await snap('noiseB');
  const noise = await diffRatio('noiseA', 'noiseB');
  ok('the same state, entered twice, renders the same kart', noise <= MAX_NOISE,
    `${(noise * 100).toFixed(2)}% noise floor (cap ${(MAX_NOISE * 100).toFixed(0)}%)`);

  // 3. Every slot, tier 0 vs tier 3: pixels AND mesh count must both move.
  const table = [];
  for (const part of KART_SLOTS) {
    await showSelection(selectionFor(part, false));
    const meshLo = await meshCount();
    const boxLo = await snap(part + '0');
    await showSelection(selectionFor(part, true));
    const meshHi = await meshCount();
    const boxHi = await snap(part + '3');
    const ratio = await diffRatio(part + '0', part + '3');
    table.push({ part, ratio, meshLo, meshHi });
    ok(`${part}: both frames were captured from the same box`,
      JSON.stringify(boxLo) === JSON.stringify(boxHi), `${boxLo.w}x${boxLo.h} vs ${boxHi.w}x${boxHi.h}`);
    ok(`${part}: tier 0 → tier 3 repaints the preview`,
      ratio >= MIN_CHANGE && ratio >= noise * NOISE_MULT,
      `${(ratio * 100).toFixed(1)}% changed (floor ${(MIN_CHANGE * 100).toFixed(1)}%, noise×${NOISE_MULT} = ${(noise * NOISE_MULT * 100).toFixed(1)}%)`);
    ok(`${part}: …and the mesh count moves with the tier`, meshLo !== meshHi,
      `${meshLo} → ${meshHi} meshes`);
  }
  console.log('  ' + '·'.repeat(74));
  for (const r of table) {
    console.log(`    ${r.part.padEnd(9)} ${(r.ratio * 100).toFixed(1).padStart(5)}% changed   ${r.meshLo} → ${r.meshHi} meshes`);
  }
  console.log('  ' + '·'.repeat(74));
}

// ── the part a child never built must not stay on the kart ───────────────────
// Build an engine up to tier 3, rail back to step 1 and switch to the wing:
// the state is {wing:0} but the kart used to still be wearing the tier-3 engine,
// because applyKartPreview() only ever wrote the slot it was previewing. Every
// comparison for the rest of that visit was then against a kart the child never
// asked for.
console.log('\n  GARAGE — SWITCHING PART LEAVES NO RESIDUE\n  ' + '─'.repeat(74));
{
  // Get there the way a child does. (goto with an empty selection re-enters a
  // fresh wizard without reloading the page, which would drop the snapshots.)
  await showSelection({ part: null, goal: null, constraint: null, style: null });
  const partIdx = p => SLOTS[0].options.findIndex(o => o.id === p);
  await clickCard(partIdx('engine'));
  for (let step = 1; step < 4; step++) {
    const cur = await read();
    const idx = cur.cards.reduce((best, c, i) => (c.disabled ? best : i), 0);   // sharpest affordable
    await clickCard(idx);
  }
  await page.evaluate(() => window.__DEBUG.advance(1.2));
  const loaded = await meshCount();
  await clickPill(0);
  await clickCard(partIdx('wing'));
  await page.evaluate(() => window.__DEBUG.advance(1.2));
  await wait(120);
  const after = await read();
  const dirty = await meshCount();
  const boxDirty = await snap('wingAfter');

  // …and what a wing kart that never met an engine looks like.
  await showSelection({ part: 'wing', goal: null, constraint: null, style: null });
  const clean = await meshCount();
  const boxClean = await snap('wingClean');
  const residue = await diffRatio('wingClean', 'wingAfter');
  ok('both residue frames came from the same box',
    JSON.stringify(boxClean) === JSON.stringify(boxDirty), `${boxClean.w}x${boxClean.h} vs ${boxDirty.w}x${boxDirty.h}`);
  ok('the engine really was built up before switching', loaded > clean, `${loaded} vs ${clean} meshes`);
  ok('switching the part clears the downstream answers', after.blanks === 3, `${after.blanks} blanks`);
  ok('…and the kart drops the part that is no longer selected', dirty === clean,
    `${dirty} meshes, a clean wing kart is ${clean}`);
  ok('…and the preview LOOKS like a clean wing kart', residue < Math.max(MAX_NOISE, 0.02),
    `${(residue * 100).toFixed(2)}% different from the clean render`);
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

// ═════════════════════════════════════════════════════════════════════════════
// THE REVEAL FITS, OR SCROLLS AND SAYS SO — measured in pixels.
//
// The debrief ("מה כל שורה בפרומפט עשתה") is the payoff of the entire
// educational core, and it used to run off the bottom of the modal on every
// panel shorter than 1080: the last section was cut mid-row, inside an
// overflow:auto box with no visible scrollbar (Chrome's overlay scrollbars are
// invisible until you already scroll), so the screen looked broken rather than
// scrollable — 156px lost at 1366x768, 275px at 1024x640.
//
// This section asserts GEOMETRY, not markup:
//   · the reveal state was really reached (three debrief rows and the section
//     title, in the language under test) — an assertion over an empty screen is
//     not an assertion
//   · the whole modal and its buttons are inside the viewport
//   · EITHER the content fits its scroll box outright — last row's bottom edge
//     inside the box's visible bottom edge — OR the box genuinely scrolls, in
//     which case the affordance must be VISIBLE (the cue is painted, and a real
//     scrollbar gutter is reserved) and scrolling to the end must bring the last
//     row entirely inside the visible box
//   · the scroll region is keyboard-reachable and still comes before the buttons
//
// It runs in its own browser WITHOUT --hide-scrollbars: the gate above hides
// them so they cannot pollute the kart pixel-diffs, but a check about whether a
// child can see that there is more to read cannot run in a window where
// scrollbars have been switched off.
console.log('\n  GARAGE — THE REVEAL FITS, OR SCROLLS AND SAYS SO\n  ' + '─'.repeat(74));
{
  const layoutBrowser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--mute-audio'],
  });
  const lp = await layoutBrowser.newPage();
  lp.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  lp.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await lp.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 60000 });
  await lp.evaluate(() => { window.__FREEPLAY = false; });
  await lp.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

  // The three short panels the project tests. 1366x768 is the school laptop and
  // 1024x640 is the floor; 1280x720 sits between them and used to fail too.
  const SIZES = [[1366, 768], [1280, 720], [1024, 640]];
  // Two real prompts, because the reveal's height depends on what was asked: a
  // sharp one (longest recap, most fragments) and a vague one (the ghost card
  // flips into the "you could have had this" invitation).
  const CASES = [
    ['sharp', { part: 'tires', goal: 'tires.late', constraint: 'tires.wear', style: 'tires.stripe' }],
    ['vague', { part: 'engine', goal: 'engine.good', constraint: 'engine.none', style: 'engine.any' }],
  ];
  // The title of the section that was being clipped, in both languages. If the
  // language never actually flipped (the capture harness once wrote the language
  // to save and never called setLang, leaving every string Hebrew), the English
  // rows fail here instead of quietly testing Hebrew twice.
  const TITLE = { he: 'מה כל שורה בפרומפט עשתה', en: 'What each line of the prompt did' };

  const measure = async expectTitle => lp.evaluate(title => {
    const q = s => document.querySelector(s);
    const box = el => { const r = el.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, h: r.height }; };
    const sc = q('.grg-rev-scroll');
    const rows = [...document.querySelectorAll('.grg-rev-scroll .grg-dbrow')];
    const labels = [...document.querySelectorAll('.grg-rev-scroll .label')].map(e => e.textContent.trim());
    if (!sc || !rows.length) return { reached: false, rows: rows.length, labels };
    const last = rows[rows.length - 1];
    const cue = q('.grg-morecue');
    const body = q('.grg-revbody');
    const install = q('.grg-revactions button');
    return {
      reached: true, rows: rows.length, labels, titleShown: labels.includes(title),
      vw: innerWidth, vh: innerHeight,
      reveal: box(q('.grg-reveal')), actions: box(q('.grg-revactions')),
      scroller: box(sc), last: box(last),
      ch: sc.clientHeight, sh: sc.scrollHeight, scrollTop: sc.scrollTop,
      hasMore: !!(body && body.classList.contains('has-more')),
      cueOpacity: cue ? +getComputedStyle(cue).opacity : 0,
      cueBox: cue ? box(cue) : null,
      focusable: sc.tabIndex === 0,
      // eslint-disable-next-line no-bitwise
      scrollerBeforeButtons: !!(install && (sc.compareDocumentPosition(install) & Node.DOCUMENT_POSITION_FOLLOWING)),
    };
  }, expectTitle);

  // The cue fades in and out over 180ms. Reading it mid-transition measures the
  // transition, not the design, so every measurement waits for it to settle on
  // 0 or 1 first — the same class of mistake as measuring "silence" on a screen
  // that is secretly still running the game.
  const settle = async () => {
    await lp.waitForFunction(() => {
      const c = document.querySelector('.grg-morecue');
      if (!c) return true;
      const o = +getComputedStyle(c).opacity;
      return o < 0.02 || o > 0.98;
    }, { timeout: 5000 }).catch(() => {});
  };

  for (const lang of ['he', 'en']) {
    console.log(`  \x1b[2m── lang ${lang} ──\x1b[0m`);
    for (const [w, h] of SIZES) {
      for (const [name, sel] of CASES) {
        await lp.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
        await lp.evaluate(async (s, l) => {
          await window.__DEBUG.goto('preview', {
            lang: l, tokens: 99, meet: false, visit: 2, phase: 'reveal', selection: s,
          });
        }, sel, lang);
        await wait(420);
        await settle();
        const tag = `${w}x${h} ${name}`;
        const m = await measure(TITLE[lang]);
        // 1. The state under test was really reached, in the language under test.
        ok(`${tag}: the debrief is on screen, in ${lang}`,
          m.reached && m.rows === 3 && m.titleShown,
          m.reached ? `${m.rows} rows · "${(m.labels[m.labels.length - 1] || '').slice(0, 34)}"` : 'no reveal');
        if (!m.reached || !m.titleShown) continue;

        const issues = [];
        if (m.reveal.b > m.vh + 1 || m.reveal.t < -1) issues.push(`modal outside viewport (${Math.round(m.reveal.t)}..${Math.round(m.reveal.b)} of ${m.vh})`);
        if (m.actions.b > m.vh + 1) issues.push(`buttons ${Math.round(m.actions.b - m.vh)}px below the edge`);
        const overflow = m.sh - m.ch;
        let mode;
        if (overflow <= 2) {
          mode = 'fits';
          // The clip that started all this: the last line of the last section
          // sitting below the visible bottom edge of its own container.
          if (m.last.b > m.scroller.b + 1) issues.push(`last debrief row ${Math.round(m.last.b - m.scroller.b)}px below the box with nothing to scroll`);
          if (m.hasMore) issues.push('claims there is more below when there is not');
        } else {
          mode = `scrolls ${overflow}px`;
          // The affordance has to be PAINTED, over the end of the box, at a size
          // a child can see. (A reserved scrollbar gutter cannot be asserted
          // here: this platform draws overlay scrollbars, which reserve no width
          // and ignore scrollbar-gutter — which is precisely why the overflow
          // was invisible in the first place and why the cue has to exist.)
          if (!m.hasMore || m.cueOpacity < 0.9) issues.push(`overflows ${overflow}px with no visible cue (opacity ${m.cueOpacity})`);
          if (!m.cueBox) issues.push('no cue element at all');
          else {
            if (m.cueBox.b > m.vh + 1) issues.push('the cue itself is off-screen');
            if (m.cueBox.h < 24 || m.cueBox.r - m.cueBox.l < 120) issues.push(`the cue is too small to notice (${Math.round(m.cueBox.r - m.cueBox.l)}x${Math.round(m.cueBox.h)})`);
            if (Math.abs(m.cueBox.b - m.scroller.b) > 3) issues.push('the cue is not at the bottom edge of the box');
          }
          // …and the end must be reachable: scrolled to the bottom, the last row
          // has to be ENTIRELY inside the visible box.
          await lp.evaluate(() => { const s = document.querySelector('.grg-rev-scroll'); s.scrollTop = s.scrollHeight; });
          await wait(200);
          await settle();
          const end = await measure(TITLE[lang]);
          if (end.last.b > end.scroller.b + 1 || end.last.t < end.scroller.t - 1) {
            issues.push(`scrolled to the bottom the last row is still ${Math.round(end.last.b - end.scroller.b)}px out`);
          }
          // …and once there really is nothing left below, the cue has to say so.
          // Measured against the LIVE numbers, not against "we asked it to
          // scroll": the debrief's kart canvases can still be settling, and a cue
          // that is on while content genuinely remains is telling the truth.
          // (Only asked of a scroll a child would actually perform: at a
          // hairline overflow of a dozen pixels, clientHeight/scrollHeight
          // rounding makes "am I at the bottom" a coin toss for the gate and for
          // the page alike, and the answer does not matter — nothing is hidden.)
          const leftAtEnd = end.sh - end.ch - end.scrollTop;
          if (end.hasMore && leftAtEnd <= 8 && overflow > 24) issues.push(`still says "more below" at the bottom (top ${Math.round(end.scrollTop)} of ${end.sh - end.ch}, opacity ${end.cueOpacity})`);
        }
        ok(`${tag}: the explanation is readable (${mode})`, issues.length === 0, issues.join(' · ') || `${m.sh}px of content in ${m.ch}px`);
        ok(`${tag}: the explanation is keyboard-reachable, before the buttons`,
          m.focusable && m.scrollerBeforeButtons,
          `tabindex ${m.focusable ? '0' : 'missing'}, ${m.scrollerBeforeButtons ? 'precedes' : 'FOLLOWS'} the actions`);
      }
    }
  }
  await layoutBrowser.close();
}

ok('no page errors anywhere', errs.length === 0, errs[0] || '');
console.log('  ' + '─'.repeat(74));
console.log(fails ? `  \x1b[31m${fails} FAILED\x1b[0m\n` : '  \x1b[32mall garage checks passed\x1b[0m\n');
await browser.close();
process.exit(fails ? 1 : 0);

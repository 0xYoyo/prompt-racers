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

  // 2. The noise floor, measured — two captures of the identical state.
  await snap('noiseA');
  await snap('noiseB');
  const noise = await diffRatio('noiseA', 'noiseB');
  ok('two captures of the SAME state are nearly identical', noise <= MAX_NOISE,
    `${(noise * 100).toFixed(2)}% (cap ${(MAX_NOISE * 100).toFixed(0)}%)`);

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
  // What "a fresh wizard on step 2 of a wing" is supposed to look like.
  await showSelection({ part: 'wing', goal: null, constraint: null, style: null });
  const clean = await meshCount();
  await snap('wingClean');

  // Now get there the way a child does.
  await boot();
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
  await snap('wingAfter');
  const residue = await diffRatio('wingClean', 'wingAfter');
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

ok('no page errors anywhere', errs.length === 0, errs[0] || '');
console.log('  ' + '─'.repeat(74));
console.log(fails ? `  \x1b[31m${fails} FAILED\x1b[0m\n` : '  \x1b[32mall garage checks passed\x1b[0m\n');
await browser.close();
process.exit(fails ? 1 : 0);

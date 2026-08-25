// RACER-SELECT policy + kart-seam gate, against the real dist/index.html.
//
// Wave 3 item 12. Three things are pinned here, all of them silent failures:
//
//  1. THE SEAM. menus.js must never import kart/kartmodel.js (it would stop
//     rendering standalone under tools/preview.mjs), so the eight karts arrive
//     through setSelectKartMounter, filled in from scenes.js. That mounter is
//     makeKartFor(), whose racerId defaults to the SAVE — so "eight cards quietly
//     wearing the player's kart" is the exact failure this screen invites, and it
//     is invisible in a screenshot at thumbnail size. Every kart names itself
//     `kart:<the racer createKart actually resolved>`, and this file reads those
//     names back off the live scene graph. It also re-runs the whole check with a
//     NON-default racerId in the save, because a default of ROSTER[0] would have
//     made the bug pass by coincidence.
//
//  2. SELECTING IS NOT STARTING. A click on a card, or Enter on a card, picks —
//     and nothing else. Exactly one code path leads into a race: the start
//     button. Both the mouse and the keyboard path are driven here.
//
//  3. THE KARTS ARE ACTUALLY ON SCREEN. A mounted, correctly-named kart that is
//     scissored to a zero-size rect, parked off-camera or fitted to 0.001 scale
//     passes every DOM assertion above. So the last section reads real pixels out
//     of a rendered frame, per card window: the window must not be a flat plate
//     (a kart has dark tyres and a silhouette against a bright colour plate), the
//     eight windows must differ from each other, and the picture must CHANGE as
//     the turntable turns — which nothing but a live 3D kart can do.
//
// Also prints the measured per-frame cost of the eight-kart stage on the high and
// low tiers, and asserts the low tier really does degrade (one animated kart, no
// rim light) rather than merely claiming to.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ROSTER_IDS = ['nitzotz', 'zuzi', 'plada', 'nurit', 'zamzum', 'tipa', 'kaftor', 'raash'];

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
  console.log(`  ${v ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n.padEnd(60)} ${d}`);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const evalp = (fn, ...a) => page.evaluate(fn, ...a);
const scene = () => evalp(() => window.__DEBUG.engine.activeName);

/** Boot the real build with a controlled save, then land on racer select. */
async function bootSelect({ saveState = {}, lang = 'he', quality = 'high', tap = false } = {}) {
  await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
  await evalp(s => localStorage.setItem('promptracers.v1', JSON.stringify(s)), saveState);
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  // `tap` records every menu:racer BEFORE the screen is entered — that event is
  // what audio.js turns into the ui.select sound, so the recording is the sound
  // log. Installed pre-goto so a stray emit during build() is caught too.
  if (tap) await evalp(() => { window.__RACERTAP = []; window.__DEBUG.bus.on('menu:racer', r => window.__RACERTAP.push(r?.id ?? '?')); });
  await evalp((l, q) => window.__DEBUG.goto('select', { lang: l, quality: q }), lang, quality);
  await wait(350);
}

/** Selection sounds heard since the last resetTap(), oldest first. */
const tapped = () => evalp(() => (window.__RACERTAP || []).slice());
const resetTap = () => evalp(() => { if (window.__RACERTAP) window.__RACERTAP.length = 0; });

const mounted = () => evalp(() => window.__DEBUG.engine.active.mountedKarts());
const picked = () => evalp(() => window.__DEBUG.engine.active.selectedRacerId());
const selCards = () => evalp(() => [...document.querySelectorAll('.mn-card.sel')].map(c => c.dataset.racer));

console.log('\n  RACER SELECT — kart seam, pick-vs-start, and real pixels\n  ' + '─'.repeat(74));

/* ═════════════════════════════════════ 1. the eight karts are eight karts ══ */
console.log('\n  1. the kart seam (8 cards, 8 different racers)');
await bootSelect();
{
  const m = await mounted();
  ok('racer select exposes one kart slot per roster racer', m.length === 8, `${m.length} slots`);
  ok('the slots are the roster, in order',
    m.map(s => s.racerId).join(',') === ROSTER_IDS.join(','), m.map(s => s.racerId).join(','));

  const named = m.filter(s => s.name);
  ok('every card actually mounted something', named.length === 8, `${named.length}/8 named`);

  const placeholders = m.filter(s => (s.name || '').startsWith('placeholder:'));
  ok('the mounter seam is FILLED (no placeholder blocks in the real build)',
    placeholders.length === 0, placeholders.map(s => s.racerId).join(', ') || 'all real karts');

  const wrong = m.filter(s => s.name !== 'kart:' + s.racerId);
  ok('each card wears ITS OWN racer\'s kart', wrong.length === 0,
    wrong.map(s => `${s.racerId}←${s.name}`).join(', ') || '8/8 correct');

  const distinct = new Set(m.map(s => s.name));
  ok('all 8 mounted karts are distinct', distinct.size === 8, `${distinct.size} distinct names`);

  ok('every card window is on screen', m.every(s => s.visible),
    `${m.filter(s => s.visible).length}/8 laid out`);
}

// The trap the seam invites: makeKartFor() falls back to save.racerId, so a save
// holding anything other than ROSTER[0] would expose a mounter that ignores the
// racerId it was handed. With a default save that bug is indistinguishable from
// correct behaviour, which is why this repeats with a non-default racer.
console.log('\n  1b. …with a NON-default racer in the save (the save-backed trap)');
await bootSelect({ saveState: { racerId: 'plada', parts: { engine: 3, tires: 3 } } });
{
  const m = await mounted();
  const wrong = m.filter(s => s.name !== 'kart:' + s.racerId);
  ok('a saved racerId does not leak into the other seven cards', wrong.length === 0,
    wrong.map(s => `${s.racerId}←${s.name}`).join(', ') || '8/8 correct');
  ok('…and all 8 are still distinct', new Set(m.map(s => s.name)).size === 8);
  ok('the saved racer is the one pre-selected', (await picked()) === 'plada', await picked());
}

/* ═══════════════════════════════════════ 2. a click PICKS, it does not race ══ */
console.log('\n  2. mouse: clicking a card selects, and only selects');
await bootSelect();
{
  ok('starts on the player racer', (await picked()) === 'nitzotz', await picked());
  await page.click('.mn-card[data-racer="tipa"]');
  await wait(200);
  ok('clicking a card changes the selection', (await picked()) === 'tipa', await picked());
  ok('…and the scene did NOT change', (await scene()) === 'select', await scene());
  const sel = await selCards();
  ok('…and exactly one card carries the selected state', sel.length === 1 && sel[0] === 'tipa', sel.join(','));
  ok('…marked for assistive tech too',
    await evalp(() => document.querySelector('.mn-card[data-racer="tipa"]').getAttribute('aria-checked') === 'true'
      && [...document.querySelectorAll('.mn-card')].filter(c => c.getAttribute('aria-checked') === 'true').length === 1));
  ok('…and the "you picked" readout names it',
    await evalp(() => /טיפה|Droplet/.test(document.querySelector('.mn-picked')?.textContent || '')),
    await evalp(() => document.querySelector('.mn-picked')?.textContent?.trim()));

  // Clicking the SAME card again is the interaction that used to launch a race.
  await page.click('.mn-card[data-racer="tipa"]');
  await wait(250);
  ok('clicking the ALREADY-selected card still does not race', (await scene()) === 'select', await scene());
}

/* ══════════════════════════════ 2b. one selection action = one sound ══ */
// Wave 6 regression: a card is focusable, so a mouse press FOCUSES it (onfocus →
// select) and then CLICKS it (onclick → select). While select() emitted
// menu:racer unconditionally that was two events a few ms apart, and audio.js
// maps menu:racer to ui.select — an audible double click on every pick. The rule
// pinned here is not "no more than one sound quickly", which a de-bounce would
// satisfy while the double emit lived on; it is that the emit tracks a real
// change of selection, so a redundant re-select is silent by construction.
console.log('\n  2b. exactly one selection sound per selection action');
{
  await bootSelect({ tap: true });
  ok('entering the select screen plays NO selection sound',
    (await tapped()).length === 0, JSON.stringify(await tapped()));

  await resetTap();
  await page.click('.mn-card[data-racer="tipa"]'); await wait(250);
  let t = await tapped();
  ok('clicking an unselected card emits exactly ONE menu:racer (not the focus+click pair)',
    t.length === 1 && t[0] === 'tipa', JSON.stringify(t));

  await resetTap();
  await page.click('.mn-card[data-racer="tipa"]'); await wait(250);
  t = await tapped();
  ok('re-clicking the ALREADY-selected card is silent (nothing changed)',
    t.length === 0, JSON.stringify(t));

  await resetTap();
  await page.keyboard.press('ArrowLeft'); await wait(250);
  t = await tapped();
  ok('one arrow press emits exactly one menu:racer', t.length === 1, JSON.stringify(t));

  await resetTap();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight'); await wait(300);
  t = await tapped();
  ok('two arrow presses emit exactly two', t.length === 2, JSON.stringify(t));

  // A pick made with the keyboard and then confirmed with the mouse must not
  // re-sound: the click lands on a card that is already both focused and picked.
  await resetTap();
  await page.click('.mn-card[data-racer="raash"]'); await wait(200);
  await page.click('.mn-card[data-racer="raash"]'); await wait(200);
  t = await tapped();
  ok('picking a card and clicking it again totals ONE sound', t.length === 1, JSON.stringify(t));
  ok('…and the pick itself still landed', (await picked()) === 'raash', await picked());
  ok('…and the scene never moved', (await scene()) === 'select', await scene());
}

/* ═══════════════════════════════════ 3. keyboard: arrows move, Enter waits ══ */
console.log('\n  3. keyboard: arrows move the selection, Enter on a card never races');
{
  // Hebrew: the grid runs right-to-left, so ArrowLeft walks FORWARD through the
  // roster. This is visual movement, not index movement — pinning it here because
  // "the arrow keys are mirrored" is a thing only an RTL build gets right.
  await bootSelect({ lang: 'he' });
  await page.keyboard.press('ArrowLeft'); await wait(150);
  ok('RTL: ArrowLeft moves one card to the visual left (roster +1)',
    (await picked()) === 'zuzi', await picked());
  await page.keyboard.press('ArrowRight'); await wait(150);
  ok('RTL: ArrowRight comes back', (await picked()) === 'nitzotz', await picked());
  await page.keyboard.press('ArrowDown'); await wait(150);
  ok('ArrowDown drops a row (4 columns at 1366px)', (await picked()) === 'zamzum', await picked());
  await page.keyboard.press('ArrowUp'); await wait(150);
  ok('ArrowUp climbs back', (await picked()) === 'nitzotz', await picked());
  ok('…and the scene never moved while navigating', (await scene()) === 'select', await scene());

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft'); await wait(150);
  const before = await picked();
  ok('two more steps land on the third racer', before === 'plada', before);
  await page.keyboard.press('Enter'); await wait(500);
  ok('Enter on a CARD does not start a race', (await scene()) === 'select', await scene());
  ok('…and does not change the pick', (await picked()) === before, await picked());
  ok('…it hands focus to the start button instead',
    await evalp(() => document.activeElement?.classList.contains('mn-start')),
    await evalp(() => document.activeElement?.className || document.activeElement?.tagName));
  // Space/Enter once focus HAS reached the button is the button's own
  // activation — that is section 4. Here we only care that a card never raced.
}

console.log('\n  3b. English (--lang en) mirrors the arrow keys back');
{
  await bootSelect({ lang: 'en' });
  ok('the screen is LTR', await evalp(() => document.documentElement.dir === 'ltr'),
    await evalp(() => document.documentElement.dir));
  ok('English strings are live',
    await evalp(() => /Choose Your Racer/i.test(document.querySelector('.mn-h1')?.textContent || '')),
    await evalp(() => document.querySelector('.mn-h1')?.textContent?.trim()));
  await page.keyboard.press('ArrowRight'); await wait(150);
  ok('LTR: ArrowRight moves forward through the roster', (await picked()) === 'zuzi', await picked());
  await page.keyboard.press('ArrowLeft'); await wait(150);
  ok('LTR: ArrowLeft moves back', (await picked()) === 'nitzotz', await picked());
  const m = await mounted();
  ok('…and the karts survived the language flip, still one each',
    m.length === 8 && m.every(s => s.name === 'kart:' + s.racerId) && m.every(s => s.visible));
}

/* ═════════════════════════════════════════ 4. the start button is the door ══ */
console.log('\n  4. only the start button starts a race — and it carries the pick');
{
  await bootSelect();
  await page.click('.mn-card[data-racer="kaftor"]');
  await wait(200);
  ok('picked a racer that is NOT the roster default', (await picked()) === 'kaftor', await picked());
  await page.click('.mn-start');
  await wait(1500);
  ok('clicking the start button reaches the race scene', (await scene()) === 'race', await scene());
  const who = await evalp(() => window.__DEBUG.engine.active.playerMesh?.racer?.id);
  ok('…driving the racer that was SELECTED, not the saved/default one', who === 'kaftor', who);
  ok('…and the pick was persisted', await evalp(() => JSON.parse(localStorage.getItem('promptracers.v1')).racerId === 'kaftor'));
}
{
  // Keyboard path into the race: focus must be able to REACH the button and
  // activate it, or a keyboard-only child is stuck on this screen forever.
  await bootSelect();
  await page.keyboard.press('ArrowLeft'); await wait(120);   // RTL: → zuzi
  await page.keyboard.press('Enter'); await wait(200);       // card Enter → focus the button
  ok('keyboard reached the start button without racing', (await scene()) === 'select'
    && await evalp(() => document.activeElement?.classList.contains('mn-start')));
  await page.keyboard.press('Enter'); await wait(1500);
  ok('Enter ON THE BUTTON starts the race', (await scene()) === 'race', await scene());
  ok('…with the keyboard-selected racer',
    (await evalp(() => window.__DEBUG.engine.active.playerMesh?.racer?.id)) === 'zuzi',
    await evalp(() => window.__DEBUG.engine.active.playerMesh?.racer?.id));
}
{
  await bootSelect();
  await page.keyboard.press('End'); await wait(150);          // last racer
  ok('End jumps to the last racer', (await picked()) === 'raash', await picked());
  await evalp(() => document.querySelector('.mn-start').focus());
  await page.keyboard.press('Space'); await wait(1500);
  ok('Space on the button starts the race too', (await scene()) === 'race', await scene());
  ok('…still with the right racer',
    (await evalp(() => window.__DEBUG.engine.active.playerMesh?.racer?.id)) === 'raash');
}
{
  // Escape must leave, not race.
  await bootSelect();
  await page.keyboard.press('Escape'); await wait(700);
  ok('Escape goes back to the title, not into a race', (await scene()) === 'menu', await scene());
}

/* ══════════════════════════════════════ 5. real pixels: the karts are there ══ */
// Everything above passes with eight perfectly-named karts scaled to nothing.
// This section renders a frame and reads the card windows back out of it.
console.log('\n  5. rendered frames: the karts are visibly on screen');
await bootSelect();

/** Read the per-card window rectangles, in CSS pixels. */
const viewRects = () => evalp(() => [...document.querySelectorAll('.mn-card')].map(c => {
  const r = c.querySelector('.mn-view').getBoundingClientRect();
  return { racer: c.dataset.racer, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}));

/**
 * Screenshot the whole viewport, then decode it INSIDE the page (no image
 * decoder out here) and reduce each card window to a few numbers.
 *  - `dark`   : fraction of pixels darker than the plate ever gets. Tyres,
 *               cockpit shadow and the driver read as dark; the plate does not.
 *  - `colors` : distinct 4-bit-per-channel colours — a flat gradient plate has
 *               very few, a shaded model has many.
 *  - `sig`    : a coarse 8x6 luma signature, used to compare cards to each other
 *               and one frame to the next.
 */
async function sampleCards(rects) {
  await evalp(() => window.__DEBUG.renderOnce());
  await wait(250);
  const png = await page.screenshot({ encoding: 'base64', type: 'png' });
  return evalp(async (b64, rs) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    return rs.map(r => {
      const d = cx.getImageData(r.x, r.y, r.w, r.h).data;
      const seen = new Set();
      let dark = 0, n = 0;
      const SW = 8, SH = 6, sum = new Float64Array(SW * SH), cnt = new Float64Array(SW * SH);
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const i = (y * r.w + x) * 4;
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const luma = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          if (luma < 46) dark++;
          n++;
          seen.add(((R >> 4) << 8) | ((G >> 4) << 4) | (B >> 4));
          const k = Math.min(SH - 1, (y * SH / r.h) | 0) * SW + Math.min(SW - 1, (x * SW / r.w) | 0);
          sum[k] += luma; cnt[k]++;
        }
      }
      return {
        racer: r.racer, dark: dark / n, colors: seen.size,
        sig: [...sum].map((s, i) => s / (cnt[i] || 1)),
      };
    });
  }, png, rects);
}
const sigDist = (a, b2) => Math.sqrt(a.reduce((s, v, i) => s + (v - b2[i]) ** 2, 0) / a.length);

{
  const rects = await viewRects();
  ok('every card window has a real rectangle', rects.every(r => r.w > 40 && r.h > 40),
    rects.map(r => `${r.w}x${r.h}`)[0] + ' …');

  const A = await sampleCards(rects);
  const flat = A.filter(s => s.colors < 60);
  ok('no card window is a flat colour plate', flat.length === 0,
    flat.map(s => `${s.racer}:${s.colors}`).join(', ') || `min ${Math.min(...A.map(s => s.colors))} colours`);
  const noKart = A.filter(s => s.dark < 0.02);
  ok('every card window contains a dark kart silhouette', noKart.length === 0,
    noKart.map(s => `${s.racer}:${(s.dark * 100).toFixed(1)}%`).join(', ')
    || `${(Math.min(...A.map(s => s.dark)) * 100).toFixed(1)}–${(Math.max(...A.map(s => s.dark)) * 100).toFixed(1)}% dark`);

  // Eight cards must LOOK like eight racers, not eight copies with a hue shift.
  let minPair = Infinity, worst = '';
  for (let i = 0; i < A.length; i++) {
    for (let j = i + 1; j < A.length; j++) {
      const d = sigDist(A[i].sig, A[j].sig);
      if (d < minPair) { minPair = d; worst = `${A[i].racer}/${A[j].racer}`; }
    }
  }
  ok('the eight windows are visually distinguishable from each other', minPair > 3,
    `closest pair ${worst} at ${minPair.toFixed(1)} luma RMS`);

  // The turntable: only a live 3D kart can change the picture between two
  // renders of a static DOM screen.
  await evalp(() => window.__DEBUG.advance(1.4));
  const B = await sampleCards(rects);
  const moved = A.map((s, i) => sigDist(s.sig, B[i].sig));
  ok('the SELECTED kart visibly rotates', moved[0] > 1.2, `Δ ${moved[0].toFixed(2)} luma RMS`);
  ok('the other seven turn too on the high tier', moved.slice(1).every(d => d > 0.6),
    moved.slice(1).map(d => d.toFixed(2)).join(' '));
}

/* ══════════════════════════════════════════════ 6. cost, and the low tier ══ */
// swiftshader is 20–60x slower than real hardware, so treat these as RELATIVE
// numbers: the eight-kart stage against a full race scene on the same machine.
console.log('\n  6. measured frame cost, and low-tier degradation');

const timeFrames = (n = 40) => evalp(k => {
  const D = window.__DEBUG;
  for (let i = 0; i < 5; i++) { D.engine.active.update(1 / 60); D.renderOnce(); }   // warm
  const t0 = performance.now();
  for (let i = 0; i < k; i++) { D.engine.active.update(1 / 60); D.renderOnce(); }
  return (performance.now() - t0) / k;
}, n);

async function costOf(sceneName, opts) {
  await evalp((s, o) => window.__DEBUG.goto(s, o), sceneName, opts);
  await wait(400);
  return timeFrames();
}

{
  await bootSelect({ quality: 'high' });
  const selHigh = await timeFrames();
  const raceCost = await costOf('race', { track: 0, difficulty: 1, autopilot: true });
  await bootSelect({ quality: 'low' });
  const selLow = await timeFrames();
  const m = await mounted();
  ok('the low tier still mounts all 8 karts', m.length === 8 && m.every(s => s.name === 'kart:' + s.racerId));

  console.log(`\n    select @high   ${selHigh.toFixed(1)} ms/frame   (8 live karts, 9 render passes)`);
  console.log(`    select @low    ${selLow.toFixed(1)} ms/frame`);
  console.log(`    race   @high   ${raceCost.toFixed(1)} ms/frame   (reference: a live race on the same machine)`);
  console.log('    budget         16.7 ms/frame = 60fps\n');
  // Deliberately NOT "cheaper than a race". Nine render() calls cost more CPU to
  // submit than a race's one, and this measures submission (swiftshader queues
  // the actual shading), so select legitimately reads HIGHER than a race here —
  // while shading only ~256k px against the race's full 1366x768. The number
  // that matters is the absolute one, and swiftshader is a far harsher machine
  // than any laptop a child will use, so the 60fps budget is the honest gate.
  ok('the 8-kart stage fits in a 60fps frame budget, on swiftshader',
    selHigh < 16.7, `${selHigh.toFixed(1)} ms vs 16.7 ms (race here: ${raceCost.toFixed(1)} ms)`);
  ok('…with room to spare (under half the budget)', selHigh < 8.3, `${selHigh.toFixed(1)} ms`);
  ok('the low tier is cheaper than the high tier', selLow < selHigh * 1.02,
    `${selLow.toFixed(1)} vs ${selHigh.toFixed(1)} ms`);

  // The documented degradation: on low, only the picked kart turns and runs its
  // driver rig. Measured off the scene graph, not off the comment.
  const spins = () => evalp(() => window.__DEBUG.engine.active.kartSpins());
  const s0 = await spins();
  await evalp(() => window.__DEBUG.advance(1.2));
  const s1 = await spins();
  const turned = s0.map((v, i) => Math.abs(s1[i] - v) > 1e-4);
  ok('low tier: the selected kart still turns', turned[0], `Δ${(s1[0] - s0[0]).toFixed(3)} rad`);
  ok('low tier: the other seven hold the hero pose', turned.slice(1).every(v => !v),
    `${turned.filter(Boolean).length}/8 animating`);
}

/* ═══════════════════════════════ 7. it fits, at six sizes, in two languages ══ */
// tools/layoutcheck.mjs only fails on clipped INTERACTIVE elements, and the key
// legend is a row of spans — so it reported "no clipping" while the legend hung
// 46px below the fold at 1024x640 (and 23px at 1280x720, 6px at 1366x768). This
// measures the stage's own overflow, which cannot miss it.
//
// It also audits every control a child has to be able to REACH on this screen —
// the start button first of all, because it is the only door off the screen.
// This section used to measure stage overflow and nothing else, so it passed
// green while "לזינוק!" hung below the fold at 1600x900 and 1920x1080. Two
// things were missing and both are here now:
//
//  • the controls themselves are measured (fully inside the viewport, at least a
//    24px tap target, and actually hit-testable at their own centre — a button
//    under an invisible overlay is as unreachable as one off-screen);
//  • each size is reached by three paths, not one. The bug never showed up on
//    a freshly built screen: the column count was JS state written from the
//    scene's resize() callback, so the roster stayed 3 columns wide — 3 rows
//    instead of 2, ~290px taller — whenever that callback did not run, and the
//    CTA went under the fold. The paths are:
//      build  — built at the target size (all this section used to do);
//      resize — built narrow, then resized into the target size;
//      deaf   — built narrow, then resized with the scene's resize() callback
//               unplugged. That is not a synthetic cruelty: headless Chrome
//               genuinely does not deliver a window resize event for the first
//               viewport override (engine.width sat at the boot 800 while the
//               page was 1920 wide), which is why layoutcheck saw a clipped
//               button at 1920x1080 and 1600x900 while a rebuild-only gate saw
//               nothing. The invariant it pins is the real fix: this screen's
//               layout must be correct without any JS resize signal at all.
console.log('\n  7. every control fits and is reachable — 6 resolutions × 2 languages × 3 paths');
{
  const SIZES = [[1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 720], [1024, 640]];
  // Same thresholds as the .mn-grid media queries in menus.js.
  const expectCols = w => (w >= 1000 ? 4 : w >= 740 ? 3 : w >= 520 ? 2 : 1);

  /** Every control on this screen, measured against the viewport it lives in. */
  const auditControls = (vw, vh) => evalp((w, h) => {
    const items = [['start', document.querySelector('.mn-start')], ['back', document.querySelector('.mn-back')]];
    for (const c of document.querySelectorAll('.mn-card')) items.push(['card:' + c.dataset.racer, c]);
    const bad = [];
    for (const [name, el] of items) {
      if (!el) { bad.push(`${name}:MISSING`); continue; }
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) { bad.push(`${name}:INVISIBLE`); continue; }
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) { bad.push(`${name}:${Math.round(r.width)}x${Math.round(r.height)}`); continue; }
      const out = [r.top < -1 && 'top', r.bottom > h + 1 && 'bottom',
        r.left < -1 && 'left', r.right > w + 1 && 'right'].filter(Boolean);
      if (out.length) { bad.push(`${name}:CLIPPED[${out.join('+')}] box=${Math.round(r.top)}..${Math.round(r.bottom)} of ${h}`); continue; }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) bad.push(`${name}:UNCLICKABLE(${hit ? hit.className || hit.tagName : 'nothing'})`);
    }
    return bad;
  }, vw, vh);

  const stageState = vh => evalp(h => {
    const st = document.querySelector('.mn-stage');
    const keys = document.querySelector('.mn-keys');
    const grid = document.querySelector('.mn-grid');
    const tpl = grid ? getComputedStyle(grid).gridTemplateColumns : '';
    return {
      over: st.scrollHeight - st.clientHeight,
      keysOff: !keys || keys.bottom > h + 1,
      cols: tpl && tpl !== 'none' ? tpl.trim().split(/\s+/).length : 0,
    };
  }, vh);

  const over = [], off = [], hidden = [], broken = [], badCols = [];

  for (const lang of ['he', 'en']) {
    for (const [w, h] of SIZES) {
      for (const path of ['build', 'resize', 'deaf']) {
        if (path === 'build') {
          await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
          await evalp(l => window.__DEBUG.goto('select', { lang: l }), lang);
        } else {
          // A deliberately different, narrower shape first — 3 columns' worth —
          // so a stale column count survives into the target size if one can.
          await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
          await evalp(l => window.__DEBUG.goto('select', { lang: l }), lang);
          await wait(250);
          // 'deaf': drop the scene's resize signal on the floor for the duration
          // of the viewport change, reproducing the missed resize event exactly.
          if (path === 'deaf') await evalp(() => {
            const sc = window.__DEBUG.engine.active;
            window.__savedResize = sc.resize;
            sc.resize = () => {};
          });
          await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
        }
        await wait(450);
        const tag = `${lang} ${w}x${h} (${path})`;
        const s = await stageState(h);
        if (s.over > 0) over.push(`${tag}:+${s.over}px`);
        if (s.keysOff) off.push(tag);
        if (s.cols !== expectCols(w)) badCols.push(`${tag}:${s.cols}≠${expectCols(w)}`);
        const bad = await auditControls(w, h);
        if (bad.length) broken.push(`${tag} → ${bad.join(', ')}`);
        if (path === 'deaf') {
          // Plug the signal back in and let the 3D karts re-park before the
          // kart check — parking them IS resize()'s remaining job.
          await evalp(() => {
            const sc = window.__DEBUG.engine.active;
            sc.resize = window.__savedResize;
            window.__DEBUG.engine.resize();
          });
          await wait(150);
        }
        const m = await mounted();
        if (!(m.length === 8 && m.every(x => x.visible && x.name === 'kart:' + x.racerId))) hidden.push(tag);
      }
    }
  }

  ok('the stage never overflows', over.length === 0, over.join(' ') || '0px at all 36 combinations');
  ok('the key legend is always fully on screen', off.length === 0, off.join(' ') || 'all visible');
  ok('EVERY control (start button, back, 8 cards) is on screen, ≥24px and clickable',
    broken.length === 0, broken.join(' | ') || '10 controls × 36 combinations');
  ok('the roster keeps the column count its width calls for (never a stale grid)',
    badCols.length === 0, badCols.join(' ') || 'matches at all 36 combinations');
  ok('all 8 karts stay mounted and laid out at every size', hidden.length === 0, hidden.join(' ') || '8/8 everywhere');
  await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
}

ok('no page errors anywhere in this run', errs.length === 0, errs[0] || '');
console.log('  ' + '─'.repeat(74));
console.log(fails ? `\n  ${fails} FAILED\n` : '\n  all racer-select checks passed\n');
await b.close();
process.exit(fails ? 1 : 0);

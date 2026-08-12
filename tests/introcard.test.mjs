// PRE-RACE INTRO CARD (Wave 4, item 13)
//
// The card is a seam between four things that are each owned by someone else:
// trackdef's display names, the modal registry's policy, the fixed-timestep
// accumulator, and every headless harness that drives a race. So this file has
// two halves:
//
//   PART A  pure node — the copy, and the trackdef seam via a STUB def. This is
//           the half that catches the name being copied into introcard.js: the
//           city was renamed עיר המעגלים → עיר הנוירונים in the same wave the
//           card was written, and a hard-coded name would have printed the old
//           one over the new city forever, silently.
//   PART B  puppeteer against the REAL BUILD — everything that is only true of
//           the built game: the freeze, the e.repeat guard, the pointer path,
//           the modal registry, and the backdrop/harness opt-outs that keep the
//           other gates from hanging behind a card they cannot see.
//
// The clock assertions are deliberately SNAPSHOT DELTAS on raceTime/lapTime and
// on the countdown clock — never a flag. GAPS.md records that the quiz's "time
// scale is exactly 0" assertion is decorative for exactly that reason: a mutant
// that reports a scale of 0 and still runs a fixed step per frame passes it.
// Here the card is held up for six seconds of stepping — nearly twice the 3.4s
// countdown — and the countdown must not have started.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { TRACKS } from '../src/track/trackdef.js';
import { introContent, introCardEnabled, trackName } from '../src/race/introcard.js';

// `--dist <path>` points part B at a different build. It exists for ONE reason:
// proving this gate bites. Verifying a mutant by rebuilding dist/ would leave a
// deliberately broken dist/index.html in a tree seven agents are sharing, for as
// long as the run takes. Instead the mutant is built, copied to .tmp/, the
// source restored FROM A .tmp COPY (never from git — D25) and dist/ rebuilt
// clean, all inside a few seconds; the slow part then runs against the copy.
const distArg = process.argv.indexOf('--dist');
const dist = distArg > 0 && process.argv[distArg + 1]
  ? resolve(process.argv[distArg + 1])
  : fileURLToPath(new URL('../dist/index.html', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(60)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};

console.log('\n  INTRO CARD — part A: copy + the trackdef seam\n  ' + '─'.repeat(74));

/* ── A1. the names are never copied into this file ────────────────────────── */
const src = readFileSync(fileURLToPath(new URL('../src/race/introcard.js', import.meta.url)), 'utf8');
// The header comment names the tracks on purpose (it explains the mapping), so
// scan the CODE only — everything after the import block.
const code = src.slice(src.indexOf('import * as THREE'));
for (const def of TRACKS) {
  ok(`introcard.js does not hard-code "${def.nameHe}"`, !code.includes(def.nameHe));
  ok(`introcard.js does not hard-code "${def.nameEn}"`, !code.includes(def.nameEn));
}

/* ── A2. content resolves FROM trackdef, per track ────────────────────────── */
for (const def of TRACKS) {
  const c = introContent(def, 'he');
  ok(`content(${def.id}) takes its name from trackdef`, c.name === def.nameHe, c.name);
  ok(`content(${def.id}) has a הידעת line of its own`,
    !!c.fact && c.fact.length > 40 && !c.fact.startsWith('intro.fact'), `${c.fact.length} chars`);
}
// Every track's fact must be DIFFERENT — a copy-paste that leaves two tracks
// sharing one line is the failure this catches.
const facts = TRACKS.map(d => introContent(d, 'he').fact);
ok('each track has a distinct fact', new Set(facts).size === TRACKS.length);
const factsEn = TRACKS.map(d => introContent(d, 'en').fact);
ok('each track has a distinct English fact', new Set(factsEn).size === TRACKS.length);
ok('English facts differ from Hebrew (both languages authored)',
  facts.every((f, i) => f !== factsEn[i]));

/* ── A3. THE SEAM: change the name in a stub and the card follows ─────────── */
const stub = { id: 'circuit', theme: 'circuit', nameHe: 'עיר הבדיקה', nameEn: 'Stub City', laps: 4 };
ok('a stubbed nameHe flows straight through', introContent(stub, 'he').name === 'עיר הבדיקה');
ok('a stubbed nameEn flows straight through', introContent(stub, 'en').name === 'Stub City');
ok('trackName() honours the language toggle',
  trackName(stub, 'he') === 'עיר הבדיקה' && trackName(stub, 'en') === 'Stub City');

/* ── A4. the opt-out matrix ───────────────────────────────────────────────── */
const live = { _headless: false }, harness = { _headless: true };
ok('real play shows the card', introCardEnabled({}, live) === true);
ok('backdrop never shows the card', introCardEnabled({ backdrop: true }, live) === false);
ok('autopilot never shows the card', introCardEnabled({ autopilot: true }, live) === false);
ok('a harness-driven race never shows the card', introCardEnabled({}, harness) === false);
ok('introCard:false forces it off', introCardEnabled({ introCard: false }, live) === false);
ok('introCard:true forces it on (this is how the gate drives it)',
  introCardEnabled({ introCard: true }, harness) === true);
ok('an explicit false beats a live engine', introCardEnabled({ introCard: false, autopilot: false }, live) === false);

/* ── A5. the registry ids, read out of the source ─────────────────────────── */
ok('the opt-out also covers a tool that drives the real UI by clicking',
  /navigator\.webdriver/.test(code));
ok("the card registers with the modal registry as 'intro'", /pushModal\(['"]intro['"]\)/.test(code));
ok('…and releases it on skip', /release\(\)/.test(code) && /const release = pushModal/.test(code));
ok('e.repeat is guarded in the key handler', /e\.repeat/.test(code));

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n  INTRO CARD — part B: the real build\n  ' + '─'.repeat(74));

const browser = await puppeteer.launch({
  headless: 'new', executablePath: CHROME,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('' + e.message));
await page.setViewport({ width: 1366, height: 768 });
await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

const evalp = (fn, ...a) => page.evaluate(fn, ...a);
const count = sel => page.evaluate(s => document.querySelectorAll(s).length, sel);
// Visibility the way modaltest measures it: class/geometry, not computed
// transitions — the harness steps the sim without ever presenting a frame.
const vis = sel => page.evaluate(s => [...document.querySelectorAll(s)].some(e =>
  e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.05), sel);
const boxOf = async (sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
}, sel);
const snap = () => evalp(() => {
  const s = window.__DEBUG.engine.active.state;
  return { phase: s.phase, clock: s.clock, raceTime: s.raceTime, lapTime: s.lapTime, lap: s.lap };
});
const advance = s => evalp(t => window.__DEBUG.advance(t), s);
const title = () => evalp(() => document.querySelector('.ic-title')?.textContent.trim() || '');
const openRace = (o) => evalp(x => window.__DEBUG.goto('race', x), o);

// Keys go through the BROWSER (page.keyboard), never dispatchEvent(window):
// modaltest.mjs records why at length — a synthetic event on window has no
// capture phase, so a capture-phase handler like this card's cannot be seen to
// work or to fail. It also means `repeat` is generated by Chrome itself: a
// second keyboard.down() on a key that is already held IS an auto-repeat, which
// is exactly the child-holding-drift case this card has to survive.

/* ── B1. every track, every language: the card, before the countdown ─────── */
// Each track's halo colour. A per-track accent that silently falls back to the
// same gold on all three is invisible in review and was the actual first bug
// here (an inline CSS custom property, which Object.assign cannot set).
const accents = [];
for (let i = 0; i < TRACKS.length; i++) {
  for (const lang of ['he', 'en']) {
    await openRace({ track: i, lang, introCard: true });
    const st = await snap();
    const want = lang === 'en' ? TRACKS[i].nameEn : TRACKS[i].nameHe;
    ok(`[${TRACKS[i].id}/${lang}] the card is up`, await vis('.ic-card'));
    ok(`[${TRACKS[i].id}/${lang}] exactly one card`, await count('.ic-card') === 1);
    // THE SEAM, live: the title on screen is trackdef's name, read from
    // trackdef by this test. Rename a track and this follows or fails.
    ok(`[${TRACKS[i].id}/${lang}] title === trackdef name`, await title() === want, await title());
    ok(`[${TRACKS[i].id}/${lang}] a הידעת line is on screen`,
      (await evalp(() => document.querySelector('.ic-fact')?.textContent.trim().length || 0)) > 40);
    ok(`[${TRACKS[i].id}/${lang}] phase is 'intro', before the countdown`, st.phase === 'intro', st.phase);
    if (lang === 'he') {
      accents.push(await evalp(() => getComputedStyle(document.querySelector('.ic-card'))
        .getPropertyValue('--ic-accent').trim()));
    }
  }
}
ok('each track has its own accent colour, resolved by CSS',
  new Set(accents).size === TRACKS.length && accents.every(a => /^#|rgb/.test(a)), accents.join(' '));

// The same track in both languages must print DIFFERENT copy — an English
// toggle that leaves the Hebrew fact on screen is the classic half-translation.
const factOf = () => evalp(() => document.querySelector('.ic-fact')?.textContent.trim() || '');
await openRace({ track: 1, lang: 'he', introCard: true }); const factHe = await factOf();
await openRace({ track: 1, lang: 'en', introCard: true }); const factEn = await factOf();
ok('the English card really is in English', factHe !== factEn && /[a-zA-Z]/.test(factEn) && !/[א-ת]/.test(factEn));

/* ── B2. THE FREEZE — deltas, not flags ──────────────────────────────────── */
await openRace({ track: 0, lang: 'he', introCard: true });
const before = await snap();
await advance(6);                       // 360 fixed steps; the countdown is 3.4s
const after = await snap();
ok('6s of stepping behind the card: phase still intro', after.phase === 'intro', after.phase);
ok('…the countdown clock did not advance', after.clock - before.clock === 0, `Δ${after.clock - before.clock}`);
ok('…raceTime did not advance', after.raceTime - before.raceTime === 0, `Δ${after.raceTime}`);
ok('…lapTime did not advance', after.lapTime - before.lapTime === 0, `Δ${after.lapTime}`);
ok('…and no lap was credited', after.lap === 1);

/* ── B3. e.repeat: a held Space must not skip a card nobody read ─────────── */
// The child is already holding Space (it is the drift key) as the card appears.
await page.keyboard.down('Space');
await openRace({ track: 0, lang: 'he', introCard: true });
ok('the card opens with Space already held', await vis('.ic-card'));
for (let i = 0; i < 4; i++) await page.keyboard.down('Space');   // auto-repeats
const heldSt = await snap();
ok('Space auto-repeat does NOT skip the card', await vis('.ic-card'));
ok('…and the world is still frozen at intro', heldSt.phase === 'intro', heldSt.phase);
await page.keyboard.up('Space');
ok('a real (non-repeat) Space DOES skip it', await (async () => {
  await page.keyboard.press('Space');
  return !(await vis('.ic-card'));
})());
const goneSt = await snap();
ok('…and the race moves on to the countdown', goneSt.phase === 'countdown', goneSt.phase);
await advance(6);
const running = await snap();
// The mirror image of B2: if the clocks did not move HERE, B2 would pass for the
// wrong reason (a race that never runs at all).
ok('once skipped, the clocks really do run', running.raceTime > 0 && running.phase === 'racing',
  `t=${running.raceTime.toFixed(2)} ${running.phase}`);
ok('the card does not come back mid-race', await count('.ic-card') === 0);

/* ── B4. the pointer path — a real hit-tested click, not el.click() ──────── */
await openRace({ track: 1, lang: 'he', introCard: true });
ok('[click] the card is up', await vis('.ic-card'));
const scrimBox = await boxOf('.ic-scrim');
// Deliberately away from the button: this tests that the scrim itself takes the
// tap (style.js kills pointer-events inside #ui unless a node opts in with .on).
await page.mouse.click(40, 40);
ok('[click] a tap anywhere on the card skips it', !(await vis('.ic-card')), JSON.stringify(scrimBox));
ok('[click] …and the countdown starts', (await snap()).phase === 'countdown');

await openRace({ track: 2, lang: 'en', introCard: true });
const btnBox = await boxOf('.ic-card .btn');
await page.mouse.click(btnBox.x, btnBox.y);
ok('[click] the button skips it too (same code path)', !(await vis('.ic-card')));

/* ── B5. the modal registry, both directions ─────────────────────────────── */
// quiz.js's openQuestion() returns early on modalOpen('quiz') — i.e. on anything
// else holding the screen. So it is a real, in-game probe of the registry:
// nothing may open over the card, and nothing may be blocked after it closes.
await openRace({ track: 0, lang: 'he', introCard: true });
await evalp(() => window.__DEBUG.engine.active.quiz.openQuestion());
await new Promise(r => setTimeout(r, 400));
// Assert on the quiz system's OWN state as well as on the DOM. A visibility-only
// check here passed against a build with no `pushModal('intro')` at all — the
// panel had opened and its fade-in simply had not reached opacity yet. That is
// the decorative-assertion trap GAPS.md names, caught by mutation and not by
// review.
const quizPhase = await evalp(() => window.__DEBUG.engine.active.quiz.phase);
ok('nothing stacks on the card (the quiz defers behind it)',
  quizPhase === 'idle' && !(await vis('.quiz-root.show')) && !(await vis('.qzint-scrim')), quizPhase);
ok('…the card is still the thing on screen', await vis('.ic-card'));
await page.keyboard.press('Space');
ok('the card is gone', !(await vis('.ic-card')));
await evalp(() => window.__DEBUG.engine.active.quiz.openQuestion());
await new Promise(r => setTimeout(r, 400));   // let the panel's fade-in leave opacity 0
// Either the question panel or the one-time "what a question box is" explainer
// that precedes the very first one — on a fresh profile it is the latter. Both
// mean the same thing here: the screen was handed back.
ok("the 'intro' id was released (a quiz can open after it)",
  (await vis('.quiz-root.show')) || (await vis('.qzint-scrim')));

/* ── B6. Escape belongs to the card, not to the pause menu ───────────────── */
await openRace({ track: 0, lang: 'he', introCard: true });
await page.keyboard.press('Escape');
ok('Escape dismisses the card', !(await vis('.ic-card')));
ok('…and does not fall through and open the pause menu', !(await vis('.pause-root, .pz-root, .pause-overlay')));

/* ── B7. the opt-outs that keep the OTHER gates alive ────────────────────── */
// Every tool drives the game through __DEBUG.goto, which sets engine._headless.
// If this ever regresses, shot.mjs photographs a card instead of a race and
// flowtest/modaltest hang waiting for a race that never starts.
await openRace({ track: 0 });
ok('a harness-driven race (the default for every tool) shows NO card', await count('.ic-card') === 0);
ok('…and starts in the countdown, exactly as before', (await snap()).phase === 'countdown');
await advance(6);
ok('…and races', (await snap()).raceTime > 0);

await openRace({ track: 0, autopilot: true, introCard: undefined });
ok('an autopilot race shows no card', await count('.ic-card') === 0);

// The click-driven half of flowtest never calls __DEBUG.goto, so `_headless` is
// false there and `navigator.webdriver` is the only thing keeping the card out
// of its way. If a future puppeteer stops setting it, THIS is the line that says
// so — otherwise flowtest would simply hang on a card it cannot see.
ok('the automated-browser signal the opt-out rests on is present',
  await evalp(() => navigator.webdriver === true));

// The title screen's backdrop is a real raceScene with backdrop:true.
await evalp(() => window.__DEBUG.goto('menu', {}));
await advance(3);
ok('the menu backdrop never shows a card', await count('.ic-card') === 0);

ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();

console.log(`\n  ${fails ? '\x1b[31m' + fails + ' FAILED\x1b[0m' : '\x1b[32mall intro-card checks passed\x1b[0m'}\n`);
process.exit(fails ? 1 : 0);

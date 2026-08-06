// End-to-end playability test. Drives the REAL built game with synthetic input
// through the whole Wave-1 slice: title → racer select → race (3 laps) →
// results → garage → next race. Screenshots each beat.
//
// Renders prove a screen draws. This proves the game can actually be PLAYED.
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dist = resolve(root, 'dist/index.html');
if (!existsSync(dist)) { console.error('dist missing — npm run build'); process.exit(2); }
mkdirSync(resolve(root, 'shots'), { recursive: true });

const steps = [];
const step = (name, ok, detail = '') => {
  steps.push({ name, ok, detail });
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(46)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});

const errs = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });   // school-laptop resolution
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

  const scene = () => page.evaluate(() => window.__DEBUG.state().scene);
  const shot = f => page.screenshot({ path: resolve(root, 'shots/' + f), type: 'png' });
  const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));

  console.log('\n  PLAYABILITY — full Wave-1 slice at 1366x768\n  ' + '─'.repeat(70));
  step('boots to title', (await scene()) === 'menu', await scene());
  await shot('flow-1-title.png');

  // ---- title → racer select -------------------------------------------
  // Click the primary CTA rather than pressing Enter, so we exercise the real
  // button (and prove it is not clipped or pointer-events-blocked).
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /אליפות|Championship/.test(x.textContent));
    if (!b) return 'no-button';
    const r = b.getBoundingClientRect();
    if (r.bottom > innerHeight || r.top < 0) return 'clipped';
    b.click(); return 'ok';
  });
  await settle(900);
  step('start button is clickable', clicked === 'ok', clicked);
  step('reaches racer select', (await scene()) === 'select', await scene());
  await shot('flow-2-select.png');

  // ---- racer select → race --------------------------------------------
  await page.keyboard.press('ArrowLeft');            // move selection (RTL-aware)
  await settle(250);
  const started = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /לזינוק|Start|התחל/.test(x.textContent));
    if (!b) return 'no-button';
    b.click(); return 'ok';
  });
  await settle(1800);
  step('start-race button works', started === 'ok', started);
  step('reaches race scene', (await scene()) === 'race', await scene());

  // ---- drive ------------------------------------------------------------
  // Hold throttle + drift via real key events so Input is genuinely exercised,
  // then fast-forward the sim deterministically.
  await page.evaluate(() => {
    const k = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    k('keydown', 'ArrowUp');
  });
  await page.evaluate(() => window.__DEBUG.advance(6));
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await settle(200);
  await shot('flow-3-race-early.png');

  const early = await page.evaluate(() => {
    const s = window.__DEBUG.engine.active;
    return { speed: s.player?.speed ?? 0, phase: s.state?.phase, lap: s.state?.lap };
  });
  step('countdown completed, kart is moving', early.speed > 3, `${early.speed.toFixed(1)} m/s, phase=${early.phase}`);

  // Simulate a full 3-lap race.
  await page.evaluate(() => window.__DEBUG.advance(200));
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await settle(300);
  await shot('flow-4-race-mid.png');

  const mid = await page.evaluate(() => {
    const s = window.__DEBUG.engine.active;
    return {
      lap: s.state?.lap, laps: 3, finished: s.state?.finished,
      pos: s.state?.position, tokens: s.state?.tokens,
      best: s.state?.bestLap, progress: s.state?.progress,
      speed: s.player?.speed, off: s.player?.offTrack,
    };
  });
  step('laps are counting', mid.lap > 1 || mid.finished, `lap ${mid.lap}, progress ${mid.progress?.toFixed(2)}`);
  step('tokens collectable', mid.tokens > 0, `${mid.tokens} tokens`);
  step('position is tracked', mid.pos >= 1 && mid.pos <= 8, `P${mid.pos}`);
  step('best lap recorded', mid.best != null, mid.best ? (mid.best / 1000).toFixed(2) + 's' : 'none');

  // Run long enough to finish 3 laps.
  await page.evaluate(() => window.__DEBUG.advance(260));
  await settle(3000);   // the 2.2s results delay plus transition
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await settle(400);

  const sc = await scene();
  step('race completes → results', sc === 'results', sc);
  await shot('flow-5-results.png');

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('promptracers.v1') || '{}'));
  step('progress persisted to localStorage', (saved.results?.length || 0) > 0,
    `race ${saved.championshipRace}, ${saved.tokens} tokens`);

  // ---- results → garage -------------------------------------------------
  const toGarage = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /מוסך|Garage|הבא|Next|המשך/.test(x.textContent));
    if (!b) return 'no-button';
    const r = b.getBoundingClientRect();
    if (r.bottom > innerHeight) return 'clipped:' + Math.round(r.bottom - innerHeight) + 'px';
    b.click(); return 'ok';
  });
  await settle(1600);
  step('results CTA reachable at 1366x768', toGarage === 'ok', toGarage);
  const gs = await scene();
  step('reaches garage', gs === 'garage', gs);
  await shot('flow-6-garage.png');

  // ---- garage interaction ----------------------------------------------
  const built = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const picked = [];
    // Pick the first available option in each row as it progressively reveals.
    for (let round = 0; round < 6; round++) {
      const cards = [...document.querySelectorAll('.grg-opt, [data-opt], .grg-card')]
        .filter(el => el.offsetParent !== null && !el.getAttribute('aria-disabled'));
      if (!cards.length) break;
      cards[0].click();
      picked.push(cards.length);
      await sleep(320);
    }
    const btn = [...document.querySelectorAll('button')]
      .find(b => b.offsetParent && /בנה|תבנה|Build/.test(b.textContent) && !b.disabled);
    if (btn) { btn.click(); await sleep(2200); }
    // The reveal modal then offers "install" — that is the button that actually
    // commits the part, so the flow is not complete until it is clicked.
    const inst = [...document.querySelectorAll('button')]
      .find(b => b.offsetParent && /התקנ|הרכב|[Ii]nstall|קדימה|יאללה/.test(b.textContent) && !b.disabled);
    if (inst) { inst.click(); await sleep(900); }
    return {
      picked, built: !!btn, installed: !!inst,
      sentence: document.querySelector('.grg-sentence, .grg-ask')?.textContent?.trim().slice(0, 70),
    };
  });
  await page.evaluate(() => window.__DEBUG.renderOnce());
  await settle(500);
  step('garage slots are selectable', built.picked.length >= 3, `${built.picked.length} rows engaged`);
  step('part can be built', built.built, built.sentence ? `"${built.sentence}…"` : '');
  step('part can be installed', built.installed, built.installed ? 'install clicked' : 'no install button found');
  await shot('flow-7-garage-built.png');

  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('promptracers.v1') || '{}'));
  step('parts persisted', Object.keys(after.parts || {}).length > 0, JSON.stringify(after.parts || {}).slice(0, 60));

  step('no page errors during whole flow', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('  ' + '─'.repeat(70));
  const fails = steps.filter(s => !s.ok);
  console.log(`  ${steps.length - fails.length}/${steps.length} passed\n`);
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error('\nFLOW TEST CRASHED:', e.message);
  if (errs.length) console.error(errs.slice(0, 6).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}

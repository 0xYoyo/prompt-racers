// Navigation audit probe — read-only, prints a table.
import puppeteer from 'puppeteer-core';
const root = '/Users/yoyopc/repos/kart-project';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dist = root + '/dist/index.html';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));
const scene = () => page.evaluate(() => window.__DEBUG.state().scene);

const SAVE_KEY = 'promptracers.v1';
const seed = async patch => {
  await page.evaluate((key, data) => localStorage.setItem(key, JSON.stringify(data)), SAVE_KEY, {
    lang: 'he', quality: 'low', muted: true, racerId: 'nitzotz',
    garageMetBoreg: true, garageTokenIntroSeen: true, ...patch,
  });
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
};
const ledger = n => Array.from({ length: n }, (_, i) => ({
  trackIndex: i, track: 'oasis', place: 2, timeMs: 90000, bestLapMs: 30000,
  standings: ['zuzi', 'nitzotz', 'plada', 'nurit', 'zamzum', 'tipa', 'kaftor', 'raash']
    .map((id, j) => ({ racerId: id, place: j + 1, isPlayer: id === 'nitzotz', timeMs: 90000 + j * 800 })),
}));

// Every visible button + whether its own centre hit-tests to itself.
const survey = () => page.evaluate(() => {
  const vis = el => el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'
    && +getComputedStyle(el).opacity > 0.05;
  const ovs = [...document.querySelectorAll('.mn-ov')];
  const top = ovs[ovs.length - 1] || null;
  const scopeRoot = top || document;
  const btns = [...scopeRoot.querySelectorAll('button')].filter(vis).map(b => {
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const inView = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0
      && r.bottom <= innerHeight && r.right <= innerWidth;
    const hit = document.elementFromPoint(cx, cy);
    return {
      txt: (b.textContent || '').replace(/[⁦-⁩]/g, '').trim().slice(0, 30),
      cls: b.className, inView, hits: !!(hit && (hit === b || b.contains(hit))),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    };
  });
  return { scene: window.__DEBUG.state().scene, overlay: !!top, ovClass: top?.querySelector('.mn-dialog')?.className || null, btns };
});

const esc = async () => {
  await page.keyboard.press('Escape');
  await settle(800);
  return page.evaluate(() => ({ scene: window.__DEBUG.state().scene, overlays: document.querySelectorAll('.mn-ov').length,
    focus: (document.activeElement?.textContent || '').replace(/[⁦-⁩]/g, '').trim().slice(0, 24) }));
};

const report = [];
const record = async (label, extra = {}) => {
  const s = await survey();
  report.push({ label, ...s, ...extra });
  console.log('\n=== ' + label + ' === scene=' + s.scene + (s.overlay ? ' OVERLAY ' + s.ovClass : ''));
  for (const b of s.btns) console.log(`   ${b.hits ? '✓' : '✗hit'}${b.inView ? '' : ' ✗view'}  "${b.txt}"  [${b.cls}] ${b.rect}`);
};

// ---------- 1. main menu ----------
await seed({ championshipRace: 0, results: [] });
await record('main menu (fresh)');
console.log('   ESC →', JSON.stringify(await esc()));

// ---------- 2. racer select ----------
await page.evaluate(() => window.__DEBUG.goto('select', {}));
await settle(900);
await record('racer select');
console.log('   ESC →', JSON.stringify(await esc()));

// ---------- 3. how-to-play overlay ----------
await page.evaluate(() => window.__DEBUG.goto('menu', {}));
await settle(700);
await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => /איך משחקים|How/.test(b.textContent))?.click(); });
await settle(400);
await record('how-to-play overlay');
console.log('   ESC →', JSON.stringify(await esc()));

// ---------- 4. about / how built ----------
await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => /נבנה|Built/.test(b.textContent))?.click(); });
await settle(400);
await record('about (how it was built)');
console.log('   ESC →', JSON.stringify(await esc()));

// ---------- 5. settings ----------
await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => /הגדרות|Settings/.test(b.textContent))?.click(); });
await settle(400);
await record('settings overlay');
console.log('   ESC →', JSON.stringify(await esc()));

// ---------- 6. free play (sandbox garage) ----------
await seed({ championshipRace: 0, results: [] });
await page.evaluate(() => window.__DEBUG.goto('freeplay', { freePlay: true }));
await settle(1200);
await record('free play (sandbox garage)');
console.log('   ESC →', JSON.stringify(await esc()));

// ---------- 7. garage (championship) ----------
await seed({ championshipRace: 1, tokens: 14, parts: { engine: 1 }, results: ledger(1) });
await page.evaluate(() => window.__DEBUG.goto('garage', {}));
await settle(1200);
await record('garage (championship)');
console.log('   ESC →', JSON.stringify(await esc()));

// ---------- 8. race ----------
await seed({ championshipRace: 0, results: [] });
await page.evaluate(() => window.__DEBUG.goto('race', { track: 0 }));
await settle(1200);
await page.evaluate(() => window.__DEBUG.advance(8));
await record('race');
console.log('   ESC →', JSON.stringify(await esc()));
// ---------- 9. pause ----------
await record('pause (after Esc in race)');
console.log('   ESC again →', JSON.stringify(await esc()));

// ---------- 10. results ----------
await page.evaluate(() => window.__DEBUG.goto('results', {
  trackIndex: 0, place: 2, timeMs: 92000, bestLapMs: 30000, tokens: 12,
  standings: ['zuzi','nitzotz','plada','nurit','zamzum','tipa','kaftor','raash']
    .map((id,j)=>({racerId:id, place:j+1, isPlayer:id==='nitzotz', timeMs:90000+j*800})),
}));
await settle(900);
await record('results');
console.log('   ESC →', JSON.stringify(await esc()));

// ---------- 11. podium ----------
await seed({ championshipRace: 3, tokens: 9, results: ledger(3), bestPrompt: { text: 'מנוע קליל', score: 80 } });
await page.evaluate(() => window.__DEBUG.goto('podium', {}));
await settle(1000);
await record('podium');

// ---------- 12. certificate ----------
await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => /תעודת|Certificate/.test(b.textContent))?.click(); });
await settle(500);
await record('certificate overlay');
console.log('   ESC →', JSON.stringify(await esc()));
console.log('   (podium) ESC →', JSON.stringify(await esc()));

console.log('\nERRORS:', errs.length ? errs.slice(0, 6) : 'none');
await browser.close();

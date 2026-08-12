// ═══════════════════════════════════════════════════════════════════════════
// CERTIFICATE GATE — תעודת פרומפטר (Wave 4, item 15).
//
//   node tests/certificate.test.mjs
//
// The loudest thing in this file is section 1, and it is the only one that is
// contest-DISQUALIFYING if it ever goes red:
//
//     THE CERTIFICATE MUST NEVER COLLECT PERSONAL DATA.
//
// No <input>, no <textarea>, no contenteditable, no field of any kind — not
// after a rebuild, not after picking a title, not in either language. The
// identity on the certificate is the ROSTER RACER the child chose and a title
// picked from a fixed preset list stored as an ID. A single text box here would
// end the entry, so it is asserted on the REAL RENDERED DOM of a real esbuild
// bundle, in both languages, after every interaction the screen offers.
//
// The rest pins the things that can rot silently:
//   2. the title comes from the preset list, and an arbitrary injected string is
//      laundered to "no title" on both read and write — nothing typed, injected
//      or left in an old save can ever print on this certificate;
//   3. the badge strip reflects real core/badges.js state — unlock two, see two;
//      unlock none and the certificate still renders a finished-looking screen;
//   4. the PNG export produces a REAL IMAGE. Asserted on canvas pixel data:
//      correct dimensions, ink actually laid down across every band of the page,
//      and two different racers producing two different images. GAPS.md records
//      that this project has shipped gates which were regexes on DOM captions
//      while the thing they claimed to test had been deleted — so nothing here
//      asserts that a function was called;
//   5. the file really downloads FROM A file:// PAGE (the deliverable is one
//      dist/index.html a child double-clicks), verified by catching the actual
//      written file through CDP and checking its PNG magic bytes;
//   6. the export issues ZERO network requests — same interception technique as
//      tools/verify.mjs (anything not file:/data:/blob: is a violation);
//   7. the action buttons are 46–52px like every other screen (GAPS.md).
// ═══════════════════════════════════════════════════════════════════════════
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, statSync } from 'fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let fails = 0;
const ok = (n, v, d = '') => {
  if (!v) fails++;
  console.log(`  ${v ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${String(n).padEnd(60)} \x1b[2m${d}\x1b[0m`);
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ── a real bundle of the real module, on a real file:// page ─────────────── */
const tmp = resolve(root, '.tmp');
const dlDir = resolve(tmp, 'certdl');
mkdirSync(tmp, { recursive: true });
rmSync(dlDir, { recursive: true, force: true });
mkdirSync(dlDir, { recursive: true });

const entry = resolve(tmp, 'certgate-entry.js');
writeFileSync(entry, `
import { bootPreview } from ${JSON.stringify(resolve(root, 'src/core/harness.js'))};
import { backdropScene } from ${JSON.stringify(resolve(root, 'src/ui/menus.js'))};
import * as L from ${JSON.stringify(resolve(root, 'src/ui/learn.js'))};
import { save } from ${JSON.stringify(resolve(root, 'src/core/save.js'))};
import { ROSTER } from ${JSON.stringify(resolve(root, 'src/kart/roster.js'))};

window.L = L; window.save = save; window.ROSTER = ROSTER;
window.__OPTS = {};
window.__OV = null;

// D19 canonical standings: {place, racerId, racer, name, points, wins, bestFinal, isPlayer}
window.STANDINGS = [
  { place: 2, racerId: 'plada', name: 'פלדה', points: 19, wins: 1, bestFinal: 2, isPlayer: true },
  { place: 1, racerId: 'zuzi', name: 'זוזי', points: 24, wins: 2, bestFinal: 1, isPlayer: false },
];

window.openCert = (o = {}) => {
  try { window.__OV?.close?.(); } catch (e) {}
  document.querySelectorAll('.mn-ov').forEach(n => n.remove());
  window.__OV = L.certificateOverlay({ onMenu: () => {}, ...window.__OPTS, ...o });
  return true;
};

bootPreview((engine, o = {}) => {
  const s = backdropScene(engine, { instant: true, ...o });
  window.openCert({});
  const dispose = s.dispose;
  s.dispose = () => { try { window.__OV?.close?.(); } catch (e) {} dispose(); };
  return s;
});
`);

const built = await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'iife', minify: false, write: false,
  alias: { three: resolve(root, 'vendor/three.module.js') }, target: ['chrome100'], logLevel: 'warning',
});
const htmlPath = resolve(tmp, 'certgate.html');
writeFileSync(htmlPath, `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0d1a}#app{position:fixed;inset:0}</style>
</head><body><div id="app"><div id="boot"></div></div><script>${built.outputFiles[0].text}</script></body></html>`);
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
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });

// tools/verify.mjs's technique: intercept every request and treat anything that
// is not a local scheme as a network call.
const netCalls = [];
await page.setRequestInterception(true);
page.on('request', r => {
  const u = r.url();
  if (!/^(file|data|blob):/.test(u)) netCalls.push(u);
  r.continue();
});

const FIXTURE = {
  bestPrompt: { text: 'בורג, בנה לי מנוע שיוציא אותי מהר מהסיבוב האחרון, בלי להוסיף משקל.', score: 86 },
  championship: 2, races: 3,
};

async function boot(lang = 'he') {
  await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  await page.evaluate(l => window.__DEBUG.goto('preview', { lang: l }), lang);
  await wait(120);
}

/** Reset the save the way a fresh child's browser has it, then reopen. */
const reopen = (patch = {}, o = {}) => page.evaluate((p, opts, fx) => {
  window.save.reset();
  window.save.set(p);
  return window.openCert({ ...fx, ...opts });
}, patch, o, FIXTURE);

await boot('he');

/* ══════════════════════════════════════════════════════════════════════════ */
/*  1. NO PERSONAL DATA — the contest-disqualifying assertion                  */
/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n  \x1b[1m1. NO FREE-TEXT INPUT ANYWHERE (contest-disqualifying)\x1b[0m\n  ' + '─'.repeat(74));

const FIELD_SEL = 'input,textarea,select,[contenteditable],[contenteditable="true"]';

const scanFields = () => page.evaluate(sel => {
  const ov = document.querySelector('.mn-ov.cert-ov');
  if (!ov) return { missing: true };
  const inOverlay = [...ov.querySelectorAll(sel)];
  const inDoc = [...document.querySelectorAll(sel)];
  const html = ov.innerHTML;
  return {
    missing: false,
    overlay: inOverlay.map(e => e.tagName.toLowerCase() + (e.type ? ':' + e.type : '')),
    doc: inDoc.map(e => e.tagName.toLowerCase()),
    markup: /<input|<textarea|contenteditable|<select/i.test(html),
    editableHosts: [...ov.querySelectorAll('*')].filter(e => e.isContentEditable).length,
    buttons: ov.querySelectorAll('button').length,
  };
}, FIELD_SEL);

{
  const s = await scanFields();
  ok('certificate overlay rendered', !s.missing);
  ok('NO input/textarea/select/contenteditable in the overlay',
    s.overlay.length === 0, s.overlay.join(', ') || `${s.buttons} buttons, 0 fields`);
  ok('NO element in the overlay is contentEditable', s.editableHosts === 0, String(s.editableHosts));
  ok('overlay markup contains no field tag at all', s.markup === false);
  ok('NO field anywhere in the document while it is open', s.doc.length === 0, s.doc.join(', '));
}

// after picking every single title, in turn
{
  const ids = await page.evaluate(() => window.L.CERT_TITLE_IDS);
  let dirty = [];
  for (const id of [...ids, '']) {
    await page.evaluate(i => {
      document.querySelector(`.lr-tchip[data-title-id="${i}"]`)?.click();
    }, id);
    await wait(40);
    const s = await scanFields();
    if (s.missing || s.overlay.length || s.editableHosts || s.markup) dirty.push(id || '(none)');
  }
  ok('still no field after picking each of the 7 title chips', dirty.length === 0, dirty.join(', '));
}

// in English, and with an empty save (the first-ever certificate)
await boot('en');
await reopen({}, {});
await wait(80);
{
  const s = await scanFields();
  ok('no field in English either', !s.missing && s.overlay.length === 0 && !s.markup, s.overlay.join(', '));
}
await boot('he');

/* ══════════════════════════════════════════════════════════════════════════ */
/*  2. the fun title is a PRESET, and only a preset                            */
/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n  \x1b[1m2. FUN TITLE — presets only\x1b[0m\n  ' + '─'.repeat(74));

{
  const info = await page.evaluate(() => {
    const L = window.L;
    return {
      ids: L.CERT_TITLE_IDS,
      he: L.CERT_TITLE_IDS.map(i => window.__DEBUG && document.documentElement.lang),
    };
  });
  ok('six preset titles are offered', info.ids.length === 6, info.ids.join(', '));
}

await reopen({});
{
  // Chips: one per preset + the "no title" opt-out, and every one is a <button>.
  const chips = await page.evaluate(() => [...document.querySelectorAll('.lr-tchip')]
    .map(c => ({ id: c.dataset.titleId, tag: c.tagName.toLowerCase(), label: c.textContent.trim() })));
  ok('7 title chips, all buttons', chips.length === 7 && chips.every(c => c.tag === 'button'),
    chips.map(c => c.label).join(' | '));

  // Picking one persists the ID and prints the localised string.
  await page.evaluate(() => document.querySelector('.lr-tchip[data-title-id="curious"]').click());
  await wait(60);
  const after = await page.evaluate(() => ({
    saved: window.save.read('funTitle'),
    pill: document.querySelector('.lr-fun')?.textContent.trim() || '',
    pressed: document.querySelector('.lr-tchip[aria-pressed="true"]')?.dataset.titleId,
  }));
  ok('picking a chip persists the ID (not the text)', after.saved === 'curious', JSON.stringify(after.saved));
  ok('the chosen title prints on the certificate', after.pill === 'ראש סקרן', after.pill);
  ok('the chosen chip is the pressed one', after.pressed === 'curious', String(after.pressed));

  // Opting back out.
  await page.evaluate(() => document.querySelector('.lr-tchip[data-title-id=""]').click());
  await wait(60);
  const none = await page.evaluate(() => ({
    saved: window.save.read('funTitle'), pill: !!document.querySelector('.lr-fun'),
  }));
  ok('"no title" clears it back to null', none.saved === null && none.pill === false, String(none.saved));
}

{
  // AN ARBITRARY STRING IS REJECTED — on the way in and on the way out.
  const inj = 'דני כהן, כיתה ד׳';
  const r = await page.evaluate(async (bad, fx) => {
    const L = window.L;
    const wrote = L.writeFunTitle(bad);
    const afterWrite = window.save.read('funTitle');
    // and an old/corrupted save that already contains one:
    window.save.set({ funTitle: bad });
    const laundered = L.readFunTitle();
    const data = L.certificateData({ ...fx });
    window.openCert({ ...fx });
    await new Promise(res => setTimeout(res, 60));
    const ov = document.querySelector('.mn-ov.cert-ov');
    return {
      wrote, afterWrite, laundered, dataTitle: data.funTitle,
      onScreen: ov.textContent.includes(bad),
      pill: !!ov.querySelector('.lr-fun'),
      optTitle: L.certificateData({ ...fx, funTitle: bad }).funTitle,
    };
  }, inj, FIXTURE);
  ok('writeFunTitle(arbitrary string) returns null', r.wrote === null, JSON.stringify(r.wrote));
  ok('…and never reaches the save', r.afterWrite === null, JSON.stringify(r.afterWrite));
  ok('a poisoned save is laundered to null on read', r.laundered === null, JSON.stringify(r.laundered));
  ok('certificateData() drops it', r.dataTitle === null && r.optTitle === null,
    `${r.dataTitle} / ${r.optTitle}`);
  ok('the injected string never appears on the certificate', r.onScreen === false && r.pill === false);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  3. the badge strip is real badge state                                     */
/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n  \x1b[1m3. BADGE STRIP — real core/badges.js state\x1b[0m\n  ' + '─'.repeat(74));

const readStrip = () => page.evaluate(() => {
  const ov = document.querySelector('.mn-ov.cert-ov');
  const chips = [...ov.querySelectorAll('.lr-bg')];
  return {
    n: chips.length,
    names: chips.map(c => c.querySelector('span')?.textContent.trim() || ''),
    icons: chips.filter(c => c.querySelector('svg') && c.querySelector('svg').innerHTML.length > 40).length,
    none: ov.querySelector('.lr-badges') ? '' : (ov.querySelector('.lr-none')?.textContent.trim() || ''),
    bodyH: ov.querySelector('.lr-cert-body').getBoundingClientRect().height,
    sections: [...ov.querySelectorAll('.lr-sect b')].map(b => b.textContent.trim()),
  };
});

await reopen({ badges: ['quiz-5', 'drift-first'] });
await wait(80);
{
  const s = await readStrip();
  ok('two unlocked badges → two chips', s.n === 2, s.names.join(' | '));
  ok('each chip carries its real icon SVG', s.icons === 2, String(s.icons));
  ok('chips carry the badges.js names, not ids',
    s.names.includes('מתחממים') && s.names.includes('החלקה ראשונה'), s.names.join(' | '));
}

await reopen({ badges: ['quiz-5', 'drift-first', 'tokens-50', 'not-a-real-badge'] });
await wait(80);
{
  const s = await readStrip();
  ok('three unlocked → three chips, junk id ignored', s.n === 3, s.names.join(' | '));
}

await reopen({ badges: [] });
await wait(80);
{
  const s = await readStrip();
  ok('no badges → no chips', s.n === 0);
  ok('…but the strip still says something', s.none.length > 20, s.none.slice(0, 40));
  ok('…and the certificate still looks finished', s.bodyH > 300 && s.sections.length >= 3,
    `body ${Math.round(s.bodyH)}px, ${s.sections.length} sections`);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  4. the PNG is a real image — asserted on pixels                            */
/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n  \x1b[1m4. PNG EXPORT — real canvas pixels\x1b[0m\n  ' + '─'.repeat(74));

const netBefore = netCalls.length;

const analyse = await page.evaluate(async (fx) => {
  const L = window.L;
  window.save.set({ badges: ['quiz-5', 'drift-first', 'tokens-50'], funTitle: 'champ' });
  const d = L.certificateData({ ...fx, standings: window.STANDINGS });
  const c = await L.renderCertificateCanvas(d);
  const ctx = c.getContext('2d');
  const px = ctx.getImageData(0, 0, c.width, c.height).data;

  // The paper colour, sampled from a spot inside the frame that carries no ink.
  const at = (x, y) => { const i = (y * c.width + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
  // "Ink" = anything markedly brighter than the dark paper. The paper is a
  // vertical gradient, so comparing against one sampled pixel would call the
  // whole page ink; luminance does not have that problem.
  const lum = p => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
  const far = p => lum(p) > 110;

  let inked = 0, opaque = 0;
  const colours = new Set();
  for (let y = 0; y < c.height; y += 4) {
    for (let x = 0; x < c.width; x += 4) {
      const p = at(x, y);
      if (p[3] > 250) opaque++;
      if (far(p)) inked++;
      colours.add((p[0] >> 4) + ',' + (p[1] >> 4) + ',' + (p[2] >> 4));
    }
  }
  const sampled = Math.ceil(c.height / 4) * Math.ceil(c.width / 4);

  // Ink must land in EVERY band of the page — a blank middle would mean the body
  // stopped drawing while the frame still looked fine.
  const bands = [];
  const B = 8;
  for (let b = 0; b < B; b++) {
    let n = 0;
    const y0 = Math.floor((c.height * b) / B), y1 = Math.floor((c.height * (b + 1)) / B);
    for (let y = y0; y < y1; y += 4) for (let x = 0; x < c.width; x += 4) if (far(at(x, y))) n++;
    bands.push(n);
  }

  // Two different racers must produce two different images.
  const c2 = await L.renderCertificateCanvas(
    L.certificateData({ ...fx, racerId: 'plada', standings: window.STANDINGS }), { scale: 1 });
  const c1 = await L.renderCertificateCanvas(
    L.certificateData({ ...fx, racerId: 'nitzotz', standings: window.STANDINGS }), { scale: 1 });
  const a = c1.getContext('2d').getImageData(0, 0, c1.width, c1.height).data;
  const b = c2.getContext('2d').getImageData(0, 0, c2.width, c2.height).data;
  let diff = 0;
  for (let i = 0; i < a.length; i += 16) if (Math.abs(a[i] - b[i]) > 12) diff++;

  return {
    w: c.width, h: c.height, inked, sampled, opaque, colours: colours.size, bands, diff,
    ratio: inked / sampled,
    dataUrlLen: c.toDataURL('image/png').length,
    png: c.toDataURL('image/png'),
  };
}, FIXTURE);

ok('canvas has the certificate\'s dimensions', analyse.w === 2000 && analyse.h === 2800,
  `${analyse.w}x${analyse.h}`);
ok('every pixel is opaque (no transparent PNG)', analyse.opaque === analyse.sampled,
  `${analyse.opaque}/${analyse.sampled}`);
ok('the image is not blank', analyse.ratio > 0.015 && analyse.ratio < 0.5,
  `${(analyse.ratio * 100).toFixed(1)}% of sampled pixels carry ink`);
ok('it is not a flat colour field', analyse.colours > 60, `${analyse.colours} distinct colours`);
ok('ink lands in every horizontal band of the page', analyse.bands.every(n => n > 120),
  analyse.bands.join('/'));
ok('a different racer renders a different image', analyse.diff > 500, `${analyse.diff} differing samples`);
ok('toDataURL yields a substantial PNG', analyse.dataUrlLen > 50000, `${analyse.dataUrlLen} chars`);

// Keep the artefact so a human can look at it — the only way to catch mirrored
// or mangled Hebrew, which is a real hazard in this codebase (Wave 4, item 7).
{
  const b64 = analyse.png.split(',')[1];
  mkdirSync(resolve(root, 'shots'), { recursive: true });
  writeFileSync(resolve(root, 'shots/w4-cert-export.png'), Buffer.from(b64, 'base64'));
  console.log('  \x1b[2m  → wrote shots/w4-cert-export.png for eyeballing\x1b[0m');
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  5. the download works FROM file://                                         */
/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n  \x1b[1m5. DOWNLOAD — from a file:// page, no server\x1b[0m\n  ' + '─'.repeat(74));

ok('the page under test really is file://', (await page.url()).startsWith('file://'), await page.url());

const cdp = await page.target().createCDPSession();
await cdp.send('Browser.setDownloadBehavior', {
  behavior: 'allow', downloadPath: dlDir, eventsEnabled: true,
});

await reopen({ badges: ['quiz-5', 'drift-first'], funTitle: 'champ' });
await wait(80);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.lr-cert-acts .btn')];
  btns.find(b => /הורדה|Download/.test(b.textContent)).click();
});

let file = null;
for (let i = 0; i < 60 && !file; i++) {
  await wait(250);
  file = readdirSync(dlDir).map(f => resolve(dlDir, f))
    .filter(f => f.endsWith('.png') && statSync(f).size > 0)[0] || null;
}
ok('clicking הורדה writes a PNG to disk', !!file, file ? file.replace(root + '/', '') : 'no file appeared');
if (file) {
  const buf = readFileSync(file);
  const magic = buf.slice(0, 8).toString('hex');
  ok('the downloaded file is a real PNG', magic === '89504e470d0a1a0a', magic);
  ok('…and is a full-size certificate', buf.length > 60000, `${(buf.length / 1024).toFixed(0)} KB`);
  ok('…named without a shred of personal data',
    /^prompt-racers-certificate(\s*\(\d+\))?\.png$/.test(file.split('/').pop()), file.split('/').pop());
}
{
  const msg = await page.evaluate(() => document.querySelector('.lr-dl-msg')?.textContent.trim() || '');
  ok('the screen confirms the save', /נשמר|Saved/.test(msg), msg);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  6. zero network, all the way through                                       */
/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n  \x1b[1m6. ZERO NETWORK\x1b[0m\n  ' + '─'.repeat(74));
ok('the export issued no network request', netCalls.length === netBefore,
  netCalls.slice(netBefore, netBefore + 3).join(', ') || 'file:/data:/blob: only');
ok('no network request in the whole session', netCalls.length === 0,
  netCalls.slice(0, 3).join(', ') || '0 requests');
ok('learn.js contains no network API',
  !/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\s*\(/.test(
    readFileSync(resolve(root, 'src/ui/learn.js'), 'utf8')));

/* ══════════════════════════════════════════════════════════════════════════ */
/*  7. the buttons are the size every other screen uses (GAPS.md)              */
/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n  \x1b[1m7. BUTTON SIZE\x1b[0m\n  ' + '─'.repeat(74));
{
  const hs = await page.evaluate(() => [...document.querySelectorAll('.lr-cert-acts .btn')]
    .map(b => ({ h: Math.round(b.getBoundingClientRect().height), label: b.textContent.trim() })));
  ok('every certificate action button is 46–52px tall',
    hs.length >= 3 && hs.every(b => b.h >= 46 && b.h <= 52),
    hs.map(b => `${b.label}:${b.h}px`).join(' · '));
}

ok('no console or page errors throughout', errs.length === 0, errs.slice(0, 2).join(' | '));

await browser.close();
console.log('\n  ' + (fails ? `\x1b[31m${fails} FAILED\x1b[0m` : '\x1b[32mall green\x1b[0m') + '\n');
process.exit(fails ? 1 : 0);

// Multi-resolution layout regression check.
//
// Catches the class of bug where vw-only clamp() sizing keeps the UI at max size
// while the viewport loses height, pushing primary buttons off-screen. On a school
// laptop (1366x768) that made the results-screen CTA unclickable.
//
//   node tools/layoutcheck.mjs --mod src/ui/menus.js --fn previewResults
//   node tools/layoutcheck.mjs --dist --scene garage
//
// Reports, per resolution AND per language: elements clipped outside the
// viewport, panel-level elements that OVERLAP EACH OTHER, key readouts that are
// not fully on screen, interactive elements below the 24px minimum tap target,
// and text below 11px.
//
// Why the last three exist: this gate reported "no clipping at any resolution"
// for the podium while the standings panel's total row sat 39px below the bottom
// edge and, in English, the button row printed straight through the standings
// table. It could see neither, because it only ever tested INTERACTIVE elements
// against the VIEWPORT — a <div> readout falling off the bottom was invisible to
// it, and two elements colliding with each other was not a question it asked.
// It also only ever ran Hebrew, and the collision only showed up in English,
// where the panel and the button row sit on the same side.
//
//   --lang he|en   test one language only (default: both)
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { createHash } from 'crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const a = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) a[k.slice(2)] = (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--')) ? true : process.argv[++i];
}

// Common real-world sizes. 1366x768 is the single most common school laptop panel.
const SIZES = (a.sizes ? a.sizes.split(',').map(s => s.split('x').map(Number)) : [
  [1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 720], [1024, 640],
]);

let url;
const tmp = resolve(root, '.tmp');
mkdirSync(tmp, { recursive: true });

if (a.dist) {
  if (!existsSync(resolve(root, 'dist/index.html'))) { console.error('dist missing — npm run build'); process.exit(2); }
  url = 'file://' + resolve(root, 'dist/index.html');
} else {
  if (!a.mod) { console.error('usage: --mod src/x.js [--fn preview]  |  --dist [--scene name]'); process.exit(2); }
  const fn = a.fn || 'preview';
  const id = createHash('sha1').update('lc' + a.mod + fn).digest('hex').slice(0, 10);
  const entry = resolve(tmp, `lc-${id}.js`);
  writeFileSync(entry, `
import { bootPreview } from ${JSON.stringify(resolve(root, 'src/core/harness.js'))};
import * as M from ${JSON.stringify(resolve(root, a.mod))};
bootPreview(M[${JSON.stringify(fn)}]);`);
  const built = await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'iife', minify: true, write: false,
    alias: { three: resolve(root, 'vendor/three.module.js') }, target: ['chrome100'], logLevel: 'warning',
  });
  const htmlPath = resolve(tmp, `lc-${id}.html`);
  writeFileSync(htmlPath, `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0d1a}#app{position:fixed;inset:0}</style>
</head><body><div id="app"><div id="boot"></div></div><script>${built.outputFiles[0].text}</script></body></html>`);
  url = 'file://' + htmlPath;
  rmSync(entry, { force: true });
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});

// ── panel-level geometry contracts ───────────────────────────────────────────
// Deliberately an explicit list rather than "every pair of elements": siblings
// overlapping is normal (glows, scrims, cards inside a grid), so only pairs that
// are laid out as if they own disjoint regions of the screen belong here. Each
// entry is a pair of selectors whose boxes must not intersect, in any language,
// at any resolution.
const NO_OVERLAP = [
  ['.mn-side', '.mn-bottom'],     // podium: standings panel vs the button row
  ['.mn-side', '.mn-h1'],         // podium: standings panel vs the headline
  ['.mn-bottom', '.mn-congrats'], // podium: button row vs the sentence above it
  ['.mn-go', '.mn-grid'],         // racer select: the CTA vs the card grid
  ['.mn-go', '.mn-sheet'],
];
// Readouts that carry information the screen exists to deliver: they may be
// non-interactive, but if they are off-screen the screen has failed.
const MUST_FIT = ['.mn-total', '.mn-side', '.mn-bottom', '.mn-h1', '.mn-go', '.mn-sheet', '.mn-congrats'];

const LANGS = a.lang ? [String(a.lang)] : ['he', 'en'];

let problems = 0;
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

  console.log(`\n  LAYOUT CHECK  ${a.dist ? 'dist' : a.mod + ':' + (a.fn || 'preview')}`);
  console.log('  ' + '─'.repeat(74));

for (const lang of LANGS) {
  // Both modes go through __DEBUG.goto, which routes the language through
  // setLang() — flipping dir alone leaves every string in Hebrew.
  const target = a.dist ? (a.scene || 'menu') : 'preview';
  await page.evaluate((s, l) => window.__DEBUG.goto(s, { lang: l }), target, lang);
  await new Promise(r => setTimeout(r, 300));
  console.log(`  \x1b[2m── lang ${lang} ──\x1b[0m`);

  for (const [w, h] of SIZES) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await new Promise(r => setTimeout(r, 450));   // let clamps/transitions settle

    const report = await page.evaluate((vw, vh, noOverlap, mustFit) => {
      const out = { clipped: [], tiny: [], small: [], overlap: [], offscreen: [] };
      const label = el => {
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26);
        return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''}${t ? ` "${t}"` : ''}`;
      };
      const interactive = el =>
        el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'INPUT' ||
        el.classList.contains('on') || el.getAttribute('role') === 'button' ||
        el.tabIndex >= 0;

      for (const el of document.querySelectorAll('#ui *, #app > *:not(canvas) *')) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;

        // Clipped: any part of an interactive element outside the viewport.
        if (interactive(el)) {
          const outT = r.top < -1, outB = r.bottom > vh + 1, outL = r.left < -1, outR = r.right > vw + 1;
          if (outT || outB || outL || outR) {
            out.clipped.push(`${label(el)} [${[outT && 'top', outB && 'bottom', outL && 'left', outR && 'right'].filter(Boolean).join('+')}]`);
          }
          if (r.height < 24 || r.width < 24) out.tiny.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        const fs = parseFloat(cs.fontSize);
        if (fs && fs < 11 && (el.textContent || '').trim().length > 2 && !el.children.length) {
          out.small.push(`${label(el)} ${fs.toFixed(1)}px`);
        }
      }
      // ---- panel-vs-panel collisions -------------------------------------
      const shown = el => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1;
      };
      for (const [selA, selB] of noOverlap) {
        for (const ea of document.querySelectorAll(selA)) {
          for (const eb of document.querySelectorAll(selB)) {
            if (ea === eb || ea.contains(eb) || eb.contains(ea)) continue;
            if (!shown(ea) || !shown(eb)) continue;
            const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
            const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
            const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
            if (ox > 1 && oy > 1) {
              out.overlap.push(`${selA} × ${selB} ${Math.round(ox)}x${Math.round(oy)}px (${Math.round(ox * oy)}px²)`);
            }
          }
        }
      }
      // ---- key readouts must be entirely on screen ------------------------
      for (const sel of mustFit) {
        for (const el of document.querySelectorAll(sel)) {
          if (!shown(el)) continue;
          const r = el.getBoundingClientRect();
          const out4 = [r.top < -1 && `top ${Math.round(-r.top)}px`,
            r.bottom > vh + 1 && `bottom ${Math.round(r.bottom - vh)}px`,
            r.left < -1 && `left ${Math.round(-r.left)}px`,
            r.right > vw + 1 && `right ${Math.round(r.right - vw)}px`].filter(Boolean);
          if (out4.length) out.offscreen.push(`${sel} outside by ${out4.join(', ')}`);
        }
      }
      const dedupe = arr => [...new Set(arr)];
      return { clipped: dedupe(out.clipped), tiny: dedupe(out.tiny), small: dedupe(out.small),
        overlap: dedupe(out.overlap), offscreen: dedupe(out.offscreen) };
    }, w, h, NO_OVERLAP, MUST_FIT);

    const bad = report.clipped.length + report.overlap.length + report.offscreen.length;
    problems += bad;
    const mark = bad ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m';
    console.log(`  ${mark} ${String(w) + 'x' + h}`.padEnd(16) +
      `clipped:${report.clipped.length}  overlap:${report.overlap.length}  offscreen:${report.offscreen.length}  ` +
      `small-target:${report.tiny.length}  tiny-text:${report.small.length}`);
    for (const c of report.clipped.slice(0, 6)) console.log(`        \x1b[31mCLIPPED\x1b[0m  ${c}`);
    for (const c of report.overlap.slice(0, 6)) console.log(`        \x1b[31mOVERLAP\x1b[0m  ${c}`);
    for (const c of report.offscreen.slice(0, 6)) console.log(`        \x1b[31mOFFSCREEN\x1b[0m ${c}`);
    for (const c of report.tiny.slice(0, 3)) console.log(`        \x1b[33mtarget\x1b[0m  ${c}`);
    for (const c of report.small.slice(0, 3)) console.log(`        \x1b[2mtext\x1b[0m    ${c}`);
  }
}
  console.log('  ' + '─'.repeat(74));
  console.log(problems ? `  \x1b[31m${problems} layout problem(s)\x1b[0m\n`
    : `  \x1b[32mno clipping, overlap or off-screen readouts at any resolution (${LANGS.join('/')})\x1b[0m\n`);
} catch (e) {
  console.error('LAYOUT CHECK FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
process.exitCode = problems ? 1 : (process.exitCode || 0);

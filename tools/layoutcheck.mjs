// Multi-resolution layout regression check.
//
// Catches the class of bug where vw-only clamp() sizing keeps the UI at max size
// while the viewport loses height, pushing primary buttons off-screen. On a school
// laptop (1366x768) that made the results-screen CTA unclickable.
//
//   node tools/layoutcheck.mjs --mod src/ui/menus.js --fn previewResults
//   node tools/layoutcheck.mjs --dist --scene garage
//
// Reports, per resolution: elements clipped outside the viewport, interactive
// elements below the 24px minimum tap target, and text below 11px.
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

let problems = 0;
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  if (a.dist && a.scene) await page.evaluate(s => window.__DEBUG.goto(s, {}), a.scene);

  console.log(`\n  LAYOUT CHECK  ${a.dist ? 'dist' : a.mod + ':' + (a.fn || 'preview')}`);
  console.log('  ' + '─'.repeat(74));

  for (const [w, h] of SIZES) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await new Promise(r => setTimeout(r, 450));   // let clamps/transitions settle

    const report = await page.evaluate((vw, vh) => {
      const out = { clipped: [], tiny: [], small: [] };
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
      const dedupe = arr => [...new Set(arr)];
      return { clipped: dedupe(out.clipped), tiny: dedupe(out.tiny), small: dedupe(out.small) };
    }, w, h);

    const bad = report.clipped.length;
    problems += bad;
    const mark = bad ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m';
    console.log(`  ${mark} ${String(w) + 'x' + h}`.padEnd(16) +
      `clipped:${report.clipped.length}  small-target:${report.tiny.length}  tiny-text:${report.small.length}`);
    for (const c of report.clipped.slice(0, 6)) console.log(`        \x1b[31mCLIPPED\x1b[0m ${c}`);
    for (const c of report.tiny.slice(0, 3)) console.log(`        \x1b[33mtarget\x1b[0m  ${c}`);
    for (const c of report.small.slice(0, 3)) console.log(`        \x1b[2mtext\x1b[0m    ${c}`);
  }
  console.log('  ' + '─'.repeat(74));
  console.log(problems ? `  \x1b[31m${problems} clipped interactive element(s)\x1b[0m\n` : '  \x1b[32mno clipping at any resolution\x1b[0m\n');
} catch (e) {
  console.error('LAYOUT CHECK FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
process.exitCode = problems ? 1 : (process.exitCode || 0);

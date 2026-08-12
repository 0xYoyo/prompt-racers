// Build: bundles src/ (incl. vendored three.js) into a single self-contained dist/index.html.
// Zero runtime network calls: every byte is inlined.
import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');

const result = await esbuild.build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  // Vendored, not CDN: the bundle must make zero network requests at runtime.
  alias: { three: resolve(root, 'vendor/three.module.js') },
  minify: !dev,
  sourcemap: false,
  target: ['chrome100', 'firefox100', 'safari15'],
  legalComments: 'none',
  write: false,
  logLevel: 'info',
});

const js = result.outputFiles[0].text;

// The DOM shell is deliberately minimal: #app is the only handoff point, so the
// whole thing drops into a React component as <div ref={...} /> + boot(el).
const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="color-scheme" content="dark">
<title>מרוץ הפרומפטים</title>
<style>
  html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#0b0d1a;
    -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
  #app{position:fixed;inset:0;overflow:hidden}
  #boot{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
    background:#0b0d1a;color:#ffd66b;font:700 20px/1.4 system-ui,sans-serif;z-index:9999}
</style>
</head>
<body>
<div id="app"><div id="boot">טוען…</div></div>
<script>${js}</script>
</body>
</html>`;

mkdirSync(resolve(root, '.tmp/critic'), { recursive: true });
writeFileSync(resolve(root, '.tmp/critic/index.html'), html);
console.log(`dist/index.html  ${(html.length / 1024 / 1024).toFixed(2)} MB${dev ? '  (dev, unminified)' : ''}`);

import * as esbuild from 'esbuild';
import { writeFileSync } from 'fs';
const root = '/Users/yoyopc/repos/kart-project';
const variant = process.argv[2];
const r = await esbuild.build({
  entryPoints: [`${root}/.tmp/mut/src-${variant}/main.js`],
  bundle: true, format: 'iife',
  alias: { three: `${root}/vendor/three.module.js` },
  minify: true, sourcemap: false,
  target: ['chrome100','firefox100','safari15'], legalComments: 'none', write: false, logLevel: 'error',
});
const js = r.outputFiles[0].text;
writeFileSync(`${root}/.tmp/mut/index-${variant}.html`, `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>mut</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0d1a}#app{position:fixed;inset:0}</style>
</head><body><div id="app"><div id="boot">x</div></div><script>${js}</script></body></html>`);
console.log('built', variant, (js.length/1048576).toFixed(2)+'MB');

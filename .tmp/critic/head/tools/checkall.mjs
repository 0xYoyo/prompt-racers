import * as esbuild from 'esbuild';
import { readdirSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';
const root = process.cwd();
const walk = d => readdirSync(d,{withFileTypes:true}).flatMap(e=>{
  const p = resolve(d,e.name); return e.isDirectory()?walk(p):(e.name.endsWith('.js')?[p]:[]);});
const files = walk(resolve(root,'src'));
let fail = 0;
for (const f of files) {
  const rel = f.replace(root+'/','');
  try {
    const r = await esbuild.build({entryPoints:[f],bundle:true,write:false,format:'iife',
      alias:{three:resolve(root,'vendor/three.module.js')},target:['chrome100'],logLevel:'silent',minify:true});
    console.log(`  ok    ${rel.padEnd(34)} ${(r.outputFiles[0].text.length/1024).toFixed(0)}KB`);
  } catch(e){ fail++; console.log(`  FAIL  ${rel}`); console.log('        '+(e.errors?.[0]?.text||e.message)); 
    if(e.errors?.[0]?.location) console.log(`        at ${e.errors[0].location.file}:${e.errors[0].location.line}`); }
}
console.log(fail?`\n${fail} module(s) failed to bundle`:'\nall modules bundle cleanly');

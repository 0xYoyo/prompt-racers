// Reads back computed transforms on every .pop-in element after the animation
// has settled, plus the selected card's lift and a button hover.
import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars','--mute-audio']});
const p=await b.newPage();
await p.setViewport({width:1366,height:768});
await p.goto('file://'+resolve(process.cwd(),'dist/index.html'),{waitUntil:'load',timeout:60000});
await p.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true',{timeout:60000});
for (const scene of ['menu','select','podium','garage']) {
  await p.evaluate(s=>window.__DEBUG.goto(s,{}),scene);
  await new Promise(r=>setTimeout(r,1200));
  const out = await p.evaluate(()=>{
    const rows=[...document.querySelectorAll('.pop-in')].map(e=>({
      cls:e.className, transform:getComputedStyle(e).transform,
      translate:getComputedStyle(e).translate, scale:getComputedStyle(e).scale}));
    const sel=document.querySelector('.mn-card.sel');
    return {rows, sel: sel? getComputedStyle(sel).transform : null};
  });
  console.log('==',scene);
  for(const r of out.rows) console.log('   ',r.cls,'| transform:',r.transform,'| translate:',r.translate,'| scale:',r.scale);
  if(out.sel) console.log('    .mn-card.sel transform:',out.sel);
}
await b.close();

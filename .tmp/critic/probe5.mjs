import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars','--mute-audio']});
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR',e.message));
await p.setViewport({width:1440,height:900});
await p.goto('file:///Users/yoyopc/repos/kart-project/.tmp/critic/probe.html',{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true',{timeout:60000});
const w=ms=>new Promise(r=>setTimeout(r,ms)); await w(600);
const S=()=>p.evaluate(()=>({
  step:[...document.querySelectorAll('.grg-pill')].findIndex(x=>x.classList.contains('now')),
  sentence:document.querySelector('.grg-sentence .grg-sentence-txt')?.textContent.replace(/\s+/g,' ').trim(),
  blanks:document.querySelectorAll('.grg-sentence .grg-blank').length,
  build:document.querySelector('.grg-build')?.disabled,
  buildTxt:document.querySelector('.grg-build')?.textContent.trim(),
  cards:[...document.querySelectorAll('.grg-opt')].map(c=>({l:c.querySelector('.grg-opt-he')?.textContent.trim(),dis:c.disabled})),
  tip:document.querySelector('.grg-boregcard')?.dataset.tip,
  left:document.querySelector('.grg-budget')?.textContent.replace(/\s+/g,' ').trim(),
  parts:window.__TIERS,
  kartMeshes:(()=>{let n=0;window.__KART.group.traverse(o=>{if(o.isMesh)n++;});return n;})(),
}));
const click=async i=>{await p.evaluate(n=>document.querySelectorAll('.grg-opt')[n].click(),i);await w(300);};
const pill=async i=>{await p.evaluate(n=>document.querySelectorAll('.grg-pill')[n].click(),i);await w(300);};
console.log('--- pick ENGINE, most expensive everywhere');
await click(0);           // engine
await click(3); console.log('goal3 ',JSON.stringify(await S()).slice(0,400));
await click(3); console.log('con3  ',JSON.stringify((await S())).slice(0,400));
let s=await S(); console.log('  style cards affordable?',JSON.stringify(s.cards),'| left:',s.left);
await click(0); s=await S(); console.log('  after free style: build=',s.build,'blanks=',s.blanks,'parts=',JSON.stringify(s.parts),'meshes=',s.kartMeshes);
console.log('  SENTENCE:',s.sentence);
console.log('--- now rail back to step1 and switch to WING');
await pill(0); await click(2);   // wing
s=await S(); console.log('  build=',s.build,'("'+s.buildTxt+'") blanks=',s.blanks,'parts=',JSON.stringify(s.parts),'meshes=',s.kartMeshes);
console.log('  SENTENCE:',s.sentence);
await b.close();

import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars','--mute-audio']});
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR',e.message));
await p.setViewport({width:1440,height:900});
await p.goto('file:///Users/yoyopc/repos/kart-project/.tmp/critic/probe.html',{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true',{timeout:60000});
const w=ms=>new Promise(r=>setTimeout(r,ms));
await w(400);
const cards=()=>p.evaluate(()=>[...document.querySelectorAll('.grg-opt')].map(c=>c.querySelector('.grg-opt-he')?.textContent.trim()));
const click=async i=>{await p.evaluate(n=>document.querySelectorAll('.grg-opt')[n].click(),i);await w(500);};
const shot=async n=>{const el=await p.$('.grg-kartwin')||await p.$('.grg-kart')||await p.$('.grg-kartcap');
  const box=await p.evaluate(()=>{const e=document.querySelector('.grg-kartwin')||document.querySelector('.grg-kart');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
  if(!box){console.log('NO KART WINDOW ELEMENT');return;}
  await p.screenshot({path:'/Users/yoyopc/repos/kart-project/shots/critic-garage/kart-'+n+'.png',clip:box});
  console.log('shot',n,JSON.stringify(box));};
console.log('STEP1 cards:',await cards());
await click(0); // first part card
console.log('after part pick, cards:',await cards());
console.log('CALLS:',JSON.stringify(await p.evaluate(()=>window.__CALLS)));
await shot('a-part-only');
// pick vaguest goal (last card = specificity 0? check order)
const n=(await cards()).length;
await click(n-1); await shot('b-goal-vague');
console.log('CALLS:',JSON.stringify(await p.evaluate(()=>window.__CALLS)));
// go back and pick sharpest
await p.evaluate(()=>document.querySelector('.grg-back').click()); await w(300);
console.log('back cards:',await cards());
await click(0); await w(500); await shot('c-goal-sharp');
console.log('CALLS:',JSON.stringify(await p.evaluate(()=>window.__CALLS)));
console.log('TIERS:',JSON.stringify(await p.evaluate(()=>window.__TIERS)));
await b.close();

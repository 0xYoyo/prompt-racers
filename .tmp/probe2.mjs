import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
const root=process.cwd();
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
 args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const p=await b.newPage(); await p.setViewport({width:1366,height:768});
p.on('console',m=>{const t=m.text(); if(/PROBE/.test(t))console.log('  '+t);});
await p.goto('file://'+resolve(root,'dist/index.html'),{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/אליפות/.test(x.textContent));b.click();});
await new Promise(r=>setTimeout(r,900));
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/לזינוק|התחל/.test(x.textContent));b?.click();});
await new Promise(r=>setTimeout(r,1800));
await p.evaluate(()=>window.__DEBUG.advance(470));
await new Promise(r=>setTimeout(r,3200));
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/מוסך|הבא|המשך/.test(x.textContent));b?.click();});
await new Promise(r=>setTimeout(r,1600));
console.log('  scene:', await p.evaluate(()=>window.__DEBUG.state().scene));
const r=await p.evaluate(async()=>{
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let rounds=0;
 for(let i=0;i<8;i++){const c=[...document.querySelectorAll('.grg-opt,[data-opt],.grg-card')].filter(e=>e.offsetParent&&!e.getAttribute('aria-disabled'));if(!c.length)break;c[0].click();rounds++;await sleep(320);}
 const bt=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/בנה|תבנה/.test(x.textContent)&&!x.disabled);
 const btLabel=bt?.textContent; if(bt){bt.click();await sleep(2400);}
 const inst=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/התקנ/.test(x.textContent));
 const iLabel=inst?.textContent; if(inst){inst.click();await sleep(900);}
 return {rounds,btLabel,iLabel,parts:JSON.parse(localStorage.getItem('promptracers.v1')||'{}').parts, scene:window.__DEBUG.state().scene};
});
console.log('  rounds:',r.rounds,'| build:',JSON.stringify(r.btLabel),'| install:',JSON.stringify(r.iLabel));
console.log('  parts:',JSON.stringify(r.parts),'| scene:',r.scene);
await b.close();

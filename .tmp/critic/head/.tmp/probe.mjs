import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
const root = process.cwd();
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:true, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const p = await b.newPage();
p.on('console', m => { if(/PROBE/.test(m.text())) console.log(m.text()); });
await p.setViewport({width:1366,height:768});
await p.goto('file://'+resolve(root,'dist/index.html'),{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
// go straight to garage with a probe onDone
await p.evaluate(async () => {
  localStorage.setItem('promptracers.v1', JSON.stringify({championshipRace:1, tokens:30, results:[{trackIndex:0,standings:[]}]}));
  location.reload();
});
await new Promise(r=>setTimeout(r,2500));
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
await p.evaluate(() => window.__DEBUG.goto('garage', {}));
await new Promise(r=>setTimeout(r,900));
const res = await p.evaluate(async () => {
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  for(let i=0;i<6;i++){
    const c=[...document.querySelectorAll('.grg-opt,[data-opt],.grg-card')].filter(e=>e.offsetParent&&!e.getAttribute('aria-disabled'));
    if(!c.length)break; c[0].click(); await sleep(320);
  }
  const bt=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/בנה|תבנה|Build/.test(x.textContent)&&!x.disabled);
  if(bt){bt.click(); await sleep(2200);}
  // intercept: wrap console to capture what onDone gets
  const inst=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/התקנ|[Ii]nstall/.test(x.textContent));
  const label = inst?.textContent;
  inst?.click(); await sleep(800);
  return { label, saved: localStorage.getItem('promptracers.v1'), scene: window.__DEBUG.state().scene };
});
console.log('install label:', JSON.stringify(res.label));
console.log('scene after :', res.scene);
console.log('saved parts :', JSON.parse(res.saved||'{}').parts);
await b.close();

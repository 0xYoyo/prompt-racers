import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAVE_KEY = 'promptracers.v1';
const REST = ['zamzum','tipa','kaftor','raash'];
const browser = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:true, args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars','--mute-audio'] });
const page = await browser.newPage();
await page.goto('file://'+resolve(root,'dist/index.html'),{waitUntil:'load',timeout:60000});
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true',{timeout:60000});
const CLEAR=[['zuzi','nitzotz','plada','nurit',...REST],['zuzi','nitzotz','plada','nurit',...REST],['zuzi','nitzotz','plada','nurit',...REST]];
const ledger = orders => orders.map((o,i)=>({trackIndex:i,track:'oasis',place:o.indexOf('nitzotz')+1,timeMs:9e4,bestLapMs:3e4,
  standings:o.map((id,j)=>({racerId:id,place:j+1,isPlayer:id==='nitzotz',timeMs:9e4+j*800}))}));
for (const lang of ['he','en']) {
  await page.evaluate((k,d)=>localStorage.setItem(k,JSON.stringify(d)),SAVE_KEY,
    {lang,quality:'low',muted:true,racerId:'nitzotz',championshipRace:3,results:ledger(CLEAR),bestPrompt:{text:'x',score:70}});
  await page.reload({waitUntil:'load',timeout:60000});
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true',{timeout:60000});
  for (const [w,h] of [[1920,1080],[1440,900],[1366,768],[1280,720],[1024,640],[900,600]]) {
    await page.setViewport({width:w,height:h});
    await page.evaluate((l)=>window.__DEBUG.goto('podium',{lang:l}),lang);
    await new Promise(r=>setTimeout(r,700));
    const r = await page.evaluate((vw,vh)=>{
      const rect = s => { const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect();
        return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom)}; };
      const side=rect('.mn-side'), bottom=rect('.mn-bottom'), total=rect('.mn-total');
      const ov = (a,b)=> a&&b ? Math.max(0, Math.min(a.r,b.r)-Math.max(a.l,b.l)) * Math.max(0, Math.min(a.b,b.b)-Math.max(a.t,b.t)) : 0;
      const btns=[...document.querySelectorAll('.mn-bottom button')].map(x=>{const b=x.getBoundingClientRect();
        return {txt:x.textContent.trim().replace(/\s+/g,' ').slice(0,22), w:Math.round(b.width), h:Math.round(b.height),
          lines: Math.round(b.height/parseFloat(getComputedStyle(x).lineHeight||'20'))};});
      return { sideBottomOverlapPx2: ov(side,bottom),
        totalBottomOverlapPx2: ov(total,bottom),
        sideOffBottom: side ? Math.max(0, side.b - vh) : null,
        totalVisible: total ? (total.b <= vh) : null,
        side, bottom, btns };
    },w,h);
    const flag = r.sideBottomOverlapPx2>0 ? ' *** OVERLAP ***' : '';
    const clip = r.sideOffBottom>0 ? ` *** PANEL OFF-SCREEN BY ${r.sideOffBottom}px ***` : '';
    console.log(`${lang} ${w}x${h}  side/bottom overlap=${r.sideBottomOverlapPx2}px²  total-row overlap=${r.totalBottomOverlapPx2}px²  totalVisible=${r.totalVisible}${flag}${clip}`);
    if (r.sideBottomOverlapPx2>0 || r.sideOffBottom>0) console.log('    side=',JSON.stringify(r.side),' bottom=',JSON.stringify(r.bottom),'\n    btns=',JSON.stringify(r.btns));
  }
}
await browser.close();

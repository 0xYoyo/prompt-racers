import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist/index.html');
const SAVE_KEY = 'promptracers.v1';
const REST = ['zamzum', 'tipa', 'kaftor', 'raash'];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars','--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
const settle = (ms=700)=>new Promise(r=>setTimeout(r,ms));
const shot = f => page.screenshot({ path: resolve(root,'shots/'+f), type:'png' });
await page.goto('file://'+dist,{waitUntil:'load',timeout:60000});
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true',{timeout:60000});
const ledger = orders => orders.map((order,i)=>({trackIndex:i,track:['oasis','circuit','cloud'][i]||'oasis',
  place:order.indexOf('nitzotz')+1,timeMs:90000+i*1000,bestLapMs:30000,
  standings:order.map((id,j)=>({racerId:id,place:j+1,isPlayer:id==='nitzotz',timeMs:90000+j*800}))}));
const seed = async (patch,lang='he') => {
  await page.evaluate((k,d)=>localStorage.setItem(k,JSON.stringify(d)),SAVE_KEY,{lang,quality:'high',muted:true,racerId:'nitzotz',garageMetBoreg:true,garageTokenIntroSeen:true,...patch});
  await page.reload({waitUntil:'load',timeout:60000});
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true',{timeout:60000});
};
const goto = async (s,o={}) => { await page.evaluate((s,o)=>window.__DEBUG.goto(s,o),s,o); await settle(900); await page.evaluate(()=>window.__DEBUG.advance(2)); await page.evaluate(()=>window.__DEBUG.renderOnce()); await settle(200); };
const CLEAR=[['zuzi','nitzotz','plada','nurit',...REST],['zuzi','nitzotz','plada','nurit',...REST],['zuzi','nitzotz','plada','nurit',...REST]];
const WIN=[['nitzotz','zuzi','plada','nurit',...REST],['nitzotz','zuzi','plada','nurit',...REST],['nitzotz','zuzi','plada','nurit',...REST]];
const TIE=[['nitzotz','zuzi','plada','nurit',...REST],['plada','nitzotz','zuzi','nurit',...REST],['zuzi','nurit','nitzotz','plada',...REST]];
const BP={text:'מנוע קליל שמאיץ מהר ביציאה מפנייה, בלי לאבד אחיזה',score:84};
const BPEN={text:'A light engine that accelerates hard out of a corner without losing grip on the sand',score:84};

for (const lang of ['he','en']) {
  const bp = lang==='he'?BP:BPEN;
  // podium — player 2nd
  await seed({championshipRace:3,tokens:9,parts:{engine:2,tires:1},results:ledger(CLEAR),bestPrompt:bp},lang);
  await goto('podium',{lang}); await shot(`critic-podium-2nd-${lang}.png`);
  // podium — player WINS
  await seed({championshipRace:3,tokens:9,parts:{engine:3,tires:2,wing:1},results:ledger(WIN),bestPrompt:bp},lang);
  await goto('podium',{lang}); await shot(`critic-podium-win-${lang}.png`);
  // tie
  await seed({championshipRace:3,tokens:9,parts:{engine:2},results:ledger(TIE),bestPrompt:bp},lang);
  await goto('podium',{lang}); await shot(`critic-podium-tie-${lang}.png`);
  // certificate
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(x=>/תעודת|Certificate/.test(x.textContent))?.click());
  await settle(500); await page.evaluate(()=>window.__DEBUG.renderOnce()); await settle(200);
  await shot(`critic-cert-${lang}.png`);
  // certificate with NO best prompt
  await seed({championshipRace:3,results:ledger(CLEAR)},lang);
  await goto('podium',{lang});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(x=>/תעודת|Certificate/.test(x.textContent))?.click());
  await settle(500); await page.evaluate(()=>window.__DEBUG.renderOnce()); await settle(200);
  await shot(`critic-cert-nobest-${lang}.png`);
  // titles, three states
  await seed({championshipRace:0,results:[]},lang); await goto('menu',{lang}); await shot(`critic-title-fresh-${lang}.png`);
  await seed({championshipRace:1,tokens:14,parts:{engine:1},results:ledger(CLEAR).slice(0,1)},lang); await goto('menu',{lang}); await shot(`critic-title-mid-${lang}.png`);
  await seed({championshipRace:3,results:ledger(CLEAR),bestPrompt:bp},lang); await goto('menu',{lang}); await shot(`critic-title-done-${lang}.png`);
}
// close-up of the three karts: narrow viewport stress
await page.setViewport({ width: 900, height: 600 });
await seed({championshipRace:3,tokens:9,parts:{engine:3},results:ledger(CLEAR),bestPrompt:BP},'he');
await goto('podium',{lang:'he'}); await shot('critic-podium-900x600-he.png');
await page.setViewport({ width: 1280, height: 720 });
await goto('podium',{lang:'he'}); await shot('critic-podium-1280-he.png');
await browser.close();
console.log('shots written');

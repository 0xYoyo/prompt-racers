import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true,
  args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars','--mute-audio']});
const p = await b.newPage();
await p.setViewport({width:1024,height:640});
await p.goto('file:///Users/yoyopc/repos/kart-project/dist/index.html',{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true',{timeout:60000});
await p.evaluate(()=>localStorage.setItem('promptracers.v1',JSON.stringify({lang:'he',quality:'low',muted:true,racerId:'nitzotz',garageMetBoreg:true,garageTokenIntroSeen:true,championshipRace:1,tokens:14,parts:{engine:1},results:[{trackIndex:0,track:'oasis',place:2,timeMs:9e4,bestLapMs:3e4,standings:[{racerId:'zuzi',place:1},{racerId:'nitzotz',place:2,isPlayer:true}]}]})));
await p.reload({waitUntil:'load'});
await p.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true',{timeout:60000});
await p.evaluate(()=>window.__DEBUG.goto('garage',{}));
await new Promise(r=>setTimeout(r,1500));
await p.evaluate(()=>window.__DEBUG.renderOnce());
await p.screenshot({path:'/Users/yoyopc/repos/kart-project/shots/nav-garage-1024.png'});
await p.evaluate(()=>window.__DEBUG.goto('race',{track:0}));
await new Promise(r=>setTimeout(r,1200));
await p.evaluate(()=>{window.__DEBUG.advance(9);window.__DEBUG.renderOnce();});
await p.screenshot({path:'/Users/yoyopc/repos/kart-project/shots/nav-race-1024.png'});
await b.close();

import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
await p.goto('file:///Users/yoyopc/repos/kart-project/dist/index.html',{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true',{timeout:60000});
await p.evaluate(()=>window.__DEBUG.goto('race',{track:0,difficulty:1,seed:3}));
await p.evaluate(()=>window.__DEBUG.advance(8));
console.log(await p.evaluate(()=>{const s=window.__DEBUG.engine.active;return{phase:s.state.phase,progress:s.state.progress,raceTime:s.state.raceTime,intro:!!document.querySelector('[class*=intro]')};}));
await b.close();

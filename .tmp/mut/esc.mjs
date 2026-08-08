import puppeteer from 'puppeteer-core';
const dist='/Users/yoyopc/repos/kart-project/dist/index.html';
const b=await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page=await b.newPage(); page.on('pageerror',e=>console.log('ERR',e.message));
await page.setViewport({width:1366,height:768});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await page.goto('file://'+dist,{waitUntil:'load'});
await page.evaluate(()=>localStorage.setItem('promptracers.v1',JSON.stringify({garageTokenIntroSeen:true})));
await page.reload({waitUntil:'load'});
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready===true',{timeout:60000});
await page.evaluate(()=>window.__DEBUG.goto('race',{track:0,difficulty:1,autopilot:true}));
await wait(300); await page.evaluate(()=>window.__DEBUG.advance(6));
await page.evaluate(()=>window.__DEBUG.engine.active.quiz.openQuestion());
const st=()=>page.evaluate(()=>({ov:document.querySelectorAll('.mn-ov').length,pause:!!document.querySelector('.mn-dialog.pause'),
  quiz:[...document.querySelectorAll('.quiz-root')].some(e=>e.classList.contains('show')),paused:window.__DEBUG.engine.active.state.paused}));
// REAL escape: through the browser, focused element, so it bubbles like a real key
await page.keyboard.press('Escape'); await wait(300); console.log('after Esc#1 (real key):',JSON.stringify(await st()));
await page.evaluate(()=>[...document.querySelectorAll('.mn-dialog.pause .btn')].find(x=>/הגדרות|Settings/.test(x.textContent))?.click());
await wait(300); console.log('settings open:',JSON.stringify(await st()));
await page.keyboard.press('Escape'); await wait(300); console.log('after Esc#2 (real key):',JSON.stringify(await st()));
await page.keyboard.press('Escape'); await wait(300); console.log('after Esc#3 (real key):',JSON.stringify(await st()));
await b.close();

import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
await p.setViewport({width:1366,height:768});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await p.goto('file:///Users/yoyopc/repos/kart-project/dist/index.html',{waitUntil:'load'});
await p.evaluate(()=>localStorage.setItem('promptracers.v1',JSON.stringify({garageTokenIntroSeen:true})));
await p.reload({waitUntil:'load'});
await p.waitForFunction('window.__DEBUG && window.__DEBUG.ready===true',{timeout:60000});
await p.evaluate(()=>window.__DEBUG.goto('race',{track:0,difficulty:1,autopilot:true}));
await wait(300); await p.evaluate(()=>window.__DEBUG.advance(6));
await p.evaluate(()=>window.__DEBUG.engine.active.quiz.openQuestion());
await p.keyboard.press('Escape'); await wait(300);
const st=()=>p.evaluate(()=>({phase:window.__DEBUG.engine.active.quiz.phase,
  pause:!!document.querySelector('.mn-dialog.pause'),
  hitTarget:(()=>{const el=document.querySelector('.quiz-root.show .quiz-opt');if(!el)return null;
    const r=el.getBoundingClientRect(); const e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return e? (e.className||e.tagName) : null;})()}));
console.log('paused over quiz:',JSON.stringify(await st()));
// REAL mouse click at the first option's centre
const r = await p.evaluate(()=>{const el=document.querySelector('.quiz-root.show .quiz-opt');const b=el.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};});
await p.mouse.click(r.x,r.y); await wait(200);
console.log('after REAL mouse click on option 1:',JSON.stringify(await st()));
// PROGRAMMATIC click (what a repositioned layout or a stray hit-test would do)
await p.evaluate(()=>document.querySelector('.quiz-root.show .quiz-opt')?.click()); await wait(200);
console.log('after PROGRAMMATIC .click() on option 1:',JSON.stringify(await st()));
await p.evaluate(()=>document.querySelector('.quiz-root.show .quiz-cont')?.click()); await wait(200);
console.log('after PROGRAMMATIC .click() on continue:',JSON.stringify(await st()));
console.log('sim state:',JSON.stringify(await p.evaluate(()=>{const s=window.__DEBUG.engine.active;
  return{quizPhase:s.quiz.phase,paused:s.state.paused,quizFrozen:s.state.quizFrozen,inputEnabled:s.input.enabled,
  pauseUp:!!document.querySelector('.mn-dialog.pause')};})));
await b.close();

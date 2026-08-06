import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
const root=process.cwd();
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
 args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const p=await b.newPage(); await p.setViewport({width:1366,height:768});
await p.goto('file://'+resolve(root,'dist/index.html'),{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
await p.evaluate(()=>{
  window.__ECON={pickup:0,quiz:0,quizN:0};
  const bus=window.__DEBUG.engine; // bus not exposed; hook via counters on scene instead
});
await p.evaluate(()=>window.__DEBUG.goto('race',{track:0}));
await new Promise(r=>setTimeout(r,1000));
// count quiz rewards by watching S.tokens jumps
await p.evaluate(()=>{
  const sc=window.__DEBUG.engine.active;
  window.__W={last:0,jumps:[]};
  window.__tick=()=>{const t=sc.state.tokens; if(t!==window.__W.last){window.__W.jumps.push(t-window.__W.last); window.__W.last=t;}};
});
await p.evaluate(()=>{dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowUp',bubbles:true}));});
for(let i=0;i<90;i++){
  await p.evaluate(()=>{ for(let k=0;k<240;k++){ window.__DEBUG.advance(1/60); window.__tick(); } });
  await p.evaluate(()=>{
    const vis=el=>el&&el.offsetParent!==null;
    for(const sel of ['.grgtok-scrim','.grg-meet-scrim']){const e=document.querySelector(sel); if(vis(e)){const btn=e.querySelector('button'); if(btn)btn.click();}}
    const q=document.querySelector('.quiz-q'); if(vis(q)) dispatchEvent(new KeyboardEvent('keydown',{code:'Digit1',key:'1',bubbles:true}));
  });
  const done = await p.evaluate(()=>window.__DEBUG.engine.active?.state?.finished);
  if(done) break;
}
const r=await p.evaluate(()=>{
  const sc=window.__DEBUG.engine.active;
  const j=window.__W.jumps;
  const ones=j.filter(x=>x===1).length, big=j.filter(x=>x>1);
  return {total:sc.state?.tokens, laps:sc.state?.lap, finished:sc.state?.finished, place:sc.state?.position,
          pickups:ones, quizAwards:big, quizSum:big.reduce((a,c)=>a+c,0)};
});
console.log(JSON.stringify(r,null,1));
await b.close();

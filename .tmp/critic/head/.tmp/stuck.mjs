import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
const root=process.cwd();
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
 args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const p=await b.newPage(); await p.setViewport({width:1366,height:768});
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
await p.goto('file://'+resolve(root,'dist/index.html'),{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
await p.evaluate(()=>window.__DEBUG.goto('race',{track:0}));
await new Promise(r=>setTimeout(r,1200));
await p.evaluate(()=>{dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowUp',bubbles:true}));});
const trace=[];
for(let i=0;i<24;i++){
  await p.evaluate(()=>window.__DEBUG.advance(5));
  const t = await p.evaluate(()=>{
    const sc=window.__DEBUG.engine.active;
    const vis=el=>el&&el.offsetParent!==null;
    for(const sel of ['.grgtok-scrim','.grg-meet-scrim']){const e=document.querySelector(sel); if(vis(e)){const b=e.querySelector('button'); if(b)b.click();}}
    const q=document.querySelector('.quiz-q');
    if(vis(q)) dispatchEvent(new KeyboardEvent('keydown',{code:'Digit1',key:'1',bubbles:true}));
    return {rt:+(sc.state?.raceTime||0).toFixed(1), spd:+(sc.player?.speed||0).toFixed(1), prog:+(sc.state?.progress||0).toFixed(2), off:!!sc.player?.offTrack, lat:+(sc.player?.lateral||0).toFixed(1), quizOpen:!!vis(q), thr:sc.input?.down? [...sc.input.down].join(','):'-'};
  });
  trace.push(t);
  await new Promise(r=>setTimeout(r,50));
}
console.log('trace (each row = +5s of wall advance):');
console.log(trace.map((t,i)=>`  ${String((i+1)*5).padStart(3)}s -> rt ${String(t.rt).padStart(6)} spd ${String(t.spd).padStart(5)} prog ${String(t.prog).padStart(5)} lat ${String(t.lat).padStart(6)} off=${t.off?'Y':'n'} quiz=${t.quizOpen?'Y':'n'} keys[${t.thr}]`).join('\n'));
const st = await p.evaluate(()=>{
  const sc=window.__DEBUG.engine.active;
  return {
    paused: sc.state?.paused, phase: sc.state?.phase, raceTime:+(sc.state?.raceTime||0).toFixed(1),
    tokens: sc.state?.tokens, enginePaused: window.__DEBUG.engine.paused,
    updateWrapped: sc.update?.name || '(anon)',
    uiChildren: [...document.querySelectorAll('#ui > *')].map(e=>e.className||e.tagName),
    bodyOverlays: [...document.querySelectorAll('[class*=scrim],[class*=overlay],[class*=quiz],[class*=pause]')].map(e=>e.className),
  };
});
console.log(JSON.stringify(st,null,1));
await b.close();

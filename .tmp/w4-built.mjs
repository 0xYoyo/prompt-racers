// Built-game verification of the Wave-4 AI rebalance.
// Drives dist/index.html with the real race scene, autopilot player, top speed
// and accel scaled to `pace`. Any quiz panel is closed immediately with
// quiz.close() so the run is a NO-ENGAGEMENT baseline (no boost, no tokens).
import puppeteer from 'puppeteer-core';
const dist='/Users/yoyopc/repos/kart-project/dist/index.html';
const b=await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page=await b.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(''+e.message));
await page.setViewport({width:800,height:450});
const f=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'inf';

async function run({track,difficulty,pace,seed,parts=null}){
  await page.goto('file://'+dist,{waitUntil:'load'});
  await page.evaluate(()=>localStorage.setItem('promptracers.v1',JSON.stringify({garageTokenIntroSeen:true})));
  await page.reload({waitUntil:'load'});
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true',{timeout:60000});
  await page.evaluate(o=>window.__DEBUG.goto('race',o),{track,difficulty,seed,autopilot:true,parts:parts||undefined});
  await page.evaluate(p=>{const s=window.__DEBUG.engine.active; s.player.p.topSpeed*=p; s.player.p.accelPower*=p;},pace);
  const out=await page.evaluate(async()=>{
    const s=window.__DEBUG.engine.active;
    let lapsBehind=null, leaderDone=false, guard=0;
    while(!s.state.finished && guard<400){
      if(s.quiz && s.quiz.frozen) s.quiz.close();
      window.__DEBUG.advance(1); guard++;
      const rows=s.field.order();
      let lead=0; for(const r of rows) if(!r.isPlayer) lead=Math.max(lead,r.progress);
      const pp=s.state.progress;
      if(!leaderDone && lead>=3){ leaderDone=true; lapsBehind=lead-pp; }
    }
    const rows=s.field.order();
    return { pos:s.state.position, lapsBehind, finished:s.state.finished, guard,
             raceTime:s.state.raceTime, prog:s.state.progress };
  });
  return out;
}
const arg=process.argv.slice(2);
const jobs=JSON.parse(arg[0]);
for(const j of jobs){
  const t0=Date.now();
  const r=await run(j);
  console.log(`${j.track} d${j.difficulty} pace ${j.pace} seed ${j.seed} parts ${j.parts?'t'+j.parts.engine:'stock'} -> pos ${r.pos}  lapsBehind ${f(r.lapsBehind)}  finished ${r.finished}  simT ${f(r.raceTime,0)}s  (${((Date.now()-t0)/1000).toFixed(0)}s wall)`);
}
if(errs.length) console.log('PAGE ERRORS:',errs.slice(0,3));
await b.close();

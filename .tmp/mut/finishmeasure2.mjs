import puppeteer from 'puppeteer-core';
const dist = process.env.MUT_DIST || '/Users/yoyopc/repos/kart-project/dist/index.html';
const b = await puppeteer.launch({ headless:'new', executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
for (const track of [0,1,2]) {
  const page = await b.newPage();
  page.on('pageerror',e=>console.log('PAGEERROR',e.message));
  await page.setViewport({width:1280,height:720});
  await page.goto('file://'+dist,{waitUntil:'load'});
  await page.evaluate(()=>localStorage.setItem('promptracers.v1', JSON.stringify({garageTokenIntroSeen:true})));
  await page.reload({waitUntil:'load'});
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready===true',{timeout:60000});
  await page.evaluate(t=>window.__DEBUG.goto('race',{track:t,difficulty:1,autopilot:true,laps:9}), track);
  await new Promise(r=>setTimeout(r,400));
  const out = await page.evaluate(()=>{
    const V = window.__THREE__.Vector3;
    const s = window.__DEBUG.engine.active;
    const sp = s.track.spline, def = s.track.def, L = sp.length;
    let chq=null, gan=null;
    s.track.group.traverse(o=>{ if(o.name==='startline') chq=o; if(o.name==='gantry') gan=o; });
    const wcen = o => { if(!o) return null;
      if (o.geometry){ o.geometry.computeBoundingBox(); const c=o.geometry.boundingBox.getCenter(new V()); return o.localToWorld(c); }
      return o.getWorldPosition(new V()); };
    const chqC = wcen(chq), ganC = wcen(gan);
    const chqT = chqC ? sp.closestT(chqC).t : null;
    const ganT = ganC ? sp.closestT(ganC).t : null;
    const dT=(a,bb)=>{ let d=a-bb; while(d>0.5)d-=1; while(d<-0.5)d+=1; return d; };
    let bandMin=1e9, bandMax=-1e9;
    if (chq){ const pos=chq.geometry.attributes.position; const v=new V();
      for(let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i); chq.localToWorld(v);
        const dd=dT(sp.closestT(v).t, chqT); bandMin=Math.min(bandMin,dd*L); bandMax=Math.max(bandMax,dd*L);} }
    const F=1/60; const laps=[]; let prevLap=s.state.lap; let guard=0; let quizzes=0;
    const eng = window.__DEBUG.engine;
    while (laps.length<4 && guard++ < 60*600 && !s.state.finished){
      if (s.quiz && s.quiz.phase!=='idle'){ s.quiz.close(); quizzes++; }
      eng.time+=F; s.update(F);
      if (s.state.lap!==prevLap){ prevLap=s.state.lap;
        const p=s.player.position; laps.push({t:sp.closestT(p).t, spd:s.player.speed}); }
    }
    return { id:def.id, L:+L.toFixed(1), startT:def.startT, lapsRecorded:laps.length, quizzes,
      chqOffsetFromStartT_m:+(dT(chqT,def.startT)*L).toFixed(3),
      ganOffsetFromStartT_m:+(dT(ganT,def.startT)*L).toFixed(3),
      chequerBand_m:[+bandMin.toFixed(2),+bandMax.toFixed(2)],
      lapErr_vs_CHEQUER_m: laps.map(l=>+(dT(l.t,chqT)*L).toFixed(3)),
      speeds: laps.map(l=>+l.spd.toFixed(1)),
      oneStepAt_m: laps.map(l=>+(l.spd/60).toFixed(3)) };
  });
  console.log(JSON.stringify(out));
  await page.close();
}
await b.close();

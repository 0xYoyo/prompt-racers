import puppeteer from 'puppeteer-core';
const dist = process.env.MUT_DIST || '/Users/yoyopc/repos/kart-project/dist/index.html';
const b = await puppeteer.launch({ headless:'new', executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page = await b.newPage();
page.on('pageerror',e=>console.log('PAGEERROR',e.message));
await page.setViewport({width:1280,height:720});
await page.goto('file://'+dist,{waitUntil:'load'});
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready===true',{timeout:60000});

for (const track of [0,1,2]) {
  await page.evaluate(t=>window.__DEBUG.goto('race',{track:t,difficulty:1,autopilot:true,laps:3}), track);
  await new Promise(r=>setTimeout(r,400));
  const out = await page.evaluate(()=>{
    const V = window.__THREE__.Vector3;
    const s = window.__DEBUG.engine.active;
    const sp = s.track.spline, def = s.track.def, L = sp.length;
    // --- VISUAL anchors, measured off the real meshes -----------------------
    let chq=null, gan=null;
    s.track.group.traverse(o=>{ if(o.name==='startline') chq=o; if(o.name==='gantry') gan=o; });
    const wcen = o => { if(!o) return null;
      if (o.geometry){ o.geometry.computeBoundingBox(); const c=o.geometry.boundingBox.getCenter(new V()); return o.localToWorld(c); }
      return o.getWorldPosition(new V()); };
    const chqC = wcen(chq), ganC = wcen(gan);
    const chqT = chqC ? sp.closestT(chqC).t : null;
    const ganT = ganC ? sp.closestT(ganC).t : null;
    // chequer band extent along the track, from its own vertices
    let bandMin=1e9, bandMax=-1e9;
    if (chq){ const pos=chq.geometry.attributes.position; const v=new V();
      for(let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i); chq.localToWorld(v);
        const d=sp.closestT(v).t; let dd=d-chqT; if(dd>0.5)dd-=1; if(dd<-0.5)dd+=1;
        bandMin=Math.min(bandMin,dd*L); bandMax=Math.max(bandMax,dd*L);} }
    // --- TRIGGER: drive and record where the lap actually ticks -------------
    const F=1/60; const laps=[]; let prevLap=s.state.lap; let guard=0;
    const eng = window.__DEBUG.engine;
    while (laps.length<3 && guard++ < 60*400){
      if (s.quiz && s.quiz.phase!=='idle') s.quiz.close();
      eng.time+=F; s.update(F);
      if (s.state.lap!==prevLap){ prevLap=s.state.lap;
        const p=s.player.position; laps.push({t:sp.closestT(p).t, x:p.x, z:p.z, spd:s.player.speed}); }
    }
    const dT=(a,bb)=>{ let d=a-bb; while(d>0.5)d-=1; while(d<-0.5)d+=1; return d; };
    return { id:def.id||def.nameHe, L, startT:def.startT, chqT, ganT,
      chqOffsetFromStartT_m: chqT==null?null:dT(chqT,def.startT)*L,
      ganOffsetFromStartT_m: ganT==null?null:dT(ganT,def.startT)*L,
      bandMin, bandMax,
      lapErrs_vs_chequer_m: laps.map(l=>dT(l.t, chqT)*L),
      lapErrs_vs_startT_m: laps.map(l=>dT(l.t, def.startT)*L),
      speeds: laps.map(l=>l.spd) };
  });
  console.log(JSON.stringify(out,null,1));
}
await b.close();

import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage(); await p.setViewport({width:800,height:600});
await p.goto('file:///Users/yoyopc/repos/kart-project/dist/index.html',{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG && window.__DEBUG.ready===true',{timeout:60000});
for (const tr of [0,1,2]) {
  await p.evaluate(t=>window.__DEBUG.goto('race',{track:t,difficulty:1,autopilot:true}),tr);
  await new Promise(r=>setTimeout(r,300));
  const o = await p.evaluate(()=>{
    const s=window.__DEBUG.engine.active, sp=s.track.spline, def=s.track.def, L=sp.length;
    const B=6, rows=[];
    for(let i=0;i<B;i++){
      const bt=(((def.startT+(i+0.62)/B)%1)+1)%1;
      // curvature over the 40m AFTER the beacon (2s at ~20m/s)
      let maxK=0; for(let d=0; d<=45; d+=3){ const t=((bt+d/L)%1+1)%1; maxK=Math.max(maxK,Math.abs(sp.curvatureAt(t))); }
      rows.push({beacon:i, kAtHit:+Math.abs(sp.curvatureAt(bt)).toFixed(4), maxK_next45m:+maxK.toFixed(4),
        width:+sp.widthAt(bt).toFixed(1)});
    }
    return {id:def.id, L:+L.toFixed(0), rows};
  });
  console.log(JSON.stringify(o));
}
await b.close();

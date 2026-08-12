import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
await p.setViewport({width:800,height:600});
await p.goto('file:///Users/yoyopc/repos/kart-project/dist/index.html',{waitUntil:'load'});
await p.evaluate(()=>localStorage.setItem('promptracers.v1',JSON.stringify({garageTokenIntroSeen:true})));
await p.reload({waitUntil:'load'});
await p.waitForFunction('window.__DEBUG && window.__DEBUG.ready===true',{timeout:60000});
for (const tr of [0,1,2]) {
  await p.evaluate(t=>window.__DEBUG.goto('race',{track:t,difficulty:1,autopilot:true,laps:9}),tr);
  await new Promise(r=>setTimeout(r,300));
  const o = await p.evaluate(()=>{
    const V=window.__THREE__.Vector3;
    const s=window.__DEBUG.engine.active, sp=s.track.spline, def=s.track.def;
    const eng=window.__DEBUG.engine, F=1/60, hits=[];
    for(let i=0;i<60*400 && hits.length<6;i++){
      if(s.quiz.phase!=='idle'){
        // the frame a real beacon opened a panel: how much runway does a child get
        // if they resume at this speed and do NOT steer?
        const pos=s.player.position, yaw=s.player.yaw;
        const fx=Math.sin(yaw), fz=Math.cos(yaw);
        let grace=null;
        const v=new V();
        for(let d=0.5; d<=140; d+=0.5){
          v.set(pos.x+fx*d, pos.y, pos.z+fz*d);
          const c=sp.closestT(v);
          const half=sp.widthAt(c.t);
          const off=Math.abs(c.dist!=null?c.dist:0);
          const rp=sp.offsetPoint(c.t,0);
          const lat=Math.hypot(v.x-rp.x, v.z-rp.z);
          if(lat>half){ grace=d; break; }
        }
        hits.push({spd:+s.player.speed.toFixed(1), runway_m:grace,
          grace_s: grace==null?null:+(grace/Math.max(1,s.player.speed)).toFixed(2)});
        s.quiz.close();
      }
      eng.time+=F; s.update(F);
    }
    return {id:def.id, hits};
  });
  console.log(JSON.stringify(o));
}
await b.close();

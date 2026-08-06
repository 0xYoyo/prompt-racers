import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
const root=process.cwd();
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
 args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const p=await b.newPage(); await p.setViewport({width:1280,height:720});
await p.goto('file://'+resolve(root,'dist/index.html'),{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
const r = await p.evaluate(async () => {
  const a = window.__AUDIO__, ctx = a.ctx||a.context||a._ctx;
  const out = {};
  out.initCalled = !!a.ready;
  out.ctxState = ctx?.state ?? null;
  // measure via bus events only (the real game path)
  const an = ctx.createAnalyser(); an.fftSize=2048;
  try { a.master.connect(an); } catch {}
  const buf = new Float32Array(an.fftSize);
  const measure = async (ms=500) => {
    let acc=0,n=0,mx=0;
    const t0=performance.now();
    while(performance.now()-t0<ms){ an.getFloatTimeDomainData(buf);
      for(let i=0;i<buf.length;i++){acc+=buf[i]*buf[i];mx=Math.max(mx,Math.abs(buf[i]));} n+=buf.length;
      await new Promise(r=>setTimeout(r,20)); }
    return {rms:Math.sqrt(acc/n), peak:mx};
  };
  out.silentBaseline = await measure(300);
  // 1) via the BUS, exactly as race.js does
  const bus = window.__DEBUG.engine && window.__BUS__;
  out.busExposed = !!bus;
  if (bus) { for(let i=0;i<20;i++){ bus.emit('kart:engine',{rpm01:0.8,load:1,boosting:false,surface:'asphalt'}); await new Promise(r=>setTimeout(r,20)); } }
  out.viaBus = bus ? await measure(500) : null;
  // 2) direct API
  for(let i=0;i<20;i++){ a.setEngineState?.({rpm01:0.8,load:1,boosting:false,surface:'asphalt'}); await new Promise(r=>setTimeout(r,20)); }
  out.viaDirect = await measure(500);
  out.listeners = Object.keys(a).filter(k=>/listen|wired|bound/i.test(k));
  return out;
});
console.log(JSON.stringify(r,null,1));
await b.close();

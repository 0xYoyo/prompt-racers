import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars','--mute-audio']});
const p=await b.newPage(); p.on('pageerror',e=>console.log('PAGEERROR',e.message));
await p.setViewport({width:1440,height:900});
await p.goto('file:///Users/yoyopc/repos/kart-project/.tmp/critic/probe.html',{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true',{timeout:60000});
const w=ms=>new Promise(r=>setTimeout(r,ms));
await w(600);
const sig=()=>p.evaluate(()=>{const k=window.__KART;let m=0,tris=0;k.group.traverse(o=>{if(o.isMesh){m++;const g=o.geometry;tris+=g.index?g.index.count/3:(g.attributes.position.count/3);}});return m+'m/'+Math.round(tris)+'t';});
const shot=async n=>{await p.screenshot({path:'/Users/yoyopc/repos/kart-project/shots/critic-garage/k3-'+n+'.png',clip:{x:26,y:205,width:372,height:235}});};
// drive kartmodel DIRECTLY, same page, no layout change at all
for (const [name,parts] of [['engine0',{engine:0,exhaust:0}],['engine3',{engine:3,exhaust:3}],['engine0b',{engine:0,exhaust:0}],['wing0',{wing:0}],['wing3',{wing:3}],['tires0',{tires:0}],['tires3',{tires:3}],['chassis0',{chassis:0}],['chassis3',{chassis:3}],['all3',{engine:3,exhaust:3,wing:3,tires:3,chassis:3}]]){
  await p.evaluate(o=>window.__KART.setParts(o),parts); await w(400);
  console.log(name.padEnd(10), await sig()); await shot(name);
}
await b.close();

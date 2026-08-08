import puppeteer from 'puppeteer-core';
const dist='/Users/yoyopc/repos/kart-project/dist/index.html';
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars']});
const SIZES=[[1920,1080],[1600,900],[1440,900]];
const p=await b.newPage();
p.on('console',m=>console.log('  page>',m.text()));
await p.goto('file://'+dist,{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
await p.evaluate(()=>window.__DEBUG.goto('select',{}));
await p.evaluate(()=>{
  window.__log=[];
  addEventListener('resize',()=>{console.log('resize evt iw='+innerWidth+' elw='+document.querySelector('#app').clientWidth);});
  let n=0; const tick=()=>{n++; if(n<5) requestAnimationFrame(tick); else console.log('rAF alive');};
  requestAnimationFrame(tick);
});
for (const [w,h] of SIZES) {
  console.log('--- setViewport',w,h);
  await p.setViewport({width:w,height:h,deviceScaleFactor:1});
  await new Promise(r=>setTimeout(r,450));
  const r=await p.evaluate(()=>({inline:document.querySelector('.mn-grid').style.gridTemplateColumns,iw:innerWidth,ew:window.__DEBUG.engine.width, elw:document.querySelector('#app').clientWidth}));
  console.log(`${w}x${h}`,JSON.stringify(r));
}
await b.close();

import puppeteer from 'puppeteer-core';
const dist='/Users/yoyopc/repos/kart-project/dist/index.html';
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars']});
const p=await b.newPage();
await p.setViewport({width:1366,height:768});
await p.goto('file://'+dist,{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
await p.evaluate(()=>window.__DEBUG.goto('select',{}));
await new Promise(r=>setTimeout(r,800));
console.log(await p.evaluate(()=>{
  const back=document.querySelector('.mn-back'),head=document.querySelector('.mn-head');
  const r=back.getBoundingClientRect();
  const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  return {backRect:[r.left,r.top,r.width,r.height],headOpacity:getComputedStyle(head).opacity,
    headRect:JSON.stringify(head.getBoundingClientRect()),
    hit:hit.className, backZ:getComputedStyle(back).zIndex, backPos:getComputedStyle(back).position};
}));
// real click test
await p.mouse.click(60, 40);
await new Promise(r=>setTimeout(r,700));
console.log('scene after clicking back centre:', await p.evaluate(()=>window.__DEBUG.engine.activeName));
await b.close();

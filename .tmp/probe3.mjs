import puppeteer from 'puppeteer-core';
const dist='/Users/yoyopc/repos/kart-project/dist/index.html';
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars']});
const SIZES=[[1920,1080],[1600,900],[1440,900],[1366,768],[1280,720],[1024,640]];
const p=await b.newPage();
await p.goto('file://'+dist,{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
await p.evaluate(()=>window.__DEBUG.goto('select',{}));
for (const [w,h] of SIZES) {
  await p.setViewport({width:w,height:h,deviceScaleFactor:1});
  await new Promise(r=>setTimeout(r,450));
  const r=await p.evaluate(vh=>{
    const g=(s)=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {t:Math.round(b.top),b:Math.round(b.bottom),h:Math.round(b.height)};};
    const st=document.querySelector('.mn-stage');
    const grid=document.querySelector('.mn-grid');
    return {over:st.scrollHeight-st.clientHeight,
      cols:getComputedStyle(grid).gridTemplateColumns,
      inline:grid.style.gridTemplateColumns,
      head:g('.mn-headrow'),grid:g('.mn-grid'),card:g('.mn-card'),view:g('.mn-view'),
      go:g('.mn-go'),btn:g('.mn-start'),keys:g('.mn-keys'),stage:g('.mn-stage'),iw:innerWidth,vh};
  },h);
  console.log(`${w}x${h}`,'over',r.over,'btn',JSON.stringify(r.btn),'stage',JSON.stringify(r.stage),'grid',r.grid.h,'card',r.card.h,'view',r.view.h,'keys',JSON.stringify(r.keys),'inlineCols',r.inline,'iw',r.iw);
}
await b.close();

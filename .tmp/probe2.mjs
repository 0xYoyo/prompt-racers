import puppeteer from 'puppeteer-core';
const dist='/Users/yoyopc/repos/kart-project/dist/index.html';
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars']});
const SIZES=[[1920,1080],[1600,900],[1440,900],[1366,768],[1280,720],[1024,640]];
for (const lang of ['he','en']) {
for (const [w,h] of SIZES) {
  const p=await b.newPage();
  await p.setViewport({width:w,height:h});
  await p.goto('file://'+dist,{waitUntil:'load'});
  await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
  await p.evaluate((l)=>window.__DEBUG.goto('select',{lang:l}),lang);
  await new Promise(r=>setTimeout(r,600));
  const r=await p.evaluate(vh=>{
    const g=(s)=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {t:Math.round(b.top),b:Math.round(b.bottom),h:Math.round(b.height)};};
    const st=document.querySelector('.mn-stage');
    const cs=getComputedStyle(st);
    const grid=document.querySelector('.mn-grid');
    return {over:st.scrollHeight-st.clientHeight, stagePad:cs.padding, gap:cs.gap,
      cols:getComputedStyle(grid).gridTemplateColumns,
      gridGap:getComputedStyle(grid).gap,
      head:g('.mn-headrow'),grid:g('.mn-grid'),card:g('.mn-card'),view:g('.mn-view'),body:g('.mn-body'),
      go:g('.mn-go'),btn:g('.mn-start'),keys:g('.mn-keys'),vh};
  },h);
  console.log(lang,`${w}x${h}`,'over',r.over,'btnBottom',r.btn.b,'(vh',h+')','head',r.head.h,'grid',r.grid.h,'card',r.card.h,'view',r.view.h,'body',r.body.h,'go',r.go.h,'keys',r.keys.h,'cols',r.cols,'gap',r.gridGap,'stagepad',r.stagePad);
  await p.close();
}}
await b.close();

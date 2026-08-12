import puppeteer from 'puppeteer-core';
const dist='/Users/yoyopc/repos/kart-project/dist/index.html';
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-device-scale-factor=1','--hide-scrollbars']});
const p=await b.newPage();
await p.goto('file://'+dist,{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
for (const lang of ['he','en']) {
for (const [w,h] of [[1920,1080],[1600,900],[1440,900],[1366,768],[1280,720],[1024,640]]) {
  await p.setViewport({width:w,height:h});
  await p.evaluate((l)=>window.__DEBUG.goto('select',{lang:l}),lang);
  await new Promise(r=>setTimeout(r,450));
  const r=await p.evaluate(vh=>{
    const g=(s)=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {t:Math.round(b.top),b:Math.round(b.bottom),h:Math.round(b.height)};};
    const st=document.querySelector('.mn-stage');
    return {keys:g('.mn-keys'),go:g('.mn-start'),view:g('.mn-view'),grid:g('.mn-grid'),
      scrollH:st.scrollHeight, clientH:st.clientHeight, over:st.scrollHeight-st.clientHeight, vh};
  },h);
  console.log(lang,`${w}x${h}`,'overflow:',r.over,'keys',JSON.stringify(r.keys),'btn',JSON.stringify(r.go),'view h',r.view.h);
}}
await b.close();

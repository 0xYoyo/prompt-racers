import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const p = await b.newPage(); await p.setViewport({width:1366,height:768});
await p.goto('file:///Users/yoyopc/repos/kart-project/dist/index.html',{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
await p.evaluate(()=>{localStorage.setItem('promptracers.v1',JSON.stringify({}));});
await p.reload({waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
await p.evaluate(()=>window.__DEBUG.goto('race',{track:0}));
await p.keyboard.down('ArrowUp');
// flowtest's playerBeat, verbatim in spirit: click the one-time scrim's button
const beat = () => p.evaluate(()=>{
  const visible = el => el && el.offsetParent !== null && +getComputedStyle(el).opacity > 0.05;
  for (const sel of ['.grgtok-scrim','.grg-meet-scrim','[data-onetime]']) {
    const scrim = document.querySelector(sel);
    if (visible(scrim)) { const bt = scrim.querySelector('button');
      if (bt) { bt.click(); return 'clicked:'+sel+' ['+bt.textContent.trim()+']'; }
      if (typeof scrim.close==='function'){scrim.close();return 'close:'+sel;} return 'stuck:'+sel; }
  }
  return '';
});
for (let i=0;i<40;i++) {
  await p.evaluate(()=>window.__DEBUG.advance(6));
  const r = await beat();
  if (r) console.log(i, r);
  const st = await p.evaluate(()=>({scene:window.__DEBUG.engine.activeName, t:+(window.__DEBUG.engine.active.state?.raceTime||0).toFixed(1),
     tok: !!(document.querySelector('.grgtok-scrim')?.offsetParent)}));
  if (i%8===0) console.log('   ', i, JSON.stringify(st));
  if (st.scene!=='race') { console.log('LEFT RACE at', i, JSON.stringify(st)); break; }
}
await b.close(); process.exit(0);

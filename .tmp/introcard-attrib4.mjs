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
const beat = () => p.evaluate(()=>{
  const visible = el => el && el.offsetParent !== null && +getComputedStyle(el).opacity > 0.05;
  for (const sel of ['.grgtok-scrim','.grg-meet-scrim','[data-onetime]']) {
    const scrim = document.querySelector(sel);
    if (visible(scrim)) { const bt = scrim.querySelector('button'); if (bt) { bt.click(); return 'clicked:'+sel; } }
  }
  return '';
});
for (let i=0;i<30;i++) {
  await p.evaluate(()=>window.__DEBUG.advance(6));
  await beat();
  if (i>=14) {
    const st = await p.evaluate(()=>{
      const vis=el=>!!(el&&el.offsetParent!==null&&+getComputedStyle(el).opacity>0.05);
      const s=window.__DEBUG.engine.active;
      return {t:+(s.state?.raceTime||0).toFixed(1), quizPhase:s.quiz?.phase, quizFrozen:s.quiz?.frozen,
        qzint:vis(document.querySelector('.qzint-scrim')), quizShow:vis(document.querySelector('.quiz-root.show')),
        ic:document.querySelectorAll('.ic-card').length,
        panels:[...document.querySelectorAll('#ui > *')].filter(e=>vis(e)).map(e=>e.className).slice(0,6)};
    });
    console.log(i, JSON.stringify(st));
    if (i>16) break;
  }
}
await b.close(); process.exit(0);

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
for (let i=0;i<60;i++) {
  await p.evaluate(()=>window.__DEBUG.advance(6));
  const st = await p.evaluate(()=>{
    const s=window.__DEBUG.engine.active;
    const vis=el=>el&&el.offsetParent!==null&&+getComputedStyle(el).opacity>0.05;
    return {scene:window.__DEBUG.engine.activeName, phase:s.state?.phase, t:+(s.state?.raceTime||0).toFixed(1), lap:s.state?.lap,
      quiz:s.quiz?.phase, ic:document.querySelectorAll('.ic-card').length,
      qzint:!!vis(document.querySelector('.qzint-scrim')), tok:!!vis(document.querySelector('.grgtok-scrim')),
      quizShow:!!vis(document.querySelector('.quiz-root.show'))};
  });
  if (i%6===0) console.log(i, JSON.stringify(st));
  if (st.scene!=='race') { console.log('LEFT RACE at beat',i,JSON.stringify(st)); break; }
  if (i===59) console.log('STUCK', JSON.stringify(st));
}
await b.close(); process.exit(0);

import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const p = await b.newPage(); await p.setViewport({width:1366,height:768});
await p.goto('file:///Users/yoyopc/repos/kart-project/dist/index.html',{waitUntil:'load'});
await p.waitForFunction('window.__DEBUG&&window.__DEBUG.ready===true');
// click through like flowtest's playability slice
const click = re => p.evaluate(r=>{const b=[...document.querySelectorAll('button')].find(x=>new RegExp(r).test(x.textContent)); if(b){b.click();return b.textContent.trim();} return null;}, re);
console.log('start:', await click('אליפות|Championship|מתחילים'));
await new Promise(r=>setTimeout(r,1200));
console.log('race:', await click('צא|מתחילים|יוצאים|Start|מרוץ'));
await new Promise(r=>setTimeout(r,1500));
for (let i=0;i<70;i++) {
  await p.evaluate(()=>window.__DEBUG.advance(6));
  const st = await p.evaluate(()=>{
    const s=window.__DEBUG.engine.active;
    const vis=el=>el&&el.offsetParent!==null&&+getComputedStyle(el).opacity>0.05;
    return {scene:window.__DEBUG.engine.activeName, phase:s.state?.phase, t:+(s.state?.raceTime||0).toFixed(1), lap:s.state?.lap,
      quiz:s.quiz?.phase, ic:document.querySelectorAll('.ic-card').length,
      qzint:vis(document.querySelector('.qzint-scrim')), quizShow:vis(document.querySelector('.quiz-root.show'))};
  });
  if (i%10===0 || st.scene!=='race') console.log(i, JSON.stringify(st));
  if (st.scene!=='race') break;
}
console.log('FINAL', await p.evaluate(()=>window.__DEBUG.engine.activeName));
await b.close(); process.exit(0);

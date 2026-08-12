import puppeteer from 'puppeteer-core';
const dist = '/Users/yoyopc/repos/kart-project/dist/index.html';
const b = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1366, height: 768 });
const wait = ms => new Promise(r=>setTimeout(r,ms));
await page.goto('file://' + dist, { waitUntil: 'load' });
await page.evaluate(()=>localStorage.setItem('promptracers.v1', JSON.stringify({garageTokenIntroSeen:true, quizBoxIntroSeen:true})));
await page.reload({ waitUntil: 'load' });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
await page.evaluate(()=>window.__DEBUG.goto('race',{track:0,difficulty:1,autopilot:true}));
await wait(300);
await page.evaluate(()=>window.__DEBUG.advance(6));
await page.evaluate(()=>window.__DEBUG.engine.active.quiz.openQuestion());
await wait(100);
const optBox = await page.evaluate(()=>{ const el=document.querySelector('.quiz-root.show .quiz-opt'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
await page.mouse.click(optBox.x, optBox.y);
await wait(120);
console.log('answered:', await page.evaluate(()=>!!document.querySelector('.quiz-root.show .quiz-card.quiz-answered')));
await page.evaluate(()=>window.__DEBUG.advance(1));
const info = await page.evaluate(()=>{
  const el=document.querySelector('.quiz-root.show .quiz-cont');
  if(!el) return {found:false};
  const r=el.getBoundingClientRect();
  const cx=r.x+r.width/2, cy=r.y+r.height/2;
  const top=document.elementFromPoint(cx,cy);
  return { found:true, rect:{x:r.x,y:r.y,w:r.width,h:r.height}, cs:getComputedStyle(el).display,
           pe:getComputedStyle(el).pointerEvents, cls:el.className,
           top: top ? top.className+'/'+top.tagName : null,
           phaseT: null, phase: window.__DEBUG.engine.active.quiz.phase };
});
console.log(info);
if (info.found) {
  await page.mouse.click(info.rect.x+info.rect.w/2, info.rect.y+info.rect.h/2);
  await wait(150);
  console.log('after click phase:', await page.evaluate(()=>window.__DEBUG.engine.active.quiz.phase));
}
// pause overlay lingering?
await b.close();

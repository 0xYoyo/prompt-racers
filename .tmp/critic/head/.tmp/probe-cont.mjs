import puppeteer from 'puppeteer-core';
const dist = '/Users/yoyopc/repos/kart-project/dist/index.html';
const b = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
const wait = ms => new Promise(r=>setTimeout(r,ms));
const evalp = (fn,...a) => page.evaluate(fn,...a);
const boxOf = async (sel, i=0) => page.evaluate((s,ix)=>{
  const el=[...document.querySelectorAll(s)][ix];
  if(!el) return null;
  const r=el.getBoundingClientRect();
  if(!r.width||!r.height) return null;
  return {x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height};
}, sel, i);

async function run(via) {
  await page.setViewport({ width:1366, height:768, hasTouch: via==='touch' });
  await page.goto('file://' + dist, { waitUntil: 'load' });
  await page.evaluate(()=>localStorage.setItem('promptracers.v1', JSON.stringify({garageTokenIntroSeen:true, quizBoxIntroSeen:true})));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  await page.evaluate(()=>window.__DEBUG.goto('race',{track:0,difficulty:1,autopilot:true}));
  await wait(300);
  await evalp(()=>window.__DEBUG.advance(6));
  await evalp(()=>window.__DEBUG.engine.active.quiz.openQuestion());
  await wait(80);
  const box = await boxOf('.quiz-root.show .quiz-opt', 2);
  if (via==='key') await page.keyboard.press('Digit3');
  else if (via==='click') await page.mouse.click(box.x, box.y);
  else await page.touchscreen.tap(box.x, box.y);
  await wait(100);
  console.log(via, 'answered:', await evalp(()=>!!document.querySelector('.quiz-root.show .quiz-card.quiz-answered')));
  await evalp(()=>window.__DEBUG.advance(1));
  const cont = await boxOf('.quiz-root.show .quiz-cont');
  console.log(via, 'cont box:', cont, 'top:', cont && await evalp(p=>{const e=document.elementFromPoint(p.x,p.y); return e? e.className+'/'+e.tagName : null;}, cont));
  if (via==='key') await page.keyboard.press('Space');
  else if (via==='click') await page.mouse.click(cont.x, cont.y);
  else await page.touchscreen.tap(cont.x, cont.y);
  await wait(120);
  console.log(via, 'phase:', await evalp(()=>window.__DEBUG.engine.active.quiz.phase),
    'via:', await evalp(()=>window.__DEBUG.engine.active.quiz.lastVia));
}
await run('key');
await run('click');
await run('touch');
await b.close();

// Cross-check: does modaltest §4's PROGRAMMATIC click still catch a pointer path
// that skips the modal registry? (§9's real-mouse click cannot — with the pause
// menu up, .mn-ov swallows the click by geometry, which is the whole reason §4's
// element.click() exists alongside it.)
import puppeteer from 'puppeteer-core';
const page_url = 'file://' + (process.argv[2] || '/Users/yoyopc/repos/kart-project/dist/index.html');
const b = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
await page.setViewport({ width: 1366, height: 768 });
await page.goto(page_url, { waitUntil: 'load' });
await page.evaluate(()=>localStorage.setItem('promptracers.v1', JSON.stringify({garageTokenIntroSeen:true, quizBoxIntroSeen:true})));
await page.reload({ waitUntil: 'load' });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 120000 });
await page.evaluate(()=>window.__DEBUG.goto('race',{track:0,difficulty:1,autopilot:true}));
await wait(300);
await page.evaluate(()=>window.__DEBUG.advance(6));
await page.evaluate(()=>window.__DEBUG.engine.active.quiz.openQuestion());
await wait(100);
await page.keyboard.press('Escape'); await wait(250);
console.log('pause up:', await page.evaluate(()=>!!document.querySelector('.mn-dialog.pause')));
await page.evaluate(()=>{ document.querySelector('.quiz-root.show .quiz-opt')?.click(); }); await wait(150);
console.log('answered behind pause (must be false):',
  await page.evaluate(()=>!!document.querySelector('.quiz-root.show .quiz-card.quiz-answered')));
await b.close();

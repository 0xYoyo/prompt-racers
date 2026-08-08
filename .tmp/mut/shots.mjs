import puppeteer from 'puppeteer-core';
const dist='/Users/yoyopc/repos/kart-project/dist/index.html';
const out='/Users/yoyopc/repos/kart-project/shots/critic-w3';
const b=await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
for (const lang of ['he','en']) {
  const page=await b.newPage();
  page.on('pageerror',e=>console.log('PAGEERROR',e.message));
  await page.setViewport({width:1366,height:768});
  await page.goto('file://'+dist,{waitUntil:'load'});
  await page.evaluate(l=>localStorage.setItem('promptracers.v1',JSON.stringify({garageTokenIntroSeen:true,lang:l})),lang);
  await page.reload({waitUntil:'load'});
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready===true',{timeout:60000});
  await page.evaluate(l=>window.__DEBUG.goto('race',{track:0,difficulty:1,autopilot:true,lang:l}),lang);
  await page.evaluate(()=>window.__DEBUG.advance(8));
  const shot=async n=>{ await page.evaluate(()=>window.__DEBUG.renderOnce()); await wait(250);
    await page.screenshot({path:`${out}/${lang}-${n}.png`}); console.log('shot',lang,n); };
  const key=(c,k)=>page.evaluate((cc,kk)=>dispatchEvent(new KeyboardEvent('keydown',{code:cc,key:kk,bubbles:true})),c,k);
  const keyUp=(c,k)=>page.evaluate((cc,kk)=>dispatchEvent(new KeyboardEvent('keyup',{code:cc,key:kk,bubbles:true})),c,k);
  const tap=async(c,k)=>{await key(c,k);await keyUp(c,k);};

  // 1. question
  await page.evaluate(()=>window.__DEBUG.engine.active.quiz.openQuestion());
  await page.evaluate(()=>window.__DEBUG.advance(6));   // drain the timer bar a bit
  await shot('1-question');
  // 2. correct feedback: find the correct slot without answering
  const good = await page.evaluate(()=>{
    const q=window.__DEBUG.engine.active.quiz; q.close(); q.openQuestion();
    // brute force: answer slot 0, check, retry with a new question until correct
    for(let i=0;i<25;i++){ const els=[...document.querySelectorAll('.quiz-root.show .quiz-opt')];
      els[0].click();
      if (q.lastResult && q.lastResult.correct) return true;
      q.close(); q.openQuestion(); }
    return false; });
  await page.evaluate(()=>window.__DEBUG.advance(1));
  await shot('2-correct');
  console.log('correct found', good);
  // 4. countdown (dismiss from the correct feedback)
  await tap('Space',' '); await page.evaluate(()=>window.__DEBUG.advance(0.4));
  await shot('4-countdown');
  await page.evaluate(()=>window.__DEBUG.advance(4));
  // 3. wrong feedback
  const bad = await page.evaluate(()=>{
    const q=window.__DEBUG.engine.active.quiz; q.close(); q.openQuestion();
    for(let i=0;i<25;i++){ const els=[...document.querySelectorAll('.quiz-root.show .quiz-opt')];
      els[0].click();
      if (q.lastResult && !q.lastResult.correct) return true;
      q.close(); q.openQuestion(); }
    return false; });
  await page.evaluate(()=>window.__DEBUG.advance(1));
  await shot('3-wrong');
  console.log('wrong found', bad);
  // 5. timeout state
  await page.evaluate(()=>{const q=window.__DEBUG.engine.active.quiz;q.close();q.openQuestion();});
  await page.evaluate(()=>window.__DEBUG.advance(22));
  await shot('5-timeout');
  // 6. pause over quiz
  await page.evaluate(()=>{const q=window.__DEBUG.engine.active.quiz;q.close();q.openQuestion();});
  await key('Escape','Escape'); await wait(300);
  await shot('6-pause-over-quiz');
  await page.close();
}
await b.close();

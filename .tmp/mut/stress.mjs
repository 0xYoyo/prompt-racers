import puppeteer from 'puppeteer-core';
const dist='/Users/yoyopc/repos/kart-project/dist/index.html';
const b=await puppeteer.launch({headless:'new',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page=await b.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.setViewport({width:1366,height:768});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const key=(c,k,extra={})=>page.evaluate((cc,kk,x)=>dispatchEvent(new KeyboardEvent('keydown',{code:cc,key:kk,bubbles:true,...x})),c,k,extra);
const keyUp=(c,k)=>page.evaluate((cc,kk)=>dispatchEvent(new KeyboardEvent('keyup',{code:cc,key:kk,bubbles:true})),c,k);
const tap=async(c,k)=>{await key(c,k);await keyUp(c,k);};
const ev=(f,...a)=>page.evaluate(f,...a);
async function boot(o={}){
  await page.goto('file://'+dist,{waitUntil:'load'});
  await ev(()=>localStorage.setItem('promptracers.v1',JSON.stringify({garageTokenIntroSeen:true})));
  await page.reload({waitUntil:'load'});
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready===true',{timeout:60000});
  await ev(oo=>window.__DEBUG.goto('race',{track:0,difficulty:1,...oo}),o);
  await wait(300);
}
const snap=()=>ev(()=>{const s=window.__DEBUG.engine.active;return{
  scene:window.__DEBUG.engine.activeName, phase:s.quiz?s.quiz.phase:'-', quizFrozen:s.state.quizFrozen,
  paused:s.state.paused, inputEnabled:s.input?s.input.enabled:null, finished:s.state.finished,
  raceTime:+s.state.raceTime.toFixed(2), lap:s.state.lap,
  panelUp:[...document.querySelectorAll('.quiz-root')].some(e=>e.classList.contains('show')),
  pauseUp:!!document.querySelector('.mn-dialog.pause'),
  anyOverlay:document.querySelectorAll('.mn-ov').length,
  down:s.input?[...s.input.down]:null };});
const moved=async(sec)=>{const a=await ev(()=>{const p=window.__DEBUG.engine.active.player;return[p.position.x,p.position.z,window.__DEBUG.engine.active.state.raceTime];});
  await ev(s=>window.__DEBUG.advance(s),sec);
  const c=await ev(()=>{const p=window.__DEBUG.engine.active.player;return[p.position.x,p.position.z,window.__DEBUG.engine.active.state.raceTime];});
  return {m:+Math.hypot(c[0]-a[0],c[1]-a[1]).toFixed(3), t:+(c[2]-a[2]).toFixed(3)};};
const R=(n,o)=>console.log('  ['+n+'] '+JSON.stringify(o));

console.log('\n== S1: quiz open at the moment of the finish ==');
await boot({autopilot:true,laps:1});
await ev(()=>window.__DEBUG.advance(4));
// drive until the last few metres before the line, then open a quiz
await ev(()=>{const s=window.__DEBUG.engine.active;const sp=s.track.spline;
  for(let i=0;i<60*200 && !s.state.finished;i++){
    if(s.quiz.phase!=='idle') s.quiz.close();
    const t=sp.closestT(s.player.position).t; const d=((s.track.def.startT-t)%1+1)%1;
    if(s.state.lap>=1 && d*sp.length < 12) break;
    window.__DEBUG.engine.time+=1/60; s.update(1/60);} });
R('just before the line', await snap());
await ev(()=>window.__DEBUG.engine.active.quiz.openQuestion());
R('quiz forced open near line', await snap());
R('advance 20s frozen', await moved(20));
R('state', await snap());
await tap('Digit1','1'); await wait(60); await ev(()=>window.__DEBUG.advance(1));
await tap('Space',' '); await wait(60); await ev(()=>window.__DEBUG.advance(3));
R('after dismiss+countdown', await snap());
await ev(()=>window.__DEBUG.advance(6));
R('after crossing the line', await snap());

console.log('\n== S2: quiz forced open during the START countdown ==');
await boot({autopilot:true});
await ev(()=>window.__DEBUG.engine.active.quiz.openQuestion());
R('opened during countdown', await snap());
await ev(()=>window.__DEBUG.advance(1));
R('one frame later', await snap());
await ev(()=>window.__DEBUG.advance(8));
R('8s later', await snap());
R('is the world moving?', await moved(1));

console.log('\n== S3: hold Accelerate + Space through the whole sequence ==');
await boot({autopilot:false});
await ev(()=>window.__DEBUG.advance(4));
await key('ArrowUp','ArrowUp');          // held, never released
await key('Space',' ');                  // held drift, never released
await ev(()=>window.__DEBUG.advance(2));
R('before quiz', await snap());
await ev(()=>window.__DEBUG.engine.active.quiz.openQuestion());
await tap('Digit1','1'); await wait(60);
await ev(()=>window.__DEBUG.advance(2));
// simulate the OS auto-repeat a held Space produces
for(let i=0;i<10;i++){ await key('Space',' ',{repeat:true}); }
await ev(()=>window.__DEBUG.advance(2));
R('held Space (auto-repeat) does not dismiss', await snap());
// child releases and presses again
await keyUp('Space',' '); await key('Space',' ');
await wait(60); await ev(()=>window.__DEBUG.advance(0.1));
R('release+press dismisses', await snap());
await ev(()=>window.__DEBUG.advance(3));
R('after 3-2-1, still holding Space+Up', await snap());
R('is it driving?', await moved(2));
R('hop/drift on resume?', await ev(()=>{const p=window.__DEBUG.engine.active.player;return{airborne:p.airborne??null,drifting:p.drifting??null,speed:+p.speed.toFixed(1)};}));

console.log('\n== S4: pause -> settings -> escape, over a frozen quiz ==');
await boot({autopilot:true});
await ev(()=>window.__DEBUG.advance(6));
await ev(()=>window.__DEBUG.engine.active.quiz.openQuestion());
await key('Escape','Escape'); await wait(250);
R('pause up', await snap());
await ev(()=>{[...document.querySelectorAll('.mn-dialog.pause .btn')].find(b=>/הגדרות|Settings/.test(b.textContent))?.click();});
await wait(250); R('settings up', await snap());
await key('Escape','Escape'); await wait(250); R('esc 1', await snap());
await key('Escape','Escape'); await wait(250); R('esc 2', await snap());
R('world moving?', await moved(2));
await tap('Digit1','1'); await wait(80); await ev(()=>window.__DEBUG.advance(1));
await tap('Space',' '); await wait(80); await ev(()=>window.__DEBUG.advance(3));
R('recovered', await snap());
R('driving again?', await moved(1));

console.log('\n== S5: QUIT from the pause menu while a quiz is frozen ==');
await boot({autopilot:true});
await ev(()=>window.__DEBUG.advance(6));
await ev(()=>window.__DEBUG.engine.active.quiz.openQuestion());
await key('Escape','Escape'); await wait(250);
await ev(()=>{[...document.querySelectorAll('.mn-dialog.pause .btn')].find(b=>/יציאה|Quit/.test(b.textContent))?.click();});
await wait(200);
await ev(()=>{[...document.querySelectorAll('.mn-dialog.pause .btn')].find(b=>/כן|Yes/.test(b.textContent))?.click();});
await wait(800);
R('after quit', await ev(()=>({scene:window.__DEBUG.engine.activeName,
  quizRoots:document.querySelectorAll('.quiz-root').length,
  shown:[...document.querySelectorAll('.quiz-root')].filter(e=>e.classList.contains('show')).length})));
// back into a race: does the leftover modal id block the next quiz?
await ev(()=>window.__DEBUG.goto('race',{track:0,difficulty:1,autopilot:true}));
await wait(300); await ev(()=>window.__DEBUG.advance(6));
await ev(()=>window.__DEBUG.engine.active.quiz.openQuestion());
R('quiz still opens in the NEXT race', await snap());

console.log('\n== S6: the invisible frozen window (resume phase) ==');
await boot({autopilot:true});
await ev(()=>window.__DEBUG.advance(6));
await ev(()=>window.__DEBUG.engine.active.quiz.openQuestion());
await tap('Digit1','1'); await wait(60); await ev(()=>window.__DEBUG.advance(1));
await tap('Space',' '); await wait(60);
R('resume phase: what is on screen?', await ev(()=>({
  phase:window.__DEBUG.engine.active.quiz.phase,
  panelUp:[...document.querySelectorAll('.quiz-root')].some(e=>e.classList.contains('show')),
  countdownVisible: !!document.querySelector('.hud-count.on'),
  frozen: window.__DEBUG.engine.active.state.quizFrozen,
  inputEnabled: window.__DEBUG.engine.active.input.enabled })));
await key('Escape','Escape'); await wait(250);
R('Esc during the 3-2-1', await snap());
await ev(()=>window.__DEBUG.advance(6));
R('does the countdown progress behind pause?', await snap());
await key('Escape','Escape'); await wait(250);
await ev(()=>window.__DEBUG.advance(4));
R('after unpausing', await snap());
R('driving?', await moved(1));

console.log('\nPAGE ERRORS: '+(errs.length?errs.join(' | '):'none'));
await b.close();

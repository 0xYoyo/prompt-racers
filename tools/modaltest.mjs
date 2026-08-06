// Wave-2 smoothing pass: modal-collision regression checks against the real
// build. Three things can interrupt a race (token explainer, quiz panel, pause
// menu) and nothing used to coordinate them.
import puppeteer from 'puppeteer-core';
const dist = '/Users/yoyopc/repos/kart-project/dist/index.html';
const b = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(''+e.message));
await page.setViewport({ width: 1366, height: 768 });
let fails = 0;
const ok=(n,v,d='')=>{ if(!v) fails++; console.log(`  ${v?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${n.padEnd(54)} ${d}`); };
const key = (code,k)=>page.evaluate((c,kk)=>dispatchEvent(new KeyboardEvent('keydown',{code:c,key:kk,bubbles:true})),code,k);
const wait = ms => new Promise(r=>setTimeout(r,ms));
// Several .quiz-root nodes can exist at once (the menu backdrop mounts a
// disabled quiz system of its own), so always test ALL matches.
const vis = sel => page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>
  e.offsetParent!==null && getComputedStyle(e).visibility!=='hidden' && +getComputedStyle(e).opacity>0.05), sel);

async function boot(seen) {
  await page.goto('file://' + dist, { waitUntil: 'load' });
  await page.evaluate(v => { localStorage.setItem('promptracers.v1', JSON.stringify(v ? {garageTokenIntroSeen:true} : {})); }, seen);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  await page.evaluate(()=>window.__DEBUG.goto('race',{track:0,autopilot:true,difficulty:1}));
  await wait(300);
}
// drive until `sel` is visible; returns seconds of race driven
async function driveUntil(sel, maxS=140) {
  for (let s=0;s<maxS;s+=2) { await page.evaluate(()=>window.__DEBUG.advance(2)); if (await vis(sel)) return s; }
  return -1;
}

// ── 1. quiz + pause must not fight ───────────────────────────────────────
await boot(true);
ok('a quiz beacon opens a panel while driving', (await driveUntil('.quiz-root.show')) >= 0);
await key('Escape','Escape'); await wait(150);
ok('Escape over a live quiz opens the pause menu', await vis('.mn-dialog.pause'));
await key('Digit1','1'); await wait(150);
ok('1/2/3 do NOT answer the quiz behind the pause menu',
   !(await page.evaluate(()=>!!document.querySelector('.quiz-root.show .quiz-card.quiz-answered'))));
const frozen = await page.evaluate(()=>{ const w=document.querySelector('.quiz-root.show .quiz-timer > i').style.width;
  window.__DEBUG.advance(4); return [w, document.querySelector('.quiz-root.show .quiz-timer > i').style.width]; });
ok('the quiz countdown is frozen while paused', frozen[0] === frozen[1], frozen.join(' → '));
await key('Escape','Escape'); await wait(200);
ok('Escape closes the pause menu again', !(await vis('.mn-dialog.pause')));
ok('the quiz is still up and answerable', await vis('.quiz-root.show'));
await key('Digit1','1'); await wait(150);
ok('1/2/3 answer again once the pause menu is gone',
   await page.evaluate(()=>!!document.querySelector('.quiz-root.show .quiz-card.quiz-answered')));

// ── 2. the token explainer must never land on a live quiz ────────────────
await boot(false);
let stacked = 0, quizFrames = 0, tokenSeen = false;
for (let i=0;i<70;i++) {
  await page.evaluate(()=>window.__DEBUG.advance(2));
  const r = await page.evaluate(()=>({
    q: [...document.querySelectorAll('.quiz-root')].some(e=>getComputedStyle(e).visibility==='visible'),
    tok: document.querySelectorAll('.grgtok-scrim').length > 0 }));
  if (r.q) quizFrames++;
  if (r.tok) { tokenSeen = true; if (r.q) stacked++; await wait(400); break; }
}
ok('the token explainer fires during a race', tokenSeen);
ok('…and never on top of a live quiz', stacked === 0, `${quizFrames} quiz samples, ${stacked} stacked`);

// ── 3. Escape belongs to the token explainer, not to the pause menu ──────
ok('the token explainer is up', await vis('.grgtok-scrim'));
await key('Escape','Escape'); await wait(200);
ok('Escape closes the token explainer', !(await vis('.grgtok-scrim')));
ok('…and does not open the pause menu over it', !(await vis('.mn-dialog.pause')));
const ran = await page.evaluate(()=>{ const a=window.__DEBUG.engine.active, t0=a.state.raceTime;
  window.__DEBUG.advance(1); return a.state.raceTime-t0; });
ok('the race is running again afterwards', ran > 0.5, `+${ran.toFixed(2)}s`);

ok('no page errors', errs.length===0, errs[0]||'');
console.log(fails ? `\n  ${fails} FAILED` : '\n  all modal checks passed');
await b.close();
process.exit(fails?1:0);

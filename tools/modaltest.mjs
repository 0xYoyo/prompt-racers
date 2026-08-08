// Modal-collision regression checks against the real build.
//
// Four things can own the screen mid-race (token explainer, Boreg's intro, quiz
// panel, pause menu) and nothing used to coordinate them. The policy they now
// obey is written down in src/ui/style.js; this file is what pins it.
//
// Wave 3 added the quiz FREEZE (question → feedback-until-Space → 3·2·1 →
// resume, with zero fixed steps for the whole sequence) and this file is the
// gate on it: frozen means frozen, feedback waits, held keys survive, and the
// pause menu can still open on top without the quiz leaking keys or the race
// restarting underneath it.
//
// race.js exposes `quiz` on the scene API, so most of these open a question
// directly instead of driving an autopilot lap until a beacon happens to fire
// (which used to cost ~40s of simulated race per check).
import puppeteer from 'puppeteer-core';
const dist = '/Users/yoyopc/repos/kart-project/dist/index.html';
const b = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(''+e.message));
await page.setViewport({ width: 1366, height: 768 });
let fails = 0;
const ok=(n,v,d='')=>{ if(!v) fails++; console.log(`  ${v?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${n.padEnd(58)} ${d}`); };
const key = (code,k)=>page.evaluate((c,kk)=>dispatchEvent(new KeyboardEvent('keydown',{code:c,key:kk,bubbles:true})),code,k);
const keyUp = (code,k)=>page.evaluate((c,kk)=>dispatchEvent(new KeyboardEvent('keyup',{code:c,key:kk,bubbles:true})),code,k);
const tap = async (code,k)=>{ await key(code,k); await keyUp(code,k); };
const wait = ms => new Promise(r=>setTimeout(r,ms));
const evalp = (fn,...a) => page.evaluate(fn,...a);
// Several .quiz-root nodes can exist at once (the menu backdrop mounts a
// disabled quiz system of its own), so always test ALL matches. And measure
// CLASS membership, not computed style: CSS transitions never settle under the
// harness, which steps the sim without presenting frames.
const vis = sel => page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>
  e.offsetParent!==null && getComputedStyle(e).visibility!=='hidden' && +getComputedStyle(e).opacity>0.05), sel);
const has = sel => page.evaluate(s=>document.querySelectorAll(s).length>0, sel);

async function boot(seen, opts={}) {
  await page.goto('file://' + dist, { waitUntil: 'load' });
  await page.evaluate(v => { localStorage.setItem('promptracers.v1', JSON.stringify(v ? {garageTokenIntroSeen:true} : {})); }, seen);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  await page.evaluate(o=>window.__DEBUG.goto('race',{track:0,difficulty:1,...o}), opts);
  await wait(300);
}
// drive until `sel` is visible; returns seconds of race driven
async function driveUntil(sel, maxS=140) {
  for (let s=0;s<maxS;s+=2) { await page.evaluate(()=>window.__DEBUG.advance(2)); if (await vis(sel)) return s; }
  return -1;
}
// A snapshot of everything that must NOT move while the world is frozen.
const simSnap = () => evalp(()=>{ const s=window.__DEBUG.engine.active, p=s.player;
  return { raceTime:s.state.raceTime, lapTime:s.state.lapTime, clock:s.state.clock,
           x:p.position.x, z:p.position.z, speed:p.speed, progress:s.state.progress }; });
const simDelta = (a,bb) => ({
  race: bb.raceTime-a.raceTime, lap: bb.lapTime-a.lapTime,
  move: Math.hypot(bb.x-a.x, bb.z-a.z), prog: Math.abs(bb.progress-a.progress) });
const openQuiz = () => evalp(()=>{ window.__DEBUG.engine.active.quiz.openQuestion(); });
const quizPhase = () => evalp(()=>window.__DEBUG.engine.active.quiz.phase);

console.log('\n  MODAL / QUIZ-FREEZE POLICY\n  ' + '─'.repeat(74));

// ── 1. a quiz panel freezes the world outright ───────────────────────────
console.log('\n  1. the freeze');
await boot(true, { autopilot:true });
await evalp(()=>window.__DEBUG.advance(6));          // past the countdown, moving
const preMoving = simDelta(await simSnap(), (await evalp(()=>{window.__DEBUG.advance(1);}), await simSnap()));
ok('the race is running before the quiz', preMoving.race > 0.8 && preMoving.move > 1, `+${preMoving.race.toFixed(2)}s, ${preMoving.move.toFixed(1)}m`);

await openQuiz(); await wait(80);
ok('quiz.openQuestion() puts a panel on screen', await vis('.quiz-root.show'));
ok('the quiz reports itself frozen', await evalp(()=>window.__DEBUG.engine.active.quiz.frozen === true));
ok('the time scale handed to the race is exactly 0',
   await evalp(()=>{ window.__DEBUG.advance(1/60); return window.__DEBUG.engine.active.quiz.timeScale === 0; }));
{
  const a = await simSnap();
  await evalp(()=>window.__DEBUG.advance(4));
  const d = simDelta(a, await simSnap());
  ok('quiz open ⇒ ZERO sim steps advance', d.race === 0 && d.lap === 0 && d.move === 0 && d.prog === 0,
     `race +${d.race.toFixed(3)}s, lap +${d.lap.toFixed(3)}s, moved ${d.move.toFixed(3)}m`);
}
ok('input is gated off while frozen', await evalp(()=>window.__DEBUG.engine.active.input.enabled === false));

// ── 2. feedback waits for Space, then 3·2·1, then resume ────────────────
console.log('\n  2. feedback → Space → 3·2·1 → resume');
await tap('Digit1','1'); await wait(80);
ok('1/2/3 answers the question', await has('.quiz-root.show .quiz-card.quiz-answered'));
ok('…and an explanation is shown', await evalp(()=>{
  const w=[...document.querySelectorAll('.quiz-root.show .quiz-why')]; return w.some(e=>e.textContent.trim().length>10); }));
await evalp(()=>window.__DEBUG.advance(12));         // far past the old 3.4/4.6s auto-close
ok('the feedback is STILL up 12s later (no auto-close)', await has('.quiz-root.show .quiz-card.quiz-answered'));
{
  const a = await simSnap();
  await evalp(()=>window.__DEBUG.advance(3));
  const d = simDelta(a, await simSnap());
  ok('…and the world is still frozen behind it', d.race === 0 && d.move === 0);
}
await tap('Space',' '); await wait(80);
ok('Space dismisses the feedback', !(await has('.quiz-root.show')));
ok('…into the resume countdown, not straight back into the race',
   (await quizPhase()) === 'resume');
ok('…which shows the HUD 3·2·1 gantry', await vis('.hud-count.on'));
{
  const a = await simSnap();
  await evalp(()=>window.__DEBUG.advance(0.5));
  const d = simDelta(a, await simSnap());
  ok('the world is STILL frozen during the countdown', d.race === 0 && d.move === 0);
}
await evalp(()=>window.__DEBUG.advance(3));          // countdown is 3 × 0.72s
ok('the quiz is idle after the countdown', (await quizPhase()) === 'idle');
{
  const a = await simSnap();
  await evalp(()=>window.__DEBUG.advance(1));
  const d = simDelta(a, await simSnap());
  ok('the race is running again', d.race > 0.8 && d.move > 1, `+${d.race.toFixed(2)}s, ${d.move.toFixed(1)}m`);
}
ok('input is handed back', await evalp(()=>window.__DEBUG.engine.active.input.enabled === true));

// ── 3. held keys survive the whole sequence (D12) ────────────────────────
console.log('\n  3. held keys survive the freeze (D12)');
await boot(true, { autopilot:false });               // a real driver, not autopilot
await evalp(()=>window.__DEBUG.advance(4));          // through the start countdown
await key('ArrowUp','ArrowUp');                      // …and HOLD it, never released
await evalp(()=>window.__DEBUG.advance(2));
const heldSpeed = await evalp(()=>window.__DEBUG.engine.active.player.speed);
ok('a held accelerate key accelerates before the quiz', heldSpeed > 3, `${heldSpeed.toFixed(1)} m/s`);
await openQuiz(); await wait(60);
await tap('Digit2','2'); await wait(60);
await evalp(()=>window.__DEBUG.advance(2));
await tap('Space',' '); await wait(60);              // Space is also the drift key
await evalp(()=>window.__DEBUG.advance(3));          // through the 3·2·1
ok('the key is still tracked as held across the freeze',
   await evalp(()=>window.__DEBUG.engine.active.input.down.has('ArrowUp')));
await evalp(()=>window.__DEBUG.advance(2));
const afterSpeed = await evalp(()=>window.__DEBUG.engine.active.player.speed);
ok('…and the kart is still accelerating after the resume', afterSpeed > 3,
   `${heldSpeed.toFixed(1)} → ${afterSpeed.toFixed(1)} m/s`);

// ── 4. pause over a frozen quiz (the Wave-3 policy) ─────────────────────
console.log('\n  4. pause over a frozen quiz');
await boot(true, { autopilot:true });
await evalp(()=>window.__DEBUG.advance(6));
await openQuiz(); await wait(80);
ok('a quiz panel is up', await vis('.quiz-root.show'));
await key('Escape','Escape'); await wait(200);
ok('Esc over an open quiz opens the pause menu ON TOP', await vis('.mn-dialog.pause'));
ok('…and the quiz is still there underneath', await has('.quiz-root.show'));
await tap('Digit1','1'); await wait(120);
ok('1/2/3 do NOT answer the quiz behind the pause menu',
   !(await has('.quiz-root.show .quiz-card.quiz-answered')));
{
  const w = await evalp(()=>{ const el=document.querySelector('.quiz-root.show .quiz-timer > i');
    const a=el.style.width; window.__DEBUG.advance(4); return [a, el.style.width]; });
  ok('the quiz answer timer is frozen while paused', w[0] === w[1], w.join(' → '));
}
await key('Escape','Escape'); await wait(200);
ok('Esc closes the pause menu again', !(await vis('.mn-dialog.pause')));
ok('…back to the quiz, unchanged', await vis('.quiz-root.show'));
{
  const a = await simSnap();
  await evalp(()=>window.__DEBUG.advance(2));
  const d = simDelta(a, await simSnap());
  ok('resuming from pause does NOT restart the race under the quiz', d.race === 0 && d.move === 0,
     `race +${d.race.toFixed(3)}s`);
}
ok('…and input stays gated off until the quiz lets go',
   await evalp(()=>window.__DEBUG.engine.active.input.enabled === false));
await tap('Digit1','1'); await wait(120);
ok('1/2/3 answer again once the pause menu is gone',
   await has('.quiz-root.show .quiz-card.quiz-answered'));
// Space must not reach the feedback from behind the pause menu either. (The
// feedback has to be armed first — a keypress in its first fraction of a second
// is the one that answered, and must not also dismiss.)
await evalp(()=>window.__DEBUG.advance(1));
await key('Escape','Escape'); await wait(200);
await tap('Space',' '); await wait(120);
ok('Space does NOT dismiss the feedback behind the pause menu',
   await has('.quiz-root.show .quiz-card.quiz-answered'));
await key('Escape','Escape'); await wait(200);
await tap('Space',' '); await wait(120);
ok('…and dismisses it once the pause menu is gone', !(await has('.quiz-root.show')));

// ── 5. a real beacon still opens a real question ─────────────────────────
console.log('\n  5. integration: the beacons themselves');
await boot(true, { autopilot:true });
ok('a quiz beacon opens a panel while driving', (await driveUntil('.quiz-root.show')) >= 0);
{
  const a = await simSnap();
  await evalp(()=>window.__DEBUG.advance(3));
  const d = simDelta(a, await simSnap());
  ok('…and a beacon-opened quiz freezes the world too', d.race === 0 && d.move === 0);
}

// ── 6. no repeated questions across a championship (Wave 3 item 6) ───────
// scenes.js accumulates the ids from `quiz:open` and hands them to the next
// race as `askedIds`; race.js passes them to the quiz system, which drops them
// from the pool (unless that would starve it below quizdata's MIN_POOL).
console.log('\n  6. no repeats across the championship');
async function drawIds(n, opts={}) {
  await boot(true, { autopilot:true, ...opts });
  return evalp(k=>{ const q=window.__DEBUG.engine.active.quiz;
    for (let i=0;i<k;i++) { q.openQuestion(); q.close(); }
    return q.askedIds; }, n);
}
const raceOne = await drawIds(8);
ok('a race draws distinct questions', raceOne.length === 8 && new Set(raceOne).size === 8,
   raceOne.slice(0,3).join(', ') + '…');
const repeatRun = await drawIds(8);
ok('the same seed draws the same questions without askedIds',
   repeatRun.join('|') === raceOne.join('|'));
const raceTwo = await drawIds(8, { askedIds: raceOne });
const overlap = raceTwo.filter(id => raceOne.includes(id));
ok('askedIds are never drawn again', raceTwo.length === 8 && overlap.length === 0,
   overlap.join(', ') || 'no overlap');
{
  const pool = await evalp(()=>window.__DEBUG.engine.active.quiz.poolSize);
  ok('…and the pool is still healthy', pool >= 12, `${pool} questions eligible`);
}

// ── 7. the token explainer must never land on a live quiz ────────────────
console.log('\n  7. the one-time explainers');
await boot(false, { autopilot:true });
let stacked = 0, quizFrames = 0, tokenSeen = false;
for (let i=0;i<70;i++) {
  await page.evaluate(()=>window.__DEBUG.advance(2));
  const r = await page.evaluate(()=>({
    q: [...document.querySelectorAll('.quiz-root')].some(e=>e.classList.contains('show')),
    tok: document.querySelectorAll('.grgtok-scrim').length > 0 }));
  if (r.q) quizFrames++;
  // A frozen quiz stops the sim, so the token that would trigger the explainer
  // can only be collected once the panel is gone — dismiss it and keep driving.
  if (r.q && !r.tok) { await tap('Digit1','1'); await wait(60); await tap('Space',' '); await wait(60); }
  if (r.tok) { tokenSeen = true; if (r.q) stacked++; await wait(400); break; }
}
ok('the token explainer fires during a race', tokenSeen);
ok('…and never on top of a live quiz', stacked === 0, `${quizFrames} quiz samples, ${stacked} stacked`);

// ── 8. Escape belongs to the token explainer, not to the pause menu ──────
ok('the token explainer is up', await vis('.grgtok-scrim'));
await key('Escape','Escape'); await wait(200);
ok('Escape closes the token explainer', !(await vis('.grgtok-scrim')));
ok('…and does not open the pause menu over it', !(await vis('.mn-dialog.pause')));
const ran = await page.evaluate(()=>{ const a=window.__DEBUG.engine.active, t0=a.state.raceTime;
  window.__DEBUG.advance(1); return a.state.raceTime-t0; });
ok('the race is running again afterwards', ran > 0.5, `+${ran.toFixed(2)}s`);

ok('no page errors', errs.length===0, errs[0]||'');
console.log('  ' + '─'.repeat(74));
console.log(fails ? `\n  ${fails} FAILED` : '\n  all modal checks passed');
await b.close();
process.exit(fails?1:0);

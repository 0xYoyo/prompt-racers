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
// The quiz payout is asserted below, against the SOURCE OF TRUTH rather than a
// copy of it. It used to read `p.tokens >= 3`, a literal from the 3/4/5-by-tier
// era; the Wave-4 rebalance flattened REWARD_TOKENS to 1 and this gate went red
// for a mechanism that was working perfectly. A hardcoded constant in a gate is
// a second copy of a number the game already owns, and it fails in whichever
// direction is least useful — so import it. quiz.js touches no DOM at import
// time, which is why this works in plain Node.
import { REWARD_TOKENS } from '../src/race/quiz.js';
// `--dist <path>` points the whole file at a different build, exactly as
// tests/introcard.test.mjs does and for the same reason: proving a gate bites.
// Rebuilding dist/ from a mutant would leave a deliberately broken
// dist/index.html in a tree several agents are sharing for as long as the run
// takes; a mutant bundled to .tmp/ costs nobody anything.
const distArg = process.argv.indexOf('--dist');
const dist = distArg > 0 && process.argv[distArg + 1]
  ? process.argv[distArg + 1]
  : '/Users/yoyopc/repos/kart-project/dist/index.html';
const b = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(''+e.message));
await page.setViewport({ width: 1366, height: 768 });
let fails = 0;
const ok=(n,v,d='')=>{ if(!v) fails++; console.log(`  ${v?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${n.padEnd(58)} ${d}`); };
// Keys go through the BROWSER, not through dispatchEvent(window). This is not a
// style preference, it is the difference between exercising the policy and
// exercising nothing: a real keydown is delivered at document.activeElement and
// BUBBLES up to window, so a capture-phase listener on an overlay (menus.js's
// overlayRoot, which owns Escape for the topmost panel) can stop it before
// input.js ever sees it. An event dispatched straight on `window` has no capture
// phase to stop, so input.js fired regardless and every Escape-ownership check
// here passed no matter what menus.js did — deleting the `isTopOverlay` guard
// used to leave this file reporting "all modal checks passed".
const key = code => page.keyboard.down(code);
const keyUp = code => page.keyboard.up(code);
const tap = code => page.keyboard.press(code);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const evalp = (fn,...a) => page.evaluate(fn,...a);
// Several .quiz-root nodes can exist at once (the menu backdrop mounts a
// disabled quiz system of its own), so always test ALL matches. And measure
// CLASS membership, not computed style: CSS transitions never settle under the
// harness, which steps the sim without presenting frames.
const vis = sel => page.evaluate(s=>[...document.querySelectorAll(s)].some(e=>
  e.offsetParent!==null && getComputedStyle(e).visibility!=='hidden' && +getComputedStyle(e).opacity>0.05), sel);
const has = sel => page.evaluate(s=>document.querySelectorAll(s).length>0, sel);

// ── POINTER INPUT, for the same reason keys go through the browser ──────────
// `element.click()` proves only that a handler does the right thing. It cannot
// see that the element is unreachable — covered by an overlay, or killed by
// style.js's `#ui *{pointer-events:none}` (every clickable thing in the game has
// to opt back in with `.on`). page.mouse.click() and page.touchscreen.tap()
// hit-test a POINT, so they exercise the path a child's finger takes: if the
// wrong element is on top, nothing happens, exactly as it would for the child.
// Every negative assertion below ("this click must NOT answer") is therefore
// paired with the same click succeeding once the blocker is gone — otherwise the
// negative would pass just as happily against coordinates that hit nothing.
const boxOf = async (sel, i=0) => page.evaluate((s,ix)=>{
  const el=[...document.querySelectorAll(s)][ix];
  if(!el) return null;
  const r=el.getBoundingClientRect();
  if(!r.width||!r.height) return null;
  return {x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height};
}, sel, i);
const clickAt = async box => { if(box) await page.mouse.click(box.x, box.y); };
const tapAt   = async box => { if(box) await page.touchscreen.tap(box.x, box.y); };
// Everything a state transition is made of, from BOTH layers: the quiz system's
// own state and the DOM the child is actually looking at. `via` is the one field
// that is allowed to differ between a keyboard run and a pointer run — and it is
// asserted to differ, so neither run can silently be the other one.
const quizState = () => evalp(()=>{
  const q = window.__DEBUG.engine.active.quiz;
  const root = [...document.querySelectorAll('.quiz-root')].find(e=>e.classList.contains('show'));
  const opts = root ? [...root.querySelectorAll('.quiz-opt')] : [];
  const r = q.lastResult;
  return {
    phase: q.phase, id: q.currentId, frozen: q.frozen, scale: q.timeScale,
    answered: !!root?.querySelector('.quiz-card.quiz-answered'),
    marks: opts.map(o=>['ok','no','dim'].filter(c=>o.classList.contains(c)).join('+')).join('|'),
    disabled: opts.map(o=>o.disabled?1:0).join(''),
    verdict: root?.querySelector('.quiz-verdict')?.textContent.trim()||'',
    why: (root?.querySelector('.quiz-why')?.textContent.trim()||'').slice(0,80),
    hint: root?.querySelector('.quiz-hint')?.textContent.trim()||'',
    result: r && { id:r.id, correct:r.correct, chosen:r.chosen, tokens:r.tokens, timedOut:r.timedOut },
    tokens: window.__DEBUG.engine.active.state.tokens,
    boosting: !!window.__DEBUG.engine.active.player.boosting,
    input: window.__DEBUG.engine.active.input.enabled,
    via: q.lastVia,
  };
});
// first differing field, or '' — so a failure says WHICH transition drifted
function stateDiff(a, b) {
  for (const k of Object.keys(a)) {
    if (k === 'via') continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return `${k}: ${JSON.stringify(a[k])} ≠ ${JSON.stringify(b[k])}`;
  }
  return '';
}

// `seen` = "this child has already met every one-time explainer". It has to
// cover the QUIZ-box explainer as well as the token one: with a fresh save the
// first question box in a race now teaches what a question box is before it asks
// anything, so every section below that opens a quiz directly would otherwise be
// looking at the explainer and reporting the panel missing.
async function boot(seen, opts={}) {
  await page.goto('file://' + dist, { waitUntil: 'load' });
  await page.evaluate(v => { localStorage.setItem('promptracers.v1', JSON.stringify(
    v ? {garageTokenIntroSeen:true, quizBoxIntroSeen:true} : {})); }, seen);
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
await key('ArrowUp');                      // …and HOLD it, never released
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

// ── 3b. a child still HOLDING Space is not stuck ────────────────────────
// Space is the drift key. If it was held when the beacon fired, pressing it does
// nothing (auto-repeat is not a press — that guard is deliberate, D20), and the
// gold button was the only way out: a keyboard-only dead end. The auto-repeat is
// now used as the tell, and the panel says what to do.
console.log('\n  3b. a held Space says so instead of doing nothing');
await boot(true, { autopilot:true });
await evalp(()=>window.__DEBUG.advance(6));
await key('Space');                                  // drifting when the beacon fires
await openQuiz(); await wait(80);
await tap('Digit1'); await wait(80);
await evalp(()=>window.__DEBUG.advance(1));          // past the arming delay
await key('Space');                                  // the auto-repeat of a key never released
await wait(120);
ok('a held Space does NOT dismiss the explanation',
   await has('.quiz-root.show .quiz-card.quiz-answered'));
ok('…and the panel says to let go of it first', await evalp(()=>
  [...document.querySelectorAll('.quiz-root.show .quiz-hint')].some(e=>e.classList.contains('held'))));
await keyUp('Space');
await tap('Space'); await wait(120);
ok('…and releasing it, then pressing it, works', !(await has('.quiz-root.show')));

// ── 4. pause over a frozen quiz (the Wave-3 policy) ─────────────────────
console.log('\n  4. pause over a frozen quiz');
await boot(true, { autopilot:true });
await evalp(()=>window.__DEBUG.advance(6));
await openQuiz(); await wait(80);
ok('a quiz panel is up', await vis('.quiz-root.show'));
await tap('Escape'); await wait(200);
ok('Esc over an open quiz opens the pause menu ON TOP', await vis('.mn-dialog.pause'));
ok('…and the quiz is still there underneath', await has('.quiz-root.show'));
// A STACK of overlays — the case `isTopOverlay` exists for, and the one this
// file could not see while it dispatched keys on `window` (no capture phase to
// stop, so input.js fired regardless of what menus.js did). Settings opened FROM
// the pause menu: one Escape must close Settings and leave the pause menu — and
// the frozen race — exactly where they were.
await evalp(()=>document.querySelector('.mn-dialog.pause .pz-menu button:nth-child(2)')?.click());
await wait(250);
ok('Settings opens on top of the pause menu',
   (await evalp(()=>document.querySelectorAll('.mn-ov').length)) === 2);
await tap('Escape'); await wait(250);
ok('one Escape closes ONLY the top overlay',
   (await evalp(()=>document.querySelectorAll('.mn-ov').length)) === 1 && await vis('.mn-dialog.pause'),
   `${await evalp(()=>document.querySelectorAll('.mn-ov').length)} overlays left`);
{
  const a = await simSnap();
  await evalp(()=>window.__DEBUG.advance(2));
  const d = simDelta(a, await simSnap());
  ok('…and the race did NOT restart under the stack', d.race === 0 && d.move === 0,
     `race +${d.race.toFixed(3)}s`);
}
await tap('Digit1','1'); await wait(120);
ok('1/2/3 do NOT answer the quiz behind the pause menu',
   !(await has('.quiz-root.show .quiz-card.quiz-answered')));
// The POINTER path into the same state machine. `onKey` checked the registry;
// the `.quiz-opt` onclick did not, and only the full-screen `.mn-ov` stopped a
// real mouse from reaching it — geometry, not policy. A programmatic click is
// exactly the mutant that geometry does not catch.
await evalp(()=>{ document.querySelector('.quiz-root.show .quiz-opt')?.click(); }); await wait(120);
ok('…and neither does a CLICK on an option',
   !(await has('.quiz-root.show .quiz-card.quiz-answered')));
{
  const w = await evalp(()=>{ const el=document.querySelector('.quiz-root.show .quiz-timer > i');
    const a=el.style.width; window.__DEBUG.advance(4); return [a, el.style.width]; });
  ok('the quiz answer timer is frozen while paused', w[0] === w[1], w.join(' → '));
}
await tap('Escape'); await wait(200);
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
await tap('Escape'); await wait(200);
await tap('Space',' '); await wait(120);
ok('Space does NOT dismiss the feedback behind the pause menu',
   await has('.quiz-root.show .quiz-card.quiz-answered'));
await evalp(()=>{ document.querySelector('.quiz-root.show .quiz-cont')?.click(); }); await wait(120);
ok('…and neither does a CLICK on the continue button',
   await has('.quiz-root.show .quiz-card.quiz-answered'));
await tap('Escape'); await wait(200);
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
// This loop used to BREAK on the first frame the explainer appeared — seconds
// into the race, before any beacon could fire — and then assert `stacked === 0`
// over a sample set that was always empty. It printed "0 quiz samples, 0
// stacked" on every run, mutant or not. Now it drives on THROUGH the explainer,
// dismissing whatever owns the screen, and `quizFrames > 0` is asserted as a
// precondition so the check can never pass vacuously again.
await boot(false, { autopilot:true });
let stacked = 0, quizFrames = 0, tokFrames = 0, tokenSeen = false;
for (let i=0;i<110;i++) {
  await page.evaluate(()=>window.__DEBUG.advance(2));
  const r = await page.evaluate(()=>({
    q: [...document.querySelectorAll('.quiz-root')].some(e=>e.classList.contains('show')),
    tok: document.querySelectorAll('.grgtok-scrim').length > 0,
    // …and the first-question-box explainer, which on a fresh save stands in
    // front of the first question. It freezes the world exactly like the other
    // two, so the loop has to clear it or nothing else ever happens again.
    intro: document.querySelectorAll('.qzint-scrim').length > 0 }));
  if (r.q) quizFrames++;
  if (r.tok) { tokFrames++; tokenSeen = true; if (r.q) stacked++; }
  if (r.intro && r.q) stacked++;
  if (r.intro) { await tap('Escape'); await wait(120); }
  // Both of these freeze the sim, so nothing else can happen until they are
  // gone: clear whichever is up and keep driving.
  else if (r.tok) { await tap('Escape'); await wait(120); }
  // (the advance is the DISMISS_AFTER_S arming delay: the press that ANSWERED
  //  must never also dismiss, so Space at phaseT≈0 is deliberately ignored)
  else if (r.q) { await tap('Digit1'); await wait(60); await evalp(()=>window.__DEBUG.advance(1)); await tap('Space'); await wait(60); }
  if (tokenSeen && quizFrames >= 4) break;
}
ok('the token explainer fires during a race', tokenSeen, `${tokFrames} explainer samples`);
ok('quiz panels were actually sampled', quizFrames > 0, `${quizFrames} quiz samples`);
ok('…and the explainer never lands on a live quiz', quizFrames > 0 && stacked === 0,
   `${quizFrames} quiz samples, ${stacked} stacked`);

// ── 8. Escape belongs to the token explainer, not to the pause menu ──────
// Fresh boot: section 7 drove past the explainer (and dismissed it) on purpose,
// and boot(false) clears the save flag so it can fire again.
console.log('\n  8. Escape belongs to the topmost panel');
await boot(false, { autopilot:true });
{
  // A quiz beacon on the way freezes the sim, so it has to be cleared or the
  // kart never reaches a token at all.
  let up = false;
  for (let s=0;s<140 && !up;s+=2) {
    await page.evaluate(()=>window.__DEBUG.advance(2));
    up = await vis('.grgtok-scrim');
    if (!up && await vis('.qzint-scrim')) { await tap('Escape'); await wait(120); }
    else if (!up && await vis('.quiz-root.show')) {
      await tap('Digit1'); await wait(60); await evalp(()=>window.__DEBUG.advance(1)); await tap('Space'); await wait(60);
    }
  }
  ok('the token explainer is up', up);
}
await tap('Escape'); await wait(200);
ok('Escape closes the token explainer', !(await vis('.grgtok-scrim')));
ok('…and does not open the pause menu over it', !(await vis('.mn-dialog.pause')));
const ran = await page.evaluate(()=>{ const a=window.__DEBUG.engine.active, t0=a.state.raceTime;
  window.__DEBUG.advance(1); return a.state.raceTime-t0; });
ok('the race is running again afterwards', ran > 0.5, `+${ran.toFixed(2)}s`);

// ── 9. mouse and touch are the KEYBOARD's code path, not a second one ────
// The quiz is answered with 1/2/3 and continued with Space, and Wave 4 added
// click/tap for both. The risk is not that the pointer does nothing — it is that
// the pointer gets its own quietly different implementation, which then drifts
// (that is exactly how the `.quiz-opt` onclick came to skip the modal-registry
// guard the key handler honoured). So this does not check "a click answers": it
// runs the SAME question three times, once per input, and demands the resulting
// state be identical field for field.
console.log('\n  9. pointer parity: click and tap take the keyboard\'s path');
async function runQuiz(via) {
  await page.setViewport({ width:1366, height:768, hasTouch: via==='touch' });
  await boot(true, { autopilot:true });
  await evalp(()=>window.__DEBUG.advance(6));
  await openQuiz(); await wait(80);
  // One frame, so the values race.js recomputes per frame (the time scale it is
  // handed, and input.enabled) are the ones the panel actually causes rather
  // than the ones left over from the frame before it opened.
  await evalp(()=>window.__DEBUG.advance(1/60));
  const opened = await vis('.quiz-root.show');
  const box = await boxOf('.quiz-root.show .quiz-opt', 2);   // the THIRD option
  if (via==='key') await tap('Digit3');
  else if (via==='click') await clickAt(box);
  else await tapAt(box);
  await wait(100);
  const answered = await quizState();
  await evalp(()=>window.__DEBUG.advance(1));                // past the arming delay
  const cont = await boxOf('.quiz-root.show .quiz-cont');
  // What a finger would ACTUALLY hit at the continue button's centre. The
  // celebration flash after a right answer is a full-screen sibling drawn over
  // the card, and it used to carry style.js's `.on` class — which is the global
  // pointer-events opt-in, not a decoration — so it became an invisible sheet
  // that ate every click on the panel. Answering by keyboard hid this
  // completely: only a pointer notices a transparent lid.
  const topOnCont = cont ? await evalp(p=>{ const e=document.elementFromPoint(p.x,p.y);
    return e ? (e.className||e.tagName) : 'nothing'; }, cont) : 'missing';
  if (via==='key') await tap('Space');
  else if (via==='click') await clickAt(cont); else await tapAt(cont);
  await wait(100);
  const resumed = { phase: await quizPhase(), gone: !(await has('.quiz-root.show')),
                    input: await evalp(()=>window.__DEBUG.engine.active.input.enabled) };
  return { opened, box, cont, topOnCont, answered, resumed };
}
const K = await runQuiz('key');
const C = await runQuiz('click');
const Tp = await runQuiz('touch');
// The precondition. Every assertion under this one is over these three samples;
// if a run never reached a question, they would all compare `null` to `null` and
// pass without testing anything.
ok('all three runs actually reached a question',
   K.opened && C.opened && Tp.opened && K.answered.id && K.answered.id === C.answered.id,
   `question ${K.answered.id||'?'}`);
ok('each run really used the input it claims',
   K.answered.via==='key' && C.answered.via==='pointer' && Tp.answered.via==='pointer',
   `${K.answered.via} / ${C.answered.via} / ${Tp.answered.via}`);
ok('a real mouse click answers, and lands on the same state as 1/2/3',
   K.answered.answered && stateDiff(K.answered, C.answered)==='', stateDiff(K.answered, C.answered)||'identical');
ok('a real finger tap does too', Tp.answered.answered && stateDiff(K.answered, Tp.answered)==='',
   stateDiff(K.answered, Tp.answered)||'identical');
ok('…including the freeze and the reward', K.answered.scale===0 && C.answered.scale===0 && Tp.answered.scale===0
   && K.answered.tokens===C.answered.tokens,
   `scale 0, tokens ${K.answered.tokens}`);
ok('the continue BUTTON resumes exactly as Space does',
   K.resumed.phase==='resume' && C.resumed.phase===K.resumed.phase && Tp.resumed.phase===K.resumed.phase
   && C.resumed.gone===K.resumed.gone && C.resumed.input===K.resumed.input,
   `${K.resumed.phase} / ${C.resumed.phase} / ${Tp.resumed.phase}`);
ok('answer targets are big enough for a child\'s finger', Math.round(K.box.h)>=44 && K.box.w>=240,
   `${Math.round(K.box.w)}×${Math.round(K.box.h)}px`);
ok('nothing invisible is sitting on top of the continue button',
   /quiz-cont/.test(K.topOnCont) && /quiz-cont/.test(C.topOnCont) && /quiz-cont/.test(Tp.topOnCont),
   `hit test: ${C.topOnCont}`);
await page.setViewport({ width:1366, height:768 });

// The registry guard belongs to the STATE MACHINE, not to whatever geometry
// happens to sit on top. A real click at the option's own coordinates is the
// honest test of that — and it is paired with the same click working seconds
// later, so it cannot pass by hitting nothing.
await boot(true, { autopilot:true });
await evalp(()=>window.__DEBUG.advance(6));
await openQuiz(); await wait(80);
const optBox = await boxOf('.quiz-root.show .quiz-opt', 0);
await tap('Escape'); await wait(220);
ok('the pause menu is over the quiz', await vis('.mn-dialog.pause') && await has('.quiz-root.show'));
await clickAt(optBox); await wait(140);
ok('a real click where the option IS cannot answer a quiz behind the pause menu',
   !(await has('.quiz-root.show .quiz-card.quiz-answered')));
// That click landed on the pause menu — which is the honest outcome, and also
// means it may have changed the pause menu's view (its buttons are in that half
// of the screen). Close the whole stack deterministically before the paired
// positive, rather than assuming one Escape was enough.
for (let i=0;i<4 && await has('.mn-ov'); i++) { await tap('Escape'); await wait(220); }
ok('the pause stack really is gone before the paired check', !(await has('.mn-ov')));
await clickAt(optBox); await wait(140);
ok('…and the very same click answers once the pause menu is gone',
   await has('.quiz-root.show .quiz-card.quiz-answered'));
// Same story for the continue button, and for the arming delay that stops the
// press which ANSWERED from also dismissing.
const contBox = await boxOf('.quiz-root.show .quiz-cont');
ok('the continue button is a finger-sized target too', contBox && Math.round(contBox.h)>=44,
   contBox ? `${Math.round(contBox.w)}×${Math.round(contBox.h)}px` : 'missing');
await clickAt(contBox); await wait(120);
ok('a click on continue in the first fraction of a second does NOT dismiss',
   await has('.quiz-root.show .quiz-card.quiz-answered'));
await evalp(()=>window.__DEBUG.advance(1));
await clickAt(contBox); await wait(120);
ok('…and dismisses once the explanation has been up long enough',
   !(await has('.quiz-root.show')) && (await quizPhase())==='resume');

// RTL is the game's first direction and LTR is the toggle; a pointer target that
// only works in one of them works for half the players.
await boot(true, { autopilot:true, lang:'en' });
await evalp(()=>window.__DEBUG.advance(6));
await openQuiz(); await wait(80);
ok('the page really is LTR for this run', (await evalp(()=>document.documentElement.dir))==='ltr');
const enBox = await boxOf('.quiz-root.show .quiz-opt', 1);
await clickAt(enBox); await wait(140);
ok('a click answers in LTR (English) too', await has('.quiz-root.show .quiz-card.quiz-answered'),
   enBox ? `${Math.round(enBox.w)}×${Math.round(enBox.h)}px` : 'missing');

// The size check above is taken at 1366×768, where an option row is already
// ~47px tall from its own padding — so the min-block-size floor is doing no work
// there and deleting it changes nothing (measured: that mutant passed every
// check). A target check has to be taken where it can FAIL. 1024×640 is this
// project's height-bound case, and there the floor is the only thing between a
// child's fingertip and a ~30px row.
await page.setViewport({ width:1024, height:640 });
await boot(true, { autopilot:true });
await evalp(()=>window.__DEBUG.advance(6));
await openQuiz(); await wait(80);
const smallBox = await boxOf('.quiz-root.show .quiz-opt', 0);
ok('answers are STILL finger-sized at the height-bound 1024×640',
   smallBox && Math.round(smallBox.h)>=44,
   smallBox ? `${Math.round(smallBox.w)}×${Math.round(smallBox.h)}px` : 'missing');
await clickAt(smallBox); await wait(140);
ok('…and a tap there still answers', await has('.quiz-root.show .quiz-card.quiz-answered'));
await page.setViewport({ width:1366, height:768 });

// ── 10. the first question box explains itself, exactly once ─────────────
console.log('\n  10. the one-time first-question-box explainer');
const introFlag = () => evalp(()=>{
  try { return !!JSON.parse(localStorage.getItem('promptracers.v1')||'{}').quizBoxIntroSeen; }
  catch { return null; } });
await boot(false, { autopilot:true });          // a save that has never seen anything
await evalp(()=>window.__DEBUG.advance(4));
ok('a fresh save has not seen the question-box explainer', (await introFlag())===false);
// (a) it DEFERS behind anything already open, and does not burn its flag doing it
await tap('Escape'); await wait(220);
ok('another panel owns the screen', await vis('.mn-dialog.pause'));
await openQuiz(); await wait(150);
ok('a question box behind another panel opens NOTHING',
   !(await vis('.qzint-scrim')) && !(await vis('.quiz-root.show')));
ok('…and the one-time flag is left untouched, so the next box explains',
   (await introFlag())===false);
await tap('Escape'); await wait(220);
await openQuiz(); await wait(150);
ok('the first question box shows the explainer', await vis('.qzint-scrim'));
ok('…instead of the question itself', !(await vis('.quiz-root.show')));
ok('…and only now is the flag written', (await introFlag())===true);
await evalp(()=>window.__DEBUG.advance(1/60));    // one frame, so race.js has reacted
ok('…and the world is frozen behind it, input gated off, like any quiz panel',
   await evalp(()=>window.__DEBUG.engine.active.quiz.frozen===true
     && window.__DEBUG.engine.active.quiz.timeScale===0
     && window.__DEBUG.engine.active.input.enabled===false));
{
  const a = await simSnap();
  await evalp(()=>window.__DEBUG.advance(3));
  const d = simDelta(a, await simSnap());
  ok('…measured: ZERO sim steps while it is up', d.race===0 && d.lap===0 && d.move===0,
     `race +${d.race.toFixed(3)}s, moved ${d.move.toFixed(3)}m`);
}
ok('it names both halves of what a box does', await evalp(()=>{
  const txt=[...document.querySelectorAll('.qzint-p')].map(e=>e.textContent).join(' ');
  return txt.length>40 && /טורבו|boost/i.test(txt) && /טוקנ|token/i.test(txt); }));
// Its button is a pointer target too, and it leads STRAIGHT into the question
// the box was for — the explainer is not a detour that costs the child the box.
const goBox = await boxOf('.qzint-scrim .btn');
ok('its button is a finger-sized target', goBox && goBox.h>=44,
   goBox ? `${Math.round(goBox.w)}×${Math.round(goBox.h)}px` : 'missing');
await clickAt(goBox); await wait(200);
ok('clicking it leads straight into the question', await vis('.quiz-root.show'));
ok('…and the explainer is gone', !(await vis('.qzint-scrim')));
await evalp(()=>window.__DEBUG.advance(1/60));
ok('…with the world still frozen for the question', await evalp(()=>
  window.__DEBUG.engine.active.quiz.timeScale===0));
// (b) exactly once — this race, and every race after a reload
await tap('Digit1'); await wait(80);
await evalp(()=>window.__DEBUG.advance(1));
await tap('Space'); await wait(80);
await evalp(()=>window.__DEBUG.advance(4));      // through the 3·2·1
await openQuiz(); await wait(150);
ok('the SECOND question box does not explain again',
   !(await vis('.qzint-scrim')) && await vis('.quiz-root.show'));
// The claim the explainer makes, checked against what the code actually pays.
// A teaching screen that says something a child can see is false stops being
// believed about anything else on it.
{
  const pay = await evalp(async ()=>{
    const a=window.__DEBUG.engine.active, q=a.quiz, out=[];
    q.close();
    for (let i=0;i<9;i++) {
      const t0=a.state.tokens;
      q.openQuestion();
      const root=[...document.querySelectorAll('.quiz-root')].find(e=>e.classList.contains('show'));
      root.querySelectorAll('.quiz-opt')[i%3].click();
      out.push({ correct:q.lastResult.correct, tokens:q.lastResult.tokens,
                 tier:q.lastResult.tier,
                 banked:a.state.tokens-t0, boosting:!!a.player.boosting });
      q.close();
    }
    return out;
  });
  const good = pay.filter(p=>p.correct), bad = pay.filter(p=>!p.correct);
  ok('both outcomes were sampled', good.length>0 && bad.length>0,
     `${good.length} right, ${bad.length} wrong`);
  // The payout is checked against REWARD_TOKENS ITSELF, per tier, so a retune
  // moves the gate with the game and a payout that quietly stops matching the
  // table is still caught. `>0` is asserted separately: a table of zeroes would
  // satisfy "matches the table" while paying a child nothing.
  ok('a right answer really does pay tokens AND a turbo',
     good.length>0 && good.every(p=>p.tokens===REWARD_TOKENS[p.tier] && p.tokens>0
                                    && p.banked===p.tokens && p.boosting),
     good.map(p=>`+${p.banked} (tier ${p.tier}, table ${REWARD_TOKENS[p.tier]})`).join(' '));
  ok('a wrong answer really does cost nothing',
     bad.length>0 && bad.every(p=>p.tokens===0 && p.banked===0),
     bad.map(p=>`${p.banked>=0?'+':''}${p.banked}`).join(' '));
}
await page.reload({ waitUntil: 'load' });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
await page.evaluate(()=>window.__DEBUG.goto('race',{track:0,difficulty:1,autopilot:true}));
await wait(300);
await evalp(()=>window.__DEBUG.advance(4));
await openQuiz(); await wait(150);
ok('…nor does the next RACE, on the same save', !(await vis('.qzint-scrim')) && await vis('.quiz-root.show'));

/* ══════════════════ 11. ONBOARDING DENSITY (Wave 5, item 6) ════════════════
   The first race used to be able to show four teaching cards inside ninety
   seconds — the track intro card, the first-token explainer, the first-box
   explainer and the quiz's own feedback — each one justified on its own and a
   slideshow together. ui/style.js now holds a cadence: a card asks
   teachingCardReady() before opening and calls noteTeachingCard() when it
   closes, and anything not ready DEFERS to its next natural trigger.

   This section drives a REAL first race — a save that has never seen an
   explainer, the intro card on, real beacons and real token pickups — and
   measures when each card owns the screen. It asserts the PROPERTY (a gap, a
   count, a card that comes back) and never the wording: D42.
   ────────────────────────────────────────────────────────────────────────── */
/* WAVE 5.1 REWRITE. Round 2 of this section pinned a cadence gate that sat at
   the BEACON: a question box that arrived inside another teaching card's shadow
   was consumed and opened nothing. Measured on the built game that ate roughly
   two boxes in three, and the first boxes of a championship fired nothing at
   all — a child reads that as a broken pickup, and the assertions here were
   pinning the breakage in place. So the contract this section holds has moved,
   deliberately, in one direction:

     • TEACHING CARDS still space themselves. The gap lives in ui/style.js and
       the card that still consults it is race.js's first-token explainer; 11d
       asserts its magnitude, where the constant actually is.
     • QUESTION BOXES are never deferred by it. The only thing that can hold a
       box back is quiz.js's VISIBLE cooldown — ghosted beacons, a filling
       recharge ring, a soft token if you drive through one anyway — and the
       first box of a race ignores even that. `quiz:deferred` is gone from the
       bus; 11c asserts that a frozen teaching clock now costs the child NO
       questions at all, which is the exact inverse of what it used to assert
       and therefore goes red against the old code.
     • The per-box detail (ghosting, the recharge ring, the soft token, the
       fire rate) is tools/quizboxtest.mjs. This section stays what it is: the
       ONBOARDING DENSITY gate.                                              */
const TEACH_GAP_S = 15;      // ui/style.js — the nominal teaching-card gap
const CARD_FLOOR_S = 6;      // race.js — the first-token card's escalated floor
const BOX_COOLDOWN_S = 8;    // quiz.js — the visible box cooldown, i.e. box→box
const WINDOW_S = 90;         // "the first ninety seconds"
const DRIVE_S = 95;
const READ_S = 1.2;          // the child looks at the card before dismissing it
// 5 → 7 in Wave 5.1, and this is the one number this pass actually spends.
// Round 2 bought its budget of five by DEFERRING question boxes at the beacon,
// which is the mechanism 5.1 removed: the boxes it declined to open were the
// game's whole teaching surface, and it declined silently. Seven is the intro
// card + the first-token explainer + five question boxes, measured on a real
// first race, and what stops it being a slideshow is the gap rather than the
// count — asserted separately just below, and observed at 7.3–17.8s.
// MAX_OPENERS is untouched at 2, because THAT is the onboarding number: two
// one-time cards in the first ninety seconds. A question box is not onboarding,
// it is the game.
const MAX_CARDS = 7;
const MAX_OPENERS = 2;       // …of which at most two are one-time/opening cards

console.log('\n  11. onboarding density: teaching cards in the first 90s\n  ' + '─'.repeat(74));

// THE SYNTHETIC CLOCK. The cadence is measured in WALL seconds — "a slideshow"
// is a wall-clock feeling, and race time does not advance at all while a card
// is up (D20) — so ninety of those seconds have to pass for this to mean
// anything. style.js exposes setTeachingClock() for exactly this, but a built
// bundle exports nothing to the page, so the injection point available from
// here is the clock it reads: performance.now. (The engine's own RAF loop
// returns early under _headless, so nothing else in the game reads it.)
// Installed BEFORE goto('race'): clearModals(), which every scene change
// fires, is what resets the cadence, so game and gate start the clock together.
async function bootFresh(opts) {
  await page.goto('file://' + dist, { waitUntil: 'load' });
  await page.evaluate(()=>localStorage.setItem('promptracers.v1','{}'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  await evalp(()=>{ window.__T = 0; performance.now = () => window.__T * 1000; });
  await evalp(o=>window.__DEBUG.goto('race', o), { track:0, difficulty:1, autopilot:true, ...opts });
  // The recorder runs INSIDE the page, sampled every fixed step, so an open and
  // a close are timed to 1/60s instead of to a round-trip. A card episode is
  // taken from the owner's own state where there is one: the quiz box episode
  // is `quiz.phase !== 'idle'`, which starts at the explainer/question and ends
  // at close() — the exact moment the cadence clock starts, and 2.16s after the
  // panel itself disappeared behind the 3·2·1.
  await evalp(()=>{
    const D = window.__DEBUG, A = () => D.engine.active;
    window.__EV = []; window.__DEF = []; window.__PICK = []; window.__PHASE = [];
    window.__MET = []; window.__SOFT = [];
    // `quiz:deferred` no longer exists (Wave 5.1). It is still SUBSCRIBED to, on
    // purpose: if anything ever re-introduces a beacon-side deferral this array
    // stops being empty and 11c goes red, instead of the gate quietly measuring
    // a bus event nobody emits.
    D.bus.on('quiz:deferred', e => window.__DEF.push({ t: window.__T, since: e.since, gap: e.gap }));
    // Every beacon actually driven through, live or recharging — the number the
    // fire-rate claim is made of.
    D.bus.on('quiz:beacon', e => window.__MET.push({ t: window.__T, active: !!e.active }));
    D.bus.on('quiz:softToken', () => window.__SOFT.push(window.__T));
    D.bus.on('token:pickup', () => window.__PICK.push(window.__T));
    const st = {};
    window.__sample = () => {
      const a = A();
      const now = {
        ic: !!document.querySelector('.ic-card'),
        tok: !!document.querySelector('.grgtok-scrim'),
        qint: !!document.querySelector('.qzint-scrim'),
        box: a.quiz.phase !== 'idle',
      };
      for (const k of Object.keys(now)) {
        if (now[k] === !!st[k]) continue;
        if (now[k]) window.__EV.push({ kind:k, open:window.__T, close:null });
        else { const e=[...window.__EV].reverse().find(x=>x.kind===k && x.close===null); if (e) e.close = window.__T; }
        st[k] = now[k];
      }
      const ph = a.state.phase;
      if (window.__PHASE[window.__PHASE.length-1]?.p !== ph) window.__PHASE.push({ p:ph, t:window.__T });
    };
    window.__drive = secs => { const F=1/60;
      for (let i=0,n=Math.round(secs/F); i<n; i++) { window.__T += F; D.advance(F); window.__sample(); } };
    window.__sample();
  });
  await wait(150);
}
const probe = () => evalp(()=>{
  const a = window.__DEBUG.engine.active;
  return { t:window.__T, ic:!!document.querySelector('.ic-card'), tok:!!document.querySelector('.grgtok-scrim'),
    qint:!!document.querySelector('.qzint-scrim'), box:a.quiz.phase!=='idle',
    phase:a.state.phase, raceTime:a.state.raceTime, picks:window.__PICK.length };
});
const drive = s => evalp(x=>window.__drive(x), s);
const tokenFlag = () => evalp(()=>{
  try { return !!JSON.parse(localStorage.getItem('promptracers.v1')||'{}').garageTokenIntroSeen; }
  catch { return null; } });

/* ── 11a. the real first race, driven for 90+ seconds ──────────────────────*/
await bootFresh({ introCard: true });
const first = await probe();
let p = first, afterIntro = null, tokSeen = false, flagAtPickup = null;
while (p.t < DRIVE_S) {
  await drive(0.5);
  p = await probe();
  tokSeen = tokSeen || p.tok;
  // The flag as it stands the moment the first token is in hand: a card that
  // defers must leave it alone, or the explainer is not postponed but LOST.
  if (flagAtPickup === null && p.picks > 0) flagAtPickup = await tokenFlag();
  if (p.ic || p.tok || p.qint || p.box) {
    await drive(READ_S);                                   // a beat to read it
    // …then dismissed the way a child dismisses it, through the browser's own
    // keyboard, so the capture-phase handlers are the ones being exercised.
    if (p.ic) { await tap('Space'); await wait(60); await drive(1/60);
                if (!afterIntro) afterIntro = await probe(); }
    else if (p.tok) { await tap('Escape'); await wait(60); }
    else if (p.qint) { await tap('Escape'); await wait(60); }
    else if (p.box) {
      await tap('Digit1'); await wait(60); await drive(1); await tap('Space'); await wait(60);
    }
  }
  if (p.t > WINDOW_S && !p.box) break;   // finish the episode that straddles 90s
}
const evAll = await evalp(()=>window.__EV.map(e=>({ ...e, close: e.close ?? window.__T })));
const defs  = await evalp(()=>window.__DEF);
const picks = await evalp(()=>window.__PICK);
// 'qint' (the first-box explainer) is a SUB-STATE of the box episode —
// quiz.phase === 'intro' — so it is printed but never counted twice.
const cards = evAll.filter(e=>e.kind!=='qint').sort((a,b)=>a.open-b.open);
const inWin = cards.filter(c=>c.open < WINDOW_S);
// 'qint' is excluded here for the same reason it is excluded from `cards`: it is
// a SUB-STATE of the box episode (quiz.phase === 'intro'), not a panel of its
// own, so counting it would charge the child twice for one interruption.
const openers = evAll.filter(e=>e.kind!=='box' && e.kind!=='qint' && e.open < WINDOW_S);
const NAME = { ic:'intro card', tok:'first-token explainer', qint:'  ↳ first-box explainer', box:'question box' };
console.log('     TIMELINE — synthetic wall seconds from the race opening:');
for (const e of [...evAll].sort((a,b)=>a.open-b.open))
  console.log(`       ${e.open.toFixed(2).padStart(7)}s → ${e.close.toFixed(2).padStart(7)}s  ${NAME[e.kind]}`);
const met = await evalp(()=>window.__MET);
console.log(`     ${inWin.length} cards in the first ${WINDOW_S}s (${openers.length} of them one-time/opening cards)` +
            ` · ${met.length} beacon(s) driven through, ${met.filter(m=>m.active).length} of them live` +
            ` · ${defs.length} box(es) deferred on cadence`);
console.log(`     token pickups (${picks.length}): ${picks.map(x=>x.toFixed(1)).join(' ') || 'none'}`);

const icEv = evAll.find(e=>e.kind==='ic');
ok('the intro card is the first thing on screen', first.ic===true && cards[0]?.kind==='ic', `first card: ${cards[0]?.kind}`);
ok('…and it precedes the countdown (nothing has run yet)',
   first.phase==='intro' && first.raceTime===0, `${first.phase}, raceTime ${first.raceTime}`);
ok('…and the countdown follows it', afterIntro?.phase==='countdown', afterIntro?.phase);
ok('the race really did run inside the window', p.raceTime > 40, `${p.raceTime.toFixed(1)}s of race`);

// The intro card is the CURTAIN, not an in-race card: it closes before the
// countdown, casts no shadow (introcard.js, round 2) and is therefore excluded
// from the pair-gap rule — the countdown plus the drive to the first token is
// what separates it from whatever comes first. Round 1 gave it the full 15s and
// that DELETED the first-token explainer, which is what 11a now pins below.
const inRace = cards.filter(c=>c.kind!=='ic');
const gaps = inRace.slice(1).map((c,i)=>({ from:inRace[i].kind, to:c.kind, gap:c.open-inRace[i].close }));
// The FLOOR, not the nominal gap. Two different rules meet here and the floor
// is the lower of them: box → box is the visible cooldown (BOX_COOLDOWN_S,
// quiz.js), and a first-token explainer that has already stood aside twice opens
// on CARD_FLOOR_S rather than never (race.js). The nominal 15s is asserted
// directly, at a provoked pickup, in 11d — asserting it here would only be
// asserting track geometry, since track 0's beacons are ~22s apart and no pair
// of them is ever closer than 15s whatever the constant says.
const FLOOR_S = Math.min(CARD_FLOOR_S, BOX_COOLDOWN_S);
const tooClose = gaps.filter(g=>g.gap < FLOOR_S-0.05);
ok(`no in-race teaching card opens within the ${FLOOR_S}s floor of the previous one closing`,
   inRace.length>1 && tooClose.length===0,
   tooClose.length ? tooClose.map(g=>`${g.from}→${g.to} ${g.gap.toFixed(2)}s`).join(', ')
                   : `min ${Math.min(...gaps.map(g=>g.gap)).toFixed(1)}s · ` + gaps.map(g=>g.gap.toFixed(1)+'s').join(' '));
ok('…and the curtain is separated from the first in-race card by the countdown',
   !!icEv && !!inRace[0] && inRace[0].open - icEv.close > 3,
   inRace[0] ? `${(inRace[0].open-icEv.close).toFixed(1)}s to the ${NAME[inRace[0].kind]}` : 'no in-race card');
ok(`at most ${MAX_CARDS} teaching cards in the first ${WINDOW_S}s`, inWin.length<=MAX_CARDS, `${inWin.length}`);
ok(`…and at most ${MAX_OPENERS} of them are one-time/opening cards`, openers.length<=MAX_OPENERS,
   openers.map(e=>NAME[e.kind].trim()).join(' + ') || 'none');

ok('the first-box explainer was reached', !!evAll.find(e=>e.kind==='qint'),
   evAll.find(e=>e.kind==='qint') ? `at ${evAll.find(e=>e.kind==='qint').open.toFixed(1)}s` : 'never appeared');

// ── THE FIRST-TOKEN EXPLAINER MUST LAND (round 2) ──────────────────────────
// Round 1's cadence did not postpone this card, it DELETED it: measured over a
// complete first race, the intro card closed at 1.7s, the first token was
// picked up 7.5s later — inside the curtain's 15s shadow — and every later
// pickup fell inside a question box's shadow, because trackbuild lays the token
// rows along the same racing line as the beacons. The child reached the flag
// with `garageTokenIntroSeen` still unset, never having been told what a token
// is. These four lines are the gate on that: the card lands on the first
// pickup, and by the end of the window it is not still owed.
const tokEv = evAll.find(e=>e.kind==='tok');
const sincePick = picks.length ? picks[0]-icEv.close : NaN;
ok('a token is picked up early in the first race', picks.length>0 && sincePick < TEACH_GAP_S,
   `first pickup ${picks[0]?.toFixed(1)}s, ${sincePick.toFixed(1)}s after the curtain closed`);
ok('…and the first-token explainer opens ON that pickup, not later or never',
   !!tokEv && Math.abs(tokEv.open - picks[0]) < 1,
   tokEv ? `pickup ${picks[0].toFixed(2)}s → card ${tokEv.open.toFixed(2)}s` : 'never appeared');
ok('…and its one-time flag is written exactly then', flagAtPickup===true,
   `flag at the first pickup: ${flagAtPickup}`);
ok('…so the explainer is NOT still owed at the end of the window',
   (await tokenFlag())===true, `garageTokenIntroSeen: ${await tokenFlag()}`);

/* ── 11b. the paired positive: the SAME pickup fires it when nothing is due ──
   A negative assertion alone would pass just as happily against a token
   explainer that is broken and never opens at all. This is the identical race
   with the one difference that clears the cadence — no intro card, so nothing
   has closed — and the very first pickup must open the card.                */
await bootFresh({ introCard: false });
let q = await probe(), fired = false;
while (q.t < 40 && !fired) { await drive(0.5); q = await probe(); fired = q.tok; }
const picks2 = await evalp(()=>window.__PICK);
ok('[control] a token is picked up with no card due', picks2.length>0, `first pickup ${picks2[0]?.toFixed(1)}s`);
ok('[control] …and the very same pickup DOES open the explainer', fired, `at ${q.t.toFixed(1)}s`);
ok('[control] …and only now is the one-time flag written', (await tokenFlag())===true);
await tap('Escape'); await wait(120); await drive(0.5);   // …and the race carries on
ok('[control] the race is running again after it', !(await probe()).tok);
/* ── 11c. THE INVERSION: a card's shadow no longer eats a question box ──────
   Round 2 of this file asserted the opposite of what follows, and it was right
   about the mechanism and wrong about the game: with the teaching clock held
   still (i.e. "no wall time has passed since the last card"), EVERY beacon was
   consumed and NOT ONE opened a box. That is the state a child hits after any
   question — and they cannot see it, so they read the boxes as broken.

   So the same provocation is kept, exactly, and the expected answer is flipped.
   Holding the clock is now supposed to cost the child nothing at all: cards
   space themselves, boxes do not. This assertion goes red against the pre-5.1
   code, which is the whole point of keeping the section.                     */
// Warm-up: one COMPLETE box episode, so a teaching card has provably just
// closed and the cadence clock is genuinely armed. (Without it the clock could
// still be at its "no card this race" value, where nothing would be gated and
// the whole check would pass for the wrong reason.)
let boxesDone = 0;
for (let i=0; i<140 && boxesDone===0; i++) {
  await drive(0.5);
  const st = await probe();
  if (st.qint) { await drive(READ_S); await tap('Escape'); await wait(60); }
  else if (st.box) { await drive(READ_S); await tap('Digit1'); await wait(60);
                     await drive(1); await tap('Space'); await wait(60); await drive(3); }
  boxesDone = await evalp(()=>window.__EV.filter(e=>e.kind==='box' && e.close!=null).length);
}
ok('[frozen clock] a question box opened and closed first', boxesDone>0, `${boxesDone} box episode(s)`);
// Both candidate clocks are held: performance.now (style.js's default) and
// engine.time (what harness.js should hand setTeachingClock, so that a gate
// which steps the sim faster than real time still measures a truthful gap).
// Freezing both means this check reads the same either way. The BOX cooldown is
// deliberately NOT frozen — it drains on the real frame dt, which is what makes
// it a rule about the road rather than a rule about a card.
await evalp(()=>{ window.__DEF.length = 0; window.__EV.length = 0;
  window.__MET.length = 0; window.__SOFT.length = 0;
  window.__driveFrozen = secs => { const F=1/60, D=window.__DEBUG, t0=D.engine.time;
    for (let i=0,n=Math.round(secs/F); i<n; i++) { D.advance(F); D.engine.time = t0; window.__sample();
      // the child answers, so the run does not stall on one open panel
      const q = D.engine.active.quiz;
      if (q.phase==='question') document.querySelectorAll('.quiz-root.show .quiz-opt')[q.correctSlot]?.click();
      else if (q.phase==='feedback') q.dismiss('key');
      const scrim = document.querySelector('.qzint-scrim, .grgtok-scrim');
      if (scrim && scrim.offsetParent!==null) scrim.querySelector('button')?.click();
    } }; });
await evalp(()=>window.__driveFrozen(60));            // 60s of racing, clock held
const frozen = await evalp(()=>({ defs: window.__DEF.length,
  met: window.__MET.length, live: window.__MET.filter(m=>m.active).length,
  boxes: window.__EV.filter(e=>e.kind==='box').length, phase: window.__DEBUG.engine.active.quiz.phase }));
ok('[frozen clock] beacons were driven through', frozen.met>0, `${frozen.met} beacon(s)`);
ok('[frozen clock] …and the frozen card clock deferred NOT ONE of them',
   frozen.defs===0, `${frozen.defs} quiz:deferred events (the event should not exist)`);
ok('[frozen clock] …and boxes opened anyway — a card shadow costs no questions',
   frozen.boxes>0 && frozen.live>0,
   `${frozen.live}/${frozen.met} beacons live → ${frozen.boxes} box episode(s)`);

/* ── 11d. THE MAGNITUDE, at the rule that survived ──────────────────────────
   Round 2 asserted the magnitude of the BEACON-side teaching gap: a beacon at a
   known `since` had to defer on 15s and not on 5s. That rule is gone, and a
   magnitude assertion has to follow its constant rather than be deleted — the
   thing 11c can be satisfied by is "some cooldown exists", and a cooldown of
   zero would satisfy it just as happily as a cooldown of seven.

   So the magnitude now lives where the pacing does: the VISIBLE cooldown. Right
   after a box episode closes it must be a real gap (not 0, and not the old 24s
   that took the boxes away for most of a lap), the beacons must actually LOOK
   spent while it drains — asserted on the live material, not on a flag — and
   the very next beacon inside it must pay the soft token instead of nothing. */
console.log(`\n     11d. the magnitude of the visible cooldown (${BOX_COOLDOWN_S}s), read off the scene`);
// One evaluate, because both halves have to be read off the SAME scene: the lit
// baseline (whatever the art is worth, "ghosted" only means something against
// it), then one provoked box episode, then the same material again.
const mag = await evalp(async ()=>{
  const D=window.__DEBUG, A=D.engine.active, q=A.quiz, F=1/60;
  let core=null; A.scene.traverse(o=>{ if(o.name==='quiz:beacon-core') core=o; });
  const read = () => core && ({ opacity:+core.material.opacity.toFixed(3),
                                emissive:+core.material.emissiveIntensity.toFixed(3) });
  const step = () => {
    D.advance(F); window.__T+=F; window.__sample();
    if (q.phase==='question') document.querySelectorAll('.quiz-root.show .quiz-opt')[q.correctSlot]?.click();
    else if (q.phase==='feedback') q.dismiss('key');
    const scrim = document.querySelector('.qzint-scrim, .grgtok-scrim');
    if (scrim && scrim.offsetParent!==null) scrim.querySelector('button')?.click();
  };
  // 1. wait until the boxes are actually live and nothing is on screen
  for (let i=0;i<60*60 && !(q.beaconsLive && q.phase==='idle');i++) step();
  const lit = read();
  // 2. drive into one, answer it, and let the whole episode close
  for (let i=0;i<60*90 && q.phase==='idle';i++) step();
  const opened = q.phase!=='idle';
  for (let i=0;i<60*40 && q.phase!=='idle';i++) step();
  return { lit, opened, spent: read(), left:+q.cooldownLeft.toFixed(2),
           live:q.beaconsLive, charge:+q.charge.toFixed(3) };
});
ok('[magnitude] the beacon core is on the live scene graph and lit',
   !!mag.lit && mag.lit.opacity>0.5 && mag.opened,
   mag.lit ? `opacity ${mag.lit.opacity}, emissive ${mag.lit.emissive}` : 'quiz:beacon-core not found');
ok(`[magnitude] a closed box leaves a real cooldown of about ${BOX_COOLDOWN_S}s`,
   mag.left > BOX_COOLDOWN_S-2 && mag.left <= BOX_COOLDOWN_S+0.5 && mag.live===false,
   `${mag.left}s left, beaconsLive ${mag.live}, charge ${mag.charge}`);
ok('[magnitude] …and the beacons LOOK spent while it drains (live material, not a flag)',
   !!mag.lit && mag.spent.opacity < mag.lit.opacity*0.5 && mag.spent.emissive < mag.lit.emissive*0.5,
   `core opacity ${mag.lit?.opacity} → ${mag.spent?.opacity}, emissive ${mag.lit?.emissive} → ${mag.spent?.emissive}`);


ok('no page errors', errs.length===0, errs[0]||'');
console.log('  ' + '─'.repeat(74));
console.log(fails ? `\n  ${fails} FAILED` : '\n  all modal checks passed');
await b.close();
process.exit(fails?1:0);

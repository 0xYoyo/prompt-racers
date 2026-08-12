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
const dist = process.argv[2] || '/Users/yoyopc/repos/kart-project/dist/index.html';
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

// (trimmed copy: sections 9 and 10 only, for mutation/bite checks)

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
  const opened = await vis('.quiz-root.show');
  const box = await boxOf('.quiz-root.show .quiz-opt', 2);   // the THIRD option
  if (via==='key') await tap('Digit3');
  else if (via==='click') await clickAt(box);
  else await tapAt(box);
  await wait(100);
  const answered = await quizState();
  await evalp(()=>window.__DEBUG.advance(1));                // past the arming delay
  if (via==='key') await tap('Space');
  else {
    const cont = await boxOf('.quiz-root.show .quiz-cont');
    if (via==='click') await clickAt(cont); else await tapAt(cont);
  }
  await wait(100);
  const resumed = { phase: await quizPhase(), gone: !(await has('.quiz-root.show')),
                    input: await evalp(()=>window.__DEBUG.engine.active.input.enabled) };
  return { opened, box, answered, resumed };
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
ok('answer targets are big enough for a child\'s finger', K.box.h>=44 && K.box.w>=240,
   `${Math.round(K.box.w)}×${Math.round(K.box.h)}px`);
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
await tap('Escape'); await wait(220);
await clickAt(optBox); await wait(140);
ok('…and the very same click answers once the pause menu is gone',
   await has('.quiz-root.show .quiz-card.quiz-answered'));
// Same story for the continue button, and for the arming delay that stops the
// press which ANSWERED from also dismissing.
const contBox = await boxOf('.quiz-root.show .quiz-cont');
ok('the continue button is a finger-sized target too', contBox && contBox.h>=44,
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
ok('…and the world is frozen behind it, input gated off, like any quiz panel',
   await evalp(()=>window.__DEBUG.engine.active.quiz.frozen===true
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
                 banked:a.state.tokens-t0, boosting:!!a.player.boosting });
      q.close();
    }
    return out;
  });
  const good = pay.filter(p=>p.correct), bad = pay.filter(p=>!p.correct);
  ok('both outcomes were sampled', good.length>0 && bad.length>0,
     `${good.length} right, ${bad.length} wrong`);
  ok('a right answer really does pay tokens AND a turbo',
     good.length>0 && good.every(p=>p.tokens>=3 && p.banked===p.tokens && p.boosting),
     good.map(p=>`+${p.banked}`).join(' '));
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

ok('no page errors', errs.length===0, errs[0]||'');
console.log('  ' + '─'.repeat(74));
console.log(fails ? `\n  ${fails} FAILED` : '\n  all modal checks passed');
await b.close();
process.exit(fails?1:0);

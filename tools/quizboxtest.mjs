// ═════════════════════════════════════════════════════════════════════════════
// QUESTION-BOX PICKUP RULES — the gate on "a child can always tell why a box
// did or did not fire". Wave 5.1.
// ═════════════════════════════════════════════════════════════════════════════
//
// WHAT WENT WRONG, so this file's shape makes sense. Wave 5 put a teaching-card
// cadence gate at the BEACON (quiz.js): a box driven through inside another
// card's shadow was CONSUMED — `alive=false`, respawn armed — and opened
// nothing. Stacked on the D16 answered/ignored cooldowns, roughly two boxes in
// three ate themselves silently and the first boxes of a championship fired
// nothing at all. Every existing gate stayed green, because every existing gate
// measured what happened when a box DID open.
//
// So this file measures the other thing: what happens when a child drives
// through a beacon. The contract it pins, in the order the sections below run:
//
//   1. the FIRST box of EVERY race is live — races 1, 2 and 3, from a fresh save
//   2. the one-time explainer appears exactly ONCE EVER — race 1's first box,
//      never again in a later race and never again in a later session
//   3. while the cooldown drains the beacons are visibly INACTIVE (asserted on
//      the live material and the live scene graph, not on a flag), driving
//      through one opens NO modal, pays NO currency, and shaves the recharge
//   4. when the cooldown ends the beacons come back with a visible pop, and the
//      next beacon opens a question
//   5. a teaching card standing in a box's way costs the child NOTHING: no
//      consumed beacon, no cooldown, no `quiz:deferred`
//   6. the cadence: over three real engaged races, MOST of the beacons a child
//      drives through open a question — AND enough boxes open in absolute terms
//      that the game is still full (a ratio alone gets greener as the track
//      empties; see the note over section 6)
//   7. the recharge gauge exists at the LOW quality tier, which is a tier real
//      children play on
//
// Everything here runs against the REAL BUILD through puppeteer and synthetic
// input, exactly as tools/modaltest.mjs and tools/flowtest.mjs do, because the
// bug this file exists for lived in the seam between quiz.js and race.js and a
// unit test cannot see a seam. `--dist <path>` points it at a different build,
// which is how the "does this gate bite?" run is done without leaving a
// deliberately broken dist/index.html in a tree other agents share.
// ═════════════════════════════════════════════════════════════════════════════
import puppeteer from 'puppeteer-core';

const distArg = process.argv.indexOf('--dist');
const dist = distArg > 0 && process.argv[distArg + 1]
  ? process.argv[distArg + 1]
  : '/Users/yoyopc/repos/kart-project/dist/index.html';

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push('' + e.message));
await page.setViewport({ width: 1366, height: 768 });

let fails = 0;
const ok = (n, v, d = '') => {
  if (!v) fails++;
  console.log(`  ${v ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n.padEnd(62)} ${d}`);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const evalp = (fn, ...a) => page.evaluate(fn, ...a);
// A gate that THROWS reports one red and hides every other one behind it, which
// is exactly the wrong shape for the "does this bite?" run — the whole point of
// that run is to see WHICH assertions the old behaviour breaks. So every
// in-page block is guarded: a throw becomes an empty result, the assertions
// downstream read undefined and go red one by one, and the run finishes.
async function guarded(label, fn, ...a) {
  try { return await page.evaluate(fn, ...a); }
  catch (e) { ok(label, false, `page threw: ${String(e.message).split('\n')[0].slice(0, 88)}`); return {}; }
}

const SAVE_KEY = 'promptracers.v1';

/* ── the in-page rig ───────────────────────────────────────────────────────────
   Everything that has to be timed to a frame runs INSIDE the page. A beacon
   encounter is a single fixed step wide; a round trip is a hundred of them.   */
async function installRig() {
  await evalp(() => {
    const D = window.__DEBUG;
    window.__MET = [];        // every quiz:beacon — live or recharging
    window.__SOFT = [];       // every quiz:softToken
    window.__OPEN = [];       // every quiz:open
    window.__DEF = [];        // quiz:deferred — MUST stay empty (the event is gone)
    window.__RECHARGED = [];  // every quiz:recharged
    window.__PICK = [];       // every token:pickup
    // How many times the one-time explainer has APPEARED, counted on the
    // rising edge and sampled every fixed step from inside the drive loops.
    // It deliberately survives installRig() — "exactly once EVER" is a claim
    // across races, and a counter that resets per race cannot make it. (A
    // setInterval cannot: the drives below are synchronous page.evaluate calls,
    // so no timer ever runs while a race is being driven, and a counter fed by
    // one would read 0 whatever the game did.)
    window.__INTRO_SEEN = window.__INTRO_SEEN || 0;
    window.__introUp = window.__introUp || false;
    window.__sampleIntro = () => {
      const up = !!document.querySelector('.qzint-scrim');
      if (up && !window.__introUp) window.__INTRO_SEEN++;
      window.__introUp = up;
      return up;
    };
    D.bus.on('quiz:beacon', e => window.__MET.push({ active: !!e.active, charge: e.charge, i: e.i }));
    D.bus.on('quiz:softToken', e => window.__SOFT.push({ i: e.i }));
    D.bus.on('quiz:open', e => window.__OPEN.push(e.id));
    D.bus.on('quiz:deferred', e => window.__DEF.push(e));
    D.bus.on('quiz:recharged', () => window.__RECHARGED.push(1));
    D.bus.on('token:pickup', e => window.__PICK.push(e.tokens));

    const A = () => D.engine.active || {};
    // The beacon meshes are NAMED in quiz.js precisely so a gate can read the
    // real scene graph. "The beacons look spent" is a claim about a material and
    // an instance matrix, and nothing else can honestly check it.
    window.__beaconMesh = name => { let m = null; A().scene?.traverse(o => { if (o.name === name) m = o; }); return m; };
    /** The lit/ghosted state of the beacon art, straight off the live scene. */
    window.__art = () => {
      const core = window.__beaconMesh('quiz:beacon-core');
      if (!core) return null;
      const sats = window.__beaconMesh('quiz:beacon-sats');
      // THE RECHARGE GAUGE is a constant-diameter circle (quiz:beacon-ringtrack)
      // with an arc filling it (quiz:beacon-ring, truncated by its draw range).
      // So there are two numbers, and they must move in opposite ways: the FILL
      // rises with the charge, the DIAMETER does not move at all. Round 1 drew
      // the charge as the diameter, with nothing to read it against.
      const ring = window.__beaconMesh('quiz:beacon-ring');
      const ringTrack = window.__beaconMesh('quiz:beacon-ringtrack');
      let ringScale = null, ringFill = null;
      if (ring) {
        // the ring billboards to the camera, so the uniform scale is the length
        // of a basis column rather than a single element
        const a = ring.instanceMatrix.array;
        let best = 0;
        for (let i = 0; i < ring.count; i++) {
          const s = Math.hypot(a[i * 16 + 0], a[i * 16 + 1], a[i * 16 + 2]);
          if (s > best) best = s;                       // the biggest LIVE beacon
        }
        ringScale = +best.toFixed(4);
        const idx = ring.geometry.index ? ring.geometry.index.count : 0;
        const drawn = ring.visible ? Math.min(ring.geometry.drawRange.count, idx) : 0;
        ringFill = idx ? +(drawn / idx).toFixed(4) : null;
      }
      const q = A().quiz;
      return {
        opacity: +core.material.opacity.toFixed(4),
        emissive: +core.material.emissiveIntensity.toFixed(4),
        satOpacity: sats ? +sats.material.opacity.toFixed(4) : null,
        ringScale, ringFill, ringTrack: !!ringTrack,
        trackOpacity: ringTrack ? +ringTrack.material.opacity.toFixed(4) : null,
        live: q.beaconsLive, charge: +q.charge.toFixed(4), left: +q.cooldownLeft.toFixed(3),
      };
    };
    /** How many beacons are currently ALIVE on the track. */
    window.__aliveCount = () => {
      const core = window.__beaconMesh('quiz:beacon-core');
      if (!core) return null;
      const a = core.instanceMatrix.array;
      let n = 0;
      for (let i = 0; i < core.count; i++) {
        if (Math.hypot(a[i * 16 + 0], a[i * 16 + 2]) > 0.5) n++;
      }
      return n;
    };
    /** World position of one ALIVE beacon (scale ≈ 1; a consumed one is 1e-4). */
    window.__aliveBeacon = () => {
      const core = window.__beaconMesh('quiz:beacon-core');
      if (!core) return null;
      const a = core.instanceMatrix.array;
      for (let i = 0; i < core.count; i++) {
        const s = Math.hypot(a[i * 16 + 0], a[i * 16 + 2]);
        if (s > 0.5) return { i, x: a[i * 16 + 12], y: a[i * 16 + 13], z: a[i * 16 + 14] };
      }
      return null;
    };
    /** Put the kart on an alive beacon and step ONE frame. Deterministic: the
     *  real findHit() is what decides, so this exercises the shipping path — it
     *  just does not require luck to arrive there. */
    window.__touchBeacon = () => {
      const bn = window.__aliveBeacon();
      if (!bn || !A().player) return null;
      const p = A().player.position;
      p.x = bn.x; p.z = bn.z;
      const before = window.__MET.length;
      D.advance(1 / 60);
      return window.__MET.length > before ? window.__MET[window.__MET.length - 1] : null;
    };
    /** Drive n seconds, answering every question correctly and dismissing every
     *  one-time card — an engaged child, sampled every fixed step. */
    window.__drive = (secs, onFrame) => {
      const F = 1 / 60, q = () => A().quiz;
      for (let i = 0, n = Math.round(secs / F); i < n; i++) {
        D.advance(F);
        window.__sampleIntro();
        const Q = q();
        if (!Q) break;                            // the scene left (results, podium)
        if (Q.phase === 'question') document.querySelectorAll('.quiz-root.show .quiz-opt')[Q.correctSlot]?.click();
        else if (Q.phase === 'feedback') Q.dismiss('key');
        const scrim = document.querySelector('.qzint-scrim, .grgtok-scrim, .ic-scrim');
        if (scrim && scrim.offsetParent !== null) scrim.querySelector('button')?.click();
        if (onFrame) onFrame(i);
      }
    };
  });
}

/** A cold load. `save` is written before the reload, so the game boots with it. */
async function boot(save) {
  await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((k, v) => localStorage.setItem(k, JSON.stringify(v)), SAVE_KEY, save);
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
}
async function startRace(opts) {
  await evalp(o => window.__DEBUG.goto('race', o), { autopilot: true, introCard: false, ...opts });
  await wait(200);
  await installRig();
}
const savedFlag = () => evalp(k => {
  try { return !!JSON.parse(localStorage.getItem(k) || '{}').quizBoxIntroSeen; } catch { return null; }
}, SAVE_KEY);

console.log('\n  QUESTION-BOX PICKUP RULES (Wave 5.1)\n  ' + '─'.repeat(76));

/* ═══════════════════════════════════════════════════════════════════════════
   1 + 2. THE FIRST BOX OF EVERY RACE, AND THE EXPLAINER THAT COMES ONCE
   A fresh save, then races 1, 2 and 3 back to back on the same save — which is
   what a championship is from the quiz's point of view. For each race: drive
   until the FIRST beacon is met and assert it was live and that a question
   really opened. Against the pre-5.1 build the first beacons of a fresh
   championship were consumed by the teaching-card gate and opened nothing,
   which is exactly what this section reads as red.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n  1. the first box of every race is live');
await boot({ racerId: 'nitzotz', results: [], championshipRace: 0, garageMetBoreg: true });
const firstBox = [];
for (let race = 0; race < 3; race++) {
  await startRace({ track: race, difficulty: race + 1 });
  const r = await guarded(`race ${race + 1}: the first beacon met is LIVE and opens a box`, () => new Promise(res => {
    const D = window.__DEBUG, F = 1 / 60;
    // drive until the first beacon is met (or we run out of race)
    const A = () => D.engine.active;
    for (let i = 0; i < 60 * 240; i++) {
      D.advance(F);
      window.__sampleIntro();
      const Q = A().quiz;
      const scrim = document.querySelector('.qzint-scrim, .grgtok-scrim');
      if (window.__MET.length) {
        const met = window.__MET[0];
        // give the panel a frame or two to actually exist
        for (let k = 0; k < 4; k++) { D.advance(F); window.__sampleIntro(); }
        const Q2 = A().quiz;
        return res({
          met, phase: Q2.phase, opens: window.__OPEN.length,
          introUp: !!document.querySelector('.qzint-scrim'),
          introSeen: window.__INTRO_SEEN || 0,
          panel: !!document.querySelector('.quiz-root.show') || !!document.querySelector('.qzint-scrim'),
        });
      }
      if (scrim && scrim.offsetParent !== null) scrim.querySelector('button')?.click();
      if (Q.phase === 'question') document.querySelectorAll('.quiz-root.show .quiz-opt')[Q.correctSlot]?.click();
      else if (Q.phase === 'feedback') Q.dismiss('key');
    }
    res({ met: null });
  }));
  firstBox.push(r || {});
  ok(`race ${race + 1}: the first beacon met is LIVE and opens a box`,
    !!r.met && r.met.active === true && r.phase !== 'idle' && r.panel === true,
    r.met ? `active=${r.met.active}, quiz phase '${r.phase}', panel ${r.panel}` : 'no beacon was ever met');
  // …and then play the race out far enough that the explainer, if it is owed,
  // has had every chance to appear.
  await evalp(() => window.__drive(60));
}

console.log('\n  2. the one-time explainer, exactly once EVER');
ok('race 1 showed the explainer at its first box',
  firstBox[0]?.introUp === true && firstBox[0]?.introSeen >= 1,
  `introUp=${firstBox[0]?.introUp}, seen=${firstBox[0]?.introSeen}`);
ok('…and the save flag was written', (await savedFlag()) === true);
const introTotal = await evalp(() => window.__INTRO_SEEN || 0);
ok('races 2 and 3 never showed it again', firstBox[1]?.introUp === false && firstBox[2]?.introUp === false,
  `race 2 ${firstBox[1]?.introUp}, race 3 ${firstBox[2]?.introUp}`);
// The counter runs across all three races and is never reset, so this is the
// "exactly once" claim itself rather than three separate glances at it.
ok('…so the explainer appeared EXACTLY ONCE across races 1–3', introTotal === 1,
  `${introTotal} appearance(s)`);
// A LATER SESSION: a full reload off the same localStorage, which is the only
// thing that proves the flag is persisted rather than held in memory.
await page.reload({ waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
await startRace({ track: 0, difficulty: 1 });
const later = await guarded('a LATER SESSION never shows it again', () => {
  window.__drive(90);
  return { intro: window.__INTRO_SEEN || 0, opens: window.__OPEN.length, met: window.__MET.length };
});
ok('a LATER SESSION never shows it again', later.intro === 0,
  `${later.intro} explainer(s) in a new session · ${later.opens} boxes opened, ${later.met} beacons met`);
ok('…and that later session still opens boxes (the flag did not disable them)',
  later.opens > 0 && later.met > 0, `${later.opens}/${later.met}`);
console.log(`     (explainer appearances across the whole run so far: ${introTotal + later.intro})`);

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE COOLDOWN IS A THING YOU CAN SEE
   A cooldown is allowed to exist only because it is legible, so this reads the
   claim off the live scene: the core material's opacity and emissive, the
   satellites' opacity, and the recharge ring's instance scale. Then it drives
   through a recharging beacon and asserts the three things a child experiences:
   no panel, a token, and a beacon that comes back.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n  3. a recharging box is visibly inactive, and pays instead of opening');
await boot({ racerId: 'nitzotz', results: [], championshipRace: 0,
  garageMetBoreg: true, garageTokenIntroSeen: true, quizBoxIntroSeen: true });
await startRace({ track: 0, difficulty: 1 });
const cool = await guarded('a recharging beacon could be reached at all', () => {
  const D = window.__DEBUG, A = () => D.engine.active, F = 1 / 60;
  const q = A().quiz;
  window.__drive(6);                                  // clear the countdown
  const lit = window.__art();
  // One real box episode, opened at a real beacon, answered and closed — the
  // only way to arm the cooldown that a child can produce.
  for (let i = 0; i < 60 * 240 && q.phase === 'idle'; i++) window.__drive(F);
  const openedAtBeacon = q.phase !== 'idle';
  for (let i = 0; i < 60 * 60 && q.phase !== 'idle'; i++) window.__drive(F);
  const spent = window.__art();
  // Half-drained, so the recharge ring has a middle to be measured at.
  window.__drive(2.5);
  const half = window.__art();
  // …and now drive through a beacon while it is still recharging.
  const tokensBefore = A().state.tokens;
  const picksBefore = window.__PICK.length;
  const softBefore = window.__SOFT.length;
  const preTouch = window.__art();
  const met = window.__touchBeacon();
  const during = window.__art();
  D.advance(F);
  return {
    lit, spent, half, preTouch, during, met, openedAtBeacon,
    phaseAfter: A().quiz.phase,
    panelAfter: !!document.querySelector('.quiz-root.show') || !!document.querySelector('.qzint-scrim'),
    tokenDelta: A().state.tokens - tokensBefore,
    picks: window.__PICK.length - picksBefore,
    softs: window.__SOFT.length - softBefore,
    opensAfter: window.__OPEN.length,
  };
});
ok('a real beacon opened a real box (the cooldown was armed the way a child arms it)',
  cool.openedAtBeacon === true && cool.spent?.live === false,
  `beaconsLive ${cool.lit?.live} → ${cool.spent?.live}, ${cool.spent?.left}s left`);
ok('the beacons GHOST while it drains — core opacity and emissive, on the live material',
  cool.spent?.opacity < cool.lit?.opacity * 0.5 && cool.spent?.emissive < cool.lit?.emissive * 0.5,
  `opacity ${cool.lit?.opacity} → ${cool.spent?.opacity} · emissive ${cool.lit?.emissive} → ${cool.spent?.emissive}`);
ok('…the satellites ghost with it (the whole beacon reads as off, not half of it)',
  cool.spent?.satOpacity != null && cool.spent.satOpacity < cool.lit?.satOpacity * 0.5,
  `${cool.lit?.satOpacity} → ${cool.spent?.satOpacity}`);
ok('…but it does not VANISH — a beacon a child stops seeing is a beacon they stop looking for',
  cool.spent?.opacity > 0.05, `core opacity ${cool.spent?.opacity}`);
// THE RECHARGE GAUGE: a circle that is always whole and always the same size,
// with an arc filling it. Both halves are asserted, because each without the
// other is the round-1 failure: a bare growing arc has nothing to be read
// against, and a bare circle says nothing about how far along it is.
ok('the recharge ARC fills as the cooldown drains',
  cool.half?.ringFill > cool.spent?.ringFill + 0.15 && cool.half?.charge > cool.spent?.charge + 0.1,
  `fill ${cool.spent?.ringFill} → ${cool.half?.ringFill} as charge ${cool.spent?.charge} → ${cool.half?.charge}`);
ok('…and the arc is short while it is still charging (a full circle means GO)',
  cool.half?.ringFill < 0.9 && cool.lit?.ringFill >= 0.999,
  `charging ${cool.half?.ringFill} vs live ${cool.lit?.ringFill}`);
ok('…and there is a full-size circle to read it AGAINST, always drawn',
  cool.spent?.ringTrack === true && cool.spent?.trackOpacity > 0.05,
  `track ring present ${cool.spent?.ringTrack}, opacity ${cool.spent?.trackOpacity}`);
ok('…and the gauge never changes SIZE — the diameter carries no information',
  cool.spent?.ringScale > 0 && Math.abs(cool.half?.ringScale - cool.spent?.ringScale) < 0.06
  && Math.abs(cool.lit?.ringScale - cool.spent?.ringScale) < 0.12,
  `empty ${cool.spent?.ringScale} · half ${cool.half?.ringScale} · live ${cool.lit?.ringScale}`);
// Driving through one.
ok('driving through a recharging beacon registers as an INACTIVE encounter',
  !!cool.met && cool.met.active === false, cool.met ? `active=${cool.met.active}` : 'no beacon was hit');
ok('…and opens NO modal at all', cool.phaseAfter === 'idle' && cool.panelAfter === false,
  `quiz phase '${cool.phaseAfter}', panel ${cool.panelAfter}`);
// WHAT THE SOFT PICKUP PAYS, AND WHAT IT MUST NOT. Round 1 paid one token here.
// That made beacon income "how many beacons did you touch" rather than "how many
// questions did you answer", and the only way back under D51's 21-token top ask
// was to put fewer beacons on the track — which cost 10 questions a
// championship. So the payment is TIME: the recharge is shaved, every gauge on
// the track jumps forward, and the wallet is not touched. Both halves are
// asserted, because the currency version passes any test that only counts the
// event.
ok('…and it is announced, once, as a soft encounter',
  cool.softs === 1 && !!cool.met && cool.met.active === false,
  `${cool.softs} quiz:softToken`);
ok('…and pays NO CURRENCY — the wallet does not move for touching a ghosted box',
  cool.tokenDelta === 0 && cool.picks === 0,
  `+${cool.tokenDelta} token, ${cool.picks} token:pickup`);
ok('…and instead SHAVES the recharge, visibly: the arc jumps forward',
  cool.preTouch?.left - cool.during?.left > 0.5
  && cool.during?.ringFill > cool.preTouch?.ringFill + 0.02,
  `${cool.preTouch?.left}s → ${cool.during?.left}s left · fill ${cool.preTouch?.ringFill} → ${cool.during?.ringFill}`);
// RESPAWN IS RACING TIME. A consumed beacon must not come back while the world
// is frozen behind a panel — the same rule the lap clock obeys (D11/D20). It is
// not a nicety: a timed-out question burns 20 wall seconds, so on a wall clock
// the child who IGNORED every box got their beacons back fastest and, now that
// every beacon pays a token, got paid most for ignoring the game. Measured: it
// was worth a whole token of the disengaged wallet, which is the margin that
// keeps a hoarder under the 21-token top ask in flowtest's E2.
const respawn = await guarded('the frozen-panel respawn rule could be exercised', () => {
  const D = window.__DEBUG, A = () => D.engine.active, F = 1 / 60;
  const q = A().quiz;
  // wait out the cooldown, then open a box at a real beacon and HOLD it
  for (let i = 0; i < 60 * 90 && q.phase === 'idle'; i++) {
    D.advance(F);
    if (q.phase === 'idle' && q.beaconsLive) window.__touchBeacon();
  }
  const opened = q.phase !== 'idle';
  const before = window.__aliveCount();
  for (let i = 0; i < 60 * 40; i++) D.advance(F);      // 40s frozen, reading
  const during = window.__aliveCount();
  const stillFrozen = q.phase !== 'idle';
  // …and hand the world back the way a child does, so section 4 starts from the
  // state it is about: a freshly armed, freshly ghosted cooldown.
  for (let i = 0; i < 60 * 60 && q.phase !== 'idle'; i++) {
    D.advance(F);
    if (q.phase === 'question') document.querySelectorAll('.quiz-root.show .quiz-opt')[q.correctSlot]?.click();
    else if (q.phase === 'feedback') q.dismiss('key');
  }
  return { opened, before, during, stillFrozen, closed: q.phase === 'idle', ghosted: !q.beaconsLive };
});
ok('a beacon does NOT respawn while the world is frozen behind a panel',
  respawn.opened === true && respawn.stillFrozen === true && respawn.during === respawn.before,
  `${respawn.before} alive → ${respawn.during} after 40s frozen (panel still up: ${respawn.stillFrozen})`);
ok('…and the episode then closes into a fresh, ghosted cooldown',
  respawn.closed === true && respawn.ghosted === true,
  `closed ${respawn.closed}, ghosted ${respawn.ghosted}`);

// The anti-farm rule: a beacon pays once per life, exactly like a gold token.
const farm = await guarded('the consumed beacon could be re-driven', () => {
  const D = window.__DEBUG, A = () => D.engine.active;
  const t0 = A().state.tokens, s0 = window.__SOFT.length, c0 = A().quiz.cooldownLeft;
  // sit on the beacon we just consumed for two full seconds
  for (let i = 0; i < 120; i++) D.advance(1 / 60);
  return { delta: A().state.tokens - t0, softs: window.__SOFT.length - s0,
    drained: +(c0 - A().quiz.cooldownLeft).toFixed(3) };
});
ok('…and it cannot be farmed: sitting on the consumed beacon pays nothing more',
  farm.delta === 0 && farm.softs === 0, `+${farm.delta} tokens, ${farm.softs} soft payouts in 2s`);
// …including the shave, which is the reward that actually exists now: two
// seconds of sitting on a spent beacon must drain exactly two seconds of clock.
ok('…and the SHAVE cannot be farmed either: 2s parked drains 2s of recharge, no more',
  farm.drained <= 2.1, `${farm.drained}s drained in 2s`);

/* ═══════════════════════════════════════════════════════════════════════════
   4. AND THEN IT COMES BACK, VISIBLY
   A silent swap from ghosted to lit is the same class of bug as a silent
   refusal: the child has to be able to see the moment the boxes are usable
   again. So the frames around the transition are sampled and the transition is
   asserted to be a step plus an overshoot, not a fade nobody notices.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n  4. the boxes come back, and you can see it happen');
const back = await guarded('the recharge could be watched', () => {
  const D = window.__DEBUG, A = () => D.engine.active, F = 1 / 60;
  const q = A().quiz;
  const trace = [];
  const rechargedBefore = window.__RECHARGED.length;
  for (let i = 0; i < 60 * 30; i++) {
    D.advance(F);
    const a = window.__art();
    trace.push({ live: a.live, opacity: a.opacity, emissive: a.emissive, ring: a.ringFill });
    if (window.__RECHARGED.length > rechargedBefore && trace.length > 2
        && trace[trace.length - 1].live && q.phase === 'idle') {
      // …plus a few more frames so the pop itself is inside the trace
      for (let k = 0; k < 30; k++) {
        D.advance(F);
        const c = window.__art();
        trace.push({ live: c.live, opacity: c.opacity, emissive: c.emissive, ring: c.ringFill });
      }
      break;
    }
  }
  const iLive = trace.findIndex(t => t.live);
  const minRing = trace.reduce((m, t) => Math.min(m, t.ring ?? 1), 1);
  const ghost = iLive > 0 ? trace[iLive - 1] : null;
  const litAfter = trace.slice(iLive).reduce((m, t) => (t.emissive > m.emissive ? t : m), trace[iLive]);
  const settled = trace[trace.length - 1];
  // Now the promise the whole thing is for: the next beacon opens a question.
  const opensBefore = window.__OPEN.length;
  const met = window.__touchBeacon();
  for (let k = 0; k < 4; k++) D.advance(F);
  return {
    recharged: window.__RECHARGED.length - rechargedBefore,
    ghost, litAfter, settled, iLive, minRing: +minRing.toFixed(4),
    met, opened: window.__OPEN.length - opensBefore,
    phase: A().quiz.phase,
    panel: !!document.querySelector('.quiz-root.show'),
  };
});
ok('the cooldown ending is announced, not inferred', back.recharged >= 1, `${back.recharged} quiz:recharged`);
ok('the re-activation is a visible STEP, not a silent swap',
  !!back.ghost && back.litAfter?.opacity > back.ghost.opacity * 2.5
  && back.litAfter?.emissive > back.ghost.emissive * 3,
  back.ghost ? `opacity ${back.ghost.opacity} → ${back.litAfter?.opacity}, emissive ${back.ghost.emissive} → ${back.litAfter?.emissive}` : 'never saw the ghosted frame');
ok('…and it POPS: the brightest frame after it overshoots where it settles',
  back.litAfter?.emissive > back.settled?.emissive * 1.15,
  `peak ${back.litAfter?.emissive} vs settled ${back.settled?.emissive}`);
// The arc filled up on the way here (it is nearly full on the last ghosted
// frame by definition — that is what "nearly recharged" looks like), and it is a
// WHOLE circle once the boxes are live.
ok('…and the arc filled, and is a full circle now the boxes are live',
  back.minRing < 0.6 && back.settled?.ring >= 0.999,
  `arc ${back.minRing} → ${back.settled?.ring}`);
ok('THE PROMISE: the very next beacon opens a question',
  !!back.met && back.met.active === true && back.opened === 1 && back.panel === true,
  back.met ? `active=${back.met.active}, ${back.opened} opened, phase '${back.phase}'` : 'no beacon hit');

/* ═══════════════════════════════════════════════════════════════════════════
   5. A TEACHING CARD NEVER COSTS A BOX
   This is the regression itself, provoked deterministically. Holding the
   teaching clock still IS the state "a card closed a moment ago and its gap has
   not passed" — the exact state that used to eat beacons. Against the pre-5.1
   build every beacon here is consumed and none of them opens.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n  5. a teaching card\'s cadence never consumes a box or starts a cooldown');
await boot({ racerId: 'nitzotz', results: [], championshipRace: 0,
  garageMetBoreg: true, garageTokenIntroSeen: true, quizBoxIntroSeen: true });
// performance.now is what ui/style.js reads by default; engine.time is what
// harness.js hands setTeachingClock. Freeze both, so the check reads the same
// whichever one is live.
await evalp(() => { window.__T = 0; performance.now = () => window.__T * 1000; });
await startRace({ track: 0, difficulty: 1 });
const shadow = await guarded('a box episode could be driven under a frozen card clock', () => {
  const D = window.__DEBUG, A = () => D.engine.active, F = 1 / 60;
  const q = A().quiz;
  window.__drive(6);
  // Cast a shadow the honest way: one complete box episode, which is what calls
  // noteTeachingCard(). Then pin BOTH clocks to the moment it closed, so from
  // the cadence's point of view no wall time ever passes again.
  for (let i = 0; i < 60 * 240 && q.phase === 'idle'; i++) window.__drive(F);
  for (let i = 0; i < 60 * 60 && q.phase !== 'idle'; i++) window.__drive(F);
  const t0 = D.engine.time;
  window.__MET.length = 0; window.__OPEN.length = 0; window.__DEF.length = 0;
  // Wait out the visible cooldown (the ONE legitimate reason to decline) with
  // the teaching clock nailed down, then touch a beacon.
  for (let i = 0; i < 60 * 60 && !q.beaconsLive; i++) { D.advance(F); D.engine.time = t0; }
  const beforeCooldown = +q.cooldownLeft.toFixed(3);
  const met = window.__touchBeacon();
  D.engine.time = t0;
  for (let k = 0; k < 4; k++) { D.advance(F); D.engine.time = t0; }
  const opened = window.__OPEN.length;
  const phase = q.phase;
  // …and play the whole rest of the race out with the clock still frozen.
  for (let i = 0; i < 60 * 120; i++) { window.__drive(F); D.engine.time = t0; }
  return {
    beforeCooldown, met, opened, phase,
    defs: window.__DEF.length,
    totalMet: window.__MET.length,
    totalLive: window.__MET.filter(m => m.active).length,
    totalOpened: window.__OPEN.length,
  };
});
ok('with the teaching clock frozen, the cooldown still reaches zero on its own',
  shadow.beforeCooldown === 0, `${shadow.beforeCooldown}s left`);
ok('…a beacon met inside the card shadow is LIVE and opens a box',
  !!shadow.met && shadow.met.active === true && shadow.opened === 1 && shadow.phase !== 'idle',
  shadow.met ? `active=${shadow.met.active}, ${shadow.opened} opened, phase '${shadow.phase}'` : 'no beacon hit');
ok('…the beacon-side deferral is GONE — quiz:deferred is never emitted',
  shadow.defs === 0, `${shadow.defs} quiz:deferred`);
ok('…and over a whole frozen-clock race the boxes keep firing',
  shadow.totalMet > 0 && shadow.totalLive / shadow.totalMet >= 0.5 && shadow.totalOpened >= 3,
  `${shadow.totalLive}/${shadow.totalMet} beacons live → ${shadow.totalOpened} boxes`);

/* ═══════════════════════════════════════════════════════════════════════════
   6. THE CADENCE — the number the whole pass is about
   Three real engaged races, one per track, driven on the game's own autopilot
   with every question answered correctly. What is measured is the fraction of
   the beacons a child drove through that actually asked them something.

   TWO FLOORS, AND THE SECOND ONE IS THE IMPORTANT ONE.

   The RATIO floor is what round 1 shipped: of the beacons a child drove
   through, how many asked them something. Measured on this build: 67% / 80% /
   73% (8/12, 8/10, 8/11 — tracks 0/1/2, seed 3), 73% overall; across three
   seeds and nine races it spans 55%–80%, 70% overall. Against a mutant that
   restores ONLY the Wave-5 beacon-side cadence gate: 38% / 67% / 50%, 49%
   overall, every miss invisible to the child. Floor 0.55 per race, 0.65 across
   the three.

   THE ABSOLUTE FLOOR EXISTS BECAUSE THE RATIO ALONE GETS GREENER AS THE GAME
   GETS EMPTIER. A critic built a starvation mutant — RESPAWN_S 60 → 150 and
   nothing else, i.e. beacons that barely come back — and the entire gate passed
   with the RATIO IMPROVING to 82% while the child answered 14 questions instead
   of 20. A ratio is a fraction of whatever is left on the track; halve the
   track and it rises. So the count itself is asserted: boxes OPENED per race
   and across the three. Measured here: 8 / 8 / 8 = 24 (Wave 4, the feel this
   pass is chasing back: 8 / 8 / 8 = 24; the broken build: 6 / 6 / 6 = 18; the
   starvation mutant: 5 / 5 / 4 = 14). Floors 7 per race and 22 across the
   three — under Wave 4 with room for seed and AI drift, above everything that
   has ever been wrong here.

   Both are floors to be FAILED rather than widened: what they really watch for
   is a second silent reason for a box to decline, and a retune that pays for
   the rate by emptying the track.

   Against the pre-5.1 build this section does not merely dip below the floor:
   `quiz:beacon` does not exist there, so no encounter is ever recorded and the
   assertion has nothing to divide by. That is a legitimate red — a build that
   cannot say how many boxes a child drove through is a build in which the bug
   is unobservable, which is how it shipped.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n  6. the cadence: most of the boxes a child drives through are live');
// WHY THE PER-RACE FLOORS ARE LOW AND THE TOTALS CARRY THE ASSERTION.
// Running three seeds instead of one immediately falsified the per-race floors
// this section shipped with (7 opened, 0.55 ratio): seed 11 track 0 measures
// 6/11 = 54.5%, and it fails BOTH. It is not a regression — Wave 4 opened 6 on
// that same seed and track. A single race's count is a property of the seed and
// the track's beacon layout as much as of the cadence rule, so a tight per-race
// floor calibrated on seed 3 (which happens to give 8/8/8) is measuring the
// seed, not the game. The floors that MEAN something are the totals, where the
// layout noise averages out: per seed (24 / 25 / 28 measured, Wave 4's worst
// seed 24) and across all nine races (77 measured, Wave 4 69).
// The per-race floors stay, but as what they honestly are — a hard "this race
// was not starved" catch, set below the worst legitimate case rather than at
// it. The starvation mutant (RESPAWN_S 150 → 5/5/4 per race, 14 per seed) still
// fails all three: per-race count, per-seed total and grand total.
const FLOOR_PER_RACE = 0.50;
const FLOOR_OVERALL = 0.65;
// …and the number the ratio cannot see: how many questions a child was actually
// asked. See the note above — this is the assertion the starvation mutant fails.
const MIN_OPENED_PER_RACE = 5;
const MIN_OPENED_TOTAL = 22;
// THE SEEDS ARE PART OF THE ASSERTION, NOT A DETAIL OF IT.
// Round 2 of this section drove seed 3 only, and measured 8/8/8 = 24 against
// floors of 7 and 22 — margins of one and two. Every argument this wave
// actually turned on happened on a seed that gate never ran: round 1's claimed
// "+2 questions" was a seed-3 artifact that vanished across seeds, and seed 11
// track 0 is where BOTH the 55% ratio floor and the old 20-token race live —
// the two numbers the floors below are calibrated against. A gate whose floors
// are tuned on cases it does not execute is documentation, not a gate.
// Nine races: three seeds x three tracks. Measured 77 opened across them.
const SEEDS = [3, 11, 27];
const MIN_OPENED_ALL_SEEDS = 66;   // 77 measured; Wave 4 = 69; broken = 58
const rows = [];
for (const seed of SEEDS) for (const track of [0, 1, 2]) {
  await boot({ racerId: 'nitzotz', results: [], championshipRace: 0,
    garageMetBoreg: true, garageTokenIntroSeen: true, quizBoxIntroSeen: true });
  await startRace({ track, difficulty: track + 1, seed });
  const r = await guarded(`seed ${seed} track ${track}: the engaged race could be driven`, () => {
    const D = window.__DEBUG, A = () => D.engine.active, F = 1 / 60;
    for (let i = 0; i < 60 * 1800 && !window.__LAST_RESULT__; i++) window.__drive(F);
    const res = window.__LAST_RESULT__;
    return {
      met: window.__MET.length, live: window.__MET.filter(m => m.active).length,
      opened: window.__OPEN.length, soft: window.__SOFT.length,
      // Question IDs in ask order — a race must never ask the same question
      // twice. quiz.js reshuffles and refills the pool when it is exhausted, so
      // this is a real edge: COOLDOWN_S's own note records that at 7s the
      // theoretical worst case (37 questions) exceeds the tier-1 pool (36).
      // Not reachable at today's 8-9 per race; it opens the moment anyone
      // pushes the rate again, which is exactly what this wave just did.
      askedIds: window.__OPEN.slice(),
      finished: !!res,
      tokens: res?.tokens, quiz: res?.tokensFromQuiz,
      pickups: res?.tokensFromPickups, finish: res?.tokensFinishBonus, place: res?.place,
    };
  });
  rows.push({ track, seed, ...r });
  const frac = r.met ? r.opened / r.met : 0;
  const tag = `seed ${seed} track ${track}`;
  console.log(`     ${tag}: ${r.opened}/${r.met} beacons opened a box (${(frac * 100).toFixed(0)}%)`
    + ` · ${r.soft} soft token(s) · banked ${r.pickups}+${r.quiz}q+${r.finish}f = ${r.tokens}, P${r.place}`);
  ok(`${tag}: the driver really met beacons and finished`,
    r.met >= 4 && r.finished === true, `${r.met} met, finished ${r.finished}`);
  ok(`${tag}: at least ${(FLOOR_PER_RACE * 100).toFixed(0)}% of them opened a question`,
    frac >= FLOOR_PER_RACE, `${(frac * 100).toFixed(0)}% (${r.opened}/${r.met})`);
  ok(`${tag}: and at least ${MIN_OPENED_PER_RACE} boxes actually OPENED (the track is not starved)`,
    r.opened >= MIN_OPENED_PER_RACE, `${r.opened} opened`);
  ok(`${tag}: every beacon met is accounted for — opened or paid`,
    r.opened + r.soft === r.met, `${r.opened} opened + ${r.soft} soft = ${r.opened + r.soft} vs ${r.met} met`);
  ok(`${tag}: no question was asked twice in the same race`,
    new Set(r.askedIds).size === r.askedIds.length,
    `${r.askedIds.length} asked, ${new Set(r.askedIds).size} distinct`);
}
const M = rows.reduce((s, r) => s + r.met, 0), O = rows.reduce((s, r) => s + r.opened, 0);
// Per-seed totals as well as the grand total: a seed that starves must not be
// averaged out of sight by two that do not.
const worstSeedOpened = Math.min(...SEEDS.map(s =>
  rows.filter(r => r.seed === s).reduce((n, r) => n + r.opened, 0)));
console.log(`     totals: ${O}/${M} opened across ${rows.length} races`
  + ` · worst seed ${worstSeedOpened} · ` + SEEDS.map(s =>
    `seed ${s}: ${rows.filter(r => r.seed === s).reduce((n, r) => n + r.opened, 0)}`).join(', '));
ok(`across all ${rows.length} races, at least ${(FLOOR_OVERALL * 100).toFixed(0)}% of boxes met opened a question`,
  M > 0 && O / M >= FLOOR_OVERALL, `${O}/${M} = ${M ? ((O / M) * 100).toFixed(0) : 0}%`);
ok(`…and at least ${MIN_OPENED_TOTAL} questions were asked per seed (worst seed)`,
  worstSeedOpened >= MIN_OPENED_TOTAL,
  `worst seed opened ${worstSeedOpened} (Wave 4: 24 · broken: 18 · starvation mutant: 14)`);
ok(`…and at least ${MIN_OPENED_ALL_SEEDS} across all ${SEEDS.length * 3} races`,
  O >= MIN_OPENED_ALL_SEEDS, `${O} opened (Wave 4: 69 · broken: 58 · round 1: 59)`);
// The economy side of the same change, stated here so a retune that fixes the
// cadence by paying for it cannot pass quietly. D51's most expensive garage ask
// is 21 tokens and a single winning, fully engaged race must stay under it.
const MAX_ASK = 21;
const worst = Math.max(...rows.map(r => r.tokens || 0));
ok(`…and a winning engaged race still banks under the ${MAX_ASK}-token top ask`,
  worst < MAX_ASK, `worst race banked ${worst} · ${rows.map(r => r.tokens).join(' / ')}`);

/* ═══════════════════════════════════════════════════════════════════════════
   7. THE GAUGE EXISTS ON THE TIER CHILDREN ACTUALLY PLAY ON
   Round 1 built the recharge ring only at propDensity >= 0.5, and the low tier
   is 0.35 — so the mesh was never created and the low tier had NO recharge
   indicator at all: a dim beacon and nothing else, identical at 10% charge and
   at 85%. Wave 5.1's auto-detect can select low, so that is a tier real
   children land on, and it is the tier where the one visible pacing rule
   quietly did not exist. This asserts the gauge on the LIVE low-tier scene —
   both meshes present, and the arc still filling.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n  7. the recharge gauge is built at EVERY quality tier');
for (const tier of ['low', 'high']) {
  await boot({ racerId: 'nitzotz', results: [], championshipRace: 0,
    garageMetBoreg: true, garageTokenIntroSeen: true, quizBoxIntroSeen: true });
  await evalp((o) => window.__DEBUG.goto('race', o),
    { track: 0, difficulty: 1, seed: 3, autopilot: true, introCard: false, quality: tier });
  await wait(200);
  await installRig();
  const g = await guarded(`${tier}: a cooldown could be armed`, () => {
    const D = window.__DEBUG, A = () => D.engine.active, F = 1 / 60;
    const q = A().quiz;
    window.__drive(6);
    const lit = window.__art();
    for (let i = 0; i < 60 * 240 && q.phase === 'idle'; i++) window.__drive(F);
    for (let i = 0; i < 60 * 60 && q.phase !== 'idle'; i++) window.__drive(F);
    const spent = window.__art();
    window.__drive(3);
    const half = window.__art();
    return { tier: D.state().quality, lit, spent, half };
  });
  ok(`${tier}: the tier really is '${tier}'`, g.tier === tier, `engine quality '${g.tier}'`);
  ok(`${tier}: both halves of the gauge are BUILT (arc + the circle it fills)`,
    g.spent?.ringFill != null && g.spent?.ringTrack === true,
    `arc ${g.spent?.ringFill != null ? 'present' : 'MISSING'}, track ${g.spent?.ringTrack}`);
  ok(`${tier}: and the arc reads differently at empty, part-charged and live`,
    g.spent?.ringFill < 0.35 && g.half?.ringFill > g.spent?.ringFill + 0.15
    && g.lit?.ringFill >= 0.999,
    `${g.spent?.ringFill} → ${g.half?.ringFill} → live ${g.lit?.ringFill}`);
}

ok('no page errors', errs.length === 0, errs[0] || '');
console.log('  ' + '─'.repeat(76));
console.log(fails ? `\n  ${fails} FAILED` : '\n  all question-box checks passed');
await b.close();
process.exit(fails ? 1 : 0);

// POSITION TOASTS — the toast must match the child's EYES (Wave 6)
//
// `race:position` was emitted the instant the spline-progress order flipped.
// Progress is arc length along the lap, so the flip happens while the two karts
// are still side by side — and it flips BACK a tenth of a second later, and
// again, all the way through a corner. What the child saw was "עקפת!" /
// "נעקפת!" firing three or four times about a rival still visibly beside them.
// That is the exact shape of feedback that teaches a player to stop believing
// the HUD, which is expensive: the HUD is how this game says everything.
//
// The fix is hysteresis AT THE EMIT SITE — a change must HOLD for a beat AND
// open a real gap before the child is told. The decision was trapped inside the
// raceScene closure with no way in, so nothing had ever tested it; it is now the
// exported pure factory `makePositionToastGate` and this file is its gate.
//
// The three things asserted, and why each one alone is a hole:
//   1. an oscillating pass produces ONE toast, not a flurry — with the SAME
//      scenario run through a naive "emit on every change" emitter first, so the
//      gate proves the scenario really is a flurry scenario rather than passing
//      because nothing happened in it (GAPS: an assertion over an empty sample
//      set is not an assertion);
//   2. a clean decisive pass still toasts, and PROMPTLY — a bounded latency, or
//      "no flurries" is trivially satisfied by never speaking;
//   3. `from` is the position the child was last TOLD about — using the live
//      order for `from` would let a suppressed flicker turn the next real pass
//      into a `from === to` no-op, i.e. a silent overtake.
//
// Wave 6.1 added two more, once `progress` had been made honest (see
// tools/spatialtest.mjs) and the toast could finally be held to the tarmac:
//   7. reset() (which the flag calls) really drops the half-served hold, so
//      nothing arrives over the results screen and no hold is inherited;
//   8. every toast names the place that is live at that frame and starts from
//      the place the child was last told — the emit-site twin of flowtest's
//      "every toast names the place the child ACTUALLY holds".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makePositionToastGate } from '../src/race/race.js';

let fail = 0;
const ok = (name, cond, detail = '') => { if (!cond) fail++;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(58)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`); };

console.log('\n  POSITION TOASTS — hysteresis at the emit site\n  ' + '─'.repeat(74));

const FIXED = 1 / 60;
const HOLD_S = 0.6, MARGIN_M = 3.0;   // the shipped values; see race.js

/** The pre-change emitter, kept as the control. */
function naive() {
  let shown = 4;
  return { update(dt, live) { if (live === shown) return null; const from = shown; shown = live; return { from, to: live }; } };
}

/* ── 1. THE FLURRY ───────────────────────────────────────────────────────────
   A real side-by-side: the rival's progress and the player's cross back and
   forth with a gap of centimetres for 1.5 s, then the player edges clear and
   stays clear. Driven at the real 1/60 fixed step, and scripted as a GAP that
   changes sign — the position falls out of the gap's sign, exactly as
   updatePositions() derives it from `order()`. */
function flurryFrames() {
  const frames = [];
  for (let f = 0; f < 90; f++) {                       // 1.5 s of swapping
    const gap = Math.sin(f * 0.42) * 0.9;              // ±0.9 m — inside a kart
    frames.push({ live: gap > 0 ? 3 : 4, gapM: Math.abs(gap) });
  }
  for (let f = 0; f < 120; f++) {                      // then a real, clean pass
    frames.push({ live: 3, gapM: Math.min(9, 0.9 + f * 0.12) });
  }
  return frames;
}
{
  const frames = flurryFrames();
  const control = naive();
  let controlToasts = 0;
  for (const fr of frames) if (control.update(FIXED, fr.live, fr.gapM)) controlToasts++;
  // The scenario has to BE a flurry, or assertion 1 below means nothing.
  ok('1: the control scenario really is a flurry (pre-change emitter)',
    controlToasts >= 8, `${controlToasts} toasts from the same 210 frames before the fix`);

  const gate = makePositionToastGate({ start: 4 });
  const toasts = [];
  frames.forEach((fr, f) => { const say = gate.update(FIXED, fr.live, fr.gapM); if (say) toasts.push({ f, ...say }); });
  ok('1: …and the shipped gate says it once',
    toasts.length === 1, `${toasts.length} toast(s): ${JSON.stringify(toasts)}`);
  ok('1: …and says the right thing (P4 → P3, the pass that stuck)',
    toasts.length === 1 && toasts[0].from === 4 && toasts[0].to === 3,
    toasts.length ? `from ${toasts[0].from} to ${toasts[0].to}` : 'nothing said');
  // And it is announced from the point the pass became REAL, not at the end of
  // the run: bound the lag from the start of the clean pass (frame 90).
  ok('1: …at the moment the pass became real, not seconds later',
    toasts.length === 1 && toasts[0].f - 90 <= Math.ceil((HOLD_S + 0.25) / FIXED),
    toasts.length ? `${((toasts[0].f - 90) * FIXED).toFixed(2)}s after the pass began` : '—');
}

/* ── 2. A CLEAN, DECISIVE PASS STILL TOASTS, PROMPTLY ─────────────────────── */
{
  const gate = makePositionToastGate({ start: 4 });
  let at = -1;
  for (let f = 0; f < 300; f++) {
    // Straight past: 12 m/s of closing speed, so the margin is cleared at once
    // and the only thing left to wait for is the hold.
    const say = gate.update(FIXED, 3, 0.2 + f * 0.2);
    if (say) { at = f; break; }
  }
  const latency = at < 0 ? Infinity : at * FIXED;
  ok('2: a decisive pass is still announced', at >= 0, at >= 0 ? `at ${latency.toFixed(2)}s` : 'NEVER announced');
  ok('2: …within a bounded beat, not "eventually"',
    latency >= HOLD_S - FIXED && latency <= HOLD_S + 0.2,
    `${latency.toFixed(2)}s, hold is ${HOLD_S}s`);
}

/* ── 3. NEITHER CONDITION MAY BE DROPPED ─────────────────────────────────────
   A hold alone still announces a pass that is 20 cm ahead; a margin alone still
   announces the half-second flicker at a chicane. Each is asserted by removing
   the OTHER and watching the gate stay quiet. */
{
  // Held forever, but never any daylight: no toast.
  const g = makePositionToastGate({ start: 4 });
  let said = 0;
  for (let f = 0; f < 600; f++) if (g.update(FIXED, 3, 0.4)) said++;
  ok('3: a position that flips but never opens a gap says nothing',
    said === 0, `${said} toast(s) over 10s of a 0.4m "pass"`);
}
{
  // Wide gap, but the change never lasts the beat: no toast.
  const g = makePositionToastGate({ start: 4 });
  let said = 0;
  for (let f = 0; f < 600; f++) if (g.update(FIXED, f % 20 < 10 ? 3 : 4, 25)) said++;
  ok('3: …and a change that never lasts the beat says nothing either',
    said === 0, `${said} toast(s) over 10s of 6Hz order flapping`);
}

/* ── 4. `from` IS WHAT THE CHILD WAS LAST TOLD ───────────────────────────────
   P4 → P3 (suppressed flicker) → P2 (real) must announce 4 → 2 once, and never
   a `from === to` no-op. hud.js decides ▲ or ▼ purely from `to < from`. */
{
  const g = makePositionToastGate({ start: 4 });
  const said = [];
  for (let f = 0; f < 12; f++) { const s = g.update(FIXED, 3, 0.5); if (s) said.push(s); }   // flicker, suppressed
  for (let f = 0; f < 90; f++) { const s = g.update(FIXED, 2, 20); if (s) said.push(s); }    // the real move
  ok('4: a suppressed flicker does not corrupt the next real toast',
    said.length === 1 && said[0].from === 4 && said[0].to === 2,
    JSON.stringify(said));
  ok('4: …and no toast is ever a no-op (from === to)',
    said.every(s => s.from !== s.to), JSON.stringify(said));
}

/* ── 5. LOSING A PLACE IS THE SAME RULE ──────────────────────────────────────
   Asserted separately because the emit site picks the rival from a DIFFERENT
   side of the order for a loss, and a rule that only holds in the direction the
   author tested is half a rule. */
{
  const g = makePositionToastGate({ start: 3 });
  let said = null, at = -1;
  for (let f = 0; f < 300 && !said; f++) { said = g.update(FIXED, 4, 0.3 + f * 0.25); if (said) at = f; }
  ok('5: being passed is announced under the same hold and margin',
    !!said && said.from === 3 && said.to === 4 && Math.abs(at * FIXED - HOLD_S) <= 0.2,
    said ? `${said.from}→${said.to} at ${(at * FIXED).toFixed(2)}s` : 'never announced');
}

/* ── 7. reset() REALLY DOES CLEAR WHAT WAS BUILDING ──────────────────────────
   updatePositions() calls `posToast.reset(np)` the moment the player finishes,
   and then returns: a place change that was still holding when the flag fell
   must not be announced over the results screen, and the next race's gate must
   not inherit half a hold. `reset` had no gate of its own — it was only ever
   exercised as the constructor's twin, and the one thing it has to DO (drop the
   half-served hold) was invisible: a gate whose reset only assigns `shown`
   passes every other assertion in this file.

   So the claim is about LATENCY: after a reset, a change starts its hold from
   zero. Same change, same wide-open gap, straight after a reset that settled
   the order somewhere else — silent for the first 0.5 s, announced by 0.65 s. */
{
  const g = makePositionToastGate({ start: 4 });
  for (let f = 0; f < 35; f++) g.update(FIXED, 3, 20);        // 0.58 s of a 0.6 s hold
  ok('7: the change really was one frame from being announced',
    g.pendingFor >= HOLD_S - 2 * FIXED && g.pendingFor < HOLD_S,
    `${g.pendingFor.toFixed(2)}s held of the ${HOLD_S}s hold`);
  g.reset(4);                              // the order settles back at P4
  let early = 0, at = -1;
  for (let f = 0; f < 30; f++) if (g.update(FIXED, 3, 20)) early++;   // 0.5 s
  ok('7: …so the same change is NOT announced on the next frame after a reset',
    early === 0, `${early} toast(s) in the 0.5s after reset(4)`);
  for (let f = 30; f < 60 && at < 0; f++) if (g.update(FIXED, 3, 20)) at = f;
  ok('7: …but it is announced once it has served the hold from zero',
    at >= 0 && Math.abs(at * FIXED - HOLD_S) <= 0.05,
    at >= 0 ? `at ${(at * FIXED).toFixed(2)}s after the reset` : 'never announced');
}

/* ── 8. EVERY TOAST NAMES THE PLACE THE CHILD IS ACTUALLY IN ─────────────────
   The unit twin of the built-game cross-check added to tools/flowtest.mjs in
   Wave 6.1 ("every toast names the place the child ACTUALLY holds", measured
   against the karts' own centreline projections rather than against the sort).
   This is the same claim at the emit site: whatever the gate says, it says
   about the position that is live AT THAT FRAME — never a stale one it was
   still chewing on — and each toast's `from` is the last thing the child heard,
   so the sequence the child hears is a connected walk with no gaps and no
   invented steps. Driven over a long scripted dice: 40 s of a rival trading
   places with the player, deterministic (no Math.random — see CLAUDE.md), with
   the gap opening and closing so both the flurry and the clean-pass paths are
   exercised in one sequence. */
{
  const g = makePositionToastGate({ start: 4 });
  const said = [];
  let live = 4, worstStale = 0, chainBad = 0, told = 4;
  for (let f = 0; f < 2400; f++) {
    // A deterministic dice: the pair trade places on a 2 s cycle — each state
    // holds a second, comfortably past the 0.6 s hold — while the gap breathes
    // between 0 and 8 m on a slower, out-of-phase cycle, so some swaps are
    // announced and some are still overlapping when the hold runs out.
    live = f % 120 < 60 ? 4 : 3;
    const gapM = Math.abs(Math.sin(f * 0.017)) * 8;
    const say = g.update(FIXED, live, gapM);
    if (!say) continue;
    said.push({ f, ...say, live, gapM });
    if (say.to !== live) worstStale++;
    if (say.from !== told) chainBad++;
    told = say.to;
  }
  ok('8: the dice really did produce toasts to check',
    said.length >= 4, `${said.length} toast(s) over 40s of trading places`);
  ok('8: every toast names the position live at that frame',
    said.length >= 4 && worstStale === 0, `${worstStale} named a stale place`);
  ok('8: …and each one starts from what the child was last told',
    said.length >= 4 && chainBad === 0, said.map(s => `${s.from}→${s.to}`).join(' '));
  ok('8: …and none was said without the shipped daylight',
    said.length >= 4 && said.every(s => s.gapM >= MARGIN_M),
    `closest ${said.length ? Math.min(...said.map(s => s.gapM)).toFixed(2) : '—'} m, margin ${MARGIN_M} m`);
}

/* ── 6. THE SHIPPED CONSTANTS, AND THAT THE EMIT SITE ACTUALLY USES THEM ─────
   A pure function nothing calls is a green tick that means nothing — the exact
   failure mode GAPS records for garagetest's 3D checks. So: the emit site must
   have exactly one `race:position` emission and it must be the gate's. */
{
  const src = readFileSync(fileURLToPath(new URL('../src/race/race.js', import.meta.url)), 'utf8');
  const emits = src.match(/bus\.emit\('race:position'/g) || [];
  ok('6: race.js emits race:position from exactly one place', emits.length === 1, `${emits.length} emit site(s)`);
  ok('6: …and that place is the hysteresis gate, not the raw order flip',
    /const say = posToast\.update\([\s\S]{0,120}?bus\.emit\('race:position', say\)/.test(src),
    'the emit is guarded by posToast.update()');
  ok('6: …and the shipped hold and margin are the ones this file asserts',
    new RegExp(`const TOAST_HOLD_S = ${HOLD_S};`).test(src)
    && new RegExp(`const TOAST_MARGIN_M = ${MARGIN_M.toFixed(1)};`).test(src),
    `hold ${HOLD_S}s, margin ${MARGIN_M}m`);
  // The HUD number is deliberately NOT hysteretic — it is a fact, on screen
  // continuously, and hud.js reads it off the state every frame. Pinned so the
  // decision is visible if someone later makes the number lag too.
  ok('6: …and the HUD position NUMBER still tracks live',
    /S\.position = np;/.test(src), 'state.position is assigned every step, ungated');
}

console.log('  ' + '─'.repeat(74));
console.log(fail ? `  \x1b[31m${fail} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exit(fail ? 1 : 0);

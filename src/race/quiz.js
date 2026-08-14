// ═════════════════════════════════════════════════════════════════════════════
// IN-RACE QUIZ — מרוץ הפרומפטים
// ═════════════════════════════════════════════════════════════════════════════
//
// Floating "question beacons" sit around the lap. Driving through one FREEZES
// the world and opens a single three-answer question about AI and prompting.
// Right answer → turbo + tokens. Wrong answer or a timeout → nothing bad happens
// at all: the correct answer is shown, one warm line is shown, and the race
// carries on. That asymmetry is deliberate and load-bearing — a child who is
// punished for a wrong guess stops guessing, and stops learning.
//
// ═══════════════════════════════════════════════════════ WAVE 3: FULL FREEZE
// Wave 2 slowed the world to 0.28×/0.78× while a question was up. Reading while
// the kart still drives is a divided-attention task, and the one thing this
// panel exists to do is teach — so the sequence is now:
//
//   beacon hit → sim FROZEN (zero fixed steps) → question → 1/2/3
//   → feedback + explanation, on screen indefinitely → Space
//   → 3 · 2 · 1 on the HUD gantry, still frozen → resume
//
// Nothing about the mechanism changed, only the number: the time scale handed
// back to race.js is now exactly 0 for the whole sequence (D11 — fewer fixed
// steps, never shorter ones; at scale 0 the accumulator simply never fills, so
// race and lap clocks, which only advance inside simulate(), do not move).
// race.js additionally gates `input.enabled` off for the frozen stretch exactly
// the way the pause menu does, so held keys survive it (D12).
//
// ═══════════════════════════════════════════════════ INTEGRATION SEAM (race.js)
//
//   import { createQuizSystem } from './quiz.js';
//
//   const quiz = createQuizSystem(engine, {
//     spline, def,                     // from getTrack()/buildTrack()
//     difficulty: opts.difficulty ?? 1,// 1 → tier 1, 2 → tiers 1–2, 3 → tiers 2–3
//     rng,                             // the race's seeded rng (determinism)
//     mount: engine.ui,                // optional, defaults to engine.ui
//     enabled: !backdrop,              // menu backdrops get boxes but never questions
//   });
//   scene.add(quiz.group);
//
// The ONLY thing race.js must change in its loop is where the fixed step comes
// from. `update(dt)` is still handed a real-time 1/60 by the engine; the quiz is
// ticked with that REAL dt (its own countdown must keep running in wall-clock
// time while the world is stopped), and the number it returns scales how much
// SIM time that frame is worth — 1 normally, 0 while a panel is up:
//
//   const FIXED = 1 / 60;
//   let simAcc = 0;
//
//   function update(dtReal) {                     // engine always passes 1/60
//     const scale = quiz.update(dtReal, player, { racing: S.phase === 'racing' && !S.finished });
//     simAcc += dtReal * scale;
//     let guard = 0;
//     while (simAcc >= FIXED && guard++ < 4) { simAcc -= FIXED; simulate(FIXED); }
//     // …then the render-only work (camera, rig.update, track.update, pushHud)
//     // stays OUT here on dtReal so the picture never stutters.
//   }
//
// where `simulate(FIXED)` is the existing body of update(). Consequences, stated
// plainly because they are the whole reason for this shape:
//   • The physics step is STILL exactly 1/60. A frozen world runs ZERO steps per
//     frame, it never shortens one. Nothing in kartphysics changes behaviour.
//   • S.raceTime / S.lapTime advance only inside simulate(), so lap timing stays
//     honest: a slowed second of wall clock is a slowed second of race time, and
//     a child is never charged race time for reading a question.
//   • quiz.update() must be called ONCE per frame, before the accumulator, and
//     always — including during countdown and after the flag (it self-gates on
//     ctx.racing and simply returns 1).
//   • quiz.group is a plain Object3D; add it to the race scene and let
//     quiz.dispose() free it (race.js's dispose() should call it).
//
// Rewards are applied by this module directly to the body it was handed
// (applyBoost), so race.js does not have to. Tokens are NOT — the race owns the
// token counter, so it should listen:
//
//   bus.on('quiz:correct', ({ tokens }) => { S.tokens += tokens; });
//
// Bus events emitted (payload shape at emitResult() below):
//   quiz:open  quiz:correct  quiz:wrong  quiz:timeout  quiz:close
//   quiz:beacon — EVERY beacon a player drives through, live or not:
//     { i, active, charge, x, y, z }. `active` says whether it opened a
//     question. Emitted so a gate (and the lead) can measure the one number
//     that decides whether the boxes feel broken: the fraction of the boxes a
//     child drives through that actually ask them something.
//   quiz:softToken — a beacon driven through while it was RECHARGING. It pays
//     one token and a sparkle and opens nothing; race.js awards it (this module
//     never imports race.js). Payload { i, x, y, z }.
//   quiz:recharged — the cooldown ran out and every beacon lit back up. The
//     re-activation is a visible pop, not a silent swap.
//
// ══════════════════════════════════ WAVE 5.1: THE PLAYER CAN SEE WHY (D-quizbox)
// Wave 5 put a teaching-card cadence gate at the BEACON: a box that arrived
// inside another card's shadow was consumed and opened nothing. Combined with
// the answered/ignored cooldowns, roughly two boxes in three ate themselves in
// silence and the first boxes of a championship fired nothing at all. A child
// cannot tell that from a bug, and a mechanic a child reads as broken is broken.
//
// So the cadence gate is GONE from the beacon (cards still space themselves —
// noteTeachingCard() is still called when a box episode closes, so the
// first-token explainer does not land on its heels), and the ONE remaining
// pacing rule is the cooldown, which is now a thing you can look at:
//
//   • the first box of every race is ALWAYS live — no cooldown, no gate;
//   • while the cooldown drains, every beacon is visibly GHOSTED and its ring
//     fills back up like a charging battery (writeInstances/applyChargeVisuals);
//   • when it hits zero the beacons POP back to full, in one visible beat;
//   • driving through a ghosted beacon is never nothing: it pays one token and
//     a sparkle (`quiz:softToken`) and the beacon respawns as usual.
// ═════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { bus } from '../core/bus.js';
import { makeRng } from '../core/rng.js';
import { save } from '../core/save.js';
import {
  h, injectStyles, pushModal, popModal, modalOpen, noteTeachingCard,
} from '../ui/style.js';
import { registerStrings, t, num, getLang } from '../ui/i18n.js';
import { QUESTIONS, questionsForDifficulty, tiersForDifficulty, bankStats } from './quizdata.js';
// Preview-only (the game imports these long before quiz.js is reached, so this
// costs the bundle nothing).
import { getTrack, TrackSpline } from '../track/trackdef.js';
import { buildTrack } from '../track/trackbuild.js';
import { applyTheme } from '../gfx/sky.js';

/* ══════════════════════════════════════════════════════════════════ strings ══ */

registerStrings({
  he: {
    // "שאלת פרומפט" named one of the six topics (quiz.topic.*) as if it were all
    // of them, and it was the only surface still using that name: the new
    // explainer says "שאלה אחת על AI", the badge conditions say "שאלה במרוץ" and
    // the glossary hints say "שאלה בנושא … במרוץ". One thing, one name (D27).
    'quiz.badge': 'שאלת AI',
    'quiz.hint': 'בוחרים עם {k}',
    'quiz.correct': 'נכון!',
    'quiz.reward': 'טורבו ועוד {n} טוקנים',
    // Singular form. A correct answer now pays ONE token on tiers 1–2 (see
    // REWARD_TOKENS), and "ועוד 1 טוקנים" is not Hebrew.
    'quiz.reward1': 'טורבו ועוד טוקן אחד',
    'quiz.timeUp': 'נגמר הזמן',
    'quiz.answerMarked': 'התשובה הנכונה מסומנת',
    'quiz.continue': 'ממשיכים לנסוע…',
    'quiz.pressSpace': 'לוחצים רווח כדי להמשיך',
    // NOT "ממשיכים": that is the pause menu's Resume pill, and with the pause
    // menu open over a quiz the two gold pills land on top of each other — a
    // child who pauses mid-question and clicks where they were about to click
    // gets Resume. Different words, different button.
    'quiz.continueBtn': 'חוזרים למסלול! (רווח)',
    // Space is also the drift key. A child still holding it presses Space and
    // nothing happens (the e.repeat guard, deliberately), and the only other way
    // out was a mouse target. The auto-repeat itself is the tell, so say so.
    'quiz.spaceHeld': 'הרווח עדיין לחוץ — משחררים ולוחצים שוב (או Enter)',
    'quiz.noPenalty': 'בלי עונש. ממשיכים!',
    'quiz.warm.1': 'לא נורא בכלל — עכשיו יש כאן משהו חדש שיודעים.',
    'quiz.warm.2': 'ניסיון יפה! גם תשובה שלא קלעה מלמדת משהו.',
    'quiz.warm.3': 'קרוב! שווה לזכור את זה לשאלה הבאה.',
    'quiz.warm.4': 'זה בסדר גמור. ככה בדיוק לומדים דברים חדשים.',
    'quiz.topic.whatai': 'מה זה AI',
    'quiz.topic.prompt': 'פרומפטים',
    'quiz.topic.tokens': 'טוקנים',
    // A topic name, in the slot where an instruction would sit, right above a
    // red option: "לנסות שוב" read as advice. Named as a subject instead.
    'quiz.topic.iterate': 'שיפור בשלבים',
    'quiz.topic.mistakes': 'לבדוק אחרי ה־AI',
    'quiz.topic.vibe': 'וייב־קודינג',
    // ── the one-time "what is a quiz box" explainer ──────────────────────────
    // Two sentences, and both of them are checked against the code: a correct
    // answer really does call applyBoost() and pay REWARD_TOKENS (a flat 1 per
    // tier), and a wrong answer really does pay 0 with nothing subtracted
    // anywhere. House voice: impersonal plural, no gendered imperative (D27).
    'quiz.intro.kicker': 'חדש על המסלול',
    'quiz.intro.title': 'תיבת שאלה',
    'quiz.intro.1': 'כל תיבה היא שאלה אחת על AI — תשובה נכונה נותנת <b>טורבו</b> ו<b>טוקנים למוסך</b>.',
    // Evaluative, not directive — and deliberately the SAME register as the
    // English line below it. Hebrew said "אז אוספים כל תיבה בדרך" (an
    // instruction) while English said "worth grabbing" (a judgement): two
    // voices in one game, invisible to anyone reading only one build (D27).
    'quiz.intro.2': 'תשובה שלא קלעה לא עולה כלום, אז שווה לאסוף כל תיבה בדרך.',
    'quiz.intro.go': 'קדימה לשאלה! (רווח)',
  },
  en: {
    'quiz.badge': 'AI question',
    'quiz.hint': 'Choose with {k}',
    'quiz.correct': 'Correct!',
    'quiz.reward': 'Boost and {n} tokens',
    'quiz.reward1': 'Boost and 1 token',
    'quiz.timeUp': 'Time is up',
    'quiz.answerMarked': 'The right answer is marked',
    'quiz.continue': 'Back to racing…',
    'quiz.pressSpace': 'Press Space to continue',
    'quiz.continueBtn': 'Back to the track! (Space)',
    'quiz.spaceHeld': 'Space is still held — let go and press it again (or Enter)',
    'quiz.noPenalty': 'No penalty. Keep going!',
    'quiz.warm.1': 'No harm done — that is one new thing you now know.',
    'quiz.warm.2': 'Nice try! An answer that misses still teaches something.',
    'quiz.warm.3': 'Close! Worth remembering for the next one.',
    'quiz.warm.4': 'That is completely fine. This is exactly how new things are learned.',
    'quiz.topic.whatai': 'What AI is',
    'quiz.topic.prompt': 'Prompts',
    'quiz.topic.tokens': 'Tokens',
    'quiz.topic.iterate': 'Improving in steps',
    'quiz.topic.mistakes': 'Checking the AI',
    'quiz.topic.vibe': 'Vibe coding',
    'quiz.intro.kicker': 'New on the track',
    'quiz.intro.title': 'Question box',
    'quiz.intro.1': 'Every box is one question about AI — a right answer gives a <b>boost</b> and <b>tokens for the garage</b>.',
    'quiz.intro.2': 'An answer that misses costs nothing, so every box on the way is worth grabbing.',
    'quiz.intro.go': 'On to the question! (Space)',
  },
});

/* ══════════════════════════════════════════════════════════════════ tuning ══ */

const BEACONS = 6;            // per lap — a player meets 2–3 per lap in practice
const HIT_RADIUS = 3.4;       // generous: kids should not have to thread a needle
const HIT_HEIGHT = 4.0;       // vertical tolerance (jumps on Cloud Peak)
// A used beacon comes back later in the race. 26 → 30 in Wave 5.1, and this is
// an ECONOMY number as much as a pacing one, so the reasoning is written down.
//
// ROUND 1 PUT IT AT 60 AND THAT WAS THE WRONG TRADE. Round 1 paid a token for
// every beacon TOUCHED (the soft reward for a recharging box), so beacon income
// stopped being "how many questions opened" and became "how many beacons were
// met" — and touching them is free. The only lever left to hold a won race under
// D51's 21-token maximum garage ask was to put fewer beacons on the track, so
// RESPAWN_S nearly doubled. It bought the fire RATE (49% → 72%) by meeting far
// fewer boxes, and the number that matters — questions actually asked — went
// nowhere. Measured, engaged autopilot, 3 seeds × 3 tracks, questions per race:
//
//   Wave 4 (main)          69 total, 7.7 mean
//   Wave 5 (broken)        58 total, 6.4 mean
//   round 1 (RESPAWN 60)   59 total, 6.6 mean   ← -14% vs Wave 4
//   here (soft pays no
//   currency, RESPAWN 30)  see the table in DECISIONS — back above Wave 4
//
// So the currency came off the soft pickup (race.js: sparkle only; the reward
// for touching a ghosted box is the SHAVE below, which is on-lesson and costs
// the economy nothing) and this went back down to where the track is full.
// 30 rather than 26: a beacon comes back about a lap later, which keeps the
// worst engaged winning race under D51's 21 with the same margin Wave 4 had.
//
// It is also RACING seconds rather than wall seconds — see the respawn tick in
// update(). That distinction is worth a token or two on its own: a timed-out
// question burns 20 wall seconds with the world frozen, so on a wall clock the
// child who ignored every box got their beacons back FASTEST.
//
// This is NOT the knob that decides what FRACTION of boxes fire: that is the
// cooldown below, and it is untouched by this. What it decides is how many
// boxes exist to fire at all, which is why a gate on the ratio alone cannot see
// it moving — see quizboxtest section 6's absolute floor.
const RESPAWN_S = 30;
// After any question, no beacon FIRES for this long — and for exactly this long
// every beacon on the track is visibly ghosted and visibly recharging, so the
// rule is one a child reads off the road rather than one they have to infer.
//
// 10 → 8 in Wave 5.1. The old number was chosen when the cooldown was invisible
// and a second panel arriving "too soon" was the only failure it could see; the
// measured cost was that a three-lap race met ~15 beacons and opened 6 of them,
// with the rest eaten in silence. Eight seconds is still a clear run of racing
// between two panels (a box episode's own 3·2·1 hand-back is 2.16s of it) and it
// is short enough that most of the beacons a child drives through are lit:
// measured fire rate 70% / 80% / 67% on tracks 0/1/2, against ~40% before.
//
// WHY NOT 7. Seven measured better still (100% / 80% / 67%) and is the number
// this pass would otherwise ship. It is not shippable as one line: it fails
// tests/quizbank.test.mjs, which sizes the QUESTION BANK against a worst case of
// RACE_CAP_S / (COOLDOWN_S + DISMISS_AFTER_S) questions in one race — at 7 that
// worst case is 37 and the tier-1 pool holds 36, so a theoretical race could
// repeat a question. The bank is what would have to move, and that is a
// different file and a different decision; the note is here so the next person
// to reach for this constant knows what it is tied to. (That worst case is also
// now very loose: RESPAWN_S bounds a real race to 9–10 beacons met, which the
// bank model does not know about.)
const COOLDOWN_S = 8;
// …and a longer one after a question that timed out: someone who is engaging
// gets the next question soon, someone who drove straight past gets a proper
// run of clean racing before the next one. It is a pacing rule, never a
// punishment — the reward for answering is more questions, not fewer. 24 → 13:
// at 24s a timed-out question took the boxes away for most of a lap, which is
// indistinguishable from the bug this pass exists to remove.
const COOLDOWN_IGNORED_S = 13;
// THE SOFT REWARD, in the only currency this system should ever pay in: time.
// Driving through a ghosted box shaves this much off the recharge, and the arc
// on every beacon visibly jumps forward the moment it happens. It is on-lesson
// (the boxes come back sooner because you went and got them), it is legible
// without a word of UI, and unlike round 1's token it cannot inflate the wallet
// — so RESPAWN_S is free to stay where the track is full. It is small on
// purpose: a shortcut, not a way to skip the pacing rule.
const SOFT_SHAVE_S = 1.2;
// How long the "the boxes are live again" pop lasts. Long enough to be seen
// from a kart, short enough not to read as a second state.
const RECHARGE_POP_S = 0.6;
// What a ghosted beacon looks like, as multipliers on its lit self. The core
// keeps a trace of light so the beacon is still findable at speed — a beacon
// that vanishes is a beacon a child stops looking for.
const GHOST_OPACITY = 0.26;
const GHOST_EMISSIVE = 0.18;
// …except the ring and its halo, which ARE the gauge. They stay bright enough
// to read from a kart, so a ghosted beacon says "recharging, this far along"
// rather than just "gone".
const GHOST_INDICATOR = 0.72;

// The world is FROZEN, not slowed, for the whole sequence (Wave 3). This is a
// TIME SCALE, applied by race.js to its own accumulator (see the seam note at
// the top) — zero fixed steps are emitted, and it is not smoothed toward: a
// half-frozen world is a half-simulated one, and lap times must stay honest.
const FREEZE_SCALE = 0;
// The resume countdown, in seconds per beat: 3 · 2 · 1 on the HUD's own gantry
// (the quiz emits `race:countdown`, exactly like the race start does, so the
// lights, the beeps and the GO flourish are the ones the child already knows).
// The world stays frozen for all of it — the countdown is the hand-back, and it
// exists so the kart is never moving again before the player is looking at it.
const RESUME_BEAT_S = 0.72;
const RESUME_BEATS = 3;

// Answer time by tier, in seconds. Deliberately far longer than an adult needs:
// a slow reader must never lose because of reading speed. Nothing bad happens at
// zero anyway — the timer exists only to keep the race moving.
//
// Wave-2 smoothing: measured the worst case, a player who reads nothing and
// simply drives on. At 24s the world sat below full speed for ~29s of wall clock
// per beacon — long enough that a three-lap race stopped feeling like a race.
// Now 20/18/16. A question plus three options is ~30 Hebrew words; at the ~100
// words-per-minute a slower 8-year-old reads, that is ~18s, so tier 1 (the tier
// the youngest players actually meet, difficulty 1 draws only tier 1) still
// clears a full read with time to spare. Tiers 2 and 3 only appear on races 2–3,
// which a child reaches having already read a dozen of these.
const TIME_LIMIT = { 1: 20, 2: 18, 3: 16 };

// Feedback has NO time limit any more — it stays until the child presses Space.
// The world is frozen behind it, so there is nothing to be late for, and the
// explanation is the single most valuable half-screen in the game. The only
// timer left here is a short arming delay, so the keypress that ANSWERED cannot
// also dismiss the answer (a fast double-tap of 1 used to blink the explanation
// away before it had been read).
const DISMISS_AFTER_S = 0.45;

// Tokens for a correct answer, by question tier.
//
// 3/4/5 → a flat 1 in Wave 4, and this is the single number that mattered most.
// An engaged child meets 5–9 question boxes in a race (measured on the built
// game, three tracks × three seeds), so at 3–5 tokens each the quiz alone paid
// 15–35 against a 21-token maximum garage ask — three times the pickups and the
// finish bonus put together. D29 measured that and deliberately did NOT retune,
// because the end-to-end gate could not see the term; the gate can see it now
// (tools/flowtest.mjs answers real questions), so the retune is measured rather
// than guessed. One token per correct answer also states the economy in a
// sentence a child can hold: four right answers buy a part.
//
// FLAT across tiers, and that is a deliberate second decision. A tier-3 double
// prize was measured first: it only appears on race 3, which is followed by the
// podium rather than a garage, so it looked free. It is not free — it put a
// 21-token race back on the board (exactly the maximum ask) whose only defence
// was a routing detail two files away, and the day someone adds a garage visit
// after race 3 the game's central economic invariant would break silently. One
// token per correct answer holds on every race, needs no asterisk, and states
// the rule in a sentence a child can hold: four right answers buy a part.
//
// WAVE 5 RE-EXAMINED THIS AND DELIBERATELY LEFT IT AT 1. The Wave-5 task was
// "make the top tier of the garage reachable", and raising this number is the
// obvious lever — it is the one that rewards engagement, which is the lesson the
// game exists to teach. It was measured first and it does not fit. Re-measured
// on the built game (four player profiles × three races × three seeds, after the
// teaching-card cadence started deferring a box and after race 2's pace retune):
//
//   boxes met per race        4–8   (an engaged child answers 5–8)
//   pickups per race          3–6
//   finish bonus              3–5
//   a winning engaged race    13–17 banked, against the 21-token maximum ask
//
// A flat 1 → 2 therefore adds 10–16 tokens to a single race and puts a 21–25
// token RACE on the board — the child could buy the most expensive ask at EVERY
// garage, out of one race each time, and "choose where to be precise" stops
// being a choice. That is the exact failure the flattening above was for, and
// nothing can absorb it: pickups are 3–6 and cannot go below one authored row a
// lap without a source paying nothing at all, and the finish table's top is 5
// with a floor of 3 that GAPS' standing instruction says to raise, not cut.
//
// AND THE TIERS CANNOT RESCUE IT EITHER, which is the part that looks like a way
// out and is not. `quizdata.js` maps difficulty → tiers as 1 → [1], 2 → [1,2],
// 3 → [2,3], and `scenes.js` sets difficulty = 1 + trackIndex. So tier 1 appears
// in races 1 AND 2 (raising it adds 5–8 to race 1 alone), tier 2 takes race 2 to
// 16–20 and its worst case past the 21-token ask, and tier 3 appears ONLY in
// race 3 — which is followed by the podium, not a garage, so raising it buys the
// child nothing at all. The only tier whose raise is safe is the only tier whose
// raise is worthless. That is a structural fact about the routing, not a
// property of today's numbers, and it is why D39's flattening should be treated
// as settled rather than re-litigated each wave.
//
// The arithmetic in one line, so nobody has to re-derive it: while the most
// expensive ask is 21 and a race meets up to 8 boxes, the per-box reward can
// only be 1. The Wave-5 income came from the garage rebate instead
// (`tokenReward` in garage/scoring.js), which is not race income and therefore
// cannot break this invariant — see the block there for the full reasoning.
//
// EXPORTED because tests/badges.test.mjs derives its badge thresholds from these
// numbers and previously scraped them out of this file with a regex, so a rename
// failed at a parse assertion rather than at the calibration it invalidated.
export const REWARD_TOKENS = { 1: 1, 2: 1, 3: 1 };
const BOOST = { strength: 1.3, duration: 2.4, impulse: 6 };

/* ═════════════════════════════════════════════════ beacon placement (Wave 3) ══
   A beacon is not just a spot on the lap: it is the spot a child is RELEASED
   from, at racing speed, three seconds after their eyes came back to the road.
   The original placement — `startT + (i + 0.62)/6` — was chosen only to dodge
   the token clusters, and never looked at what was ahead. Measured straight-
   ahead runway (metres of drivable surface on the kart's frozen heading) came
   out under 1.1 seconds at 28 m/s for HALF the beacons, and two of circuit's
   sat on 0.4-radian corners. The game froze the world so the child could read,
   then handed them back into a wall for having read. Fixed here: each beacon is
   nudged FORWARD from its ideal t until the road ahead is actually open.

   The rule, in order of preference (first candidate that satisfies a tier wins;
   scanning forward keeps the beacons in their original order and roughly their
   original spacing):
     tier 1  runway ≥ RUNWAY_MIN_M on the frozen heading AND on ±YAW_TEST°,
             curvature over the next LOOK_AHEAD_M below CURV_MAX,
             and clear of a token cluster
     tier 2  the same minus the curvature preference
     tier 3  the same minus the token-cluster clearance
     tier 4  (nothing in the window qualifies) the candidate with the most
             runway anywhere in the window — always at least as good as ideal
   The ±YAW_TEST° cone is there because a child is never perfectly aligned; a
   spot that only works dead straight is not a spot a child can use. */
const RUNWAY_MIN_M = 45;      // ≈1.6 s at 28 m/s, the speed beacons freeze at
const RUNWAY_CAP_M = 72;      // no need to march further than this
const YAW_TEST_DEG = 6;       // the alignment a child actually leaves with
const LOOK_AHEAD_M = 45;      // curvature window
const CURV_MAX = 0.22;        // radians over LOOK_AHEAD_M
const TOKEN_CLEAR_M = 12;     // keep the original "not on a token cluster" rule
const TOKEN_GROUPS = 8;       // trackbuild puts clusters at startT + (g+0.5)/8
const BEACON_LATERAL = 0.17;  // fraction of the half-width, as before
const SEARCH_SPAN = 0.6;      // of one beacon spacing — beacons keep their order
const SEARCH_STEP_M = 2;

/** Metres of drivable surface straight ahead from `t` at `lateral`, on a heading
 *  `yawDeg` off the track tangent. Marches until the point is wider than the
 *  road (the same off-track test race.js uses), capped at RUNWAY_CAP_M. */
function runwayAhead(spline, t, lateral, yawDeg = 0) {
  const p = spline.offsetPoint(t, lateral);
  const dir = spline.tangentAt(t);
  if (yawDeg) {
    const a = (yawDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    dir.set(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c).normalize();
  }
  let d = 0;
  while (d < RUNWAY_CAP_M) {
    p.addScaledVector(dir, 1);
    d += 1;
    const cl = spline.closestT(p);
    if (Math.abs(cl.lateral) > spline.widthAt(cl.t)) return d;
  }
  return RUNWAY_CAP_M;
}

/** Worst runway over the ±YAW_TEST_DEG cone — what a slightly crooked kart gets. */
function coneRunway(spline, t, lateral) {
  return Math.min(
    runwayAhead(spline, t, lateral, -YAW_TEST_DEG),
    runwayAhead(spline, t, lateral, 0),
    runwayAhead(spline, t, lateral, YAW_TEST_DEG));
}

/**
 * Where the question beacons go. Pure geometry, no rng, no THREE state — so
 * `tests/beacons.test.mjs` can hold it to "every beacon has open road ahead of
 * it" on all three tracks without a browser.
 *
 * @returns {Array<{i, t, lateral, runway, cone, curvature, advancedM, tier}>}
 */
export function planBeacons(spline, startT = 0, count = BEACONS) {
  const L = spline.length;
  const tokens = [];
  for (let g = 0; g < TOKEN_GROUPS; g++) {
    tokens.push((((startT + (g + 0.5) / TOKEN_GROUPS) % 1) + 1) % 1);
  }
  const span = (L / count) * SEARCH_SPAN;
  const out = [];
  for (let i = 0; i < count; i++) {
    const ideal = (((startT + (i + 0.62) / count) % 1) + 1) % 1;
    const prefSide = i % 2 === 0 ? -1 : 1;
    const cands = [];
    for (let a = 0; a <= span; a += SEARCH_STEP_M) {
      const t = ((ideal + a / L) % 1 + 1) % 1;
      const curvature = spline.maxCurvatureAhead(t, LOOK_AHEAD_M / L);
      const w = spline.widthAt(t);
      const nearToken = tokens.some(tt => Math.abs(TrackSpline.deltaT(t, tt)) * L < TOKEN_CLEAR_M);
      // The preferred side first: the left/right alternation is a visual rhythm
      // worth keeping, but not at the price of putting a child in a wall.
      for (const side of [prefSide, -prefSide]) {
        const lateral = side * BEACON_LATERAL * w;
        cands.push({
          i, t, lateral, advancedM: a, curvature, nearToken,
          cone: coneRunway(spline, t, lateral),
          runway: runwayAhead(spline, t, lateral),
        });
      }
    }
    const open = c => c.cone >= RUNWAY_MIN_M;
    const pick =
      cands.find(c => open(c) && c.curvature <= CURV_MAX && !c.nearToken) ||
      cands.find(c => open(c) && !c.nearToken) ||
      cands.find(c => open(c)) ||
      cands.reduce((m, c) => (c.cone > m.cone ? c : m), cands[0]);
    out.push(pick);
  }
  return out;
}

/* ═════════════════════════════════════════════════════════════════════ CSS ══ */

const QUIZ_CSS = `
.quiz-root{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding:clamp(8px,2vh,24px) clamp(8px,3vw,32px);opacity:0;visibility:hidden;
  transition:opacity .22s var(--ease),visibility .22s}
.quiz-root.show{opacity:1;visibility:visible}
.quiz-scrim{position:absolute;inset:0;
  background:radial-gradient(120% 92% at 50% 48%,rgba(6,8,20,.28),rgba(3,5,14,.74))}

.quiz-card{position:relative;width:min(720px,94vw);max-height:96vh;overflow:hidden;
  padding:clamp(12px,2.1vh,24px) clamp(14px,2.2vw,28px) clamp(12px,2vh,22px);
  display:flex;flex-direction:column;gap:clamp(7px,1.2vh,14px)}

.quiz-head{display:flex;align-items:center;gap:10px;justify-content:space-between}
.quiz-badge{font-size:12px;font-weight:900;letter-spacing:.06em;color:#2a1c00;
  padding:4px 12px;border-radius:var(--r-pill);
  background:linear-gradient(180deg,var(--gold-1),var(--gold-2) 60%,var(--gold-3))}
.quiz-topic{font-size:12px;font-weight:800;color:var(--info);
  padding:4px 11px;border-radius:var(--r-pill);
  background:rgba(111,195,255,.12);border:1px solid rgba(111,195,255,.30)}

.quiz-timer{height:7px;flex:none}
.quiz-timer>i{transition:none;background:linear-gradient(90deg,var(--gold-3),var(--gold-1))}
.quiz-timer.low>i{background:linear-gradient(90deg,#e07a2a,var(--warn))}

.quiz-q{font-size:clamp(17px,min(2.45vw,3.5vh),29px);font-weight:900;line-height:1.24;
  color:var(--txt);text-shadow:0 2px 0 rgba(0,0,0,.45);margin:clamp(1px,.5vh,6px) 0}

.quiz-opts{display:flex;flex-direction:column;gap:clamp(6px,1vh,11px)}
/* A finger, not just a key. min-block-size is a logical property, so the row
   grows in the block direction in both RTL and LTR; 48px is the smallest target
   a child's fingertip lands on reliably, and the row is full-width so the whole
   strip — number chip included — is the button. touch-action:manipulation
   removes the double-tap-to-zoom wait, which is what makes a tap feel like a
   click rather than like a delay. */
.quiz-opt{display:flex;align-items:center;gap:clamp(9px,1.4vw,15px);width:100%;
  font-family:var(--font);text-align:start;cursor:pointer;
  min-block-size:clamp(48px,6.2vh,62px);
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;
  user-select:none;-webkit-user-select:none;
  padding:clamp(7px,1.15vh,13px) clamp(9px,1.1vw,15px);
  border-radius:var(--r-m);color:var(--txt);
  background:linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.035));
  border:1px solid var(--stroke-hi);
  transition:transform .12s var(--ease),background .15s,border-color .15s,filter .15s}
/* Hover only where hovering exists. On a touch screen :hover sticks to the
   last thing tapped, so the option a child answered with would stay lit under
   the feedback colours. */
@media (hover:hover){
  .quiz-opt:hover{background:rgba(255,255,255,.15);transform:translateY(-1px);
    border-color:rgba(255,255,255,.38)}
  .quiz-opt:hover .quiz-key{background:rgba(255,255,255,.20)}
}
/* The press itself, for mouse AND touch — the only feedback a tap ever gets. */
.quiz-opt:active:not(:disabled){transform:translateY(1px);
  background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.5)}
.quiz-opt:focus-visible{outline:3px solid var(--info);outline-offset:3px}
.quiz-key{flex:none;display:flex;align-items:center;justify-content:center;
  inline-size:clamp(26px,3.2vh,34px);block-size:clamp(26px,3.2vh,34px);
  border-radius:10px;font-size:clamp(13px,1.9vh,17px);
  background:rgba(255,255,255,.10);border:1px solid var(--stroke-hi);color:var(--txt)}
.quiz-txt{font-size:clamp(14px,min(1.62vw,2.35vh),20px);font-weight:700;line-height:1.28}

.quiz-opt.ok{background:linear-gradient(180deg,rgba(126,224,129,.30),rgba(126,224,129,.14));
  border-color:rgba(126,224,129,.72)}
.quiz-opt.ok .quiz-key{background:rgba(126,224,129,.30);border-color:rgba(126,224,129,.6)}
.quiz-opt.no{background:linear-gradient(180deg,rgba(255,107,107,.22),rgba(255,107,107,.10));
  border-color:rgba(255,107,107,.55)}
.quiz-opt.dim{filter:saturate(.35) brightness(.72)}
.quiz-answered .quiz-opt{cursor:default;transform:none}
.quiz-answered .quiz-timer{opacity:.25}
.quiz-answered .quiz-opt:hover{transform:none}

.quiz-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;
  min-block-size:16px}
.quiz-hint{font-size:12px;font-weight:800;color:var(--txt-dim);letter-spacing:.02em}
/* "you are still holding Space" — the one line that unsticks a keyboard-only
   player who was drifting when the beacon fired. */
.quiz-hint.held{color:var(--gold-1)}
/* Only offered once the feedback is up — while the question is live there is
   nothing to continue to. Sized as a real touch target: this is the only way
   out of the panel for a player with no keyboard at all. */
.quiz-cont{display:none;padding:10px 22px;font-size:clamp(13px,1.8vh,16px);
  min-block-size:clamp(44px,5.6vh,54px);align-items:center;justify-content:center;
  touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.quiz-answered .quiz-cont{display:inline-flex}

.quiz-result{display:none;flex-direction:column;gap:clamp(4px,.8vh,9px);
  padding:clamp(9px,1.3vh,15px) clamp(11px,1.3vw,17px);border-radius:var(--r-m);
  background:rgba(255,255,255,.055);border:1px solid var(--stroke)}
.quiz-answered .quiz-result{display:flex}
.quiz-verdict{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;
  font-size:clamp(16px,min(2vw,2.8vh),24px);font-weight:900;line-height:1.15}
.quiz-result.good{background:rgba(126,224,129,.10);border-color:rgba(126,224,129,.34)}
.quiz-result.good .quiz-verdict{color:var(--good)}
.quiz-result.soft .quiz-verdict{color:var(--gold-1)}
.quiz-sub{font-size:clamp(12px,min(1.35vw,1.95vh),16px);font-weight:800;color:var(--txt-dim)}
.quiz-why{font-size:clamp(13px,min(1.42vw,2.05vh),17px);font-weight:600;line-height:1.42;
  color:var(--txt)}
.quiz-warm{font-size:clamp(13px,min(1.42vw,2.05vh),17px);font-weight:800;color:var(--gold-1);
  line-height:1.35}

.quiz-good .quiz-card{box-shadow:var(--sh-pop),0 0 0 2px rgba(126,224,129,.5),
  0 0 70px rgba(126,224,129,.30)}

.quiz-flash{position:absolute;inset:0;pointer-events:none;opacity:0;
  background:radial-gradient(60% 46% at 50% 50%,rgba(255,214,107,.34),transparent 72%)}
/* NOT ".on" — that class is style.js's global pointer-events opt-in (#ui * is
   pointer-events:none and #ui .on turns it back on), and it out-specifies the
   pointer-events:none above. The celebration flash is a full-screen sibling
   drawn OVER the card, so as a side effect of a RIGHT answer it became a
   transparent sheet that swallowed every click on the panel underneath: after a
   correct answer, a mouse or touch player could not press the continue button at
   all, while the keyboard sailed through. Found by the pointer-parity gate. */
.quiz-flash.fx{animation:quizFlash .55s var(--ease) both}
@keyframes quizFlash{0%{opacity:0}18%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.quiz-flash.fx{animation:none}}

/* ── the one-time "what is a question box" explainer ──────────────────────────
   Same shape as the garage's first-token popup so a child reads a familiar
   card, but in the BEACON's palette (cyan/violet with three satellites) rather
   than the token's gold, because the two must never be confused — the whole
   point of the beacon art is that it is not a coin. */
.qzint-scrim{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding:22px;background:rgba(6,8,20,.62);backdrop-filter:blur(2px);font-family:var(--font)}
.qzint-card{width:min(540px,92%);padding:22px 26px 20px;display:flex;flex-direction:column;gap:11px;
  border-radius:var(--r-l);border:1px solid rgba(111,195,255,.36);
  background:linear-gradient(180deg,rgba(28,40,64,.96),rgba(15,18,30,.97));
  box-shadow:var(--sh-pop),0 0 60px rgba(111,195,255,.22)}
.qzint-top{display:flex;align-items:center;gap:13px}
.qzint-orb{position:relative;inline-size:46px;block-size:46px;flex:none;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#eaffff,#9ee6ff 42%,#2f9dff);
  box-shadow:0 0 26px rgba(95,208,255,.6),0 1px 0 rgba(255,255,255,.6) inset}
.qzint-orb i{position:absolute;inline-size:9px;block-size:9px;border-radius:50%;
  inset-block-start:50%;inset-inline-start:50%;margin:-4.5px}
.qzint-orb i:nth-child(1){background:var(--gold-1);translate:0 -26px}
.qzint-orb i:nth-child(2){background:#6fe8ff;translate:22px 13px}
.qzint-orb i:nth-child(3){background:#c9a6ff;translate:-22px 13px}
.qzint-kicker{font-size:11px;font-weight:900;letter-spacing:.04em;color:var(--info)}
.qzint-title{font-size:26px;line-height:1.05}
.qzint-p{font-size:15.5px;font-weight:700;line-height:1.5;color:#eaeef6}
.qzint-p b{color:var(--info);font-weight:900}
.qzint-actions{display:flex;justify-content:flex-end;margin-top:3px}
.qzint-actions .btn{min-block-size:clamp(44px,5.6vh,54px);
  touch-action:manipulation;-webkit-tap-highlight-color:transparent}
`;

function injectQuizCSS() {
  injectStyles();
  if (document.getElementById('pr-quiz-style')) return;
  const el = document.createElement('style');
  el.id = 'pr-quiz-style';
  el.textContent = QUIZ_CSS;
  document.head.appendChild(el);
}

/* ══════════════════════════════════════════ first-question-box explainer ══ */
//
// The very first time a child ever drives into a question box, they should learn
// what the box IS before they are asked anything: right answer → turbo + tokens,
// wrong answer → nothing bad. Modelled one-for-one on garage.js's first-token
// popup (TOKEN_INTRO_FLAG / shouldShowFirstTokenPopup / firstTokenPopup), and it
// obeys the same registry policy (D15/D18):
//
//   • it DEFERS behind anything else already open — `shouldShowFirstQuizPopup()`
//     is false while ANY modal is up, exactly like the token explainer's, and
//   • when it defers the save flag is LEFT UNTOUCHED, so the next question box
//     shows it. A beacon respawns; the explainer is never lost.
//
// Wave 5 briefly added a SECOND reason to wait — the teaching-card cadence,
// checked at the beacon — and Wave 5.1 removed it: a box that declines to fire
// for a reason a child cannot see is a box a child reads as broken. The only
// thing that can now hold a box back is the VISIBLE cooldown, and the FIRST box
// of a race ignores even that, so this explainer always lands on a real
// question rather than on a beacon that quietly ate itself.
//
// The save flag is a new key. `save.js` merges unknown keys against DEFAULTS, so
// this is safe without editing that file, but the lead must add
// `quizBoxIntroSeen: false` to DEFAULTS and to the settings full-reset.
export const QUIZ_INTRO_FLAG = 'quizBoxIntroSeen';
export const shouldShowFirstQuizPopup = () => !save.read(QUIZ_INTRO_FLAG) && !modalOpen();
export const markFirstQuizPopupSeen = () => { save.set({ [QUIZ_INTRO_FLAG]: true }); };

/**
 * The one-time "what a question box is" card. Marks the flag immediately (so a
 * double-fire in one frame cannot show it twice); pass {persist:false} to show
 * it without touching the save, as the preview does.
 *
 * The caller owns the modal registry: this is opened from inside the quiz
 * system's own frozen sequence and the id it holds is 'quiz', so nothing about
 * the policy changes — a question box owns the screen the same way whether the
 * first thing it shows is this card or the question itself.
 *
 * @param o {onClose?:fn, persist?:boolean}
 * @returns HTMLElement with an extra `close()` method.
 */
export function firstQuizPopup(o = {}) {
  injectQuizCSS();
  if (o.persist !== false) markFirstQuizPopupSeen();
  let closed = false;
  // ONE way out, whatever asks for it: the button (mouse, finger, or an
  // assistive activation), Space/Enter, or Escape. Two implementations of "go
  // on" drift, and only one of them ends up carrying the e.repeat guard.
  const close = () => {
    if (closed) return;
    closed = true;
    removeEventListener('keydown', onKey, true);
    root.remove();
    o.onClose?.();
  };
  // Escape closes THIS rather than falling through to input.js, which would open
  // the pause menu on top of it. Capture phase + stopPropagation, the same
  // discipline the token explainer and ui/menus.js overlays use. Space/Enter are
  // the same key the quiz's own feedback takes, with D20's guard: Space is also
  // the drift key, and a child who was holding it when the box fired must not
  // have this card taken away by a key they never released.
  const onKey = e => {
    if (closed) return;
    const isGo = e.code === 'Space' || e.key === ' ' || e.key === 'Enter';
    if (!isGo && e.key !== 'Escape') return;
    if (e.repeat) { e.preventDefault(); return; }
    e.preventDefault(); e.stopPropagation();
    close();
  };
  addEventListener('keydown', onKey, true);
  const btn = h('button.btn', { type: 'button', onclick: close }, t('quiz.intro.go'));
  // `.on` re-enables pointer events (style.js turns them off for everything
  // inside #ui by default) so the scrim SWALLOWS taps instead of letting them
  // fall through to the world behind it. It deliberately does not close on a
  // stray tap: this is a teaching card, and it goes away on its own button.
  const root = h('div.qzint-scrim.on.fade-in', null,
    h('div.qzint-card.pop-in', null,
      h('div.qzint-top', null,
        h('div.qzint-orb', null, h('i'), h('i'), h('i')),
        h('div', null,
          h('div.qzint-kicker', null, t('quiz.intro.kicker')),
          h('div.display.qzint-title', null, t('quiz.intro.title')))),
      h('div.qzint-p', { html: t('quiz.intro.1') }),
      h('div.qzint-p', { html: t('quiz.intro.2') }),
      h('div.qzint-actions', null, btn)));
  root.close = close;
  root.focusButton = () => btn.focus({ preventScroll: true });
  return root;
}

/* ══════════════════════════════════════════════════════════════════ system ══ */

/**
 * @param {object} engine  needs engine.q (quality tiers) and engine.ui (mount)
 * @param {object} opts
 *   spline      TrackSpline — beacons are placed along it (required for beacons)
 *   def         track def, for startT
 *   difficulty  1..3 → which tiers the bank draws from
 *   askedIds    optional Array|Set of question ids already asked THIS
 *               championship; they are excluded from this race's pool (Wave 3
 *               item 6 — no repeats across the three races). Ignored if
 *               excluding them would leave fewer than quizdata's MIN_POOL.
 *   rng         seeded rng from core/rng.js (defaults to a fixed seed)
 *   mount       DOM element for the overlay (default engine.ui)
 *   enabled     false = beacons render but never trigger (menu backdrops)
 *   freeze      true = timers never advance (screenshots / layout checks)
 *   onResult    optional callback, same payload as the bus events
 * @returns {{group:THREE.Object3D, update:Function, active:boolean, timeScale:number,
 *            openQuestion:Function, dispose:Function}}
 */
export function createQuizSystem(engine, opts = {}) {
  const q = engine?.q || { propDensity: 1, particles: 1 };
  const spline = opts.spline || null;
  const def = opts.def || null;
  const difficulty = opts.difficulty ?? 1;
  const rng = opts.rng || makeRng(20260806);
  const enabled = opts.enabled !== false;
  const freeze = !!opts.freeze;

  /* ── 3D: the question beacons ─────────────────────────────────────────────
     Deliberately nothing like the gold octahedral tokens: a cool cyan/violet
     palette, a soft round core with three satellites orbiting it (three answers,
     three keys), a halo ring, and a light column planted on the road so it reads
     from a long way back. One InstancedMesh per part — 4 draw calls for the lot. */
  const group = new THREE.Group();
  group.name = 'quiz:beacons';

  const detail = q.propDensity >= 0.7 ? 1 : 0;
  // THE RECHARGE GAUGE IS NOT A DETAIL PROP. It used to be built only at
  // propDensity >= 0.5, which meant the low tier (0.35) never built the mesh at
  // all — and Wave 5.1's auto-detect can now pick low, so on the tier a real
  // mid-range machine lands on, the ONE indicator that says when the boxes come
  // back did not exist. It is one instanced mesh pair for the whole track; it is
  // built at every tier now, with fewer segments at the cheap ones.
  const ringSegs = detail ? 72 : 40;
  const wantBeam = q.propDensity >= 0.35;

  const geos = [], mats = [], meshes = [];
  // The two parts that ARE the recharge indicator. They ghost far less than the
  // rest of the beacon: everything else going dark is what says "spent", and the
  // ring staying readable is what says "spent, and here is how far back it is".
  // A gauge you cannot read is not a gauge.
  const indicatorMats = new Set();
  const keepG = g => { geos.push(g); return g; };
  const keepM = m => { mats.push(m); return m; };

  const beacons = [];
  if (spline) {
    const startT = def?.startT ?? 0;
    // Placement is geometry, not a formula: each beacon starts from the old
    // ideal t (which dodged the token clusters) and is nudged FORWARD until the
    // road straight ahead of it is actually open — see planBeacons() above.
    for (const plan of planBeacons(spline, startT, BEACONS)) {
      const p = spline.offsetPoint(plan.t, plan.lateral);
      p.y += 1.55;
      beacons.push({
        i: plan.i, t: plan.t, pos: p, alive: true, respawn: 0,
        phase: rng() * Math.PI * 2, runway: plan.runway, cone: plan.cone,
      });
    }
  }
  const N = beacons.length;

  let coreMesh = null, satMesh = null, ringMesh = null, ringTrackMesh = null;
  let beamMesh = null, glowMesh = null, padMesh = null;
  // Three satellites, three answer keys — and three distinct colours so the
  // "pick one of three" idea is legible before a single word is read.
  const SAT_COLORS = [0xffd66b, 0x6fe8ff, 0xc9a6ff];
  if (N) {
    const coreGeo = keepG(new THREE.IcosahedronGeometry(0.95, detail));
    const coreMat = keepM(new THREE.MeshStandardMaterial({
      color: 0x9ee6ff, emissive: 0x2f9dff, emissiveIntensity: 2.1,
      roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.95,
    }));
    coreMesh = new THREE.InstancedMesh(coreGeo, coreMat, N);

    const glowGeo = keepG(new THREE.IcosahedronGeometry(1.7, 1));
    const glowMat = keepM(new THREE.MeshBasicMaterial({
      color: 0x5fd0ff, transparent: true, opacity: 0.13, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, N);

    const satGeo = keepG(new THREE.IcosahedronGeometry(0.3, detail));
    // transparent from the start: the satellites have to be able to ghost with
    // the rest of the beacon while it recharges, and flipping `transparent` at
    // runtime recompiles the material.
    const satMat = keepM(new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1,
    }));
    satMesh = new THREE.InstancedMesh(satGeo, satMat, N * 3);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 3; k++) satMesh.setColorAt(i * 3 + k, new THREE.Color(SAT_COLORS[k]));
    }
    satMesh.instanceColor.needsUpdate = true;

    /* ── THE RECHARGE GAUGE: a constant-diameter ring with a filling arc ──────
       Round 1 drew this as a ring that GREW in diameter, 0.34 → 1.0, with no
       full-size reference next to it and no sweep. At 10% charge that is a
       barely-visible sliver: the "not yet" state was least legible exactly when
       a child most needs to read it, and there was nothing on screen to read it
       AGAINST. So it is now the gauge every eight-year-old already knows — a
       dim full circle that is always there at full size, and a bright arc that
       fills it clockwise from the top. Empty circle: not yet. Full circle: go.

       The arc is one geometry with a DRAW RANGE rather than a rebuilt mesh:
       RingGeometry with phiSegments = 1 emits its indices strictly in theta
       order, so truncating the index count IS the arc, and one cooldown drives
       every beacon — that is a single setDrawRange call a frame, no allocation.
       (Mirrored on X at build time so the fill runs clockwise; both materials
       are DoubleSide, so the flipped winding costs nothing.) */
    const arcGeo = keepG(new THREE.RingGeometry(1.62, 1.98, ringSegs, 1, Math.PI / 2, Math.PI * 2));
    arcGeo.scale(-1, 1, 1);
    const ringMat = keepM(new THREE.MeshStandardMaterial({
      color: 0xf4ecff, emissive: 0x9a6bff, emissiveIntensity: 2.9,
      roughness: 0.3, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
    }));
    indicatorMats.add(ringMat);
    ringMesh = new THREE.InstancedMesh(arcGeo, ringMat, N);

    // …and the track it fills: the same circle, always whole, always dim. This
    // is the reference the arc is read against, and it is why a nearly-empty
    // gauge still reads as a gauge rather than as a smudge.
    const trackGeo = keepG(new THREE.RingGeometry(1.66, 1.94, ringSegs, 1));
    const trackMat = keepM(new THREE.MeshBasicMaterial({
      color: 0x4a3a86, transparent: true, opacity: 0.42, side: THREE.DoubleSide,
      depthWrite: false,
    }));
    indicatorMats.add(trackMat);
    ringTrackMesh = new THREE.InstancedMesh(trackGeo, trackMat, N);
    if (wantBeam) {
      // A light column planted on the road plus a flat halo where it lands, so
      // the beacon is legible from the far end of a straight.
      const beamGeo = keepG(new THREE.CylinderGeometry(0.42, 1.1, 3.2, 12, 1, true));
      const beamMat = keepM(new THREE.MeshBasicMaterial({
        color: 0x8ce6ff, transparent: true, opacity: 0.3, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }));
      beamMesh = new THREE.InstancedMesh(beamGeo, beamMat, N);

      const padGeo = keepG(new THREE.RingGeometry(1.15, 1.75, 22));
      padGeo.rotateX(-Math.PI / 2);
      const padMat = keepM(new THREE.MeshBasicMaterial({
        color: 0x8ce6ff, transparent: true, opacity: 0.42, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }));
      indicatorMats.add(padMat);
      padMesh = new THREE.InstancedMesh(padGeo, padMat, N);
    }
    // NAMED, because the gates read the real scene graph rather than a flag:
    // "the beacons are ghosted" is a claim about a material, and the only honest
    // way to check it is to walk the live scene and look at that material.
    coreMesh.name = 'quiz:beacon-core';
    satMesh.name = 'quiz:beacon-sats';
    glowMesh.name = 'quiz:beacon-glow';
    if (ringMesh) ringMesh.name = 'quiz:beacon-ring';            // the filling arc
    if (ringTrackMesh) ringTrackMesh.name = 'quiz:beacon-ringtrack'; // the circle it fills
    if (beamMesh) beamMesh.name = 'quiz:beacon-beam';
    if (padMesh) padMesh.name = 'quiz:beacon-pad';
    for (const m of [beamMesh, padMesh, glowMesh, ringTrackMesh, ringMesh, coreMesh, satMesh]) {
      if (!m) continue;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      meshes.push(m);
      group.add(m);
    }
  }

  /* ── THE VISIBLE COOLDOWN ─────────────────────────────────────────────────
     The pacing rule is only allowed to exist because it is legible, so the
     beacon art carries it. Every beacon material's LIT values are recorded once
     here, and every frame the whole set is scaled between "ghosted" and "lit"
     by the cooldown — plus a short overshoot on the frame it comes back, which
     is the pop that says "they are live again" without a word of UI.
     One cooldown drives all six beacons, so this is six material writes a frame
     and not one per instance. */
  const litMats = mats.map(m => ({
    mat: m, opacity: m.opacity, emissiveIntensity: m.emissiveIntensity ?? 0,
    indicator: indicatorMats.has(m),
  }));
  let cooldown = 0;          // seconds left before the boxes are live again
  let cooldownFull = 0;      // …of how many, so the recharge ring has a scale
  let popT = 0;              // the re-activation flash, counting down
  let firstBoxDone = false;  // the FIRST box of a race ignores the cooldown

  /** 0 → just spent, 1 → fully charged. What the ring shows.
   *  `opts.forceCharge` pins it for screenshots (the previews are frozen, so
   *  nothing would ever drain a real cooldown there). */
  function chargeFrac() {
    if (opts.forceCharge != null) return opts.forceCharge;
    if (cooldown <= 0 || cooldownFull <= 0) return 1;
    return Math.max(0, Math.min(1, 1 - cooldown / cooldownFull));
  }
  /** Take `s` seconds off the recharge, from either source — the clock running
   *  or a ghosted box being driven through. Completing it is an EVENT, not a
   *  silent flag flip: the beacons flash back to full and say so on the bus. */
  function drainCooldown(s) {
    if (cooldown <= 0) return;
    cooldown = Math.max(0, cooldown - s);
    if (cooldown === 0) { popT = RECHARGE_POP_S; bus.emit('quiz:recharged', {}); }
  }
  /** True when driving through a beacon opens a question. */
  function beaconsLive() {
    if (opts.forceCharge != null) return false;
    return cooldown <= 0;
  }

  function applyChargeVisuals() {
    const live = beaconsLive();
    const pop = popT > 0 ? popT / RECHARGE_POP_S : 0;      // 1 → 0 over the beat
    const kO = (live ? 1 : GHOST_OPACITY) + pop * 0.3;
    const kE = (live ? 1 : GHOST_EMISSIVE) + pop * 1.4;
    const iO = (live ? 1 : GHOST_INDICATOR) + pop * 0.3;
    const iE = (live ? 1 : GHOST_INDICATOR) + pop * 1.4;
    for (const g of litMats) {
      const o = g.indicator ? iO : kO, e = g.indicator ? iE : kE;
      g.mat.opacity = Math.min(1, g.opacity * o);
      if (g.emissiveIntensity) g.mat.emissiveIntensity = g.emissiveIntensity * e;
    }
  }

  // Scratch objects — nothing is allocated inside the frame loop.
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const _cp = new THREE.Vector3();          // the camera, for billboarding the gauge
  const _axis = new THREE.Vector3(0.35, 1, 0.18).normalize();
  // The gauge only reads as a gauge if it is FACING the child, so it billboards
  // to whichever camera is rendering. Resolved per frame rather than captured:
  // the race scene and every preview() hand the engine a different one.
  function gaugeQuat(pos) {
    const cam = opts.camera || engine?.active?.camera || null;
    if (!cam) { _q.setFromAxisAngle(_axis, 0.5); return _q; }
    cam.getWorldPosition(_cp);
    _m.lookAt(_cp, pos, _up);               // local +Z toward the camera
    return _q.setFromRotationMatrix(_m);
  }

  let vis = 0;   // visual clock, always real time (beacons keep spinning in slow-mo)

  function writeInstances() {
    if (!N) return;
    applyChargeVisuals();
    // THE RECHARGE GAUGE. The circle never changes size — what changes is how
    // much of it is FILLED, clockwise from the top, and one setDrawRange says
    // it for every beacon on the track. Empty circle: not yet. Full circle: go.
    // On the frame it completes, the whole gauge overshoots once (the pop).
    const charge = chargeFrac();
    const pop = popT > 0 ? popT / RECHARGE_POP_S : 0;
    const live = beaconsLive();
    // A constant diameter, with a breath while live and the pop on top — the
    // size never carries information, so it can be pure life.
    const ringScale = 1 + pop * 0.28 + (live ? Math.sin(vis * 2.0) * 0.03 : 0);
    if (ringMesh) {
      const segs = Math.round((live ? 1 : Math.max(0, Math.min(1, charge))) * ringSegs);
      ringMesh.geometry.setDrawRange(0, segs * 6);   // 2 triangles per segment
      ringMesh.visible = segs > 0;
    }
    for (const b of beacons) {
      const on = b.alive ? 1 : 0.0001;
      const bob = Math.sin(vis * 1.7 + b.phase) * 0.22;

      _p.set(b.pos.x, b.pos.y + bob, b.pos.z);
      _q.setFromAxisAngle(_up, vis * 0.9 + b.phase);
      _s.set(on, on, on);
      _m.compose(_p, _q, _s);
      coreMesh.setMatrixAt(b.i, _m);

      if (glowMesh) {
        const pulse = on * (1 + Math.sin(vis * 2.4 + b.phase) * 0.09);
        _q.identity();
        _s.set(pulse, pulse, pulse);
        _m.compose(_p, _q, _s);
        glowMesh.setMatrixAt(b.i, _m);
        _s.set(on, on, on);
      }
      if (ringMesh) {
        // Same transform for the arc and the circle it fills — they are one
        // gauge, drawn as two meshes only because one of them is truncated.
        gaugeQuat(_p);
        const rs = on * ringScale;
        _s.set(rs, rs, rs);
        _m.compose(_p, _q, _s);
        ringMesh.setMatrixAt(b.i, _m);
        if (ringTrackMesh) ringTrackMesh.setMatrixAt(b.i, _m);
        _s.set(on, on, on);
      }
      if (beamMesh) {
        _p.set(b.pos.x, b.pos.y - 1.45, b.pos.z);
        _q.identity();
        _s.set(on, on, on);
        _m.compose(_p, _q, _s);
        beamMesh.setMatrixAt(b.i, _m);

        const halo = on * ringScale * (1 + Math.sin(vis * 2.2 + b.phase) * 0.12);
        _p.set(b.pos.x, b.pos.y - 1.49, b.pos.z);
        _q.setFromAxisAngle(_up, vis * 0.5);
        _s.set(halo, halo, halo);
        _m.compose(_p, _q, _s);
        padMesh.setMatrixAt(b.i, _m);
        _s.set(on, on, on);
      }
      for (let k = 0; k < 3; k++) {
        const a = vis * 1.5 + b.phase + (k * Math.PI * 2) / 3;
        _p.set(
          b.pos.x + Math.cos(a) * 1.85,
          b.pos.y + bob + Math.sin(vis * 2.1 + a) * 0.34,
          b.pos.z + Math.sin(a) * 1.85);
        _q.identity();
        _s.set(on, on, on);
        _m.compose(_p, _q, _s);
        satMesh.setMatrixAt(b.i * 3 + k, _m);
      }
    }
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  }
  writeInstances();

  /* ── question pool ────────────────────────────────────────────────────────
     Drawn without replacement so a child never sees the same question twice in
     one race; the pool refills (reshuffled) if a race somehow outlasts it. */
  // `askedIds` carries the championship's memory across races: scenes.js
  // accumulates the ids from `quiz:open` and hands them back, so race 2 never
  // repeats a question from race 1. quizdata falls back to the full eligible
  // list if excluding would starve the pool (MIN_POOL), so this can never
  // empty it.
  const eligible = questionsForDifficulty(difficulty, opts.askedIds);
  let pool = [];
  function refill() {
    pool = eligible.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  refill();

  /* ── DOM ──────────────────────────────────────────────────────────────────*/
  injectQuizCSS();
  const mount = opts.mount || engine?.ui || document.body;

  const elBadge = h('span.quiz-badge');
  const elTopic = h('span.quiz-topic');
  const elBarFill = h('i');
  const elBar = h('div.bar.quiz-timer', null, elBarFill);
  const elQ = h('div.quiz-q');
  const elHint = h('div.quiz-hint');
  const elFlash = h('div.quiz-flash');

  // MOUSE / TOUCH (Wave 4). Every option is a real <button>, and its `click` is
  // the ONE pointer event that matters: a mouse click, a finger tap and an
  // assistive-tech activation all raise it, so there is a single listener rather
  // than a mouse branch and a touch branch that drift apart. It calls the SAME
  // answer() the keyboard calls — the registry guard, the freeze, the feedback
  // state and the resume countdown are therefore not "also implemented" for the
  // pointer, they are the same lines. The only thing the `via` argument does is
  // record which hand arrived, so a gate can prove it actually took this path.
  const optEls = [];
  for (let k = 0; k < 3; k++) {
    const txt = h('span.quiz-txt');
    const btn = h('button.quiz-opt', {
      type: 'button', onclick: () => answer(k, 'pointer'),
    }, h('span.quiz-key.num', null, String(k + 1)), txt);
    optEls.push({ btn, txt });
  }
  const elOpts = h('div.quiz-opts', null, ...optEls.map(o => o.btn));

  const elVerdict = h('div.quiz-verdict');
  const elSub = h('span.quiz-sub');
  const elWarm = h('div.quiz-warm');
  const elWhy = h('div.quiz-why');
  const elVerdictTxt = h('span');
  elVerdict.append(elVerdictTxt, elSub);
  const elResult = h('div.quiz-result', null, elVerdict, elWarm, elWhy);

  // The explanation waits for Space, so there must also be something to click:
  // a mouse/touch player, and a player still holding Space as a drift key when
  // the beacon fired (their keydown already happened; auto-repeats are ignored
  // on purpose, see onKey), both need a visible way out.
  const elCont = h('button.btn.quiz-cont', { type: 'button', onclick: () => dismiss('pointer') });
  const elFoot = h('div.quiz-foot', null, elHint, elCont);

  const card = h('div.quiz-card.panel-lift', null,
    h('div.quiz-head', null, elBadge, elTopic),
    elBar, elQ, elOpts, elResult, elFoot);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');

  // `.on` on the scrim: pointer events are off for everything inside #ui, so
  // without it a tap that misses the card lands on the world behind the panel.
  // (It is inert while the root is hidden — `visibility:hidden` is not
  // hit-testable — so the menu backdrop's disabled quiz system swallows nothing.)
  const root = h('div.quiz-root', null, h('div.quiz-scrim.on'), card, elFlash);
  mount.appendChild(root);

  /* ── state ────────────────────────────────────────────────────────────────*/
  // idle | intro | question | feedback | resume
  //   intro/question/feedback/resume all hold the world at FREEZE_SCALE. `intro`
  //   is the one-time explainer, shown the first time a child ever meets a box;
  //   `resume` is the 3 · 2 · 1 hand-back: the panel is already gone, the sim is
  //   not back yet.
  let phase = 'idle';
  let phaseT = 0;            // seconds in the current phase (REAL time)
  let beat = -1;             // last countdown beat emitted during `resume`
  let scale = 1;             // the time scale handed back to race.js
  let shown = null;          // { data, order, correctSlot, limit }
  const asked = [];          // ids opened by THIS system, in order (see quiz:open)
  let body = null;           // player body, for applyBoost
  let lastResult = null;
  let introEl = null;        // the one-time explainer, while it is on screen
  let pendingPick = null;    // the question the explainer is standing in front of
  let lastVia = null;        // 'key' | 'pointer' — which hand drove the last step

  const offLang = bus.on('lang:changed', () => { if (phase !== 'idle') renderQuestion(); });

  function topicLabel(topic) { return t(`quiz.topic.${topic}`); }
  function L(data) { return getLang() === 'en' ? data.en : data.he; }

  function drawQuestion() {
    if (!pool.length) refill();
    const data = pool.pop();
    // Second shuffle layer: the authored correct index is spread across 0/1/2,
    // and this re-spreads it per draw so position never becomes a tell.
    const order = [0, 1, 2];
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return { data, order, correctSlot: order.indexOf(data.correct), limit: TIME_LIMIT[data.tier] || 22 };
  }

  function renderQuestion() {
    if (!shown) return;
    const s = L(shown.data);
    elBadge.textContent = t('quiz.badge');
    elTopic.textContent = topicLabel(shown.data.topic);
    elQ.textContent = s.q;
    for (let k = 0; k < 3; k++) optEls[k].txt.textContent = s.a[shown.order[k]];
    elHint.textContent = phase === 'feedback'
      ? t('quiz.pressSpace') : t('quiz.hint', { k: num('1 · 2 · 3') });
    elHint.classList.remove('held');
    elCont.textContent = t('quiz.continueBtn');
    if (shown.answered != null || shown.timedOut) renderResult();
  }

  function renderResult() {
    const s = L(shown.data);
    const good = shown.answered === shown.correctSlot;
    elResult.classList.toggle('good', good);
    elResult.classList.toggle('soft', !good);
    elVerdictTxt.textContent = good ? t('quiz.correct')
      : (shown.timedOut ? t('quiz.timeUp') : t('quiz.answerMarked'));
    const paid = REWARD_TOKENS[shown.data.tier] || 1;
    elSub.textContent = good
      ? (paid === 1 ? t('quiz.reward1') : t('quiz.reward', { n: num(paid) }))
      : t('quiz.noPenalty');
    elWarm.textContent = good ? '' : t(shown.warmKey);
    elWarm.style.display = good ? 'none' : '';
    elWhy.textContent = s.why;
  }

  /** True when this child has never met a question box before AND nothing else
   *  owns the screen. `opts.forceIntro` is for the preview only. */
  function introDue() {
    // `forceIntro` is a preview/gate override in BOTH directions: true = always,
    // false = never (the question previews must show a question, not the
    // explainer, on a machine whose save has never seen one). Left undefined —
    // which is what the game passes — it is the save flag and nothing else.
    if (opts.forceIntro != null) return !!opts.forceIntro && !modalOpen();
    return shouldShowFirstQuizPopup();
  }

  /**
   * The one-time explainer, shown INSTEAD of the question for one beat and then
   * followed straight into it. The world is frozen for the whole of it (phase is
   * not 'idle', so the time scale is FREEZE_SCALE and race.js gates input off
   * exactly as it does for a question — D12's held keys survive it for free).
   */
  function openIntro(pick) {
    pushModal('quiz');
    phase = 'intro';
    phaseT = 0;
    pendingPick = pick || null;
    const el = firstQuizPopup({
      persist: opts.introPersist !== false,
      onClose: () => {
        if (introEl !== el) return;     // torn down by close()/dispose(): nothing follows
        introEl = null;
        phase = 'idle';
        popModal('quiz');
        const p = pendingPick;
        pendingPick = null;
        bus.emit('quiz:introClosed', {});
        openQuestion(p);                // …and now the question the box was for
        // Normally the question follows immediately and close() will start the
        // cadence clock for the pair. If something took the screen in between,
        // nothing followed — and the explainer was still a teaching card, so
        // the clock has to start here instead.
        if (phase === 'idle') noteTeachingCard();
      },
    });
    introEl = el;
    mount.appendChild(el);
    // Deliberately NOT focused: a focused <button> activates on the keyUP of
    // Space, which is the one key a child may already be holding down (drift)
    // when the box fires — the card would be gone before it was read. Space is
    // handled by the popup's own keydown instead, where e.repeat can guard it.
    bus.emit('quiz:intro', {});
  }

  function openQuestion(pick) {
    if (phase !== 'idle') return;
    // Never open on top of the token explainer, Boreg's introduction or the
    // pause menu. The beacon that triggered us has already been consumed and
    // will respawn, so nothing is lost — the question simply comes later.
    if (modalOpen('quiz')) return;
    // A box has now opened this race, so the "the first box is always live"
    // exemption is spent. It is set HERE rather than at the beacon because the
    // previews and the gates force-open questions through this same door: a
    // forced question is still a question the child has been asked, and a beacon
    // met right after one must obey the cooldown like any other.
    firstBoxDone = true;
    // First box this child has ever met: explain what a box IS first. If
    // anything else owns the screen, introDue() is false and the flag is left
    // alone, so the NEXT box explains instead (the registry policy, D15/D18).
    if (introDue()) { openIntro(pick); return; }
    pushModal('quiz');
    shown = pick || drawQuestion();
    asked.push(shown.data.id);
    shown.answered = null;
    shown.timedOut = false;
    shown.warmKey = `quiz.warm.${1 + Math.floor(rng() * 4)}`;
    phase = 'question';
    phaseT = 0;
    card.classList.remove('quiz-answered');
    root.classList.remove('quiz-good');
    for (const o of optEls) { o.btn.classList.remove('ok', 'no', 'dim'); o.btn.disabled = false; }
    elBar.classList.remove('low');
    elBarFill.style.width = '100%';
    renderQuestion();
    root.classList.add('show');
    card.classList.remove('pop-in'); void card.offsetWidth; card.classList.add('pop-in');
    addEventListener('keydown', onKey);
    bus.emit('quiz:open', { id: shown.data.id, tier: shown.data.tier, topic: shown.data.topic });
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Auto-repeat is not a press. Space is also the drift key: a child who was
    // holding it when the beacon fired would otherwise have the explanation
    // dismissed for them, by a key they never released.
    if (e.repeat) {
      // …but that leaves a keyboard-only dead end: they press the key the panel
      // told them to press and NOTHING happens, with no way out but the mouse.
      // The auto-repeat is itself the proof the key is being held, so use it to
      // say the one thing that unsticks them.
      if (phase === 'feedback' && (e.code === 'Space' || e.code === 'Enter')) {
        elHint.textContent = t('quiz.spaceHeld');
        elHint.classList.add('held');
      }
      return;
    }
    // Something is layered over us (pause menu, a one-time explainer). Its keys
    // are not ours: without this, 1/2/3 answered — and closed — a question the
    // child could not even see while the pause menu was up. Space would likewise
    // have dismissed the feedback from behind the pause menu.
    if (modalOpen('quiz')) return;
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
    if (phase === 'question') {
      if (digit == null) return;
      e.preventDefault();
      answer(digit, 'key');
    } else if (phase === 'feedback') {
      // Space is the one documented key; Enter is accepted as the usual
      // "confirm" alias. Digits deliberately are NOT — the child just pressed
      // one to answer, and the explanation must not blink away under a
      // double-tap. DISMISS_AFTER_S covers the same trap for Space/Enter.
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      e.preventDefault();
      dismiss('key');            // the DISMISS_AFTER_S arming lives inside dismiss()
    }
  }

  /**
   * THE one place an answer is chosen, whatever chose it: 1/2/3, a mouse click
   * on the option, or a finger tap on it. `via` is recorded and nothing else —
   * every rule below applies to all of them identically.
   */
  function answer(slot, via = 'code') {
    // The SAME policy the keyboard obeys, enforced in the same place. `onKey`
    // checked this; the `.quiz-opt` onclick did not, so a programmatic click
    // answered a question hidden behind the pause menu and started the 3·2·1
    // underneath it. That it was unreachable with a real mouse was geometry
    // (the full-screen `.mn-ov` swallows the click), not policy — and geometry
    // is not what the modal registry exists to rely on (D15/D18).
    if (modalOpen('quiz')) return false;
    if (phase !== 'question' || shown.answered != null) return false;
    lastVia = via;
    shown.answered = slot;
    finishQuestion(false);
    return true;
  }

  function timeout() {
    shown.timedOut = true;
    finishQuestion(true);
  }

  function finishQuestion(timedOut) {
    const good = !timedOut && shown.answered === shown.correctSlot;
    phase = 'feedback';
    phaseT = 0;
    removeEventListener('keydown', onKey);
    addEventListener('keydown', onKey);   // re-arm for "press to continue"

    for (let k = 0; k < 3; k++) {
      const btn = optEls[k].btn;
      btn.disabled = true;
      if (k === shown.correctSlot) btn.classList.add('ok');
      else if (k === shown.answered) btn.classList.add('no');
      else btn.classList.add('dim');
    }
    card.classList.add('quiz-answered');
    root.classList.toggle('quiz-good', good);
    elHint.textContent = t('quiz.pressSpace');
    elHint.classList.remove('held');
    elCont.textContent = t('quiz.continueBtn');
    renderResult();

    if (good) {
      elFlash.classList.remove('fx'); void elFlash.offsetWidth; elFlash.classList.add('fx');
      if (body?.applyBoost) body.applyBoost(BOOST.strength, BOOST.duration, BOOST.impulse);
    }
    emitResult(good, timedOut);
  }

  function emitResult(good, timedOut) {
    const d = shown.data;
    const payload = {
      id: d.id, tier: d.tier, topic: d.topic,
      correct: good,
      chosen: shown.answered == null ? null : shown.order[shown.answered],
      correctIndex: d.correct,
      tokens: good ? (REWARD_TOKENS[d.tier] ?? 1) : 0,
      timedOut: !!timedOut,
    };
    lastResult = payload;
    bus.emit(good ? 'quiz:correct' : timedOut ? 'quiz:timeout' : 'quiz:wrong', payload);
    opts.onResult?.(payload);
  }

  /**
   * The child has read the explanation and pressed Space (or the button). Take
   * the panel away and hand the world back with a 3 · 2 · 1 — the sim stays
   * frozen right through it, so the kart is never moving again before the
   * player is looking at the road instead of at a paragraph.
   */
  function dismiss(via = 'code') {
    // Same reason as answer(): the gold continue button is a pointer path into
    // the same state machine, and the policy belongs to the registry.
    if (modalOpen('quiz')) return false;
    if (phase !== 'feedback') return false;
    // The arming delay used to live in the KEY handler only, so a fast
    // double-click — answer, then the continue button appearing under the
    // cursor — could blink the explanation away exactly the way a double-tap of
    // `1` used to. It belongs here, where both hands pass through it.
    if (phaseT <= DISMISS_AFTER_S) return false;
    lastVia = via;
    hidePanel();
    phase = 'resume';
    phaseT = 0;
    beat = -1;
    bus.emit('quiz:dismiss', lastResult);
    return true;
  }

  function hidePanel() {
    root.classList.remove('show');
    root.classList.remove('quiz-good');
    card.classList.remove('quiz-answered');
    removeEventListener('keydown', onKey);
  }

  function close() {
    if (phase === 'idle') return;
    // A scene change on top of the explainer: take it away WITHOUT letting its
    // onClose run on into a question (introEl is cleared first, and onClose
    // checks its own identity against it).
    if (introEl) { const el = introEl; introEl = null; pendingPick = null; el.close(); }
    popModal('quiz');
    hidePanel();
    phase = 'idle';
    phaseT = 0;
    beat = -1;
    cooldown = lastResult?.timedOut ? COOLDOWN_IGNORED_S : COOLDOWN_S;
    cooldownFull = cooldown;      // the denominator the recharge ring fills over
    popT = 0;
    // The whole episode — explainer, question, feedback, 3·2·1 — is ONE
    // teaching card, and this is the moment it lets go of the screen. The
    // cadence clock starts here so the OTHER cards (the first-token explainer)
    // do not land on its heels. It no longer gates question boxes — that gate
    // is what Wave 5.1 removed; see the beacon hit in update().
    noteTeachingCard();
    bus.emit('quiz:close', lastResult);
  }

  /* ── frame ────────────────────────────────────────────────────────────────*/
  /**
   * @param {number} dt    REAL seconds since the last frame (never scaled)
   * @param {object} playerBody  KartBody — read for position, given the boost
   * @param {object} ctx   { racing:boolean } — false during countdown/after flag
   * @returns {number} time scale for race.js to multiply its dt by: 1 while
   *          idle, 0 for the whole question → feedback → countdown sequence.
   */
  function update(dt, playerBody, ctx) {
    if (playerBody) body = playerBody;
    vis += dt;

    if (!freeze) {
      if (cooldown > 0) drainCooldown(dt);
      if (popT > 0) popT = Math.max(0, popT - dt);
      // Respawn is RACING time, not wall time: it only ticks while the world is
      // actually running. A panel freezes the world (D11/D20 — a child is never
      // charged race time for reading), and a beacon that quietly recharged
      // itself behind a question the child was reading is the same dishonesty
      // as a lap timer that did. It is also the difference between a rule and a
      // loophole: a question that TIMES OUT burns 20 wall seconds, and while
      // respawn drained through it a child who ignored every box got the
      // beacons back faster than one who answered them — and, now that every
      // beacon pays a token, got paid more for ignoring the game.
      if (phase === 'idle') {
        for (const b of beacons) {
          if (b.alive) continue;
          b.respawn -= dt;
          if (b.respawn <= 0) b.alive = true;
        }
      }
    }

    // `blocked` = some OTHER panel owns the screen right now. While it does we
    // neither arm a beacon nor advance our own countdown, so a question can
    // never be lost behind a popup a child is still reading.
    const blocked = modalOpen('quiz');

    if (phase === 'idle' && enabled && !freeze && !blocked
        && ctx?.racing !== false && body) {
      const hit = findHit(body.position);
      if (hit) {
        // ── THE ONE RULE, AND IT IS VISIBLE ──────────────────────────────────
        // A beacon opens a question unless the boxes are recharging, and while
        // they are recharging you can SEE it: ghosted core, ring filling back
        // up. There is no second, invisible reason a box can decline to fire —
        // Wave 5's teaching-card gate lived here and is gone. Cards still space
        // themselves (close() below still calls noteTeachingCard(), so the
        // first-token explainer does not land on a box's heels); what changed is
        // that a CARD's cadence can no longer eat a BOX.
        //
        // And the FIRST box of every race is live whatever the clock says. A
        // fresh race starts with cooldown 0 anyway; stating it as its own
        // condition is what makes it a promise rather than an accident, and it
        // is the promise the gate holds us to.
        const live = !firstBoxDone || beaconsLive();
        const charge = chargeFrac();
        hit.alive = false;
        hit.respawn = RESPAWN_S;
        bus.emit('quiz:beacon', {
          i: hit.i, active: live, charge,
          x: hit.pos.x, y: hit.pos.y, z: hit.pos.z,
        });
        if (live) {
          openQuestion();          // …which is what marks the exemption spent
        } else {
          // Driving through a recharging box is never nothing: it SHAVES the
          // recharge (every beacon's arc jumps forward on the same frame) and
          // race.js puts a sparkle on the thing you touched. What it explicitly
          // does not pay is currency — see the note over SOFT_SHAVE_S and the
          // handler in race.js.
          //
          // It cannot be farmed: the beacon is consumed on the line above and
          // comes back on the normal RESPAWN_S path, so one beacon shaves at
          // most once per life and circling one pays nothing.
          drainCooldown(SOFT_SHAVE_S);
          bus.emit('quiz:softToken', {
            i: hit.i, x: hit.pos.x, y: hit.pos.y, z: hit.pos.z,
            shaved: SOFT_SHAVE_S, charge: chargeFrac(),
          });
        }
      }
    }

    // The flag fell (or the race left the racing phase) with a panel still up:
    // shut it rather than hold the world at 0.7× through the results flourish.
    if (phase !== 'idle' && !freeze && ctx && ctx.racing === false) close();

    if (phase !== 'idle' && !freeze && !blocked) {
      phaseT += dt;
      if (phase === 'question') {
        const left = Math.max(0, shown.limit - phaseT);
        const frac = shown.limit > 0 ? left / shown.limit : 0;
        elBarFill.style.width = (frac * 100).toFixed(1) + '%';
        elBar.classList.toggle('low', frac < 0.28);
        if (left <= 0) timeout();
      } else if (phase === 'resume') {
        // 3 · 2 · 1 · GO on the HUD's own countdown gantry, reusing the exact
        // events the race start uses so the lights, the beeps and the GO
        // flourish are the ones the child already learned in the first 3 seconds
        // of the race. The world is still frozen for every one of these beats.
        const b = Math.min(RESUME_BEATS, Math.floor(phaseT / RESUME_BEAT_S));
        if (b !== beat) {
          beat = b;
          bus.emit('race:countdown', { n: RESUME_BEATS - b });   // 3,2,1 then 0 = GO
        }
        if (phaseT >= RESUME_BEATS * RESUME_BEAT_S) close();
      }
      // `feedback` has no timer at all: it waits for Space (see dismiss()).
    }

    // Time scale. Not smoothed and not partial: while the panel owns the screen
    // the world is stopped dead (zero fixed steps), and the frame the panel
    // leaves on is the frame the world starts again. Anything in between would
    // be a half-simulated race and a dishonest lap time.
    scale = phase === 'idle' ? 1 : FREEZE_SCALE;

    writeInstances();
    return scale;
  }

  function findHit(p) {
    const r2 = HIT_RADIUS * HIT_RADIUS;
    for (const b of beacons) {
      if (!b.alive) continue;
      const dx = p.x - b.pos.x, dz = p.z - b.pos.z, dy = p.y - b.pos.y;
      if (dy * dy > HIT_HEIGHT * HIT_HEIGHT) continue;
      if (dx * dx + dz * dz < r2) return b;
    }
    return null;
  }

  return {
    group,
    update,
    get active() { return phase !== 'idle'; },
    /** True for the whole frozen sequence — question, feedback AND the 3·2·1. */
    get frozen() { return phase !== 'idle'; },
    get phase() { return phase; },
    /** The id of the question currently on screen, or null. */
    get currentId() { return phase === 'idle' ? null : (shown?.data?.id ?? null); },
    /** The tier of the question currently on screen, or null. */
    get currentTier() { return phase === 'idle' ? null : (shown?.data?.tier ?? null); },
    /** Which of the three buttons is the right one — the option ORDER is shuffled
     *  per showing, so a gate that wants to play as a child who ANSWERS WELL
     *  cannot work it out from the question bank alone. Exists for the token
     *  economy gate: without it no automated driver can produce the quiz term
     *  that dominates the wallet, which is precisely how that term went
     *  unmeasured for three waves (D29). */
    get correctSlot() { return phase === 'idle' ? null : (shown?.correctSlot ?? null); },
    /** Every id this race has shown, in order — the same ids `quiz:open` carries. */
    get askedIds() { return asked.slice(); },
    /** How many questions are eligible after the championship exclusion. */
    get poolSize() { return eligible.length; },
    get timeScale() { return scale; },
    get lastResult() { return lastResult; },
    get beaconCount() { return N; },
    /** 'key' | 'pointer' — which input drove the last answer/dismiss. Exists so
     *  a gate can prove the pointer path was the one actually exercised. */
    get lastVia() { return lastVia; },
    /** Is the one-time first-question-box explainer on screen right now? */
    get introOpen() { return !!introEl; },
    /** Would driving through a beacon RIGHT NOW open a question? This is the
     *  same predicate the art shows, so a gate can pair "the code says live"
     *  with "the materials look live" and catch the two drifting apart. */
    get beaconsLive() { return beaconsLive(); },
    /** 0 → just spent, 1 → charged. The number the recharge ring draws. */
    get charge() { return chargeFrac(); },
    get cooldownLeft() { return cooldown; },
    /** Has a box opened yet this race? Until it has, the cooldown is ignored. */
    get firstBoxDone() { return firstBoxDone; },
    /** Force a question open — used by previews and by the dev harness. */
    openQuestion(pick) { openQuestion(pick); },
    /** The player's "I have read it" — feedback → 3·2·1 → resume. */
    dismiss,
    /** Force the panel shut immediately, skipping the countdown (scene change). */
    close,
    dispose() {
      if (introEl) { const el = introEl; introEl = null; pendingPick = null; el.close(); }
      popModal('quiz');            // a torn-down scene must not leave a phantom
      removeEventListener('keydown', onKey);
      offLang();
      root.remove();
      for (const m of meshes) m.dispose?.();
      for (const g of geos) g.dispose();
      for (const mt of mats) mt.dispose();
      group.clear();
      group.removeFromParent?.();
    },
  };
}

/* ═════════════════════════════════════════════════════════════════ previews ══ */
// Every preview builds the real oasis track so the beacons are judged in the
// context they ship in — including a cluster of the gold token pickups, because
// "instantly distinguishable from a token" is the thing a critic must check.

function previewScene(engine, o = {}) {
  const scene = new THREE.Scene();
  const { def, spline } = getTrack(0);
  const rig = applyTheme(scene, def.theme, engine);
  const track = buildTrack(0, engine);
  scene.add(track.group);

  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.25, Math.max(900, engine.q.drawDistance * 1.5));

  const quiz = createQuizSystem(engine, {
    spline, def, difficulty: o.difficulty ?? 1, rng: makeRng(7311),
    enabled: false, freeze: true, mount: engine.ui,
    // Screenshots must not depend on whether this machine's save has ever seen
    // a question box: the explainer is forced on for previewIntro and forced
    // OFF for every other preview, and never writes the flag either way.
    forceIntro: !!o.intro, introPersist: false,
    // null → the beacons are LIVE. A number pins them to that much charge, so
    // the "recharging" screenshot is the same scene as the "live" one with the
    // one thing under test changed.
    forceCharge: o.charge ?? null,
  });
  scene.add(quiz.group);

  // Gold tokens laid out just short of the beacon — the exact side-by-side a
  // player sees, and the comparison a critic has to be able to make.
  const bt = ((def.startT + 0.62 / 6) % 1 + 1) % 1;
  const tGeo = new THREE.OctahedronGeometry(0.62, 0);
  const tMat = new THREE.MeshStandardMaterial({
    color: 0xffd66b, emissive: 0xffb020, emissiveIntensity: 1.6,
    roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.95,
  });
  const tokenPts = [];
  for (let r = 0; r < 2; r++) {
    const tt = (bt + (16 + r * 6) / spline.length) % 1;
    const w = spline.widthAt(tt);
    for (const lat of [-0.5, -0.17, 0.17, 0.5]) {
      const p = spline.offsetPoint(tt, lat * w);
      p.y += 1.05;
      tokenPts.push(p);
    }
  }
  const tMesh = new THREE.InstancedMesh(tGeo, tMat, tokenPts.length);
  const mm = new THREE.Matrix4();
  tokenPts.forEach((p, i) => tMesh.setMatrixAt(i, mm.makeTranslation(p.x, p.y, p.z)));
  tMesh.instanceMatrix.needsUpdate = true;
  tMesh.frustumCulled = false;
  scene.add(tMesh);

  // Frame the beacon from a driver-ish height, just behind and to one side.
  const camT = (bt - 15 / spline.length + 1) % 1;
  const look = spline.offsetPoint(bt, -spline.widthAt(bt) * 0.17);
  look.y += 1.1;
  const cp = spline.offsetPoint(camT, 1.8);
  cp.y += 2.5;
  camera.position.copy(cp);
  camera.lookAt(look);

  if (o.intro) {
    quiz.openQuestion(pickDemoQuestion('prompt-better-one', o.difficulty ?? 1));
  } else if (o.demo) {
    const pick = pickDemoQuestion(o.demo, o.difficulty ?? 1);
    quiz.openQuestion(pick);
    if (o.state === 'correct') simulateAnswer(pick.correctSlot);
    else if (o.state === 'wrong') simulateAnswer((pick.correctSlot + 1) % 3);
    else {
      // Show the timer part-drained: a full bar reads as "not started yet".
      const bar = engine.ui.querySelector('.quiz-timer > i');
      if (bar) bar.style.width = '64%';
    }
  }

  function simulateAnswer(slot) {
    // Click rather than reach inside: exercises the same path the player takes.
    engine.ui.querySelectorAll('.quiz-opt')[slot]?.click();
  }

  let clock = 0;
  return {
    scene, camera,
    update(dt) {
      clock += dt;
      quiz.update(dt, null, { racing: false });
      track.update(clock);
      rig.update?.(dt, camera);
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() {
      quiz.dispose(); track.dispose(); rig.dispose?.();
      tGeo.dispose(); tMat.dispose(); tMesh.dispose();
      scene.clear();
    },
  };
}

// A fixed, representative question for screenshots — the same one every run so
// visual diffs stay meaningful. Options are laid out in authored order here.
function pickDemoQuestion(id, difficulty) {
  const pool = questionsForDifficulty(difficulty);
  const data = pool.find(x => x.id === id) || pool[0];
  return { data, order: [0, 1, 2], correctSlot: data.correct, limit: TIME_LIMIT[data.tier] || 22 };
}

/** The beacons in their track context, next to the gold tokens they must not be confused with. */
export function preview(engine) { return previewScene(engine); }

/** The SAME beacon while the boxes are recharging: ghosted core and satellites,
 *  ring pulled in to show a part-filled charge. Shot next to preview() above,
 *  the pair is the whole legibility claim — a child can tell at a glance which
 *  of the two they are driving at. */
export function previewRecharging(engine) { return previewScene(engine, { charge: 0.45 }); }

/** The hardest state to draw and the one that matters most: barely recharged.
 *  Round 1's growing ring was a sliver here; the constant circle with an almost
 *  empty arc has to still read as "not yet, and here is how far off" — at both
 *  quality tiers, which is what shots/w51r2-ring-*-c10.png are for. */
export function previewRechargingEarly(engine) { return previewScene(engine, { charge: 0.1 }); }

/** Almost charged: the ring nearly full, moments before the boxes pop back on. */
export function previewRecharged(engine) { return previewScene(engine, { charge: 0.92 }); }

/** The question panel, open and waiting for 1/2/3. */
export function previewQuestion(engine) {
  return previewScene(engine, { demo: 'prompt-better-one' });
}

/** The celebration state: right answer, turbo, tokens, explanation. */
export function previewCorrect(engine) {
  return previewScene(engine, { demo: 'prompt-better-one', state: 'correct' });
}

/** The no-penalty state: wrong answer, correct one marked, warm line, explanation. */
export function previewWrong(engine) {
  return previewScene(engine, { demo: 'prompt-better-one', state: 'wrong' });
}

/** The one-time explainer, as a child meets their very first question box. */
export function previewIntro(engine) {
  return previewScene(engine, { intro: true });
}

export { QUESTIONS, bankStats, tiersForDifficulty };

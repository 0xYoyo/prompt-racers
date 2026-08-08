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
// ═════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { bus } from '../core/bus.js';
import { makeRng } from '../core/rng.js';
import { h, injectStyles, pushModal, popModal, modalOpen } from '../ui/style.js';
import { registerStrings, t, num, getLang } from '../ui/i18n.js';
import { QUESTIONS, questionsForDifficulty, tiersForDifficulty, bankStats } from './quizdata.js';
// Preview-only (the game imports these long before quiz.js is reached, so this
// costs the bundle nothing).
import { getTrack } from '../track/trackdef.js';
import { buildTrack } from '../track/trackbuild.js';
import { applyTheme } from '../gfx/sky.js';

/* ══════════════════════════════════════════════════════════════════ strings ══ */

registerStrings({
  he: {
    'quiz.badge': 'שאלת פרומפט',
    'quiz.hint': 'בוחרים עם {k}',
    'quiz.correct': 'נכון!',
    'quiz.reward': 'טורבו ועוד {n} טוקנים',
    'quiz.timeUp': 'נגמר הזמן',
    'quiz.answerMarked': 'התשובה הנכונה מסומנת',
    'quiz.continue': 'ממשיכים לנסוע…',
    'quiz.pressSpace': 'לוחצים רווח כדי להמשיך',
    'quiz.continueBtn': 'ממשיכים! (רווח)',
    'quiz.noPenalty': 'בלי עונש. ממשיכים!',
    'quiz.warm.1': 'לא נורא בכלל — עכשיו יש כאן משהו חדש שיודעים.',
    'quiz.warm.2': 'ניסיון יפה! גם תשובה שלא קלעה מלמדת משהו.',
    'quiz.warm.3': 'קרוב! שווה לזכור את זה לשאלה הבאה.',
    'quiz.warm.4': 'זה בסדר גמור. ככה בדיוק לומדים דברים חדשים.',
    'quiz.topic.whatai': 'מה זה AI',
    'quiz.topic.prompt': 'פרומפטים',
    'quiz.topic.tokens': 'טוקנים',
    'quiz.topic.iterate': 'לנסות שוב',
    'quiz.topic.mistakes': 'לבדוק אחרי ה־AI',
    'quiz.topic.vibe': 'וייב־קודינג',
  },
  en: {
    'quiz.badge': 'Prompt question',
    'quiz.hint': 'Choose with {k}',
    'quiz.correct': 'Correct!',
    'quiz.reward': 'Turbo and {n} tokens',
    'quiz.timeUp': 'Time is up',
    'quiz.answerMarked': 'The right answer is marked',
    'quiz.continue': 'Back to racing…',
    'quiz.pressSpace': 'Press Space to continue',
    'quiz.continueBtn': 'Keep racing! (Space)',
    'quiz.noPenalty': 'No penalty. Keep going!',
    'quiz.warm.1': 'No harm done — that is one new thing you now know.',
    'quiz.warm.2': 'Nice try! An answer that misses still teaches something.',
    'quiz.warm.3': 'Close! Worth remembering for the next one.',
    'quiz.warm.4': 'That is completely fine. This is exactly how new things are learned.',
    'quiz.topic.whatai': 'What AI is',
    'quiz.topic.prompt': 'Prompts',
    'quiz.topic.tokens': 'Tokens',
    'quiz.topic.iterate': 'Trying again',
    'quiz.topic.mistakes': 'Checking the AI',
    'quiz.topic.vibe': 'Vibe coding',
  },
});

/* ══════════════════════════════════════════════════════════════════ tuning ══ */

const BEACONS = 6;            // per lap — a player meets 2–3 per lap in practice
const HIT_RADIUS = 3.4;       // generous: kids should not have to thread a needle
const HIT_HEIGHT = 4.0;       // vertical tolerance (jumps on Cloud Peak)
const RESPAWN_S = 26;         // a used beacon comes back later in the race
// After any question, no beacon can fire for this long. Raised 6 → 10 in the
// Wave-2 smoothing pass: with three laps and 2–3 beacons met per lap, a six
// second gap let a second panel open before the world had finished easing back
// to full speed, so a lap could read as one long slow-motion sequence.
const COOLDOWN_S = 10;
// …and a much longer one after a question that timed out. This is the whole
// answer to "a player who ignores the panel leaves the world slowed for a long
// stretch": someone who is engaging gets the next question soon, someone who
// drove straight past gets a proper run of clean racing before the next one.
// It is a pacing rule, never a punishment — the reward for answering is more
// questions, not fewer.
const COOLDOWN_IGNORED_S = 24;

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

const REWARD_TOKENS = { 1: 3, 2: 4, 3: 5 };
const BOOST = { strength: 1.3, duration: 2.4, impulse: 6 };

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
.quiz-opt{display:flex;align-items:center;gap:clamp(9px,1.4vw,15px);width:100%;
  font-family:var(--font);text-align:start;cursor:pointer;
  padding:clamp(7px,1.15vh,13px) clamp(9px,1.1vw,15px);
  border-radius:var(--r-m);color:var(--txt);
  background:linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.035));
  border:1px solid var(--stroke-hi);
  transition:transform .12s var(--ease),background .15s,border-color .15s,filter .15s}
.quiz-opt:hover{background:rgba(255,255,255,.15);transform:translateY(-1px)}
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
/* Only offered once the feedback is up — while the question is live there is
   nothing to continue to. */
.quiz-cont{display:none;padding:8px 18px;font-size:clamp(13px,1.8vh,16px)}
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
.quiz-flash.on{animation:quizFlash .55s var(--ease) both}
@keyframes quizFlash{0%{opacity:0}18%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.quiz-flash.on{animation:none}}
`;

function injectQuizCSS() {
  injectStyles();
  if (document.getElementById('pr-quiz-style')) return;
  const el = document.createElement('style');
  el.id = 'pr-quiz-style';
  el.textContent = QUIZ_CSS;
  document.head.appendChild(el);
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
  const wantRing = q.propDensity >= 0.5;
  const wantBeam = q.propDensity >= 0.35;

  const geos = [], mats = [], meshes = [];
  const keepG = g => { geos.push(g); return g; };
  const keepM = m => { mats.push(m); return m; };

  const beacons = [];
  if (spline) {
    const startT = def?.startT ?? 0;
    for (let i = 0; i < BEACONS; i++) {
      // Offset by 0.62/BEACONS so beacons never land on the token clusters,
      // which trackbuild puts at startT + (g + 0.5)/8.
      const bt = (((startT + (i + 0.62) / BEACONS) % 1) + 1) % 1;
      const w = spline.widthAt(bt);
      const lateral = (i % 2 === 0 ? -1 : 1) * w * 0.17;
      const p = spline.offsetPoint(bt, lateral);
      p.y += 1.55;
      beacons.push({ i, t: bt, pos: p, alive: true, respawn: 0, phase: rng() * Math.PI * 2 });
    }
  }
  const N = beacons.length;

  let coreMesh = null, satMesh = null, ringMesh = null, beamMesh = null, glowMesh = null, padMesh = null;
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
    const satMat = keepM(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    satMesh = new THREE.InstancedMesh(satGeo, satMat, N * 3);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 3; k++) satMesh.setColorAt(i * 3 + k, new THREE.Color(SAT_COLORS[k]));
    }
    satMesh.instanceColor.needsUpdate = true;

    if (wantRing) {
      const ringGeo = keepG(new THREE.TorusGeometry(1.85, 0.1, 6, detail ? 28 : 16));
      const ringMat = keepM(new THREE.MeshStandardMaterial({
        color: 0xd0b6ff, emissive: 0x7b4bff, emissiveIntensity: 1.9,
        roughness: 0.3, transparent: true, opacity: 0.9,
      }));
      ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, N);
    }
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
      padMesh = new THREE.InstancedMesh(padGeo, padMat, N);
    }
    for (const m of [beamMesh, padMesh, glowMesh, ringMesh, coreMesh, satMesh]) {
      if (!m) continue;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      meshes.push(m);
      group.add(m);
    }
  }

  // Scratch objects — nothing is allocated inside the frame loop.
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const _axis = new THREE.Vector3(0.35, 1, 0.18).normalize();

  let vis = 0;   // visual clock, always real time (beacons keep spinning in slow-mo)

  function writeInstances() {
    if (!N) return;
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
        _q.setFromAxisAngle(_axis, -vis * 1.25 + b.phase);
        _m.compose(_p, _q, _s);
        ringMesh.setMatrixAt(b.i, _m);
      }
      if (beamMesh) {
        _p.set(b.pos.x, b.pos.y - 1.45, b.pos.z);
        _q.identity();
        _s.set(on, on, on);
        _m.compose(_p, _q, _s);
        beamMesh.setMatrixAt(b.i, _m);

        const halo = on * (1 + Math.sin(vis * 2.2 + b.phase) * 0.12);
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

  const optEls = [];
  for (let k = 0; k < 3; k++) {
    const txt = h('span.quiz-txt');
    const btn = h('button.quiz-opt', {
      type: 'button', onclick: () => answer(k),
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
  const elCont = h('button.btn.quiz-cont', { type: 'button', onclick: () => dismiss() });
  const elFoot = h('div.quiz-foot', null, elHint, elCont);

  const card = h('div.quiz-card.panel-lift', null,
    h('div.quiz-head', null, elBadge, elTopic),
    elBar, elQ, elOpts, elResult, elFoot);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');

  const root = h('div.quiz-root', null, h('div.quiz-scrim'), card, elFlash);
  mount.appendChild(root);

  /* ── state ────────────────────────────────────────────────────────────────*/
  // idle | question | feedback | resume
  //   question/feedback/resume all hold the world at FREEZE_SCALE. `resume` is
  //   the 3 · 2 · 1 hand-back: the panel is already gone, the sim is not back yet.
  let phase = 'idle';
  let phaseT = 0;            // seconds in the current phase (REAL time)
  let beat = -1;             // last countdown beat emitted during `resume`
  let cooldown = 0;
  let scale = 1;             // the time scale handed back to race.js
  let shown = null;          // { data, order, correctSlot, limit }
  const asked = [];          // ids opened by THIS system, in order (see quiz:open)
  let body = null;           // player body, for applyBoost
  let lastResult = null;

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
    elSub.textContent = good
      ? t('quiz.reward', { n: num(REWARD_TOKENS[shown.data.tier] || 3) })
      : t('quiz.noPenalty');
    elWarm.textContent = good ? '' : t(shown.warmKey);
    elWarm.style.display = good ? 'none' : '';
    elWhy.textContent = s.why;
  }

  function openQuestion(pick) {
    if (phase !== 'idle') return;
    // Never open on top of the token explainer, Boreg's introduction or the
    // pause menu. The beacon that triggered us has already been consumed and
    // will respawn, so nothing is lost — the question simply comes later.
    if (modalOpen('quiz')) return;
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
    if (e.repeat) return;
    // Something is layered over us (pause menu, a one-time explainer). Its keys
    // are not ours: without this, 1/2/3 answered — and closed — a question the
    // child could not even see while the pause menu was up. Space would likewise
    // have dismissed the feedback from behind the pause menu.
    if (modalOpen('quiz')) return;
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
    if (phase === 'question') {
      if (digit == null) return;
      e.preventDefault();
      answer(digit);
    } else if (phase === 'feedback') {
      // Space is the one documented key; Enter is accepted as the usual
      // "confirm" alias. Digits deliberately are NOT — the child just pressed
      // one to answer, and the explanation must not blink away under a
      // double-tap. DISMISS_AFTER_S covers the same trap for Space/Enter.
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      e.preventDefault();
      if (phaseT > DISMISS_AFTER_S) dismiss();
    }
  }

  function answer(slot) {
    if (phase !== 'question' || shown.answered != null) return;
    shown.answered = slot;
    finishQuestion(false);
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
    elCont.textContent = t('quiz.continueBtn');
    renderResult();

    if (good) {
      elFlash.classList.remove('on'); void elFlash.offsetWidth; elFlash.classList.add('on');
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
      tokens: good ? (REWARD_TOKENS[d.tier] || 3) : 0,
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
  function dismiss() {
    if (phase !== 'feedback') return;
    hidePanel();
    phase = 'resume';
    phaseT = 0;
    beat = -1;
    bus.emit('quiz:dismiss', lastResult);
  }

  function hidePanel() {
    root.classList.remove('show');
    root.classList.remove('quiz-good');
    card.classList.remove('quiz-answered');
    removeEventListener('keydown', onKey);
  }

  function close() {
    if (phase === 'idle') return;
    popModal('quiz');
    hidePanel();
    phase = 'idle';
    phaseT = 0;
    beat = -1;
    cooldown = lastResult?.timedOut ? COOLDOWN_IGNORED_S : COOLDOWN_S;
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
      if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
      for (const b of beacons) {
        if (b.alive) continue;
        b.respawn -= dt;
        if (b.respawn <= 0) b.alive = true;
      }
    }

    // `blocked` = some OTHER panel owns the screen right now. While it does we
    // neither arm a beacon nor advance our own countdown, so a question can
    // never be lost behind a popup a child is still reading.
    const blocked = modalOpen('quiz');

    if (phase === 'idle' && enabled && !freeze && !blocked
        && ctx?.racing !== false && body && cooldown <= 0) {
      const hit = findHit(body.position);
      if (hit) {
        hit.alive = false;
        hit.respawn = RESPAWN_S;
        openQuestion();
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
    /** Every id this race has shown, in order — the same ids `quiz:open` carries. */
    get askedIds() { return asked.slice(); },
    /** How many questions are eligible after the championship exclusion. */
    get poolSize() { return eligible.length; },
    get timeScale() { return scale; },
    get lastResult() { return lastResult; },
    get beaconCount() { return N; },
    /** Force a question open — used by previews and by the dev harness. */
    openQuestion(pick) { openQuestion(pick); },
    /** The player's "I have read it" — feedback → 3·2·1 → resume. */
    dismiss,
    /** Force the panel shut immediately, skipping the countdown (scene change). */
    close,
    dispose() {
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

  if (o.demo) {
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

export { QUESTIONS, bankStats, tiersForDifficulty };

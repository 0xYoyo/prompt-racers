// TOKEN ECONOMY — the invariant, not the numbers.
//
// History, because it is the reason this file is shaped the way it is:
//
//   • Wave 2 (D17) thinned the economy at source and capped the garage rebate
//     below the spend, and measured "a winning run banks ~20 against a 21-token
//     maximum ask".
//   • Wave 4 (D29) discovered that measurement had been taken with the quiz term
//     MISSING: the end-to-end driver in tools/flowtest.mjs held a throttle key
//     down the racing line and had never once triggered a question beacon, so
//     `tokensFromQuiz` printed 0 on every run in the project's history. Measured
//     properly, a child who answered well banked 35–54 tokens in a race. This
//     file was then written as a CHARACTERISATION test — it asserted the
//     imbalance EXISTED, so that fixing the economy would turn it red and force
//     the fixer to come back here.
//   • This is that rewrite. flowtest's driver now answers real questions
//     (`scene.quiz.correctSlot`), the constants below are IMPORTED rather than
//     scraped out of the source with a regex, and the assertions are invariants
//     about the shipped economy rather than a snapshot of it.
//
// The two invariants, in one sentence each:
//   A. A winning, fully engaged player CANNOT afford the most expensive ask, so
//      choosing where to be precise still costs something.
//   B. A child who loses every race and answers nothing can STILL afford a
//      complete ask, so the teaching screen is never a wall of grey cards.
//
// Both are computed from the real constants and the ENGAGEMENT ENVELOPE measured
// on the built game (below), so they keep meaning something after the next
// retune: change a constant and the invariant is re-derived, not re-typed.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FINISH_TOKENS, TOKEN_CLUSTERS_PER_LAP, thinTokenSpots } from '../src/race/race.js';
import { REWARD_TOKENS } from '../src/race/quiz.js';
import { MAX_COST, MIN_COMPLETE_COST, DEFAULT_BUDGET, PART_COST } from '../src/garage/prompts.js';
import { tokenReward } from '../src/garage/scoring.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(resolve(root, p), 'utf8');
const raceSrc = read('src/race/race.js');

let failed = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(58)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};

console.log('\n  TOKEN ECONOMY — invariants over the shipped constants\n  ' + '─'.repeat(74));

// ── the engagement envelope, measured on the BUILT game ──────────────────────
// Wave 4, .tmp/w4econ-probe.mjs: three tracks × three seeds × three player
// types, thirty real races driven to the flag by a driver that meets question
// boxes on the racing line and answers them. Per race an engaged player met 5–9
// boxes and collected 3–6 pickups; a player who answers nothing collects the
// same pickups and no quiz tokens at all. The richest single race of the thirty
// banked 18. These are the EXTREMES, not the means, because "a fully engaged
// player" is the only version of the target worth gating.
//
// WAVE 5 RE-MEASURED IT (.tmp/econmeasure.mjs, four player profiles × three
// races × three seeds, thirty-six real races driven to the flag). Two things had
// moved underneath the Wave-4 numbers and both landed in the same wave: the
// teaching-card cadence now defers roughly one question box per race, and race
// 2's pace was retuned (`TRACK_PACE.circuit` 0.96 → 0.98), which moves finishing
// positions and so the finish bonus. Measured again rather than extrapolated —
// D33's lesson is that a balance measurement is only valid against the field it
// was taken on:
//
//   engaged + winning   13–17 a race     engaged + mid-pack   13–16
//   half-right          10–14            ignores every box     6–10
//   boxes met 4–8 (engaged answers 5–8) · pickups 3–6 · finish bonus 3–5
//
// The maxima below are the extremes of that run, kept as extremes on purpose:
// "a fully engaged player" is the only version of the target worth gating. The
// question maximum stays at Wave 4's 9 rather than dropping to Wave 5's measured
// 8: the cadence change that removed a box is a pacing decision that could be
// tuned back tomorrow, and this envelope is the guard, so it keeps the larger of
// the two real observations.
const MAX_QUESTIONS_PER_RACE = 9;
const MIN_PICKUPS_PER_RACE = 3;
const MAX_PICKUPS_PER_RACE = 6;
// The one outlier, kept as a JOINT observation rather than folded into the
// maxima above: the longest race measured opened 11 boxes, and that same run
// collected 4 pickups. Multiplying independent maxima together would describe a
// race nobody drove; this describes one that was.
const OUTLIER_RACE = { questions: 11, pickups: 4 };

// The reward is flat across tiers ON PURPOSE — see REWARD_TOKENS in quiz.js. The
// invariant is therefore asserted against the richest tier there is, on every
// race, rather than against the tiers that happen to be followed by a garage
// today: a routing detail in another file must not be what keeps the economy
// honest.
const maxReward = Math.max(...[1, 2, 3].map(t => REWARD_TOKENS[t]));

// ── the constants are readable at all ────────────────────────────────────────
// They are now EXPORTS. tests/badges.test.mjs used to scrape both out of the
// source with a regex, so a rename failed at a parse assertion rather than at
// the calibration it silently invalidated.
ok('REWARD_TOKENS imports from quiz.js (not scraped)',
  REWARD_TOKENS && [1, 2, 3].every(t => Number.isInteger(REWARD_TOKENS[t])),
  JSON.stringify(REWARD_TOKENS));
ok('FINISH_TOKENS imports from race.js (not scraped)',
  Array.isArray(FINISH_TOKENS) && FINISH_TOKENS.length === 8,
  `[${FINISH_TOKENS.join(', ')}]`);
ok('TOKEN_CLUSTERS_PER_LAP imports from race.js (not scraped)',
  Number.isInteger(TOKEN_CLUSTERS_PER_LAP) && TOKEN_CLUSTERS_PER_LAP >= 1,
  `${TOKEN_CLUSTERS_PER_LAP} row(s) a lap`);
// The thinning keeps WHOLE authored rows. A fraction of the spot list (D17's
// TOKEN_KEEP) cut across them, so the same setting paid 3 pickups on race 1 and
// 9 on race 2 — the percentage-versus-absolute trap D33 hit with its pace floor.
{
  const row = lat => ({ x: lat, y: 0, z: 0 });
  const far = (z, lat) => ({ x: lat, y: 0, z });
  const spots = [far(0, -4), far(0, 0), far(0, 4), far(300, -4), far(300, 0), far(300, 4),
    far(600, -4), far(600, 0), far(600, 4)];
  void row;
  const kept = thinTokenSpots(spots, 1);
  ok('the thinning keeps whole rows, not a slice through them',
    kept.length === 3 && new Set(kept.map(p => p.z)).size === 1,
    `${kept.length} tokens from 1 row of 3 rows × 3`);
  ok('…and asking for more rows than exist keeps them all',
    thinTokenSpots(spots, 9).length === spots.length);
}

// ── shape rules the economy is built on ──────────────────────────────────────
ok('a token pickup is worth exactly 1 (no combo multiplier)',
  /S\.tokens \+= 1;/.test(raceSrc) && !/S\.tokens \+= 1 \+ Math\.floor/.test(raceSrc),
  'D17 removed the combo multiplier — reinstating it multiplies the wallet');
ok('the finish table pays best→worst and never inverts',
  FINISH_TOKENS.every((v, i) => i === 0 || v <= FINISH_TOKENS[i - 1]),
  `[${FINISH_TOKENS.join(', ')}]`);
ok('the garage prices are the ones this economy was tuned against',
  MAX_COST === 21 && MIN_COMPLETE_COST === PART_COST && DEFAULT_BUDGET === 17,
  `max ${MAX_COST}, cheapest complete ${MIN_COMPLETE_COST}, authored budget ${DEFAULT_BUDGET}`);

// ── INVARIANT A — the winning, fully engaged player still has to choose ──────
const bestCase = MAX_QUESTIONS_PER_RACE * maxReward + MAX_PICKUPS_PER_RACE + FINISH_TOKENS[0];
console.log(`  \x1b[2m  best case per spendable race: ${MAX_QUESTIONS_PER_RACE}×${maxReward} quiz`
  + ` + ${MAX_PICKUPS_PER_RACE} pickups + ${FINISH_TOKENS[0]} win = ${bestCase}`
  + `  ·  worst case: 0 quiz + ${MIN_PICKUPS_PER_RACE} pickups + ${FINISH_TOKENS[7]} last`
  + ` = ${MIN_PICKUPS_PER_RACE + FINISH_TOKENS[7]}  ·  ask costs ${MIN_COMPLETE_COST}–${MAX_COST}\x1b[0m`);

ok('A: a winning, fully engaged race cannot buy the most expensive ask',
  bestCase < MAX_COST,
  `${bestCase} banked vs ${MAX_COST} — margin ${MAX_COST - bestCase}`);
const outlierCase = OUTLIER_RACE.questions * maxReward + OUTLIER_RACE.pickups + FINISH_TOKENS[0];
ok('A: …and neither can the longest race ever measured, had it been won',
  outlierCase < MAX_COST,
  `${OUTLIER_RACE.questions} boxes + ${OUTLIER_RACE.pickups} pickups + a win = ${outlierCase}`);

// ── INVARIANT B — the child who is losing is never locked out ────────────────
const worstCase = MIN_PICKUPS_PER_RACE + FINISH_TOKENS[FINISH_TOKENS.length - 1];
ok('B: last place, no questions answered, still funds a complete ask',
  worstCase >= MIN_COMPLETE_COST,
  `${worstCase} banked vs ${MIN_COMPLETE_COST} cheapest complete ask`);
// GAPS' standing instruction for this economy: if playtesting shows a child
// unable to afford a specific prompt, RAISE THE FLOOR rather than lower the
// ceiling. The floor is the last row of the finish table, so pin that it is not
// where a future rebalance takes its cut from.
ok('…and the floor was not the thing that was cut (last place ≥ 3)',
  FINISH_TOKENS[FINISH_TOKENS.length - 1] >= 3,
  `last place pays ${FINISH_TOKENS[FINISH_TOKENS.length - 1]}`);

// ── INVARIANT C — the rebate is a bonus, never an income (D17) ───────────────
const bestGuided = tokenReward(100, false), bestExpert = tokenReward(100, true);
ok('C: the garage rebate stays below the spend that earns it',
  bestGuided < MAX_COST / 2 && bestExpert < MAX_COST / 2,
  `guided ≤ ${bestGuided}, expert ≤ ${bestExpert}, against a ${MAX_COST}-token top ask`);
ok('…and expert still pays meaningfully more than guided',
  bestExpert > bestGuided, `${bestExpert} vs ${bestGuided}`);
// The rebate must be below the spend AT EVERY POINT ON THE CURVE, not only at
// the top. A cap alone says nothing about the cheap end, and the cheap end is
// where a rebate turns into a profit: the child who buys the least precise
// complete ask is the one who could farm it.
{
  // (budget, best score it buys, that ask's cost) — from the real price list.
  const CURVE = [[4, 8, 4], [6, 23, 6], [8, 32, 8], [11, 51, 11],
    [13, 63, 13], [15, 69, 15], [17, 84, 17], [21, 100, 21]];
  const bad = CURVE.filter(([, score, cost]) => tokenReward(score, false) >= cost);
  ok('C: the rebate is below the spend at every point on the price curve',
    bad.length === 0,
    CURVE.map(([, s, c]) => `${c}→${tokenReward(s, false)}`).join(' '));
}
ok('C: the rebate ceiling stays under half the most expensive ask',
  bestGuided < MAX_COST / 2 && bestExpert < MAX_COST / 2,
  `guided ≤ ${bestGuided}, expert ≤ ${bestExpert}, half of ${MAX_COST} is ${MAX_COST / 2}`);

// ── INVARIANT D — the top tier is REACHABLE, but only by saving (Wave 5) ─────
// The garage's top ask cost 21 and nothing in the game could pay for it: a race
// banks at most 17, and a child who bought the best ask they could afford at the
// first garage arrived at the second with 16–19. The only route to 21 was to buy
// the cheapest possible thing at the first garage — the game paid you for NOT
// engaging with its own teaching screen. What moved was the garage rebate, which
// is not race income and so cannot touch invariant A.
//
// Modelled here the way it really works in scenes.js:
//   wallet at the second garage = race1 − spend + rebate(score) + race2
const walletAtSecondGarage = (race, spend, score) =>
  race - spend + tokenReward(score, false) + race;
{
  // The engaged child's TYPICAL race (15 then 16, the median of the measured
  // run), buying a real mid-tier ask at the first garage — 11 tokens, score 51,
  // a specific goal and a real limit — rather than hoarding. This is the
  // behaviour the garage is trying to teach, and it must not be the behaviour
  // that locks the top tier away.
  const engaged = 15 - 11 + tokenReward(51, false) + 16;
  ok('D: an engaged child who spends at the first garage can afford the top ask at the second',
    engaged >= MAX_COST,
    `15 − 11 + ${tokenReward(51, false)} + 16 = ${engaged} vs the ${MAX_COST} top ask`);
  // And on the POOREST measured engaged run (13 a race, both races) it is still
  // reachable — but only with more restraint at the first garage: an 8-token ask
  // is twice the cheapest complete one, so this is "buy something real and save",
  // not "buy nothing". That gap between 8 and 11 IS the choice the garage exists
  // to pose; if it ever closes, the top tier has stopped costing anything.
  const engagedFloor = walletAtSecondGarage(13, 8, 32);
  ok('D: …and on the poorest engaged run too, if they hold back at the first garage',
    engagedFloor >= MAX_COST,
    `13 − 8 + ${tokenReward(32, false)} + 13 = ${engagedFloor} vs ${MAX_COST}`);
  ok('D: …but NOT if they also max out the first garage (the choice still bites)',
    walletAtSecondGarage(13, 13, 63) < MAX_COST,
    `13 − 13 + ${tokenReward(63, false)} + 13 = ${walletAtSecondGarage(13, 13, 63)} vs ${MAX_COST}`);
  // …and the child who ignores every question box cannot, however they spend.
  // Measured ceiling for that player is 10 a race, and the most generous thing
  // they can do is buy the cheapest complete ask (4) and bank the rest.
  const idle = walletAtSecondGarage(10, MIN_COMPLETE_COST, 8);
  ok('D: a child who ignores every question box still cannot, however they save',
    idle < MAX_COST,
    `10 − ${MIN_COMPLETE_COST} + ${tokenReward(8, false)} + 10 = ${idle} vs ${MAX_COST}`);
  // The shape of the whole thing in one line: one top-tier ask a championship,
  // never two. Two would need a race that pays for one on its own — invariant A.
  ok('D: …and no ONE race ever pays for a top-tier ask, so never two of them',
    bestCase < MAX_COST, `richest possible race ${bestCase} vs ${MAX_COST}`);
}
// ── `prompt-80`, the badge that goes unreachable FIRST ───────────────────────
// GAPS' standing instruction after any economy change is to check this one
// before the token thresholds. It is not a token threshold at all: it needs a
// garage SCORE of 80, and in real play the garage budget is the wallet
// (scenes.js), so what really gates it is "can the child afford an ask that
// scores 84". Enumerated against the real price list, a wallet of 13 buys at
// most 63, 15 buys 69, 16 buys 75, and it takes exactly 17 to reach 84 — D40's
// derivation, re-run here rather than quoted.
const PROMPT80_WALLET = 17;
{
  const engagedAtSecond = 15 - 11 + tokenReward(51, false) + 16;
  ok('prompt-80: the engaged child reaches the wallet that can score 84',
    engagedAtSecond >= PROMPT80_WALLET,
    `${engagedAtSecond} at the second garage vs the ${PROMPT80_WALLET} it takes to buy an 84`);
  // …and it is not a participation prize. A child who answers nothing banks at
  // most pickups + a mid finish, so the first garage cannot buy them an 84 —
  // the badge for writing a good prompt still costs some engagement first.
  const idleRaceCeiling = MAX_PICKUPS_PER_RACE + FINISH_TOKENS[1];
  ok('prompt-80: …and a child who answers nothing cannot buy an 84 at the first garage',
    idleRaceCeiling < PROMPT80_WALLET,
    `${idleRaceCeiling} banked with no quiz income vs the ${PROMPT80_WALLET} it takes`);
}
console.log(`  \x1b[2m  wallet at the second garage (measured income, real prices):`
  + ` engaged spender ${walletAtSecondGarage(13, 11, 51)}–${walletAtSecondGarage(16, 11, 51)},`
  + ` ignores every box ${walletAtSecondGarage(8, 4, 8)}–${walletAtSecondGarage(10, 4, 8)}`
  + `  ·  top ask ${MAX_COST}\x1b[0m`);

console.log('  ' + '─'.repeat(74));
console.log(failed ? `  \x1b[31m${failed} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exitCode = failed ? 1 : 0;

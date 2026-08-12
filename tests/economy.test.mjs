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
// The wallet carries across visits, so the number that has to clear the ask is
// not one race but "what a strong player arrives at visit 2 with": spend the
// lot at visit 1, take the rebate, race again. Typical rather than extreme
// (a mid-table finish, a good-but-not-perfect prompt) because the extreme of
// every term at once is not a player — it is printed above, and it is the thing
// that would need a further cut if playtesting ever produces it.
const typicalRace = 7 * maxReward + 5 + FINISH_TOKENS[1];      // measured mean: 16
ok('C: a strong player still arrives at garage visit 2 below the top ask',
  typicalRace + tokenReward(85, false) < MAX_COST,
  `${typicalRace} from the race + ${tokenReward(85, false)} rebate`
  + ` = ${typicalRace + tokenReward(85, false)} vs ${MAX_COST}`);
// Stated rather than asserted, because it is the one case source-level tuning
// cannot close: the richest race measured (18) plus the largest guided rebate
// arrives at visit 2 able to buy the top ask. Closing it needs either a race
// that pays less than a complete ask, or a cap on the garage's view of the
// wallet — and D17 rejected the second because it makes the HUD counter, the
// results screen and the garage budget contradict each other in front of a
// child. Recorded in GAPS.md; watch it in playtest.
console.log(`  \x1b[2m  residual: richest measured race 18 + best guided rebate`
  + ` ${tokenReward(100, false)} = ${18 + tokenReward(100, false)} at visit 2, i.e. the carryover extreme`
  + ` can still reach the ${MAX_COST}-token ask\x1b[0m`);

console.log('  ' + '─'.repeat(74));
console.log(failed ? `  \x1b[31m${failed} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exitCode = failed ? 1 : 0;

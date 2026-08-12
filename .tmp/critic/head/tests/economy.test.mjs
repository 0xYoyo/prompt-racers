// TOKEN ECONOMY — a characterisation test, deliberately, and it is worth being
// explicit about the difference.
//
// This does NOT assert the economy is balanced. It is currently not: measured on
// the built game, a child who answers quizzes well banks roughly 51 tokens in
// race 1 against a maximum garage spend of 21, so the garage's central lesson
// ("precision costs, choose where it is worth spending") is false for exactly
// the engaged child the game is written for. That is recorded in GAPS.md and is
// a design retune, not a one-line fix.
//
// What this DOES do is pin every number the economy is made of, so the balance
// can only change on purpose. The end-to-end gate in tools/flowtest.mjs cannot
// help here: its driver has never triggered a quiz beacon, so the largest term
// is missing from the only assertion that looks at the total.
//
// If you are here because this test failed, you changed one of these constants.
// Update the expected value AND re-measure the totals below — do not just make
// the test green.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(58)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};

console.log('\n  TOKEN ECONOMY — pinned constants\n  ' + '─'.repeat(74));

// Read the constants out of the source rather than duplicating them, so the two
// cannot drift apart the way a hand-copied expectation always eventually does.
const quizSrc = read('src/race/quiz.js');
const raceSrc = read('src/race/race.js');
const promptsSrc = read('src/garage/prompts.js');

const rewardMatch = quizSrc.match(/const REWARD_TOKENS = \{([^}]*)\}/);
ok('REWARD_TOKENS is readable from quiz.js', !!rewardMatch);
const reward = {};
for (const [, k, v] of (rewardMatch?.[1] || '').matchAll(/(\d+)\s*:\s*(\d+)/g)) reward[+k] = +v;

const finishMatch = raceSrc.match(/const FINISH_TOKENS = \[([^\]]*)\]/);
ok('FINISH_TOKENS is readable from race.js', !!finishMatch);
const finish = (finishMatch?.[1] || '').split(',').map(s => +s.trim()).filter(n => !Number.isNaN(n));

const budgetMatch = promptsSrc.match(/export const DEFAULT_BUDGET = (\d+)/);
const partCostMatch = promptsSrc.match(/const PART_COST = (\d+)/);
const budget = +(budgetMatch?.[1] ?? -1);
const partCost = +(partCostMatch?.[1] ?? -1);

// ── the pinned values ──────────────────────────────────────────────────────
ok('quiz reward per correct answer is 3/4/5 by tier',
  reward[1] === 3 && reward[2] === 4 && reward[3] === 5,
  JSON.stringify(reward));
ok('finish bonus is 6 for a win, 3 for last',
  finish[0] === 6 && finish[finish.length - 1] === 3 && finish.length === 8,
  `[${finish.join(', ')}]`);
ok('a token pickup is worth exactly 1 (no combo multiplier)',
  /S\.tokens \+= 1;/.test(raceSrc) && !/S\.tokens \+= 1 \+ Math\.floor/.test(raceSrc),
  'D17 removed the combo multiplier — reinstating it doubles the wallet');
ok('garage budget is 17 and the cheapest complete ask is 4',
  budget === 17 && partCost === 4, `budget ${budget}, part ${partCost}`);

// ── what those numbers add up to, stated so a change is visible ────────────
// Measured on the built game: 14–18 from pickups, 6 from a win. The quiz term is
// the one nothing gates, so it is computed here from the constants and the
// question counts actually drawn per race (10 / 8 / 7, measured).
const QUESTIONS_PER_RACE = [10, 8, 7];
const MEAN_TIER_PER_RACE = [1.00, 1.75, 2.57];
const meanReward = t => reward[Math.round(t)] ?? 3;
const quizYield = QUESTIONS_PER_RACE.map((n, i) => Math.round(n * meanReward(MEAN_TIER_PER_RACE[i])));
const PICKUPS = 15, WIN = finish[0] ?? 6;
const totals = quizYield.map(q => PICKUPS + WIN + q);

console.log(`  \x1b[2m  race 1/2/3 · quiz ${quizYield.join(' / ')} + pickups ${PICKUPS} + win ${WIN}`
  + ` = ${totals.join(' / ')} banked, against a ${partCost === 4 ? 21 : '?'}-token maximum spend\x1b[0m`);

// This is the assertion that documents the imbalance instead of hiding it. It
// passes today, and it is written so that FIXING the economy makes it fail —
// at which point the fixer updates the ceiling and deletes the GAPS entry.
ok('KNOWN IMBALANCE: an engaged child still out-earns the garage (see GAPS.md)',
  Math.max(...totals) > 21,
  `${Math.max(...totals)} banked vs 21 max spend — fix the economy and this flips`);

console.log('  ' + '─'.repeat(74));
console.log(failed ? `  \x1b[31m${failed} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exitCode = failed ? 1 : 0;

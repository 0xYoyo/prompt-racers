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
import { FINISH_TOKENS, TOKEN_CLUSTERS_PER_LAP, TOKEN_RESPAWN_S, TOKEN_ROW_CLEAR_S,
  thinTokenSpots } from '../src/race/race.js';
import { REWARD_TOKENS } from '../src/race/quiz.js';
import { MAX_COST, MIN_COMPLETE_COST, DEFAULT_BUDGET, PART_COST } from '../src/garage/prompts.js';
import { tokenReward, REBATE_CAP, REBATE_CAP_EXPERT } from '../src/garage/scoring.js';

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
//
// WAVE 6 RE-MEASURED IT AGAIN (.tmp/w6b-econ.mjs, the same harness, winning +
// fully engaged and ignores-every-box, three tracks × three seeds), because the
// pickup half of the economy changed shape: the lap now shows THREE rows instead
// of one and each row pays once for the race instead of once a lap. Measured, a
// winning engaged race banks 14–19 with 2–5 from pickups (was 13–18 with 4–6) —
// the same wallet, arriving as three pickup moments in three places rather than
// one moment repeated three times. The child who ignores every box banks 7–9
// with 3–6 pickups; they take MORE rows than the engaged child, because the
// slow-motion cooldown a timed-out box costs them drags them across rows the
// racing line skips. That 6 is where the ceiling below comes from.
//
// The pickup FLOOR moved 3 → 2 and is recorded honestly rather than rounded up:
// on `oasis` the racing line misses two of the three rows outright on some
// seeds. Invariant B is re-derived from it below and still holds (2 + 3 = 5
// against a cheapest complete ask of 4), which is the point of deriving rather
// than typing. The CEILING is deliberately left at Wave 4/5's 6 even though
// nothing measured above 5: it is the guard, and a guard that tracks the last
// measurement down has stopped guarding.
const MAX_QUESTIONS_PER_RACE = 9;
const MIN_PICKUPS_PER_RACE = 2;
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

// ── WAVE 6: THE ROW COUNT AND THE ROW INCOME ARE NOW SEPARATE LEVERS ─────────
// Until Wave 6 they were the same number. A taken token came back after 26s —
// less than a lap — so the income was `rows × laps`, and the only lever that
// could hold a winning engaged race under the 21-token top ask was to author
// ONE row. That bought the wallet with the whole lap: three laps offered the
// child the same row three times and nothing else, so pickup dopamine arrived
// once a lap, always in the same place, and D39's "a row is worth ~2 tokens"
// was really "one row's worth of tokens, three times".
//
// Wave 6 splits them:
//   • TOKEN_CLUSTERS_PER_LAP is what the child SEES  — 3 rows, spread round the lap;
//   • TOKEN_RESPAWN_S / TOKEN_ROW_CLEAR_S are what a row PAYS — once, for the race.
//
// Both halves need pinning, because either one alone undoes the other:
//   • put the count back to one row and the lap goes quiet again;
//   • leave the count up but let rows pay per lap again and the wallet drifts up
//     behind invariants that still happen to hold. That second one is not
//     hypothetical: measured mid-change, per-TOKEN retirement (rows come back
//     only as the individual octahedra the kart's line missed) still paid NINE
//     pickups on `cloud`, because a row is 3–4 tokens laid ACROSS the road and
//     lap 2 comes back on a slightly different line. It put a 23-token race on
//     the board against a 21-token ask. The ROW is the unit that had to retire.
ok('the lap shows a child three or more pickup rows, not one',
  TOKEN_CLUSTERS_PER_LAP >= 3, `${TOKEN_CLUSTERS_PER_LAP} rows a lap`);
ok('…and a row that has been collected never comes back this race',
  TOKEN_RESPAWN_S === Infinity, `respawn ${TOKEN_RESPAWN_S}s`);
ok('…and the ROW retires, not just the one token the kart touched',
  /rowClearing\.set\(it\.row, TOKEN_ROW_CLEAR_S\)/.test(raceSrc)
  && TOKEN_ROW_CLEAR_S > 0 && TOKEN_ROW_CLEAR_S <= 3,
  `leftovers clear ${TOKEN_ROW_CLEAR_S}s after the pass`);
// …and not instantly, because a token that vanishes from IN FRONT of a child is
// the game taking something back. At racing speed this is ~30m of road behind.
ok('…a beat later, so nothing is snatched from in front of the child',
  TOKEN_ROW_CLEAR_S >= 0.8, `${TOKEN_ROW_CLEAR_S}s ≈ ${(TOKEN_ROW_CLEAR_S * 25).toFixed(0)}m at racing speed`);
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
// ── C2 — the rebate REWARDS QUALITY, which is the whole reason it was the lever
// Wave 5 chose over the quiz reward. Nothing asserted this, and a rebate that
// paid a flat 3 for a one-word ask and a perfect 100 alike passed every check in
// this file — while destroying the justification for the change.
{
  const curve = Array.from({ length: 101 }, (_, s) => tokenReward(s, false));
  const monotonic = curve.every((v, i) => i === 0 || v >= curve[i - 1]);
  ok('C2: the rebate never decreases as the prompt gets better',
    monotonic, `0→${curve[0]}, 50→${curve[50]}, 100→${curve[100]}`);
  ok('C2: …and it is not flat — a better prompt really is worth more',
    new Set(curve).size >= 5, `${new Set(curve).size} distinct payouts across 0–100`);
  // The gap between the vaguest complete ask the game will accept (score 8) and
  // the best one (100) has to be worth noticing, or "engagement pays" is a
  // slogan. Half the ceiling is the bar.
  const vague = tokenReward(8, false), strong = tokenReward(100, false);
  ok('C2: …and the gap between a vague ask and a strong one is at least half the cap',
    strong - vague >= REBATE_CAP / 2,
    `vague ${vague} → strong ${strong}, gap ${strong - vague} vs half of ${REBATE_CAP}`);
  // Each tier of the garage's own ladder must pay strictly more than the one
  // below, so the rebate tracks the thing the child watched happen to the part.
  const byTier = [8, 41, 63, 100].map(s => tokenReward(s, false));
  ok('C2: …and every garage tier refunds strictly more than the tier below',
    byTier.every((v, i) => i === 0 || v > byTier[i - 1]), byTier.join(' < '));
}

// ── C3 — the ceiling cannot DRIFT. Invariant C only says "< half the top ask",
// which left 29% of headroom for a cap to grow into without a gate noticing —
// D39's rot mode verbatim ("at 8 it had quietly become half a race's income").
// So the derivation itself is pinned, not just its consequence.
ok('C3: the guided ceiling IS a third of the top ask, exactly',
  REBATE_CAP === Math.floor(MAX_COST / 3) && tokenReward(100, false) === REBATE_CAP,
  `cap ${REBATE_CAP}, ⌊${MAX_COST}/3⌋ = ${Math.floor(MAX_COST / 3)}, best payout ${tokenReward(100, false)}`);
ok('C3: …and expert is exactly one token above it, not a free multiplier',
  REBATE_CAP_EXPERT === REBATE_CAP + 1 && tokenReward(100, true) === REBATE_CAP_EXPERT,
  `expert cap ${REBATE_CAP_EXPERT} vs guided ${REBATE_CAP}`);

// ── C4 — THE REBATE MAY NEVER EXCEED THE SPEND IT REBATES ────────────────────
// D17's rule, stated properly at last. It was true on the guided price curve by
// arithmetic coincidence and FALSE in expert mode, where garage.js charges only
// for the part row (`spent() = costOf(st.sel)`, and expert's `st.sel` carries
// nothing else): typing the game's own placeholder example scores 92 and used to
// refund 8 against a spend of 4 — tokens conjured out of nothing, every visit,
// and a route around `prompt-80`'s "needs a wallet of 17" as well.
{
  const spends = [0, 1, 2, 3, 4, 6, 8, 11, 13, 17, 21];
  const overpaid = [];
  for (const spend of spends)
    for (const score of [0, 8, 32, 51, 63, 84, 92, 100])
      for (const expert of [false, true])
        if (tokenReward(score, expert, spend) > spend) overpaid.push(`${score}${expert ? 'x' : ''}@${spend}`);
  ok('C4: the rebate never exceeds the spend, at any score, in either mode',
    overpaid.length === 0, overpaid.length ? overpaid.slice(0, 5).join(' ') : `${spends.length} spends × 8 scores × 2 modes`);
  // The expert exploit, named and pinned as the specific case.
  ok('C4: …so the expert placeholder prompt no longer profits on a 4-token spend',
    tokenReward(92, true, PART_COST) === PART_COST && tokenReward(92, true) > PART_COST,
    `score 92 in expert: ${tokenReward(92, true)} unclamped → ${tokenReward(92, true, PART_COST)} against a ${PART_COST}-token spend`);
  // …and the clamp must not quietly become the ONLY thing paying out: with a
  // real guided spend it changes nothing.
  ok('C4: …and it does not touch a normal guided build',
    tokenReward(63, false, 13) === tokenReward(63, false),
    `score 63 on a 13-token ask: ${tokenReward(63, false, 13)}`);
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
  // THE TARGET, stated on the POOREST measured engaged run (13 a race, both
  // races) rather than the median, because the median already cleared it before
  // Wave 5 — marginally, on the good seeds only, which is what "the wallet peaks
  // at 22" meant. The child buys something REAL at the first garage: 8 tokens is
  // twice the cheapest complete ask, a specific goal with a limit behind it. So
  // this is "buy something real and save", not "buy nothing and hoard" — and it
  // is the assertion that goes red if the rebate is put back where Wave 4 had it.
  const engagedFloor = walletAtSecondGarage(13, 8, 32);
  ok('D: an engaged child who spends at the first garage can afford the top ask at the second',
    engagedFloor >= MAX_COST,
    `13 − 8 + ${tokenReward(32, false)} + 13 = ${engagedFloor} vs the ${MAX_COST} top ask`);
  // THE SAME TARGET UNDER THE POLICY A CHILD ACTUALLY FOLLOWS: spend the wallet
  // on the best thing you can afford, every visit. Nobody plays a garage by
  // solving for the optimal reserve. On the MEDIAN engaged run (15 then 16) the
  // best affordable ask at the first garage costs 15 and scores 69, and the top
  // tier is still in reach at the second. This is the assertion that was
  // demoted to a console.log in round 1 and is restored, because it pins the
  // realistic policy rather than the existence of a clever one.
  const medianIntuitive = 15 - 15 + tokenReward(69, false) + 16;
  ok('D: …and the child who just buys the best they can afford still gets there (median run)',
    medianIntuitive >= MAX_COST,
    `15 − 15 + ${tokenReward(69, false)} + 16 = ${medianIntuitive} vs ${MAX_COST}`);
  // On the POOREST engaged run (13 then 13) that same policy lands at 18 and the
  // child must hold something back. Printed with its real margin rather than
  // asserted away: it is the honest edge of the target, and tools/flowtest.mjs
  // measures it on the built game every run.
  console.log(`  \x1b[2m  poorest engaged run, same policy: 13 − 13 + ${tokenReward(63, false)} + 13 = `
    + `${13 - 13 + tokenReward(63, false) + 13} — ${MAX_COST - (tokenReward(63, false) + 13)} short of the top ask\x1b[0m`);
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
  // Same median run and same intuitive policy as invariant D, so the two cannot
  // drift apart: buy the best affordable ask (15 tokens, score 69) and race on.
  const engagedAtSecond = 15 - 15 + tokenReward(69, false, 15) + 16;
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

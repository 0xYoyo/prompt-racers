// ═══════════════════════════════════════════════════════════════════════════
// האוסף שלי — badges, glossary and the tracker (Wave 4, item 12).
//
// This gate exists because the tracker is a SEAM: nothing imports it, it only
// listens to the bus, and every failure mode it has is silent. A badge that
// never unlocks, a badge that unlocks twice, a Hebrew name with no English
// translation and a calibration that puts "40 correct answers" out of a child's
// reach all look identical from the outside — the screen just renders.
//
// What is pinned:
//   1.  every badge and term is complete in BOTH languages, with an icon;
//   2.  a synthetic bus stream unlocks exactly the expected set, and replaying it
//       unlocks nothing more (idempotence);
//   3.  badges/glossary survive a resetChampionship()-shaped write and are wiped
//       by save.reset();
//   4.  the CALIBRATION CLAIM: ~2.5 championships of measured play earns most
//       badges, the two designated hard ones stay locked — measured against
//       economy constants IMPORTED FROM their owning modules, never copied;
//   4b. ui/collection.js actually evaluates (a bundle check is a syntax check);
//   5.  the unlock toast is not a modal, takes no key, steals no focus;
//   6.  the drift badges, driven through the REAL KartBody — see the note in §6;
//   7.  every event the tracker listens for is emitted by somebody in src/.
//
// Runs in plain Node: core/ has no DOM at import time and save.js falls back to
// in-memory when localStorage is missing. §4b imports ui/collection.js — which
// pulls in three — behind a try/catch, so a resolution failure is reported
// rather than taking the whole gate down.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { bus } from '../src/core/bus.js';
import { save } from '../src/core/save.js';
import { getTrack, gridSlots } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import {
  BADGES, BADGE_IDS, GLOSSARY, GLOSSARY_IDS, ICONS, HARD_BADGE_IDS,
  BADGE_STRINGS, GLOSSARY_STRINGS, DEFAULT_STATS, TOKEN_STEPS, DATA_TERM_TOKENS,
  startBadgeTracker, getStats, evaluate, NEEDED_EVENTS, CONSUMED_EVENTS,
} from '../src/core/badges.js';
// THE ECONOMY, IMPORTED FROM ITS OWNERS. See the block below §"the measured
// event stream" for why these are imports and not regexes any more.
import { REWARD_TOKENS } from '../src/race/quiz.js';
import { FINISH_TOKENS, TOKEN_CLUSTERS_PER_LAP } from '../src/race/race.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(58)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};
const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/* ── harness ──────────────────────────────────────────────────────────────── */

let tracker = null;
const unlockEvents = [];
let offUnlock = null;

function freshTracker(opts = {}) {
  tracker?.dispose();
  offUnlock?.();
  save.reset();
  unlockEvents.length = 0;
  offUnlock = bus.on('badge:unlocked', p => unlockEvents.push(p.id));
  tracker = startBadgeTracker({ toast: false, ...opts });
  return tracker;
}

const badges = () => save.read('badges') || [];
const terms = () => save.read('glossary') || [];

/* ── the measured event stream ────────────────────────────────────────────── */
// The calibration below is only worth anything if it is measured against the
// economy the game ACTUALLY has. The first version of this file copied
// REWARD_TOKENS and FINISH_TOKENS into local literals; a rebalance would have
// left it asserting a calibration that no longer described the game, in green —
// which is D29's failure exactly. Round 2 scraped them out of the source with
// regexes, which fixed the staleness but bought a new failure mode: a rename or
// a reformat turns a live constant into `undefined` and the calibration silently
// re-derives itself from NaN.
//
// So round 3 IMPORTS them. quiz.js, race.js and this file all now agree on one
// object each; there is nothing left to keep in sync, and a rename is a load
// error rather than a quiet zero. (The §6 pins still read the two files as TEXT,
// because what they check is the SHAPE of an emit block, which has no export.)
//
// Two numbers still cannot be imported because no constant holds them:
//   • questions per race 10 / 8 / 7 — DECISIONS.md D28, stopwatched on the built
//     game. There is no constant; the quiz draws against beacons and cooldowns.
//   • token pickups ~5 per race — a MEASUREMENT (3–6, mean 4.7 over a race),
//     governed by race.js's TOKEN_CLUSTERS_PER_LAP. That constant IS pinned
//     below, so if the row density is retuned this gate fails and says to
//     re-measure, rather than quietly carrying a stale number.
const quizSrc = read('src/race/quiz.js');
const raceSrc = read('src/race/race.js');

const REWARD = REWARD_TOKENS;

// ── the `drift:boost` contract (D35) ────────────────────────────────────────
// kartphysics stamps every boost with `boostSeq` / `lastBoostTier` /
// `lastBoostSource`, and race.js forwards it as
// `{ tier: 1-3 | 0, source: 'drift' | 'external' }` off the seq counter. Before
// it landed race.js emitted `{ tier: player.driftTier }` on the `boosting`
// rising edge, and that tier was ALWAYS 0 (see §6). The dual-mode scaffolding
// this file carried while that was in flight is gone: the gate now asserts the
// landed contract is what is in the tree, so a revert fails loudly HERE instead
// of quietly re-testing a world the game left.
const boostEmitSrc = (raceSrc.match(/bus\.emit\('drift:boost',\s*\{[^}]*\}/) || [''])[0];
const CONTRACT_LANDED = /source/.test(boostEmitSrc);

/** The payload the game really puts on the bus — see the §6 pins. */
function DRIFT_BOOST_PAYLOAD(peakTier, source = 'drift') {
  return { tier: source === 'drift' ? peakTier : 0, source };
}

const QUESTIONS = [10, 8, 7];
const TIER_OF_RACE = [1, 2, 3];
// Measured on the built game after the Wave-4 source-level thinning: 3–6 pickups
// a race, mean 4.7, on all three tracks (the point of counting whole rows rather
// than a fraction of a spot list is that it no longer differs per track).
const PICKUPS_PER_RACE = 5;
const BOOSTS_PER_RACE = 12;
const TOPICS = ['whatai', 'prompt', 'tokens', 'iterate', 'mistakes', 'vibe'];

/* ── the drift event sequence, as the REAL game produces it ────────────────── */
// This helper exists because the first version of this gate hand-emitted
// `drift:boost { tier: 3 }` — a payload NO code path in the game produces, since
// kartphysics `_releaseDrift()` zeroes `driftTier` before race.js reads it. The
// gate was green and the badge was unearnable. Section 6 drives the real
// KartBody and asserts that THIS helper emits the same sequence the real
// physics does, so the fast simulated stream can never drift from reality again.
function emitDriftRelease(peakTier) {
  bus.emit('drift:start', { tier: 0 });
  for (let t = 1; t <= peakTier; t++) bus.emit('drift:tier', { tier: t });
  // The real drift:end carries tier 0: _releaseDrift() zeroes driftTier before
  // race.js reads the body. Mirrored exactly, so the fast stream stays honest.
  bus.emit('drift:end', { tier: 0 });
  bus.emit('drift:boost', DRIFT_BOOST_PAYLOAD(peakTier));
}

/** An external boost — what quiz.js's applyBoost() on a correct answer raises. */
function emitExternalBoost() {
  bus.emit('drift:boost', DRIFT_BOOST_PAYLOAD(0, 'external'));
}

/**
 * Drive one race over the bus, exactly as race.js and quiz.js would.
 * @param {object} o {race:0..2, correctRate, place, boosts}
 */
function playRace(o = {}) {
  const i = o.race ?? 0;
  const tier = TIER_OF_RACE[i];
  const n = QUESTIONS[i];
  const rate = o.correctRate ?? 0.7;
  for (let q = 0; q < n; q++) {
    const topic = TOPICS[(i * 3 + q) % TOPICS.length];
    const correct = q < Math.round(n * rate);
    bus.emit(correct ? 'quiz:correct' : 'quiz:wrong',
      { id: `q${i}-${q}`, tier, topic, correct, tokens: correct ? REWARD[tier] : 0 });
  }
  for (let p = 0; p < (o.pickups ?? PICKUPS_PER_RACE); p++) bus.emit('token:pickup', { tokens: p + 1, combo: 1 });
  for (let d = 0; d < (o.boosts ?? BOOSTS_PER_RACE); d++) emitDriftRelease(d % 4 === 0 ? 3 : (d % 2 === 0 ? 2 : 1));
  const place = o.place ?? 2;
  bus.emit('race:complete', {
    track: `t${i}`, trackIndex: i, place, timeMs: 120000,
    tokensFinishBonus: FINISH_TOKENS[place - 1] ?? FINISH_TOKENS[FINISH_TOKENS.length - 1],
  });
}

/** A whole championship: three races, then the podium (if the lead wires it). */
function playChampionship(o = {}) {
  bus.emit('championship:reset');
  for (let i = 0; i < 3; i++) playRace({ race: i, ...o, place: (o.places || [2, 2, 2])[i] });
  if (o.emitComplete !== false) {
    bus.emit('championship:complete', { place: o.champPlace ?? 2, points: 24, races: 3, championship: 1 });
  }
}

console.log('\n  האוסף שלי — badges, glossary, tracker\n  ' + '─'.repeat(74));

/* ═══════════════════════════════ 1. completeness, in BOTH languages ═══════ */

console.log('\n  1. every badge and term is complete in he AND en');

{
  let missing = [];
  for (const b of BADGES) {
    for (const lang of ['he', 'en']) {
      for (const suffix of ['name', 'cond']) {
        const key = `badge.${b.id}.${suffix}`;
        const v = BADGE_STRINGS[lang]?.[key];
        if (typeof v !== 'string' || !v.trim()) missing.push(`${lang}:${key}`);
      }
    }
  }
  ok('every badge has a name + unlock condition in he and en', missing.length === 0,
    missing.slice(0, 4).join(', '));

  // A missing translation must FAIL, not silently fall through to Hebrew. t()
  // falls back to `he` by design, so the fallback can never be the thing tested —
  // the raw tables are.
  ok('en table is not just a copy of the he table',
    BADGES.every(b => BADGE_STRINGS.en[`badge.${b.id}.name`] !== BADGE_STRINGS.he[`badge.${b.id}.name`]));
  ok('he and en badge tables have identical key sets',
    eq(Object.keys(BADGE_STRINGS.he), Object.keys(BADGE_STRINGS.en)));

  const noIcon = BADGES.filter(b => !b.icon || !ICONS[b.icon]);
  ok('every badge names an icon that exists in ICONS', noIcon.length === 0,
    noIcon.map(b => b.id).join(', '));
  // Inline vector only: no <img>, no external url() (in-document url(#grad) is
  // fine), no file extension, and no emoji code point anywhere.
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  ok('every icon is inline SVG markup, no asset file, no emoji',
    Object.values(ICONS).every(m => /<(path|circle|ellipse|defs)/.test(m)
      && !/<img|url\((?!#)|\.png|\.jpg|\.svg/.test(m) && !EMOJI.test(m)));

  ok('badge ids are unique', new Set(BADGE_IDS).size === BADGE_IDS.length);
  ok('there are 12–16 badges', BADGES.length >= 12 && BADGES.length <= 16, `${BADGES.length}`);
  for (const group of ['quiz', 'tokens', 'drift', 'prompt', 'champ']) {
    ok(`group "${group}" is represented`, BADGES.some(b => b.group === group));
  }
}

{
  let missing = [];
  for (const g of GLOSSARY) {
    for (const lang of ['he', 'en']) {
      for (const suffix of ['term', 'def', 'hint']) {
        const key = `glos.${g.id}.${suffix}`;
        const v = GLOSSARY_STRINGS[lang]?.[key];
        if (typeof v !== 'string' || !v.trim()) missing.push(`${lang}:${key}`);
      }
    }
  }
  ok('every term has term + definition + hint in he and en', missing.length === 0,
    missing.slice(0, 4).join(', '));
  ok('he and en glossary tables have identical key sets',
    eq(Object.keys(GLOSSARY_STRINGS.he), Object.keys(GLOSSARY_STRINGS.en)));
  ok('there are 12 glossary terms', GLOSSARY.length === 12, `${GLOSSARY.length}`);
  ok('every definition is two lines (a child reads two, not five)',
    GLOSSARY.every(g => (GLOSSARY_STRINGS.he[`glos.${g.id}.def`].match(/\n/g) || []).length === 1));
  // A locked term must tease WHERE to find the idea, never what it means.
  ok('no locked hint leaks its own definition',
    GLOSSARY.every(g => GLOSSARY_STRINGS.he[`glos.${g.id}.hint`] !== GLOSSARY_STRINGS.he[`glos.${g.id}.def`]));
  ok('hints are short enough to scan (< 60 chars, he)',
    GLOSSARY.every(g => GLOSSARY_STRINGS.he[`glos.${g.id}.hint`].length < 60));
}

/* ═══════════════════════════════ 2. the tracker earns the right things ════ */

console.log('\n  2. a synthetic bus stream unlocks exactly the expected badges');

{
  freshTracker();
  bus.emit('quiz:correct', { topic: 'prompt', tier: 1, tokens: 3, correct: true });
  ok('one correct answer earns quiz-first and nothing else',
    eq(badges(), ['quiz-first']), badges().join(', '));
  ok('…and unlocks the פרומפט term from its topic', terms().includes('prompt'));
  ok('…and fires badge:unlocked exactly once', unlockEvents.length === 1, unlockEvents.join(','));

  bus.emit('token:pickup', {});
  ok('the first token unlocks the טוקן term', terms().includes('token'));

  emitDriftRelease(1);
  ok('a released drift earns drift-first', badges().includes('drift-first'));
  ok('…but NOT drift-top (tier 1 is not the top tier)', !badges().includes('drift-top'));
  emitDriftRelease(3);
  ok('a top-tier release earns drift-top', badges().includes('drift-top'));
  // The bug that made drift-first a lie: quiz.js calls body.applyBoost() on
  // every correct answer, which raises the same `boosting` edge race.js emits
  // drift:boost from. ~17 of a championship's 25 "drifts" were quiz answers.
  const driftsBefore = getStats().driftBoosts;
  emitExternalBoost();
  emitExternalBoost();
  ok('a quiz turbo does NOT count as a drift', getStats().driftBoosts === driftsBefore,
    `${driftsBefore} -> ${getStats().driftBoosts}`);

  const before = [...badges()];
  const correctBefore = getStats().quizCorrect;
  bus.emit('quiz:timeout', { topic: 'vibe', tier: 1 });
  ok('a timeout unlocks nothing (it is not an answer)', eq(badges(), before));
  ok('…and does not count as a correct answer', getStats().quizCorrect === correctBefore,
    `${correctBefore} -> ${getStats().quizCorrect}`);
  ok('…and does not unlock its topic word', !terms().includes('vibe'));

  ok('a badge whose threshold is unmet stays locked',
    !badges().includes('quiz-5') && !badges().includes('tokens-50'));
}

{
  freshTracker();
  // Prompt badges are graded on the garage's 0–100 quality score.
  bus.emit('garage:built', { score: 42, tier: 1, expert: false, slotKey: 'engine' });
  ok('a 42-quality prompt earns no prompt badge', !badges().some(b => b.startsWith('prompt-')));
  bus.emit('garage:built', { score: 62, tier: 2, expert: false, slotKey: 'tires' });
  ok('a 62-quality prompt earns prompt-good only',
    badges().includes('prompt-good') && !badges().includes('prompt-80'));
  ok('two builds unlock the אימון term', terms().includes('training'));
  bus.emit('garage:built', { score: 84, tier: 3, expert: false, slotKey: 'engine' });
  ok('the guided ceiling (84) earns prompt-80', badges().includes('prompt-80'));
  ok('…and prompt-max stays locked at 84', !badges().includes('prompt-max'));
  bus.emit('garage:built', { score: 93, tier: 3, expert: true, slotKey: 'engine' });
  ok('a 93 in expert mode earns prompt-max and prompt-expert',
    badges().includes('prompt-max') && badges().includes('prompt-expert'));
  ok('a lower later score never lowers bestPromptScore',
    (bus.emit('garage:built', { score: 20, expert: false }), getStats().bestPromptScore === 93),
    `${getStats().bestPromptScore}`);
}

{
  freshTracker();
  playChampionship({ places: [2, 3, 1], champPlace: 1 });
  ok('three podium finishes earn champ-podium3', badges().includes('champ-podium3'));
  ok('three finished races earn champ-finish', badges().includes('champ-finish'));
  ok('a first-place championship:complete earns champ-win', badges().includes('champ-win'));
  ok('finishing a championship unlocks the ענן term', terms().includes('cloud'));

  freshTracker();
  playChampionship({ places: [2, 4, 2], champPlace: 3, emitComplete: true });
  ok('a 4th place in one race denies champ-podium3', !badges().includes('champ-podium3'));
  ok('a 3rd-place championship denies champ-win', !badges().includes('champ-win'));

  // champ-finish must not need the event that does not exist yet.
  freshTracker();
  playChampionship({ emitComplete: false });
  ok('champ-finish falls back to "three races" without championship:complete',
    badges().includes('champ-finish'));
}

console.log('\n     idempotence — replaying the same stream changes nothing');

{
  freshTracker();
  playChampionship({ places: [1, 1, 1], champPlace: 1 });
  const after1 = [...badges()];
  const terms1 = [...terms()];
  const events1 = unlockEvents.length;
  ok('the stream unlocks a stable set', after1.length > 0, after1.join(', '));

  // Replay: counters legitimately rise (it is more play), but no badge may be
  // listed twice and no badge:unlocked may fire twice for the same id.
  playChampionship({ places: [1, 1, 1], champPlace: 1 });
  ok('no badge id appears twice in the save', new Set(badges()).size === badges().length);
  ok('no term id appears twice in the save', new Set(terms()).size === terms().length);
  ok('badge:unlocked never fires twice for one id',
    new Set(unlockEvents).size === unlockEvents.length,
    `${unlockEvents.length} events, ${new Set(unlockEvents).size} distinct`);
  const replayed = unlockEvents.slice(events1);
  ok('any badge earned on the replay is genuinely new',
    replayed.every(id => !after1.includes(id)), replayed.join(', '));
  ok('previously earned badges are all still there',
    after1.every(id => badges().includes(id)));
  ok('previously earned terms are all still there',
    terms1.every(id => terms().includes(id)));

  // And a direct re-evaluation of the same stats must be a no-op.
  const n = badges().length;
  evaluate(getStats(), { silent: true });
  evaluate(getStats(), { silent: true });
  ok('re-evaluating identical stats unlocks nothing', badges().length === n);
}

/* ═══════════════════════════════ 3. persistence boundaries ════════════════ */

console.log('\n  3. the collection survives a new championship, dies with a full reset');

{
  freshTracker();
  playChampionship({ places: [1, 2, 3], champPlace: 1 });
  const kept = [...badges()];
  const keptTerms = [...terms()];
  const lifetimeTokens = getStats().tokensLifetime;

  // Exactly the write ui/menus.js resetChampionship() performs — reproduced here
  // rather than imported, because menus.js pulls in three and cannot load in Node.
  // If that function ever starts clearing badges/glossary/stats, THIS assertion
  // is what notices.
  save.set({
    championshipRace: 0, results: [], tokens: 0, parts: {},
    bestPrompt: null, championshipCounted: false, championshipAsked: [],
  });
  bus.emit('championship:reset');

  ok('badges survive resetChampionship()', eq(badges(), kept), `${badges().length} kept`);
  ok('glossary survives resetChampionship()', eq(terms(), keptTerms));
  ok('lifetime stats survive resetChampionship()', getStats().tokensLifetime === lifetimeTokens,
    `${getStats().tokensLifetime}`);
  ok('per-season counters DO reset', getStats().champPodiums === 0 && getStats().champRaces === 0);

  // …and the season badge cannot be re-earned by a second season's first race.
  const n = badges().length;
  playRace({ race: 0, place: 1 });
  ok('champ-podium3 is not re-awarded after the reset', badges().length === n
    || !badges().filter(b => b === 'champ-podium3').length > 1);

  // Full wipe (settings screen: save.reset() then bus.emit('save:reset')).
  save.reset();
  bus.emit('save:reset');
  ok('save.reset() clears badges', (badges() || []).length === 0);
  ok('save.reset() clears the glossary', (terms() || []).length === 0);
  ok('save.reset() clears the lifetime stats',
    getStats().tokensLifetime === 0 && getStats().quizCorrect === 0);
  ok('…and the tracker keeps counting from zero afterwards',
    (bus.emit('quiz:correct', { topic: 'prompt', tier: 1, tokens: 3 }),
      getStats().quizCorrect === 1 && badges().includes('quiz-first')),
    `${getStats().quizCorrect}`);
  ok('the wipe did not poison DEFAULT_STATS', DEFAULT_STATS.quizCorrect === 0);
}

/* ═══════════════════════════════ 4. the calibration claim ═════════════════ */

console.log('\n  4. calibration — 2–3 championships earns most badges, hard ones hold');

{
  // The calibration is only as honest as the economy it is measured against, so
  // the constants are IMPORTED from their owners and the import is asserted. A
  // rename is now a load error; a rebalance fails HERE, loudly, instead of
  // silently shifting every token threshold under a green tick (D29).
  ok('quiz REWARD_TOKENS imported from src/race/quiz.js',
    REWARD[1] > 0 && REWARD[2] > 0 && REWARD[3] > 0, JSON.stringify(REWARD));
  ok('FINISH_TOKENS imported from src/race/race.js',
    FINISH_TOKENS.length === 8 && FINISH_TOKENS.every(n => n > 0), `[${FINISH_TOKENS.join(', ')}]`);

  // ── THE PIN ───────────────────────────────────────────────────────────────
  // The previous one read "PINNED: TOKEN_KEEP still 0.42 — if this moves,
  // RE-MEASURE", and it did exactly its job: the Wave-4 rebalance moved every
  // number under it and this file went red instead of going on claiming a
  // calibration for an economy the game had left. Replaced in kind, not
  // softened. If you are reading this because it is red: the thresholds in
  // TOKEN_STEPS were DERIVED from these constants (see the derivation asserted
  // just below), so re-measure the income and re-derive them — do not widen the
  // pin to make the red go away.
  ok('PINNED: the economy TOKEN_STEPS was derived from — if this moves, RE-MEASURE',
    TOKEN_CLUSTERS_PER_LAP === 1
    && REWARD[1] === 1 && REWARD[2] === 1 && REWARD[3] === 1
    && FINISH_TOKENS.join(',') === '5,4,4,3,3,3,3,3',
    `clusters/lap ${TOKEN_CLUSTERS_PER_LAP}, quiz ${REWARD[1]}/${REWARD[2]}/${REWARD[3]},`
    + ` finish [${FINISH_TOKENS.join(',')}], assuming ${PICKUPS_PER_RACE} pickups/race`);

  // ── THE DERIVATION ────────────────────────────────────────────────────────
  // A literal pin says "something moved". This says WHAT THE THRESHOLDS MEAN,
  // in the only unit the brief is written in — championships — and it is
  // computed from the live constants, so it fails on any retune large enough to
  // change the answer even if someone updates the pin above without thinking.
  const perRace = i => QUESTIONS[i] * 0.7 * REWARD[TIER_OF_RACE[i]]
    + PICKUPS_PER_RACE + FINISH_TOKENS[1];
  const perChamp = [0, 1, 2].reduce((a, i) => a + perRace(i), 0);
  const avgRace = perChamp / 3;
  const lowInRaces = TOKEN_STEPS.low / avgRace;
  const highInChamps = TOKEN_STEPS.high / perChamp;
  const dataInRaces = DATA_TERM_TOKENS / avgRace;

  console.log(`     \x1b[2mderived from the live economy: ~${Math.round(perChamp)} tokens per championship`
    + ` (quiz ${REWARD[1]}/${REWARD[2]}/${REWARD[3]}, ${PICKUPS_PER_RACE} pickups/race,`
    + ` ${FINISH_TOKENS[1]} finish bonus)\x1b[0m`);
  console.log(`     \x1b[2mTOKEN_STEPS ${TOKEN_STEPS.low} / ${TOKEN_STEPS.high} = `
    + `${lowInRaces.toFixed(1)} races / ${highInChamps.toFixed(1)} championships;`
    + ` נתונים at ${DATA_TERM_TOKENS} = ${dataInRaces.toFixed(1)} races\x1b[0m`);

  // The bottom rung is an EARLY reward: more than a single average race (so one
  // race does not hand it over as a participation prize) and inside the first
  // championship for every child.
  ok('the low token badge is 1–2 races of real income (an early reward)',
    lowInRaces > 1 && lowInRaces < 2, `${lowInRaces.toFixed(2)} races`);
  // The top rung is the climb: reached inside 2–3 championships, which is the
  // brief's window, and not before 1.5 (or it is not a climb).
  ok('the high token badge is 1.5–2.5 championships of real income',
    highInChamps >= 1.5 && highInChamps <= 2.5, `${highInChamps.toFixed(2)} championships`);
  // …and the ladder keeps its shape: the old pair was 50 : 200.
  ok('the two rungs keep the ladder\'s 1:4 ratio',
    TOKEN_STEPS.high === TOKEN_STEPS.low * 4, `${TOKEN_STEPS.low} : ${TOKEN_STEPS.high}`);
  // The glossary term on the same counter (נתונים) is a FIRST-RACE unlock: the
  // word is meant to arrive while the child is still meeting tokens.
  ok('the נתונים term unlocks inside the first race',
    dataInRaces < 1, `${dataInRaces.toFixed(2)} races`);

  // And the number the CHILD reads is the number the badge tests. The strings
  // are built from TOKEN_STEPS so they cannot drift, but "cannot drift" is a
  // claim about code someone will edit — so it is checked, in both languages,
  // for all three thresholds.
  const says = (key, n) => new RegExp(`\\b${n}\\b`)
    .test((BADGE_STRINGS.he[key] || GLOSSARY_STRINGS.he[key] || '')
      + ' ' + (BADGE_STRINGS.en[key] || GLOSSARY_STRINGS.en[key] || ''));
  ok('the unlock text a child reads names the real threshold (he + en)',
    says('badge.tokens-50.cond', TOKEN_STEPS.low)
    && says('badge.tokens-200.cond', TOKEN_STEPS.high)
    && says('glos.data.hint', DATA_TERM_TOKENS),
    `"${BADGE_STRINGS.en['badge.tokens-50.cond']}" / "${BADGE_STRINGS.en['badge.tokens-200.cond']}"`
    + ` / "${GLOSSARY_STRINGS.en['glos.data.hint']}"`);
}

{
  // A plausible child: answers ~70% of questions right, finishes 2nd/3rd/2nd,
  // 1st once in the third season, drifts a fair amount, writes middling prompts
  // in the garage (one per race — the game's own flow) and never opens expert
  // mode. Two and a half championships.
  freshTracker();
  const garageVisit = score => bus.emit('garage:built', { score, tier: 2, expert: false, slotKey: 'engine' });

  // championship 1
  bus.emit('championship:reset');
  garageVisit(38); playRace({ race: 0, place: 4, correctRate: 0.6 });
  garageVisit(51); playRace({ race: 1, place: 3, correctRate: 0.7 });
  garageVisit(58); playRace({ race: 2, place: 3, correctRate: 0.7 });
  bus.emit('championship:complete', { place: 3, points: 18, races: 3 });
  // SNAPSHOT — the "early reward" claim, measured where it is made rather than
  // read off the end state 1.5 championships later. (Both of these unlock in
  // race 1–2; the whole championship is the generous reading.)
  const afterC1 = { badges: [...badges()], terms: [...terms()], tokens: getStats().tokensLifetime };
  // championship 2
  bus.emit('championship:reset');
  garageVisit(62); playRace({ race: 0, place: 2, correctRate: 0.7 });
  garageVisit(66); playRace({ race: 1, place: 2, correctRate: 0.75 });
  garageVisit(71); playRace({ race: 2, place: 3, correctRate: 0.75 });
  bus.emit('championship:complete', { place: 2, points: 22, races: 3 });
  // SNAPSHOT — "both token milestones land inside 2 championships" is a claim
  // about the TWO-championship mark. Asserting it on the 2.5-championship end
  // state would let the high rung drift half a season out of reach and stay
  // green, which is this file's own recurring failure (D29) one step along.
  const afterC2 = { badges: [...badges()], tokens: getStats().tokensLifetime };
  // half of championship 3
  bus.emit('championship:reset');
  garageVisit(74); playRace({ race: 0, place: 2, correctRate: 0.8 });
  garageVisit(78); playRace({ race: 1, place: 1, correctRate: 0.8 });

  const s = getStats();
  const got = badges();
  const easy = BADGES.filter(b => !b.hard).map(b => b.id);
  const gotEasy = easy.filter(id => got.includes(id));

  console.log(`     \x1b[2mafter 2.5 championships: ${s.quizCorrect} correct · `
    + `${s.tokensLifetime} tokens · ${s.driftBoosts} boosts · best prompt ${s.bestPromptScore}\x1b[0m`);
  console.log(`     \x1b[2mearned ${got.length}/${BADGES.length}: ${got.join(', ')}\x1b[0m`);
  console.log(`     \x1b[2mstill locked: ${BADGE_IDS.filter(id => !got.includes(id)).join(', ')}\x1b[0m`);

  ok('MOST badges are earned (≥ 70% of the non-hard ones)',
    gotEasy.length / easy.length >= 0.7, `${gotEasy.length}/${easy.length}`);
  ok('the quiz ladder is fully climbed by championship 3',
    ['quiz-first', 'quiz-5', 'quiz-15', 'quiz-40'].every(id => got.includes(id)));
  // ── the token ladder, checked where each claim is actually made ───────────
  console.log(`     \x1b[2mtoken ladder: ${afterC1.tokens} banked after champ 1,`
    + ` ${afterC2.tokens} after champ 2, ${s.tokensLifetime} after 2.5\x1b[0m`);
  ok(`the LOW token badge (${TOKEN_STEPS.low}) is an early reward — earned in championship 1`,
    afterC1.badges.includes('tokens-50'), `${afterC1.tokens} tokens after one championship`);
  ok(`…and the נתונים term (${DATA_TERM_TOKENS}) with it`,
    afterC1.terms.includes('data'), afterC1.terms.join(', '));
  ok(`both token milestones (${TOKEN_STEPS.low}/${TOKEN_STEPS.high}) land inside 2 championships`,
    afterC2.badges.includes('tokens-50') && afterC2.badges.includes('tokens-200'),
    `${afterC2.tokens} tokens after two championships`);
  // …and the high rung is not so low that it lands with the low one. If these
  // ever unlock in the same race the ladder has become a single step.
  ok('…but the high rung is NOT already earned after championship 1',
    !afterC1.badges.includes('tokens-200'), `${afterC1.tokens} tokens after one championship`);
  ok('the drift ladder is climbed', got.includes('drift-first') && got.includes('drift-25'));
  ok('the designated HARD badges are still locked',
    HARD_BADGE_IDS.every(id => !got.includes(id)), HARD_BADGE_IDS.join(', '));
  ok('there are exactly 2 hard badges (one or two, by design)',
    HARD_BADGE_IDS.length === 2, HARD_BADGE_IDS.join(', '));
  ok('MOST of the glossary is open too', terms().length >= 9, `${terms().length}/12`);

  // The counter-check: the thresholds must not be so low that ONE race clears
  // the board. A calibration that passes both directions is a calibration.
  freshTracker();
  playRace({ race: 0, place: 1, correctRate: 1 });
  const oneRace = badges();
  ok('one single race does NOT clear the board',
    oneRace.length <= 6, `${oneRace.length}/${BADGES.length}: ${oneRace.join(', ')}`);
  ok('…and the 40-answer badge is nowhere near', !oneRace.includes('quiz-40'));
}

/* ═══════════ 4b. the screen module actually loads ════════════════════════ */
// Added after a stray pair of backticks inside a CSS comment turned COL_CSS into
// a tagged template call. `node tools/checkall.mjs` bundled it happily — a
// bundle check is a SYNTAX check — and the failure only appeared when a browser
// ran it. One import is enough to catch that whole class.

console.log('\n  4b. ui/collection.js loads and exports its scene');

{
  let mod = null, err = null;
  try { mod = await import('../src/ui/collection.js'); } catch (e) { err = e; }
  ok('src/ui/collection.js evaluates without throwing', !!mod, err?.message || '');
  ok('…and exports collectionScene + preview + previewGlossary',
    !!mod && ['collectionScene', 'preview', 'previewGlossary', 'previewBadges']
      .every(k => typeof mod[k] === 'function'));
}

/* ═══════════════════════════ 5. the toast is not a modal ═════════════════ */
// The three properties the brief cares most about were correct by inspection and
// pinned by nothing, so a refactor that quietly moved the toast into the modal
// registry would have passed every other check in this file. Asserted against
// the source text because the toast has no headless behaviour to drive — the
// same technique tests/economy.test.mjs uses on the economy constants.

console.log('\n  5. the unlock toast cannot own the screen');

{
  const src = read('src/core/badges.js');
  ok('the tracker never imports the modal registry', !/from '\.\.\/ui\/style\.js'/.test(src));
  ok('…and never calls pushModal / popModal', !/\b(pushModal|popModal|modalOpen|clearModals)\s*\(/.test(src));
  ok('the toast installs no key handler (Escape stays with pause)',
    !/addEventListener\(\s*['"]key(down|up|press)['"]/.test(src));
  ok('…and steals no focus', !/\.focus\s*\(/.test(src));
  // engine.goto() calls ui.replaceChildren(), so a toast on engine.ui would be
  // erased mid-flight by the very scene change a race-end badge coincides with.
  // Comments are stripped first: this file DISCUSSES engine.ui at length in its
  // header, and an assertion that cannot tell prose from code asserts nothing.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  ok('the toast host is document.body, not engine.ui',
    /document\.body\.appendChild\(host\)/.test(code) && !/\bengine\b/.test(code),
    'engine.goto() wipes engine.ui, which would erase a race-end toast mid-flight');
  ok('the toast layer is pointer-events:none',
    /#pr-badge-toasts\{[^}]*pointer-events:none/.test(src)
    && /#pr-badge-toasts \*\{pointer-events:none\}/.test(src));
  ok('the toast is aria-live polite, never a dialog',
    /aria-live'?,?\s*'polite'/.test(src) && !/role['"],\s*['"]dialog/.test(src));
  ok('the toast removes itself (no permanent DOM in a race)',
    /setTimeout\(kill,/.test(src) && /animationName === 'prToastOut'/.test(src));
}

/* ══════════════ 6. the drift contract, driven through the REAL physics ═════ */
// THE ASSERTION THIS FILE EXISTS FOR.
//
// Round 1 of this gate hand-emitted `drift:boost { tier: 3 }` and passed. No code
// path in the game produces that payload: `_releaseDrift()` calls applyBoost()
// and zeroes `driftTier` in the same call, so race.js — which reads the body
// AFTER update() — has emitted `tier: 0` on every drift in the game's history.
// `drift-top` was unearnable and the gate said it was fine. A gate that
// exercises a payload no player can produce is worth less than no gate.
//
// So this section drives a real KartBody around a real track with the game's own
// autopilot, runs RACE.JS'S OWN emit block over the resulting body state, and
// feeds what lands on the bus to the real tracker.
//
// Round 2 wrote a hand-written MIRROR of that emit block instead. It went stale
// the day the D35 contract landed — it hardcoded `source: 'drift'` on every
// boost — so the quiz-turbo scenario below emitted 20 external boosts labelled
// as drifts and the tracker counted all 20. That is round 1's invented-payload
// hazard one level along: a copy of the emitter is still not the emitter. The
// block is therefore EXTRACTED FROM race.js's source and executed. Source pins
// are kept anyway (the extraction is by regex): they name the shape being
// lifted, and fail loudly the moment race.js stops having it.

console.log('\n  6. drift badges, driven through the real KartBody');

{
  const prevSrc = (raceSrc.match(/\n {2}const prev = \{[^}]*\};/) || [''])[0];
  const feedbackSrc = (raceSrc.match(/\n {2}function driveFeedback\(dt\) \{[\s\S]*?\n {2}\}/) || [''])[0];

  ok('race.js\'s prev + driveFeedback() were extracted for execution',
    feedbackSrc.length > 400 && /const prev = \{/.test(prevSrc),
    `prev ${prevSrc.length} chars, driveFeedback ${feedbackSrc.length} chars`);
  ok('race.js still emits drift:start/end from player.drifting',
    /bus\.emit\(player\.drifting \? 'drift:start' : 'drift:end'/.test(feedbackSrc));
  ok('race.js still emits drift:tier on a rising tier',
    /player\.driftTier > prev\.tier && player\.driftTier > 0\) bus\.emit\('drift:tier'/.test(feedbackSrc));
  // THE SOURCE PIN. It flipped the day the D35 contract landed, and it flips
  // again if anyone rewinds it — which is the only reason the stale mirror was
  // ever noticed. Do not soften it into "emits drift:boost somehow".
  ok('race.js emits drift:boost off boostSeq, with the body\'s own tier + source',
    /if \(player\.boostSeq !== prev\.boostSeq\) \{/.test(feedbackSrc)
    && /prev\.boostSeq = player\.boostSeq;/.test(feedbackSrc)
    && /bus\.emit\('drift:boost', \{ tier: player\.lastBoostTier, source: player\.lastBoostSource \}\)/.test(feedbackSrc)
    && /boostSeq: 0/.test(prevSrc));
  ok('…and NOT off the `boosting` rising edge (the bug D35 removed)',
    !/if \(player\.boosting\) \{ bus\.emit\('drift:boost'/.test(raceSrc));
  ok('…and driveFeedback() is really called by the race loop, not dead code',
    (raceSrc.match(/driveFeedback\(/g) || []).length >= 2,
    `${(raceSrc.match(/driveFeedback\(/g) || []).length} occurrences`);
  ok('the landed contract is the one in the tree (tier + source)', CONTRACT_LANDED, boostEmitSrc);

  /** race.js's real driveFeedback(), lifted verbatim, given a body to watch. */
  function realRaceFeedback() {
    const factory = new Function('bus', 'chase', 'backdrop', `
      let player = null;
      ${prevSrc}
      ${feedbackSrc}
      return { setPlayer(p) { player = p; }, driveFeedback };
    `);
    return factory(bus, { shake() {} }, false);
  }

  /** Watch what actually lands on the bus, and what tier the drift had reached. */
  function observeBoosts() {
    const list = [];
    let peak = 0;
    const offs = [
      bus.on('drift:tier', p => { peak = Math.max(peak, Number(p.tier) || 0); }),
      bus.on('drift:boost', p => { list.push({ ...p, peakSeen: peak }); peak = 0; }),
    ];
    return { list, stop: () => offs.forEach(f => f()) };
  }

  const { def, spline } = getTrack('cloud');
  const slots = gridSlots(spline, def, 8);
  // A quick, well-handling kart on the track with the longest corners, held in
  // drift by the game's own autopilot. These are the settings under which the
  // top tier is actually reachable — measured, in .tmp/w4-driftprobe.mjs.
  const body = new KartBody({
    spline, stats: { speed: 5, accel: 5, handling: 5, weight: 1 },
    startSlot: slots[0], surface: def.surface,
  });

  freshTracker();
  const watch = observeBoosts();
  const feedback = realRaceFeedback();
  feedback.setPlayer(body);
  for (let i = 0; i < 60 * 90; i++) {
    body.update(1 / 60, autopilotInput(body, spline, { drift: true, look: 22 }));
    feedback.driveFeedback(1 / 60);
  }
  watch.stop();
  const observed = watch.list;

  const topSeen = observed.filter(o => o.peakSeen >= 3).length;
  const s = getStats();
  console.log(`     \x1b[2m90s of real autopilot on "cloud": ${observed.length} boosts, `
    + `${topSeen} of them released at the top tier · tracker counted `
    + `${s.driftBoosts} drifts / ${s.driftBoostsTop} top\x1b[0m`);

  ok('the real physics produce drift releases at all', observed.length >= 20, `${observed.length}`);
  ok('the real physics reach the TOP drift tier', topSeen >= 1,
    `${topSeen} — if this is 0 the badge is unearnable by a real player`);

  // What round 1 got wrong, now asserted the other way round: before D35 every
  // one of these carried tier 0, which is why drift-top was unearnable.
  ok('the landed contract carries the real released tier',
    observed.length > 0 && observed.filter(o => o.peakSeen >= 1).every(o => o.tier === o.peakSeen),
    `${observed.filter(o => o.peakSeen >= 1).length} tiered releases checked`);
  ok('…and marks the source', observed.length > 0 && observed.every(o => o.source === 'drift'));

  // THE POINT: whatever the payload says, the tracker must count real drifts.
  ok('the tracker counts every real drift release', s.driftBoosts === observed.length,
    `tracker ${s.driftBoosts} vs real ${observed.length}`);
  ok('the tracker counts the top-tier releases', s.driftBoostsTop === topSeen,
    `tracker ${s.driftBoostsTop} vs real ${topSeen}`);
  ok('drift-first is earned by REAL driving', badges().includes('drift-first'));
  ok('drift-25 is earned by REAL driving', badges().includes('drift-25'), `${s.driftBoosts} releases`);
  ok('drift-top is earned by REAL driving (round 1 shipped this unearnable)',
    badges().includes('drift-top'));

  // …and a quiz turbo, applied through the same real body, must pay nothing.
  const quizBoostSrc = quizSrc.match(/const BOOST = \{([^}]*)\}/);
  ok('quiz.js BOOST constants are readable', !!quizBoostSrc);
  const BOOST = {};
  for (const [, k, v] of (quizBoostSrc?.[1] || '').matchAll(/(\w+):\s*([\d.]+)/g)) BOOST[k] = +v;

  // Pinned because the whole discrimination rests on it: quiz.js must keep
  // applying its turbo as a plain (source-defaulted, i.e. 'external') boost.
  ok('quiz.js still applies its turbo as an unsourced/external applyBoost()',
    /body\.applyBoost\(BOOST\.strength, BOOST\.duration, BOOST\.impulse\)/.test(quizSrc));

  freshTracker();
  const watch2 = observeBoosts();
  const feedback2 = realRaceFeedback();
  // Straight-line driving, no drift input, with a correct-answer turbo every
  // 3 seconds — exactly what a child who answers well and never drifts sees.
  const b2 = new KartBody({
    spline, stats: { speed: 3, accel: 3, handling: 3, weight: 3 },
    startSlot: slots[1], surface: def.surface,
  });
  feedback2.setPlayer(b2);
  let turbos = 0;
  for (let i = 0; i < 60 * 60; i++) {
    if (i % 180 === 0) { b2.applyBoost(BOOST.strength, BOOST.duration, BOOST.impulse); turbos++; }
    b2.update(1 / 60, autopilotInput(b2, spline, { drift: false, look: 22 }));
    feedback2.driveFeedback(1 / 60);
  }
  watch2.stop();
  ok('a child who only answers quizzes triggers real boosts', turbos >= 5, `${turbos} turbos`);
  // The assertion the stale mirror broke. It is only meaningful if the turbos
  // REACHED the bus, so that is asserted too (a gate can pass vacuously).
  ok('…and every one of them reaches the bus marked external',
    watch2.list.length === turbos && watch2.list.every(o => o.source === 'external' && o.tier === 0),
    `${watch2.list.length} boosts on the bus: ${[...new Set(watch2.list.map(o => o.source))].join(', ')}`);
  ok('…and earns NO drift badges from them',
    !badges().includes('drift-first') && getStats().driftBoosts === 0,
    `driftBoosts ${getStats().driftBoosts}`);

  // A drift release and a quiz turbo INTERLEAVED: the case the deleted legacy
  // heuristic got wrong (it read the drift's charge onto the turbo that landed
  // just after it). Both are driven through the real body and the real emit
  // block; exactly one drift may be counted.
  freshTracker();
  const watch3 = observeBoosts();
  const feedback3 = realRaceFeedback();
  const b3 = new KartBody({
    spline, stats: { speed: 5, accel: 5, handling: 5, weight: 1 },
    startSlot: slots[2], surface: def.surface,
  });
  feedback3.setPlayer(b3);
  let drifts3 = 0, turbos3 = 0, turboAt = -1;
  for (let i = 0; i < 60 * 40; i++) {
    // A correct answer 5 frames after each release — a click cannot land on the
    // same frame as the release often, but it lands DURING the boost it starts,
    // which is precisely when driftPeak used to still be warm.
    if (i === turboAt) { b3.applyBoost(BOOST.strength, BOOST.duration, BOOST.impulse); turbos3++; }
    const seqBefore = b3.boostSeq;
    b3.update(1 / 60, autopilotInput(b3, spline, { drift: true, look: 22 }));
    if (b3.boostSeq !== seqBefore && b3.lastBoostSource === 'drift') { drifts3++; turboAt = i + 5; }
    feedback3.driveFeedback(1 / 60);
  }
  watch3.stop();
  ok('the interleaved scenario really produced both kinds of boost',
    drifts3 >= 3 && turbos3 >= 3, `${drifts3} drift releases, ${turbos3} turbos`);
  ok('a turbo landing right after a release is still not a drift',
    getStats().driftBoosts === drifts3,
    `tracker ${getStats().driftBoosts} vs ${drifts3} real releases (+${turbos3} turbos)`);

  // The legacy `source == null` branch is GONE (it could not tell the two apart
  // above). An unsourced payload must therefore pay nothing — and nothing in
  // src/ may be able to emit one, or badges would silently stop counting.
  freshTracker();
  bus.emit('drift:start', { tier: 0 });
  bus.emit('drift:tier', { tier: 3 });
  bus.emit('drift:end', { tier: 0 });
  bus.emit('drift:boost', { tier: 3 });                 // no source: unreachable in-game
  ok('an unsourced drift:boost counts nothing (legacy branch deleted)',
    getStats().driftBoosts === 0 && getStats().driftBoostsTop === 0,
    `${getStats().driftBoosts} drifts`);
  {
    const emits = [];
    for (const f of execSync('grep -rl "drift:boost" src/', { cwd: root, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)) {
      for (const [, args] of read(f).matchAll(/bus\.emit\(\s*'drift:boost'\s*,([\s\S]{0,160}?)\)\s*;/g)) {
        emits.push({ f, args });
      }
    }
    ok('…and every drift:boost emitter in src/ carries a source',
      emits.length > 0 && emits.every(e => /\bsource\s*:/.test(e.args)),
      emits.map(e => e.f).join(', ') || 'NO EMITTER FOUND — this scan is asserting nothing');
  }

  // Finally: the fast helper used by the calibration must emit what reality does.
  freshTracker();
  emitDriftRelease(3);
  ok('emitDriftRelease() mirrors the real sequence (1 drift, 1 top)',
    getStats().driftBoosts === 1 && getStats().driftBoostsTop === 1);
  freshTracker();
  emitExternalBoost();
  ok('emitExternalBoost() mirrors a quiz turbo (counts nothing)',
    getStats().driftBoosts === 0);
}

/* ═══════════════════════════════ 7. the seam the lead must close ══════════ */

console.log('\n  7. the tracker only listens for events that somebody emits');

// A listener-only module cannot notice that the event it waits for was renamed,
// moved, or never written — the screen just renders and the badge never comes.
// So every event the tracker consumes is checked against the emitters in src/.
// This is what turns "I asked the lead for garage:built" into something the
// build can verify, and it fails in BOTH directions: an event that quietly
// arrives must be struck off NEEDED_EVENTS, or the next reader is told a live
// badge is dead.
{
  const srcFiles = execSync('grep -rl "bus.emit(" src/', { cwd: root, encoding: 'utf8' })
    .trim().split('\n').filter(f => f && !f.includes('core/badges.js'));
  const emitted = new Map();
  for (const f of srcFiles) {
    const text = read(f);
    // NOT `bus.emit('name'` — quiz.js picks its result event with a ternary
    // (`bus.emit(good ? 'quiz:correct' : timedOut ? 'quiz:timeout' : 'quiz:wrong', …)`)
    // and race.js does the same for drift:start/end. A scan that only reads the
    // first literal reports five live events as dead, which is how a seam gate
    // earns itself a permanent "known failure" comment and stops being read.
    for (const [, args] of text.matchAll(/bus\.emit\(([\s\S]{0,240}?)\)/g)) {
      for (const [, evt] of args.matchAll(/'([\w-]+:[\w-]+)'/g)) {
        if (!emitted.has(evt)) emitted.set(evt, f);
      }
    }
  }
  ok('the emitter scan found the game\'s events', emitted.size > 15, `${emitted.size} distinct events`);
  ok('…including the ones chosen by a ternary (quiz results, drift start/end)',
    ['quiz:correct', 'quiz:timeout', 'quiz:wrong', 'drift:start', 'drift:end'].every(e => emitted.has(e)));

  const missing = CONSUMED_EVENTS.filter(e => !emitted.has(e));
  for (const e of CONSUMED_EVENTS.filter(x => emitted.has(x))) {
    ok(`  "${e}" is emitted`, true, emitted.get(e));
  }
  for (const e of missing) {
    const declared = NEEDED_EVENTS.some(n => n.event === e);
    ok(`  "${e}" is NOT emitted — declared in NEEDED_EVENTS?`, declared,
      declared ? 'declared' : 'UNDECLARED: this event is dead and nothing says so');
  }
  ok('NEEDED_EVENTS lists exactly the events nobody emits',
    NEEDED_EVENTS.length === missing.length,
    `${NEEDED_EVENTS.length} declared vs ${missing.length} actually missing`
    + (NEEDED_EVENTS.length > missing.length ? ' — a declared event has LANDED, strike it off' : ''));
  ok('every badge on the board is reachable', missing.length === 0,
    missing.length ? `blocked by: ${missing.join(', ')}` : 'garage:built and championship:complete both landed');
}

tracker?.dispose();
offUnlock?.();

console.log('  ' + '─'.repeat(74));
console.log(failed ? `  \x1b[31m${failed} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exitCode = failed ? 1 : 0;

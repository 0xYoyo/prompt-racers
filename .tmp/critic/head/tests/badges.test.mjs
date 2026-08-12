// ═══════════════════════════════════════════════════════════════════════════
// האוסף שלי — badges, glossary and the tracker (Wave 4, item 12).
//
// This gate exists because the tracker is a SEAM: nothing imports it, it only
// listens to the bus, and every failure mode it has is silent. A badge that
// never unlocks, a badge that unlocks twice, a Hebrew name with no English
// translation and a calibration that puts "40 correct answers" out of a child's
// reach all look identical from the outside — the screen just renders.
//
// Four things are pinned:
//   1. every badge and term is complete in BOTH languages, with an icon;
//   2. a synthetic bus stream unlocks exactly the expected set, and replaying it
//      unlocks nothing more (idempotence);
//   3. badges/glossary survive a resetChampionship()-shaped write and are wiped
//      by save.reset();
//   4. the CALIBRATION CLAIM: ~2.5 championships of real measured play earns
//      most badges, and the two designated hard ones stay locked.
//
// Runs in plain Node: core/ has no DOM at import time and save.js falls back to
// in-memory when localStorage is missing. ui/ is deliberately NOT imported here
// (it pulls in three).
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { bus } from '../src/core/bus.js';
import { save } from '../src/core/save.js';
import { getTrack, gridSlots } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import {
  BADGES, BADGE_IDS, GLOSSARY, GLOSSARY_IDS, ICONS, HARD_BADGE_IDS,
  BADGE_STRINGS, GLOSSARY_STRINGS, DEFAULT_STATS,
  startBadgeTracker, getStats, evaluate, NEEDED_EVENTS,
} from '../src/core/badges.js';

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
// REWARD_TOKENS and FINISH_TOKENS into local literals; another agent is
// rebalancing the economy this wave, and a copy would have gone on asserting a
// calibration that no longer described the game, in green — which is D29's
// failure exactly. So the constants are READ OUT OF THEIR OWNING MODULES (the
// same technique tests/economy.test.mjs uses), the parse is asserted, and the
// simulated stream is DERIVED from them.
//
// Two numbers cannot be read because no constant holds them:
//   • questions per race 10 / 8 / 7 — DECISIONS.md D28, stopwatched on the built
//     game. There is no constant; the quiz draws against beacons and cooldowns.
//   • token pickups ~15 per race — a measurement, governed by race.js's
//     TOKEN_KEEP thinning factor. That factor IS pinned below, so if the pickup
//     yield is retuned this gate fails and says to re-measure, rather than
//     quietly carrying a stale number.
const quizSrc = read('src/race/quiz.js');
const raceSrc = read('src/race/race.js');

const rewardMatch = quizSrc.match(/const REWARD_TOKENS = \{([^}]*)\}/);
const REWARD = {};
for (const [, k, v] of (rewardMatch?.[1] || '').matchAll(/(\d+)\s*:\s*(\d+)/g)) REWARD[+k] = +v;

const finishMatch = raceSrc.match(/const FINISH_TOKENS = \[([^\]]*)\]/);
const FINISH_TOKENS = (finishMatch?.[1] || '').split(',').map(s => +s.trim()).filter(n => !Number.isNaN(n));

const keepMatch = raceSrc.match(/const TOKEN_KEEP = ([\d.]+)/);
const TOKEN_KEEP = +(keepMatch?.[1] ?? NaN);

// ── which `drift:boost` contract is in the tree RIGHT NOW ───────────────────
// Wave 4 is replacing it with `{ tier: 1-3 | 0, source: 'drift' | 'external' }`
// fired off a boostSeq counter. Until that lands, race.js emits
// `{ tier: player.driftTier }` on a rising edge — and that tier is ALWAYS 0.
// The gate reads the tree instead of assuming either, so it tells the truth in
// both states and cannot go on testing a contract that has been replaced.
const boostEmitSrc = (raceSrc.match(/bus\.emit\('drift:boost',\s*\{[^}]*\}/) || [''])[0];
const CONTRACT_LANDED = /source/.test(boostEmitSrc);

/** The payload the game really puts on the bus, in whichever state it is in. */
function DRIFT_BOOST_PAYLOAD(peakTier, source = 'drift') {
  if (!CONTRACT_LANDED) return { tier: 0 };            // the measured legacy lie
  return { tier: source === 'drift' ? peakTier : 0, source };
}
const LEGACY_PAYLOAD_TIER = CONTRACT_LANDED;

const QUESTIONS = [10, 8, 7];
const TIER_OF_RACE = [1, 2, 3];
const PICKUPS_PER_RACE = 15;
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
  bus.emit('drift:end', { tier: LEGACY_PAYLOAD_TIER ? peakTier : 0 });
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
  // the constants are read from their owners and the read is asserted. A rename
  // or a rebalance fails HERE, loudly, instead of silently shifting every token
  // threshold under a green tick (D29).
  ok('quiz REWARD_TOKENS read from src/race/quiz.js',
    REWARD[1] > 0 && REWARD[2] > 0 && REWARD[3] > 0, JSON.stringify(REWARD));
  ok('FINISH_TOKENS read from src/race/race.js',
    FINISH_TOKENS.length === 8, `[${FINISH_TOKENS.join(', ')}]`);
  ok('PINNED: TOKEN_KEEP still 0.42 — if this moves, RE-MEASURE PICKUPS_PER_RACE',
    TOKEN_KEEP === 0.42, `TOKEN_KEEP=${TOKEN_KEEP}, assuming ${PICKUPS_PER_RACE} pickups/race`);

  const perChamp = QUESTIONS.reduce((a, n, i) => a + n * 0.7 * REWARD[TIER_OF_RACE[i]], 0)
    + PICKUPS_PER_RACE * 3 + FINISH_TOKENS[1] * 3;
  console.log(`     \x1b[2mderived from the live economy: ~${Math.round(perChamp)} tokens per championship`
    + ` (quiz ${REWARD[1]}/${REWARD[2]}/${REWARD[3]}, ${PICKUPS_PER_RACE} pickups/race,`
    + ` ${FINISH_TOKENS[1]} finish bonus) — thresholds 50 / 200\x1b[0m`);
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
  // championship 2
  bus.emit('championship:reset');
  garageVisit(62); playRace({ race: 0, place: 2, correctRate: 0.7 });
  garageVisit(66); playRace({ race: 1, place: 2, correctRate: 0.75 });
  garageVisit(71); playRace({ race: 2, place: 3, correctRate: 0.75 });
  bus.emit('championship:complete', { place: 2, points: 22, races: 3 });
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
  ok('both token milestones land inside 2 championships',
    got.includes('tokens-50') && got.includes('tokens-200'), `${s.tokensLifetime} tokens`);
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
// autopilot, mirrors race.js's emit block over the observed body state, and
// feeds the result to the real tracker.

console.log('\n  6. drift badges, driven through the real KartBody');

{
  // The mirror below reproduces race.js's emit block. If race.js changes shape,
  // the mirror is a lie — so pin the lines being mirrored.
  ok('race.js still emits drift:start/end from player.drifting',
    /bus\.emit\(player\.drifting \? 'drift:start' : 'drift:end'/.test(raceSrc));
  ok('race.js still emits drift:tier on a rising tier',
    /player\.driftTier > prev\.tier && player\.driftTier > 0\) bus\.emit\('drift:tier'/.test(raceSrc));
  ok('race.js still emits drift:boost when boosting turns on',
    /if \(player\.boosting\) \{ bus\.emit\('drift:boost'/.test(raceSrc));

  /** race.js lines 566-580, applied to a body this test drives itself. */
  function raceEmitMirror() {
    const prev = { drifting: false, tier: 0, boosting: false };
    let peak = 0;
    return body => {
      if (body.drifting !== prev.drifting) {
        prev.drifting = body.drifting;
        bus.emit(body.drifting ? 'drift:start' : 'drift:end', { tier: body.driftTier });
      }
      if (body.driftTier !== prev.tier) {
        if (body.driftTier > prev.tier && body.driftTier > 0) {
          bus.emit('drift:tier', { tier: body.driftTier });
          peak = Math.max(peak, body.driftTier);
        }
        prev.tier = body.driftTier;
      }
      if (body.boosting !== prev.boosting) {
        prev.boosting = body.boosting;
        if (body.boosting) {
          const payload = CONTRACT_LANDED
            ? { tier: peak, source: 'drift' }        // what the new contract will carry
            : { tier: body.driftTier };              // what the tree carries today
          observed.push({ ...payload, peakSeen: peak });
          bus.emit('drift:boost', payload);
          peak = 0;
        }
      }
    };
  }

  const observed = [];
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
  const emit = raceEmitMirror();
  for (let i = 0; i < 60 * 90; i++) {
    body.update(1 / 60, autopilotInput(body, spline, { drift: true, look: 22 }));
    emit(body);
  }

  const topSeen = observed.filter(o => o.peakSeen >= 3).length;
  const s = getStats();
  console.log(`     \x1b[2m90s of real autopilot on "cloud": ${observed.length} boosts, `
    + `${topSeen} of them released at the top tier · tracker counted `
    + `${s.driftBoosts} drifts / ${s.driftBoostsTop} top\x1b[0m`);

  ok('the real physics produce drift releases at all', observed.length >= 20, `${observed.length}`);
  ok('the real physics reach the TOP drift tier', topSeen >= 1,
    `${topSeen} — if this is 0 the badge is unearnable by a real player`);

  // The measurement that round 1 got wrong. Kept as a characterisation: it
  // FAILS the day the physics/race contract is fixed, which forces whoever
  // fixes it back here to update the expectation rather than leaving a gate
  // that silently tests the old world.
  if (!CONTRACT_LANDED) {
    ok('CHARACTERISATION: every legacy drift:boost carries tier 0',
      observed.every(o => o.tier === 0),
      'kartphysics zeroes driftTier inside _releaseDrift — fix this and this line flips');
  } else {
    ok('the landed contract carries the real released tier',
      observed.filter(o => o.peakSeen >= 1).every(o => o.tier === o.peakSeen));
    ok('…and marks the source', observed.every(o => o.source === 'drift'));
  }

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

  freshTracker();
  const emit2 = raceEmitMirror();
  // Straight-line driving, no drift input, with a correct-answer turbo every
  // 3 seconds — exactly what a child who answers well and never drifts sees.
  const b2 = new KartBody({
    spline, stats: { speed: 3, accel: 3, handling: 3, weight: 3 },
    startSlot: slots[1], surface: def.surface,
  });
  let turbos = 0;
  for (let i = 0; i < 60 * 60; i++) {
    if (i % 180 === 0) { b2.applyBoost(BOOST.strength, BOOST.duration, BOOST.impulse); turbos++; }
    b2.update(1 / 60, autopilotInput(b2, spline, { drift: false, look: 22 }));
    emit2(b2);
  }
  ok('a child who only answers quizzes triggers real boosts', turbos >= 5, `${turbos} turbos`);
  ok('…and earns NO drift badges from them',
    !badges().includes('drift-first') && getStats().driftBoosts === 0,
    `driftBoosts ${getStats().driftBoosts}`);

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

console.log('\n  7. events this tracker needs that the game does not emit yet');

{
  ok('NEEDED_EVENTS is declared for the lead', NEEDED_EVENTS.length >= 1);
  for (const e of NEEDED_EVENTS) {
    ok(`  needs "${e.event}"`, !!(e.payload && e.file && e.why), e.file);
  }
  // If someone wires these up and this list is stale, that is fine — but the
  // badges that depend on them must not be quietly unreachable in the meantime.
  ok('only the two documented badges depend on a missing event',
    NEEDED_EVENTS.length === 2);
}

tracker?.dispose();
offUnlock?.();

console.log('  ' + '─'.repeat(74));
console.log(failed ? `  \x1b[31m${failed} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exitCode = failed ? 1 : 0;

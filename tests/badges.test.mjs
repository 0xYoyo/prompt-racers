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
import { bus } from '../src/core/bus.js';
import { save } from '../src/core/save.js';
import {
  BADGES, BADGE_IDS, GLOSSARY, GLOSSARY_IDS, ICONS, HARD_BADGE_IDS,
  BADGE_STRINGS, GLOSSARY_STRINGS, DEFAULT_STATS,
  startBadgeTracker, getStats, evaluate, NEEDED_EVENTS,
} from '../src/core/badges.js';

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
// Every number here comes from the codebase, not from a guess:
//   • questions per race 10 / 8 / 7          — DECISIONS.md D28, stopwatched
//   • token pickups ~15 per race             — tests/economy.test.mjs
//   • quiz reward 3 / 4 / 5 by tier          — quiz.js REWARD_TOKENS
//   • finish bonus 6 for a win, 3 for last   — race.js FINISH_TOKENS
//   • drift boosts ~12 per race              — a conservative read of a lap that
//     hits four corners hard over three laps
const QUESTIONS = [10, 8, 7];
const TIER_OF_RACE = [1, 2, 3];
const REWARD = { 1: 3, 2: 4, 3: 5 };
const PICKUPS_PER_RACE = 15;
const BOOSTS_PER_RACE = 12;
const TOPICS = ['whatai', 'prompt', 'tokens', 'iterate', 'mistakes', 'vibe'];

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
  for (let d = 0; d < (o.boosts ?? BOOSTS_PER_RACE); d++) {
    const dtier = d % 4 === 0 ? 3 : (d % 2 === 0 ? 2 : 1);
    bus.emit('drift:tier', { tier: dtier });
    bus.emit('drift:boost', { tier: dtier });
  }
  const place = o.place ?? 2;
  bus.emit('race:complete', {
    track: `t${i}`, trackIndex: i, place, timeMs: 120000,
    tokensFinishBonus: [6, 5, 5, 4, 4, 3, 3, 3][place - 1] ?? 3,
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

  bus.emit('drift:boost', { tier: 1 });
  ok('a released drift earns drift-first', badges().includes('drift-first'));
  ok('…but NOT drift-top (tier 1 is not the top tier)', !badges().includes('drift-top'));
  bus.emit('drift:boost', { tier: 3 });
  ok('a top-tier release earns drift-top', badges().includes('drift-top'));

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

/* ═══════════════════════════════ 5. the seam the lead must close ══════════ */

console.log('\n  5. events this tracker needs that the game does not emit yet');

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

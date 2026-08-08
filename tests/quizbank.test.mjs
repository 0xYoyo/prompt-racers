// ═════════════════════════════════════════════════════════════════════════════
// QUIZ BANK GATE — src/race/quizdata.js
// ═════════════════════════════════════════════════════════════════════════════
//
// The bank is the educational payload of the game, and it is pure data, so every
// property that matters can be proven here rather than found by a child mid-lap.
// What this file guards:
//   • size — a full championship must never run dry
//   • schema — every field present, in BOTH languages, non-empty
//   • exactly one correct index, in range, spread across 0/1/2
//   • no duplicate ids and no duplicate question text (in either language)
//   • tier supply — worst-case championship draw with no repeats is possible
//   • Hebrew really is Hebrew (no untranslated English leaking into he.*)
//   • no existing-IP references (same keyword list tools/verify.mjs sweeps for)
//   • the authoring rules in quizdata's header: length ceilings, no "which is NOT"
//
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  QUESTIONS, TOPICS, bankStats, tiersForDifficulty, questionsForDifficulty, MIN_POOL,
} from '../src/race/quizdata.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fail++;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(58)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};

console.log('\n  QUIZ BANK\n  ' + '─'.repeat(78));

/* ── size ──────────────────────────────────────────────────────────────────── */
const stats = bankStats();
ok('at least 95 questions', QUESTIONS.length >= 95, `${QUESTIONS.length} total`);
console.log(`    tiers  ${JSON.stringify(stats.byTier)}`);
console.log(`    topics ${JSON.stringify(stats.byTopic)}`);

/* ── schema ────────────────────────────────────────────────────────────────── */
const HE = /[֐-׿]/;
// Latin letters that are NOT part of an allowed acronym/loanword. The Hebrew copy
// legitimately writes "AI" (and only that), so strip those first.
const stripAllowedLatin = s => s.replace(/\bAI\b/g, '');

const badSchema = [], badCorrect = [], noHebrew = [], englishLeak = [], tooLong = [];
const badTier = [], badTopic = [], trickWord = [];

for (const q of QUESTIONS) {
  const where = q.id || '(no id)';
  const strOk = v => typeof v === 'string' && v.trim().length > 0;

  if (!strOk(q.id)) badSchema.push(`${where}: id`);
  for (const lang of ['he', 'en']) {
    const L = q[lang];
    if (!L || typeof L !== 'object') { badSchema.push(`${where}: ${lang} missing`); continue; }
    if (!strOk(L.q)) badSchema.push(`${where}: ${lang}.q`);
    if (!strOk(L.why)) badSchema.push(`${where}: ${lang}.why`);
    if (!Array.isArray(L.a) || L.a.length !== 3) badSchema.push(`${where}: ${lang}.a not 3`);
    else if (L.a.some(a => !strOk(a))) badSchema.push(`${where}: ${lang}.a empty option`);
    else if (new Set(L.a).size !== 3) badSchema.push(`${where}: ${lang}.a duplicate option`);
  }

  if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 2) badCorrect.push(where);
  if (![1, 2, 3].includes(q.tier)) badTier.push(where);
  if (!TOPICS.includes(q.topic)) badTopic.push(`${where}: ${q.topic}`);

  // Hebrew must be Hebrew…
  for (const field of [q.he?.q, q.he?.why, ...(q.he?.a || [])]) {
    if (typeof field !== 'string') continue;
    if (!HE.test(field)) noHebrew.push(`${where}: "${field.slice(0, 30)}"`);
    // …and must not carry stretches of untranslated English.
    const latin = stripAllowedLatin(field).match(/[A-Za-z]{2,}/g);
    if (latin) englishLeak.push(`${where}: ${latin.join(',')}`);
  }
  // English must not be Hebrew (a copy-paste slip in the other direction).
  for (const field of [q.en?.q, q.en?.why, ...(q.en?.a || [])]) {
    if (typeof field === 'string' && HE.test(field)) englishLeak.push(`${where}: hebrew in en`);
  }

  // Authoring rules from the quizdata header — a question a child reads while
  // still driving. Ceilings are the documented ones, with a small margin.
  if (q.he?.q && q.he.q.length > 80) tooLong.push(`${where}: he.q ${q.he.q.length}`);
  if (q.he?.why && q.he.why.length > 190) tooLong.push(`${where}: he.why ${q.he.why.length}`);
  if (q.en?.q && q.en.q.length > 90) tooLong.push(`${where}: en.q ${q.en.q.length}`);
  if (q.en?.why && q.en.why.length > 200) tooLong.push(`${where}: en.why ${q.en.why.length}`);
  for (const a of (q.he?.a || [])) if (a.length > 70) tooLong.push(`${where}: he.a ${a.length}`);

  // No trick questions: "which is NOT" / "מה לא נכון" style.
  if (/\bNOT\b/.test(q.en?.q || '')) trickWord.push(where);
}

ok('every field present and non-empty in he + en', badSchema.length === 0, badSchema.slice(0, 4).join(' | '));
ok('exactly one correct index, 0..2', badCorrect.length === 0, badCorrect.slice(0, 4).join(', '));
ok('every tier is 1, 2 or 3', badTier.length === 0, badTier.slice(0, 4).join(', '));
ok('every topic is a known TOPICS key', badTopic.length === 0, badTopic.slice(0, 4).join(', '));
ok('Hebrew fields contain Hebrew', noHebrew.length === 0, noHebrew.slice(0, 3).join(' | '));
ok('no English leaking into Hebrew copy', englishLeak.length === 0, englishLeak.slice(0, 3).join(' | '));
ok('length ceilings respected (readable at speed)', tooLong.length === 0, tooLong.slice(0, 4).join(' | '));
ok('no "which is NOT" trick questions', trickWord.length === 0, trickWord.slice(0, 4).join(', '));

/* ── uniqueness ────────────────────────────────────────────────────────────── */
const dupIds = [], dupHe = [], dupEn = [];
const seenId = new Set(), seenHe = new Set(), seenEn = new Set();
const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
for (const q of QUESTIONS) {
  if (seenId.has(q.id)) dupIds.push(q.id); else seenId.add(q.id);
  const h = norm(q.he?.q), e = norm(q.en?.q);
  if (seenHe.has(h)) dupHe.push(q.id); else seenHe.add(h);
  if (seenEn.has(e)) dupEn.push(q.id); else seenEn.add(e);
}
ok('ids are unique and stable', dupIds.length === 0, dupIds.join(', '));
ok('no duplicate Hebrew question text', dupHe.length === 0, dupHe.join(', '));
ok('no duplicate English question text', dupEn.length === 0, dupEn.join(', '));

/* ── answer-position spread ────────────────────────────────────────────────── */
// quiz.js reshuffles per draw, but the authored spread is the second layer and a
// bank that drifted to "always index 1" would be a smell worth catching.
const byIdx = [0, 0, 0];
for (const q of QUESTIONS) byIdx[q.correct]++;
const minShare = Math.min(...byIdx) / QUESTIONS.length;
ok('correct index spread across 0/1/2', minShare > 0.22, JSON.stringify(byIdx));

/* ── THE TELLS ─────────────────────────────────────────────────────────────
   Position is shuffled per draw, so position is not how a child cheats. What
   survives the shuffle is anything carried by the option TEXT: length, a topic
   word that is always wrong, a word like "always" that never appears in a right
   answer. Each of those is a way to score without reading the question, which is
   a way to finish the game having learned nothing. These four are gated because
   the bank drifted into all four at once and nobody noticed for 34 questions. */

// Length is the tell that survives shuffling, and it has THREE cheat strategies,
// not one: always pick the longest, always pick the shortest, always pick the
// middle one. Checking only "longest" hides the failure mode this bank actually
// had — tier 1 where the longest was never right (so "not the longest" scored
// 73%) cancelling out tier 3 where it usually was. So: every tier, every
// language, every strategy, each below 45%. Ties count in the cheater's favour.
const LEN_STRATS = {
  longest: (lens, i) => lens[i] === Math.max(...lens),
  shortest: (lens, i) => lens[i] === Math.min(...lens),
  middle: (lens, i) => lens[i] === [...lens].sort((a, b) => a - b)[1],
};
console.log('    length-cheat table (share of questions each blind strategy wins)');
for (const lang of ['he', 'en']) {
  for (const tier of [1, 2, 3]) {
    const pool = QUESTIONS.filter(q => q.tier === tier);
    const row = {};
    for (const [name, fn] of Object.entries(LEN_STRATS)) {
      row[name] = pool.filter(q => fn(q[lang].a.map(s => s.length), q.correct)).length / pool.length;
    }
    const worst = Math.max(...Object.values(row));
    const fmt = Object.entries(row).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join('  ');
    ok(`${lang} tier ${tier}: no length strategy beats 45%`, worst < 0.45, `n=${pool.length}  ${fmt}`);
  }
}

// A word that appears in wrong answers and NEVER in a right one is a free point.
// Each pattern below is checked as: of every option containing it, a fair share
// must be correct answers. The threshold is deliberately below the 1-in-3 a
// neutral word would score — the point is "not a reliable tell", not perfection.
const FORMULAS = [
  { name: 'tokens mentioned outside token questions',
    he: /טוקנ/, en: /\btokens?\b/i, min: 0.25, skipTopic: 'tokens' },
  { name: 'absolutes (תמיד / אף פעם / always / never)',
    he: /(תמיד|אף פעם|לעולם|בכל מצב|בכל מקרה)/, en: /\b(always|never|every time|in every case)\b/i, min: 0.25 },
];
for (const f of FORMULAS) {
  let hit = 0, hitCorrect = 0;
  for (const q of QUESTIONS) {
    if (f.skipTopic && q.topic === f.skipTopic) continue;
    for (const lang of ['he', 'en']) {
      q[lang].a.forEach((s, i) => {
        if (!f[lang].test(s)) return;
        hit++;
        if (i === q.correct) hitCorrect++;
      });
    }
  }
  const share = hit ? hitCorrect / hit : 1;
  ok(`${f.name} is not a tell`, share >= f.min,
     `${hitCorrect}/${hit} correct = ${(share * 100).toFixed(0)}%`);
}

// The "silly option" formula: emphasis-by-punctuation is never the right answer
// and never will be, so a child who learns the shape gets a free point every
// time it appears. Kept to a couple of appearances rather than banned.
{
  const PUNCT = /(סימני קריאה|אותיות גדולות|אימוג|exclamation marks|capital letters|emoji)/i;
  const n = QUESTIONS.reduce((acc, q) =>
    acc + q.he.a.filter(s => PUNCT.test(s)).length, 0);
  ok('punctuation-emphasis distractor used sparingly', n <= 3, `${n} appearances`);
}

/* ── he ↔ en structural alignment ──────────────────────────────────────────
   `correct` is a single index shared by both languages, so an English array that
   gets reordered by a future edit ships a silently wrong English quiz — the
   panel would mark the wrong option green for every English player, and nothing
   else in the suite would notice. Full semantic alignment is not checkable here,
   but option ORDER is: numerals and negations are carried by translation, so if
   some permutation of en.a matches he.a's marker pattern strictly better than
   the identity does, the arrays have been reordered. */
{
  const NUM_HE = /(\d|אחת|אחד|שתי|שניים|שלוש|ארבע|חמישה|חמש|עשר)/;
  const NUM_EN = /(\d|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bten\b)/i;
  const NEG_HE = /(\bלא\b|אין |אף פעם|בלי )/;
  const NEG_EN = /\b(no|not|never|nothing|without|cannot)\b/i;
  const feat = (a, N, G) => a.map(s => [N.test(s) ? 1 : 0, G.test(s) ? 1 : 0]);
  const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const shapeBad = [], orderBad = [];
  for (const q of QUESTIONS) {
    if (q.he.a.length !== 3 || q.en.a.length !== 3) { shapeBad.push(q.id); continue; }
    const H = feat(q.he.a, NUM_HE, NEG_HE), E = feat(q.en.a, NUM_EN, NEG_EN);
    const score = p => p.reduce((acc, ei, i) => acc + (H[i][0] === E[ei][0]) + (H[i][1] === E[ei][1]), 0);
    if (Math.max(...PERMS.slice(1).map(score)) > score(PERMS[0])) orderBad.push(q.id);
  }
  ok('he.a and en.a are both length 3', shapeBad.length === 0, shapeBad.join(', '));
  ok('en.a option order matches he.a', orderBad.length === 0, orderBad.join(', '));
}

/* ── championship supply ───────────────────────────────────────────────────── */
// MAX_PER_RACE is derived from quiz.js's own constants rather than guessed.
// Worst case for question count is a player who answers instantly every time:
//   cycle = feedback (dismissible after DISMISS_AFTER_S) + COOLDOWN_S ≈ 10.7s
// over a generous 3-lap race of RACE_CAP_S wall-clock seconds. Beacon respawn
// (26s) and the per-lap beacon count make the real number far smaller (2–3 per
// lap), so this is a hard ceiling with plenty of headroom.
const quizSrc = readFileSync(join(root, 'src/race/quiz.js'), 'utf8');
const constOf = name => {
  const m = quizSrc.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9.]+)`));
  return m ? Number(m[1]) : null;
};
const COOLDOWN_S = constOf('COOLDOWN_S');
const DISMISS_AFTER_S = constOf('DISMISS_AFTER_S');
ok('quiz.js pacing constants readable', COOLDOWN_S > 0 && DISMISS_AFTER_S > 0,
   `COOLDOWN_S=${COOLDOWN_S} DISMISS_AFTER_S=${DISMISS_AFTER_S}`);

// Race length is read from race.js too, so growing the race cannot silently
// under-test the bank: laps × a generous 90s ceiling for one lap on the longest
// track (real laps run well under a minute).
const raceSrc = readFileSync(join(root, 'src/race/race.js'), 'utf8');
const lapsM = raceSrc.match(/const laps = opts\.laps \?\? def\.laps \?\? (\d+)/);
ok('race.js lap count readable', !!lapsM, lapsM ? `${lapsM[1]} laps` : '');
const LAPS = lapsM ? Number(lapsM[1]) : 3;
const LAP_CAP_S = 90;
const RACE_CAP_S = LAPS * LAP_CAP_S;
const MAX_PER_RACE = Math.ceil(RACE_CAP_S / (COOLDOWN_S + DISMISS_AFTER_S));
console.log(`    worst-case questions in one race: ${MAX_PER_RACE}`);

// Within one race quiz.js draws without replacement from questionsForDifficulty,
// so intra-race uniqueness holds as long as the pool is at least MAX_PER_RACE.
for (const d of [1, 2, 3]) {
  const pool = questionsForDifficulty(d);
  ok(`race ${d} pool ≥ worst-case race length`, pool.length >= MAX_PER_RACE,
     `${pool.length} eligible (tiers ${tiersForDifficulty(d).join('+')})`);
}

// Across the championship: races run 1 → 2 → 3, each drawing MAX_PER_RACE.
// Simulate the WORST adversarial draw — every race eats the questions the next
// race would most like to have — and require that no race is ever forced to
// repeat. This is the property that makes the `exclude` argument sufficient.
{
  const remaining = { 1: [], 2: [], 3: [] };
  for (const q of QUESTIONS) remaining[q.tier].push(q.id);
  const take = (tiers, n, order) => {
    let need = n;
    for (const t of order) {
      if (!tiers.includes(t)) continue;
      const got = Math.min(need, remaining[t].length);
      remaining[t].splice(0, got);
      need -= got;
      if (!need) break;
    }
    return need; // > 0 means the race ran out and had to repeat
  };
  // Race 1 (tier 1) then race 2 eats tier 2 first (starving race 3), then race 3.
  const short1 = take([1], MAX_PER_RACE, [1]);
  const short2 = take([1, 2], MAX_PER_RACE, [2, 1]);
  const short3 = take([2, 3], MAX_PER_RACE, [2, 3]);
  ok('championship never runs out (worst-case draw)',
     short1 === 0 && short2 === 0 && short3 === 0,
     `shortfalls ${short1}/${short2}/${short3}`);
}

// The no-repeat hook itself.
{
  const race1 = questionsForDifficulty(1).slice(0, MAX_PER_RACE).map(q => q.id);
  const race2 = questionsForDifficulty(2, race1);
  ok('exclude filters already-asked ids', race2.every(q => !race1.includes(q.id)),
     `${race2.length} left for race 2`);
  ok('exclude never starves the pool below MIN_POOL',
     questionsForDifficulty(3, QUESTIONS.map(q => q.id)).length >= MIN_POOL);
  ok('exclude is optional (old call shape unchanged)',
     questionsForDifficulty(2).length === questionsForDifficulty(2, []).length);
}

/* ── IP safety ─────────────────────────────────────────────────────────────── */
// Same keyword list tools/verify.mjs sweeps with, read from the tool itself so
// the two can never drift apart.
{
  const verifySrc = readFileSync(join(root, 'tools/verify.mjs'), 'utf8');
  const m = verifySrc.match(/const ipWords = (\/\\b\(.+?\)\\b\/i);/s);
  ok('IP keyword list reused from tools/verify.mjs', !!m);
  const ipWords = m ? new RegExp(m[1].slice(1, m[1].lastIndexOf('/')), 'i') : /$^/;
  const bankText = JSON.stringify(QUESTIONS);
  const hit = bankText.match(ipWords);
  ok('no existing-IP references in the bank', !hit, hit ? hit[0] : '');
}

console.log('  ' + '─'.repeat(78));
console.log(fail ? `  \x1b[31m${fail} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exit(fail ? 1 : 0);

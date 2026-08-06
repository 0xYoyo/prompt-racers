// Validates the whole quiz bank. Run: node .tmp/quizbank-check.mjs
// Checks structure, uniqueness, answer-position spread and — the one that
// actually matters for an 8–15 year old reading at speed — text length.
import { QUESTIONS, TOPICS, bankStats, tiersForDifficulty, questionsForDifficulty }
  from '../src/race/quizdata.js';

const MAX_Q = 80;      // question characters — one glance at 60 km/h
const MAX_A = 72;      // one answer line
const MAX_WHY = 195;   // the post-answer explanation

const errs = [], warns = [];
const seen = new Set();

for (const q of QUESTIONS) {
  const at = m => errs.push(`${q.id || '(no id)'}: ${m}`);
  if (!q.id || typeof q.id !== 'string') at('missing id');
  if (seen.has(q.id)) at('duplicate id'); else seen.add(q.id);
  if (![1, 2, 3].includes(q.tier)) at(`bad tier ${q.tier}`);
  if (!TOPICS.includes(q.topic)) at(`unknown topic ${q.topic}`);
  if (![0, 1, 2].includes(q.correct)) at(`bad correct index ${q.correct}`);

  for (const lang of ['he', 'en']) {
    const s = q[lang];
    if (!s) { at(`missing ${lang}`); continue; }
    if (!s.q?.trim()) at(`${lang}: empty question`);
    if (!Array.isArray(s.a) || s.a.length !== 3) at(`${lang}: needs exactly 3 options, got ${s.a?.length}`);
    else {
      if (new Set(s.a.map(x => x.trim())).size !== 3) at(`${lang}: duplicate option text`);
      s.a.forEach((o, i) => {
        if (!o?.trim()) at(`${lang}: option ${i} empty`);
        if (o.length > MAX_A) warns.push(`${q.id} ${lang}: option ${i} ${o.length} chars (>${MAX_A})`);
      });
    }
    if (!s.why?.trim()) at(`${lang}: missing explanation`);
    if (s.q && s.q.length > MAX_Q) errs.push(`${q.id} ${lang}: question ${s.q.length} chars (>${MAX_Q}) — too long to read mid-race`);
    if (s.why && s.why.length > MAX_WHY) warns.push(`${q.id} ${lang}: explanation ${s.why.length} chars (>${MAX_WHY})`);
  }
  // Hebrew must not address a single gender.
  const bad = /\b(אתה|את\s|תכתוב|תבחר|תנסה|תשאל|כתוב\b|בחר\b|נסה\b|שאל\b|תזכור)/;
  if (q.he?.q && bad.test(q.he.q)) warns.push(`${q.id}: he question may use gendered/imperative form`);
  if (q.he?.why && bad.test(q.he.why)) warns.push(`${q.id}: he explanation may use gendered/imperative form`);
  for (const o of q.he?.a || []) if (bad.test(o)) warns.push(`${q.id}: he option may use gendered/imperative form: "${o}"`);
}

// Answer position must not be predictable.
const spread = [0, 0, 0];
for (const q of QUESTIONS) spread[q.correct]++;
const maxShare = Math.max(...spread) / QUESTIONS.length;
if (maxShare > 0.5) errs.push(`correct index skewed: ${spread.join('/')}`);

// Each race must have enough material for its laps.
for (const d of [1, 2, 3]) {
  const n = questionsForDifficulty(d).length;
  if (n < 8) errs.push(`difficulty ${d} (tiers ${tiersForDifficulty(d)}) has only ${n} questions`);
}

const st = bankStats();
console.log(`\n  QUIZ BANK — ${st.total} questions`);
console.log('  tiers  ', Object.entries(st.byTier).map(([k, v]) => `t${k}:${v}`).join('  '));
console.log('  topics ', Object.entries(st.byTopic).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('  correct index spread  ', spread.join(' / '));
for (const d of [1, 2, 3]) console.log(`  race ${d} draws tiers ${tiersForDifficulty(d).join('+')} → ${questionsForDifficulty(d).length} questions`);
const longest = [...QUESTIONS].sort((a, b) => b.he.q.length - a.he.q.length)[0];
console.log(`  longest he question   ${longest.he.q.length} chars — "${longest.he.q}"`);

if (warns.length) { console.log('\n  WARNINGS'); for (const w of warns) console.log('   ! ' + w); }
if (errs.length) { console.log('\n  ERRORS'); for (const e of errs) console.log('   ✗ ' + e); process.exit(1); }
console.log('\n  ✓ bank is valid\n');

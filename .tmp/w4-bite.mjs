// Proof that tests/badges.test.mjs bites. Breaks the real module one way at a
// time, runs the gate, restores from the .tmp copy (never from git).
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';

const SRC = 'src/core/badges.js', BAK = '.tmp/w4-badges-backup.js';

const breaks = [
  ['drop the English name of one badge',
    s => s.replace("    'badge.quiz-40.name': 'Super Brain',\n", '')],
  ['stop skipping already-unlocked badges (double count)',
    s => s.replace('    if (badges.includes(b.id)) continue;', '    if (false) continue;')],
  ['let a new championship wipe the collection',
    s => s.replace("on('championship:reset', () => { s.champRaces = 0; s.champPodiums = 0; persist(); });",
      "on('championship:reset', () => { s.champRaces = 0; s.champPodiums = 0; save.set({ badges: [], glossary: [] }); persist(); });")],
  ['put the quiz ladder out of reach (40 -> 400)',
    s => s.replace('test: s => s.quizCorrect >= 40,\n    progress: s => [s.quizCorrect, 40]',
      'test: s => s.quizCorrect >= 400,\n    progress: s => [s.quizCorrect, 400]')],
  ['make a HARD badge trivially easy (prompt-max 90 -> 40)',
    s => s.replace('test: s => s.bestPromptScore >= 90', 'test: s => s.bestPromptScore >= 40')],
  ['forget the topic to glossary link',
    s => s.replace('if (p.topic) s.topicsAnswered[p.topic] = (s.topicsAnswered[p.topic] || 0) + 1;', '')],
  ['let a quiz TIMEOUT count as a correct answer',
    s => s.replace("on('quiz:timeout', () => { s.quizAnswered++; dirty = true; });",
      "on('quiz:timeout', p => { s.quizAnswered++; s.quizCorrect++; bump(); });")],
  ['stop announcing unlocks on the bus',
    s => s.replace('bus.emit(UNLOCK_EVENT, { id, group: badgeById(id)?.group || null });', '')],
  ['make an icon an emoji instead of vector art',
    s => s.replace('export const ICONS = {', "export const ICONS = {\n  _bad: '\\u{1F3C6}',")],
];

const orig = readFileSync(BAK, 'utf8');
for (const [name, fn] of breaks) {
  const broken = fn(orig);
  if (broken === orig) { console.log(`  ?? BREAK DID NOT APPLY: ${name}`); continue; }
  writeFileSync(SRC, broken);
  let out = '', code = 0;
  try { out = execSync('node tests/badges.test.mjs', { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || ''; code = e.status; }
  const fails = out.split('\n').filter(l => l.includes('✗')).map(l => l.replace(/\[[0-9;]*m/g, '').trim());
  console.log(`\n  BREAK: ${name}`);
  console.log(`    exit ${code} - ${fails.length} assertion(s) bit`);
  for (const f of fails.slice(0, 4)) console.log(`      ${f}`);
  copyFileSync(BAK, SRC);
}
copyFileSync(BAK, SRC);
console.log('\n  restored src/core/badges.js from the .tmp copy');

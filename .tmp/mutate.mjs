// Bite-check driver (Wave 4, quiz pointer/intro gate).
//
//   node .tmp/mutate.mjs <name>
//
// Applies ONE deliberate break to src/race/quiz.js, builds it, stashes the built
// page as .tmp/mutant-<name>.html, then restores quiz.js FROM .tmp/quiz.good.js
// (never from git — five agents share this tree) and rebuilds the clean dist.
// The gate is then run against the stashed page, so a mutant build is never left
// sitting in dist/ where another agent's gate could pick it up.
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';

const root = '/Users/yoyopc/repos/kart-project';
const SRC = `${root}/src/race/quiz.js`;
const GOOD = `${root}/.tmp/quiz.good.js`;

const MUTANTS = {
  // 9: the pointer forks off into its own implementation and answers a
  // different slot — the classic drift this section exists to catch.
  'ptr-drift': [["onclick: () => answer(k, 'pointer')", "onclick: () => answer((k + 1) % 3, 'pointer')"]],
  // 9: the pointer skips the modal registry, the exact bug the Wave-3 note
  // records ("geometry, not policy").
  'ptr-guard': [["  function answer(slot, via = 'code') {\n", "  function answer(slot, via = 'code') {\n    if (via === 'pointer') { if (phase === 'question' && shown.answered == null) { shown.answered = slot; finishQuestion(false); } return true; }\n"]],
  // 9: touch targets shrink back to key-sized rows.
  'ptr-size': [['min-block-size:clamp(48px,6.2vh,62px);', 'min-block-size:0;']],
  // 9: the arming delay goes back to living in the KEY handler only, so a fast
  // double-click blinks the explanation away.
  'ptr-arm': [['    if (phaseT <= DISMISS_AFTER_S) return false;\n', '']],
  // 11: the explainer stops deferring and burns its flag behind another panel.
  'intro-defer': [
    ['export const shouldShowFirstQuizPopup = () => !save.read(QUIZ_INTRO_FLAG) && !modalOpen();',
      'export const shouldShowFirstQuizPopup = () => !save.read(QUIZ_INTRO_FLAG);'],
    ['    if (modalOpen(\'quiz\')) return;\n    // First box this child has ever met', '    // First box this child has ever met'],
  ],
  // 11: it is no longer one-time.
  'intro-again': [['  if (o.persist !== false) markFirstQuizPopupSeen();', '  if (false) markFirstQuizPopupSeen();']],
  // 11: it shows, but the world keeps running behind it.
  'intro-freeze': [["    phase = 'intro';\n    phaseT = 0;", '    phaseT = 0;']],
};

const name = process.argv[2];
const edits = MUTANTS[name];
if (!edits) { console.error('unknown mutant:', name, '\nknown:', Object.keys(MUTANTS).join(', ')); process.exit(2); }

copyFileSync(SRC, GOOD);
let src = readFileSync(SRC, 'utf8');
for (const [find, repl] of edits) {
  if (!src.includes(find)) { console.error('MUTATION DID NOT APPLY:', JSON.stringify(find.slice(0, 60))); process.exit(2); }
  src = src.replace(find, repl);
}
writeFileSync(SRC, src);
try {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
  copyFileSync(`${root}/dist/index.html`, `${root}/.tmp/mutant-${name}.html`);
} finally {
  copyFileSync(GOOD, SRC);                 // restore from .tmp, never from git
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}
console.log(`\nmutant page: .tmp/mutant-${name}.html  (dist/ is clean again)`);

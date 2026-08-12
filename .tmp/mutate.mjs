// Bite-check driver (Wave 4, quiz pointer/intro gate).
//
//   node .tmp/mutate.mjs <name>
//
// Applies ONE deliberate break to src/race/quiz.js and builds THAT tree into
// .tmp/mutant-<name>.html — a private copy of tools/build.mjs's output, so
// dist/ is never touched and no other agent's gate can pick up a mutant page.
// quiz.js is restored from .tmp/quiz.good.js (a copy taken one line earlier),
// never from git: five agents share this tree.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';

const root = '/Users/yoyopc/repos/kart-project';
const SRC = `${root}/src/race/quiz.js`;
const GOOD = `${root}/.tmp/quiz.good.js`;

const MUTANTS = {
  // §9: the pointer forks into its own implementation and drifts — it answers a
  // different option than the key it is labelled with.
  'ptr-drift': [["onclick: () => answer(k, 'pointer')", "onclick: () => answer((k + 1) % 3, 'pointer')"]],
  // §9: the pointer skips the modal registry, the exact Wave-3 bug ("geometry,
  // not policy") that the click-behind-the-pause-menu check exists for.
  'ptr-guard': [["  function answer(slot, via = 'code') {\n", "  function answer(slot, via = 'code') {\n    if (via === 'pointer') { if (phase === 'question' && shown.answered == null) { shown.answered = slot; finishQuestion(false); } return true; }\n"]],
  // §9: touch targets shrink back to key-sized rows.
  'ptr-size': [['min-block-size:clamp(48px,6.2vh,62px);', 'min-block-size:0;']],
  // §9: the arming delay goes back to living in the KEY handler only, so a fast
  // double-click blinks the explanation away before it is read.
  'ptr-arm': [['    if (phaseT <= DISMISS_AFTER_S) return false;\n', '']],
  // §9: the celebration flash keeps style.js's `.on` class — the real bug this
  // section found: an invisible full-screen sheet over the panel that only a
  // pointer can notice.
  'ptr-flash': [["      elFlash.classList.remove('fx'); void elFlash.offsetWidth; elFlash.classList.add('fx');",
    "      elFlash.classList.remove('on'); void elFlash.offsetWidth; elFlash.classList.add('on');"],
    ['.quiz-flash.fx{animation:quizFlash .55s var(--ease) both}', '.quiz-flash.on{animation:quizFlash .55s var(--ease) both}']],
  // §10: the explainer stops deferring, and burns its one-time flag behind
  // another panel.
  'intro-defer': [
    ['export const shouldShowFirstQuizPopup = () => !save.read(QUIZ_INTRO_FLAG) && !modalOpen();',
      'export const shouldShowFirstQuizPopup = () => !save.read(QUIZ_INTRO_FLAG);'],
    ["    if (modalOpen('quiz')) return;\n    // First box this child has ever met", '    // First box this child has ever met'],
  ],
  // §10: it is no longer one-time.
  'intro-again': [['  if (o.persist !== false) markFirstQuizPopupSeen();', '  if (false) markFirstQuizPopupSeen();']],
  // §10: it shows, but the world keeps running behind it.
  'intro-freeze': [["    phase = 'intro';\n    phaseT = 0;", '    phaseT = 0;']],
};

const name = process.argv[2];
const edits = MUTANTS[name];
if (!edits) { console.error('unknown mutant:', name, '\nknown:', Object.keys(MUTANTS).join(', ')); process.exit(2); }

copyFileSync(SRC, GOOD);
let src = readFileSync(SRC, 'utf8');
for (const [find, repl] of edits) {
  if (!src.includes(find)) { console.error('MUTATION DID NOT APPLY:', JSON.stringify(find.slice(0, 70))); process.exit(2); }
  src = src.replace(find, repl);
}
writeFileSync(SRC, src);
try {
  const r = await esbuild.build({
    entryPoints: [`${root}/src/main.js`], bundle: true, format: 'iife',
    alias: { three: `${root}/vendor/three.module.js` },
    minify: true, target: ['chrome100'], legalComments: 'none', write: false, logLevel: 'warning',
  });
  const html = readFileSync(`${root}/dist/index.html`, 'utf8');
  // Reuse the real shell, swap only the script body, so the mutant page differs
  // from dist/ in exactly one module.
  const head = html.slice(0, html.indexOf('<script>') + 8);
  const tail = html.slice(html.lastIndexOf('</script>'));
  writeFileSync(`${root}/.tmp/mutant-${name}.html`, head + r.outputFiles[0].text + tail);
} finally {
  copyFileSync(GOOD, SRC);                 // restore from .tmp, never from git
}
console.log(`mutant page: .tmp/mutant-${name}.html  (dist/ untouched)`);

// Bite-check driver for tests/introcard.test.mjs. Uniquely named: an earlier
// .tmp/mutate.mjs was overwritten by another agent's harness.
// Restores ONLY from .tmp copies (never git; D25) and leaves dist/ clean.
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
const RACE = 'src/race/race.js', CARD = 'src/race/introcard.js';
const CLEAN = { [RACE]: '.tmp/clean-race.js', [CARD]: '.tmp/clean-introcard.js' };
const restore = () => { for (const [f, c] of Object.entries(CLEAN)) copyFileSync(c, f); };
const MUTANTS = {
  freeze: [[RACE, `const scale = S.phase === 'intro' ? 0`, `const scale = S.phase === 'intro' ? 1`],
           [RACE, `    if (S.phase === 'intro') return;\n    S.clock += dt;`, `    S.clock += dt;`]],
  repeat: [[CARD, `    if (e.repeat) { e.preventDefault(); return; }`, `    if (false) { return; }`]],
  name:   [[CARD, `    name: trackName(def, lang || getLang()),`, `    name: 'נווה הנתונים',`]],
  optout: [[CARD, `  if (typeof opts.introCard === 'boolean') return opts.introCard;`, `  return true;`]],
  click:  [[CARD, `{ onclick: () => skip('pointer') }`, `{ onclick: () => {} }`]],
  push:   [[CARD, `  const release = pushModal('intro');`, `  const release = () => {};`]],
  pop:    [[CARD, `    release();                                   // popModal('intro')`, `    // leaked`]],
  accent: [[CARD, `.ic-circuit{--ic-accent:#6fe8ff}`, `.ic-circuit{--ic-accent:#ffc247}`]],
};
const which = process.argv[2];
restore();
for (const [file, from, to] of MUTANTS[which]) {
  const s = readFileSync(file, 'utf8');
  if (!s.includes(from)) { console.error(`MUTATION TARGET MISSING in ${file}`); process.exit(2); }
  writeFileSync(file, s.replace(from, to));
}
try {
  execSync('npm run build', { stdio: 'inherit' });
  copyFileSync('dist/index.html', `.tmp/mutant-${which}.html`);
} finally { restore(); execSync('npm run build', { stdio: 'inherit' }); }
console.log(`mutant ready: .tmp/mutant-${which}.html`);

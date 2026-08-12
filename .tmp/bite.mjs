// Bite-proof harness: reintroduce each bug into src/kart/kartphysics.js, run the
// new gate, and restore FROM THE .tmp COPY (never from git). Own-file only.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SRC = 'src/kart/kartphysics.js';
const BAK = '.tmp/kp-fixed-driftboost.js';
const good = readFileSync(BAK, 'utf8');

const FIXED_RELEASE = `    const released = this.drifting ? this.driftTier : 0;
    if (released > 0) {
      const t = DRIFT_TIERS[released - 1];
      this.applyBoost(t.strength, t.duration, t.impulse, 'drift', released);
    }`;
const BUGGY_RELEASE = `    if (this.drifting && this.driftTier > 0) {
      const t = DRIFT_TIERS[this.driftTier - 1];
      this.applyBoost(t.strength, t.duration, t.impulse);
    }`;

const FIXED_SEQ = `    this.boostSeq++;
    this.lastBoostSource = source === 'drift' ? 'drift' : 'external';`;

const bugs = {
  'A: tier zeroed before anyone can read it (the historical bug)':
    s => s.replace(FIXED_RELEASE, BUGGY_RELEASE),
  'B: no provenance — every boost claims to be a drift':
    s => s.replace(`this.lastBoostSource = source === 'drift' ? 'drift' : 'external';`,
                   `this.lastBoostSource = 'drift';`)
         .replace(`this.lastBoostTier = source === 'drift' ? (tier | 0) : 0;`,
                  `this.lastBoostTier = tier | 0;`),
  'C: boostSeq only advances on the rising edge of `boosting`':
    s => s.replace(`    this.boosting = true;`, `    const _wasBoosting = this.boosting;\n    this.boosting = true;`)
         .replace(`    this.boostSeq++;`, `    if (!_wasBoosting) this.boostSeq++;`),
};

for (const [name, mutate] of Object.entries(bugs)) {
  const broken = mutate(good);
  if (broken === good) { console.log(`\n### ${name}\n  !! MUTATION DID NOT APPLY`); continue; }
  writeFileSync(SRC, broken);
  let out = '';
  try { out = execSync('node tests/driftboost.test.mjs', { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  finally { writeFileSync(SRC, good); }   // restore from the .tmp copy, immediately
  const red = out.split('\n').filter(l => l.includes('✗'));
  console.log(`\n### ${name}\n  ${red.length} assertion(s) went RED:`);
  for (const l of red.slice(0, 8)) console.log('   ' + l.replace(/\x1b\[[0-9;]*m/g, '').trim());
  if (red.length > 8) console.log(`   ... and ${red.length - 8} more`);
}
writeFileSync(SRC, good);
console.log('\nrestored src/kart/kartphysics.js from ' + BAK);

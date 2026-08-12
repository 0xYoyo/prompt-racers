// Round-2 proof that tests/badges.test.mjs bites. Each break is the REAL bug it
// is meant to catch. Restores from the .tmp copies, never from git.
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';

const F = {
  badges: ['src/core/badges.js', '.tmp/w4-badges-backup.js'],
  collection: ['src/ui/collection.js', '.tmp/w4-collection-backup.js'],
  test: ['tests/badges.test.mjs', '.tmp/w4-test-backup.mjs'],
};

const breaks = [
  ['badges', 'ROUND-1 BUG: read the tier straight off the payload',
    s => s.replace('const released = Math.max(tier, driftPeak);', 'const released = tier;')],
  ['badges', 'ROUND-1 BUG: count every boost as a drift (quiz turbos included)',
    s => s.replace(/const isDrift = source === 'drift' \? true[\s\S]*?: \(tier >= 1 \|\| \(driftPeak >= 1 && !driftingNow\)\);/,
      'const isDrift = true;')],
  ['badges', 'drop the drift:tier peak tracking',
    s => s.replace('if (tier > driftPeak) driftPeak = tier;', '')],
  ['badges', 'put the toast into the modal registry',
    s => s.replace('const el = document.createElement(\'div\');\n  el.className',
      'pushModal(\'badge\');\n  const el = document.createElement(\'div\');\n  el.className')],
  ['badges', 'mount the toast on engine.ui instead of document.body',
    s => s.replace('document.body.appendChild(host);', 'const engine = window.__engine; engine.ui.appendChild(host);')],
  ['badges', 'let the toast grab Escape',
    s => s.replace('const kill = () => {', "addEventListener('keydown', e => { if (e.key === 'Escape') kill(); });\n  const kill = () => {")],
  ['badges', 'let the toast steal focus',
    s => s.replace('host.appendChild(el);', 'host.appendChild(el); el.focus();')],
  ['badges', 'make the toast layer clickable',
    s => s.replace('#pr-badge-toasts *{pointer-events:none}', '#pr-badge-toasts *{pointer-events:auto}')],
  ['collection', 'a stray backtick in a CSS comment (the real bug from this round)',
    s => s.replace('The .more class is toggled by JS when', 'The `.more` class is toggled by JS when')],
  ['test', 'the economy constant is renamed in its owning module (simulated)',
    s => s.replace('/const REWARD_TOKENS = \\{([^}]*)\\}/', '/const REWARD_TOKENS_RENAMED = \\{([^}]*)\\}/')],
  ['test', 'the pickup thinning factor is retuned (simulated)',
    s => s.replace('TOKEN_KEEP === 0.42', 'TOKEN_KEEP === 0.99')],
];

for (const [which, name, fn] of breaks) {
  const [src, bak] = F[which];
  const orig = readFileSync(bak, 'utf8');
  const broken = fn(orig);
  if (broken === orig) { console.log(`  ?? BREAK DID NOT APPLY: ${name}`); continue; }
  writeFileSync(src, broken);
  let out = '', code = 0;
  try { out = execSync('node tests/badges.test.mjs', { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || ''; code = e.status; }
  const fails = out.split('\n').filter(l => l.includes('✗')).map(l => l.replace(/\[[0-9;]*m/g, '').trim());
  console.log(`\n  BREAK (${which}): ${name}`);
  console.log(`    exit ${code} - ${fails.length} assertion(s) bit`);
  for (const f of fails.slice(0, 3)) console.log(`      ${f.slice(0, 118)}`);
  copyFileSync(bak, src);
}
for (const [src, bak] of Object.values(F)) copyFileSync(bak, src);
console.log('\n  all three files restored from their .tmp copies');

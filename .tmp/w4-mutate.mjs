// Mutation harness for tools/hometest.mjs. Applies a named batch of deliberate
// breakages to src/ui/menus.js, builds, stashes the built file under .tmp/, and
// restores the source FROM .tmp/menus.js.w4-home-baseline (never from git).
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
const SRC = 'src/ui/menus.js';
const BASE = '.tmp/menus.js.w4-home-baseline';
const batch = process.argv[2];
const MUT = {
  A: [
    // 1. the two icons crawl back into the centre column
    [`h('button.btn.ghost', { onclick: () => api.go('collection') }, t('menu.collection')));`,
     `h('button.btn.ghost', { onclick: () => api.go('collection') }, t('menu.collection')),
        h('button.btn.ghost', { onclick: () => settingsOverlay({ engine }) }, t('menu.settings')));`],
    // 2. the keycaps group inherits the document direction again (RTL mirrors it)
    [`.mn-caps{display:inline-flex;align-items:center;gap:6px;direction:ltr;unicode-bidi:isolate}`,
     `.mn-caps{display:inline-flex;align-items:center;gap:6px}`],
    // 3. the championship reset takes the collection with it
    [`    championshipAsked: [],`, `    championshipAsked: [],\n    badges: [], glossary: [], stats: {},`],
  ],
  B: [
    // 4. the icon loses its visible/accessible label text
    [`    iconSVG(kind), h('span.mn-iconlab', null, label));`, `    iconSVG(kind));`],
    // 5. drift goes back to two bare caps, no slash
    [`keyHint(['Shift', '/', 'Space'], 'menu.key.drift'),`, `keyHint(['Space', 'Shift'], 'menu.key.drift'),`],
    // 6. the slider stops persisting
    [`    save.set({ volume: v });\n    applyVolume(v);`, `    applyVolume(v);`],
  ],
  C: [
    // 7. "new championship" erases without asking
    [`      const startNew = () => confirmNewChampionship(() => api.go('select', { fresh: true }));`,
     `      const startNew = () => { resetChampionship(); api.go('select', { fresh: true }); };`],
    // 8. the full wipe erases without asking
    [`            onclick: () => confirmDialog({`, `            onclick: () => (save.reset(), bus.emit('save:reset'), doneMsg = true, build(), 0) || confirmDialog({`],
  ],
};
if (batch === 'restore') { copyFileSync(BASE, SRC); execSync('npm run build', { stdio: 'inherit' }); process.exit(0); }
let s = readFileSync(BASE, 'utf8');
for (const [from, to] of MUT[batch]) {
  if (!s.includes(from)) { console.error('MUTATION TARGET NOT FOUND:\n' + from); process.exit(2); }
  s = s.replace(from, to);
}
writeFileSync(SRC, s);
execSync('npm run build', { stdio: 'inherit' });
copyFileSync('dist/index.html', `.tmp/w4-mut${batch}.html`);
copyFileSync(BASE, SRC);
execSync('npm run build', { stdio: 'inherit' });
console.log(`mutant built at .tmp/w4-mut${batch}.html; source restored from ${BASE}`);

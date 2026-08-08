import * as P from '../../src/garage/prompts.js';
console.log('MIN_COMPLETE_COST', P.MIN_COMPLETE_COST, 'MAX_COST', P.MAX_COST, 'BUDGET', P.DEFAULT_BUDGET, 'PART_COST', P.PART_COST);
for (const part of P.KART_SLOTS) {
  console.log('\n════════ ' + part.toUpperCase() + ' (' + P.partName(part,'he') + ')');
  for (const row of ['goal','constraint','style']) {
    const opts = P.optionsFor(row, part);
    console.log(' -- row ' + row);
    for (const o of opts) console.log(`   [${o.specificity}] ${String(o.cost).padStart(2)}t  ${o.id.padEnd(18)} HE:"${o.he}"  SUB:"${o.subHe}"  FRAG:"${o.sentenceFragmentHe}"`);
  }
}

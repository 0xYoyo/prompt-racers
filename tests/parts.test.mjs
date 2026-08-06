// Proves the garage's core promise: a better prompt makes a measurably faster kart.
// This guards the exact bug that shipped silently once already — three subsystems
// naming the same four slots differently, so upgrades resolved to tier 0.
import { toPhysicsParts, toVisualParts } from '../src/race/race.js';
import { applyPartStats } from '../src/kart/kartphysics.js';

let fail = 0;
const ok = (name, cond, detail='') => { if(!cond) fail++;
  console.log(`  ${cond?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${name.padEnd(52)} ${detail?'\x1b[2m'+detail+'\x1b[0m':''}`); };

console.log('\n  GARAGE PARTS → PHYSICS\n  ' + '─'.repeat(72));

// Every form a save could plausibly hold must resolve to the same tier.
for (const [label, v] of [['numeric 3', 3], ['name "pro"', 'pro'], ['object {tier:3}', {tier:3}],
                          ['object {visualTier:"pro"}', {visualTier:'pro'}]]) {
  const p = toPhysicsParts({ engine: v });
  ok(`engine ${label} → physics tier 3`, p.engine === 3, `got ${p.engine}`);
}
ok('missing slot → tier 0', toPhysicsParts({}).engine === 0);
ok('junk name → tier 0, not NaN', toPhysicsParts({engine:'???'}).engine === 0);

// Slot vocabulary translation
const phys = toPhysicsParts({ engine:3, tires:3, chassis:3, wing:3 });
ok('tires → tyres', phys.tyres === 3, JSON.stringify(phys));
ok('chassis → frame', phys.frame === 3);
ok('wing → turbo', phys.turbo === 3);

const vis = toVisualParts({ engine:2, tires:1, wing:3, chassis:0 });
ok('visual slots keep garage names', vis.engine===2 && vis.tires===1 && vis.wing===3 && vis.chassis===0, JSON.stringify(vis));
ok('exhaust follows engine', vis.exhaust === 2);

console.log('\n  STAT IMPACT (base = mid-range racer)\n  ' + '─'.repeat(72));
const base = { speed:3, accel:3, handling:3, weight:3 };
const stock = applyPartStats(base, toPhysicsParts({}));
const maxed = applyPartStats(base, toPhysicsParts({ engine:3, tires:3, chassis:3, wing:3 }));
const rows = [['topSpeed'],['accel'],['grip'],['stability'],['boost'],['driftRate']];
for (const [k] of rows) {
  const a = stock.mods[k], b = maxed.mods[k];
  console.log(`    ${k.padEnd(12)} stock ${a.toFixed(3)}  →  maxed ${b.toFixed(3)}   ${((b/a-1)*100).toFixed(1)}%`);
}
ok('maxed parts raise top speed', maxed.mods.topSpeed > stock.mods.topSpeed * 1.02);
ok('maxed parts raise acceleration', maxed.mods.accel > stock.mods.accel * 1.10);
ok('maxed parts raise grip', maxed.mods.grip > stock.mods.grip * 1.05);
ok('maxed parts raise drift rate', maxed.mods.driftRate > stock.mods.driftRate * 1.10);

// A good prompt vs a vague one must be distinguishable, not just non-zero.
const vague = applyPartStats(base, toPhysicsParts({ engine:0 }));
const sharp = applyPartStats(base, toPhysicsParts({ engine:3 }));
ok('vague vs specific prompt differ in physics',
   sharp.mods.topSpeed > vague.mods.topSpeed && sharp.mods.accel > vague.mods.accel,
   `${vague.mods.accel.toFixed(3)} → ${sharp.mods.accel.toFixed(3)}`);

console.log('  ' + '─'.repeat(72));
console.log(fail ? `  \x1b[31m${fail} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exit(fail ? 1 : 0);

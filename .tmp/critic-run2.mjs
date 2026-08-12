// Fine pace sweep: is the 100% -> 85% transition a slope or a cliff?
import { race, RACES, f, mean } from './critic-bal.mjs';
const SEEDS = [2, 7, 23, 64];
const PACES = [1.00, 0.97, 0.94, 0.91, 0.88, 0.85, 0.80];
console.log('pace   ' + RACES.map(R => `race${R.n}`.padStart(10)).join(''));
for (const p of PACES) {
  const cells = RACES.map(R => {
    const runs = SEEDS.map(s => race({ track: R.track, difficulty: R.difficulty, pace: p, seed: s }));
    return f(mean(runs.map(r => r.pos)), 2).padStart(10);
  });
  console.log(f(p, 2).padEnd(7) + cells.join(''));
}

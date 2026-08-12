// Fresh seeds, headline reproduction.
import { race, RACES, f, mean } from './critic-bal.mjs';
const SEEDS = [2, 7, 23, 64, 88, 101];   // deliberately NOT 3/11/19/41/57
console.log('seeds', SEEDS.join(' '));
for (const pace of [1.00, 0.85, 0.70]) {
  for (const R of RACES) {
    const runs = SEEDS.map(seed => race({ track: R.track, difficulty: R.difficulty, pace, seed }));
    const p = runs.map(r => r.pos);
    console.log(`pace ${f(pace * 100, 0)}%  race ${R.n} ${R.track} d${R.difficulty}:  places ${p.join(' ')}  mean ${f(mean(p), 2)}` +
      `  lapsBehind ${runs.map(r => f(r.lapsBehind)).join(' ')}` +
      `  worstLonely ${f(Math.max(...runs.map(r => r.lonely)))}  meanNear ${f(mean(runs.map(r => r.meanNear)))}` +
      `  gapS ${f(mean(runs.map(r => r.gapS)), 1)}`);
  }
}

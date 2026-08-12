// Style variants: is the balance an artefact of the centreline autopilot?
import { race, RACES, f, mean } from './critic-bal.mjs';
const SEEDS = [2, 7, 23, 64];
for (const style of ['ref', 'nodrift', 'wide', 'twitchy']) {
  for (const R of RACES) {
    const runs = SEEDS.map(seed => race({ track: R.track, difficulty: R.difficulty, pace: 1.0, seed, style }));
    console.log(`${style.padEnd(8)} race ${R.n} ${R.track.padEnd(8)}  places ${runs.map(r => r.pos).join(' ')}  mean ${f(mean(runs.map(r => r.pos)), 2)}` +
      `  lapsBehind ${f(mean(runs.map(r => r.lapsBehind)))}  off% ${f(mean(runs.map(r => r.offPct)), 1)}  raceTime ${f(mean(runs.map(r => r.time)), 1)}`);
  }
}

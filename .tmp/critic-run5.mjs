// QUIZ AXIS: is "a couple of correct quiz boosts wins race 1" now true?
// Applies the REAL quiz BOOST constant from src/race/quiz.js (strength 1.3,
// duration 2.4, impulse 6) N times per race at evenly spaced beacon-ish points.
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { createAIField } from '../src/kart/ai.js';
const DT = 1 / 60;
const BOOST = { strength: 1.3, duration: 2.4, impulse: 6 };  // quiz.js line 224

function run({ track, difficulty, seed, nBoost, laps = 3 }) {
  const { def, spline } = getTrack(track);
  const slots = gridSlots(spline, def, 8);
  const racer = ROSTER[0];
  const surface = def?.theme === 'cloud' ? 'cloud' : def?.theme === 'circuit' ? 'grass' : 'sand';
  const player = new KartBody({ spline, stats: racer.stats, startSlot: slots[0], surface });
  const field = createAIField(spline, def, null, { difficulty, playerRacerId: racer.id, slots, playerSlot: 0, seed });
  const toLine = ((def.startT - player.lapT) + 1) % 1, finishAt = toLine + laps;
  const finish = new Array(8).fill(null);
  // 6 beacons across the race, as quiz.js places them; fire the first nBoost.
  const at = [];
  for (let i = 0; i < 6; i++) at.push(toLine + (i + 0.62) / 6 * laps);
  const fired = new Array(6).fill(false);
  let t = 0, prevT = player.lapT, pProg = 0;
  while (t < 900 && finish.some(x => x == null)) {
    player.update(DT, autopilotInput(player, spline, { drift: true }));
    pProg += TrackSpline.deltaT(player.lapT, prevT); prevT = player.lapT;
    for (let i = 0; i < nBoost; i++) {
      if (!fired[i] && pProg >= at[i]) { fired[i] = true; player.applyBoost(BOOST.strength, BOOST.duration, BOOST.impulse); }
    }
    field.update(DT, { body: player, progress: pProg });
    t += DT;
    const prog = [pProg, ...field.drivers.map(d => d.progress)];
    for (let i = 0; i < 8; i++) if (finish[i] == null && prog[i] >= finishAt) finish[i] = t;
  }
  const times = finish.map(x => x ?? 999), sorted = [...times].sort((a, b) => a - b);
  return { place: sorted.indexOf(times[0]) + 1, behind: times[0] - sorted[0] };
}
const SEEDS = [2, 7, 23, 64, 88, 101];
const RACES = [[1, 'oasis', 1], [2, 'circuit', 2], [3, 'cloud', 3]];
for (const [n, track, difficulty] of RACES) {
  for (const nBoost of [0, 2, 4, 6]) {
    const rs = SEEDS.map(s => run({ track, difficulty, seed: s, nBoost }));
    const m = rs.reduce((a, b) => a + b.place, 0) / rs.length;
    const wins = rs.filter(r => r.place === 1).length;
    console.log(`race ${n} ${track.padEnd(8)} ${nBoost} correct answers -> places ${rs.map(r => r.place).join('')}  mean ${m.toFixed(2)}  wins ${wins}/${rs.length}  behindWinner ${(rs.reduce((a, b) => a + b.behind, 0) / rs.length).toFixed(2)}s`);
  }
}

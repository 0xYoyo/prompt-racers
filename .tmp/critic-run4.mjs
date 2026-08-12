// How compressed is the field? Finishing-time spread and where the player sits.
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { createAIField } from '../src/kart/ai.js';
const DT = 1 / 60;
const f = (n, d = 2) => n.toFixed(d);

function run({ track, difficulty, pace, seed, laps = 3 }) {
  const { def, spline } = getTrack(track);
  const slots = gridSlots(spline, def, 8);
  const racer = ROSTER[0];
  const surface = def?.theme === 'cloud' ? 'cloud' : def?.theme === 'circuit' ? 'grass' : 'sand';
  const player = new KartBody({ spline, stats: racer.stats, startSlot: slots[0], surface });
  player.p.topSpeed *= pace; player.p.accelPower *= pace;
  const field = createAIField(spline, def, null, { difficulty, playerRacerId: racer.id, slots, playerSlot: 0, seed });
  const toLine = ((def.startT - player.lapT) + 1) % 1, finishAt = toLine + laps;
  const finish = new Array(8).fill(null);
  let t = 0, prevT = player.lapT, pProg = 0;
  while (t < 900 && finish.some(x => x == null)) {
    player.update(DT, autopilotInput(player, spline, { drift: true }));
    pProg += TrackSpline.deltaT(player.lapT, prevT); prevT = player.lapT;
    field.update(DT, { body: player, progress: pProg });
    t += DT;
    const prog = [pProg, ...field.drivers.map(d => d.progress)];
    for (let i = 0; i < 8; i++) if (finish[i] == null && prog[i] >= finishAt) finish[i] = t;
  }
  const times = finish.map(x => x ?? 999);
  const sorted = [...times].sort((a, b) => a - b);
  const mine = times[0];
  const place = sorted.indexOf(mine) + 1;
  return { place, spread: sorted[7] - sorted[0], behindWinner: mine - sorted[0],
           gapAhead: place > 1 ? mine - sorted[place - 2] : 0,
           gapBehind: place < 8 ? sorted[place] - mine : 0 };
}
const RACES = [[1, 'oasis', 1], [2, 'circuit', 2], [3, 'cloud', 3]];
for (const pace of [1.00, 0.90, 0.85]) {
  for (const [n, track, difficulty] of RACES) {
    const rs = [2, 7, 23, 64].map(s => run({ track, difficulty, pace, seed: s }));
    const avg = k => rs.reduce((a, b) => a + b[k], 0) / rs.length;
    console.log(`pace ${f(pace, 2)} race ${n} ${track.padEnd(8)}  place ${rs.map(r => r.place).join('')}  ` +
      `behindWinner ${f(avg('behindWinner'), 1)}s  fieldSpread ${f(avg('spread'), 1)}s  ` +
      `gapToKartAhead ${f(avg('gapAhead'), 2)}s  gapToKartBehind ${f(avg('gapBehind'), 2)}s`);
  }
}

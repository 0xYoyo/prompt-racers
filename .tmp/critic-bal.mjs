// CRITIC harness — independent re-measurement of the Wave-4 AI rebalance.
// Read-only w.r.t. src/. Fresh seeds, plus player-style variants.
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { createAIField } from '../src/kart/ai.js';

const DT = 1 / 60;
const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : 'inf');
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

// Player styles. `style` mutates the autopilot input to model a child who is
// not the centreline reference driver.
const STYLES = {
  ref: (b, sp) => autopilotInput(b, sp, { drift: true }),
  nodrift: (b, sp) => autopilotInput(b, sp, { drift: false }),
  // late/lazy turn-in: long lookahead -> chords corners, runs wide on exit
  wide: (b, sp) => autopilotInput(b, sp, { drift: true, look: 24 }),
  // twitchy: short lookahead -> slalom, scrubs speed
  twitchy: (b, sp) => autopilotInput(b, sp, { drift: true, look: 9 }),
};

export function race({ track, difficulty, pace = 1, seed, laps = 3, parts = null,
                       style = 'ref', maxTime = 900 }) {
  const { def, spline } = getTrack(track);
  const slots = gridSlots(spline, def, 8);
  const racer = ROSTER[0];
  const surface = def?.theme === 'cloud' ? 'cloud' : def?.theme === 'circuit' ? 'grass' : 'sand';
  const player = new KartBody({ spline, stats: racer.stats, startSlot: slots[0], surface, parts: parts || undefined });
  player.p.topSpeed *= pace;
  player.p.accelPower *= pace;
  const field = createAIField(spline, def, null, {
    difficulty, playerRacerId: racer.id, slots, playerSlot: 0, seed,
  });
  const drive = STYLES[style];
  const toLine = ((def.startT - player.lapT) + 1) % 1;
  const finishAt = toLine + laps;
  const finish = new Array(field.drivers.length + 1).fill(null);
  let t = 0, prevT = player.lapT, pProg = 0, lapsBehind = null;
  let worstLonely = 0, sumNear = 0, nSamp = 0, offT = 0;
  while (t < maxTime && finish.some(x => x == null)) {
    player.update(DT, drive(player, spline));
    pProg += TrackSpline.deltaT(player.lapT, prevT);
    prevT = player.lapT;
    field.update(DT, { body: player, progress: pProg });
    t += DT;
    if (player.offTrack) offT += DT;
    let near = 1e9;
    for (const d of field.drivers) near = Math.min(near, Math.abs(d.progress - pProg));
    if (near > worstLonely) worstLonely = near;
    sumNear += near; nSamp++;
    const prog = [pProg, ...field.drivers.map(d => d.progress)];
    for (let i = 0; i < prog.length; i++) {
      if (finish[i] == null && prog[i] >= finishAt) {
        finish[i] = t;
        if (lapsBehind == null) lapsBehind = finishAt - pProg;
      }
    }
  }
  const order = finish.map((v, i) => [v == null ? Infinity : v, i]).sort((a, b) => a[0] - b[0]);
  const tel = field.telemetry();
  const out = {
    pos: order.findIndex(o => o[1] === 0) + 1,
    lapsBehind: lapsBehind ?? 0,
    gapS: (finish[0] ?? Infinity) - order[0][0],
    lonely: worstLonely, meanNear: sumNear / nSamp,
    bandMin: tel.bandMin, bandMax: tel.bandMax,
    offPct: 100 * offT / t, time: t,
  };
  field.dispose();
  return out;
}

export const RACES = [
  { n: 1, track: 'oasis', difficulty: 1 },
  { n: 2, track: 'circuit', difficulty: 2 },
  { n: 3, track: 'cloud', difficulty: 3 },
];
export { f, mean };

// Wave-4 balance measurement harness (scratch; not a gate).
// Headless 3-lap races, same methodology as tests/ai.test.mjs and the GAPS.md
// Wave-1 table: real KartBody player driven by the game's own autopilotInput,
// topSpeed + accelPower scaled by `pace`, real createAIField opponents.
//
//   node .tmp/w4-aibal.mjs sweep            d01 sweep x track at 100% pace
//   node .tmp/w4-aibal.mjs table            pace x race table (current mapping)
//   node .tmp/w4-aibal.mjs parts            garage-upgrade axis
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { createAIField } from '../src/kart/ai.js';

const DT = 1 / 60;
const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : 'inf');
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

export function race({ track, difficulty, pace = 1, seed = 3, laps = 3, parts = null, maxTime = 900 }) {
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

  const toLine = ((def.startT - player.lapT) + 1) % 1;
  const finishAt = toLine + laps;
  const finish = new Array(field.drivers.length + 1).fill(null);
  let t = 0, prevT = player.lapT, pProg = 0, lapsBehind = null, worstLonely = 0;

  while (t < maxTime && finish.some(x => x == null)) {
    player.update(DT, autopilotInput(player, spline, { drift: true }));
    pProg += TrackSpline.deltaT(player.lapT, prevT);
    prevT = player.lapT;
    field.update(DT, { body: player, progress: pProg });
    t += DT;
    let near = 1e9;
    for (const d of field.drivers) near = Math.min(near, Math.abs(d.progress - pProg));
    if (near > worstLonely) worstLonely = near;
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
  field.dispose();
  return {
    pos: order.findIndex(o => o[1] === 0) + 1,
    lapsBehind: lapsBehind ?? 0,
    playerTime: finish[0] ?? Infinity,
    winTime: order[0][0],
    gapS: (finish[0] ?? Infinity) - order[0][0],
    bandMin: tel.bandMin, bandMax: tel.bandMax, lonely: worstLonely, time: t,
  };
}

const TRACKS = ['oasis', 'circuit', 'cloud'];
const SEEDS = [3, 11, 19, 41, 57];
const mode = process.argv[2] || 'table';

if (mode === 'sweep') {
  const d01s = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const paces = (process.argv[3] || '1.0').split(',').map(Number);
  for (const pace of paces) {
    console.log(`\n== mean finishing place (of 8), autopilot player at ${f(pace * 100, 0)}% pace, seeds ${SEEDS.join(',')} ==`);
    console.log(pad('track', 10) + d01s.map(d => padL('d01=' + d, 14)).join(''));
    for (const tr of TRACKS) {
      const row = d01s.map(d => {
        const runs = SEEDS.map(s => race({ track: tr, difficulty: d, pace, seed: s }));
        return padL(`${f(mean(runs.map(r => r.pos)), 1)} (${f(mean(runs.map(r => r.gapS)), 1)}s)`, 14);
      });
      console.log(pad(tr, 10) + row.join(''));
    }
  }
}

if (mode === 'table') {
  const RACES = [
    { n: 1, track: 'oasis', difficulty: 1 },
    { n: 2, track: 'circuit', difficulty: 2 },
    { n: 3, track: 'cloud', difficulty: 3 },
  ];
  console.log('\npace | ' + RACES.map(R => padL(`race ${R.n} (${R.track} d${R.difficulty})`, 34)).join(''));
  for (const pace of [1.0, 0.85, 0.7]) {
    const cells = RACES.map(R => {
      const runs = SEEDS.map(s => race({ track: R.track, difficulty: R.difficulty, pace, seed: s }));
      const p = runs.map(r => r.pos);
      return padL(`${Math.min(...p)}-${Math.max(...p)} (mean ${f(mean(p), 1)}) lb ${f(Math.max(...runs.map(r => r.lapsBehind)))}`, 34);
    });
    console.log(padL(f(pace * 100, 0) + '%', 4) + ' | ' + cells.join(''));
  }
}

if (mode === 'parts') {
  const RACES = [
    { n: 1, track: 'oasis', difficulty: 1 },
    { n: 2, track: 'circuit', difficulty: 2 },
    { n: 3, track: 'cloud', difficulty: 3 },
  ];
  const sets = [
    ['stock', null],
    ['t1 all', { engine: 1, tyres: 1, frame: 1, turbo: 1 }],
    ['t2 all', { engine: 2, tyres: 2, frame: 2, turbo: 2 }],
    ['t3 all', { engine: 3, tyres: 3, frame: 3, turbo: 3 }],
  ];
  const pace = Number(process.argv[3] || 1.0);
  console.log(`\n== garage axis: mean place / mean gap to winner, autopilot at ${f(pace * 100, 0)}% ==`);
  console.log(pad('parts', 10) + RACES.map(R => padL(`race ${R.n}`, 20)).join(''));
  for (const [name, parts] of sets) {
    const row = RACES.map(R => {
      const runs = SEEDS.map(s => race({ track: R.track, difficulty: R.difficulty, pace, seed: s, parts }));
      return padL(`${f(mean(runs.map(r => r.pos)), 1)}  (${f(mean(runs.map(r => r.gapS)), 1)}s)`, 20);
    });
    console.log(pad(name, 10) + row.join(''));
  }
}

// Headless 3-lap race telemetry for src/kart/ai.js.
//   node .tmp/aitest.mjs            full report
//   node .tmp/aitest.mjs quick      one track only
import * as THREE from 'three';
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { AIDriver, createAIField, racingLine, difficulty01 } from '../src/kart/ai.js';

const DT = 1 / 60;
const TRACKS = ['oasis', 'circuit', 'cloud'];
const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : 'NaN');
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

function race({ track = 'oasis', difficulty = 1, playerPace = 1.0, seed = 7, laps = 3, maxTime = 400, band = true }) {
  const { def, spline } = getTrack(track);
  const slots = gridSlots(spline, def, 8);
  const player = ROSTER[0];
  const pbody = new KartBody({ spline, stats: player.stats, startSlot: slots[0], surface: 'sand' });

  // The "scripted player": the same AI brain with a hard pace override, no
  // rubber band, no personality quirks. playerPace is a fraction of the AI's
  // own difficulty-1 base pace, so 1.00 == "as good as a race-1 opponent".
  // 100% == PLAYER_REF == a good, clean 12-year-old: holds the racing line,
  // drifts most corners, does not crash. It is an ABSOLUTE anchor (a fraction
  // of the AI's own flat-out ceiling), deliberately NOT tied to the difficulty
  // base pace — otherwise "100% of AI pace" moves with the thing it measures
  // and the sweep can never say anything.
  const PLAYER_REF = 0.86;
  const basePace = PLAYER_REF;
  const pdrv = new AIDriver({
    body: pbody, spline, racer: player, seed: 99, personality: 'balanced',
    pace: basePace * playerPace, rubberBand: false,
  });

  const field = createAIField(spline, def, null, {
    difficulty, playerRacerId: player.id, slots, playerSlot: 0, seed, rubberBand: band,
  });

  // Race distance in lap fractions from the grid: roll up to the line, then N laps.
  const toLine = ((def.startT - pbody.lapT) + 1) % 1;
  const finishAt = toLine + laps;

  const ent = [
    { name: 'YOU', id: 'player', personality: 'player', drv: pdrv, body: pbody, isPlayer: true },
    ...field.drivers.map(d => ({ name: d.racer.nameEn, id: d.racer.id, personality: d.personality, drv: d, body: d.body, isPlayer: false })),
  ];
  for (const e of ent) { e.finish = null; e.lapTimes = []; e.lastLap = 0; e.crossed = 0; e.nan = false; e.stuck = 0; e.maxOff = 0; e.offTime = 0; }

  let t = 0, aiCost = 0, aiFrames = 0;
  while (t < maxTime && ent.some(e => !e.finish)) {
    const c0 = process.hrtime.bigint();
    const pi = pdrv.update(DT, { karts: field.karts });
    pbody.update(DT, pi);
    field.update(DT, pbody);
    const c1 = process.hrtime.bigint();
    aiCost += Number(c1 - c0) / 1e6; aiFrames++;
    t += DT;

    for (const e of ent) {
      const p = e.isPlayer ? (pdrv.progress) : e.drv.progress;
      if (!Number.isFinite(p) || !Number.isFinite(e.body.position.x) || !Number.isFinite(e.body.speed)) e.nan = true;
      if (e.body.speed < 3) e.stuck += DT; else e.stuck = 0;
      if (e.stuck > e.maxStuck || !e.maxStuck) e.maxStuck = e.stuck;
      if (e.body.offTrack) e.offTime += DT;
      const over = Math.abs(e.body.lateral) - spline.widthAt(e.body.lapT);
      if (over > e.maxOff) e.maxOff = over;
      // lap 0 is the roll from the grid to the line and is not a lap time.
      const crossings = p < toLine ? 0 : 1 + Math.floor(p - toLine);
      if (crossings > e.crossed) {
        if (e.crossed >= 1) e.lapTimes.push(t - e.lastLap);
        e.crossed = crossings; e.lastLap = t;
      }
      if (!e.finish && p >= finishAt) e.finish = t;
    }
  }
  for (const e of ent) if (!e.finish) e.finish = Infinity;
  ent.sort((a, b) => a.finish - b.finish);
  ent.forEach((e, i) => { e.pos = i + 1; });
  const tel = field.telemetry();
  for (const e of ent) {
    const d = tel.drivers.find(x => x.id === e.id);
    if (d) Object.assign(e, { cornerEntry: d.cornerEntry, driftTime: d.driftTime, driftBoosts: d.driftBoosts,
      overtakes: d.overtakes, mistakes: d.mistakes, band: d.band, offTrackTime: d.offTrackTime, blockTime: d.blockTime });
  }
  return { ent, tel, time: t, aiMs: aiCost / Math.max(aiFrames, 1), track, difficulty, playerPace,
    lapLen: spline.length, spread: ent[ent.length - 1].finish - ent[0].finish,
    playerPos: ent.find(e => e.isPlayer).pos };
}

// ---------------------------------------------------------------------------
const quick = process.argv.includes('quick');
const tracks = quick ? ['oasis'] : TRACKS;

console.log('\n=== 1. RACING LINE ===');
for (const id of tracks) {
  const { spline } = getTrack(id);
  const L = racingLine(spline);
  let maxOff = 0, sum = 0, minR = 9999;
  for (let i = 0; i < L.N; i++) { maxOff = Math.max(maxOff, Math.abs(L.off[i])); sum += Math.abs(L.off[i]); minR = Math.min(minR, L.radius[i]); }
  console.log(`${pad(id, 9)} len=${padL(f(spline.length, 0), 5)}m nodes=${L.N} maxOffset=${f(maxOff)}m meanOffset=${f(sum / L.N)}m minRadius=${f(minR, 1)}m`);
}

console.log('\n=== 2. FULL 3-LAP RACES (difficulty 1, player at 100% pace) ===');
const races = {};
for (const id of tracks) {
  const r = race({ track: id, difficulty: 1, playerPace: 1.0 });
  races[id] = r;
  console.log(`\n--- ${id}  (lap ~${f(r.ent[0].lapTimes[1] || 0, 1)}s) ---`);
  console.log(pad('pos', 4) + pad('racer', 10) + pad('persona', 12) + padL('finish', 8) + padL('gap', 8) +
    padL('laps', 6) + padL('best', 7) + padL('lapSD', 7) + padL('entry', 7) + padL('drift%', 8) +
    padL('boosts', 8) + padL('ovtk', 6) + padL('miss', 6) + padL('off%', 7) + padL('maxOff', 8) + '  ok');
  const t0 = r.ent[0].finish;
  for (const e of r.ent) {
    const best = Math.min(...e.lapTimes.filter(Boolean));
    const mean = e.lapTimes.reduce((a, b) => a + b, 0) / (e.lapTimes.length || 1);
    const sd = Math.sqrt(e.lapTimes.reduce((a, b) => a + (b - mean) ** 2, 0) / (e.lapTimes.length || 1));
    const ok = !e.nan && e.lapTimes.length >= 3 && e.finish < Infinity && e.maxOff < 6;
    console.log(pad(e.pos, 4) + pad(e.name, 10) + pad(e.personality, 12) + padL(f(e.finish, 2), 8) +
      padL('+' + f(e.finish - t0, 2), 8) + padL(e.lapTimes.length, 6) + padL(f(best, 2), 7) + padL(f(sd, 2), 7) +
      padL(f(e.cornerEntry ?? 0, 1), 7) + padL(f(100 * (e.driftTime || 0) / e.finish, 1), 8) +
      padL(e.driftBoosts ?? '-', 8) + padL(e.overtakes ?? '-', 6) + padL(e.mistakes ?? '-', 6) +
      padL(f(100 * e.offTime / e.finish, 1), 7) + padL(f(e.maxOff, 2), 8) + '  ' + (ok ? 'OK' : 'FAIL'));
  }
  console.log(`spread 1st->8th: ${f(r.spread, 2)}s   band max ${f(r.tel.bandMax, 3)} min ${f(r.tel.bandMin, 3)}   AI cost ${f(r.aiMs, 3)}ms/frame (7 karts)`);
}

console.log('\n=== 3. FAIRNESS SWEEP (player finishing position) ===');
console.log(pad('track', 9) + pad('diff', 6) + ['70%', '85%', '100%', '110%'].map(s => padL(s, 8)).join('') + '   (gap to winner)');
for (const id of tracks) {
  for (const d of [1, 2, 3]) {
    const cells = [];
    for (const pp of [0.70, 0.85, 1.00, 1.10]) {
      const r = race({ track: id, difficulty: d, playerPace: pp, seed: 11 });
      const p = r.ent.find(e => e.isPlayer);
      const gap = p.finish - r.ent[0].finish;
      cells.push(padL(`${p.pos}${gap > 0.01 ? '(+' + f(gap, 1) + ')' : '(win)'}`, 8));
    }
    console.log(pad(id, 9) + pad(d, 6) + cells.join(''));
  }
}

console.log('\n=== 3b. RELIABILITY: 100% player at difficulty 1, 6 seeds per track ===');
for (const id of tracks) {
  const pos = [];
  for (const sd of [3, 11, 19, 41, 57, 73]) pos.push(race({ track: id, difficulty: 1, playerPace: 1.0, seed: sd }).playerPos);
  const wins = pos.filter(p => p === 1).length;
  console.log(`${pad(id, 9)} finishes: ${pos.join(' ')}   wins ${wins}/6   podium ${pos.filter(p => p <= 3).length}/6`);
}
for (const id of tracks) {
  const pos = [];
  for (const sd of [3, 11, 19, 41, 57, 73]) pos.push(race({ track: id, difficulty: 1, playerPace: 0.85, seed: sd }).playerPos);
  console.log(`${pad(id, 9)} 85% player at difficulty 1: ${pos.join(' ')}  (mean ${f(pos.reduce((a, b) => a + b, 0) / pos.length, 1)})`);
}

console.log('\n=== 4. RUBBER BAND BOUNDS ===');
{
  const bounds = [];
  for (const id of tracks) for (const d of [1, 2, 3]) for (const pp of [0.7, 1.0, 1.1]) {
    const r = race({ track: id, difficulty: d, playerPace: pp, seed: 23 });
    bounds.push([r.tel.bandMax, r.tel.bandMin]);
  }
  const hi = Math.max(...bounds.map(b => b[0])), lo = Math.min(...bounds.map(b => b[1]));
  console.log(`observed band range over ${bounds.length} races: ${f(lo, 4)} .. ${f(hi, 4)}`);
  console.log(`declared bound: catch <= +7.5%, hold >= -17.0%  => ${(hi <= 1.0751 && lo >= 0.8299) ? 'WITHIN BOUND' : 'OUT OF BOUND'}`);
  const off = race({ track: tracks[0], difficulty: 1, playerPace: 1.0, seed: 23, band: false });
  const on = races[tracks[0]];
  console.log(`band off: spread ${f(off.spread, 2)}s / winner ${f(off.ent[0].finish, 2)}s   band on: spread ${f(on.spread, 2)}s / winner ${f(on.ent[0].finish, 2)}s`);
}

console.log('\n=== 5. PERSONALITY DIFFERENTIATION (mean over all tracks, difficulty 2) ===');
{
  const agg = {};
  for (const id of tracks) {
    const r = race({ track: id, difficulty: 2, playerPace: 1.0, seed: 31 });
    for (const e of r.ent) {
      if (e.isPlayer) continue;
      const a = agg[e.personality] || (agg[e.personality] = { n: 0, entry: 0, drift: 0, ovtk: 0, miss: 0, sd: 0, block: 0, off: 0 });
      const mean = e.lapTimes.reduce((x, y) => x + y, 0) / (e.lapTimes.length || 1);
      a.n++; a.entry += e.cornerEntry || 0; a.drift += 100 * (e.driftTime || 0) / e.finish;
      a.ovtk += e.overtakes || 0; a.miss += e.mistakes || 0; a.block += e.blockTime || 0;
      a.off += 100 * e.offTime / e.finish;
      a.sd += Math.sqrt(e.lapTimes.reduce((x, y) => x + (y - mean) ** 2, 0) / (e.lapTimes.length || 1));
    }
  }
  console.log(pad('persona', 12) + padL('cornerEntry', 13) + padL('drift%', 8) + padL('overtakes', 11) +
    padL('mistakes', 10) + padL('lapSD', 8) + padL('blockSec', 10) + padL('off%', 7));
  for (const [k, a] of Object.entries(agg)) {
    console.log(pad(k, 12) + padL(f(a.entry / a.n, 2), 13) + padL(f(a.drift / a.n, 1), 8) +
      padL(f(a.ovtk / a.n, 1), 11) + padL(f(a.miss / a.n, 1), 10) + padL(f(a.sd / a.n, 3), 8) +
      padL(f(a.block / a.n, 1), 10) + padL(f(a.off / a.n, 1), 7));
  }
}

console.log('\n=== 6. PERFORMANCE ===');
{
  const r = races[tracks[0]] || race({ track: 'oasis' });
  console.log(`AI update (7 drivers + physics + collisions): ${f(r.aiMs, 3)} ms/frame = ${f(100 * r.aiMs / 16.6, 1)}% of a 16.6ms budget`);
  // isolate the decision cost from the physics cost
  const { def, spline } = getTrack(tracks[0]);
  const field = createAIField(spline, def, null, { difficulty: 2, playerRacerId: 'nitzotz', seed: 3 });
  for (let i = 0; i < 600; i++) field.update(DT, null);
  let ms = 0;
  for (let i = 0; i < 2000; i++) {
    const a = process.hrtime.bigint();
    for (const d of field.drivers) d.update(DT, { karts: field.karts });
    ms += Number(process.hrtime.bigint() - a) / 1e6;
  }
  console.log(`decision logic alone, 7 drivers: ${f(ms / 2000, 4)} ms/frame`);
  const t0 = Date.now(); racingLine(getTrack('cloud').spline);
  console.log(`racing-line solve (cached after first call): ${Date.now() - t0}ms for a cold track`);
}
console.log('');

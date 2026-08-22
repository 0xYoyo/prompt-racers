// tools/kartpace.mjs — MEASUREMENT tool (not a gate).
//
//   node tools/kartpace.mjs                    full 8 racers x 3 tracks table
//   node tools/kartpace.mjs --track=cloud      one track
//   node tools/kartpace.mjs --racer=kaftor     one racer
//   node tools/kartpace.mjs --laps=20          flying laps per cell (default 20)
//   node tools/kartpace.mjs --warmup=2         laps discarded first (default 2)
//   node tools/kartpace.mjs --slots=0,3,7      repeat each cell from these grid
//                                              slots (noise-floor probe)
//   node tools/kartpace.mjs --json             machine-readable output
//
// WHAT IT MEASURES
// ----------------
// Each ROSTER kart's CLEAN AUTOPILOT FLAT-OUT pace: the game's own
// `autopilotInput(body, spline, {drift:true})` driving a real KartBody, alone,
// at a fixed DT of 1/60, from the standing grid, on the real spline — no AI
// field, no traffic, no tokens, no quiz boosts, stock parts. This is exactly the
// reference-driver methodology `tests/ai.test.mjs`'s race() uses for the player,
// with the field and the pace knob removed.
//
// The first WARMUP laps out of the grid are discarded (default 2). One is the
// standing start; the second is measured-not-assumed — on all three tracks the
// first flying lap still runs 0.1-0.4 s slow while the kart settles onto its
// steady line, and only from lap 3 does the sequence enter its limit cycle. The
// reported figures are over the `laps` flying laps that follow.
//
// METHODOLOGY NOTES
// -----------------
//  * Lap boundaries are taken on accumulated track progress (TrackSpline.deltaT,
//    the same accumulator race.js and ai.test.mjs use), with LINEAR SUB-FRAME
//    INTERPOLATION at the crossing, so a lap time is not quantised to 16.7 ms.
//  * NOISE FLOOR. There is no randomness anywhere on this path: KartBody and
//    autopilotInput contain no Math.random and no rng (verified by grep), and
//    the tool passes no seed. Every number here is BIT-REPRODUCIBLE — rerunning
//    gives identical digits. The only real variation is lap-to-lap, from the
//    state the kart carries across the line, and `--slots` re-runs each cell
//    from a different grid slot to bound how much of the figure is an artefact
//    of where the kart started. Both spreads are printed as `sd` and `range`.
//    The autopilot is a deterministic controller on a closed loop, so after the
//    warmup each cell settles into a LIMIT CYCLE: `oasis` and `circuit` repeat a
//    3-4 lap pattern to the millisecond (sd ~0.1-0.2%), `cloud` wanders inside a
//    +/-0.4 s band (sd ~0.55%) and never repeats exactly. Averaging the default
//    20 flying laps puts the standard error of every cell's mean at <= 0.13% of
//    a lap. MEASURED, not asserted: the default run (1 slot x 20 laps) and a
//    6x heavier one (`--slots=0,3,7 --laps=40`) agree on every one of the 24
//    PACE RATIOS to within 0.0015. So the noise floor ON THE NUMBER THAT
//    MATTERS is about +-0.15%, against real kart differences of 2-10% and a
//    +-5% clamp. Nothing here is close to swamped.
//  * SANITY CHECK. DECISIONS.md / GAPS.md record autopilot lap time on `cloud`
//    for the reference kart (ROSTER[0], nitzotz) at part tier 0 as 48.07 s. This
//    harness reproduces that to within a few hundredths on the mean flying lap;
//    the check is printed at the bottom of the default run.
//
// WHAT THE TABLE IS FOR
// ---------------------
// The AI field is calibrated against ONE kart (nitzotz). A kart that laps faster
// than nitzotz is buying finishing places. `paceRatio` below is the number the
// field's pace should be scaled by to cancel that:
//
//     paceRatio(kart, track) = lap(nitzotz, track) / lap(kart, track)
//
// so a kart FASTER than the reference (shorter lap) has ratio > 1, and the field
// must be sped up by that factor. See recommendedField() and the block printed
// under RECOMMENDED CONSTANTS.
//
// A gate can import the numbers rather than re-deriving them:
//
//     import { measureCell, measureAll, PACE_REF } from '../tools/kartpace.mjs';
//
// tests/ai.test.mjs section 8 does exactly that: it re-measures all 24 cells at
// `laps: 3, warmup: 2` (~0.4 s for the whole grid) and asserts the shipped
// KART_PACE table against the result — sign per cell, magnitude within 0.010 on
// the unclamped cells, and which three cells the clamp bites. Measured, the
// 3-flying-lap grid agrees with the default 20-lap grid to within 0.0083 on
// every ratio (worst cell kaftor/cloud, the only track whose limit cycle never
// repeats), which is what makes the short version usable inside a gate. So
// `measureCell`, `paceRatios`, `PACE_REF` and `TRACK_IDS` are a GATE SURFACE
// now: changing their names or return shapes breaks tests/ai.test.mjs.

import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';

export const DT = 1 / 60;
export const TRACK_IDS = ['oasis', 'circuit', 'cloud'];
/** The kart the AI field is calibrated against. */
export const PACE_REF = 'nitzotz';
/** How far the recommended correction is allowed to move the field. */
export const PACE_CLAMP = 0.05;

const surfaceFor = def => (def?.theme === 'cloud' ? 'cloud' : def?.theme === 'circuit' ? 'grass' : 'sand');

/**
 * One cell: one racer, one track, `laps` flying laps after a discarded out-lap.
 * @returns {{racer,track,laps:number[],best,mean,sd,range}}
 */
export function measureCell({ racer, track, laps = 20, warmup = 2, slot = 0, maxTime = 4000 }) {
  const { def, spline } = getTrack(track);
  const slots = gridSlots(spline, def, 8);
  const r = typeof racer === 'string' ? ROSTER.find(x => x.id === racer) : racer;
  if (!r) throw new Error('unknown racer: ' + racer);

  const body = new KartBody({
    spline, stats: r.stats, startSlot: slots[slot], surface: surfaceFor(def),
  });

  // Progress is measured from the START LINE, so the out-lap ends where every
  // later lap ends. `toLine` is the fraction of a lap between the grid slot and
  // the line; crossing 1 lap of progress past it closes the out-lap.
  const toLine = ((def.startT - body.lapT) + 1) % 1;
  const nMarks = laps + warmup;             // warmup laps + `laps` flying laps
  const total = toLine + nMarks;

  let t = 0, prev = body.lapT, prog = 0, next = toLine, prevProg = 0;
  const marks = [];
  while (t < maxTime && marks.length < nMarks + 1) {
    body.update(DT, autopilotInput(body, spline, { drift: true }));
    prevProg = prog;
    prog += TrackSpline.deltaT(body.lapT, prev);
    prev = body.lapT;
    t += DT;
    while (marks.length < nMarks + 1 && prog >= next) {
      // Linear sub-frame interpolation across the step that crossed the line.
      const d = prog - prevProg;
      const frac = d > 1e-12 ? (next - prevProg) / d : 0;
      marks.push(t - DT + frac * DT);
      next += 1;
    }
    if (prog >= total) break;
  }
  if (marks.length < nMarks + 1) throw new Error(`${r.id}/${track}: only ${marks.length - 1} laps in ${maxTime}s`);

  const lapTimes = [];
  for (let i = warmup + 1; i < marks.length; i++) lapTimes.push(marks[i] - marks[i - 1]);
  const mean = lapTimes.reduce((a, b) => a + b, 0) / lapTimes.length;
  const sd = Math.sqrt(lapTimes.reduce((a, b) => a + (b - mean) ** 2, 0) / lapTimes.length);
  return {
    racer: r.id, track, slot, warmup, laps: lapTimes,
    best: Math.min(...lapTimes), mean, sd,
    range: Math.max(...lapTimes) - Math.min(...lapTimes),
  };
}

/**
 * The full grid of cells. `slots` > 1 entry averages each cell over several
 * starting grid slots (a perturbation probe, not a seed — nothing is random).
 */
export function measureAll({ racers = ROSTER.map(r => r.id), tracks = TRACK_IDS, laps = 20, warmup = 2, slots = [0] } = {}) {
  const cells = {};
  for (const track of tracks) {
    for (const id of racers) {
      const runs = slots.map(slot => measureCell({ racer: id, track, laps, warmup, slot }));
      const mean = runs.reduce((a, c) => a + c.mean, 0) / runs.length;
      cells[`${id}|${track}`] = {
        racer: id, track, runs, mean,
        best: Math.min(...runs.map(c => c.best)),
        sd: Math.max(...runs.map(c => c.sd)),
        slotSpread: Math.max(...runs.map(c => c.mean)) - Math.min(...runs.map(c => c.mean)),
      };
    }
  }
  return cells;
}

/** lap(ref) / lap(kart): > 1 means this kart is FASTER than the reference. */
export function paceRatios(cells, tracks = TRACK_IDS, racers = ROSTER.map(r => r.id)) {
  const out = {};
  for (const track of tracks) {
    const ref = cells[`${PACE_REF}|${track}`];
    if (!ref) continue;
    for (const id of racers) {
      const c = cells[`${id}|${track}`];
      if (c) out[`${id}|${track}`] = ref.mean / c.mean;
    }
  }
  return out;
}

/**
 * The constant the lead pastes next to TRACK_PACE.
 *
 * PER-KART-PER-TRACK is what this returns, and the measurement says it has to
 * be: the per-track spread of a kart's ratio reaches 0.104 (zamzum: 1.004 on
 * `oasis`, 0.900 on `circuit`), i.e. twenty times the +-0.0015 noise floor and
 * twice the whole +-5% clamp. A single number per kart would be wrong by up to
 * 5 points on one of the three races. `perKart` is returned alongside for
 * reference only.
 *
 *   fieldPace = AI_PACE * TRACK_PACE[track] * kartPace(racerId, track)
 */
export function recommendedField(ratios, tracks = TRACK_IDS, racers = ROSTER.map(r => r.id)) {
  const clamp = v => Math.min(1 + PACE_CLAMP, Math.max(1 - PACE_CLAMP, v));
  const out = {};
  for (const id of racers) {
    const rs = tracks.map(tr => ratios[`${id}|${tr}`]).filter(Number.isFinite);
    if (!rs.length) continue;
    const m = rs.reduce((a, b) => a + b, 0) / rs.length;
    const perTrack = {};
    for (const tr of tracks) {
      const v = ratios[`${id}|${tr}`];
      if (Number.isFinite(v)) perTrack[tr] = { raw: v, clamped: clamp(v) };
    }
    out[id] = {
      raw: m, clamped: clamp(m), perTrack,
      spread: Math.max(...rs) - Math.min(...rs),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && process.argv[1].endsWith('kartpace.mjs');
if (isMain) {
  const arg = k => {
    const a = process.argv.find(x => x.startsWith(`--${k}=`));
    return a ? a.slice(k.length + 3) : null;
  };
  const tracks = arg('track') ? arg('track').split(',') : TRACK_IDS;
  const racers = arg('racer') ? arg('racer').split(',') : ROSTER.map(r => r.id);
  const laps = Number(arg('laps') || 20);
  const warmup = Number(arg('warmup') || 2);
  const slots = (arg('slots') || '0').split(',').map(Number);
  const json = process.argv.includes('--json');

  const cells = measureAll({ racers, tracks, laps, warmup, slots });
  const ratios = paceRatios(cells, tracks, racers);
  const rec = recommendedField(ratios, tracks, racers);

  if (json) {
    console.log(JSON.stringify({ cells, ratios, rec }, null, 2));
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    const padL = (s, n) => String(s).padStart(n);
    const st = id => { const r = ROSTER.find(x => x.id === id).stats; return `${r.speed}/${r.accel}/${r.handling}/${r.weight}`; };

    console.log(`\nCLEAN AUTOPILOT FLAT-OUT PACE — ${laps} flying laps after ${warmup} discarded, `
      + `grid slot(s) ${slots.join(',')}, DT=1/60, stock parts, no traffic.\n`);
    console.log(pad('racer', 10) + pad('s/a/h/w', 10)
      + tracks.map(t => padL(t + ' mean', 13) + padL('best', 8) + padL('sd', 8)).join(''));
    console.log('-'.repeat(20 + tracks.length * 29));
    for (const id of racers) {
      let line = pad(id, 10) + pad(st(id), 10);
      for (const tr of tracks) {
        const c = cells[`${id}|${tr}`];
        line += padL(c.mean.toFixed(3), 13) + padL(c.best.toFixed(3), 8) + padL(c.sd.toFixed(3), 8);
      }
      console.log(line);
    }

    console.log(`\nPACE RATIO  = lap(${PACE_REF}) / lap(kart).  > 1.000 = FASTER than the reference.\n`);
    console.log(pad('racer', 10) + tracks.map(t => padL(t, 11)).join('') + padL('mean', 11) + padL('spread', 10));
    console.log('-'.repeat(10 + tracks.length * 11 + 21));
    for (const id of racers) {
      const rs = tracks.map(tr => ratios[`${id}|${tr}`]);
      console.log(pad(id, 10) + rs.map(v => padL(v.toFixed(4), 11)).join('')
        + padL(rec[id].raw.toFixed(4), 11) + padL(rec[id].spread.toFixed(4), 10));
    }

    console.log('\nRECOMMENDED CONSTANTS — paste next to TRACK_PACE in src/kart/ai.js:\n');
    console.log('// Per-kart field correction. The AI field is calibrated against ROSTER[0]');
    console.log('// (nitzotz, stats 3/4/4/3); any other kart laps at a different clean');
    console.log('// flat-out pace and would otherwise buy or cost finishing places.');
    console.log(`//   KART_PACE[id][track] = lap(nitzotz, track) / lap(id, track), clamped to +/-${(PACE_CLAMP * 100).toFixed(0)}%.`);
    console.log('// > 1 means the kart is FASTER than the reference, so the field speeds UP.');
    console.log('//   fieldPace = AI_PACE * TRACK_PACE[track] * (KART_PACE[racerId]?.[track] ?? 1)');
    console.log('// Per-track is required, not cosmetic: see the spread column above.');
    console.log('const KART_PACE = {');
    for (const id of racers) {
      const v = rec[id];
      const body = tracks.map(tr => `${tr}: ${v.perTrack[tr].clamped.toFixed(3)}`).join(', ');
      const cl = tracks.filter(tr => Math.abs(v.perTrack[tr].raw - v.perTrack[tr].clamped) > 1e-6)
        .map(tr => `${tr} ${v.perTrack[tr].raw.toFixed(3)}`);
      const note = cl.length ? `   // clamped from ${cl.join(', ')}` : '';
      console.log(`  ${pad(id + ':', 9)} { ${body} },${note}`);
    }
    console.log('};');

    // Sanity check against the figure recorded in DECISIONS.md / GAPS.md.
    const ref = cells[`${PACE_REF}|cloud`];
    if (ref) {
      const d = ref.mean - 48.07;
      console.log(`\nSANITY: ${PACE_REF} on cloud, tier 0 — DECISIONS.md/GAPS.md record 48.07 s; `
        + `this harness measures ${ref.mean.toFixed(3)} s mean / ${ref.best.toFixed(3)} s best `
        + `(${d >= 0 ? '+' : ''}${d.toFixed(3)} s, ${(100 * d / 48.07).toFixed(2)}%).`);
    }
    const worstSd = Math.max(...Object.values(cells).map(c => 100 * c.sd / c.mean));
    const worstSlot = Math.max(...Object.values(cells).map(c => 100 * c.slotSpread / c.mean));
    console.log(`NOISE FLOOR: worst per-cell lap-to-lap sd ${worstSd.toFixed(3)}% of a lap; `
      + `worst grid-slot spread ${worstSlot.toFixed(3)}%. Nothing on this path is random — `
      + `every figure is bit-reproducible.\n`);
  }
}

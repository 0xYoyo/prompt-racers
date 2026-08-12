// Guards BOOST PROVENANCE (Wave 4).
//
// The bug this exists to prevent: `_releaseDrift()` applied the boost and zeroed
// `driftTier` in the same call, so every observer of the boost read tier 0. On top
// of that, `boosting` alone cannot tell a drift release from a quiz turbo, and it
// has no rising edge for a boost that lands while a previous one is still running,
// so chained corners counted as nothing.
//
// Everything below DRIVES THE REAL PHYSICS on the real oasis spline. No hand-made
// payloads: the previous badge gate was green precisely because it invented a
// {tier:3} event that no code path in the game could ever produce.
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput, DRIFT_TIERS } from '../src/kart/kartphysics.js';

const DT = 1 / 60;
const { def, spline } = getTrack('oasis');
const slots = gridSlots(spline, def, 8);
const PLAYER = { speed: 3, accel: 4, handling: 4, weight: 3 };

let fail = 0;
const ok = (n, c, d = '') => {
  if (!c) fail++;
  console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n.padEnd(60)} ${d ? '\x1b[2m' + d + '\x1b[0m' : ''}`);
};
const f2 = n => (Math.round(n * 100) / 100).toFixed(2);

const mk = () => new KartBody({ spline, stats: PLAYER, startSlot: slots[0] });

// Keep the kart on the road so we measure the drift, not the barrier (same trick
// as feel.test.mjs's chargeTimes()).
function pinToRoad(b) {
  const sm = spline.closestT(b.position);
  if (Math.abs(sm.lateral) > spline.widthAt(sm.t) * 0.5) {
    const back = spline.offsetPoint(sm.t, 0);
    b.position.x = back.x; b.position.z = back.z;
  }
}

/** Enter and hold a committed drift until the physics itself reports `target`. */
function holdDriftTo(b, target, maxT = 14) {
  let t = 0;
  while (t < maxT) {
    const dir = b.drifting ? b.driftDir : 1;
    b.update(DT, { throttle: 1, brake: 0, steer: dir, drift: true, hop: false });
    t += DT;
    pinToRoad(b);
    if (b.drifting && b.driftTier >= target) return { reached: true, tier: b.driftTier, t };
  }
  return { reached: false, tier: b.driftTier, t };
}

/** Let go of drift for one step. Returns the tier the PHYSICS held on the way in. */
function releaseDrift(b) {
  const tierAtRelease = b.driftTier;
  b.update(DT, { throttle: 1, brake: 0, steer: 0, drift: false, hop: false });
  pinToRoad(b);
  return tierAtRelease;
}

function startAt(t0 = 0.62, v = 22) {
  const b = mk();
  b.placeAt({ t: t0, lateral: 0, rot: spline.tangentAt(t0) });
  b._vLong = v; b._writeVelocity();
  return b;
}

// ---------------------------------------------------------------------------
console.log('\n  DRIFT BOOST PROVENANCE (real physics, real spline)\n  ' + '─'.repeat(78));

// 1. A real tier-1/2/3 drift release must report the tier it ACTUALLY released.
for (const target of [1, 2, 3]) {
  const b = startAt();
  const seq0 = b.boostSeq;
  const r = holdDriftTo(b, target);
  const held = releaseDrift(b);

  ok(`tier ${target}: physics really charged to it`, r.reached && held === target,
     `charged tier=${r.tier} in ${f2(r.t)}s, held ${held} at release`);
  // The load-bearing assertion: compare against what the physics held, not a constant.
  ok(`tier ${target}: lastBoostTier == the tier actually released`, b.lastBoostTier === held,
     `lastBoostTier=${b.lastBoostTier}, released=${held}`);
  ok(`tier ${target}: source is 'drift'`, b.lastBoostSource === 'drift', `source=${b.lastBoostSource}`);
  ok(`tier ${target}: boostSeq advanced on the release`, b.boostSeq === seq0 + 1,
     `${seq0} -> ${b.boostSeq}`);
  ok(`tier ${target}: driftTier is still zeroed after release (unchanged semantics)`,
     b.driftTier === 0 && b.drifting === false);
  ok(`tier ${target}: the boost really landed`, b.boosting === true &&
     b.lastBoostStrength > 1, `strength=${f2(b.lastBoostStrength)}`);
}

// 2. The quiz path: a bare applyBoost() must be distinguishable from a drift.
{
  const b = startAt();
  for (let i = 0; i < 60; i++) b.update(DT, autopilotInput(b, spline, { drift: false }));
  const seq0 = b.boostSeq;
  b.applyBoost(1.25, 1.2, 3.0);           // exactly what quiz.js calls, unedited
  ok('external boost: source is \'external\'', b.lastBoostSource === 'external',
     `source=${b.lastBoostSource}`);
  ok('external boost: tier is 0', b.lastBoostTier === 0, `tier=${b.lastBoostTier}`);
  ok('external boost: boostSeq advanced', b.boostSeq === seq0 + 1, `${seq0} -> ${b.boostSeq}`);
  ok('external boost: never drifted, so it is not a drift', b.lastBoostSource !== 'drift');
}

// 3. Chained corners: a second boost while `boosting` is ALREADY true. There is no
//    rising edge here — boostSeq is the only observer that can see it.
{
  const b = startAt();
  holdDriftTo(b, 3);
  const firstTier = releaseDrift(b);
  const seqAfterFirst = b.boostSeq;
  ok('chain: first release boosted', b.boosting === true && b.lastBoostTier === firstTier,
     `tier=${firstTier}`);

  // Immediately drift again, still under the first boost.
  let stayedBoosting = true;
  const b2Start = b.boostSeq;
  let t = 0;
  while (t < 3.0 && !(b.drifting && b.driftTier >= 1)) {
    const dir = b.drifting ? b.driftDir : 1;
    b.update(DT, { throttle: 1, brake: 0, steer: dir, drift: true, hop: false });
    t += DT; pinToRoad(b);
    if (!b.boosting) stayedBoosting = false;
  }
  const chainedTier = b.driftTier;
  const boostingBefore = b.boosting;
  releaseDrift(b);

  ok('chain: the first boost was still running (no false->true edge)',
     stayedBoosting && boostingBefore === true,
     `boosting stayed ${stayedBoosting}, second drift charged tier ${chainedTier} in ${f2(t)}s`);
  ok('chain: second drift reached a real tier', chainedTier >= 1, `tier=${chainedTier}`);
  ok('chain: boostSeq incremented on the re-boost', b.boostSeq === b2Start + 1,
     `${b2Start} -> ${b.boostSeq} (seq after 1st release ${seqAfterFirst})`);
  ok('chain: lastBoostTier is the SECOND drift\'s tier', b.lastBoostTier === chainedTier,
     `lastBoostTier=${b.lastBoostTier}, chained=${chainedTier}`);
  ok('chain: source is still \'drift\'', b.lastBoostSource === 'drift');
}

// 4. boostSeq must be monotonic — never reset under a consumer holding a value.
{
  const b = startAt();
  holdDriftTo(b, 1); releaseDrift(b);
  const seq = b.boostSeq;
  b.respawn(0.25);
  ok('boostSeq survives respawn() (monotonic, never walks back)', b.boostSeq >= seq,
     `${seq} -> ${b.boostSeq}`);
  ok('respawn clears the provenance fields themselves', b.lastBoostTier === 0 &&
     b.lastBoostSource === 'none');
}

// 5. getState() carries the provenance (HUD/FX read snapshots, not the body).
{
  const b = startAt();
  holdDriftTo(b, 2); const held = releaseDrift(b);
  const s = b.getState();
  ok('getState() exposes provenance', s.lastBoostTier === held && s.lastBoostSource === 'drift' &&
     s.boostSeq === b.boostSeq, `tier=${s.lastBoostTier} source=${s.lastBoostSource} seq=${s.boostSeq}`);
}

// ---------------------------------------------------------------------------
// 6. DRIFT FEEL IS UNCHANGED. D9: the drift advantage over gripping is a tuned,
//    approved number (4.08%). Provenance must be pure bookkeeping.
console.log('\n  DRIFT FEEL (D9 — must not move)\n  ' + '─'.repeat(78));
{
  function lap(drift) {
    const b = mk();
    b._vLong = 12; b._writeVelocity();
    let t = 0, prevT = b.lapT, prog = 0;
    while (t < 400) {
      b.update(DT, autopilotInput(b, spline, { drift }));
      t += DT;
      prog += TrackSpline.deltaT(b.lapT, prevT); prevT = b.lapT;
      if (prog >= 1) break;
    }
    return { t, finished: prog >= 1 };
  }
  const grip = lap(false), drifted = lap(true);
  const pct = (grip.t - drifted.t) / grip.t * 100;
  ok('both autopilot laps completed', grip.finished && drifted.finished,
     `grip ${f2(grip.t)}s, drift ${f2(drifted.t)}s`);
  ok('drift advantage still ~4.08% (D9 approved feel)', Math.abs(pct - 4.08) < 0.35,
     `${f2(pct)}% (tuned 4.08%, tolerance ±0.35)`);
  ok('drifting is FASTER than gripping (the sign D9 warns about)', pct > 0, `${f2(pct)}%`);
}

// Tier table sanity: the tiers the provenance reports are the tuned ones.
ok('DRIFT_TIERS still has exactly 3 tiers', DRIFT_TIERS.length === 3);

console.log('  ' + '─'.repeat(78));
console.log(fail ? `  \x1b[31m${fail} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exit(fail ? 1 : 0);

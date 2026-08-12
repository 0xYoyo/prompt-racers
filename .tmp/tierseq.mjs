// Emulates race.js's observer over a REAL tier-2/3 drift and prints the event log.
// Two observers: the historical one (rising edge of `boosting`, tier read after the
// fact) and the provenance one (boostSeq change).
import { getTrack, gridSlots } from '../src/track/trackdef.js';
import { KartBody } from '../src/kart/kartphysics.js';

const DT = 1 / 60;
const { def, spline } = getTrack('oasis');
const slots = gridSlots(spline, def, 8);
const b = new KartBody({ spline, stats: { speed: 3, accel: 4, handling: 4, weight: 3 }, startSlot: slots[0] });
b.placeAt({ t: 0.62, lateral: 0, rot: spline.tangentAt(0.62) });
b._vLong = 22; b._writeVelocity();

const pin = () => {
  const sm = spline.closestT(b.position);
  if (Math.abs(sm.lateral) > spline.widthAt(sm.t) * 0.5) {
    const back = spline.offsetPoint(sm.t, 0);
    b.position.x = back.x; b.position.z = back.z;
  }
};

const oldLog = [], newLog = [];
let prevBoosting = false, prevTier = 0, prevSeq = b.boostSeq ?? 0;
const step = drift => {
  b.update(DT, { throttle: 1, brake: 0, steer: drift ? (b.drifting ? b.driftDir : 1) : 0, drift, hop: false });
  pin();
  if (b.drifting && b.driftTier > prevTier) { oldLog.push(['drift:tier', b.driftTier]); newLog.push(['drift:tier', b.driftTier]); }
  prevTier = b.drifting ? b.driftTier : 0;
  // historical race.js observer
  if (b.boosting && !prevBoosting) oldLog.push(['drift:boost', 'tier=' + b.driftTier]);
  prevBoosting = b.boosting;
  // provenance observer
  if ((b.boostSeq ?? 0) !== prevSeq) {
    prevSeq = b.boostSeq;
    newLog.push(['drift:boost', 'tier=' + b.lastBoostTier + ' src=' + b.lastBoostSource]);
  }
};

// full tier-3 drift, release, then a chained tier-1 drift under the same boost
let t = 0;
while (t < 8 && !(b.drifting && b.driftTier >= 3)) { step(true); t += DT; }
step(false);
t = 0;
while (t < 3 && !(b.drifting && b.driftTier >= 1)) { step(true); t += DT; }
step(false);
// a quiz turbo, mid-race
b.applyBoost(1.25, 1.2, 3.0);
if ((b.boostSeq ?? 0) !== prevSeq) { prevSeq = b.boostSeq; newLog.push(['drift:boost', 'tier=' + b.lastBoostTier + ' src=' + b.lastBoostSource]); }
if (b.boosting && !prevBoosting) oldLog.push(['drift:boost', 'tier=' + b.driftTier]);

console.log('  edge-on-boosting observer (race.js today): ' + JSON.stringify(oldLog));
console.log('  boostSeq observer (proposed)             : ' + JSON.stringify(newLog));

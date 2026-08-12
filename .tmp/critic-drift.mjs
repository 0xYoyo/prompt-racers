import { getTrack, gridSlots } from '../src/track/trackdef.js';
import { KartBody } from '../src/kart/kartphysics.js';
const { def, spline } = getTrack('oasis');
const slots = gridSlots(spline, def, 8);
const b = new KartBody({ spline, stats:{speed:3,accel:3,handling:3,weight:3}, startSlot: slots[0], surface:'sand' });
const prev = { tier:-1, boosting:false };
const emitted = [];
function feedback(p){
  if (p.driftTier !== prev.tier) { if (p.driftTier > prev.tier && p.driftTier>0) emitted.push(['drift:tier',p.driftTier]); prev.tier = p.driftTier; }
  if (p.boosting !== prev.boosting) { prev.boosting = p.boosting; if (p.boosting) emitted.push(['drift:boost','tier='+p.driftTier]); }
}
let released = false, maxTier = 0;
for (let i=0;i<1200;i++){
  maxTier = Math.max(maxTier, b.driftTier);
  const drift = !released && b.driftTier < 2;
  if (!drift && b.driftTier >= 2) released = true;
  b.update(1/60, { throttle:1, brake:0, steer:1, drift, hop:drift });
  feedback(b);
  if (released && emitted.some(e=>e[0]==='drift:boost')) break;
}
console.log('maxTier reached', maxTier, JSON.stringify(emitted));

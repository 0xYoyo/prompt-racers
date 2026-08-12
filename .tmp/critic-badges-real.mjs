import { bus } from '../src/core/bus.js';
import { save } from '../src/core/save.js';
import { startBadgeTracker, getStats } from '../src/core/badges.js';
save.reset();
startBadgeTracker({ toast:false });
// EXACTLY what race.js emits: tier climbs during the drift, then the release
// boost carries player.driftTier, which _releaseDrift() has already zeroed.
for (let i=0;i<40;i++){
  bus.emit('drift:tier',{tier:1}); bus.emit('drift:tier',{tier:2}); bus.emit('drift:tier',{tier:3});
  bus.emit('drift:boost',{tier:0});
}
// and what a correct quiz answer emits (quiz.js calls body.applyBoost -> boosting flips)
bus.emit('drift:boost',{tier:0});
const b = save.read('badges')||[];
console.log('badges:', b.join(', '));
console.log('driftBoosts:', getStats().driftBoosts, 'driftBoostsTop:', getStats().driftBoostsTop, 'bestDriftTier:', getStats().bestDriftTier);
console.log('drift-top unlocked?', b.includes('drift-top'));

// Does the game's own autopilot produce real tier-3 drift releases headlessly?
import { getTrack, gridSlots } from '../src/track/trackdef.js';
import { KartBody, autopilotInput, DRIFT_TIERS } from '../src/kart/kartphysics.js';

for (const track of ['oasis', 'cloud', 'canyon', 'city', 'dunes']) {
  let t;
  try { t = getTrack(track); } catch { continue; }
  const { def, spline } = t;
  const slots = gridSlots(spline, def, 8);
  const b = new KartBody({ spline, stats: { speed: 3, accel: 3, handling: 3, weight: 3 }, startSlot: slots[0], surface: def.surface });
  const seen = { releases: 0, byTier: [0, 0, 0, 0], peak: 0 };
  let prevDrifting = false, prevBoosting = false, peak = 0;
  for (let i = 0; i < 60 * 120; i++) {
    const inp = autopilotInput(b, spline, { drift: true });
    b.update(1 / 60, inp);
    if (b.driftTier > peak) peak = b.driftTier;
    if (b.drifting !== prevDrifting) prevDrifting = b.drifting;
    if (b.boosting !== prevBoosting) {
      prevBoosting = b.boosting;
      if (b.boosting) { seen.releases++; seen.byTier[peak]++; seen.peak = Math.max(seen.peak, peak); peak = 0; }
    }
    if (!b.drifting && !b.boosting) peak = Math.max(peak, 0);
  }
  console.log(track.padEnd(8), 'releases', seen.releases, 'byPeakTier', JSON.stringify(seen.byTier), 'bestPeak', seen.peak, 'lapT', b.lapT?.toFixed(2));
}

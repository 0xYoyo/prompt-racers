import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import * as THREE from '../vendor/three.module.js';
for (const id of ['oasis','circuit','cloud']) {
  const { def, spline } = getTrack(id);
  console.log(`\n=== ${id} === length=${spline.length.toFixed(1)}m width=${def.width}`);
  // closestT accuracy: sample points ON the centreline, expect lateral~0 and t match
  let maxLat = 0, maxTErr = 0;
  for (let k = 0; k < 400; k++) {
    const t = k / 400;
    const p = spline.positionAt(t);
    const r = spline.closestT(p);
    maxLat = Math.max(maxLat, Math.abs(r.lateral));
    maxTErr = Math.max(maxTErr, Math.abs(TrackSpline.deltaT(r.t, t)));
  }
  console.log(`  centreline probe: maxLateral=${maxLat.toFixed(3)}m  maxTerr=${(maxTErr*spline.length).toFixed(2)}m`);
  // offset probe: 3m right of centre should read lateral ~ +3
  let e=0; for (let k=0;k<200;k++){const t=k/200;const p=spline.offsetPoint(t,3);const r=spline.closestT(p);e=Math.max(e,Math.abs(r.lateral-3));}
  console.log(`  offset(+3m) probe: maxErr=${e.toFixed(3)}m`);
  // grid slots on track?
  const slots = gridSlots(spline, def, 8);
  const bad = slots.filter(s => { const r = spline.closestT(s.pos); return Math.abs(r.lateral) > spline.widthAt(r.t); });
  console.log(`  grid slots off-track: ${bad.length}/8`);
  // curvature sanity
  let mx=0; for(let k=0;k<1000;k++) mx=Math.max(mx,Math.abs(spline.curvatureAt(k/1000)));
  console.log(`  max curvature: ${(mx*180/Math.PI).toFixed(1)}deg over 12 samples`);
  // perf
  const v=new THREE.Vector3(20,0,-40); const t0=performance.now();
  for(let i=0;i<80000;i++){v.x=(i%300)-150;v.z=-(i%400);spline.closestT(v);}
  console.log(`  closestT: ${((performance.now()-t0)/80000*1000).toFixed(2)}us/call (need <8us for 8 karts@60fps)`);
}

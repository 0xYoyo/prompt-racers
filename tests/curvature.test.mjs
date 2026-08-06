import { getTrack } from '../src/track/trackdef.js';
import * as THREE from 'three';
const { spline } = getTrack('oasis');
// Independent ground truth: does the tangent rotate toward the LEFT vector or the RIGHT vector?
// left = -right. If the tangent turns toward `right`, it's a right-hand corner.
let agreeLeft = 0, agreeRight = 0, n = 0;
const samples = [];
for (let k = 0; k < 2000; k++) {
  const t = k / 2000;
  const c = spline.curvatureAt(t);
  if (Math.abs(c) < 0.05) continue;                  // ignore near-straights
  const t0 = (t - 0.004 + 1) % 1, t1 = (t + 0.004) % 1;
  const a = spline.tangentAt(t0), b = spline.tangentAt(t1);
  const right = spline.rightAt(t);
  const d = new THREE.Vector3().subVectors(b, a);    // how the tangent changed
  const turnsRight = d.dot(right) > 0;               // ground truth
  n++;
  if (c > 0) { if (turnsRight) agreeRight++; else agreeLeft++; }
  if (samples.length < 6) samples.push({ t: +t.toFixed(3), c: +c.toFixed(3), turnsRight, dotRight: +d.dot(right).toFixed(4) });
}
console.log('samples:', JSON.stringify(samples, null, 0));
console.log(`\nOf ${n} curved samples: positive curvature coincided with a RIGHT turn ${agreeRight} times, LEFT ${agreeLeft} times.`);
console.log(agreeRight > agreeLeft
  ? '=> positive curvature means a RIGHT turn. The docstring saying "+ = left" is WRONG.'
  : '=> positive curvature means a LEFT turn. The docstring is correct.');

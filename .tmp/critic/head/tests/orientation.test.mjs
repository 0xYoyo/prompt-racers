// Guards the render-orientation convention (Wave 2, P0 #1/#2).
// The sim is +Z-forward; meshes are three.js-standard -Z-forward. If these two ever
// get copied onto each other raw again, every kart renders backwards and steering
// reads inverted. This test pins both halves.
import * as THREE from 'three';
import { getTrack, gridSlots } from '../src/track/trackdef.js';
import { KartBody, MODEL_YAW_OFFSET } from '../src/kart/kartphysics.js';
import { PLAYER_STEER_SIGN } from '../src/core/input.js';

let fail = 0;
const ok = (n, c, d='') => { if(!c) fail++;
  console.log(`  ${c?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${n.padEnd(56)} ${d?'\x1b[2m'+d+'\x1b[0m':''}`); };

console.log('\n  RENDER ORIENTATION\n  ' + '─'.repeat(76));
const { def, spline } = getTrack('oasis');
const slots = gridSlots(spline, def, 8);
const mk = () => new KartBody({ spline, stats:{speed:3,accel:3,handling:3,weight:3},
                                startSlot: slots[0], surface:'sand' });

const b = mk();
for (let i=0;i<120;i++) b.update(1/60,{throttle:1,brake:0,steer:0,drift:false,hop:false});
const vel = b.velocity.clone().setY(0).normalize();

// Physics quaternion: +Z is forward.
const simFwd = new THREE.Vector3(0,0,1).applyQuaternion(b.quaternion).setY(0).normalize();
ok('sim quaternion maps +Z onto velocity', simFwd.dot(vel) > 0.99, `dot=${simFwd.dot(vel).toFixed(4)}`);

// Render quaternion: -Z is forward (what a three.js-built model expects).
const modelFwd = new THREE.Vector3(0,0,-1).applyQuaternion(b.renderQuaternion).setY(0).normalize();
ok('render quaternion maps -Z onto velocity', modelFwd.dot(vel) > 0.99, `dot=${modelFwd.dot(vel).toFixed(4)}`);

// The model's nose must NOT point back at a chase camera sitting behind the kart.
const camPos = b.position.clone().addScaledVector(vel, -6);
const camToKart = b.position.clone().sub(camPos).setY(0).normalize();
ok('model nose points AWAY from a trailing camera', modelFwd.dot(camToKart) > 0.99,
   `dot=${modelFwd.dot(camToKart).toFixed(4)} (negative = kart faces the camera)`);

ok('MODEL_YAW_OFFSET is exactly half a turn', Math.abs(MODEL_YAW_OFFSET - Math.PI) < 1e-9);

// Steering. Measured DIFFERENTIALLY against a steer=0 baseline: the track itself
// curves, so an absolute "did it move right" test reads the corner, not the input.
console.log('\n  STEERING SIGN (differential vs straight-ahead baseline)\n  ' + '─'.repeat(76));
const heading = k => Math.atan2(k.velocity.x, k.velocity.z);          // +Z forward
const renderHeading = k => {
  const f = new THREE.Vector3(0,0,-1).applyQuaternion(k.renderQuaternion);
  return Math.atan2(f.x, f.z);
};
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

const asPlayer = arrow => arrow * PLAYER_STEER_SIGN;   // ArrowRight = +1

function run(steer) {
  const k = mk();
  for (let i=0;i<60;i++) k.update(1/60,{throttle:1,brake:0,steer:0,drift:false,hop:false});
  for (let i=0;i<45;i++) k.update(1/60,{throttle:1,brake:0,steer,drift:false,hop:false});
  return { move: heading(k), render: renderHeading(k) };
}
const base = run(0), right = run(asPlayer(+1)), left = run(asPlayer(-1));

// A right turn DECREASES the +Z-forward heading atan2(x,z)? Determine empirically from
// the spline-independent baseline difference, then assert left is the mirror of right.
const dRight = wrap(right.move - base.move);
const dLeft  = wrap(left.move  - base.move);
ok('ArrowRight and ArrowLeft turn opposite ways', Math.sign(dRight) === -Math.sign(dLeft),
   `right ${(dRight*180/Math.PI).toFixed(1)}deg, left ${(dLeft*180/Math.PI).toFixed(1)}deg`);
ok('both inputs turn by a similar magnitude', Math.abs(Math.abs(dRight) - Math.abs(dLeft)) < 0.15,
   `|right|=${Math.abs(dRight*180/Math.PI).toFixed(1)} |left|=${Math.abs(dLeft*180/Math.PI).toFixed(1)}`);

// The decisive check: does ArrowRight move the kart toward its OWN right-hand side?
const kr = mk();
for (let i=0;i<60;i++) kr.update(1/60,{throttle:1,brake:0,steer:0,drift:false,hop:false});
const ownRight = new THREE.Vector3(0,0,1).applyQuaternion(kr.quaternion).cross(new THREE.Vector3(0,1,0)).normalize();
const p0 = kr.position.clone(), v0 = kr.velocity.clone().setY(0).normalize();
for (let i=0;i<45;i++) kr.update(1/60,{throttle:1,brake:0,steer:asPlayer(+1),drift:false,hop:false});
const drift = kr.position.clone().sub(p0);
const lateralOff = drift.dot(ownRight) - drift.dot(v0)*0;     // sideways component
ok('ArrowRight displaces the kart to its own RIGHT', lateralOff > 0, `${lateralOff.toFixed(2)} m sideways`);

// And the rendered model must rotate the SAME way the motion does, or it looks mirrored.
const dRenderRight = wrap(right.render - base.render);
ok('rendered heading turns with the motion (not mirrored)',
   Math.sign(dRenderRight) === Math.sign(dRight),
   `motion ${(dRight*180/Math.PI).toFixed(1)}deg, render ${(dRenderRight*180/Math.PI).toFixed(1)}deg`);

console.log('  ' + '─'.repeat(76));
console.log(fail ? `  \x1b[31m${fail} failed\x1b[0m\n` : '  \x1b[32mall passed\x1b[0m\n');
process.exit(fail?1:0);

import * as THREE from 'three';
import { getTrack, gridSlots } from '../src/track/trackdef.js';
import { KartBody } from '../src/kart/kartphysics.js';
const { def, spline } = getTrack('oasis');
const slots = gridSlots(spline, def, 8);
const b = new KartBody({ spline, stats:{speed:3,accel:3,handling:3,weight:3}, startSlot: slots[0], surface:'sand' });

// Drive straight for 2s
for (let i=0;i<120;i++) b.update(1/60, {throttle:1,brake:0,steer:0,drift:false,hop:false});

const vel = b.velocity.clone(); vel.y=0; vel.normalize();
const q = b.quaternion;
const fwdPlusZ  = new THREE.Vector3(0,0, 1).applyQuaternion(q).setY(0).normalize();
const fwdMinusZ = new THREE.Vector3(0,0,-1).applyQuaternion(q).setY(0).normalize();
console.log('speed', b.speed.toFixed(2));
console.log('velocity dir      ', vel.toArray().map(n=>n.toFixed(3)).join(', '));
console.log('quat * (+Z)       ', fwdPlusZ.toArray().map(n=>n.toFixed(3)).join(', '), ' dot(vel)=', fwdPlusZ.dot(vel).toFixed(3));
console.log('quat * (-Z)       ', fwdMinusZ.toArray().map(n=>n.toFixed(3)).join(', '), ' dot(vel)=', fwdMinusZ.dot(vel).toFixed(3));
console.log('=> body quaternion treats', fwdPlusZ.dot(vel) > 0 ? '+Z' : '-Z', 'as FORWARD');

// Steering sign: positive steer should turn which way?
const b2 = new KartBody({ spline, stats:{speed:3,accel:3,handling:3,weight:3}, startSlot: slots[0], surface:'sand' });
for (let i=0;i<60;i++) b2.update(1/60, {throttle:1,brake:0,steer:0,drift:false,hop:false});
const before = b2.velocity.clone().setY(0).normalize();
const right0 = spline.rightAt(b2.lapT);
for (let i=0;i<90;i++) b2.update(1/60, {throttle:1,brake:0,steer:+1,drift:false,hop:false});
const after = b2.velocity.clone().setY(0).normalize();
const turned = new THREE.Vector3().subVectors(after, before);
console.log('\nsteer=+1 turned toward', turned.dot(right0) > 0 ? 'RIGHT' : 'LEFT', `(dot=${turned.dot(right0).toFixed(3)})`);
console.log('input.js maps ArrowRight -> steer +1, ArrowLeft -> steer -1');
console.log('=> ArrowRight should therefore turn', turned.dot(right0) > 0 ? 'RIGHT (correct)' : 'LEFT (INVERTED)');

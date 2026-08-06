import { getTrack } from '../src/track/trackdef.js';
import { KartBody } from '../src/kart/kartphysics.js';
const DT=1/60;
const {spline}=getTrack('oasis');
const b=new KartBody({spline,stats:{speed:3,accel:4,handling:4,weight:3},startSlot:{t:0.1,lateral:0,rot:spline.tangentAt(0.1)}});
b.yaw+=Math.PI/2;b._syncBasis();
for(let i=0;i<330;i++){
  b.update(DT,{throttle:1,brake:0,steer:0,drift:false});
  if(i%6===0)console.log((i/60).toFixed(2),'spd',b.speed.toFixed(1),'lat',b.lateral.toFixed(1),'w',b.trackWidth.toFixed(1),'off',b.offTrack?1:0,'stuck',b._stuck.toFixed(2),'wallC',b._wallContact.toFixed(2),'hit',b.wallHit.toFixed(2));
}

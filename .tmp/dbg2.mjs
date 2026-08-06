import { getTrack, gridSlots } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
const DT=1/60;
const {def,spline}=getTrack('oasis');
console.log('length',spline.length);
const b=new KartBody({spline,stats:{speed:3,accel:4,handling:4,weight:3},startSlot:{t:0.26,lateral:0,rot:spline.tangentAt(0.26)}});
b._vLong=20;
for(let i=0;i<600;i++){
  const inp=autopilotInput(b,spline,{drift:true});
  b.update(DT,inp);
  if(i%10===0)console.log(i,'t',b.lapT.toFixed(4),'spd',b.speed.toFixed(1),'lat',b.lateral.toFixed(1),'st',inp.steer.toFixed(2),'D',inp.drift?1:0,'drifting',b.drifting?1:0,'tier',b.driftTier,'chg',b.driftCharge.toFixed(2),'slip',b.slipAngle.toFixed(2),'air',b.airborne?1:0,'curv',spline.maxCurvatureAhead(b.lapT,0.012).toFixed(3));
}

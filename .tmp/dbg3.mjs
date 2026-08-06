import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput, radiusAt } from '../src/kart/kartphysics.js';
const DT=1/60;
const {def,spline}=getTrack('oasis');
const slots=gridSlots(spline,def,8);
const b=new KartBody({spline,stats:{speed:3,accel:4,handling:4,weight:3},startSlot:slots[0]});
b._vLong=12;b._writeVelocity();
for(let i=0;i<60*24;i++){
  const inp=autopilotInput(b,spline,{drift:true});
  b.update(DT,inp);
  if(i%15===0)console.log(String(i).padStart(4),'t',b.lapT.toFixed(3),'R',radiusAt(spline,b.lapT,0.02).toFixed(0).padStart(4),'spd',b.speed.toFixed(1),'lat',b.lateral.toFixed(1),'w',b.trackWidth.toFixed(1),'st',inp.steer.toFixed(2),'D',inp.drift?1:0,'dr',b.drifting?1:0,b.driftDir,'tier',b.driftTier,'slip',b.slipAngle.toFixed(2),'B',b.boosting?1:0,'wall',b.wallHit.toFixed(2));
}

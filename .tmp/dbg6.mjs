import { getTrack, gridSlots } from '../src/track/trackdef.js';
import { KartBody, autopilotInput, radiusAt } from '../src/kart/kartphysics.js';
const DT=1/60;
const {def,spline}=getTrack('oasis');
const slots=gridSlots(spline,def,8);
const b=new KartBody({spline,stats:{speed:3,accel:4,handling:4,weight:3},startSlot:slots[0]});
b._vLong=12;b._writeVelocity();
let prev={};
for(let i=0;i<60*20;i++){
  const inp=autopilotInput(b,spline,{drift:true});
  b.update(DT,inp);
  const key=[inp.drift,b.drifting,b.airborne,b.driftTier].join();
  if(key!==prev.key||i%60===0){console.log(String(i).padStart(4),'t',b.lapT.toFixed(3),'R',radiusAt(spline,b.lapT,0.02).toFixed(0).padStart(4),'spd',b.speed.toFixed(1),'st',inp.steer.toFixed(2),'D',inp.drift?1:0,'dr',b.drifting?1:0,b.driftDir,'chg',b.driftCharge.toFixed(2),'air',b.airborne?1:0,'lean',b.driftLean.toFixed(2));prev.key=key;}
}

import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
const DT=1/60;
for(const id of ['oasis','cloud']){
const {def,spline}=getTrack(id);
const b=new KartBody({spline,stats:{speed:3,accel:4,handling:4,weight:3},startSlot:gridSlots(spline,def,8)[0]});
b._vLong=12;b._writeVelocity();
let t=0,prev=b.lapT,prog=0,air=0,hopAir=0,otherAir=0,transitions=0,wasAir=false,hops=0;
while(t<200){
  const before=b._hopTime;
  b.update(DT,autopilotInput(b,spline,{drift:true}));
  if(b._hopTime>before) hops++;
  if(b.airborne){air+=DT; if(b._hopTime>0)hopAir+=DT; else otherAir+=DT;}
  if(b.airborne&&!wasAir)transitions++;
  wasAir=b.airborne;
  t+=DT;prog+=TrackSpline.deltaT(b.lapT,prev);prev=b.lapT;if(prog>=1)break;
}
console.log(id,'lap',t.toFixed(2),'air',air.toFixed(2),'hopAir',hopAir.toFixed(2),'otherAir',otherAir.toFixed(2),'airTransitions',transitions,'hops',hops);
}

import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
const DT=1/60, {def,spline}=getTrack('oasis'), slots=gridSlots(spline,def,8);
const P={speed:3,accel:4,handling:4,weight:3};
const lap=d=>{const b=new KartBody({spline,stats:P,startSlot:slots[0]});b._vLong=12;b._writeVelocity();
 let t=0,pv=b.lapT,pr=0;while(t<400){b.update(DT,autopilotInput(b,spline,{drift:d}));t+=DT;pr+=TrackSpline.deltaT(b.lapT,pv);pv=b.lapT;if(pr>=1)break;}return t;};
const g=lap(false),d=lap(true);
console.log(`grip ${g.toFixed(4)}s drift ${d.toFixed(4)}s advantage ${((g-d)/g*100).toFixed(4)}%`);

import { getTrack } from '../src/track/trackdef.js';
import { radiusAt } from '../src/kart/kartphysics.js';
const {spline}=getTrack('oasis');
let out=[];
for(let i=0;i<100;i++){const t=i/100;out.push([t,radiusAt(spline,t,0.02)]);}
console.log(out.filter(([t,r])=>r<60).map(([t,r])=>t.toFixed(2)+':'+r.toFixed(0)).join(' '));

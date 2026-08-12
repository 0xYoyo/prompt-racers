import { getTrack } from '../src/track/trackdef.js';
import { radiusAt } from '../src/kart/kartphysics.js';
for(const id of ['oasis','circuit','cloud']){
const {spline}=getTrack(id);
const R=[];for(let i=0;i<200;i++)R.push(radiusAt(spline,i/200,0.02));
R.sort((a,b)=>a-b);
console.log(id,'len',spline.length.toFixed(0),'minR',R[0].toFixed(0),'p10',R[20].toFixed(0),'p25',R[50].toFixed(0),'median',R[100].toFixed(0),'p75',R[150].toFixed(0));
}

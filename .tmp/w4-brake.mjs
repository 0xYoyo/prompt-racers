import { variant } from './w4-var.mjs';
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
const DT=1/60,f=(n,d=2)=>n.toFixed(d);
async function lap({mod,track,pace,d01=0,seed=7,laps=4}){
  const {AIDriver}=await import(mod);
  const {def,spline}=getTrack(track);
  const slots=gridSlots(spline,def,8);
  const racer=ROSTER[0];
  const surface=def?.theme==='cloud'?'cloud':def?.theme==='circuit'?'grass':'sand';
  const body=new KartBody({spline,stats:racer.stats,startSlot:slots[0],surface});
  const drv=new AIDriver({body,spline,racer,difficulty:d01,seed,pace});
  let t=0,prev=body.lapT,prog=0,off=0;
  while(prog<laps&&t<600){ const i=drv.update(DT,{}); body.update(DT,i); prog+=TrackSpline.deltaT(body.lapT,prev); prev=body.lapT; if(body.offTrack) off+=DT; t+=DT; }
  return {lap:t/laps, off:100*off/t};
}
for (const bt of [0.62,0.70,0.78,0.86]){
  for (const sk of ['0.86 + 0.12','0.94 + 0.12','1.00 + 0.12']){
    const tag=`b${String(bt).replace('.','')}_s${sk.slice(0,4).replace('.','')}`;
    const mod=variant(tag,[['17.0 / P.brakeEarly * 0.62',`17.0 / P.brakeEarly * ${bt}`],['0.86 + 0.12 * this.d01',`${sk} * this.d01`]]);
    const out=[];
    for(const tr of ['oasis','circuit','cloud']){
      const rs=await Promise.all([7,21,33].map(s=>lap({mod,track:tr,pace:1.0,seed:s})));
      out.push(`${tr}: ${f(rs.reduce((a,r)=>a+r.lap,0)/3)} off ${f(rs.reduce((a,r)=>a+r.off,0)/3,1)}%`);
    }
    console.log(`brakeTrust ${bt}  skill ${sk}`.padEnd(34), out.join('  '));
  }
}

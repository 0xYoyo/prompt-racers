import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { AIDriver, racingLine } from '../src/kart/ai.js';
const DT=1/60, f=(n,d=2)=>n.toFixed(d);
function lapTime({track,pace,d01=0,margin,laps=4,seed=7}){
  const {def,spline}=getTrack(track);
  if(margin!=null) racingLine(spline,{force:true,margin});
  const slots=gridSlots(spline,def,8);
  const racer=ROSTER[0];
  const surface=def?.theme==='cloud'?'cloud':def?.theme==='circuit'?'grass':'sand';
  const body=new KartBody({spline,stats:racer.stats,startSlot:slots[0],surface});
  const drv=new AIDriver({body,spline,racer,difficulty:d01,seed,pace});
  let t=0,prev=body.lapT,prog=0,off=0;
  while(prog<laps&&t<600){ const i=drv.update(DT,{}); body.update(DT,i); prog+=TrackSpline.deltaT(body.lapT,prev); prev=body.lapT; if(body.offTrack) off+=DT; t+=DT; }
  return {lap:t/laps, offPct:100*off/t};
}
for (const tr of ['cloud','oasis','circuit']){
  for (const margin of [2.6,3.0,3.6,4.2,5.0]){
    const out=[];
    for (const d01 of [0,0.99]){
      const rs=[7,21,33].map(s=>lapTime({track:tr,pace:1.05,d01,margin,seed:s}));
      const m=k=>rs.reduce((a,r)=>a+r[k],0)/rs.length;
      out.push(`d${d01}: ${f(m('lap'))} off ${f(m('offPct'),1)}%`);
    }
    console.log(tr.padEnd(8),'margin',margin, out.join('   '));
  }
}

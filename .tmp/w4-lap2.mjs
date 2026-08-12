import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { AIDriver } from '../src/kart/ai.js';
const DT=1/60, f=(n,d=2)=>n.toFixed(d);
function lapTime({track,pace,d01=0,persona='balanced',laps=4,seed=7}){
  const {def,spline}=getTrack(track);
  const slots=gridSlots(spline,def,8);
  const racer=ROSTER[0];
  const surface=def?.theme==='cloud'?'cloud':def?.theme==='circuit'?'grass':'sand';
  const body=new KartBody({spline,stats:racer.stats,startSlot:slots[0],surface});
  const drv=new AIDriver({body,spline,racer,difficulty:d01,seed,pace,personality:persona});
  let t=0,prev=body.lapT,prog=0,off=0,air=0;
  while(prog<laps&&t<600){ const i=drv.update(DT,{}); body.update(DT,i); prog+=TrackSpline.deltaT(body.lapT,prev); prev=body.lapT; if(body.offTrack) off+=DT; if(body.airborne) air+=DT; t+=DT; }
  return {lap:t/laps, offPct:100*off/t, airPct:100*air/t};
}
for (const tr of ['oasis','cloud','circuit']){
  for (const p of [0.9,0.95,1.0,1.05,1.1,1.15,1.2]){
    const rs=[7,21,33].map(s=>lapTime({track:tr,pace:p,seed:s}));
    const m=k=>rs.reduce((a,r)=>a+r[k],0)/rs.length;
    console.log(tr.padEnd(8),'pace',p, 'lap',f(m('lap')),'off',f(m('offPct'),1)+'%','air',f(m('airPct'),1)+'%');
  }
}

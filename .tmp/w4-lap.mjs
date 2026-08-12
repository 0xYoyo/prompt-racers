import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { AIDriver } from '../src/kart/ai.js';
const DT=1/60, f=(n,d=2)=>n.toFixed(d);
function lapTime({track,pace,d01,persona,laps=4}){
  const {def,spline}=getTrack(track);
  const slots=gridSlots(spline,def,8);
  const racer=ROSTER[0];
  const surface=def?.theme==='cloud'?'cloud':def?.theme==='circuit'?'grass':'sand';
  const body=new KartBody({spline,stats:racer.stats,startSlot:slots[0],surface});
  const drv=new AIDriver({body,spline,racer,difficulty:d01,seed:7,pace,personality:persona});
  let t=0,prev=body.lapT,prog=0,off=0;
  while(prog<laps&&t<600){ const i=drv.update(DT,{}); body.update(DT,i); prog+=TrackSpline.deltaT(body.lapT,prev); prev=body.lapT; if(body.offTrack) off+=DT; t+=DT; }
  return {lap:t/laps, offPct:100*off/t};
}
function autoLap({track,laps=4}){
  const {def,spline}=getTrack(track);
  const slots=gridSlots(spline,def,8);
  const racer=ROSTER[0];
  const surface=def?.theme==='cloud'?'cloud':def?.theme==='circuit'?'grass':'sand';
  const body=new KartBody({spline,stats:racer.stats,startSlot:slots[0],surface});
  let t=0,prev=body.lapT,prog=0;
  while(prog<laps&&t<600){ body.update(DT,autopilotInput(body,spline,{drift:true})); prog+=TrackSpline.deltaT(body.lapT,prev); prev=body.lapT; t+=DT; }
  return t/laps;
}
for (const tr of ['oasis','circuit','cloud']){
  const a=autoLap({track:tr});
  const cells=[];
  for (const d01 of [0,0.5,1.0]) for (const pace of [1.0,1.05,1.10]){
    const r=lapTime({track:tr,pace,d01,persona:'balanced'});
    cells.push(`d${d01}/p${pace}: ${f(r.lap)} (off ${f(r.offPct,0)}%)`);
  }
  console.log(tr.padEnd(8),'autopilot',f(a),'| AI balanced:',cells.join('  '));
}

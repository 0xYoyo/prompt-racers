import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { AIDriver } from '../src/kart/ai.js';
const DT=1/60,f=(n,d=2)=>n.toFixed(d);
function mk(track,parts){
  const {def,spline}=getTrack(track);
  const slots=gridSlots(spline,def,8);
  const racer=ROSTER[0];
  const surface=def?.theme==='cloud'?'cloud':def?.theme==='circuit'?'grass':'sand';
  return {def,spline,body:new KartBody({spline,stats:racer.stats,startSlot:slots[0],surface,parts:parts||undefined}),racer};
}
function run(track,parts,pace,seed,ai=true,laps=4){
  const {spline,body,racer}=mk(track,parts);
  const drv=ai?new AIDriver({body,spline,racer,difficulty:0,seed,pace}):null;
  let t=0,prev=body.lapT,prog=0,off=0;
  while(prog<laps&&t<600){ body.update(DT, ai?drv.update(DT,{}):autopilotInput(body,spline,{drift:true})); prog+=TrackSpline.deltaT(body.lapT,prev); prev=body.lapT; if(body.offTrack)off+=DT; t+=DT; }
  return {lap:t/laps,off:100*off/t};
}
const SETS=[['stock',null],['t1',{engine:1,tyres:1,frame:1,turbo:1}],['t2',{engine:2,tyres:2,frame:2,turbo:2}],['t3',{engine:3,tyres:3,frame:3,turbo:3}]];
for(const tr of ['oasis','circuit','cloud']){
  const auto=[7,21,33].map(s=>run(tr,null,0,s,false));
  console.log(`\n${tr}  autopilot(stock) ${f(auto.reduce((a,r)=>a+r.lap,0)/3)}  off ${f(auto.reduce((a,r)=>a+r.off,0)/3,1)}%`);
  for(const [n,p] of SETS){
    const cells=[];
    for(const pace of [1.0,1.05,1.10]){
      const rs=[7,21,33].map(s=>run(tr,p,pace,s));
      cells.push(`pace${pace}: ${f(rs.reduce((a,r)=>a+r.lap,0)/3)} off${f(rs.reduce((a,r)=>a+r.off,0)/3,1)}%`);
    }
    const ap=[7,21,33].map(s=>run(tr,p,0,s,false));
    console.log('  AI '+n.padEnd(6)+cells.join('  ')+'   | autopilot w/parts '+f(ap.reduce((a,r)=>a+r.lap,0)/3));
  }
}

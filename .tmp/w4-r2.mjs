import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
const AI=process.env.W4_AI||'/Users/yoyopc/repos/kart-project/.tmp/w4-r2ai.js';
const { createAIField } = await import(AI);
const DT=1/60,f=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'inf';
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
export function race({track,difficulty,pace=1,seed=3,laps=3,parts=null}){
  const {def,spline}=getTrack(track);
  const slots=gridSlots(spline,def,8); const racer=ROSTER[0];
  const surface=def?.theme==='cloud'?'cloud':def?.theme==='circuit'?'grass':'sand';
  const player=new KartBody({spline,stats:racer.stats,startSlot:slots[0],surface,parts:parts||undefined});
  player.p.topSpeed*=pace; player.p.accelPower*=pace;
  const field=createAIField(spline,def,null,{difficulty,playerRacerId:racer.id,slots,playerSlot:0,seed});
  const toLine=((def.startT-player.lapT)+1)%1, finishAt=toLine+laps;
  const finish=new Array(field.drivers.length+1).fill(null);
  let t=0,prev=player.lapT,pProg=0,lapsBehind=null,lonely=0;
  while(t<900&&finish.some(x=>x==null)){
    player.update(DT,autopilotInput(player,spline,{drift:true}));
    pProg+=TrackSpline.deltaT(player.lapT,prev); prev=player.lapT;
    field.update(DT,{body:player,progress:pProg}); t+=DT;
    let near=1e9; for(const d of field.drivers) near=Math.min(near,Math.abs(d.progress-pProg));
    if(near>lonely) lonely=near;
    const prog=[pProg,...field.drivers.map(d=>d.progress)];
    for(let i=0;i<prog.length;i++) if(finish[i]==null&&prog[i]>=finishAt){finish[i]=t; if(lapsBehind==null)lapsBehind=finishAt-pProg;}
  }
  const order=finish.map((v,i)=>[v==null?Infinity:v,i]).sort((a,b)=>a[0]-b[0]);
  const times=finish.filter(Number.isFinite);
  field.dispose();
  return {pos:order.findIndex(o=>o[1]===0)+1,lapsBehind:lapsBehind??0,lonely,
          spreadS:Math.max(...times)-Math.min(...times), gapS:(finish[0]??Infinity)-order[0][0]};
}
const RACES=[{n:1,track:'oasis',difficulty:1},{n:2,track:'circuit',difficulty:2},{n:3,track:'cloud',difficulty:3}];
const SEEDS=(process.env.W4_SEEDS||'3,11,19,41,57').split(',').map(Number);
const PACES=(process.env.W4_PACES||'1.0,0.85,0.70').split(',').map(Number);
console.log('pace  '+RACES.map(R=>`race ${R.n}`.padStart(34)).join(''));
for(const pace of PACES){
  const cells=RACES.map(R=>{
    const rs=SEEDS.map(s=>race({track:R.track,difficulty:R.difficulty,pace,seed:s}));
    const p=rs.map(r=>r.pos);
    return `${Math.min(...p)}-${Math.max(...p)} m${f(mean(p),1)} lb${f(Math.max(...rs.map(r=>r.lapsBehind)))} ln${f(Math.max(...rs.map(r=>r.lonely)))} sp${f(mean(rs.map(r=>r.spreadS)),0)}s`.padStart(34);
  });
  console.log((f(pace*100,0)+'%').padStart(5)+' '+cells.join(''));
}

// Full-race measurement against a candidate ai.js (env-tunable dev copy).
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
const AI = process.env.W4_AI || '/Users/yoyopc/repos/kart-project/.tmp/w4-newai.js';
const { createAIField } = await import(AI);
const DT=1/60, f=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'inf';
const pad=(s,n)=>String(s).padEnd(n), padL=(s,n)=>String(s).padStart(n);
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;

export function race({track,difficulty,pace=1,seed=3,laps=3,parts=null,maxTime=900}){
  const {def,spline}=getTrack(track);
  const slots=gridSlots(spline,def,8);
  const racer=ROSTER[0];
  const surface=def?.theme==='cloud'?'cloud':def?.theme==='circuit'?'grass':'sand';
  const player=new KartBody({spline,stats:racer.stats,startSlot:slots[0],surface,parts:parts||undefined});
  player.p.topSpeed*=pace; player.p.accelPower*=pace;
  const field=createAIField(spline,def,null,{difficulty,playerRacerId:racer.id,slots,playerSlot:0,seed});
  const toLine=((def.startT-player.lapT)+1)%1, finishAt=toLine+laps;
  const finish=new Array(field.drivers.length+1).fill(null);
  let t=0,prev=player.lapT,pProg=0,lapsBehind=null,lonely=0;
  while(t<maxTime&&finish.some(x=>x==null)){
    player.update(DT,autopilotInput(player,spline,{drift:true}));
    pProg+=TrackSpline.deltaT(player.lapT,prev); prev=player.lapT;
    field.update(DT,{body:player,progress:pProg}); t+=DT;
    let near=1e9; for(const d of field.drivers) near=Math.min(near,Math.abs(d.progress-pProg));
    if(near>lonely) lonely=near;
    const prog=[pProg,...field.drivers.map(d=>d.progress)];
    for(let i=0;i<prog.length;i++) if(finish[i]==null&&prog[i]>=finishAt){ finish[i]=t; if(lapsBehind==null) lapsBehind=finishAt-pProg; }
  }
  const order=finish.map((v,i)=>[v==null?Infinity:v,i]).sort((a,b)=>a[0]-b[0]);
  const tel=field.telemetry(); field.dispose();
  return {pos:order.findIndex(o=>o[1]===0)+1,lapsBehind:lapsBehind??0,gapS:(finish[0]??Infinity)-order[0][0],
          bandMin:tel.bandMin,bandMax:tel.bandMax,lonely,time:t,playerTime:finish[0]??Infinity};
}
const RACES=[{n:1,track:'oasis',difficulty:1},{n:2,track:'circuit',difficulty:2},{n:3,track:'cloud',difficulty:3}];
const SEEDS=(process.env.W4_SEEDS||'3,11,19').split(',').map(Number);
const mode=process.argv[2]||'table';
if(mode==='table'||mode==='parts'){
  const sets = mode==='parts'
    ? [['stock',null],['t1',{engine:1,tyres:1,frame:1,turbo:1}],['t2',{engine:2,tyres:2,frame:2,turbo:2}],['t3',{engine:3,tyres:3,frame:3,turbo:3}]]
    : [['-',null]];
  const paces = (process.env.W4_PACES||(mode==='parts'?'1.0':'1.0,0.85,0.7')).split(',').map(Number);
  console.log('\n'+pad(mode==='parts'?'parts':'pace',8)+RACES.map(R=>padL(`race ${R.n} (${R.track})`,34)).join(''));
  for(const [nm,pt] of sets) for(const pace of paces){
    const cells=RACES.map(R=>{
      const runs=SEEDS.map(s=>race({track:R.track,difficulty:R.difficulty,pace,seed:s,parts:pt}));
      const p=runs.map(r=>r.pos);
      return padL(`${Math.min(...p)}-${Math.max(...p)} (m${f(mean(p),1)}) lb${f(Math.max(...runs.map(r=>r.lapsBehind)))} ln${f(Math.max(...runs.map(r=>r.lonely)))}`,34);
    });
    console.log(pad(mode==='parts'?nm:f(pace*100,0)+'%',8)+cells.join(''));
  }
}

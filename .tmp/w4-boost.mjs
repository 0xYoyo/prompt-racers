// Quiz-boost axis: what N correct answers are worth in finishing place.
// A correct answer = quiz.js's applyBoost(1.3, 2.4, 6) on the player, delivered
// at N evenly spaced points of the race. The quiz freeze stops the world for
// everyone, so it has no relative effect and is not modelled.
import { getTrack, gridSlots, TrackSpline } from '../src/track/trackdef.js';
import { KartBody, autopilotInput } from '../src/kart/kartphysics.js';
import { ROSTER } from '../src/kart/roster.js';
import { createAIField } from '../src/kart/ai.js';
const DT=1/60,f=(n,d=1)=>n.toFixed(d);
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
function race({track,difficulty,pace=1,seed=3,laps=3,boosts=0,parts=null}){
  const {def,spline}=getTrack(track);
  const slots=gridSlots(spline,def,8);
  const racer=ROSTER[0];
  const surface=def?.theme==='cloud'?'cloud':def?.theme==='circuit'?'grass':'sand';
  const player=new KartBody({spline,stats:racer.stats,startSlot:slots[0],surface,parts:parts||undefined});
  player.p.topSpeed*=pace; player.p.accelPower*=pace;
  const field=createAIField(spline,def,null,{difficulty,playerRacerId:racer.id,slots,playerSlot:0,seed});
  const toLine=((def.startT-player.lapT)+1)%1, finishAt=toLine+laps;
  const finish=new Array(field.drivers.length+1).fill(null);
  // boost points: evenly spaced through the racing part of the run
  const pts=[]; for(let i=0;i<boosts;i++) pts.push(toLine+0.35+(i*(laps-0.5))/Math.max(boosts,1));
  let t=0,prev=player.lapT,pProg=0,lapsBehind=null,bi=0;
  while(t<900&&finish.some(x=>x==null)){
    if(bi<pts.length&&pProg>=pts[bi]){ player.applyBoost(1.3,2.4,6); bi++; }
    player.update(DT,autopilotInput(player,spline,{drift:true}));
    pProg+=TrackSpline.deltaT(player.lapT,prev); prev=player.lapT;
    field.update(DT,{body:player,progress:pProg}); t+=DT;
    const prog=[pProg,...field.drivers.map(d=>d.progress)];
    for(let i=0;i<prog.length;i++) if(finish[i]==null&&prog[i]>=finishAt){finish[i]=t; if(lapsBehind==null)lapsBehind=finishAt-pProg;}
  }
  const order=finish.map((v,i)=>[v==null?Infinity:v,i]).sort((a,b)=>a[0]-b[0]);
  field.dispose();
  return {pos:order.findIndex(o=>o[1]===0)+1, gap:(finish[0]??Infinity)-order[0][0]};
}
const RACES=[{n:1,track:'oasis',difficulty:1},{n:2,track:'circuit',difficulty:2},{n:3,track:'cloud',difficulty:3}];
const SEEDS=[3,11,19,41,57];
console.log('\nboosts | '+RACES.map(R=>`race ${R.n}`.padStart(22)).join(''));
for(const b of [0,2,4,6]){
  const cells=RACES.map(R=>{
    const rs=SEEDS.map(s=>race({track:R.track,difficulty:R.difficulty,seed:s,boosts:b}));
    const p=rs.map(r=>r.pos);
    return `${Math.min(...p)}-${Math.max(...p)} (m${f(mean(p))}) ${f(mean(rs.map(r=>r.gap)),1)}s`.padStart(22);
  });
  console.log(String(b).padStart(6)+' | '+cells.join(''));
}

import { race } from './w4-r2.mjs';
const SEEDS=[3,11,19,41,57,2,7,23,64,88,101];
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const RACES=[{n:1,track:'oasis',difficulty:1},{n:2,track:'circuit',difficulty:2},{n:3,track:'cloud',difficulty:3}];
for(const pace of [1.0,0.85]){
  for(const R of RACES){
    const rs=SEEDS.map(s=>race({track:R.track,difficulty:R.difficulty,pace,seed:s}));
    const p=rs.map(r=>r.pos);
    console.log(`pace ${(pace*100).toFixed(0)}% race ${R.n}: ${p.join(' ')}  mean ${mean(p).toFixed(2)}  wins ${p.filter(x=>x===1).length}  worstLb ${Math.max(...rs.map(r=>r.lapsBehind)).toFixed(2)}`);
  }
}

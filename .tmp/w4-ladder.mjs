import { race } from './w4-run.mjs';
const f=(n,d=1)=>n.toFixed(d);
const SEEDS=[3,11,19,41,57];
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
for (const pace of [1.0,0.85,0.70]){
  const row=[1,2,3].map(d=>{
    const r=SEEDS.map(s=>race({track:'oasis',difficulty:d,pace,seed:s}));
    return `d${d}: ${f(mean(r.map(x=>x.pos)))} (lb ${f(Math.max(...r.map(x=>x.lapsBehind)),2)})`;
  });
  console.log(`oasis ladder @ ${f(pace*100,0)}%: `, row.join('   '));
}

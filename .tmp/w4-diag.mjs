import { race } from './w4-aibal.mjs';
const f=(n,d=2)=>n.toFixed(d);
for (const tr of ['oasis','circuit','cloud']) {
  const row=[];
  for (const d of [0,0.2,0.4,0.6,0.8,1.0]) {
    const rs=[3,11,19].map(s=>race({track:tr,difficulty:d,pace:1,seed:s}));
    const pt=rs.reduce((a,r)=>a+r.playerTime,0)/rs.length;
    const wt=rs.reduce((a,r)=>a+r.winTime,0)/rs.length;
    row.push(`d${d}: P${f(pt,1)} W${f(wt,1)}`);
  }
  console.log(tr.padEnd(9), row.join('  '));
}

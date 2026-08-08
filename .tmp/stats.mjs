import { QUESTIONS } from '../src/race/quizdata.js';

const pct = (a,b)=> b? (100*a/b).toFixed(0)+'%' : '-';
function rankStats(qs, lang){
  let longest=0, shortest=0, mid=0, notLongest=0;
  for(const q of qs){
    const a=q[lang].a.map(s=>s.length);
    const c=a[q.correct];
    const others=a.filter((_,k)=>k!==q.correct);
    const isLong = c>Math.max(...others);
    const isShort = c<Math.min(...others);
    if(isLong) longest++; else if(isShort) shortest++; else mid++;
    // "never pick longest" strategy: how often correct is NOT the strict longest -> but strategy must choose 1 of 3
  }
  return {n:qs.length, longest, shortest, mid};
}
// Strategy simulation: pick strictly-longest option (if tie, first of tied). Score.
function strat(qs, lang, mode){
  let hit=0;
  for(const q of qs){
    const a=q[lang].a.map(s=>s.length);
    let idx;
    if(mode==='long') idx = a.indexOf(Math.max(...a));
    else if(mode==='short') idx = a.indexOf(Math.min(...a));
    else { // mid: sort by len, pick middle
      const order=a.map((L,i)=>[L,i]).sort((x,y)=>x[0]-y[0]);
      idx=order[1][1];
    }
    if(idx===q.correct) hit++;
  }
  return hit;
}
const tiers=[1,2,3];
console.log('lang tier  n  strictLongest strictShortest middle | pickLongest pickShortest pickMiddle');
for(const lang of ['he','en']){
  for(const t of ['all',...tiers]){
    const qs = t==='all'?QUESTIONS:QUESTIONS.filter(q=>q.tier===t);
    const r=rankStats(qs,lang);
    console.log(lang, t, r.n,
      `${r.longest} (${pct(r.longest,r.n)})`,
      `${r.shortest} (${pct(r.shortest,r.n)})`,
      `${r.mid} (${pct(r.mid,r.n)})`,
      '|',
      `${strat(qs,lang,'long')} (${pct(strat(qs,lang,'long'),r.n)})`,
      `${strat(qs,lang,'short')} (${pct(strat(qs,lang,'short'),r.n)})`,
      `${strat(qs,lang,'mid')} (${pct(strat(qs,lang,'mid'),r.n)})`);
  }
}
// mean length rank of correct
for(const lang of ['he','en']){
  let sum=0;
  for(const q of QUESTIONS){
    const a=q[lang].a.map(s=>s.length);
    const order=a.map((L,i)=>[L,i]).sort((x,y)=>y[0]-x[0]); // desc
    sum += order.findIndex(o=>o[1]===q.correct)+1;
  }
  console.log(lang,'mean length-rank of correct (1=longest,3=shortest):',(sum/QUESTIONS.length).toFixed(2));
}
// avg char len correct vs distractor
for(const lang of ['he','en']){
  let c=0,cn=0,d=0,dn=0;
  for(const q of QUESTIONS) q[lang].a.forEach((s,i)=>{ if(i===q.correct){c+=s.length;cn++;} else {d+=s.length;dn++;} });
  console.log(lang,'avg correct len',(c/cn).toFixed(1),'avg distractor len',(d/dn).toFixed(1));
}

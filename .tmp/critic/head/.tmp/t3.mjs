import { QUESTIONS } from '../src/race/quizdata.js';
const pct=a=>(100*a).toFixed(0)+'%';
function elim(qs,lang){
  // eliminate strictly-longest (if exists), guess uniformly among rest
  let e=0;
  for(const q of qs){
    const a=q[lang].a.map(s=>s.length);
    const mx=Math.max(...a);
    const nMax=a.filter(l=>l===mx).length;
    let pool;
    if(nMax===1) pool=a.map((l,i)=>i).filter(i=>a[i]!==mx); else pool=[0,1,2];
    e += pool.includes(q.correct)? 1/pool.length : 0;
  }
  return e/qs.length;
}
function elimShort(qs,lang){
  let e=0;
  for(const q of qs){
    const a=q[lang].a.map(s=>s.length);
    const mn=Math.min(...a);
    const nMin=a.filter(l=>l===mn).length;
    let pool = nMin===1 ? a.map((l,i)=>i).filter(i=>a[i]!==mn) : [0,1,2];
    e += pool.includes(q.correct)? 1/pool.length : 0;
  }
  return e/qs.length;
}
function best(qs,lang){ // eliminate BOTH extremes -> pick middle
  let h=0; for(const q of qs){ const a=q[lang].a.map(s=>s.length);
    const o=a.map((L,i)=>[L,i]).sort((x,y)=>x[0]-y[0]); if(o[1][1]===q.correct)h++; }
  return h/qs.length;
}
console.log('lang tier n | pickLongest elimLongest elimShortest pickMiddle');
for(const lang of ['he','en']) for(const t of ['all',1,2,3]){
  const qs=t==='all'?QUESTIONS:QUESTIONS.filter(q=>q.tier===t);
  let pl=0; for(const q of qs){const a=q[lang].a.map(s=>s.length); if(a.indexOf(Math.max(...a))===q.correct)pl++;}
  console.log(lang,t,qs.length,'|',pct(pl/qs.length),pct(elim(qs,lang)),pct(elimShort(qs,lang)),pct(best(qs,lang)));
}

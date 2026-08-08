import { QUESTIONS } from '../src/race/quizdata.js';
const pct=(a,b)=>b?(100*a/b).toFixed(0)+'%':'-';
const PATS = {
  he: {
    comma: /,/, ki: /\bכי\b/, digit: /\d/,
    hedge: /(תלוי|בערך|בדרך כלל|לפעמים|יכול|עשוי|לרוב|בערך|לא בהכרח|לפעמים)/,
    absolute: /(תמיד|אף פעם|לעולם|בכל מצב|בכל מקרה|הכל|כל דבר)/,
    dash: /—|–/, quote: /"/, question: /\?/,
  },
  en: {
    comma: /,/, because: /\bbecause\b/i, digit: /\d/,
    hedge: /\b(depends|usually|sometimes|roughly|about|might|can|may|often|not necessarily)\b/i,
    absolute: /\b(always|never|every|all|everything)\b/i,
    dash: /—|–/, quote: /"/, question: /\?/,
  }
};
for(const lang of ['he','en']){
  console.log('---',lang);
  for(const [name,re] of Object.entries(PATS[lang])){
    let hit=0,hc=0, onlyCorrect=0, onlyWrong=0, onlyOpt=0;
    for(const q of QUESTIONS){
      const flags=q[lang].a.map(s=>re.test(s));
      flags.forEach((f,i)=>{ if(f){hit++; if(i===q.correct)hc++;} });
      const n=flags.filter(Boolean).length;
      if(n===1){ onlyOpt++; if(flags[q.correct]) onlyCorrect++; else onlyWrong++; }
    }
    console.log(`  ${name.padEnd(10)} opts=${hit} correct=${hc} (${pct(hc,hit)})   uniqueIn1opt=${onlyOpt} thatOptCorrect=${onlyCorrect} (${pct(onlyCorrect,onlyOpt)})`);
  }
}
// first-word tell
for(const lang of ['he','en']){
  const m=new Map();
  for(const q of QUESTIONS) q[lang].a.forEach((s,i)=>{
    const w=s.split(/\s+/)[0];
    const e=m.get(w)||[0,0]; e[0]++; if(i===q.correct)e[1]++; m.set(w,e);
  });
  console.log('---first words',lang);
  [...m.entries()].filter(([,v])=>v[0]>=5).sort((a,b)=>b[1][0]-a[1][0]).forEach(([w,v])=>console.log(`  ${w} n=${v[0]} correct=${v[1]} ${pct(v[1],v[0])}`));
}
// authored correct index by tier
const byTier={};
for(const q of QUESTIONS){ (byTier[q.tier] ||= [0,0,0])[q.correct]++; }
console.log('authored correct index by tier',JSON.stringify(byTier));
// topic x tier
const tt={};
for(const q of QUESTIONS){ (tt[q.topic] ||= {1:0,2:0,3:0})[q.tier]++; }
console.log(JSON.stringify(tt,null,0));

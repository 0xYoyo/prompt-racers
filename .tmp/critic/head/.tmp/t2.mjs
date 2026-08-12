import { QUESTIONS } from '../src/race/quizdata.js';
const pct=(a,b)=>b?(100*a/b).toFixed(0)+'%':'-';
// gendered forms in HE
const GEND=/(\bאתה\b|\bאת\b|שלך|\bתכתוב\b|\bתבקש\b|\bכתוב\b|\bבקש\b|\bתנסה\b|\bתזכור\b|\bתשאל\b|\bתבדוק\b|\bשלכם\b|\bתעשה\b)/;
for(const q of QUESTIONS){
  for(const [k,v] of [['q',q.he.q],['why',q.he.why],...q.he.a.map((s,i)=>['a'+i,s])]){
    const m=v.match(GEND); if(m) console.log('GENDER',q.id,k,m[0],'::',v);
  }
}
// narrow absolutes per language
const A={he:/(תמיד|אף פעם|לעולם|בכל מצב|בכל מקרה)/, en:/\b(always|never|every time|in every case)\b/i};
for(const lang of ['he','en']){
  let h=0,c=0;
  for(const q of QUESTIONS) q[lang].a.forEach((s,i)=>{ if(A[lang].test(s)){h++; if(i===q.correct)c++;} });
  console.log('absolutes',lang,`${c}/${h} = ${pct(c,h)}`);
}
// "verb + תמיד" postposed vs sentence-initial תמיד
for(const q of QUESTIONS) q.he.a.forEach((s,i)=>{
  if(/תמיד/.test(s)) console.log('TAMID', i===q.correct?'CORRECT':'wrong ', q.id, s);
});
console.log('---');
for(const q of QUESTIONS) q.en.a.forEach((s,i)=>{
  if(/\balways\b/i.test(s)) console.log('ALWAYS', i===q.correct?'CORRECT':'wrong ', q.id, s);
});
// hedge-only tell (exactly one option hedged)

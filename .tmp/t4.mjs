import { QUESTIONS } from '../src/race/quizdata.js';
const pct=(a,b)=>b?(100*a/b).toFixed(0)+'%':'-';
const rules={
  'he starts רק': q=>q.he.a.map(s=>/^רק\b/.test(s)),
  'he starts כן,': q=>q.he.a.map(s=>/^כן/.test(s)),
  'he contains רק ': q=>q.he.a.map(s=>/(^|\s)רק\s/.test(s)),
  'en starts Only': q=>q.en.a.map(s=>/^Only\b/i.test(s)),
  'en starts Yes': q=>q.en.a.map(s=>/^Yes\b/i.test(s)),
  'en contains only': q=>q.en.a.map(s=>/\bonly\b/i.test(s)),
  'he אין/אף': q=>q.he.a.map(s=>/(^אין |אף אחד|אף פעם)/.test(s)),
  'he word count >=8': q=>q.he.a.map(s=>s.split(/\s+/).length>=8),
  'he word count <=4': q=>q.he.a.map(s=>s.split(/\s+/).length<=4),
};
for(const [n,f] of Object.entries(rules)){
  let h=0,c=0; for(const q of QUESTIONS){const fl=f(q); fl.forEach((b,i)=>{if(b){h++;if(i===q.correct)c++;}});}
  console.log(n.padEnd(22), `${c}/${h} = ${pct(c,h)}`);
}
// spelling variants
const txt=JSON.stringify(QUESTIONS);
for(const w of ['colour','color','summarise','summarize','realise','realize','favour','favor','practise','toward','towards'])
  { const n=(txt.match(new RegExp(w,'gi'))||[]).length; if(n) console.log('spell',w,n); }

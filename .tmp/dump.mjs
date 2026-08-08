import { QUESTIONS } from '../src/race/quizdata.js';
let out='';
for(const q of QUESTIONS){
  out+=`\n[${q.id}] t${q.tier} ${q.topic}\nHE Q: ${q.he.q}\n`;
  q.he.a.forEach((s,i)=>out+=`  ${i===q.correct?'*':' '}${i} (${s.length}) ${s}\n`);
  out+=`HE WHY: ${q.he.why}\nEN Q: ${q.en.q}\n`;
  q.en.a.forEach((s,i)=>out+=`  ${i===q.correct?'*':' '}${i} (${s.length}) ${s}\n`);
  out+=`EN WHY: ${q.en.why}\n`;
}
console.log(out);

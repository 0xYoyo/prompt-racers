import * as P from '../../src/garage/prompts.js';
const m=new Map();
for(const part of P.KART_SLOTS)for(const row of ['goal','constraint','style'])for(const o of P.optionsFor(row,part)){
  const k=row+'|'+o.subHe; (m.get(k)||m.set(k,[]).get(k)).push(o.id);
}
let shared=0,tot=0;
for(const [k,v] of m){tot++;if(v.length>1){shared++;console.log(v.length+'x  "'+k.split('|')[1]+'"  ->  '+v.join(', '));}}
console.log('\n'+shared+' subtitle strings shared by 2+ options, out of '+tot+' distinct subtitles across 48 options');

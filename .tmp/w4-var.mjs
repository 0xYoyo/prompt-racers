// Build a variant copy of src/kart/ai.js in .tmp/ with constants replaced,
// so balance sweeps never touch the shared working tree.
import fs from 'fs';
const SRC='/Users/yoyopc/repos/kart-project/src/kart/ai.js';
export function variant(tag, subs){
  let s=fs.readFileSync(SRC,'utf8');
  for(const [from,to] of subs){
    if(!s.includes(from)) throw new Error('no match: '+from);
    s=s.split(from).join(to);
  }
  s=s.replace(/from '\.\.\//g,"from '/Users/yoyopc/repos/kart-project/src/").replace(/from '\.\//g,"from '/Users/yoyopc/repos/kart-project/src/kart/");
  const p=`/Users/yoyopc/repos/kart-project/.tmp/w4v_${tag}.js`;
  fs.writeFileSync(p,s);
  return p;
}

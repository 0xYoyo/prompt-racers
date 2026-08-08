const REST=['zamzum','tipa','kaftor','raash'];
const P=[10,8,6,5,4,3,2,1];
const CLEAR=[['zuzi','nitzotz','plada','nurit',...REST],['zuzi','nitzotz','plada','nurit',...REST],['zuzi','nitzotz','plada','nurit',...REST]];
const TPW=[['zuzi','nitzotz','plada','nurit',...REST],['plada','zuzi','nitzotz','nurit',...REST],['nitzotz','nurit','zuzi','plada',...REST]];
const TRW=[['nitzotz','zuzi','plada','nurit',...REST],['plada','nitzotz','zuzi','nurit',...REST],['zuzi','nurit','nitzotz','plada',...REST]];
const WD=[['zuzi','nitzotz','plada','nurit',...REST],['zuzi','nitzotz','plada','nurit',...REST],['plada','nurit','zamzum','nitzotz','tipa','kaftor','raash','zuzi']];
function stand(orders, useWins){
  const acc=new Map();
  orders.forEach(o=>o.forEach((id,i)=>{const e=acc.get(id)||{points:0,wins:0,bestFinal:99};e.points+=P[i];if(i===0)e.wins++;acc.set(id,e);}));
  orders.at(-1).forEach((id,i)=>{acc.get(id).bestFinal=i+1;});
  return [...acc].map(([id,e])=>({id,...e,isPlayer:id==='nitzotz'}))
    .sort((a,b)=>(b.points-a.points)||(useWins?(b.wins-a.wins):0)||(a.bestFinal-b.bestFinal)||(a.isPlayer?-1:b.isPlayer?1:0))
    .map(e=>`${e.id}:${e.points}`).join(' ');
}
for(const [n,l] of [['CLEAR',CLEAR],['TIE_PLAYER_WINS',TPW],['TIE_RIVAL_WINS',TRW],['WINS_DECIDE(mine)',WD]]){
  const a=stand(l,true), b=stand(l,false);
  console.log(`${n.padEnd(18)} ${a===b?'IDENTICAL — wins term unobservable':'DIFFERS  ✓ catches removal'}`);
  if(a!==b){console.log('   with wins: '+a+'\n   without  : '+b);}
}

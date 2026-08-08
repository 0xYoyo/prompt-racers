import puppeteer from 'puppeteer-core';
import { readFileSync } from 'fs';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pairs=process.argv.slice(2);
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
const p=await b.newPage();
await p.goto('about:blank');
for(let i=0;i<pairs.length;i+=2){
  const [a,c]=[pairs[i],pairs[i+1]];
  const da='data:image/png;base64,'+readFileSync(a).toString('base64');
  const dc='data:image/png;base64,'+readFileSync(c).toString('base64');
  const r=await p.evaluate(async(u1,u2)=>{
    const ld=u=>new Promise(res=>{const im=new Image();im.onload=()=>res(im);im.src=u;});
    const [A,B]=await Promise.all([ld(u1),ld(u2)]);
    if(A.width!==B.width||A.height!==B.height) return {err:'size mismatch',a:[A.width,A.height],b:[B.width,B.height]};
    const cv=document.createElement('canvas');cv.width=A.width;cv.height=A.height;const x=cv.getContext('2d');
    x.drawImage(A,0,0);const ia=x.getImageData(0,0,cv.width,cv.height).data;
    x.clearRect(0,0,cv.width,cv.height);x.drawImage(B,0,0);const ib=x.getImageData(0,0,cv.width,cv.height).data;
    let n=0,max=0,sum=0;
    for(let k=0;k<ia.length;k+=4){const d=Math.abs(ia[k]-ib[k])+Math.abs(ia[k+1]-ib[k+1])+Math.abs(ia[k+2]-ib[k+2]);sum+=d;if(d>18)n++;if(d>max)max=d;}
    return {total:cv.width*cv.height,changed:n,pct:+(100*n/(cv.width*cv.height)).toFixed(2),maxDelta:max,meanDelta:+(sum/(ia.length/4)).toFixed(2)};
  },da,dc);
  console.log(a.split('/').pop(),'VS',c.split('/').pop(),JSON.stringify(r));
}
await b.close();

import fs from 'fs';
import path from 'path';
const files = fs.readdirSync('src',{recursive:true}).filter(f=>f.endsWith('.js')).map(f=>'src/'+f);
const re = /(שלך|לך|אותך|אליך|בשבילך|קיבלת|הרווחת|סיימת|בחרת|כתבת|ניצחת|לחצת|אספת|הצלחת|עשית|תוכל|תרצה|תראה)(?![א-ת])/;
for (const f of files) {
  const src = fs.readFileSync(f,'utf8');
  src.split('\n').forEach((L,i)=>{
    if (!/[֐-׿]/.test(L)) return;
    if (L.trim().startsWith('//') || L.trim().startsWith('*')) return;
    if (re.test(L)) console.log(`${f}:${i+1}  ${L.trim().slice(0,190)}`);
  });
}

import fs from 'fs';
const files = fs.readdirSync('src',{recursive:true}).filter(f=>f.endsWith('.js')).map(f=>'src/'+f);
// masculine singular imperatives / future-as-imperative, whole word
const words = ['בחר','לחץ','כתוב','תגיד','תבנה','סע','נסה','שים','קח','תראה','תזכור','בוא','הכנס','הוסף','חשוב','זכור','בדוק','תבדוק','תכתוב','תבחר','תלחץ','תנסה','הסתכל','שאל','תשאל','אמור','עשה','תעשה','המשך','תמשיך','צא','היכנס','גש','שחק','תשחק','חזור','תחזור','פתח','סגור','הפעל','בצע','קרא','למד','דמיין','תאר','הגדר','ודא'];
const re = new RegExp('(^|[^א-ת])(' + words.join('|') + ')(?![א-ת])','g');
for (const f of files) {
  fs.readFileSync(f,'utf8').split('\n').forEach((L,i)=>{
    if (!/[֐-׿]/.test(L)) return;
    const tr=L.trim();
    if (tr.startsWith('//')||tr.startsWith('*')) return;
    const m = [...L.matchAll(re)];
    if (m.length) console.log(`${f}:${i+1} <${m.map(x=>x[2]).join(',')}>  ${tr.slice(0,170)}`);
  });
}

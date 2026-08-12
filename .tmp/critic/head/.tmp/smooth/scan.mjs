import fs from 'fs';
const files = ['src/ui/i18n.js','src/ui/menus.js','src/ui/pause.js','src/ui/learn.js','src/race/quiz.js','src/race/race.js','src/race/hud.js','src/garage/garage.js','src/garage/prompts.js','src/garage/tips.js','src/kart/roster.js','src/audio/audio.js','src/race/quizdata.js','src/scenes.js'];
const pats = [
  ['2sg-poss שלך', /(^|[\s"'(,.־-])שלך([\s"'.,!?)־-]|$)/],
  ['2pl-poss שלכם', /שלכם/],
  ['2pl-verb ־תם', /(סיימתם|בחרתם|הרווחתם|לחצתם|קיבלתם|כתבתם|ניצחתם|התחלתם)/],
  ['2sg-verb', /(^|\s)(קיבלת|הרווחת|סיימת|בחרת|כתבת|ניצחת|לחצת)($|[\s.,!?"'])/],
  ['אתה/אתם', /(^|\s)(אתה|אתם|אותך|לך|אליך)($|[\s.,!?"'])/],
];
for (const f of files) {
  const src = fs.readFileSync(f,'utf8');
  const lines = src.split('\n');
  lines.forEach((L,i)=>{
    if (!/[֐-׿]/.test(L)) return;
    for (const [name,re] of pats) if (re.test(L)) console.log(`${f}:${i+1} [${name}] ${L.trim().slice(0,160)}`);
  });
}

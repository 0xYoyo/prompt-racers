// Regenerates progress.html from docs/status.json + whatever is in shots/.
// Run after every wave:  node tools/progress.mjs
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const status = JSON.parse(readFileSync(resolve(root, 'docs/status.json'), 'utf8'));

const shotDir = resolve(root, 'shots');
const shots = existsSync(shotDir)
  ? readdirSync(shotDir).filter(f => f.endsWith('.png'))
      .map(f => ({ f, m: statSync(resolve(shotDir, f)).mtimeMs, kb: statSync(resolve(shotDir, f)).size / 1024 }))
      .sort((a, b) => b.m - a.m)
  : [];

const STATE = {
  done: ['#7ee081', 'הושלם'], review: ['#ffb347', 'בביקורת'],
  building: ['#6fc3ff', 'בבנייה'], todo: ['#6b6b7a', 'ממתין'], gap: ['#ff6b6b', 'פער ידוע'],
};

const pct = status.subsystems.length
  ? Math.round(100 * status.subsystems.filter(s => s.state === 'done').length / status.subsystems.length) : 0;

// Group screenshots by subsystem prefix (e.g. "env-oasis-r2.png" -> "env").
const groups = {};
for (const s of shots) {
  if (s.f.startsWith('_')) continue;
  const key = s.f.split('-')[0];
  (groups[key] ||= []).push(s);
}

const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>מרוץ הפרומפטים — התקדמות</title>
<style>
 :root{--bg:#0e0e18;--panel:#1a1a28;--stroke:#2a2a3c;--txt:#f0ede6;--dim:#9a96a0;--gold:#ffc247}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--txt);
   font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;padding:32px;max-width:1400px;margin-inline:auto}
 h1{font-size:34px;font-weight:900;margin:0 0 4px;
   background:linear-gradient(180deg,#ffe9a8,#f59310);-webkit-background-clip:text;background-clip:text;color:transparent}
 .sub{color:var(--dim);margin-bottom:24px}
 .meter{height:12px;border-radius:99px;background:#22222f;overflow:hidden;margin:18px 0 28px}
 .meter>i{display:block;height:100%;background:linear-gradient(270deg,#ffc247,#ffe9a8);width:${pct}%}
 h2{font-size:20px;margin:34px 0 14px;border-bottom:1px solid var(--stroke);padding-bottom:8px}
 table{width:100%;border-collapse:collapse}
 td,th{padding:10px 12px;border-bottom:1px solid var(--stroke);text-align:start;vertical-align:top}
 th{color:var(--dim);font-size:12px;letter-spacing:.06em;font-weight:700}
 .pill{display:inline-block;padding:3px 12px;border-radius:99px;font-size:12px;font-weight:800;color:#12121c}
 .rounds{font-variant-numeric:tabular-nums;color:var(--dim);direction:ltr;unicode-bidi:isolate}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
 figure{margin:0;background:var(--panel);border:1px solid var(--stroke);border-radius:14px;overflow:hidden}
 figure img{width:100%;display:block;background:#000;cursor:zoom-in}
 figcaption{padding:8px 12px;font-size:12px;color:var(--dim);direction:ltr;unicode-bidi:isolate;text-align:left}
 .note{background:var(--panel);border:1px solid var(--stroke);border-inline-start:3px solid var(--gold);
   border-radius:10px;padding:12px 16px;margin:10px 0;font-size:14px}
 dialog{border:0;background:transparent;max-width:96vw;max-height:96vh;padding:0}
 dialog img{max-width:96vw;max-height:96vh}
 dialog::backdrop{background:rgba(0,0,0,.9)}
</style></head><body>
<h1>מרוץ הפרומפטים</h1>
<div class="sub">לוח התקדמות · גל ${status.wave} · עודכן ${status.updated}</div>
<div class="meter"><i></i></div>

<h2>מערכות</h2>
<table><thead><tr><th>מערכת</th><th>סטטוס</th><th>סבבי ביקורת</th><th>הערה</th></tr></thead><tbody>
${status.subsystems.map(s => {
  const [c, label] = STATE[s.state] || STATE.todo;
  return `<tr><td><b>${s.name}</b><br><span style="color:var(--dim);font-size:12px;direction:ltr;unicode-bidi:isolate">${s.files || ''}</span></td>
  <td><span class="pill" style="background:${c}">${label}</span></td>
  <td class="rounds">${s.rounds != null ? s.rounds + '/5' : '—'}</td>
  <td style="color:var(--dim)">${s.note || ''}</td></tr>`;
}).join('\n')}
</tbody></table>

${status.notes?.length ? `<h2>החלטות והערות</h2>${status.notes.map(n => `<div class="note">${n}</div>`).join('')}` : ''}

<h2>צילומי מסך (${shots.filter(s => !s.f.startsWith('_')).length})</h2>
${Object.keys(groups).sort().map(g => `
<h3 style="color:var(--dim);font-size:14px;margin:22px 0 10px;direction:ltr;unicode-bidi:isolate;text-align:left">${g}/</h3>
<div class="grid">${groups[g].map(s =>
  `<figure><img loading="lazy" src="shots/${s.f}" onclick="z(this.src)"><figcaption>${s.f} · ${s.kb.toFixed(0)}KB</figcaption></figure>`
).join('')}</div>`).join('')}

<dialog id="d" onclick="this.close()"><img id="di"></dialog>
<script>function z(s){di.src=s;d.showModal()}</script>
</body></html>`;

writeFileSync(resolve(root, 'progress.html'), html);
console.log(`progress.html regenerated — ${status.subsystems.length} subsystems, ${shots.length} shots, ${pct}% done`);

import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('file://' + process.cwd() + '/dist/index.html');
await p.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', {timeout:60000});
await p.evaluate(() => window.__DEBUG.goto('race', { track: 0 }));
console.log(await p.evaluate(() => {
  const s = window.__DEBUG.engine.active;
  const keys = Object.keys(s);
  const names = [];
  const roots = ['root','group','scene','world'].filter(k=>s[k]&&s[k].traverse);
  const r = s[roots[0]] || window.__DEBUG.engine.scene;
  let inst=[];
  r?.traverse?.(o=>{ if(o.isInstancedMesh) inst.push((o.name||'(anon)')+':'+o.count); });
  return { keys, roots, engineSceneHas: !!window.__DEBUG.engine.scene, inst: inst.slice(0,30), quizKeys: s.quiz?Object.keys(s.quiz):null };
}));
await b.close();

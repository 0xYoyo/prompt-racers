import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = '/Users/yoyopc/repos/kart-project/dist/index.html';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto('file://' + target, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
  await page.mouse.click(683, 400);
  for (let i = 0; i < 30; i++) { if (await page.evaluate(() => window.__AUDIO.ctx.state === 'running')) break; await sleep(100); }
  await page.evaluate(() => {
    const a = window.__AUDIO;
    const an = a.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
    a.master.connect(an); const buf = new Float32Array(an.fftSize);
    window.__measure = ms => new Promise(res => { let sum=0,n=0,peak=0;
      const iv = setInterval(() => { an.getFloatTimeDomainData(buf); let s=0,p=0;
        for (let i=0;i<buf.length;i++){const v=buf[i];s+=v*v;if(Math.abs(v)>p)p=Math.abs(v);}
        sum+=Math.sqrt(s/buf.length);n++;if(p>peak)peak=p;},20);
      setTimeout(()=>{clearInterval(iv);res({rms:sum/Math.max(1,n),peak});},ms);});
    window.__hush = async () => { a.stopMusic(0.05); a.stopEngine(); a.drift.stop(a.now,0.05); a.setAiEngines([]);
      await new Promise(r=>setTimeout(r,450)); };
  });
  await page.evaluate(() => window.__DEBUG.goto('select'));
  await sleep(500);
  const one = async (label, src, ms=1600) => {
    await page.evaluate(() => window.__hush());
    const m = await page.evaluate(async ({src,ms}) => { await new Function('a','bus',src)(window.__AUDIO, window.__AUDIO.bus); return window.__measure(ms); }, {src,ms});
    console.log(label.padEnd(22), JSON.stringify(m));
  };
  await one('music race oasis', `a.playMusic('race',{theme:'oasis'});`);
  await one('music menu', `a.playMusic('menu');`);
  await one('sfx token x5', `let i=0;const iv=setInterval(()=>{bus.emit('token:pickup',{combo:++i});if(i>4)clearInterval(iv);},160);`, 1200);
  await one('sfx collide wall', `bus.emit('kart:collide',{kind:'wall',speed:0.9});`, 900);
  await one('sfx quiz correct', `bus.emit('quiz:correct');`, 1200);
  await one('drift', `bus.emit('drift:start');let c=0;const iv=setInterval(()=>{c=Math.min(1,c+0.06);bus.emit('drift:charge',{charge:c});},40);setTimeout(()=>{clearInterval(iv);bus.emit('drift:end',{tier:2});},1000);`, 1200);
} finally { await browser.close(); }

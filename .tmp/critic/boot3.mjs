import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage();
p.on('pageerror',e=>{const m=(e.message||'').replace(/\s+/g,' ');console.log('ERR-TAIL:', m.slice(-220)); console.log('STACK:', (e.stack||'').split('\n').filter(l=>l.trim().startsWith('at')).slice(0,5).join(' | '));});
await p.goto('file://'+process.cwd()+'/.tmp/critic/build.html',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,5000));
await b.close();

import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
const p = await b.newPage();
await p.setContent(`<html dir="rtl"><body style="margin:0">
<input id="r" type="range" min="0" max="100" value="0" style="width:300px">
</body></html>`);
// value 0 then 100; find where the thumb is by clicking? Use keyboard instead:
await p.focus('#r');
const before = await p.$eval('#r', e=>e.value);
await p.keyboard.press('ArrowRight');
const afterRight = await p.$eval('#r', e=>e.value);
await p.keyboard.press('ArrowLeft');
const afterLeft = await p.$eval('#r', e=>e.value);
// where does a click at the left edge land?
const box = await p.$eval('#r', e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});
await p.mouse.click(box.x+10, box.y+box.h/2);
const clickLeft = await p.$eval('#r', e=>e.value);
await p.mouse.click(box.x+box.w-10, box.y+box.h/2);
const clickRight = await p.$eval('#r', e=>e.value);
console.log({before, afterRight, afterLeft, clickLeft, clickRight});
await b.close();

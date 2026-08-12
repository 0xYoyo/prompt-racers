// CRITIC — what rpm does the game actually spend its time at? (does the quiet end matter)
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = 'file://' + process.cwd() + '/.tmp/critic/build.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
await page.goto(target, { waitUntil: 'load', timeout: 90000 });
await page.evaluate(() => localStorage.setItem('promptracers.v1', JSON.stringify({ garageTokenIntroSeen: true, quizBoxIntroSeen: true })));
await page.goto(target, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
await page.mouse.click(683, 400); await sleep(600);
await page.evaluate(() => { window.__samples = []; window.__AUDIO.bus.on('kart:engine', p => window.__samples.push(p && p.rpm01)); });
await page.evaluate(() => window.__DEBUG.goto('race', { track: 0, difficulty: 1, autopilot: true }));
await sleep(500);
await page.evaluate(() => { window.__samples.length = 0; });
for (let i = 0; i < 90; i++) { await page.evaluate(() => window.__DEBUG.advance(0.5)); await sleep(25); }
const s = await page.evaluate(() => window.__samples.filter(x => typeof x === 'number'));
const bucket = [0, 0, 0, 0, 0];
for (const r of s) bucket[Math.min(4, Math.floor(r * 5))]++;
console.log('rpm01 histogram over ~45 race-seconds, n =', s.length);
const names = ['0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0'];
bucket.forEach((b, i) => console.log('  ' + names[i], (100 * b / s.length).toFixed(1) + '%'));
console.log('  min', Math.min(...s).toFixed(3), 'mean', (s.reduce((a, b) => a + b, 0) / s.length).toFixed(3), 'max', Math.max(...s).toFixed(3));
await browser.close();

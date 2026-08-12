// Wave-3 smoothing: measure the REAL cost of the quiz as a child experiences it.
// D16's "% of the race spent slowed" is meaningless under the D20 full freeze —
// race time does not advance at all while a panel is up. The honest metric is
// WALL CLOCK: how many times a race is interrupted, and for how long in total.
//
// Drives the real built game, autopilot, three races (difficulty 1/2/3 on tracks
// 0/1/2), carrying the championship's asked-ids forward so the tier mix is the
// one a real championship produces.
//
// BEACON MODEL. The AI racing line misses every beacon (they sit at 0.17x the
// half-width off centre, alternating sides), so an autopilot lap reports zero
// questions — which is not what a child gets. The child model here is "meets
// every beacon they drive past", i.e. six encounters per lap, with the game's
// OWN cooldown rule applied on top (COOLDOWN_S=10 after an answered question,
// COOLDOWN_IGNORED_S=24 after one that timed out). That is the upper bound on
// interruption count; a child who happens to be on the racing line gets fewer.
//
// Usage: node .tmp/smooth/pacing.mjs
import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dist = resolve(root, 'dist/index.html');

const ALL = [
  { key: 'quick', name: 'quick reader        (2s answer, 2s read)', answerAfter: 2, readAfter: 2 },
  { key: 'typical', name: 'typical child       (6s answer, 5s read)', answerAfter: 6, readAfter: 5 },
  { key: 'slow', name: 'slow reader         (14s answer, 10s read)', answerAfter: 14, readAfter: 10 },
  { key: 'timeout', name: 'never answers       (times out, 5s read)', answerAfter: null, readAfter: 5 },
  { key: 'natural', name: 'NATURAL beacon hits (racing line, 6s/5s)', answerAfter: 6, readAfter: 5, natural: true },
];
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const POLICIES = only ? ALL.filter(p => only.split(',').includes(p.key)) : ALL;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
await page.goto('file://' + dist, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });

const runRace = (trackIndex, policy, askedIds) => page.evaluate(async (trackIndex_, policy_, askedIds_) => {
  const D = window.__DEBUG;
  const FIXED = 1 / 60;
  const COOLDOWN_S = 10, COOLDOWN_IGNORED_S = 24, BEACONS_PER_LAP = 6;

  await D.goto('race', {
    track: trackIndex_, difficulty: trackIndex_ + 1, seed: 4242,
    autopilot: true, askedIds: askedIds_,
  });
  await new Promise(r => setTimeout(r, 120));
  const s = D.engine.active;
  if (!s || !s.quiz) return { error: 'not a race scene: ' + D.engine.activeName };
  const q = s.quiz;

  const key = code => dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));

  let frames = 0, frozen = 0, interrupts = 0, timeouts = 0;
  const inPhase = { question: 0, feedback: 0, resume: 0 };
  let phasePrev = 'idle', phaseFrames = 0, spanStart = 0;
  const spans = [], tiers = [];
  let cooldown = 0;
  let lastSlot = -1;

  const offOpen = D.bus.on('quiz:open', p => tiers.push(p.tier));
  const offClose = D.bus.on('quiz:close', r => {
    cooldown = r && r.timedOut ? COOLDOWN_IGNORED_S : COOLDOWN_S;
    if (r && r.timedOut) timeouts++;
  });

  const MAX = 60 * 600;
  while (frames < MAX && !s.state?.finished) {
    D.engine.time += FIXED;
    s.update(FIXED);
    frames++;
    if (cooldown > 0) cooldown = Math.max(0, cooldown - FIXED);

    // Dismiss the one-time explainers the way a child does — they freeze the sim.
    for (const sel of ['.grgtok-scrim', '.grg-meet-scrim']) {
      const scrim = document.querySelector(sel);
      if (scrim && scrim.offsetParent !== null) { scrim.querySelector('button')?.click(); }
    }

    // "Meets every beacon they drive past": six equally spaced points per lap.
    const prog = s.state?.progress ?? 0;
    const slot = Math.floor((prog % 1) * BEACONS_PER_LAP);
    if (slot !== lastSlot) {
      lastSlot = slot;
      if (!policy_.natural && q.phase === 'idle' && cooldown <= 0 && s.state?.phase === 'racing' && !s.state?.finished) {
        q.openQuestion();
      }
    }

    const ph = q.phase;
    if (ph !== phasePrev) {
      if (phasePrev === 'idle' && ph !== 'idle') { interrupts++; spanStart = frames; }
      if (ph === 'idle' && phasePrev !== 'idle') spans.push((frames - spanStart) / 60);
      phasePrev = ph; phaseFrames = 0;
    }
    if (ph !== 'idle') { frozen++; phaseFrames++; inPhase[ph] = (inPhase[ph] || 0) + 1; }

    const secs = phaseFrames / 60;
    if (ph === 'question' && policy_.answerAfter != null && secs >= policy_.answerAfter) key('Digit1');
    else if (ph === 'feedback' && secs >= policy_.readAfter) key('Space');
  }
  offOpen(); offClose();
  // race.js hands off to the results screen ~2.2s after the flag, on a timer.
  // Let that land here, or it lands in the middle of the NEXT race's setup.
  await new Promise(r => setTimeout(r, 3500));
  return {
    finished: !!s.state?.finished,
    lap: s.state?.lap,
    wall: frames / 60,
    frozen: frozen / 60,
    question: (inPhase.question || 0) / 60,
    feedback: (inPhase.feedback || 0) / 60,
    resume: (inPhase.resume || 0) / 60,
    interrupts, timeouts,
    spans: spans.map(x => +x.toFixed(1)),
    tiers,
    raceTimeMs: s.state?.timeMs ?? null,
    askedIds: q.askedIds ? [...q.askedIds] : [],
    place: s.state?.position,
  };
}, trackIndex, policy, askedIds);

try {
  for (const pol of POLICIES) {
    console.log('\n' + '='.repeat(96));
    console.log('  PLAYER: ' + pol.name);
    console.log('='.repeat(96));
    console.log('  race  laps   drive(s)  interrupts  frozen(s)  q/fb/resume(s)  %wall   avg span   tiers');
    const asked = [];
    for (let r = 0; r < 3; r++) {
      // Fresh save each race so the one-time explainers behave, but carry askedIds.
      const out = await runRace(r, pol, asked.slice());
      if (out.error) { console.log('   ' + (r + 1) + '  ERROR ' + out.error); continue; }
      asked.push(...(out.askedIds || []));
      const drive = out.wall - out.frozen;
      const meanTier = out.tiers.length
        ? (out.tiers.reduce((a, b) => a + b, 0) / out.tiers.length).toFixed(2) : '-';
      const avgSpan = out.spans.length
        ? (out.spans.reduce((a, b) => a + b, 0) / out.spans.length).toFixed(1) : '-';
      console.log(
        `   ${r + 1}     ${String(out.lap).padStart(2)}   ${drive.toFixed(1).padStart(8)}   `
        + `${String(out.interrupts).padStart(9)}   ${out.frozen.toFixed(1).padStart(8)}   `
        + `${(out.question.toFixed(0) + '/' + out.feedback.toFixed(0) + '/' + out.resume.toFixed(0)).padStart(13)}  `
        + `${((out.frozen / out.wall) * 100).toFixed(0).padStart(4)}%   `
        + `${avgSpan.padStart(6)}s   n=${out.tiers.length} mean ${meanTier} [${out.tiers.join('')}]`
        + (out.finished ? '' : '  ** DID NOT FINISH **'));
      console.log(`            wall ${out.wall.toFixed(1)}s   timeouts ${out.timeouts}   finish P${out.place}   spans: ${out.spans.join(', ')}`);
    }
  }
} finally {
  await browser.close();
}

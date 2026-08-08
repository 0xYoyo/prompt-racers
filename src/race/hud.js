// ═════════════════════════════════════════════════════════════════════════════
// IN-RACE HUD — מרוץ הפרומפטים
// ═════════════════════════════════════════════════════════════════════════════
//
// A DOM overlay (DECISIONS D4) driven by exactly two things:
//
//   1. `hud.update(state)` — called once per frame with the snapshot below.
//   2. `bus` events — one-shot, punctual things (pickups, lap flashes, countdown).
//
// It imports NO race logic, NO physics and NO AI. That is deliberate: it means the
// HUD can be previewed, screenshotted and critiqued standing on its own, and it means
// the whole thing ports to React by swapping this file's DOM for JSX.
//
// ── THE STATE SHAPE (everything is optional; missing fields keep the last value) ──
//
//   {
//     lap:          1,            // 1-based current lap
//     totalLaps:    3,
//     position:     3,            // 1-based race position
//     totalRacers:  8,
//     raceTimeMs:   84230,        // elapsed race time
//     lapTimeMs:    24440,        // elapsed time on the current lap
//     bestLapMs:    39120,        // best lap so far, null if none
//     speed:        19.4,         // METRES PER SECOND (converted to km/h here)
//     speed01:      0.62,         // optional 0..1 for the dial; derived from speed if absent
//     tokens:       12,           // AI tokens collected this race
//     comboCount:   3,            // >1 shows the combo multiplier
//     driftTier:    0|1|2|3,      // completed drift tiers (blue / orange / purple)
//     driftCharge01:0.58,         // 0..1 charge across the whole three-tier meter
//     drifting:     true,         // meter fades out when false and charge is 0
//     boosting:     false,
//     offTrack:     false,
//     wrongWay:     false,
//     isFinalLap:   false,
//     finished:     false,
//     rivalName:    'פלדה',       // display string of the nearest rival …
//     rivalNameKey: 'racer.plada.name',   // … or an i18n key (wins over rivalName)
//     rivalColor:   0x5f82b4,
//     rivalGapMs:   1200,         // >0 = rival is AHEAD of you (red), <0 = behind (green)
//     karts: [ { t, lateral, color, isPlayer } … ]   // for the minimap, one per racer
//   }
//
// ── BUS EVENTS CONSUMED ──
//   race:countdown {n}        3,2,1 then 0 for GO
//   race:start
//   race:lap {lap,totalLaps,lapTimeMs}
//   race:bestlap {ms}
//   race:finallap
//   race:position {from,to}
//   race:finish {position}
//   token:pickup {tokens,combo}
//   drift:tier {tier}
//   race:wrongway {on}
//   lang:changed              rebuilds the static labels in place
//
// ── PERFORMANCE ──
// Nothing is created per frame. Every element reference is cached, every write is
// guarded by a previous-value check, and all motion is `transform`/`opacity` or a
// Web Animations API one-shot (which never touches layout). At 60 Hz a typical frame
// writes 0–3 text nodes and one `transform`.
//
// ── RTL ──
// The HUD mirrors as a whole (logical properties throughout) because it is language.
// Two things deliberately do NOT mirror:
//   • the minimap — it is a map of the world; flipping it would send a kid the wrong
//     way round the circuit (see minimap.js).
//   • the speedometer sweep — the dial reads low-left to high-right in every language,
//     the same way a real one does; only the card's screen corner flips.
// ═════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { h, injectStyles } from '../ui/style.js';
import { registerStrings, t, num, ordinal, isRTL } from '../ui/i18n.js';
import { bus } from '../core/bus.js';
import { Minimap } from './minimap.js';
import { getTrack } from '../track/trackdef.js';
import { ROSTER, nameKey } from '../kart/roster.js';

/* ══════════════════════════════════════════════════════════════════ strings ══ */

// Two vocabulary rules the Wave-3 smoothing pass applied here, both of them
// "the same thing must have the same name on every screen":
//   • ADDRESS. The HUD spoke to the player in the second-person SINGULAR
//     ("סיימת", "ניצחת", "עקפת") while every menu, the results sheet and the
//     podium use the impersonal PLURAL ("סיימתם", "בחרתם", "שלכם"). Both are
//     gender-neutral in writing, so nothing was wrong — but a child met two
//     registers in one game. The plural is the house voice; the HUD now matches.
//   • DRIFT. The gauge was labelled "דריפט" while How-to-Play, the key hints and
//     the drift card all say "החלקה" / "מחליקים". One root, one word: החלקה.
registerStrings({
  he: {
    'hud.lap': 'הקפה',
    'hud.time': 'זמן',
    'hud.best': 'שיא',
    'hud.map': 'מפה',
    'hud.pos': 'מקום',
    'hud.tokens': 'טוקנים',
    'hud.drift': 'החלקה',
    'hud.kmh': 'קמ״ש',
    'hud.go': 'קדימה!',
    'hud.finalLap': 'הקפה אחרונה!',
    'hud.lapDone': 'סיימתם הקפה {n}',
    'hud.bestLap': 'ההקפה המהירה שלכם!',
    'hud.wrongWay': 'כיוון הפוך! מסתובבים',
    // Hebrew ordinals are words, so they need the "במקום ה…" frame to be
    // grammatical — and this is the same frame the results screen uses, so a
    // place reads identically in the race and on the sheet afterwards.
    'hud.overtake': 'עקפתם! עכשיו במקום ה{o}',
    'hud.overtaken': 'עקפו אתכם… במקום ה{o}',
    'hud.boost': 'טורבו!',
    'hud.finish': 'סיימתם במקום ה{o}!',
    'hud.win': 'ניצחתם!',
    'hud.combo': 'ברצף',
  },
  en: {
    'hud.lap': 'Lap',
    'hud.time': 'Time',
    'hud.best': 'Best',
    'hud.map': 'Map',
    'hud.pos': 'Pos',
    'hud.tokens': 'Tokens',
    'hud.drift': 'Drift',
    'hud.kmh': 'km/h',
    'hud.go': 'GO!',
    'hud.finalLap': 'Final lap!',
    'hud.lapDone': 'Lap {n} done',
    'hud.bestLap': 'Your best lap!',
    'hud.wrongWay': 'Wrong way! Turn around',
    'hud.overtake': 'Overtake! Now {o}',
    'hud.overtaken': 'Passed… now {o}',
    'hud.boost': 'BOOST!',
    'hud.finish': 'Finished {o}!',
    'hud.win': 'You win!',
    'hud.combo': 'in a row',
  },
});

/* ══════════════════════════════════════════════════════════════════════ css ══ */

const HUD_CSS = `
.hud-root{
  position:absolute; inset:0; pointer-events:none; overflow:hidden;
  font-family:var(--font); color:var(--txt);
  font-size:16px;                       /* every HUD size is em-relative to this */
  /* Same panel treatment as .panel/.panel-lift in ui/style.js — the HUD used to
     carry its own warm-brown card, which read as a different product the moment
     you went race → results → garage in one sitting. Only the shadow is heavier
     here, because this panel sits over moving gameplay rather than a scrim. */
  --hud-card:linear-gradient(180deg,rgba(52,52,72,.93),rgba(20,20,31,.95));
  --hud-edge:1px solid var(--stroke);
  --hud-sh:0 0 0 1px rgba(0,0,0,.45), 0 .5em 1.4em rgba(0,0,0,.5),
    inset 0 1px 0 rgba(255,255,255,.16), inset 0 -.5em 1em rgba(0,0,0,.28);
  contain:layout style;
}
/* School-laptop / short viewports: shrink the whole HUD from one number. */
@media (max-width:1400px){ .hud-root{font-size:14px} }
@media (max-height:780px){ .hud-root{font-size:13.5px} }
@media (max-width:1100px){ .hud-root{font-size:12.5px} }

.hud-root .hud-card{
  background:var(--hud-card); border:var(--hud-edge);
  border-radius:var(--r-m); box-shadow:var(--hud-sh);
}
/* Micro-labels have a hard 11px floor. Hebrew has no capitals and far less
   x-height contrast than Latin, so it degrades much faster at small sizes —
   and the audience is eight-year-olds. The em-relative size still shrinks the
   rest of the HUD on a small laptop; the labels simply stop following it down. */
.hud-root .label{font-size:max(11px,.6em);letter-spacing:.16em;color:var(--txt-dim);font-weight:800}
.rtl .hud-root .label{letter-spacing:.02em;font-size:max(11.5px,.66em)}
.hud-root .num{font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate}

/* ── lap counter ─────────────────────────────────────────────────────────── */
.hud-lap{padding:.42em .85em .5em; min-width:4.2em; text-align:start}
.hud-lap .lap-nums{direction:ltr;display:flex;align-items:baseline;gap:.08em;margin-top:.05em}
.rtl .hud-lap .lap-nums{justify-content:flex-end}
.hud-lap .lap-cur{font-size:2.35em;font-weight:900;line-height:.95;color:#fff;
  text-shadow:0 .06em 0 rgba(0,0,0,.55), 0 .18em .35em rgba(0,0,0,.5)}
.hud-lap .lap-tot{font-size:1.15em;font-weight:900;color:#9c9184;letter-spacing:-.02em}
.hud-lap.final .lap-cur{color:#ffd98a}
.hud-lap.final{box-shadow:var(--hud-sh),0 0 0 2px rgba(255,194,71,.55)}

/* ── race timer ──────────────────────────────────────────────────────────── */
.hud-timer{padding:.42em .95em .5em; text-align:end; min-width:6.1em}
.rtl .hud-timer{text-align:start}
.hud-timer .t-row{direction:ltr;display:flex;align-items:baseline;justify-content:flex-end;gap:.02em}
.rtl .hud-timer .t-row{justify-content:flex-start}
.hud-timer .t-main{font-size:2.05em;font-weight:900;color:#fff;line-height:.98;
  text-shadow:0 .06em 0 rgba(0,0,0,.55), 0 .18em .35em rgba(0,0,0,.5)}
.hud-timer .t-cs{font-size:1.2em;font-weight:900;color:#cdc3b4}
.hud-timer .t-best{display:flex;gap:.4em;align-items:baseline;justify-content:flex-end;
  margin-top:.18em;font-size:max(11px,.66em);font-weight:800;color:var(--txt-dim);direction:ltr}
.rtl .hud-timer .t-best{justify-content:flex-start}
.hud-timer .t-best.hide{visibility:hidden}
.hud-timer .t-best b{color:#ffc247}

/* ── minimap ─────────────────────────────────────────────────────────────── */
.hud-map{padding:.42em; line-height:0}
.hud-map .mm-canvas{display:block;border-radius:.7em}

/* ── position card ───────────────────────────────────────────────────────── */
.hud-pos{
  position:absolute; inset-inline-start:1.1em; inset-block-start:46%;
  padding:.34em 1em .48em; min-width:9.2em; max-width:16em;
}
.hud-pos .p-main{display:flex;align-items:baseline;gap:.3em}
.ltr .hud-pos .p-main{gap:.1em}
.hud-pos .p-n{font-size:3.15em;font-weight:900;line-height:.9;color:#fff;
  text-shadow:0 .05em 0 rgba(0,0,0,.5),0 .16em .3em rgba(0,0,0,.5)}
.hud-pos .p-sfx{font-size:1.02em;font-weight:900;color:#ffc247;letter-spacing:-.01em;
  white-space:nowrap;overflow:hidden;text-overflow:clip;max-width:7.2em}
.rtl .hud-pos .p-sfx{font-size:.95em}
.hud-pos .p-rule{height:1px;background:rgba(255,255,255,.13);margin:.18em 0 .3em}
.hud-pos .p-rival{display:flex;align-items:center;gap:.42em;font-size:.78em;font-weight:800}
.hud-pos .p-dot{width:.62em;height:.62em;border-radius:50%;background:#7fd2ff;flex:0 0 auto;
  box-shadow:0 0 .5em currentColor}
.hud-pos .p-name{color:#e6ded1;letter-spacing:.02em;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;max-width:7.6em}
.hud-pos .p-gap{margin-inline-start:auto;font-weight:900;color:#cfc6b8}
.hud-pos .p-gap.ahead{color:var(--good)} .hud-pos .p-gap.behind{color:var(--bad)}
.hud-pos.p-hide-rival .p-rule,.hud-pos.p-hide-rival .p-rival{display:none}
.hud-pos.lead .p-n{color:#ffe6ab}

/* ── token counter ───────────────────────────────────────────────────────── */
.hud-tokens{padding:.34em .8em .34em .5em;display:flex;align-items:center;gap:.5em}
.rtl .hud-tokens{padding:.34em .5em .34em .8em}
.hud-tokens .tk-glyph{width:2.1em;height:2.1em;flex:0 0 auto;filter:drop-shadow(0 0 .45em rgba(255,200,90,.6))}
.hud-tokens .tk-n{font-size:1.75em;font-weight:900;color:#ffe7b4;
  text-shadow:0 .06em 0 rgba(0,0,0,.5)}
.hud-tokens .tk-lbl{font-size:max(11px,.58em);letter-spacing:.12em;color:var(--txt-dim);font-weight:800}
.rtl .hud-tokens .tk-lbl{letter-spacing:.02em;font-size:max(11.5px,.64em)}
.hud-tokens .tk-combo{
  font-size:.82em;font-weight:900;color:#2a1c00;padding:.1em .5em;border-radius:999px;
  background:linear-gradient(180deg,#ffe9a8,#ffc247 60%,#f59310);
  box-shadow:0 .12em 0 #a4620a; direction:ltr; opacity:0; transform:scale(.6);
  transition:opacity .18s var(--ease),transform .18s var(--ease);
}
.hud-tokens .tk-combo.on{opacity:1;transform:none}

/* ── drift meter ─────────────────────────────────────────────────────────── */
.hud-drift{
  position:absolute; inset-block-end:1.7em; left:50%; transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center; gap:.4em;
  opacity:0; transition:opacity .18s var(--ease);
}
.hud-drift.on{opacity:1}
.hud-drift .d-lbl{font-size:max(11px,.72em);letter-spacing:.18em;font-weight:900;color:#e8dcc6;
  text-shadow:0 .1em .3em rgba(0,0,0,.8)}
.rtl .hud-drift .d-lbl{letter-spacing:.08em;font-size:max(11.5px,.8em)}
.hud-drift .d-track{display:flex;gap:.34em}
.hud-drift .d-seg{
  position:relative;width:4.2em;height:.92em;border-radius:999px;overflow:hidden;
  background:rgba(12,12,20,.8);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.3),0 .2em .6em rgba(0,0,0,.7);
}
.hud-drift .d-seg>b{
  position:absolute;inset:0;border-radius:999px;display:block;
  transform:scaleX(0);transform-origin:left center;
  transition:transform .06s linear;
}
.rtl .hud-drift .d-seg>b{transform-origin:right center}
.hud-drift .d-seg.t1>b{background:linear-gradient(90deg,#4fb9ff,#9fe0ff)}
.hud-drift .d-seg.t2>b{background:linear-gradient(90deg,#ff9d3c,#ffd07a)}
.hud-drift .d-seg.t3>b{background:linear-gradient(90deg,#c07cff,#ecc4ff)}
.hud-drift .d-seg.lit{box-shadow:inset 0 0 0 1px rgba(255,255,255,.5),0 0 .8em currentColor,0 .2em .5em rgba(0,0,0,.5)}
.hud-drift .d-seg.t1.lit{color:#4fb9ff} .hud-drift .d-seg.t2.lit{color:#ff9d3c}
.hud-drift .d-seg.t3.lit{color:#c07cff}

/* ── speedometer ─────────────────────────────────────────────────────────── */
.hud-speedo{padding:.32em .45em .1em; width:8.1em}
.hud-speedo .sp-wrap{position:relative;width:100%;aspect-ratio:1/.94;direction:ltr}
.hud-speedo svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.hud-speedo .sp-read{
  position:absolute;inset-inline:0;bottom:.35em;display:flex;align-items:baseline;
  justify-content:center;gap:.22em;direction:ltr;
}
.hud-speedo .sp-n{font-size:1.9em;font-weight:900;color:#fff;line-height:1;
  text-shadow:0 .06em 0 rgba(0,0,0,.6)}
.hud-speedo .sp-u{font-size:max(11px,.56em);font-weight:800;letter-spacing:.02em;color:var(--txt-dim)}
.hud-speedo.boost .sp-n{color:#bff0ff}

/* ── countdown ───────────────────────────────────────────────────────────── */
.hud-count{
  position:absolute; inset-inline:0; inset-block-start:21%;
  display:flex; flex-direction:column; align-items:center; gap:.7em;
  opacity:0; transition:opacity .2s var(--ease);
}
.hud-count.on{opacity:1}
.hud-count .gantry{
  display:flex;gap:.95em;padding:.6em .95em;border-radius:999px;direction:ltr;
  background:linear-gradient(180deg,#3d4a3f,#1b2320);
  border:1px solid rgba(255,255,255,.14);
  box-shadow:0 .6em 1.6em rgba(0,0,0,.6), inset 0 .12em 0 rgba(255,255,255,.14);
}
.hud-count .gantry i{
  width:1.95em;height:1.95em;border-radius:50%;display:block;
  background:radial-gradient(circle at 34% 30%,#3a3f3c,#14171a 70%);
  box-shadow:inset 0 .1em .3em rgba(0,0,0,.8);
  transition:background .12s linear, box-shadow .12s linear;
}
.hud-count .gantry i.red{
  background:radial-gradient(circle at 34% 30%,#ffb0a0,#e0362a 55%,#7d1710 100%);
  box-shadow:0 0 1.1em rgba(255,80,60,.85), inset 0 .1em .25em rgba(255,255,255,.35);
}
.hud-count .gantry i.green{
  background:radial-gradient(circle at 34% 30%,#d6ffbe,#5fd44a 52%,#227d1c 100%);
  box-shadow:0 0 1.3em rgba(120,240,90,.9), inset 0 .1em .25em rgba(255,255,255,.4);
}
.hud-count .c-big{
  font-size:11.5em;font-weight:900;line-height:.84;letter-spacing:-.035em;
  -webkit-text-stroke:.028em rgba(24,14,4,.5); paint-order:stroke fill;
  background:linear-gradient(180deg,#fff 6%,#ffe08e 45%,#f5a218 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 .04em 0 rgba(0,0,0,.7)) drop-shadow(0 .09em .16em rgba(0,0,0,.6));
}
.hud-count .c-big.go{
  font-size:9em;
  background:linear-gradient(180deg,#e8ffd6 6%,#8ce86a 48%,#35a52c 100%);
  -webkit-background-clip:text;background-clip:text;
}

/* ── banners & notes ─────────────────────────────────────────────────────── */
.hud-banner{
  position:absolute; inset-inline:0; inset-block-start:30%;
  display:flex;flex-direction:column;align-items:center;gap:.25em;
  opacity:0; visibility:hidden;
}
.hud-banner.on{opacity:1;visibility:visible}
.hud-banner .b-txt{
  font-size:3.6em;font-weight:900;letter-spacing:-.02em;line-height:1;text-align:center;
  background:linear-gradient(180deg,#fff 6%,#ffdd8c 46%,#f2960f 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 .045em 0 rgba(0,0,0,.6)) drop-shadow(0 .09em .16em rgba(0,0,0,.6));
  padding-inline:.3em;
}
.hud-banner .b-sub{font-size:.95em;font-weight:800;color:#f0e6d4;
  text-shadow:0 .1em .4em rgba(0,0,0,.85)}
.hud-banner.good .b-txt{background:linear-gradient(180deg,#eaffdd 6%,#95ea75 48%,#33a12b 100%);
  -webkit-background-clip:text;background-clip:text}
.hud-banner .b-rule{width:7em;height:.16em;border-radius:999px;
  background:linear-gradient(90deg,transparent,#ffc247,transparent)}

.hud-notes{
  position:absolute; inset-inline:0; inset-block-start:8.6em;
  display:flex;flex-direction:column;align-items:center;gap:.35em;
}
.hud-note{
  display:flex;align-items:center;gap:.45em;padding:.32em .95em;border-radius:999px;
  background:linear-gradient(180deg,rgba(58,50,48,.94),rgba(20,18,24,.95));
  border:1px solid rgba(255,255,255,.13); box-shadow:0 .4em 1em rgba(0,0,0,.5);
  font-size:.86em;font-weight:800;color:#f0e6d4; white-space:nowrap;
  opacity:0; visibility:hidden;
}
.hud-note.on{opacity:1;visibility:visible}
.hud-note .n-ico{font-size:1.05em}
.hud-note.up{color:#c8f6b7} .hud-note.down{color:#ffc2b6}
.hud-note.gold{color:#ffe0a0}

.hud-wrong{
  position:absolute; inset-inline:0; inset-block-start:41%;
  display:flex;flex-direction:column;align-items:center;gap:.3em;
  opacity:0; visibility:hidden; transition:opacity .15s linear;
}
.hud-wrong.on{opacity:1;visibility:visible;animation:hudWrong 1s steps(1,end) infinite}
.hud-wrong .w-ico{font-size:2.6em;line-height:1;filter:drop-shadow(0 .08em .2em rgba(0,0,0,.7))}
.hud-wrong .w-txt{font-size:1.5em;font-weight:900;color:#ff8f7a;
  text-shadow:0 .06em 0 rgba(0,0,0,.6),0 .1em .5em rgba(0,0,0,.8)}
@keyframes hudWrong{0%,60%{opacity:1}61%,100%{opacity:.25}}

/* ── full-screen feedback (never covers the road, only the edges) ────────── */
.hud-fx{position:absolute;inset:0;pointer-events:none}
.hud-fx>div{position:absolute;inset:0;opacity:0;transition:opacity .18s linear}
.fx-boost{background:
  radial-gradient(ellipse 66% 62% at 50% 52%,rgba(255,200,110,0) 62%,rgba(255,176,64,.34) 100%),
  radial-gradient(ellipse 120% 55% at 50% 110%,rgba(255,150,40,.28),rgba(255,150,40,0) 70%)}
.fx-off{background:
  radial-gradient(ellipse 66% 60% at 50% 52%,rgba(0,0,0,0) 52%,rgba(96,60,26,.6) 100%)}
.fx-final{background:
  radial-gradient(ellipse 70% 66% at 50% 52%,rgba(0,0,0,0) 66%,rgba(255,180,60,.26) 100%)}
.hud-fx .fx-final.on{animation:hudFinalPulse 1.6s ease-in-out infinite}
@keyframes hudFinalPulse{0%,100%{opacity:.28}50%{opacity:.7}}

@media (prefers-reduced-motion:reduce){
  .hud-root *,.hud-root *::before,.hud-root *::after{
    animation:none !important; transition-duration:.01ms !important;
  }
}
`;

function injectHudCSS() {
  injectStyles();
  if (document.getElementById('pr-hud-style')) return;
  const el = document.createElement('style');
  el.id = 'pr-hud-style';
  el.textContent = HUD_CSS;
  document.head.appendChild(el);
}

/* ══════════════════════════════════════════════════════════════════ helpers ══ */

const REDUCED = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hex = c => (typeof c === 'number'
  ? '#' + (c >>> 0 & 0xffffff).toString(16).padStart(6, '0') : (c || '#ffffff'));

/** m:ss + .hh split so the hundredths can be typeset smaller, as the reference does. */
function splitTime(ms) {
  if (ms == null || !isFinite(ms)) return ['-:--', '.--'];
  const v = Math.max(0, ms);
  const m = Math.floor(v / 60000);
  const s = Math.floor((v % 60000) / 1000);
  const c = Math.floor((v % 1000) / 10);
  return [`${m}:${String(s).padStart(2, '0')}`, `.${String(c).padStart(2, '0')}`];
}

/** Signed gap, always +/- prefixed and to hundredths, like a real timing screen. */
function gapText(ms) {
  if (ms == null || !isFinite(ms)) return '';
  const a = Math.abs(ms);
  const sign = ms >= 0 ? '+' : '−';
  if (a >= 60000) {
    const m = Math.floor(a / 60000), s = ((a % 60000) / 1000);
    return `${sign}${m}:${s.toFixed(2).padStart(5, '0')}`;
  }
  return `${sign}${(a / 1000).toFixed(2)}`;
}

/** WAAPI one-shot; silently no-ops under reduced motion. Never causes layout. */
function pop(el, frames, opts) {
  if (!el || REDUCED() || typeof el.animate !== 'function') return null;
  try { return el.animate(frames, opts); } catch (e) { return null; }
}

// The AI token: our currency. A gold coin with a four-point spark — the same
// motif as ניצוץ, drawn once as inline SVG (no image files, per the contract).
const TOKEN_SVG = `
<svg viewBox="0 0 32 32" class="tk-glyph" aria-hidden="true">
  <defs>
    <radialGradient id="tkg" cx="36%" cy="28%">
      <stop offset="0" stop-color="#fff6d6"/><stop offset=".55" stop-color="#ffc247"/>
      <stop offset="1" stop-color="#d98006"/>
    </radialGradient>
  </defs>
  <circle cx="16" cy="16" r="14" fill="url(#tkg)" stroke="#8a5205" stroke-width="1.5"/>
  <circle cx="16" cy="16" r="10.5" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1"/>
  <path d="M16 6.5 L18.6 13.4 L25.5 16 L18.6 18.6 L16 25.5 L13.4 18.6 L6.5 16 L13.4 13.4 Z"
        fill="#fff8e2" opacity=".92"/>
</svg>`;

// Speedometer geometry. 240 degrees of sweep, 0 at the lower left and full scale at
// the lower right — in BOTH languages. See the RTL note at the top of the file.
const SP = { cx: 50, cy: 50, r: 34, span: 240, start: -120 };
const spPoint = u => {
  const a = (SP.start + SP.span * u) * Math.PI / 180;
  return [SP.cx + SP.r * Math.sin(a), SP.cy - SP.r * Math.cos(a)];
};
const SP_LEN = SP.r * SP.span * Math.PI / 180;

function speedoSVG() {
  const [x0, y0] = spPoint(0), [x1, y1] = spPoint(1);
  const [rx0, ry0] = spPoint(0.86);
  let ticks = '';
  for (let i = 0; i <= 10; i++) {
    const u = i / 10, a = (SP.start + SP.span * u) * Math.PI / 180;
    const major = i % 5 === 0;
    const ri = major ? 24 : 27.5, ro = 31.5;
    ticks += `<line x1="${(SP.cx + ri * Math.sin(a)).toFixed(2)}" y1="${(SP.cy - ri * Math.cos(a)).toFixed(2)}"
      x2="${(SP.cx + ro * Math.sin(a)).toFixed(2)}" y2="${(SP.cy - ro * Math.cos(a)).toFixed(2)}"
      stroke="${major ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.24)'}" stroke-width="${major ? 1.7 : 1}" stroke-linecap="round"/>`;
  }
  return `
<svg viewBox="0 0 100 100" direction="ltr" aria-hidden="true">
  <defs>
    <linearGradient id="spg" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#ffe9a8"/><stop offset=".6" stop-color="#ffc247"/>
      <stop offset="1" stop-color="#ff8b2e"/>
    </linearGradient>
  </defs>
  <path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${SP.r} ${SP.r} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}"
        fill="none" stroke="rgba(8,8,14,.65)" stroke-width="7.5" stroke-linecap="round"/>
  <path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${SP.r} ${SP.r} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}"
        fill="none" stroke="rgba(255,255,255,.13)" stroke-width="4.4" stroke-linecap="round"/>
  <path d="M${rx0.toFixed(2)} ${ry0.toFixed(2)} A${SP.r} ${SP.r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}"
        fill="none" stroke="#e2452f" stroke-width="4.4" stroke-linecap="round" opacity=".9"/>
  ${ticks}
  <path class="sp-arc" d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${SP.r} ${SP.r} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}"
        fill="none" stroke="url(#spg)" stroke-width="4.4" stroke-linecap="round"
        stroke-dasharray="${SP_LEN.toFixed(2)}" stroke-dashoffset="${SP_LEN.toFixed(2)}"/>
  <g class="sp-needle">
    <path d="M50 21 L52.4 51.5 L47.6 51.5 Z" fill="#fff" stroke="rgba(0,0,0,.45)" stroke-width=".6"/>
  </g>
  <circle cx="50" cy="50" r="4.1" fill="#2a2731" stroke="rgba(255,255,255,.5)" stroke-width="1.2"/>
  <circle cx="50" cy="50" r="1.5" fill="#ffc247"/>
</svg>`;
}

/* ═════════════════════════════════════════════════════════════════ the HUD ══ */

/**
 * @param {Engine} engine
 * @param {object} opts
 *   spline        TrackSpline for the minimap (optional; map hides without one)
 *   startT        lap fraction of the start/finish line
 *   totalLaps     initial lap total
 *   totalRacers   initial racer count
 *   maxSpeedKmh   dial full scale (default 140)
 *   mount         element to append to (default engine.ui)
 *   staticFx      true = transient effects stay put instead of auto-hiding.
 *                 Screenshots need this; the game never sets it.
 */
export function createHUD(engine, opts = {}) {
  injectHudCSS();
  const mount = opts.mount || engine?.ui || document.body;
  const maxKmh = opts.maxSpeedKmh ?? 140;
  const staticFx = !!opts.staticFx;

  const root = h('div.hud-root');
  root.setAttribute('aria-live', 'off');

  /* ---- feedback layers go first so everything else sits above them ------- */
  const fxBoost = h('div.fx-boost');
  const fxOff = h('div.fx-off');
  const fxFinal = h('div.fx-final');
  root.append(h('div.hud-fx', null, fxBoost, fxOff, fxFinal));

  /* ---- lap counter ------------------------------------------------------ */
  const lapCur = h('span.num.lap-cur', null, '1');
  const lapTot = h('span.num.lap-tot', null, '/3');
  const lapLabel = h('div.label');
  const lapCard = h('div.hud-tl.hud-card.hud-lap', null,
    lapLabel, h('div.lap-nums', null, lapCur, lapTot));
  root.append(lapCard);

  /* ---- race timer ------------------------------------------------------- */
  const tMain = h('span.num.t-main', null, '0:00');
  const tCs = h('span.num.t-cs', null, '.00');
  const timeLabel = h('div.label');
  const bestLabel = h('span');
  const bestVal = h('b.num', null, '-:--');
  const bestRow = h('div.t-best.hide', null, bestLabel, bestVal);
  const timerCard = h('div.hud-tr.hud-card.hud-timer', null,
    timeLabel, h('div.t-row', null, tMain, tCs), bestRow);
  root.append(timerCard);

  /* ---- minimap ---------------------------------------------------------- */
  const mapW = (engine?.width || innerWidth || 1600) < 1400 ? 140 : 158;
  const minimap = new Minimap(opts.spline || null, {
    width: mapW, height: Math.round(mapW * 0.59), startT: opts.startT ?? 0,
  });
  const mapCard = h('div.hud-tc.hud-card.hud-map', null, minimap.el);
  if (!opts.spline) mapCard.style.display = 'none';
  root.append(mapCard);

  /* ---- position card ---------------------------------------------------- */
  const posN = h('span.num.p-n', null, '1');
  const posSfx = h('span.p-sfx');
  const rivalDot = h('i.p-dot');
  const rivalName = h('span.p-name');
  const rivalGap = h('span.num.p-gap');
  const posCard = h('div.hud-card.hud-pos', null,
    h('div.p-main', null, posN, posSfx),
    h('div.p-rule'),
    h('div.p-rival', null, rivalDot, rivalName, rivalGap));
  root.append(posCard);

  /* ---- token counter ---------------------------------------------------- */
  const tkN = h('span.num.tk-n', null, '0');
  const tkLbl = h('span.tk-lbl');
  const tkCombo = h('span.tk-combo', null, '×2');
  const tkGlyphWrap = h('span', { html: TOKEN_SVG });
  const tokenCard = h('div.hud-bl.hud-card.hud-tokens', null,
    tkGlyphWrap.firstElementChild, tkN, tkLbl, tkCombo);
  root.append(tokenCard);

  /* ---- drift meter ------------------------------------------------------ */
  const segs = [1, 2, 3].map(i => h(`div.d-seg.t${i}`, null, h('b')));
  const driftLbl = h('div.d-lbl');
  const driftBox = h('div.hud-drift', null, driftLbl, h('div.d-track', null, ...segs));
  root.append(driftBox);

  /* ---- speedometer ------------------------------------------------------ */
  const spWrapHtml = h('div.sp-wrap', { html: speedoSVG() });
  const spN = h('span.num.sp-n', null, '0');
  const spU = h('span.sp-u');
  spWrapHtml.append(h('div.sp-read', null, spN, spU));
  const speedoCard = h('div.hud-br.hud-card.hud-speedo', null, spWrapHtml);
  root.append(speedoCard);
  const spArc = spWrapHtml.querySelector('.sp-arc');
  const spNeedle = spWrapHtml.querySelector('.sp-needle');

  /* ---- countdown -------------------------------------------------------- */
  const lights = [h('i'), h('i'), h('i')];
  const cBig = h('div.c-big', null, '3');
  const countBox = h('div.hud-count', null, h('div.gantry', null, ...lights), cBig);
  root.append(countBox);

  /* ---- banner / notes / wrong-way --------------------------------------- */
  const bTxt = h('div.b-txt');
  const bSub = h('div.b-sub');
  const banner = h('div.hud-banner', null, bTxt, h('div.b-rule'), bSub);
  root.append(banner);

  const notePool = [0, 1, 2].map(() => {
    const ico = h('span.n-ico');
    const txt = h('span.n-txt');
    const el = h('div.hud-note', null, ico, txt);
    return { el, ico, txt, until: 0 };
  });
  root.append(h('div.hud-notes', null, ...notePool.map(n => n.el)));

  const wTxt = h('div.w-txt');
  const wrongBox = h('div.hud-wrong', null, h('div.w-ico', null, '⟲'), wTxt);
  root.append(wrongBox);

  mount.appendChild(root);

  /* ---- static text (re-applied on language change) ---------------------- */
  function applyStaticText() {
    lapLabel.textContent = t('hud.lap');
    timeLabel.textContent = t('hud.time');
    bestLabel.textContent = t('hud.best');
    tkLbl.textContent = t('hud.tokens');
    driftLbl.textContent = t('hud.drift');
    spU.textContent = t('hud.kmh');
    wTxt.textContent = t('hud.wrongWay');
    P.pos = -1; P.rivalName = null;   // force the ordinal + rival name to re-render
    render(last);
  }

  /* ══════════════════════════════════════════════════════ per-frame update ══ */

  // Previous values. Every write in render() is guarded against these, so a steady
  // frame touches nothing at all.
  const P = {
    lap: -1, totalLaps: -1, tMain: '', tCs: '', best: -1,
    pos: -1, rivalName: null, rivalGap: NaN, rivalAhead: null, rivalColor: null,
    kmh: -1, needle: -999, arc: -1, tokens: -1, combo: -1,
    driftTier: -1, driftFill: [-1, -1, -1], driftOn: null,
    boost: null, off: null, final: null, wrong: null, lead: null,
  };
  let last = {
    lap: 1, totalLaps: opts.totalLaps ?? 3, position: 1,
    totalRacers: opts.totalRacers ?? 8, raceTimeMs: 0, lapTimeMs: 0, bestLapMs: null,
    speed: 0, tokens: 0, comboCount: 0, driftTier: 0, driftCharge01: 0,
  };

  function render(s) {
    // ---- lap -------------------------------------------------------------
    const lap = clamp(s.lap ?? 1, 1, 99);
    const tot = s.totalLaps ?? 3;
    if (lap !== P.lap) { lapCur.textContent = String(lap); P.lap = lap; }
    if (tot !== P.totalLaps) { lapTot.textContent = '/' + tot; P.totalLaps = tot; }

    // ---- timer -----------------------------------------------------------
    const [tm, tc] = splitTime(s.raceTimeMs ?? 0);
    if (tm !== P.tMain) { tMain.textContent = tm; P.tMain = tm; }
    if (tc !== P.tCs) { tCs.textContent = tc; P.tCs = tc; }
    const best = s.bestLapMs ?? null;
    if (best !== P.best) {
      P.best = best;
      if (best == null || !isFinite(best)) bestRow.classList.add('hide');
      else {
        bestRow.classList.remove('hide');
        const [bm, bc] = splitTime(best);
        bestVal.textContent = bm + bc;
      }
    }

    // ---- position --------------------------------------------------------
    const pos = clamp(s.position ?? 1, 1, 99);
    if (pos !== P.pos) {
      P.pos = pos;
      posN.textContent = String(pos);
      // Hebrew ordinals are words (ראשון/שני/שלישי), English is a 2-char suffix.
      // Same card, two very different typographic problems — so the suffix element
      // is width-capped and the whole card has a max-width that cannot overflow.
      posSfx.textContent = isRTL() ? ordinal(pos) : ordinal(pos).replace(/^\d+/, '');
      posCard.classList.toggle('lead', pos === 1);
    }

    // ---- nearest rival ---------------------------------------------------
    const rname = s.rivalNameKey ? t(s.rivalNameKey) : (s.rivalName || null);
    const hasRival = !!rname && s.rivalGapMs != null && isFinite(s.rivalGapMs);
    if (hasRival !== !posCard.classList.contains('p-hide-rival')) {
      posCard.classList.toggle('p-hide-rival', !hasRival);
    }
    if (hasRival) {
      if (rname !== P.rivalName) { rivalName.textContent = rname; P.rivalName = rname; }
      const col = hex(s.rivalColor ?? 0x8fd3ff);
      if (col !== P.rivalColor) { rivalDot.style.background = col; rivalDot.style.color = col; P.rivalColor = col; }
      const g = Math.round(s.rivalGapMs / 10) * 10;
      if (g !== P.rivalGap) {
        P.rivalGap = g;
        rivalGap.textContent = gapText(g);
        // Positive gap = the rival is up the road = we are losing = red.
        const ahead = g < 0;
        if (ahead !== P.rivalAhead) {
          rivalGap.classList.toggle('ahead', ahead);
          rivalGap.classList.toggle('behind', !ahead);
          P.rivalAhead = ahead;
        }
      }
    }

    // ---- speedometer -----------------------------------------------------
    const kmh = Math.max(0, (s.speed ?? 0) * 3.6);
    const shown = Math.round(kmh);
    if (shown !== P.kmh) { spN.textContent = String(shown); P.kmh = shown; }
    const u = clamp(s.speed01 != null ? s.speed01 : kmh / maxKmh, 0, 1);
    const deg = SP.start + SP.span * u;
    if (Math.abs(deg - P.needle) > 0.4) {
      spNeedle.setAttribute('transform', `rotate(${deg.toFixed(1)} 50 50)`);
      P.needle = deg;
    }
    const off = SP_LEN * (1 - u);
    if (Math.abs(off - P.arc) > 0.5) { spArc.setAttribute('stroke-dashoffset', off.toFixed(1)); P.arc = off; }

    // ---- tokens ----------------------------------------------------------
    const tk = s.tokens ?? 0;
    if (tk !== P.tokens) { tkN.textContent = String(tk); P.tokens = tk; }
    const combo = s.comboCount ?? 0;
    if (combo !== P.combo) {
      P.combo = combo;
      const on = combo > 1;
      if (on) tkCombo.textContent = '×' + combo;
      tkCombo.classList.toggle('on', on);
    }

    // ---- drift meter -----------------------------------------------------
    const charge = clamp(s.driftCharge01 ?? 0, 0, 1);
    const tier = clamp(s.driftTier ?? 0, 0, 3);
    const driftOn = !!(s.drifting || charge > 0.001 || tier > 0);
    if (driftOn !== P.driftOn) { driftBox.classList.toggle('on', driftOn); P.driftOn = driftOn; }
    if (driftOn) {
      // Thresholds are cumulative across the three tiers so the meter reads as one
      // continuous fill that "clicks" three times — that is the mechanic being taught.
      const edges = [0, 0.38, 0.72, 1];
      for (let i = 0; i < 3; i++) {
        const f = clamp((charge - edges[i]) / (edges[i + 1] - edges[i]), 0, 1);
        const q = Math.round(f * 40) / 40;
        if (q !== P.driftFill[i]) {
          const b = segs[i].firstElementChild;
          b.style.transform = `scaleX(${q})`;
          b.style.opacity = q > 0 ? '1' : '0';
          P.driftFill[i] = q;
        }
      }
    }
    if (tier !== P.driftTier) {
      for (let i = 0; i < 3; i++) segs[i].classList.toggle('lit', i < tier);
      if (tier > P.driftTier && tier > 0) {
        pop(segs[tier - 1], [{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.7)' }, { transform: 'scaleY(1)' }],
          { duration: 260, easing: 'cubic-bezier(.22,.9,.3,1)' });
      }
      P.driftTier = tier;
    }

    // ---- full-screen feedback -------------------------------------------
    const boosting = !!s.boosting;
    if (boosting !== P.boost) {
      fxBoost.style.opacity = boosting ? '1' : '0';
      speedoCard.classList.toggle('boost', boosting);
      P.boost = boosting;
    }
    const offTrack = !!s.offTrack;
    if (offTrack !== P.off) { fxOff.style.opacity = offTrack ? '1' : '0'; P.off = offTrack; }
    const finalLap = !!s.isFinalLap || (tot > 0 && lap >= tot);
    if (finalLap !== P.final) {
      fxFinal.classList.toggle('on', finalLap);
      fxFinal.style.opacity = finalLap ? '' : '0';
      lapCard.classList.toggle('final', finalLap);
      P.final = finalLap;
    }
    const wrong = !!s.wrongWay;
    if (wrong !== P.wrong) { wrongBox.classList.toggle('on', wrong); P.wrong = wrong; }

    // ---- minimap ---------------------------------------------------------
    if (opts.spline && s.karts) minimap.update(s.karts, 1 / 60);
  }

  /* ═══════════════════════════════════════════════════ transient overlays ══ */

  const timers = new Set();
  const after = (ms, fn) => {
    if (staticFx) return;
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  };

  function showBanner(text, sub, kind, holdMs = 1500) {
    bTxt.textContent = text;
    bSub.textContent = sub || '';
    banner.classList.toggle('good', kind === 'good');
    banner.classList.add('on');
    pop(banner, [
      { opacity: 0, transform: 'scale(.72)' },
      { opacity: 1, transform: 'scale(1.06)', offset: 0.35 },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: 420, easing: 'cubic-bezier(.22,.9,.3,1)' });
    after(holdMs, () => {
      const a = pop(banner, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-14px)' }],
        { duration: 300, easing: 'ease-in' });
      if (a) a.onfinish = () => banner.classList.remove('on');
      else banner.classList.remove('on');
    });
  }

  function showNote(text, ico, kind, holdMs = 1700) {
    const slot = notePool.find(n => !n.el.classList.contains('on')) || notePool[0];
    slot.txt.textContent = text;
    slot.ico.textContent = ico || '';
    slot.el.classList.remove('up', 'down', 'gold');
    if (kind) slot.el.classList.add(kind);
    slot.el.classList.add('on');
    pop(slot.el, [
      { opacity: 0, transform: 'translateY(10px) scale(.9)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 240, easing: 'cubic-bezier(.22,.9,.3,1)' });
    after(holdMs, () => {
      const a = pop(slot.el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-8px)' }],
        { duration: 260, easing: 'ease-in' });
      if (a) a.onfinish = () => slot.el.classList.remove('on');
      else slot.el.classList.remove('on');
    });
  }

  /** n = 3,2,1 then 0 for GO. Anything else hides the gantry. */
  function setCountdown(n) {
    if (n == null || n < 0 || n > 3) {
      countBox.classList.remove('on');
      return;
    }
    countBox.classList.add('on');
    const go = n === 0;
    cBig.textContent = go ? t('hud.go') : String(n);
    cBig.classList.toggle('go', go);
    // 3 -> one light, 2 -> two, 1 -> three, GO -> all green.
    const litRed = go ? 0 : 4 - n;
    for (let i = 0; i < 3; i++) {
      lights[i].classList.toggle('red', !go && i < litRed);
      lights[i].classList.toggle('green', go);
    }
    pop(cBig, [
      { opacity: 0, transform: `scale(${go ? 1.9 : 2.1})` },
      { opacity: 1, transform: 'scale(1)', offset: 0.45 },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: go ? 520 : 420, easing: 'cubic-bezier(.18,1.1,.3,1)' });
    if (go) after(900, () => countBox.classList.remove('on'));
  }

  function tokenPop(n, combo) {
    if (n != null) { tkN.textContent = String(n); P.tokens = n; }
    pop(tkN, [{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1)' }],
      { duration: 260, easing: 'cubic-bezier(.22,1.2,.3,1)' });
    pop(tokenCard.querySelector('.tk-glyph'),
      [{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(180deg) scale(1.25)' }, { transform: 'rotate(360deg) scale(1)' }],
      { duration: 420, easing: 'cubic-bezier(.22,.9,.3,1)' });
    if (combo > 1) {
      tkCombo.textContent = '×' + combo;
      tkCombo.classList.add('on');
      P.combo = combo;
      pop(tkCombo, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
        { duration: 260, easing: 'cubic-bezier(.22,1.2,.3,1)' });
    }
  }

  /* ════════════════════════════════════════════════════════════ bus wiring ══ */

  const offs = [
    bus.on('race:countdown', p => setCountdown(typeof p === 'number' ? p : p?.n)),
    bus.on('race:start', () => setCountdown(0)),
    bus.on('race:lap', p => {
      minimap.pulseStart();
      const n = p?.lap ?? last.lap;
      const isFinal = p?.totalLaps ? n > p.totalLaps - 1 : false;
      if (!isFinal) showNote(t('hud.lapDone', { n: num(n) }), '🏁', 'gold', 1400);
      pop(lapCard, [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }],
        { duration: 380, easing: 'cubic-bezier(.22,1.1,.3,1)' });
    }),
    bus.on('race:bestlap', () => showBanner(t('hud.bestLap'), '', 'good', 1500)),
    bus.on('race:finallap', () => showBanner(t('hud.finalLap'), '', 'gold', 1700)),
    bus.on('race:position', p => {
      const to = p?.to ?? last.position;
      const up = p?.from == null ? true : to < p.from;
      showNote(up ? t('hud.overtake', { o: ordinal(to) }) : t('hud.overtaken', { o: ordinal(to) }),
        up ? '▲' : '▼', up ? 'up' : 'down', 1500);
    }),
    bus.on('race:finish', p => {
      const pl = p?.position ?? last.position;
      showBanner(pl === 1 ? t('hud.win') : t('hud.finish', { o: ordinal(pl) }), '',
        pl === 1 ? 'good' : null, 3000);
    }),
    bus.on('token:pickup', p => tokenPop(p?.tokens, p?.combo ?? p?.comboCount ?? 0)),
    bus.on('drift:tier', p => {
      const tier = typeof p === 'number' ? p : p?.tier;
      if (tier > 0) pop(segs[Math.min(2, tier - 1)],
        [{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.8)' }, { transform: 'scaleY(1)' }],
        { duration: 260, easing: 'cubic-bezier(.22,.9,.3,1)' });
    }),
    bus.on('race:wrongway', p => {
      const on = typeof p === 'boolean' ? p : !!p?.on;
      wrongBox.classList.toggle('on', on);
      P.wrong = on;
    }),
    bus.on('lang:changed', () => applyStaticText()),
  ];

  applyStaticText();
  render(last);

  /* ══════════════════════════════════════════════════════════════════ api ══ */

  return {
    el: root,
    minimap,

    /** Per-frame. See the state shape at the top of this file. */
    update(state) {
      if (state) last = state;
      render(last);
    },

    setSpline(spline, startT = 0) {
      opts.spline = spline;
      minimap.setSpline(spline, startT);
      mapCard.style.display = spline ? '' : 'none';
    },

    resize(w) {
      const nw = (w || engine?.width || 1600) < 1400 ? 140 : 158;
      minimap.setSize(nw, Math.round(nw * 0.59));
    },

    // Exposed so the race scene (and the previews) can trigger flourishes directly
    // as well as over the bus.
    countdown: setCountdown,
    banner: showBanner,
    note: showNote,
    tokenPop,

    dispose() {
      for (const o of offs) { try { o(); } catch (e) { /* noop */ } }
      for (const id of timers) clearTimeout(id);
      timers.clear();
      minimap.dispose();
      root.remove();
    },
  };
}

/* ══════════════════════════════════════════════════════════════ preview 3D ══ */
// A real slice of track under the HUD: the actual oasis spline, asphalt, kerbs,
// three karts and the golden-hour rig. The HUD has to be judged over gameplay —
// judging it over a flat colour would flatter it.

import { applyTheme } from '../gfx/sky.js';
import { asphaltTexture, sandTexture, curbTexture } from '../gfx/textures.js';
import { createKart } from '../kart/kartmodel.js';
import { makeRng } from '../core/rng.js';

function buildBackdrop(engine, playerT) {
  const { def, spline } = getTrack('oasis');
  const scene = new THREE.Scene();
  const rig = applyTheme(scene, 'oasis', engine);
  const q = engine?.q || { texSize: 512, shadows: true };
  const S = Math.min(q.texSize || 512, 512);
  const owned = [];   // geometries + materials we created and must free

  const keep = o => { owned.push(o); return o; };

  // --- desert floor ------------------------------------------------------
  const sand = sandTexture({ size: S, ripple: 0.4 });
  for (const tex of Object.values(sand)) {
    if (tex?.isTexture) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(28, 28); }
  }
  const groundGeo = keep(new THREE.PlaneGeometry(1400, 1400));
  const groundMat = keep(new THREE.MeshStandardMaterial({
    map: sand.map, normalMap: sand.normalMap || null, roughness: 1, metalness: 0,
  }));
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = !!q.shadows;
  scene.add(ground);

  // --- road ribbon extruded along the real centreline --------------------
  const asph = asphaltTexture({ size: S });
  for (const tex of Object.values(asph)) {
    if (tex?.isTexture) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 1); }
  }
  const N = 420;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const uv = new Float32Array((N + 1) * 2 * 2);
  const idx = [];
  const kerbPos = new Float32Array((N + 1) * 2 * 3 * 2);
  const kerbUv = new Float32Array((N + 1) * 2 * 2 * 2);
  const kerbIdx = [];
  const frameV = new THREE.Vector3(), rightV = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const tt = (i % N) / N;
    spline.positionAt(tt, frameV);
    spline.rightAt(tt, rightV);
    const w = spline.widthAt(tt);
    const v = i * (spline.length / N) / 7;
    for (let s = 0; s < 2; s++) {
      const sgn = s ? 1 : -1;
      const o = (i * 2 + s) * 3;
      pos[o] = frameV.x + rightV.x * w * sgn;
      pos[o + 1] = frameV.y + 0.02;
      pos[o + 2] = frameV.z + rightV.z * w * sgn;
      uv[(i * 2 + s) * 2] = s * 2.2;
      uv[(i * 2 + s) * 2 + 1] = v;
      // kerb strip just outside the road edge
      const ko = ((i * 2 + s) * 2) * 3;
      for (let e = 0; e < 2; e++) {
        const d = w + (e ? 2.2 : 0.04);
        kerbPos[ko + e * 3] = frameV.x + rightV.x * d * sgn;
        kerbPos[ko + e * 3 + 1] = frameV.y + (e ? 0.16 : 0.09);
        kerbPos[ko + e * 3 + 2] = frameV.z + rightV.z * d * sgn;
        kerbUv[((i * 2 + s) * 2 + e) * 2] = e;
        kerbUv[((i * 2 + s) * 2 + e) * 2 + 1] = i * 0.55;
      }
    }
    if (i < N) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
      const ka = i * 4, kb = ka + 4;
      kerbIdx.push(ka, kb, ka + 1, ka + 1, kb, kb + 1);
      kerbIdx.push(ka + 2, ka + 3, kb + 2, ka + 3, kb + 3, kb + 2);
    }
  }
  const roadGeo = keep(new THREE.BufferGeometry());
  roadGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  roadGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  roadGeo.setIndex(idx);
  roadGeo.computeVertexNormals();
  const roadMat = keep(new THREE.MeshStandardMaterial({
    map: asph.map, normalMap: asph.normalMap || null, roughnessMap: asph.roughnessMap || null,
    roughness: 1, metalness: 0, side: THREE.DoubleSide,
  }));
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = !!q.shadows;
  scene.add(road);

  const kerbTex = curbTexture({ size: Math.min(S, 256) });
  for (const tex of Object.values(kerbTex)) {
    if (tex?.isTexture) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  }
  const kerbGeo = keep(new THREE.BufferGeometry());
  kerbGeo.setAttribute('position', new THREE.BufferAttribute(kerbPos, 3));
  kerbGeo.setAttribute('uv', new THREE.BufferAttribute(kerbUv, 2));
  kerbGeo.setIndex(kerbIdx);
  kerbGeo.computeVertexNormals();
  const kerbMat = keep(new THREE.MeshStandardMaterial({
    map: kerbTex.map || null, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
    color: kerbTex.map ? 0xffffff : 0xd8d2c4,
  }));
  const kerb = new THREE.Mesh(kerbGeo, kerbMat);
  kerb.receiveShadow = !!q.shadows;
  scene.add(kerb);

  // --- white edge lines --------------------------------------------------
  const lnPos = new Float32Array((N + 1) * 4 * 3);
  const lnIdx = [];
  for (let i = 0; i <= N; i++) {
    const tt = (i % N) / N;
    spline.positionAt(tt, frameV);
    spline.rightAt(tt, rightV);
    const w = spline.widthAt(tt);
    for (let s2 = 0; s2 < 2; s2++) {
      const sgn = s2 ? 1 : -1;
      for (let e = 0; e < 2; e++) {
        const d = (w - 0.62) + e * 0.34;
        const o = ((i * 2 + s2) * 2 + e) * 3;
        lnPos[o] = frameV.x + rightV.x * d * sgn;
        lnPos[o + 1] = frameV.y + 0.045;
        lnPos[o + 2] = frameV.z + rightV.z * d * sgn;
      }
    }
    if (i < N) {
      for (let s2 = 0; s2 < 2; s2++) {
        const a = (i * 2 + s2) * 2, b = a + 4;
        lnIdx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const lnGeo = keep(new THREE.BufferGeometry());
  lnGeo.setAttribute('position', new THREE.BufferAttribute(lnPos, 3));
  lnGeo.setIndex(lnIdx);
  lnGeo.computeVertexNormals();
  const lnMat = keep(new THREE.MeshStandardMaterial({
    color: 0xe8e2d2, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
  }));
  scene.add(new THREE.Mesh(lnGeo, lnMat));

  // --- far silhouettes ---------------------------------------------------
  // Layered depth is most of the perceived production value (art bible): the fog
  // lifts these toward the sky colour, which is what gives the frame a horizon.
  const rng = makeRng(4471);
  const mesaGeo = keep(new THREE.ConeGeometry(1, 1, 6, 1));
  const mesaMat = keep(new THREE.MeshStandardMaterial({ color: 0xb0603a, roughness: 1, flatShading: true }));
  const mesas = new THREE.InstancedMesh(mesaGeo, mesaMat, 46);
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion();
  const sc = new THREE.Vector3(), tr = new THREE.Vector3();
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2;
    const rad = rng.range(190, 640);
    const hgt = rng.range(24, 92) * (rad / 400);
    tr.set(Math.cos(a) * rad, hgt * 0.5 - 6, Math.sin(a) * rad - 110);
    sc.set(hgt * rng.range(0.55, 1.15), hgt, hgt * rng.range(0.55, 1.15));
    qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 3.14);
    m4.compose(tr, qt, sc);
    mesas.setMatrixAt(i, m4);
  }
  mesas.instanceMatrix.needsUpdate = true;
  scene.add(mesas);
  owned.push({ dispose() { mesas.dispose(); } });

  // --- karts -------------------------------------------------------------
  const slots = [
    { racer: ROSTER[0], dt: 0, lat: 0.2, player: true },
    { racer: ROSTER[2], dt: 0.0075, lat: -2.6 },
    { racer: ROSTER[4], dt: 0.0125, lat: 2.4 },
    { racer: ROSTER[5], dt: 0.019, lat: -1.2 },
  ];
  const karts = slots.map(s => {
    const k = createKart({ racer: s.racer, engine, parts: { engine: 2, tires: 2, wing: 1, chassis: 2, exhaust: 2 } });
    const tt = (playerT + s.dt) % 1;
    spline.offsetPoint(tt, s.lat, frameV);
    k.group.position.copy(frameV);
    spline.tangentAt(tt, rightV);
    k.group.rotation.y = Math.atan2(rightV.x, rightV.z);
    scene.add(k.group);
    return k;
  });

  // --- chase camera ------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.15, 1400);
  const pp = spline.offsetPoint(playerT, 0.2, new THREE.Vector3());
  const tan = spline.tangentAt(playerT, new THREE.Vector3());
  camera.position.set(pp.x - tan.x * 6.4, pp.y + 2.55, pp.z - tan.z * 6.4);
  camera.lookAt(pp.x + tan.x * 7, pp.y + 1.0, pp.z + tan.z * 7);
  rig.setShadowFocus(pp);

  return {
    scene, camera, spline, def,
    update(dt) {
      rig.update(dt, camera);
      for (let i = 0; i < karts.length; i++) {
        karts[i].update(dt, { steer: i === 0 ? 0.45 : 0.1, speed01: 0.7, drifting: i === 0, driftCharge01: 0.6, boosting: false, airborne: false });
      }
    },
    resize(w, hh) { camera.aspect = (w || 16) / (hh || 9); camera.updateProjectionMatrix(); },
    dispose() {
      for (const k of karts) k.dispose();
      for (const o of owned) o.dispose?.();
      rig.dispose();
      scene.clear();
    },
  };
}

/* ═══════════════════════════════════════════════════════════════ previews ══ */

const PLAYER_T = 0.415;

function plausibleKarts(playerT) {
  // Same field the backdrop shows, plus four more spread around the lap so the
  // minimap reads like a real race rather than a single dot.
  const offs = [0, 0.0075, 0.0125, 0.019, 0.07, 0.17, 0.42, 0.71];
  const lats = [0.2, -2.6, 2.4, -1.2, 1.4, -2.0, 0.6, -1.6];
  return offs.map((o, i) => ({
    t: (playerT + o) % 1,
    lateral: lats[i],
    color: ROSTER[i % ROSTER.length].color,
    isPlayer: i === 0,
  }));
}

function midRaceState(over = {}) {
  return {
    lap: 2, totalLaps: 3, position: 3, totalRacers: 8,
    raceTimeMs: 84230, lapTimeMs: 24440, bestLapMs: 39120,
    speed: 19.2, tokens: 12, comboCount: 3,
    driftTier: 2, driftCharge01: 0.58, drifting: true,
    boosting: false, offTrack: false, wrongWay: false, isFinalLap: false,
    rivalNameKey: nameKey('plada'), rivalColor: ROSTER[2].color, rivalGapMs: 1200,
    karts: plausibleKarts(PLAYER_T),
    ...over,
  };
}

function previewScene(engine, { state, playerT = PLAYER_T, live = true, after: afterBuild } = {}) {
  const back = buildBackdrop(engine, playerT);
  const hud = createHUD(engine, {
    spline: back.spline, startT: back.def.startT, totalLaps: back.def.laps, staticFx: true,
  });
  hud.update(state);
  afterBuild?.(hud, state);

  let elapsed = 0;
  return {
    scene: back.scene,
    camera: back.camera,
    update(dt) {
      back.update(dt);
      if (!live) return;
      elapsed += dt;
      // Keep the numbers alive under `--t N` so the preview is not a frozen mock:
      // the clock runs, the needle breathes, the karts creep around the minimap.
      const s = { ...state };
      s.raceTimeMs = state.raceTimeMs + elapsed * 1000;
      s.lapTimeMs = (state.lapTimeMs ?? 0) + elapsed * 1000;
      s.speed = state.speed + Math.sin(elapsed * 0.9) * 3.2;
      s.karts = state.karts.map((k, i) => ({ ...k, t: (k.t + elapsed * (0.011 + i * 0.0004)) % 1 }));
      hud.update(s);
    },
    resize(w, hh) { back.resize(w, hh); hud.resize(w); },
    dispose() { hud.dispose(); back.dispose(); },
  };
}

/** Mid-race: lap 2/3, 3rd, ~19 m/s, 12 tokens, drift charging into orange, rival 1.2s up. */
export function preview(engine) {
  return previewScene(engine, { state: midRaceState() });
}

/** The "2" beat of the start sequence, with the three-light gantry. */
export function previewCountdown(engine) {
  const state = midRaceState({
    lap: 1, position: 4, raceTimeMs: 0, lapTimeMs: 0, bestLapMs: null,
    speed: 0, tokens: 0, comboCount: 0, driftTier: 0, driftCharge01: 0, drifting: false,
    rivalGapMs: -420,
  });
  return previewScene(engine, { state, live: false, after: hud => hud.countdown(2) });
}

/** Final lap warning, out front, boost lit. */
export function previewFinalLap(engine) {
  const state = midRaceState({
    lap: 3, position: 1, raceTimeMs: 152880, lapTimeMs: 8120, bestLapMs: 38640,
    speed: 27.5, tokens: 24, comboCount: 5, driftTier: 3, driftCharge01: 0.97,
    boosting: true, isFinalLap: true,
    rivalNameKey: nameKey('zamzum'), rivalColor: ROSTER[4].color, rivalGapMs: -840,
  });
  return previewScene(engine, { state, after: hud => hud.banner(t('hud.finalLap'), '', 'gold') });
}

/** Crossing the line in first. */
export function previewWin(engine) {
  const state = midRaceState({
    lap: 3, position: 1, raceTimeMs: 178420, lapTimeMs: 38210, bestLapMs: 38210,
    speed: 24.8, tokens: 31, comboCount: 0, driftTier: 0, driftCharge01: 0, drifting: false,
    isFinalLap: true, finished: true,
    rivalNameKey: nameKey('nurit'), rivalColor: ROSTER[3].color, rivalGapMs: -2260,
  });
  return previewScene(engine, {
    state,
    live: false,
    after: hud => {
      hud.banner(t('hud.win'), t('hud.bestLap'), 'good');
      hud.note(t('hud.lapDone', { n: num(3) }), '🏁', 'gold');
    },
  });
}

export { Minimap };

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDURAL AUDIO — every sample in this game is synthesised here, at runtime,
// with the Web Audio API. No audio files, no base64, no network, ever.
//
// Design notes
// ------------
// * ONE singleton (`audio`) owns ONE AudioContext. It is created lazily on the
//   first user gesture so the browser autoplay policy is never violated, and the
//   whole module degrades to silent no-ops if Web Audio is missing or throws.
// * Subsystems never import this file. They emit on `core/bus.js`; the wiring
//   table at the bottom (`BUS_MAP`) translates game events into sounds.
// * Mixing: [sfx|engine|music] -> compressor -> limiter -> soft-clip -> master.
//   The soft-clip waveshaper is a tanh curve, so the output mathematically
//   cannot exceed ±0.97 no matter how many voices pile up. Verified offline.
// * Voice budget: `_reserve()` is a deterministic scheduler-clock voice counter
//   (it works identically in an OfflineAudioContext, which is how the automated
//   check can prove there is no runaway voice growth over a 60s race).
// * The engine, the drift scrape and the AI karts are PERSISTENT voices —
//   oscillators are allocated once and then only automated. Nothing in this file
//   allocates a node per frame.
//
// Original composition only. The three musical characters (oasis / circuit /
// cloud) are generated from seeded PRNG melodies over hand-written chord
// progressions; nothing here quotes or pastiches any existing game's motif.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { bus } from '../core/bus.js';
import { save } from '../core/save.js';
import { makeRng } from '../core/rng.js';
// style.js is deliberately dependency-free (see its modal-registry header), so
// importing it here creates no cycle. `onModalChange` is the seam that makes the
// modal duck automatic — see AudioSystem._modalDucked / setModalDuck.
import { h, onModalChange, pushModal, popModal } from '../ui/style.js';
import { registerStrings, t, num } from '../ui/i18n.js';

// ── small maths helpers ──────────────────────────────────────────────────────
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, x) => a + (b - a) * x;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const EPS = 0.0001;

// Every gesture type that counts as user activation in some browser. Bound in
// the capture phase on window AND document, never with {once:true} — see
// _installUnlock() for why each of those words matters.
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click',
  'touchstart', 'touchend', 'keydown'];

const MAX_VOICES = 56;        // hard cap on concurrent scheduled sfx/music voices
const MUSIC_HEADROOM = 20;    // music may use this many voices beyond the sfx cap

// ── mix constants (Wave 4) ───────────────────────────────────────────────────
// Pinned here rather than inline so tests/audio.test.mjs and the settings screen
// have one place to read, and so a future tweak is one line and not a hunt.
// ENGINE_BUS was set by measuring the built game against the rest of the mix,
// not by ear-guessing: race music meters rms 0.027 / peak 0.44, SFX peak 0.19
// (token) to 0.40 (wall hit). The engine is CONTINUOUS, so it has to sit under
// both — at 0.21 it lands at rms 0.024 flat out, just under the music bed, with
// its peaks ~18 dB below the SFX so a collision still cuts through. Wave 3's
// 0.32, through a 15 dB drive stage, metered rms 0.101 — four times the music.
const ENGINE_BUS = 0.21;
const ENGINE_LEVEL = 0.34;    // player engine voice level inside that bus
const AI_ENGINE_LEVEL = 0.075; // per-AI-kart voice at closest range

// Modal ducking. The engine and the world go to TRUE zero (a linear ramp, so it
// is a fade and not a click); music only steps back.
const MODAL_DUCK_RAMP = 0.12;  // seconds — fast enough to feel instant, slow
                               // enough that no voice clicks off
const MODAL_MUSIC = 0.34;      // music floor while a modal owns the screen

/** Saved master volume (save.js `volume`, 0..1), falling back to the default. */
function readSavedVolume() {
  const v = save.read('volume');
  return typeof v === 'number' && isFinite(v) ? clamp(v, 0, 1) : 0.75;
}

// Soft-clip curve. UNITY GAIN below `knee` (so normal material is untouched and
// the meters tell the truth), then a tanh knee that asymptotes to `ceil`. Since
// WaveShaper clamps its input to [-1,1], the master output can never exceed
// `ceil` — clipping is structurally impossible, not just unlikely.
function softClipCurve(knee = 0.55, ceil = 0.97) {
  const n = 2048, c = new Float32Array(n), r = ceil - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + r * Math.tanh((ax - knee) / r);
    c[i] = (x < 0 ? -1 : 1) * y;
  }
  return c;
}
// Gentle asymmetric saturation for the engine. Wave 4: `k` was 6, which is not a
// warm saturator at all — tanh(6x)/tanh(6) has a slope of ~6 near zero, so the
// stage was a 15 dB distortion boost that turned the oscillator stack into a
// constant grating buzz. At k≈2 the slope near zero is ~2 and the curve only
// rounds the peaks, which is what "warm" actually means. The asymmetry is kept:
// it is what stops the tone sounding like a plain filtered synth pad.
function driveCurve(k = 2) {
  const n = 1024, c = new Float32Array(n), d = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const y = Math.tanh(k * x) / d;
    c[i] = y * (1 - 0.18 * Math.max(0, -x)); // slight asymmetry = extra even harmonics
  }
  return c;
}

// Stick-slip grain train, pre-rendered ONCE into a looping buffer.
// Rubber scrubbing is not a hiss: it is a very fast train of grip→slip→grip
// events, each one a tiny damped ring. Filtered white noise can never sound like
// that because it has no event structure. Rendering the train up front (a) gives
// real granular texture, (b) costs nothing at runtime and allocates nothing per
// frame, and (c) is deterministic, since the grains come from makeRng.
// Two densities are rendered so the *texture* — not just the filter — can track
// drift charge: a slow scrub crackles, a loaded one tears.
function grainBuffer(ctx, rng, ratePerSec, ring) {
  const sr = ctx.sampleRate, len = Math.floor(sr * 2), buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const step = sr / ratePerSec;
  const w = 2 * Math.PI * ring / sr;
  for (let g = 0; g * step < len; g++) {
    const start = Math.floor(g * step + (rng() - 0.5) * step * 0.9);
    if (start < 0) continue;
    const amp = 0.3 + rng() * 0.7;
    const decay = Math.exp(-1 / (sr * (0.0008 + rng() * 0.0028)));   // 0.8–3.6 ms grains
    const w2 = w * (0.55 + rng() * 1.7);                             // pitch spread
    let env = amp, ph = rng() * 6.2832;
    for (let i = start; i < len && env > 0.0015; i++) {
      d[i] += Math.sin(ph) * env;
      ph += w2; env *= decay;
    }
  }
  let m = 0;
  for (let i = 0; i < len; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < len; i++) d[i] /= m;
  const fade = 128;                                     // keep the loop seam silent
  for (let i = 0; i < fade; i++) { d[i] *= i / fade; d[len - 1 - i] *= i / fade; }
  return buf;
}

// ── musical material ─────────────────────────────────────────────────────────
const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

// Each theme is a distinct musical character, per the art bible.
const THEMES = {
  // Data Oasis — warm, modal, hand percussion, nylon-ish plucked lead.
  oasis: {
    bpm: 100, root: 50 /* D3 */, scale: SCALES.dorian, seed: 20117,
    prog: [{ r: 0, c: [0, 3, 7, 10] }, { r: 5, c: [0, 4, 7, 9] },
           { r: 3, c: [0, 4, 7, 11] }, { r: 10, c: [0, 4, 7, 14] }],
    lead: 'pluck', bassWave: 'triangle', padWave: 'triangle',
    perc: 'hand', padCut: 1500, leadOct: 12, colour: '#ffc247',
  },
  // Neuron City — neon synthwave: saw bass, resonant lead, four-on-the-floor.
  // (The theme id and the track id both stay `circuit`; only the display name
  // changed this wave — עיר המעגלים → עיר הנוירונים.)
  circuit: {
    bpm: 124, root: 45 /* A2 */, scale: SCALES.minor, seed: 55019,
    prog: [{ r: 0, c: [0, 3, 7, 10] }, { r: 7, c: [0, 3, 7, 10] },
           { r: 8, c: [0, 4, 7, 11] }, { r: 10, c: [0, 4, 7, 14] }],
    lead: 'saw', bassWave: 'sawtooth', padWave: 'sawtooth',
    perc: 'kit', padCut: 2200, leadOct: 12, colour: '#6fc3ff',
  },
  // Cloud Peak — airy and bright: bell lead, lydian colour, soft shaker.
  cloud: {
    bpm: 112, root: 52 /* E3 */, scale: SCALES.major, seed: 90211,
    prog: [{ r: 0, c: [0, 4, 7, 11] }, { r: 4, c: [0, 3, 7, 10] },
           { r: 5, c: [0, 4, 7, 11, 18] }, { r: 7, c: [0, 4, 7, 14] }],
    lead: 'bell', bassWave: 'triangle', padWave: 'triangle',
    perc: 'air', padCut: 2600, leadOct: 24, colour: '#c9b8ff',
  },
};

// Arrangement roles. The same theme sounds different in a menu vs mid-race.
const ROLES = {
  menu:   { tempo: 0.86, drums: 0.45, lead: 0.8, pad: 1.0, arp: 0.3, gain: 1.15, theme: 'oasis' },
  race:   { tempo: 1.0,  drums: 1.0,  lead: 1.0, pad: 0.7, arp: 0.8, gain: 1.30, theme: 'oasis' },
  garage: { tempo: 0.78, drums: 0.6,  lead: 0.6, pad: 0.95, arp: 0.5, gain: 1.15, theme: 'circuit', mech: true },
};

// Bass / drum step patterns (16 steps per bar).
const BASS_STEPS = {
  menu: [0, 8], race: [0, 3, 6, 8, 11, 14], garage: [0, 6, 8, 14],
};

function snapToChord(midi, chordRoot, chord) {
  let best = midi, bestD = 99;
  for (let d = -6; d <= 6; d++) {
    const p = midi + d;
    const pc = (((p - chordRoot) % 12) + 12) % 12;
    if (chord.some(c => ((c % 12) + 12) % 12 === pc) && Math.abs(d) < bestD) { best = p; bestD = Math.abs(d); }
  }
  return best;
}

// Deterministic 8-bar melody with a sane contour, chord tones on strong beats.
function buildMelody(theme, role) {
  const rng = makeRng(theme.seed + (role === 'race' ? 7 : role === 'menu' ? 13 : 29));
  const RH = [[0, 3, 6, 8, 12], [0, 4, 6, 10, 12, 14], [0, 2, 4, 8, 11],
              [0, 6, 8, 10], [0, 4, 8, 10, 12], [2, 4, 8, 12, 14]];
  const out = [];
  let deg = 7;
  for (let b = 0; b < 8; b++) {
    const rh = RH[rng.int(0, RH.length - 1)];
    const ch = theme.prog[b % theme.prog.length];
    for (const s of rh) {
      if (rng() < 0.14) continue;
      const strong = s % 4 === 0;
      deg = clamp(deg + (rng() < 0.26 ? rng.int(-4, 4) : rng.int(-2, 2)), 2, 13);
      let midi = theme.root + theme.leadOct + theme.scale[deg % 7] + 12 * Math.floor(deg / 7);
      if (strong) midi = snapToChord(midi, theme.root + ch.r, ch.c);
      out.push({ step: b * 16 + s, midi, dur: strong ? 0.42 : 0.26, vel: strong ? 0.95 : 0.6 });
    }
  }
  // resolve the loop onto the tonic so it turns over cleanly
  out.push({ step: 7 * 16 + 12, midi: theme.root + theme.leadOct + 12, dur: 0.7, vel: 0.9 });
  return out.sort((a, b) => a.step - b.step);
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent engine voice. Allocated ONCE; every state change is an AudioParam
// automation, never a new node.
//
// ── WAVE 4 REDESIGN ─────────────────────────────────────────────────────────
// The Wave-3 voice was two detuned SAWS plus a square, through a heavy tanh(6)
// drive, at a bus level of 0.32. Measured on the real build it sat at rms 0.080
// at rpm 0.15 and only 0.101 at full throttle: a loud, constant, grating buzz
// that barely acknowledged the throttle and covered the music and the SFX.
// Three separate things were wrong, and all three are fixed here:
//   1. TIMBRE. Saws + square + hard drive is an all-harmonics wall. The body is
//      now two detuned TRIANGLES (odd harmonics, rolling off fast = warm) with a
//      single quiet saw for something for the filter to bite on, and the square
//      is down to a trace that only appears under strain. The drive is tanh(2).
//   2. DYNAMICS. Output level was a function of load only, so idle and flat-out
//      measured almost the same. It now scales with rpm as well, ~2.4x across
//      the range, so a child hears the kart accelerate rather than just hearing
//      a filter open.
//   3. MIX. The engine is a CONTINUOUS bed under intermittent SFX and music, so
//      it must sit well below both. Bus level 0.32 → ENGINE_BUS.
//
// Layers:
//   triangle A + triangle B (detuned) → warm body
//   sawtooth (quiet)                  → harmonic food for the resonant sweep
//   square @ 2x (trace, strain-only)  → the two-stroke edge, now an accent
//   sine sub @ 0.5x                   → weight
//   band-passed noise                 → induction roar / air
//   + a lowpassed noise bed           → off-track surface rumble
// then a shared resonant lowpass whose cutoff sweeps with rpm — that sweep, not
// distortion, is what now carries the "revving" sensation — and a soft drive.
// Irregularity comes from two incommensurate LFOs on detune + amplitude, so the
// pitch never sits perfectly still — that is the difference between an engine
// and a test tone.
// ─────────────────────────────────────────────────────────────────────────────
class EngineVoice {
  constructor(A, opts = {}) {
    const c = A.ctx;
    this.A = A;
    this.level = opts.level ?? 0.5;
    this.pitchOffset = opts.detune ?? 0;   // cents — separates AI karts from the player
    this.player = opts.player !== false;
    this.enabled = false;

    this.out = c.createGain(); this.out.gain.value = 0;
    this.out.connect(A.engineBus);

    this.shaper = c.createWaveShaper();
    this.shaper.curve = A._driveCurve;
    this.shaper.connect(this.out);

    this.drive = c.createGain(); this.drive.gain.value = 0.40;
    this.drive.connect(this.shaper);

    // Moderate resonance: enough for the cutoff sweep to be *heard* as a sweep,
    // well short of the Q=6.5 whistle the old boost setting produced.
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass'; this.lp.frequency.value = 420; this.lp.Q.value = 1.6;
    this.lp.connect(this.drive);

    // amplitude wobble node (base 1.0, LFOs add on top)
    this.wob = c.createGain(); this.wob.gain.value = 1;
    this.wob.connect(this.lp);

    const mk = (type, g) => {
      const o = c.createOscillator(); o.type = type;
      const gg = c.createGain(); gg.gain.value = g;
      o.connect(gg); gg.connect(this.wob);
      o.start(0);
      return { o, g: gg };
    };
    // Warm body first, edge second. Triangles carry the note; the saw is only
    // there so the resonant sweep has upper harmonics to move through.
    this.triA = mk('triangle', 0.32);
    this.triB = mk('triangle', 0.24); this.triB.o.detune.value = 9;
    this.saw = mk('sawtooth', 0.085);
    this.sqr = mk('square', 0.022);            // trace only; strain brings it in
    this.sub = mk('sine', 0.26);
    this.whine = mk('sine', 0.0);              // boost-only resonant whistle
    this.whine.o.detune.value = 4;
    // every pitched layer, in one place — used by the detune/LFO wiring below
    this.oscs = [this.triA, this.triB, this.saw, this.sqr, this.sub, this.whine];

    // noise: induction roar
    this.nz = c.createBufferSource(); this.nz.buffer = A._noiseBuf; this.nz.loop = true;
    this.bp = c.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 800; this.bp.Q.value = 0.9;
    this.nzg = c.createGain(); this.nzg.gain.value = 0.06;
    this.nz.connect(this.bp); this.bp.connect(this.nzg); this.nzg.connect(this.wob);
    this.nz.start(0);

    // noise: surface rumble (grass / sand), bypasses the engine lowpass
    this.rz = c.createBufferSource(); this.rz.buffer = A._noiseBuf; this.rz.loop = true;
    this.rlp = c.createBiquadFilter(); this.rlp.type = 'lowpass'; this.rlp.frequency.value = 260; this.rlp.Q.value = 1.2;
    this.rzg = c.createGain(); this.rzg.gain.value = 0;
    this.rz.connect(this.rlp); this.rlp.connect(this.rzg); this.rzg.connect(this.drive);
    this.rz.start(0);

    // two incommensurate LFOs → pitch jitter + burble. Irrational-ish ratio on
    // purpose so the pattern never audibly repeats.
    this.lfoA = c.createOscillator(); this.lfoA.type = 'sine'; this.lfoA.frequency.value = 4.7;
    this.lfoB = c.createOscillator(); this.lfoB.type = 'triangle'; this.lfoB.frequency.value = 11.31;
    this.jitA = c.createGain(); this.jitA.gain.value = 14;   // cents
    this.jitB = c.createGain(); this.jitB.gain.value = 6;
    this.ampA = c.createGain(); this.ampA.gain.value = 0.12; // wobble depth
    this.lfoA.connect(this.jitA); this.lfoB.connect(this.jitB);
    this.lfoA.connect(this.ampA); this.ampA.connect(this.wob.gain);
    for (const v of this.oscs) {
      this.jitA.connect(v.o.detune); this.jitB.connect(v.o.detune);
    }
    this.lfoA.start(0); this.lfoB.start(0);

    this._last = -1;
  }

  // rpm01 0..1, load 0..1, boosting bool, surface 'road'|'grass'|'sand'|'dirt'
  setAt(time, s = {}, tau = 0.06) {
    const rpm = clamp(s.rpm01 ?? 0, 0, 1);
    const load = clamp(s.load ?? 0.5, 0, 1);
    const boost = !!s.boosting;
    const surf = s.surface || 'road';

    // LOAD, not just speed, is what an engine sounds like.
    //   strain = lots of throttle and not much speed (uphill, hard launch, wheels
    //            fighting the surface). The note SAGS a little, the buzz and the
    //            mid growl come up, and the burble deepens — it lugs.
    //   coast  = off the throttle. Harmonics fall away, it goes quiet and soft,
    //            with a touch of overrun flutter.
    const strain = clamp((load - rpm) * 1.35, 0, 1);
    const coast = clamp(1 - load * 2.4, 0, 1);

    // firing frequency: a small 2-stroke idles low and screams high.
    let f = lerp(36, 205, Math.pow(rpm, 1.08));
    f *= lerp(1, 0.945, strain);                 // lugging pulls the note down
    f *= lerp(1, 1.012, coast);                  // free-revving sits fractionally sharp
    if (boost) f *= 1.055;                       // the distinct "on the pipe" note lift
    const det = this.pitchOffset + (boost ? 88 : 0) - strain * 26;

    const sq = (p, v) => { try { p.setTargetAtTime(v, time, tau); } catch { /* param clamp */ } };

    sq(this.triA.o.frequency, f);
    sq(this.triB.o.frequency, f * 1.004);
    sq(this.saw.o.frequency, f);
    sq(this.sqr.o.frequency, f * 2);
    sq(this.sub.o.frequency, f * 0.5);
    sq(this.whine.o.frequency, f * 6);
    for (const v of this.oscs) sq(v.o.detune, det);

    // The cutoff sweep is now the WHOLE revving sensation — the drive stage no
    // longer manufactures harmonics, so what the child hears opening up is this
    // filter travelling. Ceiling pulled down from 12 kHz to 5.2 kHz: above that
    // there is nothing left but the harsh top of the saw, which is exactly the
    // part that made the old voice grate. Coasting shuts it down fast, which is
    // what makes lifting off audibly *relax*.
    sq(this.lp.frequency, clamp((300 + Math.pow(rpm, 1.25) * 2350 * (boost ? 1.35 : 1) * (0.75 + 0.4 * load)
      + 420 * strain) * lerp(1, 0.55, coast), 140, 5200));
    sq(this.lp.Q, (boost ? 3.2 : lerp(1.2, 2.4, rpm)) + 0.9 * strain);
    sq(this.drive.gain, (lerp(0.32, 0.52, load) + 0.14 * strain) * (boost ? 1.12 : 1) * lerp(1, 0.75, coast));
    // the square layer IS the strain: buzzy odd harmonics when it is working hard,
    // and essentially absent the rest of the time
    sq(this.sqr.g.gain, clamp(0.018 + 0.055 * strain - 0.012 * coast, 0, 0.09));

    // noise roar tracks rpm and load — halved, it was a hiss bed of its own
    sq(this.bp.frequency, 420 + rpm * 1900);
    sq(this.nzg.gain, lerp(0.014, 0.052, rpm) * lerp(0.6, 1.25, load) * lerp(1, 0.45, coast));
    sq(this.whine.g.gain, boost ? 0.022 : 0.0);

    // idle burble: deep, slow wobble at low rpm, tightening as it revs out.
    // Under strain the wobble deepens and slows — that is the "lug".
    sq(this.lfoA.frequency, lerp(4.1, 23, rpm) * lerp(1, 0.68, strain));
    sq(this.lfoB.frequency, lerp(9.3, 47, rpm));
    sq(this.ampA.gain, lerp(0.17, 0.035, rpm) + 0.09 * strain + 0.035 * coast);
    sq(this.jitA.gain, lerp(16, 4, rpm) + 7 * strain);
    sq(this.jitB.gain, lerp(7, 2, rpm));

    const rum = surf === 'grass' ? 0.22 : surf === 'sand' ? 0.19 : surf === 'dirt' ? 0.16 : 0;
    sq(this.rlp.frequency, surf === 'sand' ? 420 : 240);
    sq(this.rzg.gain, rum * lerp(0.35, 1, rpm));

    if (this.enabled) sq(this.out.gain, this.level * this._levelFor(rpm, load, coast));
  }

  // Loudness as a function of speed. The old voice scaled with LOAD alone, so
  // idling and flat-out measured within 1 dB of each other and the engine read as
  // a constant buzz. ~2.4x (7.6 dB) across the rev range is the difference
  // between "a noise is happening" and "I am accelerating".
  _levelFor(rpm, load, coast) {
    return (0.02 + 1.00 * Math.pow(rpm, 2.2)) * lerp(0.80, 1, load) * lerp(1, 0.55, coast);
  }

  enable(time, fade = 0.25) {
    if (this.enabled) return;
    this.enabled = true;
    const g = this.out.gain;
    // Ramp to the IDLE level, not to full: the following setAt() writes the real
    // value, and ramping to `level` first put an audible swell on every start.
    const v = this.level * this._levelFor(0, 0.5, 0);
    try { g.cancelScheduledValues(time); g.setValueAtTime(g.value, time); g.linearRampToValueAtTime(v, time + fade); } catch { /* noop */ }
  }
  disable(time, fade = 0.35) {
    if (!this.enabled) return;
    this.enabled = false;
    const g = this.out.gain;
    try { g.cancelScheduledValues(time); g.setValueAtTime(g.value, time); g.linearRampToValueAtTime(0, time + fade); } catch { /* noop */ }
  }
  dispose() {
    for (const n of this.oscs) { try { n.o.stop(); } catch { /* */ } }
    for (const n of [this.nz, this.rz, this.lfoA, this.lfoB]) { try { n.stop(); } catch { /* */ } }
    try { this.out.disconnect(); } catch { /* */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent drift-scrape voice: band-passed noise whose centre frequency and
// gain rise with the drift charge, plus a resonant "charge" tone that appears as
// the mini-boost becomes available.
// ─────────────────────────────────────────────────────────────────────────────
class DriftVoice {
  constructor(A) {
    const c = A.ctx;
    this.A = A;
    this.active = false;
    this.out = c.createGain(); this.out.gain.value = 0; this.out.connect(A.worldBus);
    this.bp = c.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 1200; this.bp.Q.value = 2.6;
    // broadband air layer — supporting cast now, not the main event
    this.hiss = c.createGain(); this.hiss.gain.value = 0.5;
    this.bp.connect(this.hiss); this.hiss.connect(this.out);
    this.hp = c.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 600;
    this.hp.connect(this.bp);
    this.n = c.createBufferSource(); this.n.buffer = A._noiseBuf; this.n.loop = true;
    this.n.connect(this.hp); this.n.start(0);
    // Two very high-Q resonators in parallel with the broadband scrape. Ringing
    // noise through a narrow band gives a *pitched* squeal, which is what makes
    // this read as rubber scrubbing rather than a hiss sweep.
    this.sq1 = c.createBiquadFilter(); this.sq1.type = 'bandpass'; this.sq1.frequency.value = 1500; this.sq1.Q.value = 16;
    this.sq2 = c.createBiquadFilter(); this.sq2.type = 'bandpass'; this.sq2.frequency.value = 2260; this.sq2.Q.value = 20;
    this.sg1 = c.createGain(); this.sg1.gain.value = 0;
    this.sg2 = c.createGain(); this.sg2.gain.value = 0;
    this.n.connect(this.sq1); this.sq1.connect(this.sg1); this.sg1.connect(this.out);
    this.n.connect(this.sq2); this.sq2.connect(this.sg2); this.sg2.connect(this.out);
    // charge tone
    this.tone = c.createOscillator(); this.tone.type = 'triangle'; this.tone.frequency.value = 300;
    this.tg = c.createGain(); this.tg.gain.value = 0;
    this.tone.connect(this.tg); this.tg.connect(this.out); this.tone.start(0);
    // scrape wobble
    this.lfo = c.createOscillator(); this.lfo.type = 'sine'; this.lfo.frequency.value = 17.3;
    this.lg = c.createGain(); this.lg.gain.value = 260;
    this.lfo.connect(this.lg); this.lg.connect(this.bp.frequency); this.lfo.start(0);

    // ── granular stick-slip layer (the actual "rubber tearing") ─────────────
    // Two pre-rendered densities, crossfaded by charge, through their own
    // bandpass. Everything is allocated here, once.
    this.grainBus = c.createGain(); this.grainBus.gain.value = 0;
    this.gbp = c.createBiquadFilter(); this.gbp.type = 'bandpass';
    this.gbp.frequency.value = 1800; this.gbp.Q.value = 0.85;
    this.grainBus.connect(this.gbp); this.gbp.connect(this.out);
    const mkg = (buffer, gain) => {
      const s = c.createBufferSource();
      s.buffer = buffer; s.loop = true;
      const gg = c.createGain(); gg.gain.value = gain;
      s.connect(gg); gg.connect(this.grainBus);
      s.start(0);
      return { s, g: gg };
    };
    this.gSlow = mkg(A._grainSlow, 1);
    this.gFast = mkg(A._grainFast, 0);
  }
  setAt(time, charge, tau = 0.08) {
    const ch = clamp(charge, 0, 1);
    const sq = (p, v) => { try { p.setTargetAtTime(v, time, tau); } catch { /* */ } };
    sq(this.bp.frequency, 900 + ch * 2600);
    sq(this.bp.Q, 2.2 + ch * 5);
    sq(this.tone.frequency, 220 + ch * 340);
    sq(this.tg.gain, ch > 0.45 ? 0.03 + (ch - 0.45) * 0.09 : 0);
    sq(this.lfo.frequency, 14 + ch * 20);
    // the squeal rises a musical ~5th over the charge and gets louder as the
    // tyres load up; the second resonator sits on a non-integer ratio so the
    // pair beat against each other instead of sounding like one clean tone
    sq(this.sq1.frequency, 1250 + ch * 900);
    sq(this.sq2.frequency, (1250 + ch * 900) * 1.51);
    sq(this.sg1.gain, this.active ? 0.05 + ch * 0.13 : 0);
    sq(this.sg2.gain, this.active ? 0.03 + ch * 0.09 : 0);

    // grain train: density, pitch and brightness all climb with the charge, so
    // the tyre goes from an intermittent crackle to a continuous tear
    sq(this.gSlow.g.gain, 1 - ch * 0.85);
    sq(this.gFast.g.gain, 0.12 + ch * 0.95);
    sq(this.gSlow.s.playbackRate, 0.88 + ch * 0.5);
    sq(this.gFast.s.playbackRate, 0.92 + ch * 0.55);
    sq(this.gbp.frequency, 1500 + ch * 2100);
    sq(this.gbp.Q, 0.8 + ch * 1.5);
    sq(this.grainBus.gain, this.active ? 0.22 + ch * 0.30 : 0);
    // the broadband hiss steps back as the grains take over
    sq(this.hiss.gain, 0.40 - ch * 0.17);

    if (this.active) sq(this.out.gain, 0.075 + ch * 0.12);
  }
  start(time) {
    this.active = true;
    const g = this.out.gain;
    try { g.cancelScheduledValues(time); g.setValueAtTime(g.value, time); g.linearRampToValueAtTime(0.11, time + 0.06); } catch { /* */ }
    const gg = this.grainBus.gain;
    try { gg.cancelScheduledValues(time); gg.setValueAtTime(gg.value, time); gg.linearRampToValueAtTime(0.22, time + 0.05); } catch { /* */ }
  }
  stop(time, fade = 0.12) {
    this.active = false;
    for (const g of [this.out.gain, this.sg1.gain, this.sg2.gain, this.tg.gain, this.grainBus.gain]) {
      try { g.cancelScheduledValues(time); g.setValueAtTime(g.value, time); g.linearRampToValueAtTime(0, time + fade); } catch { /* */ }
    }
  }
  dispose() {
    for (const n of [this.n, this.tone, this.lfo, this.gSlow.s, this.gFast.s]) { try { n.stop(); } catch { /* */ } }
    try { this.out.disconnect(); } catch { /* */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The system
// ─────────────────────────────────────────────────────────────────────────────
class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ok = false;              // graph is live
    this.broken = false;          // Web Audio unavailable — permanently silent
    this._ownsCtx = true;
    this.muted = !!save.read('muted');
    // Balanced by measurement: the engine is a CONTINUOUS bed under intermittent
    // SFX and music, so it must sit well under both or it is all a player hears.
    // Wave 4 dropped engine 0.32 → ENGINE_BUS after measuring the built game: the
    // old voice metered rms 0.080 at idle rpm against 0.101 flat out, i.e. a
    // permanent buzz with almost no throttle response. See EngineVoice's header.
    this.vol = { master: readSavedVolume(), music: 0.85, sfx: 1.0, engine: ENGINE_BUS };
    this._ducked = false;         // soft duck (pause menu, legacy duck() calls)
    this._modalDucked = false;    // hard duck — ANY modal owns the screen
    this.sounds = new Map();
    this._pending = [];           // {end} — deterministic voice accounting
    this._nodes = new Set();      // live source nodes, for dispose()
    this._offs = [];              // bus unsubscribers
    this._ai = [];
    this._combo = 0;
    this._lastEngineWrite = -1;
    this.peakVoices = 0;
    this.stats = { played: 0, dropped: 0 };
    this._unlockBound = null;
    this.music = null;
    this._registerSounds();
    this._wireBus();
    this._wireModalDuck();
    this._installUnlock();
  }

  // ── automatic modal ducking ────────────────────────────────────────────────
  // Subscribing to the registry itself — NOT to a list of modal ids, and NOT at
  // each modal's call site. Wave 3's five modals were wired one at a time and the
  // sixth would have been forgotten; `onModalChange` fires for every id that will
  // ever be pushed, including ones that do not exist yet. tests/audio.test.mjs
  // pins that by pushing an invented id.
  _wireModalDuck() {
    if (this._offModal) return;
    this._offModal = onModalChange(any => this.setModalDuck(any));
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  /**
   * init({context}) — normally called for you on the first user gesture.
   * Pass an OfflineAudioContext to render the whole graph offline (that is how
   * .tmp/audiocheck.mjs measures every sound).
   */
  init(opts = {}) {
    if (this.ok || this.broken) return this;
    try {
      const Ctor = opts.context ? null : (globalThis.AudioContext || globalThis.webkitAudioContext);
      if (!opts.context && !Ctor) { this.broken = true; return this; }
      this.ctx = opts.context || new Ctor({ latencyHint: 'interactive' });
      this._ownsCtx = !opts.context;
      this._build();
      this.ok = true;
      if (opts.muted !== undefined) this.muted = !!opts.muted;
      this._applyMute(0);
    } catch (e) {
      this.broken = true; this.ctx = null;
      console.warn('audio unavailable, running silent:', e && e.message);
    }
    return this;
  }

  _build() {
    const c = this.ctx;
    // deterministic noise — Math.random is banned project-wide
    const rng = makeRng(0x5EED1);
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 2), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
    this._noiseBuf = buf;
    // two stick-slip densities for the drift scrape (see grainBuffer)
    this._grainSlow = grainBuffer(c, makeRng(0x5C4A9E), 46, 1900);
    this._grainFast = grainBuffer(c, makeRng(0x7EA411), 190, 2900);
    this._driveCurve = driveCurve(2);   // Wave 4: was 6 — see driveCurve()

    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.vol.master;

    this.clip = c.createWaveShaper();
    this.clip.curve = softClipCurve(0.55, 0.97);
    this.clip.oversample = '2x';

    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -3; this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.06;

    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 22;
    this.comp.ratio.value = 5; this.comp.attack.value = 0.005; this.comp.release.value = 0.2;

    this.musicBus = c.createGain(); this.musicBus.gain.value = this.vol.music;
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = this.vol.sfx;
    this.engineBus = c.createGain(); this.engineBus.gain.value = this.vol.engine;
    // WORLD bus: continuous, diegetic, "the kart is doing something" audio that
    // is not the engine — currently the drift scrape. It exists so the modal duck
    // can silence the world without touching the SFX bus, which must stay OPEN:
    // the quiz's own stingers and every UI click live there, and a modal that
    // muted its own buttons would be worse than no ducking at all.
    this.worldBus = c.createGain(); this.worldBus.gain.value = 1;
    this.worldBus.connect(this.sfxBus);

    this.musicBus.connect(this.comp);
    this.sfxBus.connect(this.comp);
    this.engineBus.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(this.clip);
    this.clip.connect(this.master);
    this.master.connect(c.destination);

    this.engine = new EngineVoice(this, { level: ENGINE_LEVEL, player: true });
    this.drift = new DriftVoice(this);
    this.music = new MusicEngine(this);
    // A duck may already be in force when the graph is (re)built — e.g. the game
    // was reloaded straight into a scene that opens a modal, or dispose()/init()
    // cycled the context while a panel was up. Apply it, do not assume open.
    this._applyBuses(0);
  }

  // ── autoplay unlock ────────────────────────────────────────────────────────
  // Rules learned the hard way, all of them load-bearing:
  //  * NEVER `{once:true}`. A synthetic or stray event would spend the listener
  //    and the real gesture would then never resume anything.
  //  * CAPTURE phase, on BOTH window and document. Every menu button in this
  //    game lives in a DOM overlay above the canvas; a handler that calls
  //    stopPropagation() on the way up would otherwise eat the only gesture.
  //  * Every gesture type, including `click` and `pointerup` — some embedded
  //    webviews only treat the completed tap as activation.
  //  * Re-check AFTER resume() settles (it is a promise; the state is still
  //    'suspended' on the next line), and stay armed until it really is running.
  //  * Re-resume on visibilitychange: coming back to a backgrounded tab can find
  //    the context suspended again with no further gesture coming.
  _installUnlock() {
    if (typeof document === 'undefined' || this._unlockBound) return;
    const go = () => { this.unlock(true); };
    this._unlockBound = go;
    this._visBound = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && this.ok
        && this.ctx && this.ctx.state === 'suspended' && this._gestured) this.unlock();
    };
    for (const ev of UNLOCK_EVENTS) {
      for (const tgt of [window, document]) {
        try { tgt.addEventListener(ev, go, { passive: true, capture: true }); } catch { /* */ }
      }
    }
    try { document.addEventListener('visibilitychange', this._visBound); } catch { /* */ }
  }
  _removeUnlock() {
    if (typeof document === 'undefined') return;
    if (this._unlockBound) {
      for (const ev of UNLOCK_EVENTS) {
        for (const tgt of [window, document]) {
          try { tgt.removeEventListener(ev, this._unlockBound, { capture: true }); } catch { /* */ }
        }
      }
      this._unlockBound = null;
    }
    // The visibility re-resume stays installed for the life of the page: a tab
    // that is backgrounded and restored gets suspended again with no new gesture.
  }

  /**
   * Create/resume the context. Safe to call any number of times, and safe to
   * call outside a gesture (it just will not succeed until one arrives).
   */
  unlock(fromGesture = false) {
    if (this.broken) return false;
    if (!this.ok) this.init();
    if (!this.ok) return false;
    if (fromGesture) this._gestured = true;
    try {
      if (this.ctx.state === 'suspended' && this.ctx.resume) {
        this.ctx.resume().then(() => {
          if (this.ok && this.ctx && this.ctx.state === 'running') this._removeUnlock();
        }).catch(() => { /* not a gesture yet — the listeners stay armed */ });
      }
    } catch { /* */ }
    if (this.ctx.state === 'running') { this._removeUnlock(); return true; }
    // Make the failure impossible to miss. If a real gesture has happened and the
    // context is STILL not running a moment later, something in the host page is
    // blocking playback — say so loudly instead of shipping silence.
    if (fromGesture && !this._blockedTimer && typeof setTimeout === 'function') {
      this._blockedTimer = setTimeout(() => {
        this._blockedTimer = 0;
        if (this.ok && this.ctx && this.ctx.state !== 'running') {
          console.warn('[audio] AudioContext is still "' + this.ctx.state + '" after a user gesture — '
            + 'the game will be SILENT. Check for an autoplay/permissions policy on this page, '
            + 'or call audio.unlock() from inside your own click handler.');
          try { bus.emit('audio:blocked', { state: this.ctx.state }); } catch { /* */ }
        }
      }, 1500);
    }
    return true;
  }

  get ready() { return this.ok && !this.broken && this.ctx && this.ctx.state !== 'closed'; }
  get now() { return this.ready ? this.ctx.currentTime : 0; }

  // ── mixing ─────────────────────────────────────────────────────────────────
  setMuted(m, persist = true) {
    this.muted = !!m;
    if (persist) { try { save.set({ muted: this.muted }); } catch { /* */ } }
    this._applyMute(0.08);
    bus.emit('audio:muted', this.muted);
    return this.muted;
  }
  toggleMute() { return this.setMuted(!this.muted); }
  _applyMute(fade = 0.08) {
    if (!this.ready) return;
    const g = this.master.gain, tN = this.now;
    const v = this.muted ? 0 : this.vol.master;
    try { g.cancelScheduledValues(tN); g.setValueAtTime(g.value, tN); g.linearRampToValueAtTime(v, tN + fade); } catch { g.value = v; }
    if (!this.muted) this.unlock();
  }
  /**
   * setMasterVolume(v, persist = true) — the settings screen's volume slider.
   *   v        0..1, clamped; anything non-finite is treated as 0.
   *   persist  write it to save (`volume`); pass false for a preview drag.
   * Returns the clamped value. Independent of `muted`: while muted the output
   * stays at zero and unmuting restores exactly this level.
   */
  setMasterVolume(v, persist = true) {
    const x = clamp(typeof v === 'number' && isFinite(v) ? v : 0, 0, 1);
    this.vol.master = x;
    if (persist) { try { save.set({ volume: x }); } catch { /* private mode */ } }
    this._applyMute(0.05);
    try { bus.emit('audio:masterVolume', x); } catch { /* */ }
    return x;
  }
  /** @returns {number} the current master volume, 0..1 (NOT affected by mute). */
  getMasterVolume() { return this.vol.master; }

  /**
   * setModalDuck(on) — called automatically by the modal registry subscription in
   * _wireModalDuck(); nothing needs to call it by hand. While ANY modal owns the
   * screen the engine and the world bus go to true zero and the music steps back
   * to MODAL_MUSIC. Both moves are linear ramps over MODAL_DUCK_RAMP, so they
   * fade rather than click, and the state survives volume changes because every
   * bus gain is written from one place (_applyBuses).
   */
  setModalDuck(on) {
    const v = !!on;
    if (v === this._modalDucked) return;
    this._modalDucked = v;
    this._applyBuses(MODAL_DUCK_RAMP);
  }

  /**
   * duck(on) — the SOFT duck: the pause menu's "pull the race bed down a bit".
   * Kept for `race:pause` / `race:resume`, and now subordinate to the modal duck,
   * which is a full stop rather than an attenuation.
   */
  duck(on = true) {
    this._ducked = !!on;
    this._applyBuses(0.12);
  }

  /**
   * The ONLY place the three group buses are written. Every state that can move
   * them — the per-group volumes, the soft duck, the modal duck — is folded in
   * here, so they can never disagree. That mattered: the old code applied the
   * duck and the volumes from two places, and a volume change mid-duck undid it.
   */
  _applyBuses(fade = 0.08) {
    if (!this.ready) return;
    const t = this.now;
    const ramp = (node, v) => {
      if (!node) return;
      const g = node.gain;
      try {
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        if (fade > 0) g.linearRampToValueAtTime(v, t + fade); else g.setValueAtTime(v, t);
      } catch { try { g.value = v; } catch { /* */ } }
    };
    const m = this._modalDucked, d = this._ducked;
    // Engine and world: SILENT under a modal — not quiet, silent. A linear ramp
    // to exactly 0 (setTargetAtTime only ever approaches it asymptotically).
    ramp(this.engineBus, m ? 0 : this.vol.engine * (d ? 0.20 : 1));
    ramp(this.worldBus, m ? 0 : 1);
    // Music: JUDGEMENT CALL — it ducks, it does not stop. A quiz card is a beat
    // inside the race, not a scene change; cutting the music dead makes it read
    // as "the game broke" and the restart on close is far more jarring than the
    // duck. -9 dB is enough for the Hebrew to be read in peace.
    ramp(this.musicBus, this.vol.music * (m ? MODAL_MUSIC : d ? 0.42 : 1));
    // SFX stays OPEN under a modal: the quiz stingers and the UI clicks the child
    // is about to make are on this bus.
    ramp(this.sfxBus, this.vol.sfx * (d && !m ? 0.72 : 1));
  }

  setVolume(p = {}) {
    Object.assign(this.vol, p);
    if (!this.ready) return;
    if (p.master !== undefined) this._applyMute(0.03);
    this._applyBuses(0.03);
  }

  // ── voice budget ───────────────────────────────────────────────────────────
  // Uses the *scheduler* clock, not wall time, so it behaves identically when a
  // whole race is rendered ahead-of-time into an OfflineAudioContext.
  _reserve(at, dur, extra = 0) {
    let w = 0;
    for (let i = 0; i < this._pending.length; i++) if (this._pending[i] > at) this._pending[w++] = this._pending[i];
    this._pending.length = w;
    if (this._pending.length >= MAX_VOICES + extra) { this.stats.dropped++; return false; }
    this._pending.push(at + dur);
    if (this._pending.length > this.peakVoices) this.peakVoices = this._pending.length;
    return true;
  }
  get activeVoices() { return this._pending.length; }

  _track(node) {
    this._nodes.add(node);
    try { node.onended = () => this._nodes.delete(node); } catch { /* */ }
    return node;
  }

  // ── primitive synth voices ─────────────────────────────────────────────────
  // o: {type,f,f2,glide,dur,hold,attack,peak,filter,filter2,filterType,q,detune,dest,pan}
  _tone(t, o = {}) {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    const f = Math.max(8, o.f || 440);
    osc.frequency.setValueAtTime(f, t);
    if (o.f2) {
      const glide = o.glide ?? (o.dur || 0.2);
      try { osc.frequency.exponentialRampToValueAtTime(Math.max(8, o.f2), t + glide); } catch { /* */ }
    }
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    let node = osc;
    if (o.filter) {
      const bf = c.createBiquadFilter();
      bf.type = o.filterType || 'lowpass';
      bf.Q.setValueAtTime(o.q ?? 1, t);
      bf.frequency.value = o.filter;
      bf.frequency.setValueAtTime(o.filter, t);
      if (o.filter2) { try { bf.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter2), t + (o.dur || 0.2)); } catch { /* */ } }
      node.connect(bf); node = bf;
    }
    const g = c.createGain();
    // MUST start at 0: a GainNode's intrinsic value is 1.0 until its first
    // scheduled event, and sources start with sub-sample accuracy — leaving it
    // at the default lets a single full-scale sample through as an audible click.
    g.gain.value = 0;
    const peak = o.peak ?? 0.2, a = o.attack ?? 0.005, hold = o.hold ?? 0, dec = o.dur ?? 0.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(EPS, t + a + hold + dec);
    node.connect(g);
    g.connect(o.dest || this.sfxBus);
    osc.start(t);
    const end = t + a + hold + dec + 0.03;
    osc.stop(end);
    this._track(osc);
    return end;
  }

  // o: {dur,attack,hold,peak,type('bandpass'|'lowpass'|'highpass'),f,f2,q,dest,rate}
  _noise(t, o = {}) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this._noiseBuf;
    s.loop = true;
    if (o.rate) s.playbackRate.value = o.rate;
    const bf = c.createBiquadFilter();
    bf.type = o.type || 'bandpass';
    bf.Q.setValueAtTime(o.q ?? 1, t);
    bf.frequency.value = Math.max(20, o.f ?? 1200);
    bf.frequency.setValueAtTime(Math.max(20, o.f ?? 1200), t);
    if (o.f2) { try { bf.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.dur || 0.2)); } catch { /* */ } }
    const g = c.createGain();
    g.gain.value = 0;                       // see _tone: avoids a one-sample click
    const peak = o.peak ?? 0.2, a = o.attack ?? 0.004, hold = o.hold ?? 0, dec = o.dur ?? 0.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(EPS, t + a + hold + dec);
    s.connect(bf); bf.connect(g); g.connect(o.dest || this.sfxBus);
    s.start(t);
    const end = t + a + hold + dec + 0.03;
    s.stop(end);
    this._track(s);
    return end;
  }

  // A short pitched percussive "blip" used all over the UI.
  _blip(t, midi, o = {}) {
    return this._tone(t, {
      type: o.type || 'triangle', f: mtof(midi), dur: o.dur ?? 0.09,
      peak: o.peak ?? 0.16, attack: 0.003, filter: o.filter ?? 5200, q: 0.7, dest: o.dest,
    });
  }

  // ── drum voices (used by the music engine and a few stings) ────────────────
  _kick(t, v = 1, dest) {
    this._tone(t, { type: 'sine', f: 155, f2: 44, glide: 0.09, dur: 0.26, peak: 0.5 * v, attack: 0.003, dest });
    this._noise(t, { type: 'lowpass', f: 900, dur: 0.03, peak: 0.10 * v, attack: 0.001, dest });
  }
  _snare(t, v = 1, dest) {
    this._noise(t, { type: 'bandpass', f: 1900, q: 0.8, dur: 0.13, peak: 0.20 * v, attack: 0.002, dest });
    this._tone(t, { type: 'triangle', f: 196, f2: 150, dur: 0.09, peak: 0.11 * v, attack: 0.002, dest });
  }
  _hat(t, v = 1, open = false, dest) {
    this._noise(t, { type: 'highpass', f: 7600, q: 0.6, dur: open ? 0.16 : 0.032, peak: 0.075 * v, attack: 0.001, dest });
  }
  _shaker(t, v = 1, dest) {
    this._noise(t, { type: 'bandpass', f: 5200, q: 1.4, dur: 0.05, peak: 0.055 * v, attack: 0.006, dest });
  }
  // Hand percussion for the oasis palette: a low "doum" and a sharp "tek".
  _hand(t, hi = false, v = 1, dest) {
    if (hi) {
      this._tone(t, { type: 'sine', f: 420, f2: 300, dur: 0.06, peak: 0.14 * v, attack: 0.002, dest });
      this._noise(t, { type: 'bandpass', f: 3400, q: 1.1, dur: 0.045, peak: 0.10 * v, attack: 0.001, dest });
    } else {
      this._tone(t, { type: 'sine', f: 132, f2: 74, dur: 0.20, peak: 0.34 * v, attack: 0.004, dest });
      this._noise(t, { type: 'lowpass', f: 500, dur: 0.05, peak: 0.05 * v, attack: 0.001, dest });
    }
  }
  _click(t, v = 1, dest) {  // garage mechanical tick
    this._noise(t, { type: 'bandpass', f: 3000, q: 3.5, dur: 0.03, peak: 0.11 * v, attack: 0.001, dest });
    this._tone(t, { type: 'square', f: 1400, f2: 900, dur: 0.022, peak: 0.05 * v, attack: 0.001, filter: 4000, dest });
  }

  // ── public sound API ───────────────────────────────────────────────────────
  /**
   * play(name, opts) — opts.at schedules at an absolute context time (used by
   * the offline verification harness); otherwise it plays now.
   */
  play(name, opts = {}) {
    if (this.muted || this.broken) return false;
    if (!this.ok) { this.init(); if (!this.ok) return false; }
    const s = this.sounds.get(name);
    if (!s) return false;
    const at = Math.max(opts.at ?? this.now, 0) + (opts.at != null ? 0 : 0.004);
    if (!this._reserve(at, s.dur, s.priority ? 8 : 0)) return false;
    try { s.fn.call(this, at, opts); this.stats.played++; return true; } catch (e) {
      console.warn('audio: sound failed', name, e && e.message); return false;
    }
  }
  /** Every registered sound, for the preview panel and the offline checker. */
  list() { return [...this.sounds.entries()].map(([k, v]) => ({ name: k, group: v.group, dur: v.dur, label: v.label })); }

  _snd(name, group, dur, label, fn, priority = false) {
    this.sounds.set(name, { group, dur, label, fn, priority });
  }

  // ── engine control ─────────────────────────────────────────────────────────
  /** setEngineState({rpm01, load, boosting, surface}) — call every frame; cheap. */
  setEngineState(s = {}) {
    if (this.muted || this.broken) return;
    if (!this.ok) return;                     // no context yet: silently ignore
    const tN = this.now;
    if (tN - this._lastEngineWrite < 0.033) return;   // throttle to ~30Hz
    this._lastEngineWrite = tN;
    this.engine.enable(tN);
    this.engine.setAt(tN, s, 0.05);
    this._engineState = s;
  }
  stopEngine() { if (this.ok) this.engine.disable(this.now); }

  /** setAiEngines([{rpm01,load,boosting,surface,dist}]) — max 3, cheap voices. */
  setAiEngines(list = []) {
    if (!this.ok || this.muted) return;
    const tN = this.now;
    const n = Math.min(3, list.length);
    while (this._ai.length < n) {
      const i = this._ai.length;
      this._ai.push(new EngineVoice(this, { level: AI_ENGINE_LEVEL, detune: [-72, 58, 121][i], player: false }));
    }
    for (let i = 0; i < this._ai.length; i++) {
      const v = this._ai[i];
      if (i < n) {
        const s = list[i];
        const d = clamp(1 - (s.dist ?? 0) / 45, 0.05, 1);
        v.level = AI_ENGINE_LEVEL * d * d;
        v.enable(tN);
        v.setAt(tN, s, 0.09);
      } else v.disable(tN);
    }
  }

  /** setDrift(charge) / driftStart() / driftEnd() */
  driftStart() { if (!this.ok || this.muted) return; this.drift.start(this.now); this.play('drift.start'); }
  setDrift(charge) { if (this.ok && !this.muted) this.drift.setAt(this.now, charge, 0.07); }
  driftEnd(released) { if (!this.ok) return; this.drift.stop(this.now); if (released) this.play('boost.release'); }

  // ── music control ──────────────────────────────────────────────────────────
  playMusic(track, opts = {}) {
    if (this.broken) return;
    if (!this.ok) { this.init(); if (!this.ok) return; }
    this.music.start(track, opts);
  }
  stopMusic(fade = 0.6) { if (this.ok) this.music.stop(fade); }
  setMusicIntensity(x) { if (this.ok) this.music.setIntensity(x); }

  // ── teardown ───────────────────────────────────────────────────────────────
  dispose() {
    for (const off of this._offs) { try { off(); } catch { /* */ } }
    this._offs.length = 0;
    if (this._offModal) { try { this._offModal(); } catch { /* */ } this._offModal = null; }
    this._removeUnlock();
    if (this.ok) {
      try { this.music.stop(0); } catch { /* */ }
      try { this.engine.dispose(); } catch { /* */ }
      try { this.drift.dispose(); } catch { /* */ }
      for (const v of this._ai) { try { v.dispose(); } catch { /* */ } }
      for (const n of this._nodes) { try { n.stop(); } catch { /* */ } }
      this._nodes.clear();
      try { this.master.disconnect(); } catch { /* */ }
      if (this._ownsCtx) { try { this.ctx.close(); } catch { /* */ } }
    }
    this._ai.length = 0;
    this._pending.length = 0;
    this.ok = false;
    this.ctx = null;
    this.music = null;
    // stay usable: re-init() rebuilds everything, and the bus can be re-wired
    this._wireBus();
    this._wireModalDuck();
    this._installUnlock();
  }

  // ── registry ───────────────────────────────────────────────────────────────
  _registerSounds() {
    const S = (n, g, d, l, fn, p) => this._snd(n, g, d, l, fn, p);

    // ---- UI ----------------------------------------------------------------
    S('ui.hover', 'ui', 0.10, 'Hover', function (t) {
      this._tone(t, { type: 'sine', f: 1180, dur: 0.055, peak: 0.10, attack: 0.002 });
      this._noise(t, { type: 'highpass', f: 6000, dur: 0.014, peak: 0.02, attack: 0.001 });
    });
    S('ui.select', 'ui', 0.18, 'Select', function (t) {
      this._blip(t, 76, { peak: 0.13, dur: 0.055 });
      this._blip(t + 0.045, 83, { peak: 0.14, dur: 0.09 });
    });
    S('ui.confirm', 'ui', 0.42, 'Confirm', function (t) {
      [72, 76, 79, 84].forEach((m, i) => this._blip(t + i * 0.045, m, { peak: 0.13 - i * 0.012, dur: 0.16 }));
      this._noise(t + 0.02, { type: 'highpass', f: 4000, f2: 9000, dur: 0.22, peak: 0.03, attack: 0.02 });
    });
    S('ui.back', 'ui', 0.20, 'Back', function (t) {
      this._blip(t, 74, { peak: 0.12, dur: 0.06 });
      this._blip(t + 0.05, 67, { peak: 0.12, dur: 0.12, filter: 2600 });
    });
    S('ui.error', 'ui', 0.30, 'Error', function (t) {
      this._tone(t, { type: 'square', f: 176, f2: 138, glide: 0.2, dur: 0.2, peak: 0.13, attack: 0.004, filter: 1300, q: 2 });
      this._tone(t + 0.005, { type: 'square', f: 186, f2: 146, glide: 0.2, dur: 0.2, peak: 0.09, attack: 0.004, filter: 1200, q: 2 });
    });

    // ---- countdown / race flow --------------------------------------------
    S('countdown.beep', 'race', 0.42, 'Countdown beep (low)', function (t) {
      this._tone(t, { type: 'sine', f: 440, dur: 0.3, peak: 0.30, attack: 0.004, hold: 0.05 });
      this._tone(t, { type: 'triangle', f: 880, dur: 0.10, peak: 0.07, attack: 0.002 });
      this._noise(t, { type: 'highpass', f: 3000, dur: 0.02, peak: 0.05, attack: 0.001 });
    }, true);
    S('countdown.go', 'race', 0.70, 'Countdown GO (high)', function (t) {
      this._tone(t, { type: 'sine', f: 880, dur: 0.5, peak: 0.32, attack: 0.004, hold: 0.10 });
      this._tone(t, { type: 'triangle', f: 1320, dur: 0.34, peak: 0.12, attack: 0.003 });
      this._tone(t, { type: 'sine', f: 1760, dur: 0.2, peak: 0.06, attack: 0.002 });
      this._noise(t, { type: 'highpass', f: 4000, dur: 0.05, peak: 0.07, attack: 0.001 });
    }, true);
    // Original 5-note rising motif over a major triad — deliberately not a quote.
    S('race.fanfare', 'race', 1.90, 'Race-start fanfare', function (t) {
      const root = 62;                                    // D
      const mel = [[0, 0], [0.13, 7], [0.26, 12], [0.39, 16], [0.55, 19]];
      for (const [d, iv] of mel) {
        this._tone(t + d, { type: 'square', f: mtof(root + iv), dur: 0.22, peak: 0.11, attack: 0.006, filter: 3400, q: 1.2 });
        this._tone(t + d, { type: 'triangle', f: mtof(root + iv + 12), dur: 0.18, peak: 0.05, attack: 0.006 });
      }
      for (const iv of [0, 7, 12, 16]) {
        this._tone(t + 0.7, { type: 'sawtooth', f: mtof(root + iv), dur: 1.0, peak: 0.075, attack: 0.02, hold: 0.15, filter: 2400, filter2: 900, q: 1.4 });
      }
      this._kick(t + 0.7, 1.0); this._kick(t + 0.95, 0.7);
      this._noise(t + 0.62, { type: 'highpass', f: 2000, f2: 9000, dur: 0.5, peak: 0.05, attack: 0.06 });
    }, true);
    S('lap.complete', 'race', 0.85, 'Lap complete', function (t) {
      [79, 83, 86].forEach((m, i) => this._tone(t + i * 0.075, {
        type: 'triangle', f: mtof(m), dur: 0.4, peak: 0.14, attack: 0.004, filter: 6000,
      }));
      this._noise(t + 0.05, { type: 'highpass', f: 5000, f2: 11000, dur: 0.4, peak: 0.032, attack: 0.03 });
    }, true);
    S('lap.final', 'race', 1.40, 'Final lap warning', function (t) {
      for (let i = 0; i < 3; i++) {
        this._tone(t + i * 0.22, { type: 'square', f: mtof(81), dur: 0.13, peak: 0.11, attack: 0.004, filter: 2600, q: 2.2 });
        this._tone(t + i * 0.22 + 0.11, { type: 'square', f: mtof(86), dur: 0.13, peak: 0.11, attack: 0.004, filter: 3000, q: 2.2 });
      }
      this._tone(t, { type: 'sawtooth', f: mtof(38), dur: 0.9, peak: 0.10, attack: 0.02, filter: 400, filter2: 1400, q: 3 });
      this._noise(t + 0.66, { type: 'bandpass', f: 900, f2: 4200, q: 1.6, dur: 0.45, peak: 0.06, attack: 0.1 });
    }, true);
    S('lap.best', 'race', 0.80, 'Personal best lap', function (t) {
      [88, 92, 95].forEach((m, i) => this._blip(t + i * 0.055, m, { peak: 0.11, dur: 0.35, type: 'sine' }));
      this._noise(t + 0.02, { type: 'highpass', f: 7000, f2: 13000, dur: 0.35, peak: 0.028, attack: 0.04 });
    });
    S('position.up', 'race', 0.45, 'Position gained', function (t) {
      [72, 76, 79, 84].forEach((m, i) => this._blip(t + i * 0.05, m, { peak: 0.12, dur: 0.14, type: 'triangle' }));
    });
    S('position.down', 'race', 0.45, 'Position lost', function (t) {
      [77, 73, 68].forEach((m, i) => this._blip(t + i * 0.06, m, { peak: 0.11, dur: 0.16, type: 'triangle', filter: 2200 }));
    });
    S('results.sting', 'race', 2.60, 'Results / podium sting', function (t) {
      const root = 57;                                    // A
      const chords = [[0, 4, 7, 11], [2, 5, 9, 12], [-3, 4, 7, 12], [0, 7, 12, 16]];
      chords.forEach((ch, i) => {
        const tt = t + i * 0.45;
        for (const iv of ch) {
          this._tone(tt, { type: 'triangle', f: mtof(root + 12 + iv), dur: 0.55, peak: 0.062, attack: 0.012, hold: 0.06, filter: 3200 });
          this._tone(tt, { type: 'sawtooth', f: mtof(root + iv), dur: 0.5, peak: 0.03, attack: 0.02, filter: 1200, q: 1.2 });
        }
        this._kick(tt, 0.8);
        if (i % 2 === 1) this._snare(tt, 0.7);
      });
      this._noise(t + 1.6, { type: 'highpass', f: 3000, f2: 12000, dur: 0.8, peak: 0.045, attack: 0.15 });
      [84, 88, 91, 96].forEach((m, i) => this._blip(t + 1.75 + i * 0.07, m, { peak: 0.08, dur: 0.5, type: 'sine' }));
    }, true);

    // ---- tokens ------------------------------------------------------------
    // Rising with combo through a pentatonic ladder so a run is musical.
    S('token.pickup', 'race', 0.40, 'Token pickup (combo)', function (t, o = {}) {
      const ladder = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const combo = clamp(Math.floor(o.combo ?? this._combo ?? 0), 0, 40);
      const base = 74 + ladder[Math.min(combo, ladder.length - 1)] + 12 * Math.floor(combo / ladder.length);
      const arp = [0, 4, 7];
      arp.forEach((iv, i) => {
        this._tone(t + i * 0.035, {
          type: 'triangle', f: mtof(Math.min(base + iv, 116)), dur: 0.22, peak: 0.13 - i * 0.02,
          attack: 0.002, filter: 8000,
        });
        this._tone(t + i * 0.035, {
          type: 'sine', f: mtof(Math.min(base + iv + 12, 124)), dur: 0.16, peak: 0.045, attack: 0.002,
        });
      });
      this._noise(t, { type: 'highpass', f: 7000, dur: 0.03, peak: 0.025, attack: 0.001 });
    });

    // ---- drift / boost -----------------------------------------------------
    S('drift.start', 'drive', 0.30, 'Drift start', function (t) {
      this._noise(t, { type: 'bandpass', f: 2600, f2: 900, q: 2.2, dur: 0.24, peak: 0.30, attack: 0.006 });
      this._noise(t, { type: 'lowpass', f: 700, dur: 0.14, peak: 0.16, attack: 0.002 });
      this._tone(t, { type: 'triangle', f: 520, f2: 260, glide: 0.14, dur: 0.16, peak: 0.14, attack: 0.003, filter: 2200 });
    });
    // Audition of the REAL persistent scrape voice, so what you hear here is
    // exactly what the game plays (rather than a look-alike one-shot).
    S('drift.sustain', 'drive', 1.90, 'Drift sustain (charge sweep)', function (t) {
      const D = this.drift;
      D.start(t);
      D.setAt(t, 0.0, 0.05);
      D.setAt(t + 0.35, 0.35, 0.2);
      D.setAt(t + 0.85, 0.72, 0.2);
      D.setAt(t + 1.30, 1.0, 0.15);
      D.stop(t + 1.65, 0.18);
      this._reserve(t, 1.9);
    });
    S('drift.tier', 'drive', 0.30, 'Drift charge tier up', function (t, o = {}) {
      const tier = clamp(Math.round(o.tier ?? 1), 1, 3);
      this._tone(t, { type: 'triangle', f: mtof(70 + tier * 5), dur: 0.13, peak: 0.09 + 0.02 * tier, attack: 0.002, filter: 6000 });
      this._tone(t, { type: 'sine', f: mtof(82 + tier * 5), dur: 0.09, peak: 0.045, attack: 0.002 });
      this._noise(t, { type: 'highpass', f: 6500, dur: 0.03, peak: 0.03, attack: 0.001 });
    });
    S('boost.release', 'drive', 1.00, 'Mini-boost release', function (t) {
      // whoosh: noise sweeping up then falling away
      this._noise(t, { type: 'bandpass', f: 500, f2: 5200, q: 1.1, dur: 0.30, peak: 0.20, attack: 0.05 });
      this._noise(t + 0.28, { type: 'lowpass', f: 4200, f2: 500, dur: 0.42, peak: 0.11, attack: 0.02 });
      // pitched pop
      this._tone(t + 0.02, { type: 'square', f: 220, f2: 900, glide: 0.10, dur: 0.16, peak: 0.15, attack: 0.003, filter: 2600, q: 2.5 });
      this._tone(t + 0.02, { type: 'sine', f: 110, f2: 440, glide: 0.10, dur: 0.28, peak: 0.20, attack: 0.004 });
      // the "thrust" tail
      this._tone(t + 0.10, { type: 'sawtooth', f: 330, f2: 240, glide: 0.5, dur: 0.5, peak: 0.075, attack: 0.03, filter: 3200, filter2: 700, q: 3 });
    });

    // ---- collisions --------------------------------------------------------
    S('collide.wall', 'impact', 0.60, 'Wall impact', function (t, o = {}) {
      const v = clamp(o.speed ?? 0.7, 0.15, 1);
      this._tone(t, { type: 'sine', f: 120 * (0.8 + v * 0.5), f2: 46, glide: 0.12, dur: 0.32, peak: 0.34 * v, attack: 0.002 });
      this._noise(t, { type: 'lowpass', f: 2400 * v, f2: 400, q: 1.2, dur: 0.22, peak: 0.20 * v, attack: 0.001 });
      this._noise(t + 0.01, { type: 'bandpass', f: 3200, q: 2.6, dur: 0.10, peak: 0.09 * v, attack: 0.001 });
    });
    S('collide.kart', 'impact', 0.50, 'Kart-on-kart bump', function (t, o = {}) {
      const v = clamp(o.speed ?? 0.6, 0.15, 1);
      this._tone(t, { type: 'sine', f: 190, f2: 90, glide: 0.09, dur: 0.20, peak: 0.42 * v, attack: 0.002 });
      // rubbery boing: fast downward triangle with resonance
      this._tone(t + 0.01, { type: 'triangle', f: 640, f2: 210, glide: 0.16, dur: 0.26, peak: 0.20 * v, attack: 0.003, filter: 1800, q: 5 });
      this._noise(t, { type: 'bandpass', f: 1500, q: 1.4, dur: 0.07, peak: 0.15 * v, attack: 0.001 });
    });
    S('collide.scrape', 'impact', 0.70, 'Wall scrape', function (t, o = {}) {
      const v = clamp(o.speed ?? 0.6, 0.2, 1);
      // grinding body — a resonant mid band is what reads as "metal on concrete"
      this._noise(t, { type: 'bandpass', f: 1150, f2: 1950, q: 7, dur: 0.42, peak: 0.58 * v, attack: 0.02, hold: 0.14 });
      this._noise(t, { type: 'bandpass', f: 430, f2: 620, q: 5, dur: 0.40, peak: 0.38 * v, attack: 0.02, hold: 0.10 });
      this._noise(t + 0.05, { type: 'highpass', f: 4200, dur: 0.35, peak: 0.10 * v, attack: 0.05 });
      // sparks: a couple of bright transients riding on top
      this._noise(t + 0.09, { type: 'bandpass', f: 6400, q: 4, dur: 0.05, peak: 0.06 * v, attack: 0.001 });
      this._noise(t + 0.21, { type: 'bandpass', f: 5200, q: 4, dur: 0.05, peak: 0.05 * v, attack: 0.001 });
      this._tone(t, { type: 'sawtooth', f: 148, dur: 0.38, peak: 0.19 * v, attack: 0.015, filter: 800, q: 4 });
    });

    // ---- surfaces ----------------------------------------------------------
    S('surface.grass', 'drive', 1.00, 'Off-track: grass', function (t) {
      this._noise(t, { type: 'lowpass', f: 320, q: 1.4, dur: 0.7, peak: 0.22, attack: 0.05, hold: 0.15 });
      this._noise(t + 0.02, { type: 'bandpass', f: 1400, q: 0.8, dur: 0.55, peak: 0.07, attack: 0.06 });
      this._tone(t, { type: 'sine', f: 62, dur: 0.5, peak: 0.12, attack: 0.05 });
    });
    S('surface.sand', 'drive', 1.00, 'Off-track: sand', function (t) {
      this._noise(t, { type: 'bandpass', f: 950, q: 0.7, dur: 0.75, peak: 0.21, attack: 0.06, hold: 0.15 });
      this._noise(t, { type: 'lowpass', f: 220, dur: 0.6, peak: 0.20, attack: 0.05 });
      this._noise(t + 0.1, { type: 'highpass', f: 5200, dur: 0.5, peak: 0.06, attack: 0.1 });
    });

    // ---- garage ------------------------------------------------------------
    S('garage.build', 'garage', 2.20, 'Part build sequence', function (t) {
      // servo whirs
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.42;
        this._tone(tt, {
          type: 'sawtooth', f: 180 + i * 60, f2: 380 + i * 90, glide: 0.24, dur: 0.26,
          peak: 0.075, attack: 0.02, filter: 1400, filter2: 2600, q: 4,
        });
        this._noise(tt + 0.02, { type: 'bandpass', f: 2400, q: 2, dur: 0.2, peak: 0.035, attack: 0.02 });
        this._click(tt + 0.30, 0.9);
      }
      // ratchet
      for (let i = 0; i < 6; i++) this._click(t + 1.26 + i * 0.052, 0.55 + i * 0.05);
      // final clank
      this._tone(t + 1.62, { type: 'square', f: 300, f2: 190, glide: 0.1, dur: 0.35, peak: 0.13, attack: 0.002, filter: 2600, q: 3 });
      this._tone(t + 1.62, { type: 'sine', f: 110, f2: 70, glide: 0.1, dur: 0.30, peak: 0.20, attack: 0.002 });
      this._noise(t + 1.62, { type: 'bandpass', f: 4200, q: 2.4, dur: 0.16, peak: 0.08, attack: 0.001 });
    });
    // tier: 0 bad, 1 ok, 2 good, 3 great
    S('garage.reveal', 'garage', 2.30, 'Part reveal (tier 0-3)', function (t, o = {}) {
      const tier = clamp(Math.round(o.tier ?? 3), 0, 3);
      if (tier === 0) {
        // sad clunk + a deflating minor second
        this._tone(t, { type: 'sine', f: 150, f2: 62, glide: 0.16, dur: 0.4, peak: 0.28, attack: 0.003 });
        this._noise(t, { type: 'lowpass', f: 1200, f2: 300, dur: 0.25, peak: 0.11, attack: 0.002 });
        this._tone(t + 0.22, { type: 'triangle', f: mtof(63), dur: 0.45, peak: 0.10, attack: 0.01, filter: 1600 });
        this._tone(t + 0.34, { type: 'triangle', f: mtof(62), dur: 0.6, peak: 0.10, attack: 0.01, filter: 1300 });
        this._tone(t + 0.34, { type: 'sawtooth', f: mtof(38), dur: 0.7, peak: 0.05, attack: 0.05, filter: 600, q: 2 });
        return;
      }
      const root = 60;
      const CH = { 1: [0, 5, 7], 2: [0, 4, 7, 12], 3: [0, 4, 7, 11, 14, 19] }[tier];
      const peak = [0, 0.075, 0.085, 0.09][tier];
      CH.forEach((iv, i) => {
        this._tone(t + i * 0.035, {
          type: 'triangle', f: mtof(root + iv), dur: 0.9, peak, attack: 0.01, hold: 0.1, filter: 4200,
        });
        if (tier >= 2) this._tone(t + i * 0.035, { type: 'sawtooth', f: mtof(root + iv - 12), dur: 0.7, peak: peak * 0.4, attack: 0.03, filter: 1400, q: 1.4 });
      });
      if (tier === 3) {
        [84, 88, 91, 96, 100].forEach((m, i) => this._blip(t + 0.35 + i * 0.06, m, { peak: 0.085, dur: 0.6, type: 'sine' }));
        this._noise(t + 0.3, { type: 'highpass', f: 4000, f2: 13000, dur: 0.9, peak: 0.04, attack: 0.2 });
        this._kick(t, 0.9);
      }
      if (tier === 2) this._noise(t + 0.15, { type: 'highpass', f: 4000, f2: 9000, dur: 0.5, peak: 0.03, attack: 0.1 });
    });

    // ---- quiz stingers (Wave 2) --------------------------------------------
    // A wrong answer carries NO penalty in this game, so `quiz.wrong` must not
    // scold. It is consonant, soft-attacked and *shorter* than the correct
    // sting; the only thing the ear should read is "that one lit up, this one
    // didn't". No buzzer, no minor second, no downward octave drop.
    S('quiz.correct', 'quiz', 1.10, 'Quiz: correct', function (t) {
      const root = 72;                                   // C5, bright and childlike
      [0, 4, 7, 12].forEach((iv, i) => {
        this._tone(t + i * 0.055, {
          type: 'triangle', f: mtof(root + iv), dur: 0.5, peak: 0.13 - i * 0.012,
          attack: 0.003, filter: 7000,
        });
        this._tone(t + i * 0.055, { type: 'sine', f: mtof(root + iv + 12), dur: 0.3, peak: 0.05, attack: 0.003 });
      });
      this._tone(t + 0.24, { type: 'sine', f: mtof(root + 19), dur: 0.75, peak: 0.09, attack: 0.006, hold: 0.05 });
      this._noise(t + 0.06, { type: 'highpass', f: 6000, f2: 13000, dur: 0.45, peak: 0.03, attack: 0.05 });
      this._hand(t, true, 0.45);                         // one light hand-drum tap
    });
    S('quiz.wrong', 'quiz', 0.85, 'Quiz: not that one', function (t) {
      // A gentle major-2nd fall onto a warm perfect 4th — the shape of "hmm,
      // have another look", not the shape of a mistake.
      this._tone(t, { type: 'triangle', f: mtof(69), dur: 0.34, peak: 0.10, attack: 0.02, filter: 2400 });
      this._tone(t + 0.16, { type: 'triangle', f: mtof(65), dur: 0.5, peak: 0.095, attack: 0.025, filter: 2000 });
      this._tone(t + 0.16, { type: 'sine', f: mtof(53), dur: 0.55, peak: 0.055, attack: 0.03 });
      this._noise(t, { type: 'lowpass', f: 900, dur: 0.18, peak: 0.025, attack: 0.03 });
    });
    S('quiz.timeout', 'quiz', 0.95, 'Quiz: time up', function (t) {
      // A soft three-note wind-down. Still no alarm: running out of time is
      // information, not a punishment.
      [76, 72, 69].forEach((m, i) => this._tone(t + i * 0.15, {
        type: 'sine', f: mtof(m), dur: 0.28 + i * 0.13, peak: 0.085 - i * 0.005, attack: 0.012,
      }));
      this._noise(t + 0.3, { type: 'lowpass', f: 1200, f2: 400, dur: 0.4, peak: 0.02, attack: 0.06 });
    });

    // ---- engine demo (offline-renderable automation sweep) -----------------
    S('engine.sweep', 'engine', 4.60, 'Engine: idle → rev → boost', function (t) {
      const E = this.engine;
      E.enable(t, 0.12);
      E.setAt(t, { rpm01: 0.06, load: 0.15, surface: 'road' }, 0.05);
      E.setAt(t + 0.7, { rpm01: 0.10, load: 0.2, surface: 'road' }, 0.2);
      E.setAt(t + 1.2, { rpm01: 0.45, load: 0.8, surface: 'road' }, 0.25);
      E.setAt(t + 2.0, { rpm01: 0.85, load: 0.95, surface: 'road' }, 0.3);
      E.setAt(t + 2.7, { rpm01: 0.98, load: 1.0, boosting: true, surface: 'road' }, 0.12);
      E.setAt(t + 3.5, { rpm01: 0.6, load: 0.5, surface: 'grass' }, 0.25);
      E.disable(t + 4.2, 0.3);
      this._reserve(t, 4.6);
    });
    S('engine.idle', 'engine', 2.20, 'Engine: idle burble', function (t) {
      const E = this.engine;
      E.enable(t, 0.1);
      E.setAt(t, { rpm01: 0.05, load: 0.12, surface: 'road' }, 0.05);
      E.setAt(t + 0.9, { rpm01: 0.12, load: 0.25 }, 0.25);
      E.setAt(t + 1.4, { rpm01: 0.05, load: 0.12 }, 0.25);
      E.disable(t + 1.9, 0.25);
    });
    S('engine.ai', 'engine', 2.60, 'Engine: 3 AI karts nearby', function (t) {
      while (this._ai.length < 3) {
        const i = this._ai.length;
        this._ai.push(new EngineVoice(this, { level: AI_ENGINE_LEVEL, detune: [-72, 58, 121][i], player: false }));
      }
      this._ai.forEach((v, i) => {
        v.level = AI_ENGINE_LEVEL - i * 0.012;
        v.enable(t + i * 0.1, 0.15);
        v.setAt(t + i * 0.1, { rpm01: 0.35 + i * 0.12, load: 0.7 }, 0.1);
        v.setAt(t + 1.0, { rpm01: 0.8 - i * 0.1, load: 0.9 }, 0.35);
        v.disable(t + 2.2, 0.3);
      });
    });

    // ---- music (offline-renderable) ----------------------------------------
    for (const [id, label] of [['menu', 'Music: menu'], ['race', 'Music: race'], ['garage', 'Music: garage']]) {
      S(`music.${id}`, 'music', 6.0, label, function (t, o = {}) {
        this.music.start(id, { theme: o.theme, at: t, offline: o.offline ?? 6.0, intensity: o.intensity ?? 0 });
      });
    }
    for (const th of ['oasis', 'circuit', 'cloud']) {
      S(`music.race.${th}`, 'music', 6.0, `Music: race — ${th}`, function (t, o = {}) {
        this.music.start('race', { theme: th, at: t, offline: o.offline ?? 6.0, intensity: o.intensity ?? 0 });
      });
    }
  }

  // ── bus wiring ─────────────────────────────────────────────────────────────
  // Subsystems emit; nobody imports this module. Aliases are generous on purpose
  // so parallel agents naming events slightly differently still get sound.
  _wireBus() {
    const on = (evt, fn) => this._offs.push(bus.on(evt, fn));
    const simple = (evts, name, map) => {
      for (const e of [].concat(evts)) on(e, p => this.play(name, map ? map(p || {}) : (p || {})));
    };

    on('audio:play', p => { if (p && p.name) this.play(p.name, p); });
    on('audio:unlock', () => this.unlock());
    on('audio:mute', m => this.setMuted(typeof m === 'boolean' ? m : (m && m.muted)));
    on('audio:toggleMute', () => this.toggleMute());
    on('audio:volume', p => this.setVolume(p || {}));
    // Master volume, for the settings screen. Accepts a bare number or {volume}.
    on('audio:masterVolume:set', p => this.setMasterVolume(typeof p === 'number' ? p : (p && (p.volume ?? p.value))));
    on('audio:music', p => { if (!p || p.stop) this.stopMusic(); else this.playMusic(p.track || p.id || 'menu', p); });
    on('audio:stopMusic', () => this.stopMusic());

    // engine
    for (const e of ['kart:engine', 'engine:state', 'audio:engine']) on(e, p => this.setEngineState(p || {}));
    for (const e of ['kart:ai:engines', 'ai:engines']) on(e, p => this.setAiEngines(p || []));
    for (const e of ['kart:engine:stop', 'race:ended']) on(e, () => this.stopEngine());

    // drift. NOTE: race.js emits `drift:end` with {tier} and announces the actual
    // mini-boost separately as `drift:boost`, so drift:end must NOT try to infer
    // "released" from its payload or the boost would either double or vanish.
    for (const e of ['drift:start', 'kart:drift:start']) on(e, () => this.driftStart());
    for (const e of ['drift:charge', 'kart:drift:charge']) on(e, p => this.setDrift(typeof p === 'number' ? p : (p && p.charge) || 0));
    for (const e of ['drift:end', 'kart:drift:end']) on(e, () => this.driftEnd(false));
    for (const e of ['drift:tier', 'kart:drift:tier']) {
      on(e, p => this.play('drift.tier', { tier: (typeof p === 'number' ? p : (p && p.tier)) || 1 }));
    }
    simple(['drift:boost', 'drift:release', 'boost:mini', 'kart:boost'], 'boost.release');

    // tokens with a combo counter
    for (const e of ['token:pickup', 'pickup:token', 'token:collect']) {
      on(e, p => {
        const now = this.now;
        if (now - (this._comboAt || -9) > 2.2) this._combo = 0; else this._combo++;
        this._comboAt = now;
        const combo = (p && p.combo != null) ? p.combo : this._combo;
        this.play('token.pickup', { combo });
      });
    }
    on('token:comboReset', () => { this._combo = 0; });

    // collisions
    on('kart:collide', p => {
      const k = (p && p.kind) || 'wall';
      this.play(k === 'kart' ? 'collide.kart' : k === 'scrape' ? 'collide.scrape' : 'collide.wall', p || {});
    });
    simple(['collide:wall', 'kart:hitWall'], 'collide.wall');
    simple(['collide:kart', 'kart:hitKart'], 'collide.kart');
    simple(['collide:scrape', 'kart:scrape'], 'collide.scrape');

    // surface. race.js emits `surface:change` (singular, no 'd') with
    // {surface:'asphalt'|'sand'|'grass'|'cloud'} — 'asphalt' means back on track
    // and is deliberately silent.
    for (const e of ['surface:change', 'kart:surface', 'surface:changed']) {
      on(e, p => {
        const s = typeof p === 'string' ? p : (p && p.surface);
        if (s === 'grass') this.play('surface.grass');
        else if (s === 'sand' || s === 'dirt' || s === 'cloud') this.play('surface.sand');
      });
    }

    // race flow.
    // The track id arrives on `race:begin`, BEFORE engine.js emits scene:entered
    // for the race — remember it so the race music starts in that track's mood
    // (oasis / circuit / cloud) instead of always defaulting to oasis.
    on('race:begin', p => {
      const id = typeof p === 'string' ? p : (p && (p.track || p.trackId));
      this._raceTheme = THEMES[id] ? id : null;
      if (this.ready && this.music && this.music.track === 'race') this.playMusic('race', { theme: this._raceTheme || undefined });
    });
    on('race:countdown', p => {
      const n = typeof p === 'number' ? p : (p && p.n);
      // GO gets its own note; the fanfare belongs to `race:start`, a beat later.
      // Playing both here made the start double-fire once race:start was wired.
      if (n === 0 || n === 'go') this.play('countdown.go');
      else this.play('countdown.beep');
    });
    simple(['race:go', 'race:start'], 'race.fanfare');
    simple(['race:lap', 'lap:complete'], 'lap.complete');
    simple(['race:bestlap', 'race:bestLap'], 'lap.best');
    // race.js emits `race:finallap` (all lower case).
    for (const e of ['race:finallap', 'race:finalLap', 'race:lastLap']) {
      on(e, () => { this.play('lap.final'); this.setMusicIntensity(1); });
    }
    on('race:wrongway', p => { if (p && p.on) this.play('ui.error'); });
    on('race:position', p => {
      const d = typeof p === 'number' ? p : (p && (p.delta ?? (p.from - p.to)));
      if (d > 0) this.play('position.up'); else if (d < 0) this.play('position.down');
    });
    simple(['race:finish', 'race:results'], 'results.sting');
    simple('podium:show', 'results.sting');

    // UI — includes the names menus.js actually emits (menu:racer / menu:start /
    // menu:goto) and the pause-menu round trip.
    simple(['ui:hover', 'menu:hover'], 'ui.hover');
    simple(['ui:select', 'menu:select', 'menu:racer', 'menu:goto'], 'ui.select');
    simple(['ui:confirm', 'menu:confirm', 'menu:start'], 'ui.confirm');
    simple(['ui:back', 'menu:back', 'race:quit'], 'ui.back');
    // pause.js emits race:pause / race:resume and expects the mix to duck.
    on('race:pause', () => { this.play('ui.back'); this.duck(true); });
    on('input:pause', () => this.duck(true));
    on('race:resume', () => { this.play('ui.select'); this.duck(false); });
    simple(['ui:error', 'menu:error'], 'ui.error');

    // quiz (Wave 2) — quiz.js emits these exact names; also reachable as
    // audio.play('quiz.correct' | 'quiz.wrong' | 'quiz.timeout').
    simple('quiz:open', 'ui.select');
    simple(['quiz:correct', 'quiz:right'], 'quiz.correct');
    simple(['quiz:wrong', 'quiz:incorrect'], 'quiz.wrong');
    simple(['quiz:timeout', 'quiz:timeUp'], 'quiz.timeout');
    on('quiz:answer', p => this.play(p && (p.correct === true || p.ok === true) ? 'quiz.correct' : 'quiz.wrong'));

    // garage
    simple(['garage:build', 'garage:assemble'], 'garage.build');
    on('garage:reveal', p => this.play('garage.reveal', { tier: tierOf(p) }));
    on('garage:part', p => this.play('garage.reveal', { tier: tierOf(p) }));

    // music follows scenes unless a scene asks for something specific
    on('scene:entered', name => {
      if (!this.ready) return;
      if (name === 'menu' || name === 'title' || name === 'select') this.playMusic('menu');
      else if (name === 'garage') this.playMusic('garage');
      else if (name === 'race') this.playMusic('race', { theme: this._raceTheme || undefined });
      else if (name === 'results' || name === 'podium') this.stopMusic(0.8);
    });
    // Leaving a scene must silence the persistent voices, or the engine keeps
    // idling under the results screen for as long as the tab lives.
    on('scene:leaving', () => {
      this._combo = 0;
      this.duck(false);
      this.stopEngine();
      if (this.ok) { this.drift.stop(this.now, 0.1); this.setAiEngines([]); }
      this.setMusicIntensity(0);
    });
  }
}

function tierOf(p) {
  if (p == null) return 3;
  if (typeof p === 'number') return p <= 3 ? p : p >= 85 ? 3 : p >= 60 ? 2 : p >= 35 ? 1 : 0;
  if (p.tier != null) return p.tier;
  if (p.score != null) return p.score >= 85 ? 3 : p.score >= 60 ? 2 : p.score >= 35 ? 1 : 0;
  const q = { great: 3, good: 2, ok: 1, bad: 0 }[p.quality];
  return q == null ? 3 : q;
}

// ─────────────────────────────────────────────────────────────────────────────
// Music engine — a 16th-note step scheduler with lookahead. In realtime a timer
// pumps it; for offline rendering `offline:<seconds>` schedules the whole span
// up front, which is what makes the loops measurable in an OfflineAudioContext.
// ─────────────────────────────────────────────────────────────────────────────
class MusicEngine {
  constructor(A) {
    this.A = A;
    this.playing = false;
    this.track = null;
    this.themeId = null;
    this.intensity = 0;
    this._timer = 0;
    this._step = 0;
    this._t0 = 0;
    this._gain = null;
    this.plans = new Map();
  }

  _plan(themeId, role) {
    const key = themeId + '/' + role;
    if (!this.plans.has(key)) {
      const theme = THEMES[themeId] || THEMES.oasis;
      this.plans.set(key, { theme, role: ROLES[role] || ROLES.race, melody: buildMelody(theme, role) });
    }
    return this.plans.get(key);
  }

  start(track, opts = {}) {
    const A = this.A;
    if (!A.ready) return;
    const role = ROLES[track] ? track : 'race';
    const themeId = THEMES[opts.theme] ? opts.theme : ROLES[role].theme;
    const at = opts.at ?? A.now;
    if (this.playing && this.track === track && this.themeId === themeId && opts.offline == null) return;
    this.stop(0.35, at);

    this.track = track; this.themeId = themeId;
    this.plan = this._plan(themeId, role);
    this.intensity = opts.intensity ?? 0;
    this.bpm = this.plan.theme.bpm * this.plan.role.tempo;
    this.spb = 60 / this.bpm / 4;            // seconds per 16th step
    this._step = 0;
    this._t0 = at + 0.06;
    this.playing = true;

    const g = A.ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, this._t0);
    g.gain.linearRampToValueAtTime(this.plan.role.gain, this._t0 + 0.5);
    g.connect(A.musicBus);
    this._gain = g;

    if (opts.offline != null) {
      this._pump(at + opts.offline);         // render-ahead: no timers involved
    } else {
      this._pump(A.now + 0.4);
      this._timer = setInterval(() => {
        if (!this.playing || !A.ready) return;
        try { this._pump(A.now + 0.4); } catch (e) { console.warn('music', e && e.message); }
      }, 90);
    }
  }

  stop(fade = 0.6, at) {
    const A = this.A;
    if (this._timer) { clearInterval(this._timer); this._timer = 0; }
    this.playing = false;
    if (this._gain && A.ready) {
      const g = this._gain, tN = at ?? A.now;
      try {
        g.gain.cancelScheduledValues(tN);
        g.gain.setValueAtTime(Math.max(g.gain.value, EPS), tN);
        g.gain.linearRampToValueAtTime(0, tN + Math.max(0.01, fade));
      } catch { /* */ }
      const dead = g;
      setTimeout(() => { try { dead.disconnect(); } catch { /* */ } }, (fade + 0.3) * 1000);
    }
    this._gain = null;
    this.track = null;
  }

  setIntensity(x) { this.intensity = clamp(x, 0, 1); }

  _pump(until) {
    let guard = 0;
    while (this.playing && this._t0 + this._step * this.spb < until && guard++ < 512) {
      this._schedule(this._step, this._t0 + this._step * this.spb);
      this._step++;
    }
  }

  _schedule(step, t) {
    const A = this.A;
    if (!A.ready || !this._gain) return;
    const { theme, role, melody } = this.plan;
    const dest = this._gain;
    const S = step % 128;                    // 8 bars
    const bar = Math.floor(S / 16), s = S % 16;
    const ch = theme.prog[bar % theme.prog.length];
    const chRoot = theme.root + ch.r;
    const I = this.intensity;
    const cap = () => A._reserve(t, 0.8, MUSIC_HEADROOM);

    // ---- pad: one voicing per bar --------------------------------------
    if (s === 0 && role.pad > 0.01) {
      for (const iv of ch.c) {
        if (!cap()) break;
        A._tone(t, {
          type: theme.padWave, f: mtof(chRoot + 12 + iv), dur: this.spb * 15,
          peak: 0.030 * role.pad, attack: 0.12, filter: theme.padCut, q: 0.9, dest,
        });
      }
      if (cap()) A._tone(t, { type: theme.padWave, f: mtof(chRoot), dur: this.spb * 15, peak: 0.022 * role.pad, attack: 0.1, filter: 700, dest });
    }

    // ---- bass ----------------------------------------------------------
    const bs = BASS_STEPS[this.track] || BASS_STEPS.race;
    if (bs.includes(s) || (I > 0.5 && this.track === 'race' && s % 2 === 0 && s % 4 !== 0)) {
      if (cap()) {
        const octave = (s === 0 || s === 8) ? 0 : (s % 3 === 0 ? 7 : 0);
        A._tone(t, {
          type: theme.bassWave, f: mtof(chRoot - 12 + octave), dur: this.spb * 1.6,
          peak: 0.085 + 0.02 * I, attack: 0.006, filter: 380 + 260 * I, filter2: 180, q: 3.5, dest,
        });
        A._tone(t, { type: 'sine', f: mtof(chRoot - 24 + octave), dur: this.spb * 1.4, peak: 0.055, attack: 0.008, dest });
      }
    }

    // ---- arp -----------------------------------------------------------
    if (role.arp > 0.2 && s % 2 === 0) {
      const idx = (step >> 1) % ch.c.length;
      if (cap()) {
        A._tone(t, {
          type: theme.lead === 'bell' ? 'sine' : 'triangle',
          f: mtof(chRoot + 24 + ch.c[idx]), dur: this.spb * 1.4,
          peak: 0.022 * role.arp * (1 + 0.4 * I), attack: 0.004, filter: 6000, dest,
        });
      }
    }

    // ---- lead melody ---------------------------------------------------
    for (const n of melody) {
      if (n.step !== S) continue;
      if (!cap()) break;
      const f = mtof(n.midi);
      const v = n.vel * role.lead;
      if (theme.lead === 'bell') {
        A._tone(t, { type: 'sine', f, dur: n.dur * 2.4, peak: 0.10 * v, attack: 0.004, dest });
        A._tone(t, { type: 'sine', f: f * 2.01, dur: n.dur * 1.4, peak: 0.035 * v, attack: 0.004, dest });
        A._tone(t, { type: 'sine', f: f * 3.02, dur: n.dur * 0.7, peak: 0.014 * v, attack: 0.003, dest });
      } else if (theme.lead === 'saw') {
        A._tone(t, { type: 'sawtooth', f, dur: n.dur * 1.6, peak: 0.070 * v, attack: 0.008, filter: 1600 + 2600 * I, filter2: 900, q: 5, dest });
        A._tone(t, { type: 'sawtooth', f: f * 1.004, dur: n.dur * 1.5, peak: 0.040 * v, attack: 0.01, filter: 2400, q: 2, dest });
      } else {
        A._tone(t, { type: 'triangle', f, dur: n.dur * 1.8, peak: 0.095 * v, attack: 0.004, filter: 4200, q: 1.2, dest });
        A._tone(t, { type: 'sine', f: f * 2, dur: n.dur * 0.8, peak: 0.026 * v, attack: 0.004, dest });
      }
      if (I > 0.6 && theme.lead !== 'bell' && cap()) {
        A._tone(t, { type: 'sawtooth', f: f * 2, dur: n.dur * 1.2, peak: 0.022 * v, attack: 0.01, filter: 5000, dest });
      }
    }

    // ---- drums ---------------------------------------------------------
    const dv = role.drums;
    if (dv > 0.05) {
      const K = theme.perc;
      if (K === 'kit') {
        if (s % 4 === 0) { if (cap()) A._kick(t, 0.95 * dv, dest); }
        if (s === 4 || s === 12) { if (cap()) A._snare(t, 0.8 * dv, dest); }
        if (s % 2 === 0 || I > 0.45) { if (cap()) A._hat(t, (s % 4 === 2 ? 0.85 : 0.55) * dv, s === 14, dest); }
      } else if (K === 'hand') {
        if (s === 0 || s === 6 || s === 8) { if (cap()) A._hand(t, false, 0.9 * dv, dest); }
        if (s === 3 || s === 4 || s === 11 || s === 14 || (I > 0.5 && s === 7)) { if (cap()) A._hand(t, true, 0.75 * dv, dest); }
        if (s % 2 === 1) { if (cap()) A._shaker(t, 0.5 * dv * (1 + 0.4 * I), dest); }
        if (s === 12 && bar % 2 === 1) { if (cap()) A._snare(t, 0.45 * dv, dest); }
      } else { // 'air'
        if (s === 0 || s === 8 || (I > 0.5 && s === 11)) { if (cap()) A._kick(t, 0.75 * dv, dest); }
        if (s === 4 || s === 12) { if (cap()) A._snare(t, 0.5 * dv, dest); }
        if (s % 2 === 0) { if (cap()) A._shaker(t, 0.6 * dv, dest); }
      }
      if (role.mech && (s === 2 || s === 10)) { if (cap()) A._click(t, 0.5 * dv, dest); }
      // final-lap lift: an extra ride/percussion layer
      if (I > 0.55 && s % 4 === 2 && cap()) A._hat(t, 0.5 * I, false, dest);
      // bar-end fill on the last bar of the loop
      if (bar === 7 && s >= 12 && cap()) A._snare(t, (0.3 + (s - 12) * 0.15) * dv, dest);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export const audio = new AudioSystem();

// Automation seam ONLY (same idea as window.__DEBUG in core/harness.js): no game
// code reads this, but it is what lets tests/audio.test.mjs measure the REAL
// graph inside the REAL built game rather than a look-alike offline rig.
try {
  if (typeof window !== 'undefined') {
    audio.bus = bus;
    // The REAL modal registry from ui/style.js — the same Set quiz.js and
    // pause.js push into, not a stand-in. tests/audio.test.mjs uses it to prove
    // the duck is driven by the registry (including ids invented at test time)
    // rather than by a hardcoded list here.
    audio.modal = { push: pushModal, pop: popModal };
    window.__AUDIO = audio;
  }
} catch { /* */ }

// ─────────────────────────────────────────────────────────────────────────────
// preview(engine) — a hand-audition rig. Every registered sound gets a button;
// an AnalyserNode drives a live oscilloscope + spectrum so you can *see* the
// sound as well as hear it. This is what tools/preview.mjs screenshots.
// ─────────────────────────────────────────────────────────────────────────────
registerStrings({
  he: {
    'audio.title': 'מערכת שמע פרוצדורלית',
    'audio.sub': 'כל צליל מסונתז בקוד — אין קבצי אודיו',
    'audio.mute': 'השתקה',
    'audio.unmute': 'ביטול השתקה',
    'audio.stopAll': 'עצור מוזיקה',
    'audio.rpm': 'סיבובי מנוע',
    'audio.boost': 'בוסט',
    'audio.combo': 'קומבו',
    'audio.scope': 'גל וספקטרום',
    'audio.tap': 'לחצו כדי להפעיל את השמע',
    'audio.group.ui': 'ממשק',
    'audio.group.race': 'מרוץ',
    'audio.group.drive': 'נהיגה',
    'audio.group.impact': 'התנגשויות',
    'audio.group.garage': 'מוסך',
    'audio.group.engine': 'מנוע',
    'audio.group.quiz': 'חידון',
    'audio.group.music': 'מוזיקה',
    'audio.state': 'מצב הקשר',
    'audio.voices': 'קולות פעילים',
    'audio.suspended': 'הקשר מושהה עד ללחיצה — הגרף שקט כעת',
    'audio.s.ui.hover': 'ריחוף',
    'audio.s.ui.select': 'בחירה',
    'audio.s.ui.confirm': 'אישור',
    'audio.s.ui.back': 'חזרה',
    'audio.s.ui.error': 'שגיאה',
    'audio.s.countdown.beep': 'ספירה — צפצוף',
    'audio.s.countdown.go': 'ספירה — צא!',
    'audio.s.race.fanfare': 'פתיחת מרוץ',
    'audio.s.lap.complete': 'סיום הקפה',
    'audio.s.lap.final': 'הקפה אחרונה',
    'audio.s.position.up': 'עלייה במיקום',
    'audio.s.position.down': 'ירידה במיקום',
    'audio.s.results.sting': 'תוצאות ופודיום',
    'audio.s.token.pickup': 'איסוף טוקן (קומבו)',
    'audio.s.lap.best': 'הקפה הכי מהירה',
    'audio.s.quiz.correct': 'תשובה נכונה',
    'audio.s.quiz.wrong': 'לא הפעם',
    'audio.s.quiz.timeout': 'נגמר הזמן',
    'audio.s.drift.tier': 'דריפט — עלייה בדרגה',
    'audio.s.drift.start': 'תחילת דריפט',
    'audio.s.drift.sustain': 'דריפט — טעינה',
    'audio.s.boost.release': 'שחרור בוסט',
    'audio.s.collide.wall': 'פגיעה בקיר',
    'audio.s.collide.kart': 'התנגשות בין קארטים',
    'audio.s.collide.scrape': 'חיכוך בקיר',
    'audio.s.surface.grass': 'מחוץ למסלול — דשא',
    'audio.s.surface.sand': 'מחוץ למסלול — חול',
    'audio.s.garage.build': 'הרכבת חלק',
    'audio.s.garage.reveal': 'חשיפת חלק (לפי דרגה)',
    'audio.s.engine.sweep': 'סרק ← דוושה ← בוסט',
    'audio.s.engine.idle': 'סרק ובעבוע',
    'audio.s.engine.ai': 'שלושה יריבים בקרבת מקום',
    'audio.s.music.menu': 'תפריט',
    'audio.s.music.race': 'מרוץ',
    'audio.s.music.garage': 'מוסך',
    'audio.s.music.race.oasis': 'מרוץ — נווה הנתונים',
    'audio.s.music.race.circuit': 'מרוץ — עיר הנוירונים',
    'audio.s.music.race.cloud': 'מרוץ — פסגת הענן',
  },
  en: {
    'audio.state': 'Context state',
    'audio.voices': 'Active voices',
    'audio.suspended': 'Context suspended until a click — the graph is idle',
    'audio.title': 'Procedural audio system',
    'audio.sub': 'Every sound synthesised in code — no audio files',
    'audio.mute': 'Mute',
    'audio.unmute': 'Unmute',
    'audio.stopAll': 'Stop music',
    'audio.rpm': 'Engine RPM',
    'audio.boost': 'Boost',
    'audio.combo': 'Combo',
    'audio.scope': 'Waveform & spectrum',
    'audio.tap': 'Click anywhere to enable audio',
    'audio.group.ui': 'Interface',
    'audio.group.race': 'Race',
    'audio.group.drive': 'Driving',
    'audio.group.impact': 'Impacts',
    'audio.group.garage': 'Garage',
    'audio.group.engine': 'Engine',
    'audio.group.quiz': 'Quiz',
    'audio.group.music': 'Music',
    // The three race themes by TRACK NAME, not by theme id. Without these the
    // English preview falls back to the registry label ("Music: race — circuit"),
    // which leaks the internal id — and the id deliberately stayed `circuit`
    // when the track was renamed Circuit City → Neuron City this wave.
    'audio.s.music.race.oasis': 'Race — Data Oasis',
    'audio.s.music.race.circuit': 'Race — Neuron City',
    'audio.s.music.race.cloud': 'Race — Cloud Peak',
  },
});

const GROUP_ORDER = ['engine', 'drive', 'race', 'impact', 'garage', 'quiz', 'ui', 'music'];
const GROUP_COLOUR = {
  engine: '#ffc247', drive: '#7ee081', race: '#ff9f6b', impact: '#ff6b6b',
  garage: '#c9b8ff', quiz: '#7ee0d0', ui: '#6fc3ff', music: '#ffd66b',
};

export function preview(engine) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d16);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(0, 0, 6);

  // a very cheap backdrop so the frame is not pure flat black
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 24),
    new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 v;void main(){
        float d=distance(v,vec2(.5,.55));
        vec3 c=mix(vec3(.10,.08,.05),vec3(.03,.03,.06),smoothstep(.0,.75,d));
        c+=vec3(.16,.11,.03)*(1.-smoothstep(.0,.55,d));
        gl_FragColor=vec4(c,1.);}`,
      depthWrite: false,
    })
  );
  glow.position.z = -6;
  scene.add(glow);

  audio.init();
  audio.unlock();
  if (audio.muted) audio.setMuted(false, false);

  // analyser tap on the master output
  let analyser = null, timeBuf = null, freqBuf = null;
  if (audio.ready) {
    try {
      analyser = audio.ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      audio.master.connect(analyser);
      timeBuf = new Uint8Array(analyser.fftSize);
      freqBuf = new Uint8Array(analyser.frequencyBinCount);
    } catch { analyser = null; }
  }

  // ── DOM panel ──────────────────────────────────────────────────────────────
  const canvas = h('canvas', { width: 1200, height: 236, style: { width: '100%', height: '236px', display: 'block', borderRadius: '12px', background: 'rgba(0,0,0,.45)' } });
  const st = { rpm: 0.12, boost: false, combo: 0, tier: 3, running: false };
  // sound labels are Hebrew-first; fall back to the registry's English label
  const nameOf = s => { const k = 'audio.s.' + s.name, v = t(k); return v === k ? s.label : v; };

  const btn = (label, onclick, cls = 'btn ghost') => h(`button.${cls.split(' ').join('.')}`, {
    onclick, style: { fontSize: '13px', padding: '9px 14px', borderRadius: '999px' },
  }, label);

  const groups = new Map();
  for (const s of audio.list()) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group).push(s);
  }

  const groupEls = GROUP_ORDER.filter(g => groups.has(g)).map(g => h('div.col', {
    style: {
      gap: '9px', background: 'rgba(255,255,255,.035)', border: '1px solid var(--stroke)',
      borderRadius: '14px', padding: '11px 12px 13px', alignSelf: 'start',
      borderInlineStart: `3px solid ${GROUP_COLOUR[g] || '#fff'}`,
    },
  },
    h('div.row', { style: { gap: '8px' } },
      h('div.label', { style: { color: GROUP_COLOUR[g] || '#fff', letterSpacing: '.06em' } }, t('audio.group.' + g)),
      h('span.num', { style: { fontSize: '10px', color: 'var(--txt-dim)' } }, num(groups.get(g).length))),
    h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } },
      ...groups.get(g).map(s => btn(nameOf(s), () => {
        audio.unlock();
        if (s.name === 'token.pickup') {
          st.combo = (st.combo + 1) % 12;
          audio.play(s.name, { combo: st.combo });
          comboOut.textContent = num(st.combo);
        } else if (s.group === 'music') {
          // the music.* registry entries render a fixed block for the offline
          // checker; here we want the real looping scheduler so you can sit
          // with a track for several minutes and judge it properly.
          const [, track, theme] = s.name.split('.');
          audio.playMusic(track, theme ? { theme } : {});
        } else if (s.name === 'garage.reveal') {
          st.tier = (st.tier + 1) % 4;
          audio.play(s.name, { tier: st.tier });
        } else audio.play(s.name);
      })))
  ));

  const comboOut = h('span.num', {}, num(0));
  const rpmOut = h('span.num', {}, num(12));
  const muteBtn = btn(t('audio.mute'), () => {
    audio.toggleMute();
    muteBtn.textContent = audio.muted ? t('audio.unmute') : t('audio.mute');
  }, 'btn');

  const rpmSlider = h('input.on', {
    type: 'range', min: '0', max: '100', value: '12',
    style: { width: '220px', accentColor: '#ffc247' },
    oninput: e => { st.rpm = +e.target.value / 100; rpmOut.textContent = num(Math.round(st.rpm * 100)); st.running = true; audio.unlock(); },
  });
  const boostBtn = btn(t('audio.boost'), () => { st.boost = !st.boost; boostBtn.style.filter = st.boost ? 'brightness(1.3)' : 'none'; });

  const stateOut = h('span.num', { style: { color: 'var(--warn)' } }, '—');
  const voicesOut = h('span.num', {}, num(0));
  const stat = (labelKey, valEl) => h('div.col', { style: { gap: '2px', alignItems: 'flex-start' } },
    h('div.label', { style: { fontSize: '10px' } }, t(labelKey)),
    h('div', { style: { fontSize: '15px' } }, valEl));

  const root = h('div.fill.col', {
    style: {
      padding: '18px 24px 12px', gap: '12px', overflow: 'auto',
      background: 'linear-gradient(180deg,rgba(10,10,18,.5),rgba(10,10,18,.86))',
    },
  },
    h('div.row', { style: { justifyContent: 'space-between', alignItems: 'flex-end' } },
      h('div.col', { style: { gap: '1px' } },
        h('div.display', { style: { fontSize: '30px' } }, t('audio.title')),
        h('div', { style: { fontSize: '12.5px', color: 'var(--txt-dim)' } }, t('audio.sub'))),
      h('div.row', { style: { gap: '18px' } },
        stat('audio.state', stateOut), stat('audio.voices', voicesOut),
        stat('audio.rpm', rpmOut), stat('audio.combo', comboOut),
        h('div.row', { style: { gap: '8px' } }, muteBtn, btn(t('audio.stopAll'), () => audio.stopMusic(0.3))))),

    h('div.panel', { style: { padding: '11px 12px' } },
      h('div.row', { style: { justifyContent: 'space-between', marginBlockEnd: '7px' } },
        h('div.label', {}, t('audio.scope')),
        h('div.row', { style: { gap: '10px' } }, h('div.label', { style: { fontSize: '10px' } }, t('audio.rpm')), rpmSlider, boostBtn)),
      canvas),

    h('div', {
      style: {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(206px,1fr))',
        gap: '10px', alignItems: 'start',
      },
    }, ...groupEls),

    h('div', { style: { fontSize: '11px', color: 'var(--txt-dim)', textAlign: 'center', paddingBlockStart: '2px' } }, t('audio.tap'))
  );

  engine.ui.appendChild(root);

  // ── canvas scope ───────────────────────────────────────────────────────────
  const cx = canvas.getContext('2d');
  let tick = 0;
  function drawScope() {
    const W = canvas.width, H = canvas.height;
    cx.clearRect(0, 0, W, H);
    cx.fillStyle = 'rgba(6,7,14,.9)'; cx.fillRect(0, 0, W, H);
    cx.strokeStyle = 'rgba(255,255,255,.06)'; cx.lineWidth = 1;
    for (let i = 1; i < 8; i++) { cx.beginPath(); cx.moveTo(i * W / 8, 0); cx.lineTo(i * W / 8, H); cx.stroke(); }
    cx.beginPath(); cx.moveTo(0, H / 2); cx.lineTo(W, H / 2); cx.stroke();

    const live = analyser && audio.ready && audio.ctx.state === 'running';
    if (analyser) {
      analyser.getByteFrequencyData(freqBuf);
      const bars = 96;
      for (let i = 0; i < bars; i++) {
        const lo = Math.floor(Math.pow(i / bars, 2) * (freqBuf.length - 1));
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / bars, 2) * (freqBuf.length - 1)));
        let m = 0; for (let j = lo; j < hi; j++) m = Math.max(m, freqBuf[j]);
        const bh = (m / 255) * (H * 0.9);
        const x = (i / bars) * W;
        const g = cx.createLinearGradient(0, H, 0, H - bh);
        g.addColorStop(0, 'rgba(255,194,71,.20)'); g.addColorStop(1, 'rgba(255,233,168,.85)');
        cx.fillStyle = g;
        cx.fillRect(x + 1, H - bh, W / bars - 2, bh);
      }
      analyser.getByteTimeDomainData(timeBuf);
      cx.beginPath();
      cx.strokeStyle = '#7ee081'; cx.lineWidth = 2;
      for (let i = 0; i < W; i++) {
        const v = (timeBuf[Math.floor(i / W * timeBuf.length)] - 128) / 128;
        const y = H / 2 - v * (H * 0.42);
        i ? cx.lineTo(i, y) : cx.moveTo(i, y);
      }
      cx.stroke();
    } else {
      // no audio available — show a flat trace rather than an empty box
      cx.strokeStyle = 'rgba(126,224,129,.5)'; cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(0, H / 2); cx.lineTo(W, H / 2); cx.stroke();
    }
    if (!live) {
      // Autoplay policy: with no user gesture the context stays suspended and the
      // trace is legitimately flat. Say so rather than looking broken.
      cx.fillStyle = 'rgba(255,179,71,.92)';
      cx.font = '600 13px system-ui';
      cx.textAlign = 'center';
      cx.fillText(analyser ? t('audio.suspended') : 'Web Audio unavailable — module is running silent', W / 2, 24);
      cx.textAlign = 'start';
    }
    cx.strokeStyle = 'rgba(255,255,255,.10)'; cx.strokeRect(.5, .5, W - 1, H - 1);
  }

  return {
    scene, camera,
    update() {
      tick++;
      if (st.running) {
        audio.setEngineState({ rpm01: st.rpm, load: 0.4 + st.rpm * 0.6, boosting: st.boost, surface: 'road' });
      }
      if (tick % 2 === 0) drawScope();
      if (tick % 10 === 1) {
        const s = audio.ready ? audio.ctx.state : 'unavailable';
        stateOut.textContent = s;
        stateOut.style.color = s === 'running' ? 'var(--good)' : 'var(--warn)';
        voicesOut.textContent = num(audio.activeVoices);
      }
    },
    resize(w, hgt) {
      camera.aspect = w / Math.max(1, hgt);
      camera.updateProjectionMatrix();
      const cw = Math.max(600, Math.min(1800, Math.floor(w - 110)));
      if (canvas.width !== cw) canvas.width = cw;
    },
    dispose() {
      try { audio.stopEngine(); audio.stopMusic(0.1); } catch { /* */ }
      if (analyser) { try { audio.master.disconnect(analyser); } catch { /* */ } }
      glow.geometry.dispose(); glow.material.dispose();
      root.remove();
    },
  };
}

export default audio;

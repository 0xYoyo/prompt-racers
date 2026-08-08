// Scenery library — everything that dresses a track, all generated in code.
//
// The rule that keeps this fast: anything that appears more than about six
// times is an InstancedMesh, and anything that appears once is merged into a
// shared geometry with the other one-offs that use the same material. A fully
// dressed oasis track adds ~35 draw calls at the `high` tier.
//
//   const dress = dressTrack(track.group, spline, def, engine, makeRng(7));
//   // per frame:  dress.update(elapsedSeconds);
//
// Silhouette first: palms, rocks and cliffs are built from swept strips and
// displaced polyhedra, never from boxes, because at golden hour the silhouette
// is most of what the player actually reads.
import * as THREE from 'three';
import { makeRng, makeNoise2D, fbm } from '../core/rng.js';
import { bus } from '../core/bus.js';
import {
  rockTexture, stripeTexture, woodTexture, waterTexture, stoneWallTexture,
  sandTexture, canvasTexture,
} from './textures.js';

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = t => t * t * (3 - 2 * t);
const sstep = (a, b, x) => smooth(clamp01((x - a) / (b - a || 1e-6)));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// tiny merged-geometry builder (kept local so props.js has no cross-deps)
// ---------------------------------------------------------------------------

class MB {
  constructor(useColor = true) { this.p = []; this.uv = []; this.c = []; this.i = []; this.useColor = useColor; }
  get count() { return this.p.length / 3; }
  vert(x, y, z, u = 0, v = 0, col = null) {
    this.p.push(x, y, z); this.uv.push(u, v);
    if (this.useColor) this.c.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1);
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, d, b, c, d); }
  /** Quad from four explicit world points. */
  face(pts, uvs, col) {
    const n = this.count;
    for (let k = 0; k < 4; k++) this.vert(pts[k][0], pts[k][1], pts[k][2], uvs[k][0], uvs[k][1], col);
    this.quad(n, n + 1, n + 2, n + 3);
  }
  box(cx, cy, cz, sx, sy, sz, uScale = 1, col = null, rotY = 0) {
    const co = Math.cos(rotY), si = Math.sin(rotY);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const c = [
      [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
      [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
    ].map(([x, y, z]) => [cx + x * co - z * si, cy + y, cz + x * si + z * co]);
    const faces = [
      [0, 1, 2, 3, sx, sy], [5, 4, 7, 6, sx, sy], [4, 0, 3, 7, sz, sy],
      [1, 5, 6, 2, sz, sy], [3, 2, 6, 7, sx, sz], [4, 5, 1, 0, sx, sz],
    ];
    for (const [a, b, d, e, fu, fv] of faces) {
      this.face([c[a], c[b], c[d], c[e]],
        [[0, 0], [fu * uScale, 0], [fu * uScale, fv * uScale], [0, fv * uScale]], col);
    }
  }
  merge(other, ox = 0, oy = 0, oz = 0) {
    const base = this.count;
    for (let i = 0; i < other.p.length; i += 3) this.p.push(other.p[i] + ox, other.p[i + 1] + oy, other.p[i + 2] + oz);
    for (const v of other.uv) this.uv.push(v);
    if (this.useColor) for (const v of other.c) this.c.push(v);
    for (const v of other.i) this.i.push(v + base);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.useColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Sweep a cross-section along a spline — same maths as the track mesher. */
function sweep(mb, spline, ts, sectionFn, opts = {}) {
  const { vScale = 4, swapUV = false, taper = 0, closed = false } = opts;
  const n = ts.length;
  const R = new THREE.Vector3(), U = new THREE.Vector3();
  let prevBase = -1;
  for (let i = 0; i < n; i++) {
    const t = ts[i];
    const fr = spline.frameAt(((t % 1) + 1) % 1);
    const cb = Math.cos(fr.bank), sb = Math.sin(fr.bank);
    R.set(fr.right.x * cb + fr.up.x * sb, fr.right.y * cb + fr.up.y * sb, fr.right.z * cb + fr.up.z * sb);
    U.set(fr.up.x * cb - fr.right.x * sb, fr.up.y * cb - fr.right.y * sb, fr.up.z * cb - fr.right.z * sb);
    let ramp = 1;
    if (taper > 0 && !closed) ramp = Math.min(smooth(clamp01(i / taper)), smooth(clamp01((n - 1 - i) / taper)));
    const sec = sectionFn(t, i, ramp, fr);
    const arc = t * spline.length;
    const base = mb.count;
    for (const s of sec) {
      const x = fr.pos.x + R.x * s.l + U.x * s.h;
      const y = fr.pos.y + R.y * s.l + U.y * s.h;
      const z = fr.pos.z + R.z * s.l + U.z * s.h;
      const av = arc / vScale;
      if (swapUV) mb.vert(x, y, z, av, s.u, s.col); else mb.vert(x, y, z, s.u, av, s.col);
    }
    if (prevBase >= 0) for (let c = 0; c < sec.length - 1; c++) mb.quad(prevBase + c, prevBase + c + 1, base + c + 1, base + c);
    prevBase = base;
  }
}

const CV = new THREE.Vector3();
function tint(hex, k = 1) {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
}

// ---------------------------------------------------------------------------
// shared materials
// ---------------------------------------------------------------------------

/** Vertex-coloured matte material — the workhorse for vegetation and rock. */
function vcMat(extra = {}) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0, ...extra,
  });
}

// ---------------------------------------------------------------------------
// CROWD
// ---------------------------------------------------------------------------

// Bright, saturated but slightly dusty — a crowd of pure primaries reads as
// confetti, not people.
const SHIRT = [
  0xe8563f, 0xf2a03a, 0xf6d34a, 0x62b452, 0x3fa8a0, 0x4776c8, 0x8a5ec4,
  0xe06fa0, 0xf1efe4, 0x2f3d59, 0xd94f6e, 0x5fc8d8, 0xffa86b, 0x9ec45a,
];
const SKIN = [0xf0c9a0, 0xdba173, 0xb87a4e, 0x8a5734, 0xf6dcc0];
const HAT = [0xf5f1e6, 0xe8563f, 0x2f3d59, 0xf2a03a, 0x3fa8a0];
// Team colours the spectators wave: the racer palette, so a flag in the stand
// reads as "someone here is backing one of us" rather than as random confetti.
const FLAG = [0xffc247, 0x9fe053, 0x5f82b4, 0xe8563f, 0x5fc8d8, 0xe06fa0, 0xf5f1e6];
const UP_Y = new THREE.Vector3(0, 1, 0);

// --- shared cheer envelope -------------------------------------------------
// Module level on purpose: dressTrack builds several crowd groups per track and
// they must all erupt together. Stored as (start, duration, strength) rather
// than an integrated decay so it needs no dt and stays frame-rate independent.
let cheerT0 = -1e9, cheerDur = 1, cheerStr = 0;
// Hardest a cheer can ever push the envelope: cheer() clamps strength to 1.5
// and k is clamped to [0,1], so env ∈ [0, MAX_ENV] by construction.
const MAX_STR = 1.5;
const MAX_ENV = MAX_STR;
// Duration bounds. The ceiling matters as much as the floor: cheer(1, 1e9)
// would otherwise pin the whole stand near maximum gain for the rest of the
// session, which reads as a stuck animation rather than as a roar. The longest
// cheer the game actually fires is race:finish at 5 s.
const MIN_DUR = 0.2, MAX_DUR = 10, DEF_DUR = 2.5;
function cheerAt(t) {
  if (cheerStr <= 0) return 0;
  const u = (t - cheerT0) / cheerDur;
  // u < 0 means the clock is BEFORE the roar started. That happens when a new
  // race resets t to 0 while this module-level state still holds the previous
  // race's cheer — extrapolating backwards made k > 1 and the quadratic grew
  // without bound, launching spectators into orbit. Before the roar: silence.
  if (u < 0 || u >= 1) return 0;
  const k = 1 - u;
  return cheerStr * k * k;    // quadratic tail: a sharp roar, a slow settle
}

/**
 * Hundreds of stylised capsule spectators as three InstancedMeshes (bodies,
 * heads, and a few waved flags). Never a face, never a per-person draw call.
 *
 * Variety comes out of the instance matrices we already have to write: each
 * spectator gets a yaw and a slightly non-uniform scale at build time, and one
 * of three bob archetypes (gentle / near-still / bouncer). `cheer()` — also
 * fired from the race bus — briefly lifts the whole stand.
 *
 * @param {Array<{x,y,z,s?}>} spots
 * @returns {{group, update(t), cheer(strength, seconds), dispose()}}
 */
export function createCrowd(spots, rng, q = {}, opts = {}) {
  // A new stand means a new (or rebuilt) track, and very likely a new race
  // clock. Drop any leftover roar so stale module-level state can never meet a
  // reset t. dressTrack builds several groups back to back — resetting for
  // each is harmless, nothing cheers during construction.
  cheerT0 = -1e9; cheerDur = 1; cheerStr = 0;
  const n = spots.length;
  const group = new THREE.Group();
  group.name = 'crowd';
  if (!n) return { group, update() { }, cheer() { }, dispose() { } };

  const bodyGeo = new THREE.CapsuleGeometry(0.19, 0.42, 3, 7);
  bodyGeo.translate(0, 0.40, 0);
  const headGeo = new THREE.SphereGeometry(0.145, 7, 5);
  headGeo.translate(0, 0.86, 0);

  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.85, metalness: 0,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const bodies = new THREE.InstancedMesh(bodyGeo, mat, n);
  const heads = new THREE.InstancedMesh(headGeo, mat, n);
  bodies.castShadow = heads.castShadow = !!q.shadows;
  bodies.name = 'crowd-bodies'; heads.name = 'crowd-heads';

  const base = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const jump = new Float32Array(n);     // phase of the cheer jump, per person
  const amp = new Float32Array(n);
  const lift = new Float32Array(n);     // hard cap on vertical offset above base
  const freq = new Float32Array(n);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const qt = new THREE.Quaternion();
  const eu = new THREE.Euler();
  const vp = new THREE.Vector3();
  const vs = new THREE.Vector3();

  // flags get built after the loop, so collect their owners as we go
  const flagOwner = [];
  const flagYaw = [];
  const flagScale = [];
  const flagCol = [];

  for (let i = 0; i < n; i++) {
    const s = spots[i];
    base[i * 3] = s.x; base[i * 3 + 1] = s.y; base[i * 3 + 2] = s.z;
    phase[i] = rng() * TAU;
    jump[i] = rng() * TAU;

    // --- bob archetype ------------------------------------------------------
    // A stand where every capsule breathes at the same rate reads as a texture
    // scrolling. Three behaviours is enough to break that up.
    // The archetype only ever shapes amp[] and freq[] below, so it stays a
    // local: nothing after build time needs to know which one this person got.
    const rA = rng();
    const a = rA < 0.60 ? 0 : rA < 0.85 ? 1 : 2;
    const baseAmp = rng.range(0.035, 0.13);
    amp[i] = baseAmp * (a === 1 ? 0.13 : a === 2 ? 2.5 : 1);
    // Belt and suspenders: the most this person can legitimately rise is their
    // bob at full cheer gain plus the full cheer jump. Anything above that is
    // a bug, and update() clamps to it so no future envelope/phase mistake can
    // ever launch a spectator again.
    lift[i] = amp[i] * (1 + 3 * MAX_ENV) + MAX_ENV * 0.34;
    freq[i] = 2.1 * (a === 1 ? 0.55 : a === 2 ? 2.0 : 1) * rng.range(0.9, 1.1);

    // --- pose: yaw + mildly non-uniform scale, written once ------------------
    const sc = (s.s ?? 1) * rng.range(0.86, 1.16);
    const yaw = rng() * TAU;
    const sx = sc * rng.range(0.94, 1.06);
    const sy = sc * rng.range(0.94, 1.06);
    const sz = sc * rng.range(0.94, 1.06);

    col.setHex(rng.pick(SHIRT)).multiplyScalar(rng.range(0.86, 1.08));
    bodies.setColorAt(i, col);
    col.setHex(rng() < 0.30 ? rng.pick(HAT) : rng.pick(SKIN)).multiplyScalar(rng.range(0.9, 1.06));
    heads.setColorAt(i, col);

    // initial matrices so a t=0 screenshot is already correct
    qt.setFromAxisAngle(UP_Y, yaw);
    m4.compose(vp.set(s.x, s.y, s.z), qt, vs.set(sx, sy, sz));
    bodies.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);

    if (rng() < 0.12) {
      flagOwner.push(i); flagYaw.push(yaw); flagScale.push(sc);
      flagCol.push(rng.pick(FLAG));
    }
  }
  bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
  bodies.instanceColor.needsUpdate = heads.instanceColor.needsUpdate = true;
  group.add(bodies, heads);

  // --- flags: one more instanced mesh, ~12% of the crowd ---------------------
  const nf = flagOwner.length;
  let flags = null, flagGeo = null, flagMat = null;
  let fOwner = null, fYaw = null, fScl = null, fm = null;
  if (nf) {
    const fb = new MB(true);
    const stickC = tint(0x6b4a2c, 1);
    fb.box(0, 1.05, 0, 0.035, 1.05, 0.035, 1, stickC);       // the stick
    // the cloth: a quad off one side of the stick, tinted per instance
    fb.face([[0.02, 1.18, 0], [0.44, 1.15, 0.02], [0.44, 1.50, 0.02], [0.02, 1.52, 0]],
      [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1]);
    flagGeo = fb.geometry();
    flagMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    });
    flags = new THREE.InstancedMesh(flagGeo, flagMat, nf);
    flags.name = 'crowd-flags';
    flags.castShadow = false;
    fOwner = new Uint16Array(nf); fYaw = new Float32Array(nf); fScl = new Float32Array(nf);
    for (let k = 0; k < nf; k++) {
      const i = flagOwner[k];
      fOwner[k] = i; fYaw[k] = flagYaw[k]; fScl[k] = flagScale[k];
      col.setHex(flagCol[k]);
      flags.setColorAt(k, col);
      qt.setFromAxisAngle(UP_Y, fYaw[k]);
      m4.compose(vp.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]), qt,
        vs.set(fScl[k], fScl[k], fScl[k]));
      flags.setMatrixAt(k, m4);
    }
    flags.instanceMatrix.needsUpdate = true;
    flags.instanceColor.needsUpdate = true;
    group.add(flags);
    fm = flags.instanceMatrix.array;
  }

  const bm = bodies.instanceMatrix.array, hm = heads.instanceMatrix.array;

  let lastT = 0;
  const self = {
    group,
    /**
     * Erupt. `strength` ~1 is a full-throated roar; the envelope decays over
     * `seconds` and is shared by every crowd group on the track.
     */
    cheer(strength = 1, seconds = 2.5) {
      // Both arguments are validated the same way, and for the same reason:
      // this state is module-level and never re-derived, so one bad call
      // poisons every stand for the rest of the process. A NaN duration is the
      // nastier of the two — cheerAt() would return NaN forever, `s*s >= NaN`
      // is false, and the crowd would go permanently, silently mute.
      const s = Number.isFinite(strength) ? Math.max(0, Math.min(MAX_STR, strength)) : 0;
      if (s <= 0) return;
      const d = Number.isFinite(seconds) ? Math.max(MIN_DUR, Math.min(MAX_DUR, seconds)) : DEF_DUR;
      // never cut an existing roar short — take whichever is louder
      if (s * s >= cheerAt(lastT)) { cheerT0 = lastT; cheerDur = d; cheerStr = s; }
    },
    /**
     * Idle bob (three archetypes) plus the cheer lift. Writes only the Y
     * translation of the bodies/heads; flags get a full recompose, but there
     * are only ~12% as many of them.
     */
    update(t) {
      // A poisoned clock must not become poisoned state: NaN/Infinity in, last
      // good time kept, envelope treated as silent.
      if (Number.isFinite(t)) lastT = t; else t = lastT;
      const e = cheerAt(t);
      const env = e > 0 ? (e < MAX_ENV ? e : MAX_ENV) : 0;
      const gain = 1 + 3 * env;
      const jAmp = env * 0.34;
      for (let i = 0; i < n; i++) {
        const o = i * 16;
        let dy = Math.abs(Math.sin(t * freq[i] + phase[i])) * amp[i] * gain;
        if (jAmp > 0) dy += jAmp * Math.abs(Math.sin(t * 6.3 + jump[i]));
        // Hard ceiling — see lift[]. Written as a two-sided clamp with the NaN
        // case falling through to 0, because `NaN > lift` is false and a single
        // `if` would let a poisoned clock (t = NaN) straight into the matrix.
        dy = dy > 0 ? (dy < lift[i] ? dy : lift[i]) : 0;
        const y = base[i * 3 + 1] + dy;
        bm[o + 13] = y; hm[o + 13] = y;
      }
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
      if (nf) {
        const wave = 0.16 + env * 0.5;
        for (let k = 0; k < nf; k++) {
          const i = fOwner[k];
          const s = fScl[k];
          const sw = Math.sin(t * (2.4 + env * 3.0) + phase[i]) * wave;
          eu.set(sw * 0.5, fYaw[k] + sw * 0.35, sw);
          qt.setFromEuler(eu);
          vp.set(base[i * 3], bm[i * 16 + 13], base[i * 3 + 2]);
          m4.compose(vp, qt, vs.set(s, s, s));
          m4.toArray(fm, k * 16);
        }
        flags.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
      bodyGeo.dispose(); headGeo.dispose(); mat.dispose();
      bodies.dispose(); heads.dispose();
      flagGeo?.dispose(); flagMat?.dispose(); flags?.dispose();
    },
  };

  // The world reacting to the player is the whole point of a crowd. Subscribed
  // here and released in dispose(), so a stand never outlives its track.
  const offs = [
    bus.on('race:position', e => { if (e && e.to < e.from) self.cheer(0.85, 2.8); }),
    bus.on('race:lap', () => self.cheer(0.7, 2.2)),
    bus.on('race:finish', () => self.cheer(1.0, 5.0)),
  ];
  return self;
}

// ---------------------------------------------------------------------------
// PALMS
// ---------------------------------------------------------------------------

/**
 * One palm as a merged, vertex-coloured geometry: a leaning tapered trunk with
 * ring scars, a crown of drooping fronds built as tapering strips, and a
 * cluster of dates. Returns geometry only — callers instance it.
 */
export function createPalmGeometry(rng, opts = {}) {
  const h = opts.height ?? rng.range(5.2, 9.0);
  const lean = opts.lean ?? rng.range(0.12, 0.42);
  const leanA = rng() * TAU;
  const mb = new MB(true);

  // --- trunk: 8 segments, curved, hexagonal cross-section -------------------
  const SEG = 8, SIDES = 7;
  const rings = [];
  for (let s = 0; s <= SEG; s++) {
    const f = s / SEG;
    const r = lerp(0.30, 0.15, Math.pow(f, 0.7)) * (opts.thick ?? 1);
    const bendo = Math.pow(f, 1.8) * lean * h;
    const cx = Math.cos(leanA) * bendo, cz = Math.sin(leanA) * bendo;
    const y = f * h;
    const ring = [];
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * TAU;
      // ring scars: bulge every other segment so the trunk is not a cone
      const bulge = 1 + Math.sin(f * 26) * 0.06;
      ring.push([cx + Math.cos(a) * r * bulge, y, cz + Math.sin(a) * r * bulge]);
    }
    rings.push(ring);
    const shade = lerp(0.72, 1.0, f) * rng.range(0.95, 1.05);
    const c = tint(0x8a6a45, shade);
    for (const p of ring) mb.vert(p[0], p[1], p[2], 0, f * 3, c);
  }
  for (let s = 0; s < SEG; s++) {
    for (let k = 0; k < SIDES; k++) {
      const a = s * SIDES + k, b = s * SIDES + (k + 1) % SIDES;
      mb.quad(a, b, b + SIDES, a + SIDES);
    }
  }

  // --- crown ---------------------------------------------------------------
  const top = [Math.cos(leanA) * lean * h, h, Math.sin(leanA) * lean * h];
  const nF = rng.int(9, 13);
  for (let f = 0; f < nF; f++) {
    const a = (f / nF) * TAU + rng.range(-0.12, 0.12);
    const len = rng.range(3.2, 4.8);
    const rise = rng.range(0.9, 1.9);
    const droop = rng.range(1.6, 3.0);
    const wid = rng.range(0.46, 0.70);
    const green = tint(rng() < 0.2 ? 0x8d9a3e : 0x4e7b34, rng.range(0.82, 1.18));
    const greenTip = tint(0x6f9440, rng.range(0.9, 1.2));
    const STEPS = 5;
    let prev = null;
    for (let s = 0; s <= STEPS; s++) {
      const u = s / STEPS;
      const d = u * len;
      const y = top[1] + rise * u - droop * u * u * 1.15;
      const x = top[0] + Math.cos(a) * d, z = top[2] + Math.sin(a) * d;
      const w = wid * (1 - Math.pow(Math.abs(u - 0.42) / 0.58, 2)) * (u < 0.06 ? 0.4 : 1);
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      const c = u > 0.7 ? greenTip : green;
      const n0 = mb.count;
      mb.vert(x + px, y + 0.02, z + pz, 0, u * 2, c);
      mb.vert(x, y - 0.03, z, 0.5, u * 2, tint(0x3d6329, 1));
      mb.vert(x - px, y + 0.02, z - pz, 1, u * 2, c);
      if (prev !== null) { mb.quad(prev, prev + 1, n0 + 1, n0); mb.quad(prev + 1, prev + 2, n0 + 2, n0 + 1); }
      prev = n0;
    }
  }
  // dates
  if (rng() < 0.55) {
    for (let k = 0; k < 3; k++) {
      const a = rng() * TAU, d = rng.range(0.25, 0.5);
      mb.box(top[0] + Math.cos(a) * d, top[1] - 0.35, top[2] + Math.sin(a) * d,
        0.32, 0.42, 0.32, 1, tint(0xc8783a, rng.range(0.9, 1.1)), rng() * 3);
    }
  }
  return mb.geometry();
}

/**
 * A field of palms as one InstancedMesh per trunk variant.
 * @param {Array<{x,y,z,s,r}>} spots
 */
export function createPalms(spots, rng, q = {}) {
  const group = new THREE.Group();
  group.name = 'palms';
  if (!spots.length) return { group, dispose() { } };
  const variants = 4;
  const geos = [];
  for (let i = 0; i < variants; i++) geos.push(createPalmGeometry(rng, {}));
  const mat = vcMat({ side: THREE.DoubleSide, roughness: 0.88 });
  const buckets = geos.map(() => []);
  spots.forEach((s, i) => buckets[i % variants].push(s));
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  const meshes = [];
  buckets.forEach((list, i) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[i], mat, list.length);
    im.name = 'palms' + i;
    im.castShadow = !!q.shadows;
    list.forEach((s, k) => {
      qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.r ?? 0);
      sc.set(s.s ?? 1, s.s ?? 1, s.s ?? 1);
      pv.set(s.x, s.y, s.z);
      m4.compose(pv, qt, sc);
      im.setMatrixAt(k, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    meshes.push(im);
    group.add(im);
  });
  return {
    group,
    dispose() { geos.forEach(g => g.dispose()); mat.dispose(); meshes.forEach(m => m.dispose()); },
  };
}

// ---------------------------------------------------------------------------
// ROCKS — weathered, layered sandstone
// ---------------------------------------------------------------------------

/**
 * An irregular sandstone boulder: a subdivided icosahedron pushed around by
 * noise, then squashed into horizontal strata and banded in colour so it reads
 * as sedimentary rock rather than as a lump of clay.
 */
export function createRockGeometry(rng, opts = {}) {
  const detail = opts.detail ?? 2;
  const g = new THREE.IcosahedronGeometry(1, detail);
  const noise = makeNoise2D(rng.int(1, 9999));
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const base = new THREE.Color(opts.color ?? 0xb06a3e);
  const pale = new THREE.Color(opts.pale ?? 0xd2a06a);
  const c = new THREE.Color();
  const squash = opts.squash ?? rng.range(0.45, 0.8);
  const bands = rng.range(2.5, 5.5);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n1 = fbm(noise, x * 1.4 + 5, z * 1.4 - 3, 3) - 0.5;
    const n2 = fbm(noise, x * 3.6 - 1, y * 3.6 + 7, 2) - 0.5;
    // strata: quantise the radius by height so ledges form
    const step = Math.round(y * bands) / bands;
    const k = 1 + n1 * 0.42 + n2 * 0.16 + (step - y) * 0.30;
    x *= k; z *= k; y *= k * squash;
    pos.setXYZ(i, x, y, z);
    const bandT = clamp01(0.5 + Math.sin(y * bands * 2.4 + n1 * 3) * 0.5);
    c.copy(base).lerp(pale, bandT * 0.75).multiplyScalar(0.9 + n2 * 0.3);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

/** @param {Array<{x,y,z,s,r}>} spots */
export function createRocks(spots, rng, q = {}, opts = {}) {
  const group = new THREE.Group();
  group.name = 'rocks';
  if (!spots.length) return { group, dispose() { } };
  const variants = 5;
  const geos = [];
  for (let i = 0; i < variants; i++) {
    const cols = opts.colors || [0xb06a3e, 0xa25c38, 0xc07f4c, 0x96543a, 0xb8763f];
    geos.push(createRockGeometry(rng, {
      detail: i < 3 ? 2 : 1,
      color: cols[i % cols.length], pale: opts.pale,
    }));
  }
  const mat = vcMat({ flatShading: false, roughness: 1 });
  const buckets = geos.map(() => []);
  spots.forEach((s, i) => buckets[i % variants].push(s));
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  const meshes = [];
  buckets.forEach((list, i) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[i], mat, list.length);
    im.name = 'rocks' + i;
    im.castShadow = !!q.shadows; im.receiveShadow = !!q.shadows;
    list.forEach((s, k) => {
      qt.setFromEuler(new THREE.Euler(rng.range(-0.12, 0.12), s.r ?? 0, rng.range(-0.12, 0.12)));
      sc.set((s.s ?? 1) * (s.sx ?? 1), (s.s ?? 1) * (s.sy ?? 1), (s.s ?? 1) * (s.sz ?? 1));
      pv.set(s.x, s.y, s.z);
      m4.compose(pv, qt, sc);
      im.setMatrixAt(k, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    meshes.push(im); group.add(im);
  });
  return { group, dispose() { geos.forEach(g => g.dispose()); mat.dispose(); meshes.forEach(m => m.dispose()); } };
}

// ---------------------------------------------------------------------------
// SHRUBS / REEDS
// ---------------------------------------------------------------------------

/** A dry desert shrub: a clump of squashed, noisy spheroids on a woody base. */
export function createShrubGeometry(rng) {
  const mb = new MB(true);
  const lobes = rng.int(3, 5);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * TAU + rng.range(-0.4, 0.4);
    const d = i === 0 ? 0 : rng.range(0.2, 0.5);
    const r = rng.range(0.24, 0.42);
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = rng.range(0.18, 0.38);
    const RS = 6, SS = 4;
    const b0 = mb.count;
    // dry desert scrub: olive/khaki, not lawn green
    const col = tint(rng() < 0.45 ? 0x9aa05a : 0x76803f, rng.range(0.85, 1.25));
    for (let v = 0; v <= SS; v++) {
      const ph = (v / SS) * Math.PI;
      for (let u = 0; u <= RS; u++) {
        const th = (u / RS) * TAU;
        const jitter = 1 + (fbm(SHRUB_NOISE, th * 2 + i, ph * 2, 2) - 0.5) * 0.55;
        mb.vert(cx + Math.sin(ph) * Math.cos(th) * r * jitter,
          cy + Math.cos(ph) * r * 0.72 * jitter,
          cz + Math.sin(ph) * Math.sin(th) * r * jitter, u / RS, v / SS, col);
      }
    }
    for (let v = 0; v < SS; v++) {
      for (let u = 0; u < RS; u++) {
        const a0 = b0 + v * (RS + 1) + u;
        mb.quad(a0, a0 + 1, a0 + RS + 2, a0 + RS + 1);
      }
    }
  }
  // a couple of woody twigs poking out of the silhouette
  for (let i = 0; i < 3; i++) {
    const a = rng() * TAU;
    mb.box(Math.cos(a) * 0.2, 0.55, Math.sin(a) * 0.2, 0.05, rng.range(0.3, 0.7), 0.05, 1, tint(0x6f5638), a);
  }
  return mb.geometry();
}
const SHRUB_NOISE = makeNoise2D(5150);

export function createShrubs(spots, rng, q = {}) {
  const group = new THREE.Group();
  group.name = 'shrubs';
  if (!spots.length) return { group, dispose() { } };
  const geos = [createShrubGeometry(rng), createShrubGeometry(rng), createShrubGeometry(rng)];
  const mat = vcMat({ side: THREE.DoubleSide });
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  const buckets = geos.map(() => []);
  spots.forEach((s, i) => buckets[i % geos.length].push(s));
  const meshes = [];
  buckets.forEach((list, i) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[i], mat, list.length);
    im.name = 'shrubs' + i;
    im.castShadow = !!q.shadows;
    list.forEach((s, k) => {
      qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.r ?? 0);
      sc.set(s.s ?? 1, (s.s ?? 1) * (s.sy ?? 1), s.s ?? 1);
      pv.set(s.x, s.y, s.z);
      m4.compose(pv, qt, sc);
      im.setMatrixAt(k, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    meshes.push(im); group.add(im);
  });
  return { group, dispose() { geos.forEach(g => g.dispose()); mat.dispose(); meshes.forEach(m => m.dispose()); } };
}

// ---------------------------------------------------------------------------
// CANYON CLIFFS
// ---------------------------------------------------------------------------

/**
 * Layered sandstone cliffs flanking the track. Built by sweeping a stepped
 * cross-section along the spline at a noisy lateral distance, so the wall
 * undulates in and out and its top line is never a straight edge.
 *
 * @param spline  TrackSpline
 * @param arcs    [[t0,t1,side], …] portions of the lap to flank
 */
export function createCliffs(spline, arcs, rng, opts = {}) {
  const noise = makeNoise2D(opts.seed ?? 8801);
  const mb = new MB(true);
  const base = new THREE.Color(opts.color ?? 0xa35c33);
  const pale = new THREE.Color(opts.pale ?? 0xcf9159);
  const c = new THREE.Color();
  const stepM = opts.step ?? 5;
  const groundAt = opts.heightAt || null;
  for (const [t0, t1, side, scale = 1] of arcs) {
    const span = (t1 - t0 + 1) % 1 || 1;
    const n = Math.max(6, Math.round(span * spline.length / stepM));
    const ts = [];
    for (let i = 0; i <= n; i++) ts.push(t0 + span * (i / n));
    sweep(mb, spline, ts, (t, i, ramp, fr) => {
      const w = spline.widthAt(t);
      const nn = fbm(noise, t * 60, side * 3, 4);
      const n2 = fbm(noise, t * 190, side * 1.7, 3);
      const D = (opts.dist ?? 44) + nn * 40 + n2 * 8;
      // Where would the foot of this cliff land? Two guards on the answer:
      //   1. if the loop doubles back, "outward" at one t is the infield at
      //      another, so fade the wall out near any part of the track;
      //   2. anchor the base to the terrain there, or a 60 m wall floats over
      //      a dune or sinks into one.
      const fx = fr.pos.x + fr.right.x * side * (w + D);
      const fz = fr.pos.z + fr.right.z * side * (w + D);
      const near = spline.closestT(CV.set(fx, 0, fz)).dist;
      const clear = sstep(w + 18, w + 40, near);
      const ground = groundAt ? groundAt(fx, fz) : fr.pos.y;
      const foot = ground - fr.pos.y;
      const H = (14 + nn * 30 + n2 * 10) * scale * (0.30 + 0.70 * ramp) * clear;
      const sec = [];
      // Cross-section of a mesa, in [lateral offset beyond D, height fraction].
      // Every ledge steps AWAY from the track as it rises — get that sign wrong
      // and the whole range leans out over the circuit like a breaking wave.
      // The first and last entries are buried well under the terrain so the
      // mass always meets the ground whatever the dunes are doing out there.
      const K = 0.35 + H / 60;
      const prof = [
        [-16 * K, -30], [-4 * K, -0.6], [0, 0.30], [2.0 * K, 0.34],
        [4.5 * K, 0.60], [7.5 * K, 0.65], [10.5 * K, 0.86], [14 * K, 0.91],
        [18 * K, 1.00], [38 * K, 0.90], [58 * K, -30],
      ];
      const sink = (1 - clear) * 12;
      for (const [back, f] of prof) {
        const h = foot - 0.6 - sink + (f < 0 ? f : H * f);
        c.copy(base).lerp(pale, clamp01(0.22 + Math.sin(f * 17 + nn * 5) * 0.34 + Math.sin(f * 41) * 0.14 + f * 0.28))
          .multiplyScalar(0.80 + n2 * 0.42);
        sec.push({
          l: side * (w + D + back),
          h, u: h / 12, col: [c.r, c.g, c.b],
        });
      }
      return sec;
    }, { vScale: 14, swapUV: true, taper: 6 });
  }
  const g = mb.geometry();
  const maps = rockTexture({ size: opts.texSize ?? 512, tint: 0xffffff, bands: 16, contrast: 0.9 });
  for (const t of Object.values(maps)) if (t?.isTexture) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); }
  const mat = new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap || null, vertexColors: true,
    roughness: 1, metalness: 0,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'cliffs';
  mesh.castShadow = !!opts.shadows;
  mesh.receiveShadow = !!opts.shadows;
  return { mesh, dispose() { g.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------
// OASIS POOL
// ---------------------------------------------------------------------------

/**
 * Turquoise spring: an animated water disc, a wet-sand shore ring that follows
 * the terrain, and a fringe of reeds.
 */
export function createPool(x, z, radius, heightAt, rng, q = {}) {
  const group = new THREE.Group();
  group.name = 'pool';
  const y = heightAt(x, z);
  const SEG = 26;
  // irregular outline so it is not a perfect circle
  const wob = [];
  for (let i = 0; i < SEG; i++) wob.push(1 + Math.sin(i * 1.7 + rng() * 0.4) * 0.13 + rng.range(-0.06, 0.06));

  const water = waterTexture({ size: Math.min(q.texSize || 512, 512) });
  for (const t of Object.values(water)) if (t?.isTexture) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(radius / 5, radius / 5); }
  const wmat = new THREE.MeshStandardMaterial({
    map: water.map, normalMap: water.normalMap || null, roughness: 0.14,
    metalness: 0.3, envMapIntensity: 1.2,
  });
  const wmb = new MB(false);
  const c0 = wmb.count;
  wmb.vert(x, y - 0.25, z, 0.5, 0.5);
  for (let i = 0; i <= SEG; i++) {
    const a = (i % SEG) / SEG * TAU;
    const r = radius * wob[i % SEG];
    wmb.vert(x + Math.cos(a) * r, y - 0.25, z + Math.sin(a) * r, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
  }
  for (let i = 0; i < SEG; i++) wmb.tri(c0, c0 + 1 + i, c0 + 2 + i);
  const wg = wmb.geometry();
  const pool = new THREE.Mesh(wg, wmat);
  pool.name = 'water';
  group.add(pool);

  // shore: damp sand ring that laps the terrain
  const smb = new MB(true);
  const sandMaps = sandTexture({ size: Math.min(q.texSize || 512, 512), tint: 0xcfa878, ripple: 0.4, seed: 77 });
  for (const t of Object.values(sandMaps)) if (t?.isTexture) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); }
  const rings = [0.94, 1.06, 1.34, 1.9];
  const base = smb.count;
  for (let ri = 0; ri < rings.length; ri++) {
    for (let i = 0; i <= SEG; i++) {
      const a = (i % SEG) / SEG * TAU;
      const r = radius * wob[i % SEG] * rings[ri];
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const py = ri < 2 ? y - 0.30 + ri * 0.10 : lerp(y - 0.1, heightAt(px, pz) + 0.06, (ri - 1) / 2);
      const k = lerp(0.62, 1.12, ri / (rings.length - 1));
      smb.vert(px, py, pz, px / 6, pz / 6, [k, k * 0.97, k * 0.9]);
    }
  }
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let i = 0; i < SEG; i++) {
      const a0 = base + ri * (SEG + 1) + i;
      smb.quad(a0, a0 + 1, a0 + SEG + 2, a0 + SEG + 1);
    }
  }
  const sg = smb.geometry();
  const smat = new THREE.MeshStandardMaterial({
    map: sandMaps.map, normalMap: sandMaps.normalMap, vertexColors: true, roughness: 1,
  });
  const shore = new THREE.Mesh(sg, smat);
  shore.name = 'pool-shore';
  shore.receiveShadow = !!q.shadows;
  group.add(shore);

  // reeds: instanced thin cones around the rim
  const reedGeo = new THREE.ConeGeometry(0.10, 1.5, 4, 1, true);
  reedGeo.translate(0, 0.75, 0);
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x6f8a3c, roughness: 0.9, side: THREE.DoubleSide });
  const nReed = Math.round(80 * (q.propDensity ?? 1));
  const reeds = new THREE.InstancedMesh(reedGeo, reedMat, nReed);
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  const cc = new THREE.Color();
  for (let i = 0; i < nReed; i++) {
    const a = rng() * TAU, r = radius * rng.range(1.0, 1.34);
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    qt.setFromEuler(new THREE.Euler(rng.range(-0.22, 0.22), rng() * TAU, rng.range(-0.22, 0.22)));
    const s = rng.range(0.6, 1.5);
    sc.set(s, s * rng.range(0.8, 1.6), s);
    pv.set(px, y - 0.2, pz);
    m4.compose(pv, qt, sc);
    reeds.setMatrixAt(i, m4);
    cc.setHex(rng() < 0.4 ? 0x8fa04a : 0x5d7a34).multiplyScalar(rng.range(0.85, 1.15));
    reeds.setColorAt(i, cc);
  }
  reeds.instanceMatrix.needsUpdate = true;
  if (reeds.instanceColor) reeds.instanceColor.needsUpdate = true;
  reeds.name = 'pool-reeds';
  reeds.castShadow = !!q.shadows;
  group.add(reeds);

  return {
    group,
    update(t) {
      water.map.offset.set(t * 0.010, t * 0.017);
      if (water.normalMap) water.normalMap.offset.set(t * 0.010, t * 0.017);
    },
    dispose() { wg.dispose(); sg.dispose(); wmat.dispose(); smat.dispose(); reedGeo.dispose(); reedMat.dispose(); reeds.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// SIGNAGE — our own invented in-world Hebrew brands
// ---------------------------------------------------------------------------

const BRANDS = [
  { he: 'טורבו־בינה', bg: 0xc4402f, fg: 0xffe9c4 },
  { he: 'מנוע פרומפט', bg: 0x1f6f78, fg: 0xfdf3dd },
  { he: 'ברק אנרגיה', bg: 0xe0a52c, fg: 0x3a2410 },
  { he: 'נחל נתונים', bg: 0x2f5f34, fg: 0xf2f6d8 },
];

/**
 * All four sponsor boards baked into one 2x2 atlas so every banner on the
 * circuit is a single draw call.
 */
export function brandAtlas(size = 512) {
  return canvasTexture('brandAtlas', size, (ctx, S) => {
    const h = S / 2;
    BRANDS.forEach((b, i) => {
      const ox = (i % 2) * h, oy = Math.floor(i / 2) * h;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillStyle = '#' + b.bg.toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, h, h);
      for (let k = 0; k < 500; k++) {
        ctx.fillStyle = `rgba(255,255,255,${0.010 + ((k * 13) % 6) * 0.004})`;
        ctx.fillRect((k * 97) % h, (k * 181) % h, 3, 2);
      }
      ctx.fillStyle = '#' + b.fg.toString(16).padStart(6, '0');
      ctx.globalAlpha = 0.25;
      ctx.fillRect(0, h * 0.10, h, h * 0.035);
      ctx.fillRect(0, h * 0.855, h, h * 0.035);
      ctx.globalAlpha = 1;
      ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(h * 0.24)}px "Arial Hebrew", "Noto Sans Hebrew", sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillText(b.he, h / 2 + h * 0.012, h / 2 + h * 0.016);
      ctx.fillStyle = '#' + b.fg.toString(16).padStart(6, '0');
      ctx.fillText(b.he, h / 2, h / 2);
      ctx.restore();
    });
  });
}

/** UV rect of brand `i` inside the atlas. */
function atlasUV(i) {
  const k = i % 4;
  const u0 = (k % 2) * 0.5, v0 = 1 - (Math.floor(k / 2) + 1) * 0.5;
  return [u0, v0, 0.5, 0.5];
}

// ---------------------------------------------------------------------------
// STANDS, CANOPIES, BUNTING, FLAGS
// ---------------------------------------------------------------------------

/**
 * A striped fabric shade canopy on four poles, appended into shared builders.
 * `fabric` gets the sagging cloth, `timber` the poles.
 */
export function addCanopy(fabric, timber, cx, cy, cz, w, d, h, rotY, rng, stripeOffset = 0, poleHex = 0xb08a58) {
  const co = Math.cos(rotY), si = Math.sin(rotY);
  const px = (lx, lz) => [cx + lx * co - lz * si, cz + lx * si + lz * co];
  const NX = 5, NZ = 3;
  const base = fabric.count;
  for (let iz = 0; iz <= NZ; iz++) {
    for (let ix = 0; ix <= NX; ix++) {
      const fx = ix / NX - 0.5, fz = iz / NZ - 0.5;
      const [x, z] = px(fx * w, fz * d);
      // catenary sag in both directions + a slight forward tilt for run-off
      const sag = (1 - Math.pow(fx * 2, 2)) * (1 - Math.pow(fz * 2, 2));
      const y = cy + h - sag * 0.55 - fz * 0.55;
      // ~0.75 m stripes: finer than that and the canopy turns into moire the
      // moment it is seen at a grazing angle.
      fabric.vert(x, y, z, stripeOffset + ix / NX * (w / 6), iz / NZ * (d / 6));
    }
  }
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const a = base + iz * (NX + 1) + ix;
      fabric.quad(a, a + 1, a + NX + 2, a + NX + 1);
    }
  }
  for (const [lx, lz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    const [x, z] = px(lx * w * 0.94, lz * d * 0.94);
    const ph = h + (lz > 0 ? -0.55 : 0);
    timber.box(x, cy + ph / 2, z, 0.13, ph, 0.13, 0.6, tint(poleHex, rng.range(0.85, 1.1)));
  }
}

/**
 * Terraced grandstand: stepped seating, a striped roof and a crowd. Seat
 * positions are returned so the caller can feed them into the single crowd
 * InstancedMesh instead of building a second one.
 */
export function addGrandstand(structure, fabric, timber, seats, opts, rng) {
  const { x, y, z, rotY, width = 22, rows = 7, q = {} } = opts;
  const pal = opts.pal || { concrete: 0xe4cda4, timber: 0xb08a58 };
  const seatCols = opts.seat || [0xc0603a, 0x2f6f70];
  const co = Math.cos(rotY), si = Math.sin(rotY);
  const px = (lx, lz) => [x + lx * co - lz * si, z + lx * si + lz * co];
  const stepD = 1.25, stepH = 0.52;
  for (let r = 0; r < rows; r++) {
    const lz = -1.2 - r * stepD;
    const h = 0.4 + r * stepH;
    const [cxx, czz] = px(0, lz + stepD / 2);
    structure.box(cxx, y + h / 2, czz, width, h, stepD + 0.04, 0.5,
      tint(pal.concrete, 0.90 + (r % 2) * 0.12), rotY);
    // seat plank
    const [sx2, sz2] = px(0, lz + stepD * 0.1);
    timber.box(sx2, y + h + 0.12, sz2, width * 0.98, 0.16, 0.42, 0.7,
      tint(rng() < 0.5 ? seatCols[0] : seatCols[1], 1), rotY);
    // A half-empty grandstand looks worse than a small one, so seat density
    // falls off far more gently than the global crowd budget does.
    const perRow = Math.max(3, Math.round(width / 0.92 * (0.5 + 0.5 * (q.crowdDensity ?? 1))));
    for (let i = 0; i < perRow; i++) {
      const lx = (i / (perRow - 1) - 0.5) * width * 0.94 + rng.range(-0.14, 0.14);
      const [ppx, ppz] = px(lx, lz + stepD * 0.55 + rng.range(-0.1, 0.1));
      seats.push({ x: ppx, y: y + h + 0.2, z: ppz, s: rng.range(0.9, 1.1) });
    }
  }
  // roof
  const depth = rows * stepD + 2.2;
  const [rcx, rcz] = px(0, -depth / 2);
  const roofY = y + 0.4 + rows * stepH + 2.6;
  addCanopy(fabric, timber, rcx, roofY - 0.4, rcz, width + 1.6, depth, 0.9, rotY, rng, rng.range(0, 2), pal.timber);
  // back wall so the stand has a silhouette from behind
  const [bx, bz] = px(0, -depth - 0.2);
  structure.box(bx, y + (0.4 + rows * stepH) / 2 + 0.6, bz, width + 1.2, 0.4 + rows * stepH + 1.2, 0.5, 0.4,
    tint(pal.concrete, 0.88), rotY);
}

/** A string of bunting triangles hung in a catenary between two points. */
export function addBunting(mb, ax, ay, az, bx, by, bz, rng, sagK = 0.10, opts = {}) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const n = Math.max(4, Math.round(len / 1.5));
  const sag = len * sagK;
  const colors = opts.colors || [0xe8563f, 0xf2a03a, 0xf6d34a, 0x3fa8a0, 0x4776c8, 0xf1efe4];
  // the cord
  for (let i = 0; i < n; i++) {
    const f0 = i / n, f1 = (i + 1) / n;
    const p = f => [ax + dx * f, ay + dy * f - Math.sin(f * Math.PI) * sag, az + dz * f];
    const [x0, y0, z0] = p(f0), [x1, y1, z1] = p(f1);
    const c = tint(0xe8dcc0, 0.9);
    mb.face([[x0, y0 + 0.035, z0], [x1, y1 + 0.035, z1], [x1, y1 - 0.035, z1], [x0, y0 - 0.035, z0]],
      [[0, 0], [1, 0], [1, 1], [0, 1]], c);
    // pennant
    const fm = (f0 + f1) / 2;
    const [mx, my, mz] = p(fm);
    const w = 0.30, h = 0.46;
    const nx = -dz / len, nz = dx / len;
    const col = tint(colors[i % colors.length], rng.range(0.9, 1.1));
    const b0 = mb.count;
    mb.vert(mx - nx * 0 - (dx / len) * w, my, mz - (dz / len) * w, 0, 0, col);
    mb.vert(mx + (dx / len) * w, my, mz + (dz / len) * w, 1, 0, col);
    mb.vert(mx + nx * 0.02, my - h, mz + nz * 0.02, 0.5, 1, col);
    mb.tri(b0, b0 + 1, b0 + 2);
  }
}

/**
 * Distant mesa/dune silhouettes: three rings at increasing distance, each
 * flatter and closer in value to the horizon so fog can finish the job.
 */
export function createFarSilhouettes(centre, horizonColor, rng, opts = {}) {
  const group = new THREE.Group();
  group.name = 'far';
  const mats = [], geos = [];
  const hz = new THREE.Color(horizonColor);
  // THE P0: these rings are measured from the CENTRE of the layout, but a
  // racetrack is not a circle. The oasis loop reaches 270 m from its centre on
  // the west straight, and the first ring sits at 330 x 0.82 = 270 m — so one
  // 50 m mesa landed squarely across the road, with no collision, and karts
  // drove through it. Two independent fixes, because this must never recur:
  //   1. rings start beyond the track's own maximum radius (`minDist`);
  //   2. every blob is rejected outright if its footprint reaches the circuit.
  const spline = opts.spline || null;
  const minDist = opts.minDist ?? 0;
  const probe = new THREE.Vector3();
  const layers = opts.layers || [[330, 52, 0.03, 24], [560, 115, 0.16, 19], [900, 210, 0.40, 14]];
  for (const [dist0, tall, blend, n] of layers) {
    const dist = Math.max(dist0, minDist + tall * 1.6);
    const mb = new MB(false);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.range(-0.2, 0.2);
      const d = dist * rng.range(0.82, 1.3);
      const h = tall * rng.range(0.55, 1.4);
      const rB = h * rng.range(0.7, 1.5);
      const rT = rB * rng.range(0.12, 0.6);
      const cx = centre.x + Math.sin(a) * d, cz = centre.z + Math.cos(a) * d;
      if (spline) {
        const s = spline.closestT(probe.set(cx, 0, cz));
        // rB is the base radius before the 0.9-1.7 stretch, hence the 2x
        if (s.dist < spline.widthAt(s.t) + rB * 2 + 40) continue;
      }
      const sides = 7;
      const b0 = mb.count;
      const rot = rng() * TAU;
      const sx = rng.range(0.9, 1.7), sz = rng.range(0.9, 1.7);
      for (let k = 0; k <= sides; k++) {
        const th = (k / sides) * TAU + rot;
        const jag = 1 + Math.sin(k * 2.3 + i) * 0.12;
        mb.vert(cx + Math.cos(th) * rB * jag * sx, centre.y - h * 0.22, cz + Math.sin(th) * rB * jag * sz, k / sides, 0);
        mb.vert(cx + Math.cos(th) * rT * jag * sx, centre.y - h * 0.22 + h, cz + Math.sin(th) * rT * jag * sz, k / sides, 1);
      }
      for (let k = 0; k < sides; k++) {
        const a0 = b0 + k * 2;
        mb.quad(a0, a0 + 2, a0 + 3, a0 + 1);
      }
      // flat top cap
      const capC = mb.count;
      mb.vert(cx, centre.y - h * 0.22 + h, cz, 0.5, 0.5);
      for (let k = 0; k < sides; k++) mb.tri(capC, b0 + k * 2 + 1, b0 + (k + 1) * 2 + 1);
    }
    const g = mb.geometry(); geos.push(g);
    const col = new THREE.Color(opts.color ?? 0xa05c33).lerp(hz, blend);
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 1, metalness: 0, flatShading: true });
    mats.push(mat);
    const m = new THREE.Mesh(g, mat);
    m.name = 'far-ring' + geos.length;
    group.add(m);
  }
  return { group, dispose() { geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); } };
}

// ---------------------------------------------------------------------------
// MID-GROUND SET — the depth rung between the barrier and the far silhouettes
// ---------------------------------------------------------------------------
//
// Track 1's honest weakness was that the eye jumped from the barrier straight
// to the mesas: nothing lived between ~20 m and ~150 m, so the depth ladder lost
// a rung and the whole scene read flatter than the reference. These three props
// fill it, in a theme-appropriate skin, on every track:
//
//   marshal post   raised deck + roof + two marshals, on the outside of corners
//   tyre stack     the universal "this is a racetrack" object, 8-25 m out
//   paddock hut    a small building with an awning, clustered into paddocks
//
// All three append into builders the caller already commits, so the whole set
// costs ONE extra draw call (the rubber) across the entire lap.

/** A raised marshal post: legs, deck, rail, roof, and two marshals on it. */
export function addMarshalPost(structure, timber, fabric, seats, opts, rng) {
  const { x, y, z, rotY, pal } = opts;
  const co = Math.cos(rotY), si = Math.sin(rotY);
  const px = (lx, lz) => [x + lx * co - lz * si, z + lx * si + lz * co];
  const DECK = 2.35, W = 3.2, D = 2.6;
  const tCol = tint(pal.timber, rng.range(0.9, 1.1));
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const [ax, az] = px(lx * W * 0.42, lz * D * 0.42);
    timber.box(ax, y + DECK / 2, az, 0.16, DECK, 0.16, 0.6, tCol);
  }
  // deck slab + a skirt so it is not a floating plank
  const [cx0, cz0] = px(0, 0);
  timber.box(cx0, y + DECK + 0.09, cz0, W, 0.18, D, 0.6, tCol, rotY);
  structure.box(cx0, y + DECK - 0.14, cz0, W * 0.86, 0.22, D * 0.86, 0.5,
    tint(pal.concrete, 0.92), rotY);
  // rail: three sides, so the track side stays open
  for (const [lx, lz, sx, sz] of [[0, -0.5, W, 0.1], [-0.5, 0, 0.1, D], [0.5, 0, 0.1, D]]) {
    const [ax, az] = px(lx * W, lz * D);
    timber.box(ax, y + DECK + 0.58, az, sx, 0.09, sz, 0.6, tCol, rotY);
    timber.box(ax, y + DECK + 0.95, az, sx, 0.09, sz, 0.6, tCol, rotY);
  }
  // roof
  addCanopy(fabric, timber, cx0, y + DECK + 1.05, cz0, W + 0.5, D + 0.4, 1.5, rotY, rng, rng.range(0, 3));
  // two marshals looking at the track
  for (const lx of [-0.55, 0.5]) {
    const [mx, mz] = px(lx, rng.range(-0.3, 0.3));
    seats.push({ x: mx, y: y + DECK + 0.2, z: mz, s: rng.range(0.98, 1.06) });
  }
}

/** A stack of `n` tyres. Appended to a dedicated vertex-coloured rubber builder. */
export function addTyreStack(mb, x, y, z, n, rng, topHex = 0xd8d3c8) {
  const SIDES = 9, R = 0.56, H = 0.34;
  for (let i = 0; i < n; i++) {
    const cy = y + 0.02 + i * (H - 0.02);
    const wob = 1 - i * 0.02;
    const dark = tint(0x24232a, rng.range(0.8, 1.15));
    const b0 = mb.count;
    for (let k = 0; k <= SIDES; k++) {
      const a = (k / SIDES) * TAU + i * 0.3;
      const cx2 = x + Math.cos(a) * R * wob, cz2 = z + Math.sin(a) * R * wob;
      mb.vert(cx2, cy, cz2, k / SIDES * 2, 0, dark);
      mb.vert(cx2, cy + H, cz2, k / SIDES * 2, 1, dark);
    }
    for (let k = 0; k < SIDES; k++) { const a0 = b0 + k * 2; mb.quad(a0, a0 + 2, a0 + 3, a0 + 1); }
    // top face of the last tyre gets the paddock's colour flash
    if (i === n - 1) {
      const cap = mb.count;
      const col = tint(topHex, rng.range(0.85, 1.1));
      mb.vert(x, cy + H + 0.01, z, 0.5, 0.5, col);
      for (let k = 0; k <= SIDES; k++) {
        const a = (k / SIDES) * TAU + i * 0.3;
        mb.vert(x + Math.cos(a) * R * wob, cy + H + 0.01, z + Math.sin(a) * R * wob, 0.5, 0.5, col);
      }
      for (let k = 0; k < SIDES; k++) mb.tri(cap, cap + 1 + k, cap + 2 + k);
    }
  }
}

/**
 * A small paddock building: walls, a roof slab, an awning over the track-facing
 * side and (where the theme wants it) a lit window band in the glow builder.
 */
export function addPaddockHut(structure, timber, fabric, glow, opts, rng) {
  const { x, y, z, rotY, pal, w = 6.5, d = 4.4, h = 3.2, lit = false } = opts;
  const co = Math.cos(rotY), si = Math.sin(rotY);
  const px = (lx, lz) => [x + lx * co - lz * si, z + lx * si + lz * co];
  structure.box(x, y + h / 2, z, w, h, d, 0.4, tint(pal.concrete, rng.range(0.88, 1.06)), rotY);
  structure.box(x, y + h + 0.16, z, w + 0.7, 0.32, d + 0.7, 0.4, tint(pal.concrete, 1.12), rotY);
  // awning on the +Z face (which the caller points at the track)
  const [ax, az] = px(0, d * 0.5 + 1.1);
  addCanopy(fabric, timber, ax, y + h - 1.5, az, w * 0.9, 2.6, 1.35, rotY, rng, rng.range(0, 3));
  // a stripe of trim so the wall is not one flat slab
  structure.box(x, y + h * 0.62, z, w + 0.14, 0.26, d + 0.14, 0.4, tint(pal.trim, 1.0), rotY);
  if (lit && glow) {
    const [wx, wz] = px(0, d * 0.5 + 0.06);
    const nx = si, nz = -co;   // outward normal of the +Z face
    const hw = w * 0.36, y0 = y + h * 0.52, y1 = y + h * 0.78;
    const col = tint(pal.light, 1);
    glow.face([
      [wx - co * hw, y0, wz - si * hw], [wx + co * hw, y0, wz + si * hw],
      [wx + co * hw, y1, wz + si * hw], [wx - co * hw, y1, wz - si * hw],
    ], [[0, 0], [1, 0], [1, 1], [0, 1]], col);
    void nx; void nz;
  }
}

/**
 * A flat additive decal lying on the ground — the single most useful primitive
 * for a wet night circuit (neon reflected in the tarmac) and for the cloud
 * track's light pooling. `dir` is the direction the streak runs in.
 */
export function addGlowDecal(mb, x, y, z, len, wid, dirX, dirZ, hex, k = 1) {
  const m = Math.hypot(dirX, dirZ) || 1;
  const ux = dirX / m * len * 0.5, uz = dirZ / m * len * 0.5;
  const vx = -dirZ / m * wid * 0.5, vz = dirX / m * wid * 0.5;
  const col = tint(hex, k);
  mb.face([
    [x - ux - vx, y, z - uz - vz], [x + ux - vx, y, z + uz - vz],
    [x + ux + vx, y, z + uz + vz], [x - ux + vx, y, z - uz + vz],
  ], [[0, 0], [1, 0], [1, 1], [0, 1]], col);
}

/** A vertical additive card — sign halo, light shaft, waterfall of light. */
export function addGlowCard(mb, x, y, z, w, h, dirX, dirZ, hex, k = 1) {
  const m = Math.hypot(dirX, dirZ) || 1;
  const ux = -dirZ / m * w * 0.5, uz = dirX / m * w * 0.5;
  const col = tint(hex, k);
  mb.face([
    [x - ux, y, z - uz], [x + ux, y, z + uz],
    [x + ux, y + h, z + uz], [x - ux, y + h, z - uz],
  ], [[0, 0], [1, 0], [1, 1], [0, 1]], col);
}

/** Soft round falloff, used by every additive decal. One texture, one material. */
export function glowTexture(size = 128) {
  return canvasTexture('glowSoft', size, (ctx, S) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.62)');
    g.addColorStop(0.70, 'rgba(255,255,255,0.16)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }, { srgb: false });
}

// ---------------------------------------------------------------------------
// CIRCUIT CITY — towers, holo signage, neon
// ---------------------------------------------------------------------------

/** Facade texture: dark glass with a grid of lit windows. One tile = 28 m. */
export function windowTexture(size = 512) {
  return canvasTexture('cityWindows', size, (ctx, S) => {
    ctx.fillStyle = '#0d1024'; ctx.fillRect(0, 0, S, S);
    const N = 8, cell = S / N;
    // faint vertical mullions
    ctx.fillStyle = 'rgba(120,140,200,0.10)';
    for (let i = 0; i < N; i++) ctx.fillRect(i * cell, 0, 1.5, S);
    const lit = ['#ffd9a0', '#9fe8ff', '#ff9fd0', '#cfd6ff', '#fff2cf'];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const on = rnd() < 0.42;
        const w = cell * 0.62, h = cell * 0.44;
        const ox = x * cell + cell * 0.19, oy = y * cell + cell * 0.28;
        if (on) {
          const c = lit[Math.floor(rnd() * lit.length)];
          ctx.globalAlpha = 0.55 + rnd() * 0.45;
          ctx.fillStyle = c; ctx.fillRect(ox, oy, w, h);
          ctx.globalAlpha = 0.16;
          ctx.fillRect(ox - w * 0.25, oy - h * 0.3, w * 1.5, h * 1.6);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = 'rgba(90,110,170,0.16)';
          ctx.fillRect(ox, oy, w, h);
        }
      }
    }
  }, { wrap: THREE.RepeatWrapping });
}

/**
 * The city that surrounds עיר המעגלים: merged tower blocks on three distance
 * rings, keyed to the horizon so fog does the aerial perspective. Two draw
 * calls total (facades + roof-light beacons ride the same material).
 */
export function createCityBlocks(centre, spline, rng, opts = {}) {
  const mb = new MB(true);
  const hz = new THREE.Color(opts.horizon ?? 0x93395f);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const base = new THREE.Color(opts.color ?? 0x1b1d3a);
  const outward = opts.outward || (() => 1);
  const dens = opts.density ?? 1;

  const tower = (cx, cz, y, h, w, d, blend, rot) => {
    c.copy(base).lerp(hz, blend);
    const col = [c.r, c.g, c.b];
    mb.box(cx, y + h / 2, cz, w, h, d, 1 / 28, col, rot);
    if (rng() < 0.6) {
      const h2 = h * rng.range(0.18, 0.45);
      mb.box(cx, y + h + h2 / 2, cz, w * 0.6, h2, d * 0.6, 1 / 28, col, rot);
    }
    if (rng() < 0.35) mb.box(cx, y + h * 1.1 + 4, cz, 0.6, 8, 0.6, 1 / 28, col, rot);
  };

  // --- band 1: the city crowds the circuit itself --------------------------
  // Fog on this theme is thick (76% at 200 m), so the buildings that actually
  // read have to be BESIDE the track, not on a ring around the layout.
  const nNear = Math.round((opts.near ?? 130) * dens);
  for (let i = 0; i < nNear; i++) {
    const t = rng();
    const side = outward(t) * (rng() < 0.82 ? 1 : -1);
    const w0 = spline.widthAt(t);
    const f = Math.pow(rng(), 0.8);
    const dist = w0 + 26 + f * 150;
    const p = spline.offsetPoint(t, side * dist);
    p.x += rng.gauss() * 12; p.z += rng.gauss() * 12;
    const s = spline.closestT(v.set(p.x, 0, p.z));
    const foot = Math.max(12, 9 + f * 26) * rng.range(0.7, 1.5);
    // never within reach of the road, and never so close it clips the crowd
    if (s.dist < spline.widthAt(s.t) + 22 + foot) continue;
    const h = (14 + f * 90) * rng.range(0.55, 1.7);
    tower(p.x, p.z, p.y - 1, h, foot, foot * rng.range(0.7, 1.4),
      0.06 + f * 0.22, rng() * TAU);
  }

  // --- band 2/3: the skyline behind it -------------------------------------
  for (const [dist0, tall, blend, n] of (opts.rings || [[420, 90, 0.34, 40], [820, 190, 0.62, 30]])) {
    for (let i = 0; i < Math.round(n * dens); i++) {
      const a = (i / n) * TAU + rng.range(-0.14, 0.14);
      const d = dist0 * rng.range(0.8, 1.45);
      const cx = centre.x + Math.sin(a) * d, cz = centre.z + Math.cos(a) * d;
      const h = tall * rng.range(0.45, 1.8);
      const foot = rng.range(14, 34);
      const s = spline.closestT(v.set(cx, 0, cz));
      if (s.dist < spline.widthAt(s.t) + 40 + foot) continue;
      tower(cx, cz, centre.y - 2, h, foot, foot * rng.range(0.7, 1.4), blend, rng() * TAU);
    }
  }

  const g = mb.geometry();
  const tex = windowTexture(opts.texSize ?? 512);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.8,
    vertexColors: true, roughness: 0.5, metalness: 0.3,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'city';
  return { mesh, dispose() { g.dispose(); mat.dispose(); } };
}

/** Holographic sign face: a Hebrew brand glowing on a dark scanlined panel. */
export function holoTexture(size = 512) {
  const B = [
    { he: 'טורבו־בינה', fg: '#7ff2ff', bg: '#0a1030' },
    { he: 'מנוע פרומפט', fg: '#ff86d6', bg: '#160a2e' },
    { he: 'אלגו־גיר', fg: '#a8ff9c', bg: '#07172a' },
    { he: 'ברק אנרגיה', fg: '#ffd76a', bg: '#231032' },
  ];
  return canvasTexture('holoAtlas', size, (ctx, S) => {
    const h = S / 2;
    B.forEach((b, i) => {
      const ox = (i % 2) * h, oy = Math.floor(i / 2) * h;
      ctx.save(); ctx.translate(ox, oy);
      ctx.fillStyle = b.bg; ctx.fillRect(0, 0, h, h);
      // scanlines
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, h, 2);
      // frame
      ctx.strokeStyle = b.fg; ctx.globalAlpha = 0.85; ctx.lineWidth = h * 0.018;
      ctx.strokeRect(h * 0.05, h * 0.10, h * 0.90, h * 0.80);
      ctx.globalAlpha = 1;
      ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(h * 0.23)}px "Arial Hebrew", "Noto Sans Hebrew", sans-serif`;
      ctx.shadowColor = b.fg; ctx.shadowBlur = h * 0.09;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(b.he, h / 2, h * 0.46);
      ctx.shadowBlur = 0;
      ctx.fillStyle = b.fg;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(h * 0.18, h * 0.66, h * 0.64, h * 0.035);
      ctx.fillRect(h * 0.30, h * 0.74, h * 0.40, h * 0.025);
      ctx.restore();
    });
  });
}

// ---------------------------------------------------------------------------
// CLOUD PEAK — floating islands, cloud sea, waterfalls of light
// ---------------------------------------------------------------------------

/**
 * Floating stone islands: a flattened rock cap with a tapering keel underneath,
 * so it reads as a chunk torn out of a mountain rather than as a boulder.
 */
export function createIslandGeometry(rng, seed = 1) {
  const mb = new MB(true);
  const noise = makeNoise2D(seed);
  const SIDES = 11, RINGS = [
    // [radius scale, y, colour lerp]
    [1.00, 0.00, 0.00], [1.04, -0.35, 0.10], [0.92, -1.1, 0.30],
    [0.70, -2.4, 0.55], [0.42, -4.2, 0.78], [0.14, -6.4, 0.95],
  ];
  const top = new THREE.Color(0xece6e2), bot = new THREE.Color(0x2b2940);
  const c = new THREE.Color();
  const jag = [];
  for (let k = 0; k <= SIDES; k++) jag.push(0.72 + fbm(noise, Math.cos(k / SIDES * TAU) * 2, Math.sin(k / SIDES * TAU) * 2, 3) * 0.6);
  const base = mb.count;
  for (const [rs, y, t] of RINGS) {
    for (let k = 0; k <= SIDES; k++) {
      const a = (k / SIDES) * TAU;
      const r = rs * jag[k];
      // sedimentary banding down the flank, plus a per-facet break, so the
      // silhouette is not a smooth beige molar
      const band = 0.5 + 0.5 * Math.sin(y * 2.6 + jag[k] * 5);
      c.copy(top).lerp(bot, clamp01(t * 1.05 + band * 0.16 - 0.08))
        .multiplyScalar(0.9 + ((k * 7) % 5) * 0.045);
      mb.vert(Math.cos(a) * r, y + (t === 0 ? Math.sin(a * 3) * 0.06 : 0), Math.sin(a) * r,
        k / SIDES * 2.5, -y / 2.2, [c.r, c.g, c.b]);
    }
  }
  for (let ri = 0; ri < RINGS.length - 1; ri++) {
    for (let k = 0; k < SIDES; k++) {
      const a0 = base + ri * (SIDES + 1) + k;
      mb.quad(a0, a0 + 1, a0 + SIDES + 2, a0 + SIDES + 1);
    }
  }
  // grassy/lit top cap
  const cap = mb.count;
  const capCol = [top.r * 1.05, top.g * 1.04, top.b * 1.02];
  mb.vert(0, 0.06, 0, 0.5, 0.5, capCol);
  for (let k = 0; k <= SIDES; k++) {
    const a = (k / SIDES) * TAU;
    mb.vert(Math.cos(a) * jag[k], 0.02, Math.sin(a) * jag[k], 0.5, 0.5, capCol);
  }
  for (let k = 0; k < SIDES; k++) mb.tri(cap, cap + 1 + k, cap + 2 + k);
  return mb.geometry();
}

/** Puffy cloud-tops: merged low-poly blobs. One draw call for a whole sea. */
export function createCloudBanks(spots, rng, opts = {}) {
  const mb = new MB(true);
  const base = new THREE.Color(opts.color ?? 0xfdf3ec);
  const shade = new THREE.Color(opts.shade ?? 0xb9b7d4);
  const c = new THREE.Color();
  const geoSrc = new THREE.IcosahedronGeometry(1, 1);
  const p = geoSrc.attributes.position;
  for (const s of spots) {
    const lobes = 4 + Math.floor(rng() * 5);
    for (let l = 0; l < lobes; l++) {
      const ox = rng.gauss() * s.r * 0.75, oz = rng.gauss() * s.r * 0.75;
      const oy = rng.range(-0.06, 0.14) * s.r;
      const rr = s.r * rng.range(0.5, 0.95);
      const b0 = mb.count;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = clamp01(0.42 + y * 0.62);
        c.copy(shade).lerp(base, k);
        mb.vert(s.x + ox + x * rr, s.y + oy + y * rr * 0.34, s.z + oz + z * rr,
          0, 0, [c.r, c.g, c.b]);
      }
      // IcosahedronGeometry is non-indexed (three tris are three vertex triples)
      const idx = geoSrc.index;
      if (idx) for (let i = 0; i < idx.count; i += 3) mb.tri(b0 + idx.getX(i), b0 + idx.getX(i + 1), b0 + idx.getX(i + 2));
      else for (let i = 0; i < p.count; i += 3) mb.tri(b0 + i, b0 + i + 1, b0 + i + 2);
    }
  }
  geoSrc.dispose();
  const g = mb.geometry();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, flatShading: true, fog: true,
    // a cloud is lit from every direction at once; without a little self-light
    // the shaded facets read as grey rock rather than as vapour
    emissive: opts.emissive ?? 0xfdf1ec, emissiveIntensity: opts.emissiveIntensity ?? 0.34,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'clouds';
  return { mesh, dispose() { g.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------
// dressTrack — the whole scenery pass
// ---------------------------------------------------------------------------

/**
 * Per-theme dressing recipe. The SHAPE of the dressing (crowd at corners,
 * stands at the start line, canopies, bunting, a mid-ground paddock every
 * ~110 m) is shared by all three tracks — that is what makes them read as one
 * game. Only the palette, the material tints and the far-field furniture change.
 */
const DRESS = {
  oasis: {
    pal: { concrete: 0xe4cda4, timber: 0xb08a58, trim: 0xc0603a, light: 0xffdca8, rubberTop: 0xd8d3c8 },
    stripes: [0xd94f3d, 0xf5ead6, 0x2f8f8a, 0xf5ead6],
    seat: [0xc0603a, 0x2f6f70],
    far: 0xa8623a, horizon: 0xf8cba1,
    bunting: [0xe8563f, 0xf2a03a, 0xf6d34a, 0x3fa8a0, 0x4776c8, 0xf1efe4],
    veg: true, cliffs: true, pools: true, lit: false,
    accents: [0xffc247, 0xd94f3d, 0x2f8f8a],
  },
  circuit: {
    pal: { concrete: 0x7f869c, timber: 0x99a2b4, trim: 0x39e6ff, light: 0x9fe8ff, rubberTop: 0xff5fae },
    stripes: [0x232a4a, 0x5ce0ff, 0x232a4a, 0xff5fae],
    seat: [0x39406b, 0x7a3f7d],
    far: 0x2a2448, horizon: 0x93395f,
    bunting: [0x39e6ff, 0xff5fae, 0xa06bff, 0x5ce0ff, 0xf1efe4, 0x2f7de0],
    veg: false, cliffs: false, pools: false, lit: true, city: true,
    accents: [0x39e6ff, 0xff5fae, 0xa06bff],
  },
  cloud: {
    pal: { concrete: 0xeae3e6, timber: 0xd6cec6, trim: 0xffc247, light: 0xfff0d0, rubberTop: 0xe38fb0 },
    stripes: [0xf6e7d8, 0xffc247, 0xf6e7d8, 0xe38fb0],
    seat: [0xe0a4b8, 0xc8b6e2],
    far: 0xbfc6e0, horizon: 0xedc9a6,
    bunting: [0xffc247, 0xffe3b0, 0xf6d6e4, 0xffffff, 0xffd88a, 0xe9d7f2],
    veg: false, cliffs: false, pools: false, lit: true, islands: true,
    rock: [0xbfbccb, 0xd3cfd8, 0xa9a6b8, 0xcdc7d2, 0xb6b2c4],
    accents: [0xffd88a, 0xfff3d6, 0xffc247],
  },
};

/**
 * Scatter the whole scenery library along a track.
 *
 * Placement is driven by `curvatureAt` (crowd, canopies and bunting cluster at
 * corners and the start line) and everything scales with
 * `engine.q.propDensity` / `engine.q.crowdDensity`.
 *
 * NOTHING here has collision — the physics only knows the track limit at
 * `widthAt(t)` and the barrier at `widthAt(t)+RUNOFF`. So every placement goes
 * through `clearance()` / `rectClear()` below: a prop that lands on the road is
 * a wall karts drive straight through, which is exactly the bug that shipped on
 * oasis (a 26 m grandstand pitched tangentially at a hairpin, whose far end lay
 * flat across the track 40 m further round the lap).
 *
 * @returns {{group, update(t), dispose()}}
 */
export function dressTrack(trackGroup, spline, def, engine, rng = makeRng(99)) {
  const q = engine?.q || { propDensity: 1, crowdDensity: 1, shadows: true, texSize: 1024, drawDistance: 700 };
  const heightAt = trackGroup?.userData?.heightAt || (() => 0);
  const RUNOFF = trackGroup?.userData?.runoff ?? 5.5;
  const L = spline.length;
  const startT = def.startT ?? 0;
  const dressed = new THREE.Group();
  dressed.name = 'dressing';
  const parts = [], geos = [], mats = [];

  // curvature + start-line "interest" field around the lap
  const NS = 512;
  const interest = new Float32Array(NS);
  const curv = new Float32Array(NS);
  for (let i = 0; i < NS; i++) {
    const t = i / NS;
    let c = 0;
    for (let k = -3; k <= 3; k++) c += spline.curvatureAt(((i + k) / NS % 1 + 1) % 1);
    curv[i] = c / 7;
    const dStart = Math.min(Math.abs(t - startT), 1 - Math.abs(t - startT));
    interest[i] = clamp01(Math.abs(curv[i]) / 0.20) * 0.8
      + Math.exp(-Math.pow(dStart / 0.045, 2)) * 1.0;
  }
  const interestAt = t => interest[Math.floor(((t % 1) + 1) % 1 * NS) % NS];

  const D = DRESS[def.theme] || DRESS.oasis;
  const PAL = D.pal;

  // =========================================================================
  // PLACEMENT CLEARANCE — the guard that keeps scenery off the racing line
  // =========================================================================
  const CW = new THREE.Vector3();
  /** Metres from (x,z) to the track LIMIT (negative = on the road). */
  const clearance = (x, z) => {
    const s = spline.closestT(CW.set(x, 0, z));
    return s.dist - spline.widthAt(s.t);
  };
  /** Is a rotated w x d footprint (centred at local z = zOff) clear by `pad`? */
  const rectClear = (x, z, rotY, w, d, zOff, pad) => {
    const co = Math.cos(rotY), si = Math.sin(rotY);
    for (const fx of [-0.5, -0.25, 0, 0.25, 0.5]) {
      for (const fz of [-0.5, 0, 0.5]) {
        const lx = fx * w, lz = zOff + fz * d;
        if (clearance(x + lx * co - lz * si, z + lx * si + lz * co) < pad) return false;
      }
    }
    return true;
  };

  // =========================================================================
  // CROWD — behind the barriers, densest at corners and the start line
  // =========================================================================
  const seats = [];      // trackside standing crowd (cullable)
  const standSeats = []; // seated crowd on the stands (always kept)
  const crowdBudget = Math.round(1300 * (q.crowdDensity ?? 1));
  {
    const step = 1.6 / L;
    for (let t = 0; t < 1; t += step) {
      const w = spline.widthAt(t);
      const k = interestAt(t);
      const rows = k > 0.62 ? 4 : k > 0.32 ? 2 : k > 0.12 ? 1 : 0;
      if (!rows) continue;
      for (const side of [-1, 1]) {
        // put the crowd on the outside of the corner where there is room
        // sign(curvature) is the INSIDE of the turn (see the note in
        // trackbuild.js); thin crowds go on the outside, where there is room.
        if (rows < 3 && Math.sign(curv[Math.floor(t * NS) % NS]) === side && Math.abs(curv[Math.floor(t * NS) % NS]) > 0.09) continue;
        for (let r = 0; r < rows; r++) {
          if (rng() > 0.68 + k * 0.32) continue;
          const lat = side * (w + RUNOFF + 1.5 + r * 1.15 + rng.range(-0.25, 0.25));
          const p = spline.offsetPoint(t + rng.range(-0.4, 0.4) * step, lat);
          // where the loop doubles back, "1.5 m behind the barrier" at one t is
          // the middle of the road at another
          if (clearance(p.x, p.z) < RUNOFF + 0.8) continue;
          const gy = Math.max(heightAt(p.x, p.z), p.y - 0.35);
          seats.push({ x: p.x, y: gy + 0.05 + r * 0.22, z: p.z, s: rng.range(0.85, 1.12) });
        }
      }
    }
  }

  // =========================================================================
  // GRANDSTANDS at the start/finish + a corner stand
  // =========================================================================
  const structure = new MB(true);      // masonry / concrete
  const timber = new MB(true);         // wood poles, planks
  const fabric = new MB(false);        // striped cloth
  const bunting = new MB(true);
  {
    const standSpots = [
      { t: ((startT + 0.010) % 1 + 1) % 1, side: -1, width: 26, rows: 8 },
      { t: ((startT - 0.014) % 1 + 1) % 1, side: -1, width: 20, rows: 6 },
    ];
    // a stand at the most interesting corner too
    let bestT = 0, best = 0;
    for (let i = 0; i < NS; i++) {
      const dStart = Math.min(Math.abs(i / NS - startT), 1 - Math.abs(i / NS - startT));
      if (dStart < 0.12) continue;
      if (Math.abs(curv[i]) > best) { best = Math.abs(curv[i]); bestT = i / NS; }
    }
    standSpots.push({ t: bestT, side: -(Math.sign(curv[Math.floor(bestT * NS)]) || 1), width: 22, rows: 6 });

    for (const s of standSpots) {
      const rows = Math.max(3, Math.round(s.rows * (q.crowdDensity ?? 1) + 1));
      const depth = rows * 1.25 + 3.4;
      // A grandstand is a 20-26 m SLAB pitched on the tangent at one t. On a
      // tight corner — or anywhere the loop doubles back — its far end swings
      // out over the road further round the lap, and since nothing here has
      // collision that end becomes a wall karts drive through. So: try the
      // nominal spot, then progressively further along and further back, and
      // only build once the whole footprint clears the corridor.
      let placed = null;
      for (const dt of [0, 0.008, -0.008, 0.016, -0.016, 0.026, -0.026, 0.04, -0.04]) {
        for (const extra of [6.5, 9.5, 13.5, 18]) {
          const t = ((s.t + dt) % 1 + 1) % 1;
          const w = spline.widthAt(t);
          const p = spline.offsetPoint(t, s.side * (w + RUNOFF + extra));
          // The stand's seating recedes along local -Z, so local +Z has to point
          // back at the track: that direction is -side * right.
          const r = spline.rightAt(t);
          const rotY = Math.atan2(-s.side * r.x, -s.side * r.z);
          if (!rectClear(p.x, p.z, rotY, s.width + 2.0, depth + 1.4, -depth / 2 + 0.4, RUNOFF + 1.6)) continue;
          placed = { p, rotY };
          break;
        }
        if (placed) break;
      }
      if (!placed) continue;      // nowhere safe: better no stand than a wall
      const { p, rotY } = placed;
      const y = Math.max(heightAt(p.x, p.z), p.y - 0.4);
      addGrandstand(structure, fabric, timber, standSeats, {
        x: p.x, y, z: p.z, rotY, width: s.width, rows, q, pal: PAL, seat: D.seat,
      }, rng);
    }
  }

  // trim the crowd to budget (keep the ones nearest the action)
  let crowdSpots = seats;
  const budget = Math.max(0, crowdBudget - standSeats.length);
  if (seats.length > budget) {
    crowdSpots = [];
    const keepRate = budget / seats.length;
    for (const s of seats) if (rng() < keepRate) crowdSpots.push(s);
  }
  crowdSpots = crowdSpots.concat(standSeats);
  // On the night circuit and above the clouds the crowd is lit by the signage,
  // not by a sun, so it gets a little self-illumination or it reads as a field
  // of grey pebbles.
  const crowd = createCrowd(crowdSpots, rng, q,
    D.lit ? { emissive: def.theme === 'circuit' ? 0x2a3352 : 0x3a3040, emissiveIntensity: 0.55 } : {});
  dressed.add(crowd.group);
  parts.push(crowd);

  /**
   * A light pool lying IN the road plane, built from two spline frames rather
   * than as a flat world-space quad. On a track with real gradient (cloud
   * climbs 17% out of turn 1) a world-flat quad cuts up through the tarmac and
   * is picked up by the obstruction ray-cast as geometry across the road; a
   * frame-built one stays parallel to the surface everywhere.
   */
  const addRoadGlow = (mb, t, lat, len, wid, hex, k) => {
    const dt = (len * 0.5) / L;
    const f0 = spline.frameAt(((t - dt) % 1 + 1) % 1);
    const f1 = spline.frameAt(((t + dt) % 1 + 1) % 1);
    const col = tint(hex, k);
    const pt = (f, l) => [f.pos.x + f.right.x * l, f.pos.y + 0.04, f.pos.z + f.right.z * l];
    mb.face([pt(f0, lat - wid / 2), pt(f1, lat - wid / 2), pt(f1, lat + wid / 2), pt(f0, lat + wid / 2)],
      [[0, 0], [1, 0], [1, 1], [0, 1]], col);
  };

  // The additive-glow builder: neon reflections in wet tarmac, sign halos, lit
  // windows, waterfalls of light. One material, one draw call, whole lap.
  const glow = new MB(true);

  // =========================================================================
  // SHADE CANOPIES over the crowd + BUNTING over the track
  // =========================================================================
  {
    // One canopy per 15 m of interesting track at most: any denser and the
    // sheets interpenetrate and read as crumpled paper rather than as shade.
    const step = 15 / L;
    for (let t = 0; t < 1; t += step) {
      const k = interestAt(t);
      if (k < 0.30 || rng() > 0.45 * (q.propDensity ?? 1) + k * 0.40) continue;
      for (const side of [-1, 1]) {
        if (rng() > 0.5) continue;
        const w = spline.widthAt(t);
        const p = spline.offsetPoint(t, side * (w + RUNOFF + 4.0));
        const tan = spline.tangentAt(t);
        const rotY = Math.atan2(tan.x, tan.z);
        // the canopy runs ALONG the track, so test it in its own frame or the
        // axis-aligned box swallows the barrier and rejects every one of them
        if (!rectClear(p.x, p.z, rotY, 9.4, 5.8, 0, RUNOFF - 1.0)) continue;
        const y = Math.max(heightAt(p.x, p.z), p.y - 0.4);
        addCanopy(fabric, timber, p.x, y, p.z, 9.0, 5.4, 3.75,
          rotY, rng, rng.range(0, 3), PAL.timber);
      }
    }
    // On the two new tracks the strings carry on round the lap, not just over
    // the start straight: a lit cable every ~90 m is what gives a night circuit
    // (and a sky circuit) its sense of a roofed, decorated venue.
    if (D.lit) {
      for (let t = 0; t < 1; t += 88 / L) {
        const w = spline.widthAt(t);
        const a5 = spline.offsetPoint(t, -(w + RUNOFF + 1.0));
        const b5 = spline.offsetPoint(t, (w + RUNOFF + 1.0));
        if (clearance(a5.x, a5.z) < RUNOFF - 0.5 || clearance(b5.x, b5.z) < RUNOFF - 0.5) continue;
        const ay = Math.max(heightAt(a5.x, a5.z), a5.y) + 7.4;
        const by = Math.max(heightAt(b5.x, b5.z), b5.y) + 7.4;
        addBunting(bunting, a5.x, ay, a5.z, b5.x, by, b5.z, rng, 0.026, { colors: D.bunting });
        timber.box(a5.x, (ay + a5.y) / 2, a5.z, 0.18, ay - a5.y, 0.18, 0.6, tint(PAL.timber, 0.8));
        timber.box(b5.x, (by + b5.y) / 2, b5.z, 0.18, by - b5.y, 0.18, 0.6, tint(PAL.timber, 0.8));
        const tan5 = spline.tangentAt(t);
        addGlowCard(glow, a5.x, ay - 0.6, a5.z, 1.6, 1.2, tan5.x, tan5.z, D.accents[0], 0.7);
        addGlowCard(glow, b5.x, by - 0.6, b5.z, 1.6, 1.2, tan5.x, tan5.z, D.accents[1], 0.7);
      }
    }
    // Bunting: strung between poles across the start straight and at corners.
    // 6.8 m at the poles with a shallow sag keeps the lowest point above 5.5 m
    // — well clear of the 4.6 m corridor ceiling the audit enforces.
    const buntSpots = [startT + 0.004, startT + 0.020, startT + 0.036, startT - 0.020];
    for (const bt of buntSpots) {
      const t = ((bt % 1) + 1) % 1;
      const w = spline.widthAt(t);
      const a = spline.offsetPoint(t, -(w + RUNOFF + 1.0));
      const b = spline.offsetPoint(t, (w + RUNOFF + 1.0));
      const ay = Math.max(heightAt(a.x, a.z), a.y) + 6.8;
      const by = Math.max(heightAt(b.x, b.z), b.y) + 6.8;
      addBunting(bunting, a.x, ay, a.z, b.x, by, b.z, rng, 0.030, { colors: D.bunting });
      timber.box(a.x, (ay + a.y) / 2, a.z, 0.16, ay - a.y, 0.16, 0.6, tint(PAL.timber));
      timber.box(b.x, (by + b.y) / 2, b.z, 0.16, by - b.y, 0.16, 0.6, tint(PAL.timber));
    }
  }

  // =========================================================================
  // SPONSOR BOARDS on the barrier
  // =========================================================================
  const boards = new MB(false);
  {
    const step = 26 / L;
    let bi = 0;
    for (let t = 0; t < 1; t += step) {
      if (rng() > 0.75) continue;
      for (const side of [-1, 1]) {
        if (rng() > 0.6) continue;
        const w = spline.widthAt(t);
        const lat = side * (w + RUNOFF - 0.08);
        const t2 = t + 5.0 / L;
        const p0 = spline.offsetPoint(t, lat);
        const p1 = spline.offsetPoint(t2, lat);
        if (clearance(p0.x, p0.z) < RUNOFF - 0.6 || clearance(p1.x, p1.z) < RUNOFF - 0.6) continue;
        const [u0, v0, du, dv] = atlasUV(bi++);
        const yb = p0.y + 0.16, yt = p0.y + 1.28;
        // A viewer standing on the track looks along `side * right`, so their
        // screen-right is `-side * tangent` and u has to increase in exactly
        // that direction. p1 is one tangent-step past p0, hence the swap by
        // side — get it wrong and the Hebrew reads back-to-front, which is the
        // default outcome if you letter a DoubleSide quad and never check the
        // other side of the circuit.
        const [a, b] = side > 0 ? [p0, p1] : [p1, p0];
        boards.face(
          [[a.x, yb, a.z], [b.x, yb, b.z], [b.x, yt, b.z], [a.x, yt, a.z]],
          [[u0, v0], [u0 + du, v0], [u0 + du, v0 + dv], [u0, v0 + dv]], null);
      }
    }
  }

  // =========================================================================
  // CLIFFS, ROCKS, PALMS, SHRUBS
  // =========================================================================
  const density = q.propDensity ?? 1;
  const bounds = spline.bounds;
  const centre = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  /** +1/-1: which side of the track at t points away from the circuit centre. */
  const outwardAt = (t) => {
    const p = spline.positionAt(t), r = spline.rightAt(t);
    return ((p.x - centre.x) * r.x + (p.z - centre.z) * r.z) >= 0 ? 1 : -1;
  };
  const rubber = new MB(true);      // tyre stacks — one draw call for the lap

  if (D.cliffs) {
    // Cliffs always flank the OUTSIDE of the loop — a canyon wall standing in
    // the infield reads as a mistake from any aerial or long corner shot.
    const arcs = [];
    const nArc = 7;
    for (let i = 0; i < nArc; i++) {
      const t0 = (i / nArc + 0.02) % 1;
      const span = 1 / nArc * rng.range(0.5, 0.9);
      arcs.push([t0, (t0 + span) % 1, outwardAt((t0 + span / 2) % 1), rng.range(0.65, 1.35)]);
    }
    const cliffs = createCliffs(spline, arcs, rng, {
      texSize: Math.min(q.texSize || 512, 512), shadows: q.shadows, dist: 52,
      step: density >= 0.9 ? 5 : 9, heightAt,
    });
    dressed.add(cliffs.mesh);
    parts.push(cliffs);
    // a second, much taller and further band builds the mid-far depth layer
    const arcs2 = [];
    for (let i = 0; i < 5; i++) {
      const t0 = (i / 5 + 0.11) % 1;
      const span = 1 / 5 * rng.range(0.5, 0.9);
      arcs2.push([t0, (t0 + span) % 1, outwardAt((t0 + span / 2) % 1), rng.range(0.6, 1.1)]);
    }
    const cliffs2 = createCliffs(spline, arcs2, rng, {
      texSize: Math.min(q.texSize || 512, 512), shadows: false, dist: 300, seed: 991,
      step: 16, color: 0x9c5936, pale: 0xc98f5c, heightAt,
    });
    dressed.add(cliffs2.mesh);
    parts.push(cliffs2);
  }

  const palmSpots = [], rockSpots = [], shrubSpots = [];
  if (D.veg) {
    const nClusters = Math.round(430 * density);
    for (let i = 0; i < nClusters; i++) {
      const t = rng();
      const w = spline.widthAt(t);
      const side = rng.sign();
      const d = w + RUNOFF + 4 + Math.pow(rng(), 1.15) * 190;
      const p = spline.offsetPoint(t, side * d);
      p.x += rng.gauss() * 8; p.z += rng.gauss() * 8;
      const y = heightAt(p.x, p.z);
      // keep the near band clear of big props so the crowd reads
      const near = d < w + RUNOFF + 12;
      const roll = rng();
      if (!near && roll < 0.26) {
        const n = rng.int(2, 5);
        for (let k = 0; k < n; k++) {
          palmSpots.push({
            x: p.x + rng.gauss() * 4.5, z: p.z + rng.gauss() * 4.5,
            y: 0, s: rng.range(0.7, 1.3), r: rng() * TAU,
          });
        }
      } else if (!near && roll < 0.62) {
        const n = rng.int(2, 6);
        for (let k = 0; k < n; k++) {
          rockSpots.push({
            x: p.x + rng.gauss() * 5, z: p.z + rng.gauss() * 5, y: 0,
            s: rng.range(0.9, 4.2), sx: rng.range(0.8, 1.4), sy: rng.range(0.6, 1.2), sz: rng.range(0.8, 1.4),
            r: rng() * TAU,
          });
        }
      } else {
        const n = rng.int(3, 9);
        for (let k = 0; k < n; k++) {
          shrubSpots.push({
            x: p.x + rng.gauss() * 6, z: p.z + rng.gauss() * 6, y: 0,
            s: rng.range(0.5, 1.15), sy: rng.range(0.7, 1.3), r: rng() * TAU,
          });
        }
      }
      void y;
    }
    // Near-ground detail band: dry tufts crowding the foot of the barrier on
    // both faces. This is the layer the player's eye actually passes at 60
    // km/h, and its absence is what makes a procedural track feel like a
    // greybox no matter how good the far silhouettes are.
    const vStep = 2.2 / L;
    for (let t = 0; t < 1; t += vStep) {
      const w = spline.widthAt(t);
      for (const side of [-1, 1]) {
        if (rng() > 0.45 * density) continue;
        const inFront = rng() < 0.45;
        const lat = side * (w + RUNOFF + (inFront ? rng.range(-0.75, -0.15) : rng.range(0.75, 2.6)));
        const p = spline.offsetPoint(t + rng.range(-0.5, 0.5) * vStep, lat);
        shrubSpots.push({
          x: p.x, y: 0, z: p.z, s: rng.range(0.30, 0.62), sy: rng.range(0.8, 1.5), r: rng() * TAU,
          _y: p.y - 0.1,
        });
      }
      // the odd boulder tucked against the wall
      if (rng() < 0.06 * density) {
        const side = rng.sign();
        const p = spline.offsetPoint(t, side * (w + RUNOFF + rng.range(1.0, 3.0)));
        rockSpots.push({
          x: p.x, y: 0, z: p.z, s: rng.range(0.5, 1.3),
          sx: rng.range(0.9, 1.4), sy: rng.range(0.5, 0.9), sz: rng.range(0.9, 1.4), r: rng() * TAU,
          _y: p.y - 0.15,
        });
      }
    }
    // Cluster scatter jitters by up to ~15 m, which is easily enough to drop a
    // boulder on the racing line. Anything that landed inside the barrier line
    // and was not deliberately placed there (`_y`) gets thrown away.
    const onTrack = (s) => spline.closestT(CV.set(s.x, 0, s.z)).dist
      < spline.widthAt(spline.closestT(CV.set(s.x, 0, s.z)).t) + RUNOFF + 1.2;
    for (const arr of [palmSpots, rockSpots, shrubSpots]) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i]._y === undefined && onTrack(arr[i])) { arr.splice(i, 1); continue; }
        arr[i].y = arr[i]._y ?? (heightAt(arr[i].x, arr[i].z) - 0.12);
      }
    }
    // rocks sink a little so they never float on a slope
    for (const s of rockSpots) s.y -= s.s * (s.sy ?? 1) * 0.35;
  }
  const palms = createPalms(palmSpots, rng, q); dressed.add(palms.group); parts.push(palms);
  const rocks = createRocks(rockSpots, rng, q, { colors: D.rock }); dressed.add(rocks.group); parts.push(rocks);
  const shrubs = createShrubs(shrubSpots, rng, q); dressed.add(shrubs.group); parts.push(shrubs);

  // How far the layout itself reaches from its centre — everything "far" has to
  // start beyond this or it lands on the track (see createFarSilhouettes).
  let maxR = 0;
  for (let i = 0; i < 256; i++) {
    const p = spline.positionAt(i / 256);
    maxR = Math.max(maxR, Math.hypot(p.x - centre.x, p.z - centre.z));
  }

  // =========================================================================
  // MID-GROUND — marshal posts, tyre stacks, paddock huts (ALL THREE TRACKS)
  // =========================================================================
  // Track 1's honest weakness was an empty band between the barrier and the
  // cliffs. This is the rung that fills it, and because it rides the builders
  // that are already committed it costs one extra draw call (the rubber).
  {
    // --- tyre stacks at the barrier, thickest on corner exits ---------------
    const tStep = 19 / L;
    for (let t = 0; t < 1; t += tStep) {
      const k = interestAt(t);
      if (rng() > 0.30 + k * 0.5) continue;
      const side = rng.sign();
      const w = spline.widthAt(t);
      const base = spline.offsetPoint(t, side * (w + RUNOFF + 1.5));
      if (clearance(base.x, base.z) < RUNOFF + 1.0) continue;
      const tan = spline.tangentAt(t);
      const nStacks = rng.int(2, 4);
      for (let i = 0; i < nStacks; i++) {
        const off = (i - (nStacks - 1) / 2) * 1.35;
        const px2 = base.x + tan.x * off + rng.range(-0.2, 0.2);
        const pz2 = base.z + tan.z * off + rng.range(-0.2, 0.2);
        const gy = Math.max(heightAt(px2, pz2), base.y - 0.35);
        addTyreStack(rubber, px2, gy, pz2, rng.int(2, 4), rng,
          rng() < 0.4 ? PAL.rubberTop : D.accents[i % D.accents.length]);
      }
    }

    // --- marshal posts, on the outside of the better corners ----------------
    const mStep = 56 / L;
    for (let t = rng() * mStep; t < 1; t += mStep) {
      const i = Math.floor(t * NS) % NS;
      const side = -(Math.sign(curv[i]) || rng.sign());     // outside of the turn
      const w = spline.widthAt(t);
      const r = spline.rightAt(t);
      const rotY = Math.atan2(-side * r.x, -side * r.z);
      let put = null;
      for (const extra of [5.0, 8.0, 12.0]) {
        const p = spline.offsetPoint(t, side * (w + RUNOFF + extra));
        if (rectClear(p.x, p.z, rotY, 5.0, 4.4, 0, RUNOFF + 1.4)) { put = p; break; }
      }
      if (!put) continue;
      const gy = Math.max(heightAt(put.x, put.z), put.y - 0.4);
      addMarshalPost(structure, timber, fabric, standSeats,
        { x: put.x, y: gy, z: put.z, rotY, pal: PAL }, rng);
      if (D.lit) {
        addGlowCard(glow, put.x, gy + 3.9, put.z, 2.6, 1.5,
          Math.cos(rotY), Math.sin(rotY), PAL.light, 0.55);
      }
    }

    // --- paddocks: two or three huts and a service tent, 25-70 m out --------
    const pStep = 72 / L;
    for (let t = rng() * pStep; t < 1; t += pStep) {
      const side = rng.sign();
      const w = spline.widthAt(t);
      const r = spline.rightAt(t);
      const tan = spline.tangentAt(t);
      const rotY = Math.atan2(-side * r.x, -side * r.z) + rng.range(-0.22, 0.22);
      const dist = w + RUNOFF + (D.islands ? rng.range(9, 19) : rng.range(20, 52));
      const anchorP = spline.offsetPoint(t, side * dist);
      const nHut = rng.int(2, 3);
      for (let i = 0; i < nHut; i++) {
        const off = (i - (nHut - 1) / 2) * rng.range(9, 13);
        const back = rng.range(-3, 9);
        const hx = anchorP.x + tan.x * off + r.x * side * back;
        const hz = anchorP.z + tan.z * off + r.z * side * back;
        const ww = rng.range(5.5, 9), dd = rng.range(4, 6.5), hh = rng.range(2.8, 4.2);
        if (!rectClear(hx, hz, rotY, ww + 3, dd + 5, 1.5, RUNOFF + 3)) continue;
        const gy = heightAt(hx, hz) - 0.1;
        addPaddockHut(structure, timber, fabric, glow, {
          x: hx, y: gy, z: hz, rotY: rotY + rng.range(-0.1, 0.1), pal: PAL,
          w: ww, d: dd, h: hh, lit: !!D.lit,
        }, rng);
        // a couple of tyre stacks and two onlookers give it life
        if (rng() < 0.7) {
          const sx2 = hx + Math.cos(rotY) * rng.range(-4, 4);
          const sz2 = hz + Math.sin(rotY) * rng.range(-4, 4);
          addTyreStack(rubber, sx2, heightAt(sx2, sz2) - 0.1, sz2, rng.int(2, 5), rng, D.accents[i % 3]);
        }
        for (let m = 0; m < 2; m++) {
          const mx = hx + Math.cos(rotY + 1.57) * rng.range(-3.5, 3.5) + rng.gauss();
          const mz = hz + Math.sin(rotY + 1.57) * rng.range(-3.5, 3.5) + rng.gauss();
          if (clearance(mx, mz) > RUNOFF + 2) standSeats.push({ x: mx, y: heightAt(mx, mz), z: mz, s: rng.range(0.9, 1.1) });
        }
        // A mast with a banner on it. One thin vertical per paddock is what
        // actually breaks the horizon line and gives the mid-ground a read at
        // 80 m — the huts alone sit below the barrier from a driver's eye.
        if (i === 0) {
          const H2 = rng.range(7.5, 11);
          timber.box(hx + Math.cos(rotY) * (ww * 0.62), gy + H2 / 2, hz + Math.sin(rotY) * (ww * 0.62),
            0.22, H2, 0.22, 0.6, tint(PAL.timber, 0.95));
          const bx2 = hx + Math.cos(rotY) * (ww * 0.62), bz2 = hz + Math.sin(rotY) * (ww * 0.62);
          const fw = 2.6, fh = 2.0;
          const dx2 = Math.cos(rotY + 1.57) * fw, dz2 = Math.sin(rotY + 1.57) * fw;
          const n0 = fabric.count;
          fabric.vert(bx2, gy + H2, bz2, 0, 0);
          fabric.vert(bx2 + dx2, gy + H2 - 0.25, bz2 + dz2, 2, 0);
          fabric.vert(bx2 + dx2, gy + H2 - fh - 0.25, bz2 + dz2, 2, 1.4);
          fabric.vert(bx2, gy + H2 - fh, bz2, 0, 1.4);
          fabric.quad(n0, n0 + 1, n0 + 2, n0 + 3);
          if (D.lit) addGlowCard(glow, bx2, gy + H2 - 0.4, bz2, 1.4, 1.4, dx2, dz2, D.accents[1], 0.7);
        }
      }
    }
  }

  // =========================================================================
  // ROADSIDE LIGHTING — circuit's neon masts, cloud's light pylons
  // =========================================================================
  if (D.lit) {
    const step = (def.theme === 'circuit' ? 27 : 44) / L;
    let idx = 0;
    for (let t = 0; t < 1; t += step) {
      const side = (idx % 2 === 0) ? -1 : 1;
      const hue = D.accents[idx % D.accents.length];
      idx++;
      const w = spline.widthAt(t);
      const r = spline.rightAt(t), tan = spline.tangentAt(t);
      const p = spline.offsetPoint(t, side * (w + RUNOFF + 1.6));
      if (clearance(p.x, p.z) < RUNOFF + 1.0) continue;
      const gy = Math.max(heightAt(p.x, p.z), p.y - 0.3);
      const inx = -side * r.x, inz = -side * r.z;
      if (def.theme === 'circuit') {
        // slim mast, crossarm, lamp head — then the light it throws
        timber.box(p.x, gy + 4.3, p.z, 0.20, 8.6, 0.20, 0.5, tint(PAL.timber, 0.75));
        const ax2 = p.x + inx * 1.5, az2 = p.z + inz * 1.5;
        timber.box(ax2, gy + 8.5, az2, 3.2, 0.16, 0.16, 0.5, tint(PAL.timber, 0.8),
          Math.atan2(inz, inx));
        const hx2 = p.x + inx * 2.9, hz2 = p.z + inz * 2.9;
        addGlowCard(glow, hx2, gy + 8.0, hz2, 2.2, 1.2, tan.x, tan.z, hue, 1.0);
        addGlowCard(glow, hx2, gy + 8.0, hz2, 1.2, 2.2, inx, inz, hue, 0.7);
        // the wet-tarmac reflection: a long streak lying on the road below
        const lx = p.x + inx * (RUNOFF + w * 0.55), lz = p.z + inz * (RUNOFF + w * 0.55);
        // long and narrow: a lamp reflected in wet tarmac is a streak, and a
        // fat soft blob just reads as a stain on the road
        addRoadGlow(glow, t, side * (w * 0.45 + 1.6), 34, 3.0, hue, 0.34);
        addRoadGlow(glow, t, side * (w + RUNOFF + 0.2), 11, 2.6, hue, 0.26);
      } else {
        // cloud: a pale stone pylon with a lit capital and a shaft of light
        structure.box(p.x, gy + 2.1, p.z, 0.7, 4.2, 0.7, 0.5, tint(PAL.concrete, 1.02));
        structure.box(p.x, gy + 4.35, p.z, 1.15, 0.4, 1.15, 0.5, tint(PAL.concrete, 1.12));
        addGlowCard(glow, p.x, gy + 4.6, p.z, 2.0, 2.0, tan.x, tan.z, hue, 0.7);
        addGlowCard(glow, p.x, gy + 4.6, p.z, 2.0, 2.0, inx, inz, hue, 0.45);
        addRoadGlow(glow, t, side * (w + RUNOFF - 0.8), 13, 8, hue, 0.26);
      }
    }
  }

  // =========================================================================
  // ARCHES over the track — the vertical rhythm both new tracks need
  // =========================================================================
  // Legs stand outside the barrier and the beam sits at 8 m, well above the
  // 4.6 m corridor ceiling, so an arch is never something a kart can reach.
  if (D.lit) {
    const nArch = 5;
    for (let k = 0; k < nArch; k++) {
      const t = ((startT + 0.13 + k / nArch) % 1 + 1) % 1;
      const w = spline.widthAt(t);
      const r = spline.rightAt(t), tan = spline.tangentAt(t);
      const span = w + RUNOFF + 1.8;
      const a4 = spline.offsetPoint(t, -span), b4 = spline.offsetPoint(t, span);
      if (clearance(a4.x, a4.z) < RUNOFF + 1.0 || clearance(b4.x, b4.z) < RUNOFF + 1.0) continue;
      const gy = Math.max(heightAt(a4.x, a4.z), heightAt(b4.x, b4.z), a4.y - 0.4);
      const H = 8.4;
      const rotY = Math.atan2(tan.x, tan.z);
      const hue = D.accents[k % D.accents.length];
      for (const pp of [a4, b4]) {
        structure.box(pp.x, gy + H / 2, pp.z, 1.5, H, 1.5, 0.4, tint(PAL.concrete, 1.0), rotY);
        structure.box(pp.x, gy + 0.5, pp.z, 2.4, 1.0, 2.4, 0.4, tint(PAL.concrete, 0.9), rotY);
        addGlowCard(glow, pp.x, gy + H - 1.4, pp.z, 1.9, 2.6, tan.x, tan.z, hue, 0.8);
      }
      // the beam, with a lit soffit facing the track
      const mid = spline.offsetPoint(t, 0);
      const beamLen = span * 2 + 2.4;
      const across = Math.atan2(r.z, r.x);   // local +X -> (cos,sin) == right
      structure.box(mid.x, gy + H + 0.7, mid.z, beamLen, 1.4, 1.9, 0.4, tint(PAL.concrete, 1.08), across);
      structure.box(mid.x, gy + H + 1.9, mid.z, beamLen * 0.8, 0.9, 1.3, 0.4, tint(PAL.trim, 1.0), across);
      for (let i = -3; i <= 3; i++) {
        const pp = spline.offsetPoint(t, i * (span / 3.2));
        addGlowCard(glow, pp.x, gy + H - 0.5, pp.z, 2.2, 1.1, tan.x, tan.z, hue, 0.6);
      }
      addRoadGlow(glow, t, 0, 15, w * 2, hue, 0.22);
    }
  }

  // =========================================================================
  // CIRCUIT CITY — skyline, holographic Hebrew signage
  // =========================================================================
  const signs = new MB(false);
  if (D.city) {
    const city = createCityBlocks(centre, spline, rng, {
      horizon: D.horizon, color: 0x1b1d3a, texSize: Math.min(q.texSize || 512, 512),
      outward: outwardAt, density: Math.max(0.5, density), near: 230,
      rings: [[maxR + 120, 95, 0.34, 56], [maxR + 460, 200, 0.66, 40]],
    });
    dressed.add(city.mesh); parts.push(city);

    // holographic billboards on masts above the barrier
    const step = 62 / L;
    let bi2 = 0;
    for (let t = 0.01; t < 1; t += step) {
      const side = (bi2 % 2 === 0) ? 1 : -1;
      const w = spline.widthAt(t);
      const lat = side * (w + RUNOFF + 2.2);
      const t2 = t + 9.0 / L;
      const p0 = spline.offsetPoint(t, lat), p1 = spline.offsetPoint(t2, lat);
      if (clearance(p0.x, p0.z) < RUNOFF + 1.4 || clearance(p1.x, p1.z) < RUNOFF + 1.4) { bi2++; continue; }
      const k = bi2++ % 4;
      const u0 = (k % 2) * 0.5, v0 = 1 - (Math.floor(k / 2) + 1) * 0.5;
      const gy = Math.max(heightAt(p0.x, p0.z), p0.y - 0.3);
      const yb = gy + 5.0, yt = gy + 9.4;
      const [a2, b2] = side > 0 ? [p0, p1] : [p1, p0];
      signs.face(
        [[a2.x, yb, a2.z], [b2.x, yb, b2.z], [b2.x, yt, b2.z], [a2.x, yt, a2.z]],
        [[u0, v0], [u0 + 0.5, v0], [u0 + 0.5, v0 + 0.5], [u0, v0 + 0.5]], null);
      // masts + halo + the pool of light it throws on the wet track
      const r = spline.rightAt(t), tan = spline.tangentAt(t);
      const hue = D.accents[k % D.accents.length];
      for (const pp of [p0, p1]) timber.box(pp.x, gy + 2.5, pp.z, 0.26, 5.0, 0.26, 0.5, tint(PAL.timber, 0.7));
      const mx2 = (p0.x + p1.x) / 2, mz2 = (p0.z + p1.z) / 2;
      addGlowCard(glow, mx2, gy + 4.4, mz2, 12.5, 6.0, tan.x, tan.z, hue, 0.45);
      const inx = -side * r.x, inz = -side * r.z;
      const tMid = t + 4.5 / L;
      addRoadGlow(glow, tMid, side * (w * 0.3 + 2.2), 42, 5.5, hue, 0.30);
      addRoadGlow(glow, tMid, side * (2.2 - w * 0.25), 30, 2.6, hue, 0.20);
    }
  }

  // =========================================================================
  // CLOUD PEAK — floating islands, waterfalls of light, a sea of cloud
  // =========================================================================
  const islands = [];
  if (D.islands) {
    const geosI = [createIslandGeometry(rng, 11), createIslandGeometry(rng, 22), createIslandGeometry(rng, 33)];
    const rockMaps = rockTexture({ size: Math.min(q.texSize || 512, 512), tint: 0xffffff, bands: 13, contrast: 0.75 });
    for (const tx of Object.values(rockMaps)) if (tx?.isTexture) { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(1, 1); }
    const mat = vcMat({
      roughness: 0.95, map: rockMaps.map, normalMap: rockMaps.normalMap || null,
    });
    const buckets = geosI.map(() => []);
    const cloudSpots = [];
    const nI = Math.round(116 * Math.max(0.5, density));
    for (let i = 0; i < nI; i++) {
      const t = rng();
      const side = rng.sign();
      const w = spline.widthAt(t);
      // Fog eats 73% of the contrast by 300 m on this theme, so the islands
      // that matter are the CLOSE ones. Bias hard toward the near band.
      const far2 = Math.pow(rng(), 1.35);
      const d = w + 78 + far2 * 260;
      const p = spline.offsetPoint(t, side * d);
      p.x += rng.gauss() * 14; p.z += rng.gauss() * 14;
      const sIsl = lerp(12, 54, far2) * rng.range(0.7, 1.5);
      if (clearance(p.x, p.z) < 46 + sIsl * 0.7) continue;
      // A third of them HANG IN THE SKY. This is the shot: from the driver's
      // seat the plateau hides anything below the road, so the islands that
      // actually sell פסגת הענן are the ones silhouetted against the dawn.
      const aloft = far2 > 0.22 && rng() < 0.6;
      const y = aloft
        ? p.y + rng.range(18, 40) + far2 * 70
        : p.y - rng.range(14, 34) - far2 * 44;
      buckets[i % 3].push({ x: p.x, y, z: p.z, s: sIsl, r: rng() * TAU });
      // waterfalls of light spilling off the near ones
      if ((aloft || far2 < 0.5) && rng() < 0.78) {
        const a3 = rng() * TAU;
        const fx = p.x + Math.cos(a3) * sIsl * 0.7, fz = p.z + Math.sin(a3) * sIsl * 0.7;
        const H = aloft ? rng.range(50, 150) : rng.range(26, 90);
        const wF = sIsl * rng.range(0.5, 1.0);
        addGlowCard(glow, fx, y - H, fz, wF, H,
          Math.cos(a3 + 1.57), Math.sin(a3 + 1.57), D.accents[i % 3], 0.9);
        addGlowCard(glow, fx, y - H, fz, wF * 0.5, H,
          Math.cos(a3), Math.sin(a3), D.accents[(i + 1) % 3], 0.6);
        // a column of mist under the fall: additive light alone is invisible
        // against a bright dawn sky, but mist has shape and shadow
        const cols = rng.int(3, 5);
        for (let m2 = 0; m2 < cols; m2++) {
          cloudSpots.push({
            x: fx + rng.gauss() * wF * 0.3, y: y - H * (0.25 + 0.75 * m2 / cols),
            z: fz + rng.gauss() * wF * 0.3, r: wF * rng.range(0.5, 0.95),
          });
        }
        cloudSpots.push({ x: fx, y: y - H - 6, z: fz, r: rng.range(16, 30) });
      }
      if (rng() < 0.35) cloudSpots.push({ x: p.x + rng.gauss() * 30, y: y - rng.range(14, 46), z: p.z + rng.gauss() * 30, r: rng.range(16, 40) });
    }
    const m4i = new THREE.Matrix4(), qti = new THREE.Quaternion(), sci = new THREE.Vector3(), pvi = new THREE.Vector3();
    buckets.forEach((list, i) => {
      if (!list.length) { geosI[i].dispose(); return; }
      const im = new THREE.InstancedMesh(geosI[i], mat, list.length);
      im.name = 'islands' + i;
      im.castShadow = false; im.receiveShadow = !!q.shadows;
      list.forEach((sp2, k) => {
        qti.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sp2.r);
        sci.set(sp2.s, sp2.s * rng.range(0.8, 1.6), sp2.s);
        pvi.set(sp2.x, sp2.y, sp2.z);
        m4i.compose(pvi, qti, sci);
        im.setMatrixAt(k, m4i);
      });
      im.instanceMatrix.needsUpdate = true;
      dressed.add(im); islands.push(im);
    });
    parts.push({ dispose() { geosI.forEach(g => g.dispose()); mat.dispose(); islands.forEach(m => m.dispose()); } });

    // WATERFALLS OF LIGHT off the plateau's own edge — the ones the driver
    // actually sees, 25 m beyond the barrier, pouring into the cloud.
    for (let t = 0; t < 1; t += 46 / L) {
      for (const side of [-1, 1]) {
        if (rng() > 0.5) continue;
        const w2 = spline.widthAt(t);
        const p2 = spline.offsetPoint(t + rng.range(-0.4, 0.4) * (46 / L), side * (w2 + rng.range(24, 31)));
        if (clearance(p2.x, p2.z) < 20) continue;
        const tan2 = spline.tangentAt(t);
        const H = rng.range(34, 78);
        const wide = rng.range(6, 15);
        addGlowCard(glow, p2.x, p2.y - 4 - H, p2.z, wide, H, tan2.x, tan2.z, D.accents[0], 0.9);
        addGlowCard(glow, p2.x, p2.y - 4 - H, p2.z, wide * 0.55, H * 0.7,
          -tan2.z, tan2.x, D.accents[1], 0.5);
        cloudSpots.push({ x: p2.x, y: p2.y - H - 12, z: p2.z, r: rng.range(14, 26) });
      }
    }

    // the cloud sea: a bank curling against the plateau edge all the way round
    // the lap (this is the layer that sells "above the clouds"), then banks
    // under the islands, then a broad ring out at the horizon.
    for (let t = 0; t < 1; t += 26 / L) {
      for (const side of [-1, 1]) {
        if (rng() > 0.75) continue;
        const w2 = spline.widthAt(t);
        const rr = rng.range(20, 46);
        const p2 = spline.offsetPoint(t + rng.range(-0.3, 0.3) * (26 / L),
          side * (w2 + rng.range(64, 150)));
        if (clearance(p2.x, p2.z) < rr + 26) continue;
        cloudSpots.push({ x: p2.x, y: p2.y - rng.range(16, 44), z: p2.z, r: rr });
      }
    }
    const yBase = spline.positionAt(0).y;
    for (let i = 0; i < Math.round(64 * Math.max(0.5, density)); i++) {
      const a3 = rng() * TAU, d = maxR * rng.range(0.7, 1.6) + rng.range(0, 420);
      // half the far banks sit AT eye level so the horizon is a sea of cloud
      // tops rather than an empty pastel band
      // only the TOPS show above the plateau horizon: any higher and the sea
      // of cloud reads as a range of beige mountains
      const hi = rng() < 0.5;
      cloudSpots.push({
        x: centre.x + Math.cos(a3) * d,
        y: yBase - (hi ? rng.range(10, 34) : rng.range(50, 170)),
        z: centre.z + Math.sin(a3) * d, r: rng.range(40, 120),
      });
    }
    // final sweep: no cloud bank may reach the road (they are opaque geometry)
    const safeSpots = cloudSpots.filter(sp2 => clearance(sp2.x, sp2.z) > sp2.r + 22);
    const banks = createCloudBanks(safeSpots, rng, {});
    dressed.add(banks.mesh); parts.push(banks);
  }


  // =========================================================================
  // OASIS POOLS
  // =========================================================================
  const pools = [];
  if (def.theme === 'oasis') {
    const nPools = density >= 0.9 ? 3 : density >= 0.6 ? 2 : 1;
    for (let i = 0; i < nPools; i++) {
      const t = (0.13 + i * 0.31 + rng() * 0.06) % 1;
      const w = spline.widthAt(t);
      const side = rng.sign();
      const d = w + RUNOFF + rng.range(24, 60);
      const p = spline.offsetPoint(t, side * d);
      const pool = createPool(p.x, p.z, rng.range(9, 17), heightAt, rng, q);
      dressed.add(pool.group); parts.push(pool); pools.push(pool);
      // palms crowd the water
      for (let k = 0; k < Math.round(14 * density); k++) {
        const a = rng() * TAU, r = rng.range(12, 26);
        const px = p.x + Math.cos(a) * r, pz = p.z + Math.sin(a) * r;
        palmSpots.push({ x: px, y: heightAt(px, pz) - 0.1, z: pz, s: rng.range(0.85, 1.35), r: rng() * TAU });
      }
    }
    // rebuild palms with the oasis ones included
    palms.dispose();
    dressed.remove(palms.group);
    const palms2 = createPalms(palmSpots, makeRng(31337), q);
    dressed.add(palms2.group);
    parts[parts.indexOf(palms)] = palms2;
  }

  // =========================================================================
  // FAR SILHOUETTES — the outermost rung (circuit uses its skyline instead,
  // cloud uses its island rings and cloud sea)
  // =========================================================================
  if (!D.city && !D.islands) {
    const far = createFarSilhouettes(centre, D.horizon, rng, {
      color: D.far, spline, minDist: maxR + 40,
    });
    dressed.add(far.group); parts.push(far);
  }

  // =========================================================================
  // commit the merged builders
  // =========================================================================
  {
    const stoneMaps = stoneWallTexture({ size: Math.min(q.texSize || 512, 512), tint: 0xffffff, rows: 4, cols: 4 });
    for (const t of Object.values(stoneMaps)) if (t?.isTexture) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); }
    const woodMaps = woodTexture({ size: Math.min(q.texSize || 512, 512), tint: 0xffffff });
    for (const t of Object.values(woodMaps)) if (t?.isTexture) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); }
    const stripes = stripeTexture({ size: 256, colors: D.stripes, count: 4, weave: 0.6 });
    stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping;

    const commit = (mb, mat, name, shadow = true) => {
      if (!mb.count) { mat.dispose(); return; }
      const g = mb.geometry(); geos.push(g); mats.push(mat);
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      m.castShadow = shadow && !!q.shadows;
      m.receiveShadow = !!q.shadows;
      dressed.add(m);
    };
    commit(structure, new THREE.MeshStandardMaterial({
      map: stoneMaps.map, normalMap: stoneMaps.normalMap, vertexColors: true, roughness: 1,
    }), 'stands');
    commit(timber, new THREE.MeshStandardMaterial({
      map: woodMaps.map, normalMap: woodMaps.normalMap, vertexColors: true, roughness: 0.95,
    }), 'timber');
    commit(fabric, new THREE.MeshStandardMaterial({
      map: stripes, roughness: 0.9, side: THREE.DoubleSide,
    }), 'canopies', false);
    commit(bunting, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, side: THREE.DoubleSide,
    }), 'bunting', false);
    const atlas = brandAtlas(Math.min(q.texSize || 512, 512) * 2);
    commit(boards, new THREE.MeshStandardMaterial({
      map: atlas, roughness: 0.85, side: THREE.DoubleSide,
      emissive: D.lit ? 0xffffff : 0x000000, emissiveMap: D.lit ? atlas : null,
      emissiveIntensity: D.lit ? 0.55 : 0,
    }), 'boards', false);
    commit(rubber, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.02,
    }), 'tyres');
    if (signs.count) {
      const holo = holoTexture(Math.min(q.texSize || 512, 512) * 2);
      commit(signs, new THREE.MeshStandardMaterial({
        map: holo, emissiveMap: holo, emissive: 0xffffff, emissiveIntensity: 1.5,
        roughness: 0.4, metalness: 0, side: THREE.FrontSide,
      }), 'holo-signs', false);
    }
    // The additive layer goes last and never writes depth, so it reads as light
    // rather than as glowing plastic. Fog is off: additive + fog brightens the
    // distance instead of fading it.
    if (glow.count) {
      const gtex = glowTexture(128);
      commit(glow, new THREE.MeshBasicMaterial({
        map: gtex, vertexColors: true, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        toneMapped: false,
      }), 'glow', false);
      const gm = dressed.getObjectByName('glow');
      if (gm) gm.renderOrder = 6;
    }
  }

  trackGroup.add(dressed);

  return {
    group: dressed,
    crowdCount: crowdSpots.length,
    update(t) {
      crowd.update(t);
      for (const p of pools) p.update(t);
    },
    dispose() {
      for (const p of parts) p.dispose?.();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      dressed.clear();
    },
  };
}

// ===========================================================================
// PREVIEW — the library laid out for inspection
// ===========================================================================

export function preview(engine) {
  const q = engine.q;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0c49a);
  scene.fog = new THREE.FogExp2(0xf8cba1, 0.0016);
  const rng = makeRng(4242);
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 2000);
  camera.position.set(0, 9, 34);
  camera.lookAt(0, 3.2, -4);

  const sun = new THREE.DirectionalLight(0xffd3a0, 2.2);
  sun.position.set(-40, 26, 30);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9cbdf2, 0xa5714a, 0.7));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: 0xc9a173, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const parts = [];
  const heightAt = () => 0;

  const palms = createPalms(
    Array.from({ length: 7 }, (_, i) => ({ x: -26 + i * 3.4, y: 0, z: -6, s: 0.9, r: i })), rng, q);
  scene.add(palms.group); parts.push(palms);

  const rocks = createRocks(
    Array.from({ length: 10 }, (_, i) => ({ x: -12 + i * 2.6, y: -0.6, z: 4, s: 1.6, r: i * 1.7 })), rng, q);
  scene.add(rocks.group); parts.push(rocks);

  const shrubs = createShrubs(
    Array.from({ length: 14 }, (_, i) => ({ x: -16 + i * 2.4, y: 0, z: 10, s: 1.4, r: i })), rng, q);
  scene.add(shrubs.group); parts.push(shrubs);

  const pool = createPool(26, -14, 12, heightAt, rng, q);
  scene.add(pool.group); parts.push(pool);

  const crowdSpots = [];
  for (let i = 0; i < 220; i++) {
    crowdSpots.push({ x: -20 + (i % 40) * 1.0, y: 0, z: 15 + Math.floor(i / 40) * 1.1, s: 1 });
  }
  const crowd = createCrowd(crowdSpots, rng, q);
  scene.add(crowd.group); parts.push(crowd);

  const fabric = new MB(false), timber = new MB(true), bunting = new MB(true);
  const structure = new MB(true), seats = [];
  addGrandstand(structure, fabric, timber, seats, { x: 22, y: 0, z: 16, rotY: 0.3, width: 20, rows: 6, q }, rng);
  addCanopy(fabric, timber, -30, 0, 14, 8, 5, 3.2, 0.2, rng);
  addBunting(bunting, -34, 6, 2, 34, 6, 2, rng);
  const stands = createCrowd(seats, rng, q);
  scene.add(stands.group); parts.push(stands);

  const stripes = stripeTexture({ size: 256, colors: [0xd94f3d, 0xf5ead6, 0x2f8f8a, 0xf5ead6], count: 8 });
  stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping;
  const woodMaps = woodTexture({ size: 512, tint: 0xffffff });
  const stoneMaps = stoneWallTexture({ size: 512, tint: 0xffffff, rows: 4, cols: 4 });
  for (const maps of [woodMaps, stoneMaps]) for (const t of Object.values(maps)) if (t?.isTexture) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); }
  const meshes = [
    new THREE.Mesh(fabric.geometry(), new THREE.MeshStandardMaterial({ map: stripes, side: THREE.DoubleSide, roughness: 0.9 })),
    new THREE.Mesh(timber.geometry(), new THREE.MeshStandardMaterial({ map: woodMaps.map, vertexColors: true, roughness: 0.95 })),
    new THREE.Mesh(bunting.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 })),
    new THREE.Mesh(structure.geometry(), new THREE.MeshStandardMaterial({ map: stoneMaps.map, vertexColors: true, roughness: 1 })),
  ];
  meshes.forEach(m => scene.add(m));

  let t = 0;
  return {
    scene, camera,
    update(dt) { t += dt; crowd.update(t); stands.update(t); pool.update(t); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() {
      parts.forEach(p => p.dispose?.());
      meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
      ground.geometry.dispose(); ground.material.dispose();
    },
  };
}

/**
 * The crowd on its own, close enough to judge: a block of spectators seen at
 * mid distance, with the cheer envelope re-fired every couple of seconds so a
 * still frame catches the stand mid-roar. The bob archetypes and the waved
 * flags only fully read in motion — this is the best a PNG can do.
 */
export function previewCrowd(engine) {
  const q = engine.q;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0c49a);
  scene.fog = new THREE.FogExp2(0xf8cba1, 0.0022);
  const rng = makeRng(9182);
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 800);
  camera.position.set(0, 4.2, 17);
  camera.lookAt(0, 1.6, -2);

  const sun = new THREE.DirectionalLight(0xffd3a0, 2.4);
  sun.position.set(-30, 22, 26);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9cbdf2, 0xa5714a, 0.75));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0xc9a173, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Terraced rows so the back of the crowd is visible over the front.
  const spots = [];
  const rows = 7, per = 34;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < per; i++) {
      spots.push({
        x: (i / (per - 1) - 0.5) * 26 + rng.range(-0.18, 0.18),
        y: r * 0.52,
        z: -2 - r * 1.25 + rng.range(-0.12, 0.12),
        s: rng.range(0.92, 1.06),
      });
    }
  }
  const crowd = createCrowd(spots, rng, q);
  scene.add(crowd.group);

  let t = 0, nextCheer = 0.6;
  return {
    scene, camera,
    update(dt) {
      t += dt;
      // re-fire so any capture time past ~0.7s lands inside a roar
      if (t >= nextCheer) { crowd.cheer(1, 2.4); nextCheer = t + 2.6; }
      crowd.update(t);
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() {
      crowd.dispose();
      ground.geometry.dispose(); ground.material.dispose();
    },
  };
}

void CV; void sstep; void lerp;

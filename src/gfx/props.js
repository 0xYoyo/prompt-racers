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

/**
 * Hundreds of stylised capsule spectators as two InstancedMeshes (bodies +
 * heads). Never a face, never a per-person draw call.
 *
 * @param {Array<{x,y,z,s?}>} spots
 * @returns {{group, update(t), dispose()}}
 */
export function createCrowd(spots, rng, q = {}) {
  const n = spots.length;
  const group = new THREE.Group();
  group.name = 'crowd';
  if (!n) return { group, update() { }, dispose() { } };

  const bodyGeo = new THREE.CapsuleGeometry(0.19, 0.42, 3, 7);
  bodyGeo.translate(0, 0.40, 0);
  const headGeo = new THREE.SphereGeometry(0.145, 7, 5);
  headGeo.translate(0, 0.86, 0);

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const bodies = new THREE.InstancedMesh(bodyGeo, mat, n);
  const heads = new THREE.InstancedMesh(headGeo, mat, n);
  bodies.castShadow = heads.castShadow = !!q.shadows;
  bodies.name = 'crowd-bodies'; heads.name = 'crowd-heads';

  const base = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const amp = new Float32Array(n);
  const scl = new Float32Array(n);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();

  for (let i = 0; i < n; i++) {
    const s = spots[i];
    base[i * 3] = s.x; base[i * 3 + 1] = s.y; base[i * 3 + 2] = s.z;
    phase[i] = rng() * TAU;
    amp[i] = rng.range(0.035, 0.13);
    scl[i] = (s.s ?? 1) * rng.range(0.86, 1.16);
    col.setHex(rng.pick(SHIRT)).multiplyScalar(rng.range(0.86, 1.08));
    bodies.setColorAt(i, col);
    col.setHex(rng() < 0.30 ? rng.pick(HAT) : rng.pick(SKIN)).multiplyScalar(rng.range(0.9, 1.06));
    heads.setColorAt(i, col);
    // initial matrices so a t=0 screenshot is already correct
    m4.makeScale(scl[i], scl[i], scl[i]);
    m4.setPosition(s.x, s.y, s.z);
    bodies.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);
  }
  bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
  bodies.instanceColor.needsUpdate = heads.instanceColor.needsUpdate = true;
  group.add(bodies, heads);

  const bm = bodies.instanceMatrix.array, hm = heads.instanceMatrix.array;
  return {
    group,
    /** Gentle idle bob — writes only the 3 translation floats per instance. */
    update(t) {
      for (let i = 0; i < n; i++) {
        const y = base[i * 3 + 1] + Math.abs(Math.sin(t * 2.1 + phase[i])) * amp[i];
        const o = i * 16;
        bm[o + 13] = y; hm[o + 13] = y;
      }
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
    },
    dispose() { bodyGeo.dispose(); headGeo.dispose(); mat.dispose(); bodies.dispose(); heads.dispose(); },
  };
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
export function createRocks(spots, rng, q = {}) {
  const group = new THREE.Group();
  group.name = 'rocks';
  if (!spots.length) return { group, dispose() { } };
  const variants = 5;
  const geos = [];
  for (let i = 0; i < variants; i++) {
    geos.push(createRockGeometry(rng, {
      detail: i < 3 ? 2 : 1,
      color: [0xb06a3e, 0xa25c38, 0xc07f4c, 0x96543a, 0xb8763f][i],
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
export function addCanopy(fabric, timber, cx, cy, cz, w, d, h, rotY, rng, stripeOffset = 0) {
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
    timber.box(x, cy + ph / 2, z, 0.13, ph, 0.13, 0.6, tint(0xb08a58, rng.range(0.85, 1.1)));
  }
}

/**
 * Terraced grandstand: stepped seating, a striped roof and a crowd. Seat
 * positions are returned so the caller can feed them into the single crowd
 * InstancedMesh instead of building a second one.
 */
export function addGrandstand(structure, fabric, timber, seats, opts, rng) {
  const { x, y, z, rotY, width = 22, rows = 7, q = {} } = opts;
  const co = Math.cos(rotY), si = Math.sin(rotY);
  const px = (lx, lz) => [x + lx * co - lz * si, z + lx * si + lz * co];
  const stepD = 1.25, stepH = 0.52;
  for (let r = 0; r < rows; r++) {
    const lz = -1.2 - r * stepD;
    const h = 0.4 + r * stepH;
    const [cxx, czz] = px(0, lz + stepD / 2);
    structure.box(cxx, y + h / 2, czz, width, h, stepD + 0.04, 0.5,
      tint(0xe4cda4, 0.90 + (r % 2) * 0.12), rotY);
    // seat plank
    const [sx2, sz2] = px(0, lz + stepD * 0.1);
    timber.box(sx2, y + h + 0.12, sz2, width * 0.98, 0.16, 0.42, 0.7,
      tint(rng() < 0.5 ? 0xc0603a : 0x2f6f70, 1), rotY);
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
  addCanopy(fabric, timber, rcx, roofY - 0.4, rcz, width + 1.6, depth, 0.9, rotY, rng, rng.range(0, 2));
  // back wall so the stand has a silhouette from behind
  const [bx, bz] = px(0, -depth - 0.2);
  structure.box(bx, y + (0.4 + rows * stepH) / 2 + 0.6, bz, width + 1.2, 0.4 + rows * stepH + 1.2, 0.5, 0.4,
    tint(0xdcc39a, 0.94), rotY);
}

/** A string of bunting triangles hung in a catenary between two points. */
export function addBunting(mb, ax, ay, az, bx, by, bz, rng, sagK = 0.10) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const n = Math.max(4, Math.round(len / 1.5));
  const sag = len * sagK;
  const colors = [0xe8563f, 0xf2a03a, 0xf6d34a, 0x3fa8a0, 0x4776c8, 0xf1efe4];
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
  // Each ring is flatter, taller and closer in value to the horizon than the
  // last — the cheapest depth cue there is, and fog finishes the job.
  const layers = opts.layers || [[330, 52, 0.03, 24], [560, 115, 0.16, 19], [900, 210, 0.40, 14]];
  for (const [dist, tall, blend, n] of layers) {
    const mb = new MB(false);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.range(-0.2, 0.2);
      const d = dist * rng.range(0.82, 1.3);
      const h = tall * rng.range(0.55, 1.4);
      const rB = h * rng.range(0.7, 1.5);
      const rT = rB * rng.range(0.12, 0.6);
      const cx = centre.x + Math.sin(a) * d, cz = centre.z + Math.cos(a) * d;
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
    group.add(new THREE.Mesh(g, mat));
  }
  return { group, dispose() { geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); } };
}

// ---------------------------------------------------------------------------
// dressTrack — the whole scenery pass
// ---------------------------------------------------------------------------

/**
 * Scatter the whole scenery library along a track.
 *
 * Placement is driven by `curvatureAt` (crowd, canopies and bunting cluster at
 * corners and the start line) and everything scales with
 * `engine.q.propDensity` / `engine.q.crowdDensity`.
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
      const w = spline.widthAt(s.t);
      const p = spline.offsetPoint(s.t, s.side * (w + RUNOFF + 6.5));
      // The stand's seating recedes along local -Z, so local +Z has to point
      // back at the track: that direction is -side * right.
      const r = spline.rightAt(s.t);
      const rotY = Math.atan2(-s.side * r.x, -s.side * r.z);
      const y = Math.max(heightAt(p.x, p.z), p.y - 0.4);
      addGrandstand(structure, fabric, timber, standSeats, {
        x: p.x, y, z: p.z, rotY, width: s.width,
        rows: Math.max(3, Math.round(s.rows * (q.crowdDensity ?? 1) + 1)), q,
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
  const crowd = createCrowd(crowdSpots, rng, q);
  dressed.add(crowd.group);
  parts.push(crowd);

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
        const y = Math.max(heightAt(p.x, p.z), p.y - 0.4);
        addCanopy(fabric, timber, p.x, y, p.z, 9.0, 5.4, 3.75,
          Math.atan2(tan.x, tan.z), rng, rng.range(0, 3));
      }
    }
    // bunting: strung between poles across the start straight and at corners
    const buntSpots = [startT + 0.004, startT + 0.020, startT + 0.036, startT - 0.020];
    for (const bt of buntSpots) {
      const t = ((bt % 1) + 1) % 1;
      const w = spline.widthAt(t);
      const a = spline.offsetPoint(t, -(w + RUNOFF + 1.0));
      const b = spline.offsetPoint(t, (w + RUNOFF + 1.0));
      const ay = Math.max(heightAt(a.x, a.z), a.y) + 5.4;
      const by = Math.max(heightAt(b.x, b.z), b.y) + 5.4;
      addBunting(bunting, a.x, ay, a.z, b.x, by, b.z, rng, 0.055);
      timber.box(a.x, (ay + a.y) / 2, a.z, 0.16, ay - a.y, 0.16, 0.6, tint(0xb08a58));
      timber.box(b.x, (by + b.y) / 2, b.z, 0.16, by - b.y, 0.16, 0.6, tint(0xb08a58));
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
  {
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
  {
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
  const rocks = createRocks(rockSpots, rng, q); dressed.add(rocks.group); parts.push(rocks);
  const shrubs = createShrubs(shrubSpots, rng, q); dressed.add(shrubs.group); parts.push(shrubs);

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
  // FAR SILHOUETTES
  // =========================================================================
  {
    const far = createFarSilhouettes(centre, 0xf8cba1, rng, {
      color: def.theme === 'circuit' ? 0x2a2448 : def.theme === 'cloud' ? 0x7d7f9a : 0xa8623a,
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
    const stripes = stripeTexture({
      size: 256, colors: [0xd94f3d, 0xf5ead6, 0x2f8f8a, 0xf5ead6], count: 4, weave: 0.6,
    });
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
    }), 'boards', false);
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

void CV; void sstep; void lerp;

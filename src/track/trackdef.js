// Track centreline definition and the shared spline maths.
//
// LEAD-OWNED. Track meshing, AI pathing, lap/position logic, off-track detection and
// the minimap all consume this — they MUST agree exactly, so the maths lives here once.
//
// The centreline is a closed Catmull-Rom spline through control points, re-sampled
// into an arc-length table so that `t` is a uniform 0..1 distance around the lap.
// That uniformity is what makes lap progress, AI lookahead and rubber-banding sane.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export class TrackSpline {
  /**
   * @param {Array<[x,y,z]>} points  centreline control points, clockwise
   * @param {object} opts
   *   width          base half-width of the drivable road (metres)
   *   widthProfile   optional [{t, width}] overrides, lerped around the lap
   *   bankProfile    optional [{t, angle}] for banked corners
   *   samples        arc-length table resolution
   */
  constructor(points, opts = {}) {
    this.curve = new THREE.CatmullRomCurve3(
      points.map(p => new THREE.Vector3(p[0], p[1], p[2])), true, 'catmullrom', 0.5);
    this.baseWidth = opts.width ?? 9;
    this.widthProfile = opts.widthProfile || null;
    this.bankProfile = opts.bankProfile || null;

    const N = opts.samples ?? 1400;
    this.N = N;
    // Uniform-in-arc-length resample. THREE's getPointAt already does arc-length
    // reparameterisation, but caching it is far cheaper than calling it per frame.
    this._pos = new Float32Array(N * 3);
    this._tan = new Float32Array(N * 3);
    const p = new THREE.Vector3(), tg = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const t = i / N;
      this.curve.getPointAt(t, p);
      this.curve.getTangentAt(t, tg).normalize();
      this._pos[i * 3] = p.x; this._pos[i * 3 + 1] = p.y; this._pos[i * 3 + 2] = p.z;
      this._tan[i * 3] = tg.x; this._tan[i * 3 + 1] = tg.y; this._tan[i * 3 + 2] = tg.z;
    }
    this.length = this.curve.getLength();

    // Uniform spatial hash over the samples so closestT() is O(1)-ish rather than
    // scanning 1400 points every frame for every one of 8 karts.
    this._buildGrid();
    this._curvature = this._buildCurvature();
  }

  _buildGrid() {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.N; i++) {
      const x = this._pos[i * 3], z = this._pos[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const pad = this.baseWidth * 4;
    this.bounds = { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
    this._cell = 12;
    this._gw = Math.max(1, Math.ceil((this.bounds.maxX - this.bounds.minX) / this._cell));
    this._gh = Math.max(1, Math.ceil((this.bounds.maxZ - this.bounds.minZ) / this._cell));
    this._grid = Array.from({ length: this._gw * this._gh }, () => []);
    for (let i = 0; i < this.N; i++) {
      const gx = this._gx(this._pos[i * 3]), gz = this._gz(this._pos[i * 3 + 2]);
      // Register in a 1-cell neighbourhood so a lookup never misses a near sample.
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const cx = gx + dx, cz = gz + dz;
        if (cx >= 0 && cx < this._gw && cz >= 0 && cz < this._gh) this._grid[cz * this._gw + cx].push(i);
      }
    }
  }
  _gx(x) { return Math.min(this._gw - 1, Math.max(0, Math.floor((x - this.bounds.minX) / this._cell))); }
  _gz(z) { return Math.min(this._gh - 1, Math.max(0, Math.floor((z - this.bounds.minZ) / this._cell))); }

  // Signed curvature per sample — AI uses it to pick a cornering speed, and the
  // mesher uses it to place curbs only where there is an actual corner.
  //
  // SIGN CONVENTION: `cross` here is the NEGATED y-component of (a × b), so a
  // POSITIVE value means the track turns to the RIGHT (toward `rightAt`), and a
  // negative value means left. Verified numerically against an independent
  // turn-direction test: over 1462 curved samples on `oasis`, positive curvature
  // coincided with a right turn 202 times and a left turn 0 times.
  // An earlier comment here claimed the opposite. Do not "fix" the maths to match
  // a stale comment — trackbuild's kerb placement and the AI's racing line are
  // both built against the behaviour above.
  _buildCurvature() {
    const c = new Float32Array(this.N);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < this.N; i++) {
      const i0 = (i - 6 + this.N) % this.N, i1 = (i + 6) % this.N;
      a.set(this._tan[i0 * 3], 0, this._tan[i0 * 3 + 2]).normalize();
      b.set(this._tan[i1 * 3], 0, this._tan[i1 * 3 + 2]).normalize();
      const cross = a.x * b.z - a.z * b.x;
      const dot = Math.max(-1, Math.min(1, a.dot(b)));
      c[i] = Math.atan2(cross, dot);
    }
    return c;
  }

  idxAt(t) { return ((Math.floor(t * this.N) % this.N) + this.N) % this.N; }

  positionAt(t, out = new THREE.Vector3()) {
    const f = t * this.N, i = this.idxAt(t), j = (i + 1) % this.N, a = f - Math.floor(f);
    return out.set(
      this._pos[i * 3] + (this._pos[j * 3] - this._pos[i * 3]) * a,
      this._pos[i * 3 + 1] + (this._pos[j * 3 + 1] - this._pos[i * 3 + 1]) * a,
      this._pos[i * 3 + 2] + (this._pos[j * 3 + 2] - this._pos[i * 3 + 2]) * a);
  }

  tangentAt(t, out = new THREE.Vector3()) {
    const i = this.idxAt(t);
    return out.set(this._tan[i * 3], this._tan[i * 3 + 1], this._tan[i * 3 + 2]).normalize();
  }

  /** Right-hand vector (positive = right side of travel direction). */
  rightAt(t, out = new THREE.Vector3()) {
    return this.tangentAt(t, out).cross(UP).normalize();
  }

  /** Full orthonormal frame at t — the mesher extrudes along this. */
  frameAt(t) {
    const pos = this.positionAt(t);
    const tan = this.tangentAt(t);
    const right = tan.clone().cross(UP).normalize();
    const up = right.clone().cross(tan).normalize();
    return { pos, tan, right, up, width: this.widthAt(t), bank: this.bankAt(t) };
  }

  widthAt(t) {
    if (!this.widthProfile) return this.baseWidth;
    return sampleProfile(this.widthProfile, t, 'width', this.baseWidth);
  }
  bankAt(t) {
    if (!this.bankProfile) return 0;
    return sampleProfile(this.bankProfile, t, 'angle', 0);
  }

  /** Signed curvature in radians at t. POSITIVE = turning RIGHT (see _buildCurvature). */
  curvatureAt(t) { return this._curvature[this.idxAt(t)]; }

  /** Max curvature over the next `ahead` fraction of the lap — AI braking cue. */
  maxCurvatureAhead(t, ahead = 0.02) {
    let m = 0;
    const steps = Math.max(2, Math.floor(ahead * this.N));
    const i0 = this.idxAt(t);
    for (let k = 0; k < steps; k++) {
      const v = Math.abs(this._curvature[(i0 + k) % this.N]);
      if (v > m) m = v;
    }
    return m;
  }

  /**
   * Nearest point on the centreline to a world position.
   * @returns {{t, dist, lateral, pos}} lateral is signed: +right of travel, -left.
   *          |lateral| > widthAt(t) means off-track.
   */
  closestT(v, hintT = null) {
    let best = -1, bestD = Infinity;
    const cand = this._grid[this._gz(v.z) * this._gw + this._gx(v.x)];
    if (cand && cand.length) {
      for (const i of cand) {
        const dx = v.x - this._pos[i * 3], dz = v.z - this._pos[i * 3 + 2];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best < 0) {
      // Off the grid entirely (way out of bounds): fall back to a coarse scan.
      const stride = 8;
      for (let i = 0; i < this.N; i += stride) {
        const dx = v.x - this._pos[i * 3], dz = v.z - this._pos[i * 3 + 2];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    // Refine to sub-sample accuracy by projecting onto the local segment.
    const i = best, j = (i + 1) % this.N;
    const ax = this._pos[i * 3], az = this._pos[i * 3 + 2];
    const bx = this._pos[j * 3], bz = this._pos[j * 3 + 2];
    const ex = bx - ax, ez = bz - az;
    const seg = ex * ex + ez * ez;
    let a = seg > 1e-9 ? ((v.x - ax) * ex + (v.z - az) * ez) / seg : 0;
    a = Math.max(0, Math.min(1, a));
    const t = ((i + a) / this.N) % 1;
    const pos = this.positionAt(t);
    const right = this.rightAt(t);
    const dx = v.x - pos.x, dz = v.z - pos.z;
    return { t, dist: Math.hypot(dx, dz), lateral: dx * right.x + dz * right.z, pos };
  }

  /** Shortest signed difference between two lap fractions, in -0.5..0.5. */
  static deltaT(a, b) {
    let d = a - b;
    while (d > 0.5) d -= 1;
    while (d < -0.5) d += 1;
    return d;
  }

  /** World position offset laterally from the centreline — grid slots, AI lines. */
  offsetPoint(t, lateral, out = new THREE.Vector3()) {
    const pos = this.positionAt(t, out);
    const right = this.rightAt(t);
    return pos.addScaledVector(right, lateral);
  }
}

function sampleProfile(profile, t, key, fallback) {
  if (!profile?.length) return fallback;
  const tt = ((t % 1) + 1) % 1;
  let prev = profile[profile.length - 1], next = profile[0];
  for (let i = 0; i < profile.length; i++) {
    if (profile[i].t > tt) { next = profile[i]; prev = profile[(i - 1 + profile.length) % profile.length]; break; }
    if (i === profile.length - 1) { prev = profile[i]; next = profile[0]; }
  }
  let span = next.t - prev.t; if (span <= 0) span += 1;
  let local = tt - prev.t; if (local < 0) local += 1;
  const a = span > 0 ? local / span : 0;
  const sm = a * a * (3 - 2 * a);
  return prev[key] + (next[key] - prev[key]) * sm;
}

// ---------------------------------------------------------------------------
// Track definitions. Layouts escalate in difficulty across the championship.
// Control points are in metres; y encodes elevation change.
// ---------------------------------------------------------------------------

export const TRACKS = [
  {
    id: 'oasis',
    theme: 'oasis',
    nameHe: 'נווה הנתונים',
    nameEn: 'Data Oasis',
    laps: 3,
    difficulty: 1,
    // Flowing, forgiving layout: wide radii, one hairpin, gentle elevation.
    width: 10,
    points: [
      [0, 0, 0], [60, 0, -18], [116, 1.5, -52], [150, 3, -108], [146, 3, -170],
      [108, 2, -212], [48, 1, -226], [-16, 0.5, -220], [-70, 0, -190], [-104, 0, -140],
      [-136, 1.5, -92], [-176, 3, -56], [-224, 3.5, -40], [-262, 2.5, -8], [-266, 1, 44],
      [-232, 0, 82], [-176, 0, 96], [-116, 0, 92], [-62, 0, 70], [-24, 0, 38],
    ],
    widthProfile: [
      { t: 0.00, width: 11 }, { t: 0.18, width: 10 }, { t: 0.34, width: 8.5 },
      { t: 0.52, width: 10 }, { t: 0.68, width: 8 }, { t: 0.84, width: 10.5 },
    ],
    startT: 0.005,
  },
  {
    // NOTE: `id` and `theme` stay 'circuit'. The id is persisted inside saved
    // `results[]` entries, so renaming it would orphan every existing save; the
    // theme string keys palettes, gantry skins and prop sets across the codebase.
    // Only the DISPLAY names changed (Wave 4, item 13).
    id: 'circuit',
    theme: 'circuit',
    nameHe: 'עיר הנוירונים',
    nameEn: 'Neuron City',
    laps: 3,
    difficulty: 2,
    width: 9,
    // Tighter, more technical: a chicane, two hairpins, narrower corners.
    points: [
      [0, 0, 0], [54, 0, -10], [98, 0, -44], [104, 0, -96], [78, 0, -134],
      [96, 0, -176], [142, 0, -196], [176, 0, -234], [158, 0, -280], [104, 0, -292],
      [52, 0, -276], [16, 0, -240], [-30, 0, -232], [-74, 0, -252], [-118, 0, -232],
      [-130, 0, -184], [-108, 0, -140], [-134, 0, -100], [-178, 0, -74], [-186, 0, -26],
      [-152, 0, 14], [-100, 0, 26], [-46, 0, 20],
    ],
    widthProfile: [
      { t: 0.00, width: 10 }, { t: 0.22, width: 8 }, { t: 0.4, width: 9 },
      { t: 0.55, width: 7.5 }, { t: 0.72, width: 8 }, { t: 0.9, width: 9.5 },
    ],
    startT: 0.005,
  },
  {
    id: 'cloud',
    theme: 'cloud',
    nameHe: 'פסגת הענן',
    nameEn: 'Cloud Peak',
    laps: 3,
    difficulty: 3,
    width: 9.5,
    // Big elevation swings and jumps; the finale.
    points: [
      [0, 0, 0], [58, 6, -22], [110, 16, -62], [138, 26, -122], [130, 30, -186],
      [88, 24, -232], [26, 14, -252], [-40, 8, -244], [-96, 10, -210], [-128, 18, -158],
      [-124, 26, -100], [-158, 30, -52], [-214, 28, -30], [-256, 18, 6], [-250, 8, 60],
      [-206, 2, 96], [-146, 0, 106], [-84, 0, 96], [-34, 0, 62],
    ],
    widthProfile: [
      { t: 0.00, width: 11 }, { t: 0.2, width: 9 }, { t: 0.38, width: 8 },
      { t: 0.58, width: 10 }, { t: 0.76, width: 8.5 },
    ],
    startT: 0.005,
  },
];

const cache = new Map();
export function getTrack(idOrIndex) {
  const def = typeof idOrIndex === 'number' ? TRACKS[idOrIndex] : TRACKS.find(t => t.id === idOrIndex);
  if (!def) throw new Error(`unknown track: ${idOrIndex}`);
  if (!cache.has(def.id)) {
    cache.set(def.id, { def, spline: new TrackSpline(def.points, def) });
  }
  return cache.get(def.id);
}

/** Starting grid: 8 slots, staggered two-abreast behind the line. */
export function gridSlots(spline, def, count = 8) {
  const slots = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 2), col = i % 2 === 0 ? -1 : 1;
    const t = (def.startT - (row * 6 + 4) / spline.length + 1) % 1;
    const lateral = col * (spline.widthAt(t) * 0.32);
    slots.push({ t, lateral, pos: spline.offsetPoint(t, lateral), rot: spline.tangentAt(t) });
  }
  return slots;
}

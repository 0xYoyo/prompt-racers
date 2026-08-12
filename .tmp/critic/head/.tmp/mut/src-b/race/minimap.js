// In-race minimap — the ONE piece of HUD that is canvas, not DOM (DECISIONS D4).
// It carries no text and no Hebrew, only shapes, so canvas costs us nothing and
// buys us a cheap per-frame redraw.
//
// Two important properties:
//
//  1. The projection is derived entirely from the spline itself (sample extents,
//     cross-checked against `spline.bounds`), so ANY of the three tracks — and any
//     track added later — auto-fits the 156x92 box with no hand-tuning.
//  2. It is NOT mirrored under RTL. Everything else in the HUD flips, because it is
//     language. This is a map of the world: flipping it would tell an Israeli kid to
//     turn the wrong way. The canvas is drawn in its own LTR coordinate space and the
//     wrapper carries `direction:ltr` so nothing inherits a flip.
//
// Cost per frame: one drawImage of the cached track plate + N tiny arcs (N <= 8).
// The track plate is only rebuilt when the spline or the size changes.
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const cssColor = c => (typeof c === 'number'
  ? '#' + (c >>> 0 & 0xffffff).toString(16).padStart(6, '0')
  : (c || '#ffffff'));

export class Minimap {
  /**
   * @param {TrackSpline|null} spline  from src/track/trackdef.js
   * @param {object} opts
   *   width,height   CSS pixels of the map box (default 156x92)
   *   pad            inner margin in CSS px so dots never touch the edge
   *   startT         lap fraction of the start/finish line (def.startT)
   *   orient         'auto' (default) rotates the track's long axis horizontal,
   *                  or a number of radians to rotate by, or 'none'
   */
  constructor(spline, opts = {}) {
    this.w = Math.round(opts.width ?? 156);
    this.h = Math.round(opts.height ?? 92);
    this.pad = opts.pad ?? 12;
    this.orient = opts.orient ?? 'auto';
    this.startT = opts.startT ?? 0;
    this.dpr = clamp(opts.dpr || (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1, 1, 2);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mm-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');

    // Cached static plate: track ribbon + start/finish. Redrawn on setSpline/setSize.
    this._plate = document.createElement('canvas');
    this._pctx = this._plate.getContext('2d');

    this._v = new THREE.Vector3();      // scratch — no per-frame allocation
    this._v2 = new THREE.Vector3();
    this._proj = null;
    this._out = { x: 0, y: 0 };         // reused by project() — zero per-frame garbage
    this._pulse = 0;                    // start/finish pulse on lap completion

    this._applySize();
    this.setSpline(spline, this.startT);
  }

  /** The element to mount. */
  get el() { return this.canvas; }

  _applySize() {
    const { w, h, dpr } = this;
    for (const c of [this.canvas, this._plate]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.style.direction = 'ltr';    // never mirror: this is a map, not text
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setSize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = Math.round(w); this.h = Math.round(h);
    this._applySize();
    this._fit();
    this._drawPlate();
  }

  setSpline(spline, startT = 0) {
    this.spline = spline || null;
    this.startT = startT ?? 0;
    this._fit();
    this._drawPlate();
  }

  // ---------------------------------------------------------------- projection

  /**
   * Fit the whole lap into the box.
   *
   * `spline.bounds` is the axis-aligned world extent (already padded by 4x the road
   * half-width). We use it for the unrotated fallback and as a sanity floor; the real
   * fit comes from rotated sample extents so the "auto" orientation can actually win
   * screen area rather than just spinning inside the same bounding square.
   */
  _fit() {
    const sp = this.spline;
    if (!sp) { this._proj = null; return; }

    const N = 256;
    const xs = new Float32Array(N), zs = new Float32Array(N);
    let mx = 0, mz = 0;
    for (let i = 0; i < N; i++) {
      sp.positionAt(i / N, this._v);
      xs[i] = this._v.x; zs[i] = this._v.z;
      mx += this._v.x; mz += this._v.z;
    }
    mx /= N; mz /= N;

    // Principal axis (PCA) of the centreline -> rotate it flat so a long, thin track
    // (all three of ours are wider than tall) uses the full width of the box.
    let theta = 0;
    if (this.orient === 'auto') {
      let cxx = 0, czz = 0, cxz = 0;
      for (let i = 0; i < N; i++) {
        const dx = xs[i] - mx, dz = zs[i] - mz;
        cxx += dx * dx; czz += dz * dz; cxz += dx * dz;
      }
      // Angle of the dominant eigenvector; negate to bring it onto the screen X axis.
      theta = -0.5 * Math.atan2(2 * cxz, cxx - czz);
    } else if (typeof this.orient === 'number') {
      theta = this.orient;
    }

    const fitFor = th => {
      const c = Math.cos(th), s = Math.sin(th);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < N; i++) {
        const dx = xs[i] - mx, dz = zs[i] - mz;
        const rx = c * dx - s * dz, ry = s * dx + c * dz;
        if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
      }
      // Margin in world metres so a kart running the outside kerb still sits inside.
      const m = (sp.baseWidth || 9) * 1.15;
      minX -= m; maxX += m; minY -= m; maxY += m;
      const bw = Math.max(1e-3, maxX - minX), bh = Math.max(1e-3, maxY - minY);
      const scale = Math.min((this.w - this.pad * 2) / bw, (this.h - this.pad * 2) / bh);
      return { c, s, scale, minX, minY, bw, bh, th };
    };

    let f = fitFor(theta);
    // Prefer the orientation that fills more of the box (theta vs theta+90deg).
    if (this.orient === 'auto') {
      const g = fitFor(theta + Math.PI / 2);
      if (g.scale > f.scale * 1.001) { f = g; theta = g.th; }
    }

    let proj = {
      cos: f.c, sin: f.s, scale: f.scale, mx, mz,
      ox: (this.w - f.bw * f.scale) / 2 - f.minX * f.scale,
      oy: (this.h - f.bh * f.scale) / 2 - f.minY * f.scale,
    };

    // Convention: put the start/finish in the lower half, the way a real circuit map
    // is printed. If it lands high, spin 180 degrees (which is still a rigid rotation,
    // never a mirror — left and right stay left and right).
    if (this.orient === 'auto') {
      this._proj = proj;
      sp.positionAt(this.startT, this._v);
      const p = this.project(this._v.x, this._v.z);
      if (p.y < this.h * 0.5) {
        theta += Math.PI;
        const f2 = fitFor(theta);
        proj = {
          cos: f2.c, sin: f2.s, scale: f2.scale, mx, mz,
          ox: (this.w - f2.bw * f2.scale) / 2 - f2.minX * f2.scale,
          oy: (this.h - f2.bh * f2.scale) / 2 - f2.minY * f2.scale,
        };
      }
    }
    this._proj = proj;
    this._out = { x: 0, y: 0 };
  }

  /** World (x,z) -> map pixels. Reuses one object; copy if you keep it. */
  project(x, z) {
    const p = this._proj, o = this._out;
    if (!p) { o.x = this.w / 2; o.y = this.h / 2; return o; }
    const dx = x - p.mx, dz = z - p.mz;
    o.x = p.ox + (p.cos * dx - p.sin * dz) * p.scale;
    o.y = p.oy + (p.sin * dx + p.cos * dz) * p.scale;
    return o;
  }

  // -------------------------------------------------------------- static plate

  _drawPlate() {
    const g = this._pctx;
    g.clearRect(0, 0, this.w, this.h);
    const sp = this.spline;
    if (!sp || !this._proj) return;

    const N = 220;
    const path = new Path2D();
    for (let i = 0; i <= N; i++) {
      sp.positionAt((i % N) / N, this._v);
      const p = this.project(this._v.x, this._v.z);
      if (i === 0) path.moveTo(p.x, p.y); else path.lineTo(p.x, p.y);
    }
    path.closePath();

    g.lineJoin = 'round';
    g.lineCap = 'round';

    // Three passes: a dark contour that separates the map from the panel, the road
    // itself, then a warm inner highlight so the ribbon reads as lit, not as a wire.
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 9.5; g.stroke(path);
    g.strokeStyle = 'rgba(255,255,255,.13)'; g.lineWidth = 7.5; g.stroke(path);
    g.strokeStyle = '#efe7d6'; g.lineWidth = 4.6; g.stroke(path);
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.6; g.stroke(path);

    // Start/finish: a short chequered bar laid across the road, plus a gold tick.
    sp.positionAt(this.startT, this._v);
    const c = this.project(this._v.x, this._v.z);
    const cx = c.x, cy = c.y;
    sp.rightAt(this.startT, this._v2);
    const p = this._proj;
    let rx = (p.cos * this._v2.x - p.sin * this._v2.z);
    let ry = (p.sin * this._v2.x + p.cos * this._v2.z);
    const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;

    const half = 5.4, cells = 4, step = (half * 2) / cells;
    g.save();
    g.lineCap = 'butt';
    for (let i = 0; i < cells; i++) {
      const a = -half + i * step, b = a + step;
      g.strokeStyle = i % 2 ? '#12121c' : '#ffffff';
      g.lineWidth = 4.2;
      g.beginPath();
      g.moveTo(cx + rx * a, cy + ry * a);
      g.lineTo(cx + rx * b, cy + ry * b);
      g.stroke();
    }
    g.restore();
  }

  // ------------------------------------------------------------------ per frame

  /**
   * @param {Array<{t:number, lateral?:number, color?:number|string, isPlayer?:boolean}>} karts
   * @param {number} [dt] seconds — only used to decay the lap pulse
   */
  update(karts, dt = 0) {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    g.drawImage(this._plate, 0, 0, this.w, this.h);
    if (!this.spline || !this._proj || !karts || !karts.length) return;

    if (this._pulse > 0) {
      this._pulse = Math.max(0, this._pulse - (dt || 1 / 60) * 1.6);
      this.spline.positionAt(this.startT, this._v);
      const c = this.project(this._v.x, this._v.z);
      g.save();
      g.globalAlpha = this._pulse * 0.7;
      g.strokeStyle = '#ffc247';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(c.x, c.y, 4 + (1 - this._pulse) * 12, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    // Rivals first, player last, so the player dot is never occluded in a pack.
    let player = null;
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (!k || !isFinite(k.t)) continue;
      if (k.isPlayer) { player = k; continue; }
      this._dot(g, k, false);
    }
    if (player) this._dot(g, player, true);
  }

  _dot(g, k, isPlayer) {
    const sp = this.spline;
    if (k.lateral) sp.offsetPoint(k.t, k.lateral, this._v);
    else sp.positionAt(k.t, this._v);
    const p = this.project(this._v.x, this._v.z);
    const col = cssColor(k.color ?? (isPlayer ? 0xffc247 : 0xbfc6d4));
    const r = isPlayer ? 4.6 : 3.1;

    if (isPlayer) {
      // Soft halo — the one thing that makes "where am I" instant at 92px tall.
      const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 11);
      grd.addColorStop(0, 'rgba(255,194,71,.55)');
      grd.addColorStop(1, 'rgba(255,194,71,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(p.x, p.y, 11, 0, Math.PI * 2); g.fill();
    }

    g.beginPath(); g.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2);
    g.fillStyle = isPlayer ? '#ffffff' : 'rgba(12,12,20,.85)';
    g.fill();

    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fillStyle = col;
    g.fill();

    if (isPlayer) {
      g.beginPath(); g.arc(p.x - r * 0.28, p.y - r * 0.3, r * 0.34, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.fill();
    }
  }

  /** Ping the start/finish ring — the HUD calls this on lap completion. */
  pulseStart() { this._pulse = 1; }

  dispose() {
    this.canvas.remove();
    this.canvas.width = this.canvas.height = 0;
    this._plate.width = this._plate.height = 0;
    this.ctx = this._pctx = null;
    this.spline = null;
    this._proj = null;
  }
}

export default Minimap;

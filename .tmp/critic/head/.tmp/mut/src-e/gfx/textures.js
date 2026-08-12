// Procedural texture library — every surface in the game is drawn here with
// CanvasRenderingContext2D and cached. No image files, no base64, no network.
//
// Determinism: all randomness comes from makeRng / makeNoise2D in core/rng.js,
// so two runs produce byte-identical textures and screenshots compare like with like.
//
// Tiling: our value noise lattice is periodic with period 256 (see rng.js — the
// permutation table is indexed `& 255`). So if we map the pixel domain [0,size)
// onto [0,F) where F is an integer power of two, every octave lands on integer
// lattice boundaries and the texture tiles seamlessly. `tf()` below does that.
//
// Colour space rules (three.js r169):
//   colour / albedo maps  -> THREE.SRGBColorSpace
//   roughness / normal / mask maps -> THREE.NoColorSpace
//
// Usage:
//   const { map, roughnessMap, normalMap } = asphaltTexture({ size: engine.q.texSize });
//   map.repeat.set(4, 30);
import * as THREE from 'three';
import { makeRng, makeNoise2D, fbm } from '../core/rng.js';

// ---------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------

const cache = new Map();

function keyOf(name, params) {
  const k = Object.keys(params).sort();
  return name + '|' + k.map(p => p + '=' + JSON.stringify(params[p])).join(',');
}

/** Memoise a texture (or a bundle of textures) by name + resolved params. */
function memo(name, params, build) {
  const key = keyOf(name, params);
  let v = cache.get(key);
  if (v === undefined) { v = build(); cache.set(key, v); }
  return v;
}

/** Free every cached texture. Call from a scene dispose() on teardown. */
export function disposeTextureCache() {
  for (const v of cache.values()) {
    if (!v) continue;
    if (v.isTexture) v.dispose();
    else for (const t of Object.values(v)) t?.isTexture && t.dispose();
  }
  cache.clear();
}

/** Number of cached entries — handy in tests / perf overlays. */
export function textureCacheSize() { return cache.size; }

// ---------------------------------------------------------------------------
// low level helpers
// ---------------------------------------------------------------------------

// Ground textures are viewed at extreme grazing angles at driver height. Without
// aggressive anisotropic filtering the aggregate speckle turns into a crawling
// salt-and-pepper field — worst on the low tier, which also has no MSAA.
const ANISO = 16;

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Wrap a canvas in a CanvasTexture with the conventions above. */
function toTexture(canvas, { srgb = true, wrap = THREE.RepeatWrapping, aniso = ANISO, name = '' } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = wrap;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/** Deterministic per-pixel hash in [0,1). Cheaper than pulling from the rng stream. */
function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Tileable fbm. `F` is the base frequency in lattice cells across the texture;
 * keep it a power of two (and F * 2^(oct-1) <= 256) for a seamless wrap.
 */
function tf(noise, x, y, size, F, oct = 4, gain = 0.5) {
  return fbm(noise, (x / size) * F, (y / size) * F, oct, 2, gain);
}

/** Ridged noise — |n-0.5| inverted. Gives crack/vein filaments. */
function ridge(v) { return 1 - Math.abs(v - 0.5) * 2; }

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const sstep = (e0, e1, x) => smooth(clamp01((x - e0) / (e1 - e0)));

function hexToRgb(hex) {
  const c = new THREE.Color(hex);
  // Colour literals in this file are authored in sRGB; three's Color constructor
  // converts to linear-srgb when colour management is on, so read the raw bytes.
  return [((hex >> 16) & 255), ((hex >> 8) & 255), (hex & 255), c];
}

/**
 * Sobel a height field into a tangent-space normal map (OpenGL convention: +G up).
 * `height` is a Float32Array of size*size in [0,1]; wraps at the edges so the
 * normal map tiles exactly like the colour map it came from.
 */
export function normalFromHeight(height, size, strength = 3) {
  const cv = makeCanvas(size);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      // v increases upward in texture space but y increases downward in the
      // array, hence the sign flip on the green channel.
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      d[i] = (nx * il * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * il * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * il * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(cv, { srgb: false, name: 'normal' });
}

/** Grayscale Float32 field -> sRGB-free CanvasTexture (roughness, masks, …). */
function fieldToTexture(field, size, name, lo = 0, hi = 1) {
  const cv = makeCanvas(size);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0, n = size * size; i < n; i++) {
    const v = clamp01(lerp(lo, hi, field[i])) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(cv, { srgb: false, name });
}

// ---------------------------------------------------------------------------
// ASPHALT — the most important surface in the game
// ---------------------------------------------------------------------------

/**
 * Track asphalt: fine aggregate speckle, large tonal patches, hairline cracks,
 * scattered debris and tyre-polished lanes.
 *
 * @param {object}  o
 * @param {number}  o.size     texture resolution (pass engine.q.texSize)
 * @param {number}  o.tint     base colour, sRGB hex
 * @param {number}  o.wetness  0 dry .. 1 rain-slick (darker, glossier, puddled)
 * @param {number}  o.seed
 * @returns {{map:THREE.Texture, roughnessMap:THREE.Texture, normalMap:THREE.Texture, height:Float32Array}}
 */
export function asphaltTexture(o = {}) {
  const p = { size: o.size || 512, tint: o.tint ?? 0x5a5650, wetness: o.wetness ?? 0, seed: o.seed ?? 11 };
  return memo('asphalt', p, () => {
    const { size, wetness, seed } = p;
    const noise = makeNoise2D(seed);
    const noiseB = makeNoise2D(seed + 97);
    const [br, bg, bb] = hexToRgb(p.tint);

    const cv = makeCanvas(size);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);
    // At 256 the finest chip layer cannot survive mip reduction and just
    // aliases, so it is pre-attenuated and the 2 px cluster layer carries the
    // grain instead. This is cheaper and steadier than a mip bias.
    const fine = size >= 512 ? 1 : 0.55;
    const gscale = 1;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;

        // --- large tonal patches: old repairs, sun bleaching, oil shadow
        const patch = tf(noise, x, y, size, 2, 3);           // very low freq
        const patch2 = tf(noiseB, x, y, size, 4, 3);
        // --- mid-scale mottling
        const mott = tf(noise, x, y, size, 16, 4);
        // --- fine aggregate: per-pixel stone chips of varying brightness
        const gx = Math.floor(x / gscale), gy = Math.floor(y / gscale);
        const chip = hash2(gx, gy, seed);
        const chipBig = hash2(gx >> 1, gy >> 1, seed + 5);   // 2px clusters
        const grit = tf(noiseB, x, y, size, 64, 3);

        // --- cracks: ridged noise, thresholded hard so they stay RARE. Asphalt
        // reads as cracked mud the moment this is even slightly too generous.
        const c1 = ridge(tf(noise, x, y, size, 4, 3, 0.5));
        const c2 = ridge(tf(noiseB, x, y, size, 8, 2, 0.5));
        const crack = Math.max(sstep(0.9955, 0.9995, c1), sstep(0.9975, 1.0, c2) * 0.6);

        // --- polished driving lanes (vertical, i.e. along the track)
        const lane = sstep(0.35, 0.75, tf(noiseB, x, y, size, 2, 2));
        // --- resurfacing patches: hard-edged repairs of a different age. The
        // art bible calls these out by name and they are the single clearest
        // "this is a real road" cue at mid distance.
        const patchMask = sstep(0.60, 0.64, tf(noise, x + 91, y - 53, size, 2, 2));
        const patchAge = tf(noiseB, x + 17, y + 29, size, 4, 2);

        // height field: aggregate bumps minus crack depth
        let hgt = 0.5 + (chip - 0.5) * 0.72 * fine + (chipBig - 0.5) * 0.34
          + (grit - 0.5) * 0.55 + (mott - 0.5) * 0.25;
        hgt -= crack * 0.85;
        height[i] = clamp01(hgt);

        // colour
        let l = 1
          + (patch - 0.5) * 0.38          // broad tonal patches
          + (patch2 - 0.5) * 0.24
          + (mott - 0.5) * 0.22
          + (chip - 0.5) * 0.30 * fine    // aggregate speckle — the money term
          + (chipBig - 0.5) * 0.22        // 2 px clusters: the grain you SEE
          + (grit - 0.5) * 0.16;
        // a repair patch is a distinctly different tone with a visible edge
        l *= 1 + patchMask * ((patchAge - 0.5) * 0.34 - 0.08);
        l *= 1 - crack * 0.45;            // cracks read dark
        l *= 1 - lane * 0.07;             // rubbered-in lanes slightly darker
        // wet asphalt: darker overall, puddles darker still
        const puddle = wetness * sstep(0.52, 0.78, patch2);
        l *= lerp(1, 0.62, wetness * 0.55) * (1 - puddle * 0.30);

        // aggregate chips carry a faint warm/cool tint variation
        const warm = (hash2(gx, gy, seed + 31) - 0.5) * 10;
        let r = br * l + warm, g = bg * l + warm * 0.5, b = bb * l - warm * 0.4;

        // sparse light debris / gravel dust
        const deb = hash2(gx, gy, seed + 77);
        if (deb > 0.9985) { r += 62; g += 58; b += 50; height[i] = clamp01(height[i] + 0.25); }
        else if (deb < 0.0006) { r -= 26; g -= 26; b -= 24; }

        const j = i * 4;
        d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;

        // Roughness has to carry REAL range or the map does nothing at all:
        // open aggregate ~0.97, tyre-polished racing line ~0.42, fresh bitumen
        // repairs ~0.55, standing water ~0.05. A near-constant roughness map is
        // a wasted texture unit.
        let rg = 0.96 - (chip - 0.5) * 0.20 * fine - (grit - 0.5) * 0.14;
        rg -= lane * 0.24;                          // the racing line is burnished
        rg -= patchMask * (0.34 - patchAge * 0.18); // newer bitumen is smoother
        rg -= crack * 0.06;
        rg = lerp(rg, 0.28, wetness * 0.6);
        rg = lerp(rg, 0.05, puddle);
        rough[i] = clamp01(rg);
      }
    }
    ctx.putImageData(img, 0, 0);

    return {
      map: toTexture(cv, { name: 'asphalt' }),
      roughnessMap: fieldToTexture(rough, size, 'asphalt.rough'),
      normalMap: normalFromHeight(height, size, wetness > 0.5 ? 1.3 : 1.9),
      height,
    };
  });
}

// ---------------------------------------------------------------------------
// SAND
// ---------------------------------------------------------------------------

/** Desert sand: fine grain, wind ripples, darker damp patches, pebbles. */
export function sandTexture(o = {}) {
  const p = { size: o.size || 512, tint: o.tint ?? 0xd9b276, ripple: o.ripple ?? 1, seed: o.seed ?? 23 };
  return memo('sand', p, () => {
    const { size, seed, ripple } = p;
    const noise = makeNoise2D(seed), noiseB = makeNoise2D(seed + 13);
    const [br, bg, bb] = hexToRgb(p.tint);
    const cv = makeCanvas(size), ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const dune = tf(noise, x, y, size, 2, 3);
        const warp = tf(noiseB, x, y, size, 4, 3);
        // wind ripples: sine along a warped axis so they meander
        const rip = 0.5 + 0.5 * Math.sin(((x * 0.55 + y * 0.30) / size) * Math.PI * 2 * 16 + warp * 9);
        const grain = hash2(x, y, seed);
        const mid = tf(noiseB, x, y, size, 24, 4);

        let l = 1 + (dune - 0.5) * 0.20 + (mid - 0.5) * 0.16
          + (rip - 0.5) * 0.10 * ripple + (grain - 0.5) * 0.16;
        height[i] = clamp01(0.5 + (rip - 0.5) * 0.45 * ripple + (dune - 0.5) * 0.5 + (grain - 0.5) * 0.3);

        let r = br * l, g = bg * l, b = bb * l;
        // scattered pebbles / dry twigs
        const peb = hash2(x >> 1, y >> 1, seed + 41);
        if (peb > 0.9975) { r -= 34; g -= 30; b -= 22; height[i] = clamp01(height[i] + 0.3); }
        const j = i * 4;
        d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(cv, { name: 'sand' }), normalMap: normalFromHeight(height, size, 1.6) };
  });
}

// ---------------------------------------------------------------------------
// ROCK — layered sedimentary banding for canyon cliffs
// ---------------------------------------------------------------------------

/**
 * Sandstone cliff face: horizontal sedimentary strata of varying thickness and
 * hue, domain-warped so the bands buckle, plus vertical erosion streaks.
 */
export function rockTexture(o = {}) {
  const p = {
    size: o.size || 512, tint: o.tint ?? 0x9a5c3c, bands: o.bands ?? 14,
    contrast: o.contrast ?? 0.75, seed: o.seed ?? 37,
  };
  return memo('rock', p, () => {
    const { size, seed, bands, contrast } = p;
    const noise = makeNoise2D(seed), noiseB = makeNoise2D(seed + 7), noiseC = makeNoise2D(seed + 19);
    const [br, bg, bb] = hexToRgb(p.tint);
    const rng = makeRng(seed);
    // per-stratum palette multipliers — some bands are paler, some iron-red
    const strata = Array.from({ length: 64 }, () => ({
      l: rng.range(0.80, 1.14), r: rng.range(0.96, 1.06), g: rng.range(0.92, 1.05), b: rng.range(0.86, 1.08),
      t: rng.range(0.4, 1.6),
    }));

    const cv = makeCanvas(size), ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        // buckle the strata: displace the sampling row by low-freq noise
        const warp = (tf(noise, x, y, size, 2, 3) - 0.5) * 0.10
          + (tf(noiseB, x, y, size, 8, 3) - 0.5) * 0.035;
        const v = (y / size + warp) * bands;
        const bi = Math.floor(v) & 63;
        const bf = v - Math.floor(v);
        const s = strata[bi], sPrev = strata[(bi + 63) & 63];
        // soft edge between strata so they read as sediment not stripes
        const edge = sstep(0, 0.13, bf);
        const L = lerp(sPrev.l, s.l, edge), R = lerp(sPrev.r, s.r, edge);
        const G = lerp(sPrev.g, s.g, edge), B = lerp(sPrev.b, s.b, edge);
        // dark seam right at the bedding plane
        const seam = (1 - sstep(0, 0.05, bf)) * 0.32;

        const grain = tf(noiseC, x, y, size, 32, 4);
        const chip = hash2(x, y, seed);
        // vertical erosion / water staining
        const streak = tf(noiseB, x * 0.18, y, size, 8, 3);
        const crack = sstep(0.990, 1.0, ridge(tf(noiseC, x, y, size, 5, 3, 0.55)));

        let l = L * (1 + (grain - 0.5) * 0.24 + (chip - 0.5) * 0.11);
        l *= 1 - seam * contrast;
        l *= 1 - (streak - 0.5) * 0.16;
        l *= 1 - crack * 0.4;
        l = lerp(1, l, contrast);

        height[i] = clamp01(0.5 + (0.5 - Math.abs(bf - 0.5)) * 0.5 * (s.t - 0.5)
          + (grain - 0.5) * 0.6 + (chip - 0.5) * 0.25 - seam * 0.5 - crack * 0.6);

        const j = i * 4;
        d[j] = br * l * R; d[j + 1] = bg * l * G; d[j + 2] = bb * l * B; d[j + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(cv, { name: 'rock' }), normalMap: normalFromHeight(height, size, 2.2) };
  });
}

// ---------------------------------------------------------------------------
// GRASS
// ---------------------------------------------------------------------------

/** Dry-ish verge grass: clumped tonal patches, blade streaks, bare earth spots. */
export function grassTexture(o = {}) {
  const p = { size: o.size || 512, tint: o.tint ?? 0x54682f, dry: o.dry ?? 0.4, seed: o.seed ?? 53 };
  return memo('grass', p, () => {
    const { size, seed, dry } = p;
    const noise = makeNoise2D(seed), noiseB = makeNoise2D(seed + 3);
    const [br, bg, bb] = hexToRgb(p.tint);
    const cv = makeCanvas(size), ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        // Two clump scales: broad tufted patches and the individual tussocks
        // inside them. One scale alone is a cloud, and a cloud reads as moss.
        const clump = tf(noise, x, y, size, 4, 3);
        const tuft = tf(noiseB, x, y, size, 12, 3);
        const mid = tf(noiseB, x, y, size, 16, 4);
        // Vertically stretched noise: grass grows in one direction, and an
        // isotropic mottle is exactly why procedural grass reads as moss.
        const fine = tf(noise, x * 4, y, size, 32, 3);
        const px = hash2(x, y >> 2, seed);
        // clumps sit in shallow hollows, so the gaps between them go dark and
        // the soil starts to show in the deepest ones
        const gap = (sstep(0.48, 0.28, clump) * 0.34 + sstep(0.44, 0.24, tuft) * 0.26);
        // Soil is keyed off the SINGLE tuft channel: averaging two fbm fields
        // narrows the distribution so much that a threshold on the average
        // almost never fires, and the earth never actually shows.
        const soil = clamp01(sstep(0.46, 0.24, tuft) * sstep(0.62, 0.40, clump));
        const bare = sstep(0.66, 0.86, clump) * dry;

        let l = 1 + (clump - 0.5) * 0.46 + (tuft - 0.5) * 0.40 + (mid - 0.5) * 0.30
          + (fine - 0.5) * 0.44 + (px - 0.5) * 0.24;
        l *= 1 - gap;
        let r = br * l, g = bg * l, b = bb * l;
        // dry straw tint follows the same clumping
        const straw = clamp01((clump * 0.6 + tuft * 0.4 - 0.4) * 1.9) * dry;
        r = lerp(r, r * 1.62 + 30, straw); g = lerp(g, g * 1.24 + 18, straw); b = lerp(b, b * 0.66, straw);
        // soil breaking through between the tussocks, and bare dry earth on the
        // exposed high ground
        r = lerp(r, 96, soil * 0.62); g = lerp(g, 72, soil * 0.62); b = lerp(b, 47, soil * 0.62);
        r = lerp(r, 126, bare * 0.80); g = lerp(g, 95, bare * 0.80); b = lerp(b, 62, bare * 0.80);
        height[i] = clamp01(0.5 + (fine - 0.5) * 0.9 + (px - 0.5) * 0.5 + (mid - 0.5) * 0.4
          + (tuft - 0.5) * 0.5);
        const j = i * 4;
        d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Blade strokes on top. These carry the *direction* — without them the
    // colour field alone is just green noise. They are drawn in clumps rather
    // than uniformly so the tufting reads at distance.
    const rng = makeRng(seed + 500);
    const blades = Math.round(size * 9);
    ctx.lineCap = 'round';
    for (let k = 0; k < blades; k++) {
      // cluster centre, then scatter blades tightly around it
      const cx = rng() * size, cy = rng() * size;
      const tuft = rng.int(3, 8);
      for (let t = 0; t < tuft; t++) {
      const x = cx + rng.gauss() * size * 0.02, y = cy + rng.gauss() * size * 0.02;
      const len = rng.range(size * 0.010, size * 0.030);
      const a = -Math.PI / 2 + rng.gauss() * 0.55;
      // Three blade tones: sunlit tip, shadowed blade, and a dry straw blade.
      // The red channel of the light tone is br, NOT bg — mixing those up is
      // what turns a warm dry verge into a flat viridian mat.
      const kind = rng();
      ctx.strokeStyle = kind < 0.40
        ? `rgba(${(br * 1.45 + 20) | 0},${(bg * 1.55) | 0},${(bb * 1.15) | 0},${rng.range(0.06, 0.16)})`
        : kind < 0.72
          ? `rgba(18,30,11,${rng.range(0.07, 0.18)})`
          : `rgba(${(br * 1.9 + 40) | 0},${(bg * 1.35 + 12) | 0},${(bb * 0.7) | 0},${rng.range(0.05, 0.15) * (0.3 + dry)})`;
      ctx.lineWidth = Math.max(0.7, size / 620);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
      }
    }
    return { map: toTexture(cv, { name: 'grass' }), normalMap: normalFromHeight(height, size, 1.4) };
  });
}

// ---------------------------------------------------------------------------
// STONE WALL — the low barrier from the reference
// ---------------------------------------------------------------------------

/**
 * Coursed stone barrier: individual blocks, recessed mortar joints, per-block
 * tonal variation, chipped corners and a soft top-edge bevel highlight.
 */
export function stoneWallTexture(o = {}) {
  const p = {
    size: o.size || 512, tint: o.tint ?? 0xcbb089, rows: o.rows ?? 6, cols: o.cols ?? 4,
    mortar: o.mortar ?? 0x8e7d62, seed: o.seed ?? 71,
  };
  return memo('stoneWall', p, () => {
    const { size, seed, rows, cols } = p;
    const noise = makeNoise2D(seed);
    const rng = makeRng(seed);
    const [br, bg, bb] = hexToRgb(p.tint);
    const [mr, mg, mb] = hexToRgb(p.mortar);

    const cv = makeCanvas(size), ctx = cv.getContext('2d');
    // mortar bed
    ctx.fillStyle = `rgb(${(mr * 0.82) | 0},${(mg * 0.82) | 0},${(mb * 0.82) | 0})`;
    ctx.fillRect(0, 0, size, size);

    const rh = size / rows;
    const joint = Math.max(1.5, size / 150);
    const blocks = [];
    for (let r = 0; r < rows; r++) {
      // running bond: alternate courses are offset by half a block
      const off = (r % 2) * 0.5;
      for (let c = -1; c <= cols; c++) {
        const bw = size / cols;
        const x = (c + off) * bw;
        blocks.push({ x, y: r * rh, w: bw, h: rh, tone: rng.range(0.80, 1.16), hue: rng.range(-1, 1) });
      }
    }
    for (const b of blocks) {
      const x = b.x + joint * 0.5, y = b.y + joint * 0.5;
      const w = b.w - joint, h = b.h - joint;
      const r0 = clamp01(b.tone) ;
      const R = br * b.tone + b.hue * 9, G = bg * b.tone + b.hue * 4, B = bb * b.tone - b.hue * 8;
      // face
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, `rgb(${(R * 1.10) | 0},${(G * 1.10) | 0},${(B * 1.10) | 0})`);
      g.addColorStop(0.55, `rgb(${R | 0},${G | 0},${B | 0})`);
      g.addColorStop(1, `rgb(${(R * 0.80) | 0},${(G * 0.80) | 0},${(B * 0.80) | 0})`);
      ctx.fillStyle = g;
      const rr = Math.min(w, h) * 0.10;
      roundRect(ctx, x, y, w, h, rr); ctx.fill();
      // top bevel highlight + bottom contact shadow
      ctx.fillStyle = `rgba(255,244,220,0.20)`;
      roundRect(ctx, x, y, w, Math.max(1, h * 0.10), rr); ctx.fill();
      ctx.fillStyle = `rgba(40,26,14,0.24)`;
      roundRect(ctx, x, y + h * 0.90, w, Math.max(1, h * 0.10), rr); ctx.fill();
      void r0;
    }

    // per-pixel weathering pass over the whole wall: grain, damp mortar, chips
    const img = ctx.getImageData(0, 0, size, size), d = img.data;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, j = i * 4;
        const grain = tf(noise, x, y, size, 32, 4);
        const blot = tf(noise, x, y, size, 8, 3);
        const px = hash2(x, y, seed);
        const l = 1 + (grain - 0.5) * 0.26 + (blot - 0.5) * 0.16 + (px - 0.5) * 0.14;
        d[j] *= l; d[j + 1] *= l; d[j + 2] *= l;
        // brightness of the base drawing tells us block vs mortar; mortar is
        // darker, so push it further back to read as a recess.
        const lum = (d[j] * 0.3 + d[j + 1] * 0.6 + d[j + 2] * 0.1) / 255;
        height[i] = clamp01(sstep(0.30, 0.55, lum) * 0.8 + (grain - 0.5) * 0.35 + (px - 0.5) * 0.15);
      }
    }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(cv, { name: 'stoneWall' }), normalMap: normalFromHeight(height, size, 3.2) };
  });
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// CURB — red/white kerb stones
// ---------------------------------------------------------------------------

/**
 * Corner kerbing. Stripes run across the strip (u = along the track) so a single
 * repeat count controls stripe density. Worn: scuffed edges, rubber marks, dirt.
 */
export function curbTexture(o = {}) {
  const p = {
    size: o.size || 512, colorA: o.colorA ?? 0xc22b22, colorB: o.colorB ?? 0xf2ece2,
    stripes: o.stripes ?? 4, skew: o.skew ?? 0.0, wear: o.wear ?? 0.55,
    // 'u' = stripes vary across u (default). 'v' = across v — which is what a
    // BoxGeometry kerb wants, since its top face maps v along the track.
    axis: o.axis ?? 'u', seed: o.seed ?? 89,
  };
  return memo('curb', p, () => {
    const { size, stripes, skew, wear, seed, axis } = p;
    const noise = makeNoise2D(seed);
    const [ar, ag, ab] = hexToRgb(p.colorA);
    const [wr, wg, wb] = hexToRgb(p.colorB);
    const cv = makeCanvas(size), ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, j = i * 4;
        const u = axis === 'v' ? y / size : x / size;
        const v = axis === 'v' ? x / size : y / size;
        // stripe phase; skew tilts the stripe so it can read diagonal
        const ph = (u + v * skew) * stripes;
        const f = ph - Math.floor(ph);
        // jitter the stripe edge slightly so it isn't machine-perfect
        const jit = (tf(noise, x, y, size, 16, 2) - 0.5) * 0.02 * wear;
        const isA = (f + jit) < 0.5;
        const edge = Math.min(Math.abs(f - 0.5), Math.abs(f - 0.0), Math.abs(f - 1.0));
        const seam = 1 - sstep(0.0, 0.012, edge);   // dark joint line at stripe boundary

        // Painted CONCRETE, not tape: a coarse aggregate shows through the
        // paint, the paint is thin and patchy on the high points, and the
        // whole thing carries road grime.
        const grain = tf(noise, x, y, size, 32, 4);
        const coarse = tf(noise, x + 61, y + 13, size, 16, 3);
        const chip = hash2(x, y, seed);
        const chipBig = hash2(x >> 1, y >> 1, seed + 3);
        const scuff = sstep(0.55, 0.95, tf(noise, x, y, size, 8, 3)) * wear;
        // paint worn off the exposed aggregate, revealing grey concrete
        const worn = sstep(0.58, 0.84, coarse) * wear * 0.9;

        let r = isA ? ar : wr, g = isA ? ag : wg, b = isA ? ab : wb;
        // aggregate reads through the paint: real kerbs are never flat colour
        // Per-pixel amplitude stays LOW here: a kerb is seen at a grazing angle
        // from 3 m away, and salt-and-pepper aggregate at that scale minifies
        // into crawling red/blue confetti. The mid-frequency grain carries the
        // concrete instead.
        const l = 1 + (grain - 0.5) * 0.32 + (coarse - 0.5) * 0.22
          + (chip - 0.5) * 0.09 + (chipBig - 0.5) * 0.07;
        r *= l; g *= l; b *= l;
        r = lerp(r, 166, worn); g = lerp(g, 160, worn); b = lerp(b, 148, worn);
        // black rubber scuffing (kerbs get hammered by tyres)
        r = lerp(r, 58, scuff * 0.34); g = lerp(g, 54, scuff * 0.34); b = lerp(b, 52, scuff * 0.34);
        // sandy dirt banked up along the outer edge
        const dirt = sstep(0.80, 1.0, v) * wear;
        r = lerp(r, 146, dirt * 0.55); g = lerp(g, 120, dirt * 0.55); b = lerp(b, 84, dirt * 0.55);
        // Chamfered edges. A kerb is a moulded concrete section, so it has a
        // BRIGHT lit chamfer along the road edge, a broad top plateau and a
        // markedly darker outer chamfer that falls away from the key light.
        // This value break is the whole difference between a kerb and a decal.
        const bev = (1 - sstep(0.0, 0.16, v));
        r += 62 * bev; g += 59 * bev; b += 52 * bev;
        // narrow dark score right where the chamfer meets the top plateau
        const chamferLine = Math.max(0, 1 - Math.abs(v - 0.17) / 0.05) * 0.22;
        const shade = sstep(0.62, 0.96, v) * 0.46 + chamferLine;
        r *= 1 - shade; g *= 1 - shade * 0.97; b *= 1 - shade * 0.88;
        r *= 1 - seam * 0.42; g *= 1 - seam * 0.42; b *= 1 - seam * 0.42;

        d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
        // the chamfers are physically lower than the plateau, so the height
        // field carries the section profile as well as the aggregate.
        const profile = sstep(0.0, 0.16, v) * (1 - sstep(0.62, 0.96, v));
        height[i] = clamp01(0.22 + profile * 0.5 - seam * 0.4 + (grain - 0.5) * 0.42
          + (coarse - 0.5) * 0.30 + (chip - 0.5) * 0.12);
      }
    }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(cv, { name: 'curb' }), normalMap: normalFromHeight(height, size, 1.8) };
  });
}

// ---------------------------------------------------------------------------
// METAL
// ---------------------------------------------------------------------------

/** Brushed / painted metal: horizontal brushing, panel grime, faint scratches. */
export function metalTexture(o = {}) {
  const p = { size: o.size || 512, tint: o.tint ?? 0x77808c, brushed: o.brushed ?? 1, seed: o.seed ?? 101 };
  return memo('metal', p, () => {
    const { size, seed, brushed } = p;
    const noise = makeNoise2D(seed), noiseB = makeNoise2D(seed + 13);
    const [br, bg, bb] = hexToRgb(p.tint);
    const cv = makeCanvas(size), ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    const rough = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, j = i * 4;
        // Brushing: strongly anisotropic ALONG X (the same axis the scratch
        // pass scores), several frequencies, high contrast. Weak, isotropic
        // or cross-grained brushing is what makes procedural metal read as
        // painted drywall.
        // Anisotropic fbm — low frequency across x, high across y — gives long
        // continuous streaks and still tiles, where a bit-shifted hash gives
        // 32 px blocks with a visible checker seam.
        // fbm sits in a narrow band around 0.5, so each streak field is
        // contrast-expanded before use — otherwise "anisotropic" just means
        // "uniform grey with a texture you cannot see".
        const ct = (v, k) => clamp01(0.5 + (v - 0.5) * k);
        const brush = lerp(0.5, ct(fbm(noise, (x / size) * 2, (y / size) * 64, 3, 2, 0.5), 2.6), brushed);
        const brush2 = lerp(0.5, ct(fbm(noiseB, (x / size) * 4, (y / size) * 128, 2, 2, 0.5), 2.2), brushed);
        const brush3 = lerp(0.5, hash2(x >> 2, y, seed + 23), brushed);
        // panel-scale value break: rolled sheet is never one flat tone
        const panel = ct(tf(noise, x, y, size, 2, 2), 1.7);
        const blot = tf(noise, x, y, size, 6, 3);
        const grime = sstep(0.46, 0.88, tf(noise, x, y, size, 3, 3));
        // dirt run-off: long horizontal streaks, same grain as the brushing
        const run = sstep(0.60, 0.95, fbm(noiseB, (x / size) * 2, (y / size) * 32, 3, 2, 0.5)) * 0.8;
        let l = 1 + (brush - 0.5) * 0.52 + (brush2 - 0.5) * 0.30 + (brush3 - 0.5) * 0.22
          + (panel - 0.5) * 0.30 + (blot - 0.5) * 0.16 - grime * 0.24 - run * 0.16;
        // a cool sheen where the brushing catches the light, warm in the grime:
        // a single-hue metal is the other half of the drywall problem.
        const sheen = clamp01((brush - 0.5) * 1.4 + 0.5);
        d[j] = br * l * lerp(1.02, 0.96, sheen) + grime * 14;
        d[j + 1] = bg * l * lerp(1.0, 1.0, sheen) + grime * 8;
        d[j + 2] = bb * l * lerp(0.94, 1.06, sheen) - grime * 6;
        d[j + 3] = 255;
        rough[i] = clamp01(0.26 + (brush - 0.5) * 0.50 + (brush2 - 0.5) * 0.24
          + grime * 0.46 + run * 0.30 + (blot - 0.5) * 0.14);
      }
    }
    ctx.putImageData(img, 0, 0);

    // hairline scratches — a handful of long bright/dark scores
    const rng = makeRng(seed + 400);
    ctx.lineCap = 'butt';
    for (let k = 0, n = Math.round(size * 0.5); k < n; k++) {
      const y0 = rng() * size, x0 = rng() * size;
      const len = rng.range(size * 0.08, size * 0.65);
      const light = rng() < 0.45;
      ctx.strokeStyle = light ? `rgba(235,242,250,${rng.range(0.05, 0.20)})`
        : `rgba(24,28,34,${rng.range(0.05, 0.18)})`;
      ctx.lineWidth = rng() < 0.8 ? Math.max(0.6, size / 900) : Math.max(1, size / 400);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + len, y0 + rng.gauss() * size * 0.004);
      ctx.stroke();
    }
    return {
      map: toTexture(cv, { name: 'metal' }),
      roughnessMap: fieldToTexture(rough, size, 'metal.rough'),
    };
  });
}

// ---------------------------------------------------------------------------
// WOOD
// ---------------------------------------------------------------------------

/** Sun-bleached planking: growth rings, plank joints, knots, longitudinal grain. */
export function woodTexture(o = {}) {
  const p = {
    size: o.size || 512, tint: o.tint ?? 0xb98a54, planks: o.planks ?? 5,
    rings: o.rings ?? 26, seed: o.seed ?? 131,
  };
  return memo('wood', p, () => {
    const { size, seed, planks, rings } = p;
    const noise = makeNoise2D(seed), noiseB = makeNoise2D(seed + 17);
    const [br, bg, bb] = hexToRgb(p.tint);
    const rng = makeRng(seed);
    const plankTone = Array.from({ length: 16 }, () => rng.range(0.84, 1.14));
    const plankPhase = Array.from({ length: 16 }, () => rng.range(0, 10));

    const cv = makeCanvas(size), ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    const height = new Float32Array(size * size);
    const ph = size / planks;

    for (let y = 0; y < size; y++) {
      const pi = Math.floor(y / ph) & 15;
      const inPlank = (y % ph) / ph;
      for (let x = 0; x < size; x++) {
        const i = y * size + x, j = i * 4;
        // growth rings along the plank: sine of a warped cross-plank coordinate
        const warp = (tf(noise, x, y, size, 4, 3) - 0.5) * 2.2 + (tf(noiseB, x, y, size, 16, 2) - 0.5) * 0.6;
        const ring = 0.5 + 0.5 * Math.sin((inPlank * 2 + warp) * rings * 0.5 + plankPhase[pi]);
        const fibre = hash2(x, y >> 2, seed);                    // long-grain fibres
        const gap = (1 - sstep(0, 0.035, inPlank)) + sstep(0.965, 1, inPlank);

        let l = plankTone[pi] * (1 + (ring - 0.5) * 0.34 + (fibre - 0.5) * 0.14);
        l *= 1 - clamp01(gap) * 0.55;
        // knots
        const kn = tf(noiseB, x, y, size, 8, 2);
        const knot = sstep(0.88, 0.99, kn);
        l *= 1 - knot * 0.45;

        d[j] = br * l; d[j + 1] = bg * l; d[j + 2] = bb * l * 0.98; d[j + 3] = 255;
        height[i] = clamp01(0.55 + (ring - 0.5) * 0.4 + (fibre - 0.5) * 0.3 - clamp01(gap) * 0.8 - knot * 0.3);
      }
    }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(cv, { name: 'wood' }), normalMap: normalFromHeight(height, size, 1.6) };
  });
}

// ---------------------------------------------------------------------------
// WATER
// ---------------------------------------------------------------------------

/**
 * Turquoise oasis pool. Tileable, so `map.offset.x += dt * k` in an update loop
 * animates it for free with no shader work.
 */
export function waterTexture(o = {}) {
  const p = {
    size: o.size || 512, shallow: o.shallow ?? 0x3fbdb6, deep: o.deep ?? 0x073c52,
    foam: o.foam ?? 0.2, seed: o.seed ?? 149,
  };
  return memo('water', p, () => {
    const { size, seed, foam } = p;
    const noise = makeNoise2D(seed), noiseB = makeNoise2D(seed + 5);
    const [sr, sg, sb] = hexToRgb(p.shallow);
    const [dr, dg, db] = hexToRgb(p.deep);
    const cv = makeCanvas(size), ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x, j = i * 4;
        const depth = tf(noise, x, y, size, 2, 3);
        // Interference of two ripple fields -> caustic web. Both fields are
        // stretched along x so the swell has a direction; isotropic caustics
        // read as frosted glass rather than as water.
        const c1 = ridge(tf(noiseB, x * 0.35, y, size, 8, 3, 0.55));
        const c2 = ridge(tf(noise, x * 0.35 + 37, y - 21, size, 16, 3, 0.55));
        const caustic = clamp01(Math.pow(c1 * c2, 8.0));
        const chop = tf(noiseB, x * 0.4, y, size, 32, 3);

        const t = clamp01(depth * 1.1 - 0.05);
        let r = lerp(dr, sr, t), g = lerp(dg, sg, t), b = lerp(db, sb, t);
        const k = 1 + (chop - 0.5) * 0.22;
        r *= k; g *= k; b *= k;
        // caustics only really show over the shallows; keep the deep water dark
        const cw = caustic * (0.15 + 0.85 * t * t);
        r += 95 * cw; g += 115 * cw; b += 92 * cw;
        // lace of foam where the water is shallowest
        const fm = sstep(0.88, 0.99, depth) * foam;
        r = lerp(r, 236, fm); g = lerp(g, 248, fm); b = lerp(b, 246, fm);
        d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
        height[i] = clamp01(0.5 + (chop - 0.5) * 0.8 + caustic * 0.25);
      }
    }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(cv, { name: 'water' }), normalMap: normalFromHeight(height, size, 1.2) };
  });
}

// ---------------------------------------------------------------------------
// GENERIC UTILITIES
// ---------------------------------------------------------------------------

/**
 * Generic stripe texture for fabric canopies, bunting and banners.
 * Tiles seamlessly for angle 0 (vertical stripes) and Math.PI/2 (horizontal);
 * other angles are for non-tiling decals.
 *
 * @param {number[]} o.colors  sRGB hex list, cycled
 * @param {number}   o.count   stripes across the texture
 * @param {number}   o.angle   radians
 * @param {number}   o.weave   0..1 fabric weave/shading strength
 */
export function stripeTexture(o = {}) {
  const p = {
    size: o.size || 256, colors: o.colors || [0xd94f3d, 0xf5ead6], count: o.count ?? 8,
    angle: o.angle ?? 0, weave: o.weave ?? 0.5, seed: o.seed ?? 167,
  };
  return memo('stripe', p, () => {
    const { size, colors, count, angle, weave, seed } = p;
    const cv = makeCanvas(size), ctx = cv.getContext('2d');
    const diag = size * 1.5;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(angle);
    const sw = size / count;
    for (let i = -Math.ceil(diag / sw); i <= Math.ceil(diag / sw); i++) {
      const c = colors[((i % colors.length) + colors.length) % colors.length];
      ctx.fillStyle = '#' + c.toString(16).padStart(6, '0');
      ctx.fillRect(i * sw - size / 2, -diag, sw + 0.5, diag * 2);
    }
    ctx.restore();

    // Fabric: fine weave, a shaded seam at every stripe boundary, the soft
    // catenary sag of hung cloth, and dust settled along the lower edge. Flat
    // stripes with no seam and no sag read as vinyl tape, not as fabric.
    const noise = makeNoise2D(seed);
    const img = ctx.getImageData(0, 0, size, size), d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const j = (y * size + x) * 4;
        const weft = (hash2(x >> 1, y, seed) - 0.5) * 0.16 + (hash2(x, y >> 1, seed + 1) - 0.5) * 0.16;
        const soft = (tf(noise, x, y, size, 6, 3) - 0.5) * 0.20;
        // stripe-local coordinate (only meaningful for the tiling angles, which
        // is exactly where the seam matters)
        const sp = ((angle < 0.1 ? x : y) % sw) / sw;
        const seam = (1 - sstep(0, 0.10, sp)) * 0.5 + sstep(0.90, 1, sp) * 0.5;
        // sag: the cloth is brighter along its crown and falls into shadow at
        // the edges of each panel
        const sag = Math.sin(sp * Math.PI) * 0.14 - 0.05;
        const l = 1 + (weft + soft) * weave + sag * weave - seam * 0.16 * weave;
        d[j] *= l; d[j + 1] *= l; d[j + 2] *= l;
        // Dust / sun-bleach in patches. It has to come from tileable noise: a
        // gradient keyed to the raw v coordinate puts a hard seam across every
        // repeat, and this texture is used on canopies that DO tile.
        const dust = sstep(0.58, 0.95, tf(noise, x + 29, y + 71, size, 4, 3)) * 0.34 * weave;
        d[j] = lerp(d[j], 176, dust); d[j + 1] = lerp(d[j + 1], 162, dust); d[j + 2] = lerp(d[j + 2], 134, dust);
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(cv, { name: 'stripe' });
  });
}

/** Generic greyscale fbm — masks, dissolves, cloud alpha, dirt overlays. */
export function noiseTexture(o = {}) {
  const p = {
    size: o.size || 256, octaves: o.octaves ?? 5, freq: o.freq ?? 4,
    gain: o.gain ?? 0.5, contrast: o.contrast ?? 1, seed: o.seed ?? 181,
  };
  return memo('noise', p, () => {
    const { size, octaves, freq, gain, contrast, seed } = p;
    const noise = makeNoise2D(seed);
    const cv = makeCanvas(size), ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const j = (y * size + x) * 4;
        let v = tf(noise, x, y, size, freq, octaves, gain);
        v = clamp01(0.5 + (v - 0.5) * contrast) * 255;
        d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(cv, { srgb: false, name: 'noise' });
  });
}

/**
 * Small utility: build a CanvasTexture from a draw callback. Used by other gfx
 * modules for one-off signage; still cached by `name` + size.
 */
export function canvasTexture(name, size, draw, { srgb = true, wrap = THREE.ClampToEdgeWrapping } = {}) {
  return memo('canvas:' + name, { size, srgb, wrap }, () => {
    const cv = makeCanvas(size);
    draw(cv.getContext('2d'), size);
    return toTexture(cv, { srgb, wrap, name });
  });
}

// A stable catalogue used by the texture inspector preview (and handy for docs).
export const TEXTURE_CATALOG = [
  ['asphalt', s => asphaltTexture({ size: s }).map],
  ['asphalt.rough', s => asphaltTexture({ size: s }).roughnessMap],
  ['asphalt.normal', s => asphaltTexture({ size: s }).normalMap],
  ['asphalt.wet', s => asphaltTexture({ size: s, tint: 0x3c3f46, wetness: 0.9 }).map],
  ['sand', s => sandTexture({ size: s }).map],
  ['rock', s => rockTexture({ size: s }).map],
  ['rock.normal', s => rockTexture({ size: s }).normalMap],
  ['grass', s => grassTexture({ size: s }).map],
  ['stoneWall', s => stoneWallTexture({ size: s }).map],
  ['stoneWall.normal', s => stoneWallTexture({ size: s }).normalMap],
  ['curb', s => curbTexture({ size: s, stripes: 3 }).map],
  ['metal', s => metalTexture({ size: s }).map],
  ['wood', s => woodTexture({ size: s }).map],
  ['water', s => waterTexture({ size: s }).map],
  ['stripe', s => stripeTexture({ size: s, colors: [0xd94f3d, 0xf5ead6, 0x2f8f8a], count: 7 })],
  ['noise', s => noiseTexture({ size: s })],
];

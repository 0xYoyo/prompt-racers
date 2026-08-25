// Sky, lighting rig and atmosphere.
//
// The whole "expensive" look of the reference art comes from three things, and
// all three live in this file:
//   1. a sky that is a *structured* multi-stop gradient with banded, underlit
//      clouds and a bloomy sun — never a flat colour, never two stops;
//   2. fog whose colour is EXACTLY the sky's horizon colour, so distant geometry
//      dissolves into the sky instead of ending at a visible line;
//   3. a low warm key light with a tight shadow camera plus a cool hemisphere
//      fill, giving the warm/cool split that reads as golden hour.
//
// Everything is painted once into a single equirectangular canvas and mapped
// onto one inverted sphere: one draw call, zero per-frame cost.
//
//   const rig = applyTheme(scene, 'oasis', engine);
//   // in update():  rig.update(dt, camera);            // keeps sky centred
//   //               rig.setShadowFocus(kart.position); // keeps shadows crisp
import * as THREE from 'three';
import { makeRng, makeNoise2D, fbm } from '../core/rng.js';
import {
  asphaltTexture, sandTexture, rockTexture, grassTexture, stoneWallTexture,
  curbTexture, metalTexture, woodTexture, waterTexture, stripeTexture, noiseTexture,
  disposeTextureCache, TEXTURE_CATALOG,
} from './textures.js';

/**
 * BAKE COUNTERS — the one thing tools/transitiontest.mjs can assert without
 * asking the rasteriser's opinion: how many times the expensive one-off work
 * actually ran. A warm walk of screens already visited must bake nothing.
 *
 * EVERY INCREMENT LIVES AT THE WORK, NEVER AT THE CACHE. Counting inside a
 * cache-miss branch means the counter is deleted by the same edit that deletes
 * the cache, `globalThis.__PERFSTATS__` keeps publishing a cheerful zero, and
 * the gate goes green on precisely the regression it exists to catch. So
 * `paintSky` counts itself, the signage occlusion search counts itself, and
 * `auditTrackClearance` counts itself — remove any cache and the number climbs
 * on the warm lap immediately.
 *
 * Declared here, above every call site, because `paintSky` is defined long
 * before the cache that calls it.
 */
export const PERF_STATS = (globalThis.__PERFSTATS__ ||= { skyPaints: 0, signSearches: 0, trackAudits: 0 });

const DEG = Math.PI / 180;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const sstep = (e0, e1, x) => smooth(clamp01((x - e0) / (e1 - e0)));

// Colours in this file are raw sRGB bytes so canvas painting and three's colour
// management never fight over the same literal.
const rgbOf = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const hexOf = c => ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);

// ---------------------------------------------------------------------------
// THEMES
// ---------------------------------------------------------------------------
// `grad` positions are measured from zenith (0) to nadir (1); 0.5 is the horizon,
// so position p corresponds to elevation (0.5 - p) * 180 degrees.
//
// IMPORTANT: a driver-height camera with a 58 deg vertical FOV only ever sees
// roughly 0 - 35 deg of elevation, i.e. p in [0.30, 0.50]. All the interesting
// colour therefore has to live in that narrow band — spread the stops evenly
// over the full hemisphere and the game looks like flat pink soup.

export const THEMES = {
  /** Desert canyon at golden hour. Wave 1 track — the flagship look. */
  oasis: {
    name: 'oasis', seed: 1201,
    // Authored in HSL so the ramp is strictly monotonic in hue, saturation and
    // lightness: mauve H250 -> peach H28, S32 -> S68, L38 -> L69. A gradient
    // that reverses hue partway down reads as "pink slabs pasted over blue"
    // rather than as one continuous atmosphere.
    grad: [
      [0.000, 0x4c4280], [0.180, 0x6e5da2], [0.300, 0x9d93bb], [0.365, 0xb49bc0],
      [0.410, 0xc99cbe], [0.445, 0xd199ac], [0.470, 0xd99792], [0.487, 0xe0a085],
      [0.500, 0xe6ac7a],
      [0.515, 0xd99968], [0.580, 0xbd794c], [0.780, 0x8e5f43], [1.000, 0x6d4c3b],
    ],
    // Fog takes this exact colour, and because the sky skips tone mapping this
    // is also the literal rendered horizon pixel — H28 S68 L69. Distance is
    // supposed to GAIN chroma at golden hour, so this is saturated peach, not
    // cream: a washed-out fog colour flattens every silhouette into a pale blob.
    horizon: 0xe6ac7a, hazeStrength: 0.94,
    // Azimuth is deliberately ~35 deg off the main straight rather than dead
    // ahead: light straight down the barrel back-lights everything into flat
    // silhouettes, whereas a raking sun models the forms and throws the long
    // cross-track shadows that read as golden hour.
    sun: { az: 215, elev: 11.0, size: 0.012, halo: 0.42, core: 0xffffff, glow: 0xffd79c, spread: 0xffa768 },
    clouds: { bands: 8, coverage: 0.95, alpha: 0.80, scale: 1.0, top: 0xa08cae, bot: 0xf3ac74, lit: 0xffeccb },
    stars: 0,
    light: {
      // Shadows must read BLUE. The ambient and hemisphere-ground terms are the
      // usual culprits: tint them warm and they cancel the cool fill, leaving
      // neutral grey shadows that make the warm key look like it is doing
      // nothing. Ambient is small and cool; hemi is weak so shadows stay deep.
      // The fill is deliberately a touch desaturated from the hemisphere blue.
      // At full chroma it swamps the albedo of anything in shade — white kerb
      // paint in the barrier's shadow came out as saturated cornflower, which
      // is how a red/white kerb ends up reading blue/white.
      key: 0xffd3a0, keyI: 2.8, fill: 0x9dbde8, fillI: 0.38,
      hemiSky: 0x74b0ea, hemiGround: 0xc79a63, hemiI: 0.55,
      ambient: 0.05, ambientColor: 0x5aa6ec,
      elevOverride: 15,          // key light sits a touch above the painted sun
    },
    fog: { density: 0.0040, near: 40, far: 620 },
    ground: 0xc9a173,            // colour the sky fades to below the horizon
  },

  /** Neon night city. Moon key, magenta/cyan rim, city glow along the horizon. */
  circuit: {
    name: 'circuit', seed: 2202,
    grad: [
      [0.000, 0x070a1d], [0.180, 0x0d102b], [0.300, 0x191740], [0.365, 0x2e2253],
      [0.410, 0x452960], [0.445, 0x63316d], [0.470, 0x79346e], [0.487, 0x863765],
      [0.500, 0x93395f],
      [0.515, 0x793457], [0.580, 0x4c244c], [0.800, 0x1f142e], [1.000, 0x110d21],
    ],
    // Deliberately NOT the hot magenta of the neon glow: fog takes this colour,
    // and a hot fog turns every distant building into bubblegum. The saturated
    // magenta comes from the local city-glow blobs instead.
    horizon: 0x93395f, hazeStrength: 0.55,
    sun: { az: 42, elev: 34, size: 0.010, halo: 0.30, core: 0xffffff, glow: 0x9fb6ff, spread: 0x6f86d8, moon: true },
    clouds: { bands: 5, coverage: 0.55, alpha: 0.55, scale: 1.3, top: 0x2a2b52, bot: 0x6d3b74, lit: 0xa9a2e8 },
    stars: 340,
    city: { glow: 0xff5fae, glow2: 0x39e6ff, height: 0.055, count: 120 },
    light: {
      key: 0xbfd0ff, keyI: 1.35, fill: 0xff4fb0, fillI: 0.7,
      hemiSky: 0x4a63c8, hemiGround: 0x2e0f36, hemiI: 0.5,
      ambient: 0.08, ambientColor: 0x4a63c8,
      elevOverride: 38,
    },
    fog: { density: 0.0060, near: 20, far: 340 },
    ground: 0x1a1430,
  },

  /** Dawn above the clouds — pale rose and gold, a cloud sea below the horizon. */
  cloud: {
    name: 'cloud', seed: 3303,
    grad: [
      [0.000, 0x4e69bc], [0.180, 0x758ec7], [0.300, 0x9eafd1], [0.365, 0xb5b5d4],
      [0.410, 0xcfbed5], [0.445, 0xdbbdcc], [0.470, 0xe1beb7], [0.487, 0xe8c5b0],
      [0.500, 0xedc9a6],
      [0.515, 0xebccad], [0.580, 0xe6d0bc], [0.780, 0xdacabe], [1.000, 0xcab9af],
    ],
    horizon: 0xedc9a6, hazeStrength: 0.9,
    sun: { az: 205, elev: 8.0, size: 0.011, halo: 0.50, core: 0xffffff, glow: 0xffdcae, spread: 0xffb98a },
    clouds: { bands: 6, coverage: 0.7, alpha: 0.72, scale: 1.5, top: 0x9fa4d0, bot: 0xffcfa2, lit: 0xfff6e6 },
    cloudSea: true,
    stars: 0,
    light: {
      key: 0xffe0bc, keyI: 2.9, fill: 0xb2cbf2, fillI: 0.64,
      hemiSky: 0x9dc0ff, hemiGround: 0xcbb4a8, hemiI: 0.7,
      ambient: 0.09, ambientColor: 0x9dc0ff,
      elevOverride: 13,
    },
    // Fog: deliberately thinner than the other themes. `cloud` is a pale-on-pale
    // palette, so at 0.0038 everything past ~200m collapsed to one peach value and
    // the floating islands and light-falls that sell the concept lost their contrast
    // exactly where they do the most work — the championship finale read as a
    // generic pale circuit from the driver's seat. Halving it keeps the aerial
    // perspective (the sky is still what distance converges to) while leaving the
    // silhouettes enough separation to register.
    fog: { density: 0.0019, near: 50, far: 700 },
    // Cool, deeper plateau stone rather than near-white sand. This is the only
    // large surface beside the road, so it carries the frame's value structure;
    // pale ground against a pale sky left nothing for the eye to anchor on.
    ground: 0x9fa8c4,
  },
};

/** Look up a theme, falling back to oasis. */
export function getTheme(name) { return THEMES[name] || THEMES.oasis; }

/** Unit vector pointing from the world toward the sun/moon for a theme. */
export function sunDirection(name) {
  const t = getTheme(name);
  const el = (t.light.elevOverride ?? t.sun.elev) * DEG, az = t.sun.az * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

// ---------------------------------------------------------------------------
// SKY PAINTING
// ---------------------------------------------------------------------------

// Convert a horizontal direction into the equirect u of a three SphereGeometry.
// three builds the sphere with x = -cos(phi)*sin(theta), z = sin(phi)*sin(theta)
// and uv.x = u, so phi = atan2(z, -x).
function uOf(dirX, dirZ) {
  const phi = Math.atan2(dirZ, -dirX);
  return ((phi / (Math.PI * 2)) % 1 + 1) % 1;
}

/** Sample the theme gradient at a nadir-fraction p in [0,1]; returns sRGB bytes. */
function gradAt(grad, p) {
  if (p <= grad[0][0]) return rgbOf(grad[0][1]);
  for (let i = 1; i < grad.length; i++) {
    if (p <= grad[i][0]) {
      const [p0, c0] = grad[i - 1], [p1, c1] = grad[i];
      return mix(rgbOf(c0), rgbOf(c1), smooth((p - p0) / (p1 - p0 || 1)));
    }
  }
  return rgbOf(grad[grad.length - 1][1]);
}

/** One soft cloud puff, lit from below (golden hour) or above (dawn). */
function puff(ctx, cx, cy, rx, ry, colTop, colBot, colLit, a, litness) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  // Body. The alpha is held flat out to 0.5 before it falls off: a plain
  // 0 -> 1 radial gradient produces a formless smear, and a sky full of
  // formless smears is exactly what a cheap procedural sky looks like.
  let g = ctx.createRadialGradient(0, -rx * 0.16, rx * 0.05, 0, 0, rx);
  g.addColorStop(0.00, css(colTop, a));
  g.addColorStop(0.50, css(colTop, a * 0.95));
  g.addColorStop(0.76, css(colTop, a * 0.45));
  g.addColorStop(1.00, css(colTop, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill();
  // warm underlight: the sunlit belly of the cloud
  g = ctx.createRadialGradient(0, rx * 0.34, 0, 0, rx * 0.34, rx * 0.86);
  g.addColorStop(0.00, css(colBot, a * 0.95));
  g.addColorStop(0.45, css(colBot, a * 0.70));
  g.addColorStop(0.80, css(colBot, a * 0.22));
  g.addColorStop(1.00, css(colBot, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, rx * 0.2, rx, 0, 7); ctx.fill();
  // hot rim where the cloud faces the sun
  if (litness > 0.01) {
    g = ctx.createRadialGradient(0, rx * 0.48, 0, 0, rx * 0.48, rx * 0.62);
    g.addColorStop(0.0, css(colLit, Math.min(1, a * 1.15) * litness));
    g.addColorStop(0.5, css(colLit, a * litness * 0.55));
    g.addColorStop(1.0, css(colLit, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, rx * 0.3, rx, 0, 7); ctx.fill();
  }
  ctx.restore();
}

/**
 * Paint the equirectangular sky canvas for a theme.
 * @returns {HTMLCanvasElement}
 */
function paintSky(theme, W, H) {
  // COUNTED HERE, at the work, and not at the cache that avoids it. A counter
  // that lives inside `skyTexture`'s miss branch disappears along with the cache
  // if the cache is ever reverted, and tools/transitiontest.mjs would then read
  // a cheerful zero on exactly the regression it exists to catch.
  PERF_STATS.skyPaints++;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const rng = makeRng(theme.seed);
  const noise = makeNoise2D(theme.seed + 11);
  const horizonY = H * 0.5;

  // --- 1. base vertical gradient (many stops; the whole point) --------------
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [p, c] of theme.grad) g.addColorStop(p, css(rgbOf(c)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const sun = theme.sun;
  const sunEl = sun.elev * DEG, sunAz = sun.az * DEG;
  const sdx = Math.sin(sunAz) * Math.cos(sunEl), sdz = Math.cos(sunAz) * Math.cos(sunEl);
  const sunU = uOf(sdx, sdz);
  const sunX = sunU * W;
  const sunY = H * (0.5 - sun.elev / 180);
  const horizonCol = rgbOf(theme.horizon);

  // --- 2. stars (night themes), before everything that glows ---------------
  if (theme.stars) {
    for (let i = 0; i < theme.stars; i++) {
      const x = rng() * W;
      const y = Math.pow(rng(), 1.7) * horizonY * 0.92;
      const r = rng.range(0.6, 1.9) * (W / 2048);
      const a = rng.range(0.18, 0.9) * (1 - y / horizonY * 0.75);
      ctx.fillStyle = `rgba(${230 + rng.int(0, 25)},${234 + rng.int(0, 20)},255,${a})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
  }

  // --- 3. broad atmospheric glow around the sun ----------------------------
  ctx.globalCompositeOperation = 'lighter';
  const spread = rgbOf(sun.spread), glow = rgbOf(sun.glow), core = rgbOf(sun.core);
  // The canvas spans 360 deg, so W * 0.10 is a 36 deg-wide halo — already
  // most of a 58 deg field of view. Anything larger stops reading as a sun and
  // becomes a blown-out white hole in the corner of the frame.
  for (const [rad, col, alpha] of [
    [W * 0.100, spread, 0.30 * sun.halo], [W * 0.052, glow, 0.44 * sun.halo],
    [W * 0.026, glow, 0.52 * sun.halo], [W * 0.012, core, 0.65 * sun.halo],
  ]) {
    for (const dx of [-W, 0, W]) {                    // wrap across the seam
      const rg = ctx.createRadialGradient(sunX + dx, sunY, 0, sunX + dx, sunY, rad);
      rg.addColorStop(0, css(col, alpha));
      rg.addColorStop(0.45, css(col, alpha * 0.28));
      rg.addColorStop(1, css(col, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(sunX + dx - rad, sunY - rad, rad * 2, rad * 2);
    }
  }
  // hot band smeared along the horizon under the sun — the golden-hour tell
  {
    const rad = W * 0.13, hh = H * 0.032;
    for (const dx of [-W, 0, W]) {
      ctx.save();
      ctx.translate(sunX + dx, horizonY);
      ctx.scale(1, hh / rad);
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      rg.addColorStop(0, css(glow, 0.34 * sun.halo));
      rg.addColorStop(0.5, css(spread, 0.13 * sun.halo));
      rg.addColorStop(1, css(spread, 0));
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, 7); ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // --- 4. city glow + skyline silhouette (circuit) -------------------------
  if (theme.city) {
    const c1 = rgbOf(theme.city.glow), c2 = rgbOf(theme.city.glow2);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const x = rng() * W, rad = W * rng.range(0.05, 0.16), hh = H * rng.range(0.03, 0.07);
      const col = mix(c1, c2, rng());
      ctx.save(); ctx.translate(x, horizonY); ctx.scale(1, hh / rad);
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      rg.addColorStop(0, css(col, 0.20)); rg.addColorStop(1, css(col, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, rad, 0, 7); ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    // far skyline: a jagged dark band with a scatter of lit windows
    for (let i = 0; i < theme.city.count; i++) {
      const w = W * rng.range(0.004, 0.018);
      const x = rng() * W;
      const hgt = H * theme.city.height * rng.range(0.25, 1.0);
      const dark = mix(rgbOf(0x120e2c), rgbOf(theme.horizon), 0.22);
      ctx.fillStyle = css(dark, 0.85);
      ctx.fillRect(x, horizonY - hgt, w, hgt + 2);
      const wins = Math.floor(hgt / (H * 0.006));
      for (let k = 0; k < wins; k++) {
        if (rng() > 0.35) continue;
        const col = rng() < 0.5 ? c1 : c2;
        ctx.fillStyle = css(col, rng.range(0.25, 0.8));
        ctx.fillRect(x + w * 0.2, horizonY - hgt + k * H * 0.006, w * rng.range(0.2, 0.6), H * 0.0025);
      }
    }
  }

  // --- 5. banded clouds ----------------------------------------------------
  const cl = theme.clouds;
  const top = rgbOf(cl.top), bot = rgbOf(cl.bot), lit = rgbOf(cl.lit);
  for (let b = 0; b < cl.bands; b++) {
    const t = b / (cl.bands - 1 || 1);                 // 0 = high, 1 = at horizon
    // bands crowd together toward the horizon: that perspective compression is
    // what makes a flat gradient read as a sky with depth.
    // Bands crowd toward the horizon (perspective compression) and stretch
    // horizontally as they go — that is what turns a gradient into a sky.
    const yBand = horizonY * (1 - Math.pow(1 - t, 2.1)) * 0.99;
    const scaleY = lerp(0.9, 0.16, t) * cl.scale;
    const scaleX = lerp(0.9, 2.4, t) * cl.scale;
    const alpha = cl.alpha * lerp(0.9, 0.62, t);
    const clusters = Math.round(lerp(9, 26, t) * cl.coverage);
    for (let i = 0; i < clusters; i++) {
      const cx = rng() * W;
      const cy = yBand + rng.gauss() * H * 0.012 * scaleY * 4;
      if (cy > horizonY * 0.995) continue;
      // proximity to the sun in wrapped u space -> stronger warm rim
      let du = Math.abs(cx / W - sunU); du = Math.min(du, 1 - du);
      const litness = Math.pow(1 - clamp01(du * 2.6), 2) * 0.95;
      const warm = mix(bot, lit, litness * 0.6);
      const cool = mix(top, lit, litness * 0.30);
      const puffs = rng.int(4, 9);
      const baseR = H * rng.range(0.026, 0.070) * scaleX;
      for (let k = 0; k < puffs; k++) {
        const ox = rng.gauss() * baseR * 1.8;
        const oy = rng.gauss() * baseR * 0.10 * (scaleY / scaleX) * 4;
        const rx = baseR * rng.range(0.45, 1.05);
        const ry = rx * lerp(0.38, 0.13, t) * rng.range(0.75, 1.35);
        for (const dx of [-W, 0, W]) {
          const X = cx + ox + dx;
          if (X < -baseR * 3 || X > W + baseR * 3) continue;
          puff(ctx, X, cy + oy, rx, Math.max(ry, 2), cool, warm, lit,
            alpha * rng.range(0.7, 1.0), litness);
        }
      }
    }
  }

  // --- 6. sea of cloud tops below the horizon (cloud theme) ----------------
  if (theme.cloudSea) {
    const seaTop = rgbOf(0xd9d2e6), seaLit = rgbOf(0xfff3e2), seaBot = rgbOf(0xc0aec2);
    for (let row = 0; row < 22; row++) {
      const t = row / 21;
      const y = horizonY + Math.pow(t, 1.6) * (H * 0.5);
      const r = H * lerp(0.012, 0.075, t);
      const n = Math.round(lerp(46, 14, t));
      for (let i = 0; i < n; i++) {
        const cx = (i / n + rng() * 0.02) * W + rng.gauss() * W * 0.01;
        let du = Math.abs(cx / W - sunU); du = Math.min(du, 1 - du);
        const litness = Math.pow(1 - clamp01(du * 2.6), 2);
        const colTop = mix(seaTop, seaLit, litness * 0.8);
        for (const dx of [-W, 0, W]) {
          puff(ctx, cx + dx, y, r * rng.range(0.8, 1.5), r * rng.range(0.45, 0.8),
            colTop, mix(seaBot, seaLit, litness * 0.5), seaLit,
            lerp(0.85, 0.45, t), litness * 0.7);
        }
      }
    }
  }

  // --- 7. sun / moon disc --------------------------------------------------
  {
    const r = H * sun.size;
    ctx.globalCompositeOperation = 'lighter';
    for (const dx of [-W, 0, W]) {
      const rg = ctx.createRadialGradient(sunX + dx, sunY, 0, sunX + dx, sunY, r * 3.2);
      rg.addColorStop(0.0, css(core, 1));
      rg.addColorStop(0.26, css(core, 0.92));
      rg.addColorStop(0.34, css(glow, 0.42));
      rg.addColorStop(1.0, css(glow, 0));
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(sunX + dx, sunY, r * 3.2, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (sun.moon) {
      // a few soft maria so the moon is not a featureless white dot
      ctx.save();
      ctx.beginPath(); ctx.arc(sunX, sunY, r * 0.98, 0, 7); ctx.clip();
      for (let i = 0; i < 7; i++) {
        const a = rng() * 7, d = rng() * r * 0.7;
        const rr = r * rng.range(0.12, 0.32);
        const rg = ctx.createRadialGradient(sunX + Math.cos(a) * d, sunY + Math.sin(a) * d, 0,
          sunX + Math.cos(a) * d, sunY + Math.sin(a) * d, rr);
        rg.addColorStop(0, 'rgba(150,165,205,0.35)'); rg.addColorStop(1, 'rgba(150,165,205,0)');
        ctx.fillStyle = rg; ctx.fillRect(sunX - r, sunY - r, r * 2, r * 2);
      }
      ctx.restore();
    }
  }

  // --- 8. horizon haze: the exact fog colour, so geometry dissolves --------
  {
    // Keep this band tight. H * 0.06 is only ~11 deg of elevation; anything
    // wider bleaches the lower sky into a featureless cream stripe.
    const top0 = horizonY - H * 0.062, span = H * 0.084;
    // The last couple of degrees have to be essentially the fog colour itself.
    // Cloud bands crowd into that strip, and any cloud left showing there drags
    // the rendered horizon pixel darker and cooler than theme.horizon — at
    // which point the fog no longer matches the sky it is supposed to be
    // dissolving into, and every distant silhouette ends on a visible seam.
    const hz = ctx.createLinearGradient(0, top0, 0, top0 + span);
    hz.addColorStop(0.00, css(horizonCol, 0));
    hz.addColorStop(0.42, css(horizonCol, 0.40 * theme.hazeStrength));
    hz.addColorStop(0.72, css(horizonCol, 0.97 * theme.hazeStrength));
    hz.addColorStop(1.00, css(horizonCol, 0.90 * theme.hazeStrength));
    ctx.fillStyle = hz;
    ctx.fillRect(0, top0, W, span);
    // below the horizon the sphere is mostly hidden by terrain; fade it to a
    // neutral ground haze so any gap reads as distant dusty land, not a void.
    const gr = ctx.createLinearGradient(0, horizonY, 0, H);
    const gc = rgbOf(theme.ground);
    gr.addColorStop(0, css(gc, 0));
    gr.addColorStop(0.35, css(gc, 0.75));
    gr.addColorStop(1, css(gc, 1));
    ctx.fillStyle = gr;
    ctx.fillRect(0, horizonY, W, H * 0.5);
  }

  // --- 9. dither + very low-frequency mottling ----------------------------
  // 8-bit vertical gradients band badly on a projector or a cheap laptop panel.
  // A ±2 LSB noise pass costs nothing and removes it completely.
  {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const n = fbm(noise, (x / W) * 6, (y / H) * 6, 3) - 0.5;
        const dith = (((x * 7 + y * 13) ^ (x * 3)) % 5) - 2;
        const k = 1 + n * 0.045;
        d[i] = d[i] * k + dith; d[i + 1] = d[i + 1] * k + dith; d[i + 2] = d[i + 2] * k + dith;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  return cv;
}

// ---------------------------------------------------------------------------
// SKY TEXTURE CACHE  (Wave 5.1 — scene-transition freezes)
// ---------------------------------------------------------------------------
//
// MEASURED: `paintSky` is the single most expensive thing on any scene change.
// It paints a 2048x1024 equirectangular canvas and then runs the dither pass in
// section 9, which is one `getImageData` of 2.1 M pixels, a per-pixel fbm loop
// over all of them, and a `putImageData` back. Under the transition profiler
// that one `getImageData` alone measured 280-1800 ms, and it ran on EVERY scene
// entry: the title backdrop, racer select, the collection screen, every race and
// the podium all call `applyTheme`, and nothing cached the result.
//
// The sky for a theme at a resolution is a pure function of (theme, W) — the
// paint is fully seeded (makeRng/makeNoise2D off `theme.seed`) — so it is baked
// once and shared. The texture is marked `userData.shared` and `rig.dispose()`
// deliberately leaves it alone; the cache is what owns it.
//
// BOUNDED, on purpose: three themes at one resolution is the steady state of a
// real session (~11 MB of canvas + 11 MB of GPU texture at 2048x1024 RGBA). The
// cap is 4 so a mid-session quality change can add one entry before the oldest
// is evicted, disposed, and its canvas backing store released.
const SKY_TEX = new Map();
// 10, and the number is the KEY SPACE, not the steady state. The key is
// (theme, res) and `applyTheme` picks the res from `q.texSize` — 2048 / 1536 /
// 1024 for the three tiers — so the game can legitimately ask for
// 3 themes x 3 tiers = 9 distinct skies in one session, plus the one the boot
// preview paints before a tier is chosen.
//
// Sizing this at the steady state of a single-tier session (four) was wrong, and
// wrong in the worst way: at a cap below the key space a player who nudges the
// quality toggle and keeps racing walks the cache round-robin, evicts the entry
// they are about to need next, and pays a full `paintSky` on every transition
// this fix promises is free. Measured on a nine-variant walk at a cap of six:
// nine repaints out of nine, 128-1045 ms each, reproducible. Bélády's worst
// case, and it is only reachable through the settings dialog, which is why a
// single-tier gate could not see it.
//
// A cap ABOVE the key space cannot thrash at all. The cost of the two spare
// slots is zero unless something fills them.
const SKY_TEX_MAX = 10;

function skyTexture(theme, W, H) {
  const key = theme.name + '|' + W;
  const hit = SKY_TEX.get(key);
  if (hit) { SKY_TEX.delete(key); SKY_TEX.set(key, hit); return hit; }   // LRU touch

  // No counter here — `paintSky` counts itself. See PERF_STATS.
  const tex = new THREE.CanvasTexture(paintSky(theme, W, H));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.name = 'sky:' + key;
  tex.userData.shared = true;
  tex.needsUpdate = true;

  while (SKY_TEX.size >= SKY_TEX_MAX) evictOldestSky();
  SKY_TEX.set(key, tex);
  return tex;
}

function releaseSky(tex) {
  // UNCONDITIONAL, and that is only safe because eviction is unreachable: the
  // cap is above the key space (see SKY_TEX_MAX) and the LRU keeps whatever is
  // on screen hot. If either of those ever stops being true, a sky still mapped
  // by a live mesh could be blanked here and that scene's dome would go white —
  // the fix then is a refcount, not a bigger cap.
  //
  // Zeroing the canvas first is what actually frees the 8 MB backing store;
  // Texture.dispose() only drops the GPU side.
  try { if (tex.image) { tex.image.width = 0; tex.image.height = 0; } } catch (e) { /* ignore */ }
  tex.dispose();
}

function evictOldestSky() {
  const k = SKY_TEX.keys().next().value;
  if (k === undefined) return;
  const t = SKY_TEX.get(k);
  SKY_TEX.delete(k);
  releaseSky(t);
}

/** Entries currently held by the sky cache — for gates and perf overlays. */
export function skyTextureCacheSize() { return SKY_TEX.size; }

/**
 * Drop every baked sky. EXPLICIT, and called from nothing the game runs: the
 * module previews below want a clean slate on teardown, the game does not, and
 * making every scene change pay for a preview's tidiness is the bug this whole
 * cache exists to fix.
 */
export function disposeSkyTextureCache() {
  for (const t of SKY_TEX.values()) releaseSky(t);
  SKY_TEX.clear();
}

// ---------------------------------------------------------------------------
// PUBLIC: SKY MESH
// ---------------------------------------------------------------------------

/**
 * Build the sky dome for a theme: one inverted sphere, one baked texture.
 * Depth testing is off and it renders first, so it is never clipped by a
 * scene's far plane and costs one fullscreen-ish draw.
 *
 * @param {string} themeName
 * @param {object} [opts] {res} horizontal texture resolution, {radius}
 * @returns {THREE.Mesh} with mesh.userData.theme / .fogColor
 */
export function createSky(themeName, opts = {}) {
  const theme = getTheme(themeName);
  const W = opts.res || 2048, H = W / 2;
  // Baked once per (theme, resolution) and shared across every scene that shows
  // this sky — see the SKY TEXTURE CACHE note above. The mesh, its geometry and
  // its material are still per-scene; only the painted pixels are shared.
  const tex = skyTexture(theme, W, H);

  const geo = new THREE.SphereGeometry(opts.radius || 500, 48, 32);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false,
    // three composites fog AFTER tone mapping and colour encoding, so a fog
    // colour lands on screen as its literal sRGB value. The sky therefore has
    // to skip tone mapping too — otherwise ACES darkens the painted horizon,
    // the fog does not follow it, and every distant silhouette ends on a
    // visible seam against the sky. Painted values are final pixels.
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.name = 'sky:' + theme.name;
  mesh.userData.theme = theme.name;
  mesh.userData.fogColor = theme.horizon;
  return mesh;
}

// ---------------------------------------------------------------------------
// PUBLIC: LIGHTING RIG
// ---------------------------------------------------------------------------

/**
 * Key + fill + hemisphere + fog for a theme.
 *
 * The shadow camera is deliberately *tight* (a ~34 m box that follows the
 * action via setShadowFocus). Sloppy ortho bounds are the number one cause of
 * blurry, crawling shadows — at 1024 px a 34 m box is 30 px/m, which is crisp.
 *
 * @param {string} themeName
 * @param {object} [engine] reads engine.q.{shadows,shadowSize,drawDistance}
 * @returns {{group, sun, fill, hemi, ambient, fog, theme, sunDir,
 *            setShadowFocus, update, dispose}}
 */
export function createLightingRig(themeName, engine) {
  const theme = getTheme(themeName);
  const q = engine?.q || { shadows: true, shadowSize: 2048, drawDistance: 700 };
  const L = theme.light;
  const group = new THREE.Group();
  group.name = 'rig:' + theme.name;

  const dir = sunDirection(theme.name);
  const SUN_DIST = 90;

  const sun = new THREE.DirectionalLight(L.key, L.keyI);
  sun.position.copy(dir).multiplyScalar(SUN_DIST);
  sun.target.position.set(0, 0, 0);
  group.add(sun, sun.target);

  if (q.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    // Half-extent of the shadowed box in metres. At 2048 this is 45 px/m, which
    // holds a crisp kart shadow; widening it to "be safe" is exactly what makes
    // shadows go soft and crawl, so it stays tight and follows the action.
    const r = 22;
    const c = sun.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.near = 1; c.far = SUN_DIST * 2.2;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2.2;            // PCFSoft tap radius
  }

  // Cool counter-light: no shadow, opposite side, gives the rim that separates
  // objects from the sky. Cheap and does most of the "3D" work on silhouettes.
  const fill = new THREE.DirectionalLight(L.fill, L.fillI);
  // Placed HIGH, not level. A cool fill that comes in near-horizontally from
  // the anti-sun side lands square on every vertical face turned away from the
  // key — kerb flanks, barrier faces, kart sides — and at that incidence it
  // overwhelms their albedo and paints them cornflower. Coming mostly from
  // above it does what a sky fill physically does: lifts the shadowed tops and
  // rims, and leaves the vertical faces to the warm ground bounce.
  fill.position.set(-dir.x * 45, 95, -dir.z * 45);
  group.add(fill, fill.target);

  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiI);
  hemi.position.set(0, 60, 0);
  group.add(hemi);

  const ambient = new THREE.AmbientLight(L.ambientColor ?? L.hemiSky, L.ambient);
  group.add(ambient);

  // Fog. Per-metre density is a property of the WEATHER, not of the machine:
  // it must NOT be scaled by q.drawDistance. Doing so gave the high tier 2.7x
  // less aerial perspective than the low tier — the exact inversion of what
  // you want, and it flattened the near/mid band into a two-layer poster.
  const fogColor = new THREE.Color(theme.horizon);
  const density = theme.fog.density;
  const fog = new THREE.FogExp2(fogColor, density);

  const focus = new THREE.Vector3();
  const rig = {
    theme, group, sun, fill, hemi, ambient, fog, sunDir: dir, sky: null,
    /** Re-centre the shadow box on the action (usually the player kart). */
    setShadowFocus(v) {
      focus.copy(v);
      sun.position.copy(dir).multiplyScalar(SUN_DIST).add(focus);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
    },
    /** Per-frame. Pass the camera so the sky dome stays centred on the viewer. */
    update(dt, camera) {
      if (rig.sky && camera) rig.sky.position.copy(camera.position);
    },
    dispose() {
      sun.shadow?.map?.dispose();
      if (rig.sky) {
        rig.sky.geometry.dispose();
        // The painted sky belongs to SKY_TEX, not to this rig — disposing it
        // here is exactly what made every scene entry repaint 2.1 M pixels.
        // Anything NOT from the cache (a caller who built its own) is still
        // this rig's to free.
        const map = rig.sky.material.map;
        if (map && !map.userData?.shared) map.dispose();
        rig.sky.material.dispose();
      }
      rig.env?.dispose();
    },
  };
  return rig;
}

// ---------------------------------------------------------------------------
// PUBLIC: APPLY
// ---------------------------------------------------------------------------

/**
 * Add sky + lights to a scene and set its fog. Returns the rig.
 * Call `rig.update(dt, camera)` each frame and `rig.dispose()` on teardown.
 */
export function applyTheme(scene, themeName, engine) {
  const theme = getTheme(themeName);
  const q = engine?.q || { texSize: 1024, reflections: true };
  const res = q.texSize >= 1024 ? 2048 : q.texSize >= 512 ? 1536 : 1024;
  const sky = createSky(theme.name, { res });
  const rig = createLightingRig(theme.name, engine);
  rig.sky = sky;
  scene.add(sky);
  scene.add(rig.group);
  scene.fog = rig.fog;
  scene.background = null;

  // Image-based fill from the sky itself. Makes metal and gloss pick up the
  // sunset instead of reading as flat plastic. High tier only — PMREM is the
  // one genuinely expensive thing in this file (~15 ms, once).
  if (q.reflections && engine?.renderer) {
    try {
      const pmrem = new THREE.PMREMGenerator(engine.renderer);
      const envScene = new THREE.Scene();
      const clone = new THREE.Mesh(sky.geometry, sky.material.clone());
      clone.material.depthTest = true;
      envScene.add(clone);
      const rt = pmrem.fromScene(envScene, 0, 0.1, 1000);
      scene.environment = rt.texture;
      // Low. At grazing angles a sky env sweeps a big luminance ramp across a
      // long flat road (sun side bright, opposite side crushed); above ~0.2 the
      // right-hand third of frame loses its asphalt texture entirely.
      scene.environmentIntensity = 0.14;
      rig.env = rt;
      clone.material.dispose();
      pmrem.dispose();
    } catch (e) { /* env is a bonus; never let it break a scene */ }
  }
  return rig;
}

// ===========================================================================
// PREVIEWS
// ===========================================================================

/**
 * Standard material from a texture bundle.
 *
 * `normals` is gated by tier on purpose. A per-texel normal map on a surface
 * viewed at a grazing angle is the single worst aliasing source in the scene:
 * on the low tier (256 px maps, no MSAA) it turns the road into a crawling
 * salt-and-pepper field. The albedo grain alone reads fine there.
 */
function stdMat(maps, extra = {}, normals = true) {
  return new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: normals ? (maps.normalMap || null) : null,
    roughnessMap: maps.roughnessMap || null,
    roughness: 1, metalness: 0, ...extra,
  });
}

function setRepeat(maps, u, v) {
  for (const t of Object.values(maps)) {
    if (t?.isTexture) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(u, v); }
  }
}

/**
 * Atmosphere demo scene. Ground plane in sand + an asphalt strip with kerbs,
 * blocky stand-ins marching away from the camera to show fog depth layering
 * and shadow quality, camera at driver eye height looking into the sun.
 */
function buildPreview(engine, themeName) {
  const theme = getTheme(themeName);
  const q = engine.q;
  const S = Math.min(q.texSize, 512);
  // Tier gate for normal maps — see stdMat().
  const NM = q.texSize >= 512;
  const scene = new THREE.Scene();
  const rig = applyTheme(scene, themeName, engine);
  const rng = makeRng(theme.seed + 7);
  const disposables = [];

  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.12, 2000);
  camera.position.set(1.2, 1.5, 16);
  const dir = rig.sunDir;
  // Look down the straight; the sun sits ~35 deg off to the left of frame.
  camera.lookAt(0, 32, -320);

  // --- ground -------------------------------------------------------------
  const groundTint = themeName === 'circuit' ? 0x3a3a44 : themeName === 'cloud' ? 0x9aa4b8 : undefined;
  const sand = themeName === 'oasis' ? sandTexture({ size: S })
    : themeName === 'cloud' ? sandTexture({ size: S, tint: 0xbfc2cf, ripple: 0.3 })
      : grassTexture({ size: S, tint: 0x2c3a2e, dry: 0.1 });
  setRepeat(sand, 140, 140);
  // Cloud Peak is a floating island: the ground stops short so the painted sea
  // of cloud tops below the horizon line is actually visible past its edge.
  const groundSize = theme.cloudSea ? 460 : 1400;
  // normalScale is pulled back: a 10 m sand tile seen at 2 deg grazing turns a
  // full-strength normal map into a crawling speckle band beside the kerb.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize),
    stdMat(sand, { color: groundTint, normalScale: new THREE.Vector2(0.55, 0.55) }, NM));
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = theme.cloudSea ? -180 : 0;
  ground.receiveShadow = q.shadows;
  scene.add(ground);

  // --- track ribbon -------------------------------------------------------
  const wet = themeName === 'circuit' ? 0.85 : 0;
  const asph = asphaltTexture({ size: q.texSize, wetness: wet, tint: wet ? 0x3a3d45 : 0x4f4c48 });
  // ~5.3 m square tiles. Big enough that the low-frequency patch variation is
  // not obviously repeating, small enough that a 1024 map still puts one
  // aggregate chip on roughly one 5 mm patch of road.
  setRepeat(asph, 3, 112);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(16, 600),
    stdMat(asph, { metalness: wet ? 0.25 : 0.0, normalScale: new THREE.Vector2(0.55, 0.55) }, NM));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -260);
  road.receiveShadow = q.shadows;
  scene.add(road);

  // white edge lines
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.9 });
  for (const sx of [-7.4, 7.4]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 600), lineMat);
    m.rotation.x = -Math.PI / 2; m.position.set(sx, 0.03, -260);
    scene.add(m);
  }

  // Kerbs. A BoxGeometry does NOT map one texture sanely onto all six faces:
  // on the top face v runs 600 m along the track, on the side faces v runs
  // 0.15 m up the kerb's flank. One shared material therefore squeezes 300
  // stripe repeats into a 15 cm strip, which minifies to a flat pink-grey
  // smear — from a driver's eye that band is half the kerb, and it is why the
  // kerb stopped reading as red/white. Top and sides get their own mapping.
  const curbTop = curbTexture({ size: S, stripes: 2, wear: 0.6, axis: 'v' });
  setRepeat(curbTop, 1, 300);          // 600 m / 300 = 2 m per tile = 1 m stripes
  const curbSide = curbTexture({ size: S, stripes: 2, wear: 0.85, axis: 'u', seed: 90 });
  setRepeat(curbSide, 300, 1);         // u runs along the track on the ±X faces
  const curbTopMat = stdMat(curbTop, {}, NM);
  const curbSideMat = stdMat(curbSide, {}, NM);
  // BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z
  const curbMats = [curbSideMat, curbSideMat, curbTopMat, curbTopMat, curbSideMat, curbSideMat];
  for (const sx of [-8.7, 8.7]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.15, 600), curbMats);
    m.position.set(sx, 0.075, -260);
    m.receiveShadow = q.shadows; m.castShadow = q.shadows;
    scene.add(m);
  }

  // --- stone barrier walls, near -> far (depth layer 1) -------------------
  // 3 courses over a 1.15 m wall and 4 columns over a 4 m tile gives roughly
  // 1.0 x 0.38 m blocks, which is what real kerb-side barriers look like.
  const wall = stoneWallTexture({ size: S, rows: 3, cols: 4 });
  setRepeat(wall, 140, 1);
  const wallMat = stdMat(wall, {}, NM);
  // Set back from the kerb on purpose. The key light is at 15 deg, so a 1.15 m
  // wall throws a 4.3 m shadow; at ±11.6 that shadow landed square on the
  // sunward kerb and the cool fill turned its white stripes blue. Track
  // furniture that is meant to be read has to stay out of the barrier's shade.
  for (const sx of [-13.2, 13.2]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.15, 560), wallMat);
    m.position.set(sx, 0.58, -250);
    m.castShadow = q.shadows; m.receiveShadow = q.shadows;
    scene.add(m);
  }

  // --- blocky stand-ins at graded distances (depth layers 2 & 3) ---------
  const rock = rockTexture({ size: S, tint: themeName === 'cloud' ? 0x8e8c9e : themeName === 'circuit' ? 0x4a4458 : 0xb0653c });
  setRepeat(rock, 3, 3);
  const rockMat = stdMat(rock, {}, NM);
  const woodM = stdMat(woodTexture({ size: S }), {}, NM);
  const metalM = stdMat(metalTexture({ size: S }), { metalness: 0.75, roughness: 0.5 }, NM);
  const stripes = stripeTexture({ size: 256, colors: [0xd94f3d, 0xf5ead6], count: 8 });
  stripes.repeat.set(3, 1);
  const stripeM = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.85, side: THREE.DoubleSide });

  const dists = [-22, -34, -50, -72, -102, -145, -205, -290, -400, -540];
  dists.forEach((z, i) => {
    const scale = 1 + i * 0.5;
    for (const side of [-1, 1]) {
      const w = rng.range(2.2, 4.0) * scale, hgt = rng.range(2.4, 6.5) * scale, dp = rng.range(2.0, 3.6) * scale;
      // keep the corridor clear so the eye runs all the way to the horizon
      const x = side * (16 + w * 0.5 + rng.range(1, 6) * scale);
      const mat = i < 2 ? (side < 0 ? woodM : metalM) : rockMat;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, dp), mat);
      m.position.set(x, hgt / 2, z + rng.range(-6, 6));
      m.rotation.y = rng.range(-0.4, 0.4);
      m.castShadow = q.shadows; m.receiveShadow = q.shadows;
      scene.add(m);
    }
  });

  // near hero blocks, off to one side: they catch the low key light and throw
  // the long raking shadows that sell the hour of day.
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), i === 1 ? metalM : rockMat);
    m.position.set(-11.0 - i * 2.2, 0.87, 6 - i * 5.5);
    m.rotation.y = rng.range(0, 1.2);
    m.castShadow = q.shadows; m.receiveShadow = q.shadows;
    scene.add(m);
  }

  // canopy on poles — fabric + wood, and a big shadow caster
  {
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.5), stripeM);
    canopy.rotation.x = -Math.PI / 2 + 0.14;
    canopy.position.set(-15.5, 3.1, -12);
    canopy.castShadow = q.shadows;
    scene.add(canopy);
    for (const [px, pz] of [[-18.6, -14], [-12.4, -14], [-18.6, -10], [-12.4, -10]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.1, 7), woodM);
      pole.position.set(px, 1.55, pz);
      pole.castShadow = q.shadows;
      scene.add(pole);
    }
  }

  // --- distant silhouette ranges (depth layers 4-6) -----------------------
  // Three rings at increasing distance. Each is flatter and closer in value to
  // the horizon colour than the last; fog then finishes the job. Stacking
  // silhouette layers like this is the cheapest depth cue in the whole engine.
  const farMats = [];
  const horizonCol = new THREE.Color(theme.horizon);
  [[380, 40, 0.06], [620, 95, 0.30], [950, 185, 0.58]].forEach(([dist, tall, blend], layer) => {
    const base = new THREE.Color(themeName === 'circuit' ? 0x2a2448 : themeName === 'cloud' ? 0x7d7f9a : 0xa05c33);
    const mat = new THREE.MeshStandardMaterial({
      color: base.lerp(horizonCol, blend), roughness: 1, metalness: 0, flatShading: true,
    });
    farMats.push(mat);
    const n = 16 - layer * 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.18, 0.18);
      const d = dist * rng.range(0.85, 1.25);
      const hgt = tall * rng.range(0.6, 1.35);
      const rB = hgt * rng.range(0.55, 1.1);
      // flat-topped mesas, not pyramids — canyon country, and the silhouette
      // stays legible once fog has eaten most of the value range
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rB * rng.range(0.15, 0.55), rB, hgt, 6, 1), mat);
      m.position.set(Math.sin(a) * d, hgt / 2 - hgt * 0.24, Math.cos(a) * d);
      m.rotation.y = rng() * 3;
      m.scale.set(rng.range(0.9, 1.5), 1, rng.range(0.9, 1.5));
      scene.add(m);
    }
  });

  // --- water: turquoise pool with animated offset -------------------------
  const water = waterTexture({ size: S });
  setRepeat(water, 6, 6);
  const waterMat = stdMat(water, { roughness: 0.12, metalness: 0.25 }, NM);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(13, 32), waterMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(29, 0.05, -40);
  scene.add(pool);

  const grass = grassTexture({ size: S });
  setRepeat(grass, 10, 10);
  const verge = new THREE.Mesh(new THREE.RingGeometry(12.5, 19, 32), stdMat(grass, {}, NM));
  verge.rotation.x = -Math.PI / 2;
  verge.position.set(29, 0.04, -40);
  verge.receiveShadow = q.shadows;
  scene.add(verge);

  // Marker posts on the sunward side of the track. Their whole job is to throw
  // long raking shadows across the asphalt so the shadow quality is judgeable.
  {
    const postGeo = new THREE.CylinderGeometry(0.10, 0.12, 3.2, 8);
    for (let i = 0; i < 5; i++) {
      const post = new THREE.Mesh(postGeo, woodM);
      post.position.set(-10.2, 1.6, 2 - i * 8);
      post.castShadow = q.shadows;
      scene.add(post);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), stripeM);
      flag.position.set(-9.6, 2.9, 2 - i * 8);
      flag.rotation.y = 0.35;
      flag.castShadow = q.shadows;
      scene.add(flag);
    }
  }

  // --- calibrated depth markers -------------------------------------------
  // Six IDENTICAL pillars — same geometry, same material, same orientation — at
  // known distances. Aerial perspective can only be judged if the thing being
  // faded is constant; with mixed materials at mixed depths you are guessing.
  const markerMat = new THREE.MeshStandardMaterial({ color: 0xb9b3aa, roughness: 0.85, metalness: 0 });
  const markerGeo = new THREE.BoxGeometry(3, 8, 3);
  const MARKER_DEPTHS = [25, 50, 100, 200, 400, 700];
  for (const d of MARKER_DEPTHS) {
    const m = new THREE.Mesh(markerGeo, markerMat);
    m.position.set(15.6, 4, -d);
    m.castShadow = q.shadows; m.receiveShadow = q.shadows;
    scene.add(m);
  }

  rig.setShadowFocus(new THREE.Vector3(0, 0, -10));

  let t = 0;
  return {
    scene, camera, rig,
    update(dt) {
      t += dt;
      water.map.offset.set(t * 0.012, t * 0.02);
      water.normalMap.offset.set(t * 0.012, t * 0.02);
      rig.update(dt, camera);
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() {
      rig.dispose();
      scene.traverse(o => { o.geometry?.dispose?.(); });
      markerGeo.dispose();
      for (const m of [lineMat, wallMat, rockMat, woodM, metalM, stripeM, waterMat, markerMat,
        curbTopMat, curbSideMat, ...farMats]) m.dispose();
      disposables.forEach(d => d.dispose?.());
      disposeTextureCache();
      disposeSkyTextureCache();
    },
  };
}

/** Oasis: desert canyon, golden hour. The Wave 1 look. */
export function preview(engine) { return buildPreview(engine, 'oasis'); }
/** Circuit City: neon night, rain-slick asphalt. */
export function previewCircuit(engine) { return buildPreview(engine, 'circuit'); }
/** Cloud Peak: dawn above a cloud sea. */
export function previewCloud(engine) { return buildPreview(engine, 'cloud'); }

// ---------------------------------------------------------------------------
// Texture inspector
// ---------------------------------------------------------------------------

function labelTexture(text) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#12131b'; ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#ffc247';
  ctx.font = 'bold 54px ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Every texture in the library laid out on a grid of camera-facing quads, each
 * shown at 2x2 tile repeat so seams (or the absence of them) are visible.
 */
export function previewTextures(engine) {
  const S = engine.q.texSize;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0f16);
  scene.add(new THREE.AmbientLight(0xffffff, 3.0));

  const items = TEXTURE_CATALOG.map(([name, make]) => [name, make(S)]);
  const cols = 6, rows = Math.ceil(items.length / cols);
  const cell = 2.4, gap = 0.42;
  const width = cols * (cell + gap), height = rows * (cell + gap + 0.5);

  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 100);
  camera.position.set(0, 0, 10);

  const quad = new THREE.PlaneGeometry(cell, cell);
  const labelGeo = new THREE.PlaneGeometry(cell, cell * 0.19);
  const mats = [], labels = [];

  items.forEach(([name, tex], i) => {
    const cx = i % cols, cy = Math.floor(i / cols);
    const x = -width / 2 + (cell + gap) / 2 + cx * (cell + gap) + gap / 2;
    const y = height / 2 - (cell + gap + 0.5) / 2 - cy * (cell + gap + 0.5) + 0.2;
    const t = tex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // Data maps (normal/roughness) are inspected 1:1 and forced through the
    // sRGB path so the quad shows their LITERAL bytes. Shown at 2x2 like the
    // colour maps they get minified and sRGB-lifted, and a perfectly good
    // normal map looks like flat lavender — a measurement artefact that will
    // send you off optimising a texture that was never broken.
    const isData = /\.(normal|rough)$/.test(name);
    t.repeat.set(isData ? 1 : 2, isData ? 1 : 2);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: t });
    mats.push(mat);
    const m = new THREE.Mesh(quad, mat);
    m.position.set(x, y, 0);
    scene.add(m);

    const lt = labelTexture(name);
    labels.push(lt);
    const lm = new THREE.MeshBasicMaterial({ map: lt });
    mats.push(lm);
    const l = new THREE.Mesh(labelGeo, lm);
    l.position.set(x, y - cell / 2 - cell * 0.13, 0);
    scene.add(l);
  });

  return {
    scene, camera,
    update() { },
    resize(w, h) {
      const aspect = w / h;
      const target = width / height;
      let vw = width, vh = height;
      if (aspect > target) vw = height * aspect; else vh = width / aspect;
      camera.left = -vw / 2; camera.right = vw / 2; camera.top = vh / 2; camera.bottom = -vh / 2;
      camera.updateProjectionMatrix();
    },
    dispose() {
      quad.dispose(); labelGeo.dispose();
      mats.forEach(m => { m.map?.dispose?.(); m.dispose(); });
      labels.forEach(t => t.dispose());
      disposeTextureCache();
      disposeSkyTextureCache();
    },
  };
}

// Silence unused-import lint in builds that tree-shake previews away.
void noiseTexture;

// Seeded PRNG (mulberry32). EVERY procedural generator must take an rng from here
// rather than Math.random, so screenshots and track layouts are reproducible and
// the visual critics compare like with like.
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  // Gaussian-ish, for natural scatter (clumping looks wrong for vegetation).
  r.gauss = () => (r() + r() + r() - 1.5) / 1.5;
  return r;
}

// Value noise on a seeded lattice — used by texture generators.
export function makeNoise2D(seed = 1) {
  const rng = makeRng(seed);
  const P = new Uint8Array(512);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = rng.int(0, i); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const A = P[X] + Y, B = P[X + 1] + Y;
    return (lerp(
      lerp(grad(P[A], x, y), grad(P[B], x - 1, y), u),
      lerp(grad(P[A + 1], x, y - 1), grad(P[B + 1], x - 1, y - 1), u), v) + 1) * 0.5;
  };
}

// Fractal brownian motion over the above. octaves 4-5 reads as natural grain.
export function fbm(noise, x, y, octaves = 4, lac = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp; amp *= gain; freq *= lac;
  }
  return sum / norm;
}

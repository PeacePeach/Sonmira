// Seeded value noise and fractal sums. Pure JS, deterministic per seed.
import { rng } from '../render/rng.js';

export function makeNoise(seed) {
  const r = rng(seed);
  const perm = new Uint16Array(512), vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const at = (x, y) => vals[perm[(perm[x & 255] + y) & 511]];
  // 2D value noise in [0,1] with quintic smoothing.
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let s = 0, amp = 1, norm = 0;
    for (let o = 0; o < oct; o++) { s += amp * noise(x, y); norm += amp; x *= lac; y *= lac; amp *= gain; }
    return s / norm;
  }
  return { noise, fbm };
}

// Fills a w×h field with fbm sampled at `scale` pixels per noise cell,
// stretched to roughly 0..1.
export function field(w, h, seed, scale, oct = 4, stretch = 2.2) {
  const { fbm } = makeNoise(seed);
  const out = new Float32Array(w * h);
  // Rotated sampling hides the grid alignment of value noise.
  const ca = Math.cos(0.61), sa = Math.sin(0.61);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x * ca - y * sa) / scale + 97, v0 = (x * sa + y * ca) / scale + 31;
    const v = (fbm(u, v0, oct) - 0.5) * stretch + 0.5;
    out[y * w + x] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

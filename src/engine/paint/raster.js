// Minimal raster toolkit: coverage masks, polygon fill, dab stamping and
// separable box blur. Masks are Float32Array over a bounding box.

export class Mask {
  constructor(x0, y0, w, h) {
    this.x0 = x0; this.y0 = y0; this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.d = new Float32Array(this.w * this.h);
  }
  static around(minX, minY, maxX, maxY, pad, W, H) {
    const x0 = Math.max(0, Math.floor(minX - pad)), y0 = Math.max(0, Math.floor(minY - pad));
    const x1 = Math.min(W, Math.ceil(maxX + pad)), y1 = Math.min(H, Math.ceil(maxY + pad));
    return new Mask(x0, y0, x1 - x0, y1 - y0);
  }
  get(x, y) { // canvas coords, bilinear, 0 outside
    const fx = x - this.x0, fy = y - this.y0;
    if (fx < 0 || fy < 0 || fx > this.w - 1 || fy > this.h - 1) return 0;
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, w = this.w, d = this.d;
    const i = iy * w + ix, ix1 = ix + 1 < w ? 1 : 0, iy1 = iy + 1 < this.h ? w : 0;
    const a = d[i], b = d[i + ix1], c = d[i + iy1], e = d[i + ix1 + iy1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
  }
  clone() { const m = new Mask(this.x0, this.y0, this.w, this.h); m.d.set(this.d); return m; }
}

// Even-odd scanline fill of a polygon (canvas pixel coords) with value v (max-blend).
export function fillPolygon(m, pts, v = 1) {
  const n = pts.length;
  if (n < 3) return;
  const xs = [];
  for (let y = 0; y < m.h; y++) {
    const cy = m.y0 + y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - m.x0 - 0.5)), b = Math.min(m.w - 1, Math.floor(xs[k + 1] - m.x0 - 0.5));
      const row = y * m.w;
      for (let x = a; x <= b; x++) if (m.d[row + x] < v) m.d[row + x] = v;
    }
  }
}

// Round dab of radius r at (cx, cy), soft 1px rim, max-blend.
export function stampDisc(m, cx, cy, r, v = 1) {
  const x0 = Math.max(0, Math.floor(cx - r - 1 - m.x0)), x1 = Math.min(m.w - 1, Math.ceil(cx + r + 1 - m.x0));
  const y0 = Math.max(0, Math.floor(cy - r - 1 - m.y0)), y1 = Math.min(m.h - 1, Math.ceil(cy + r + 1 - m.y0));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + m.x0 + 0.5 - cx, dy = y + m.y0 + 0.5 - cy;
    const a = Math.min(1, Math.max(0, r + 0.5 - Math.sqrt(dx * dx + dy * dy))) * v;
    const i = y * m.w + x;
    if (m.d[i] < a) m.d[i] = a;
  }
}

function boxPass(src, dst, w, h, r, horizontal) {
  const n = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 1 : w, lineStep = horizontal ? w : 1;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    // zero outside the mask, so blurred shapes fade out instead of smearing the border
    let acc = 0;
    for (let k = 0; k <= r && k < n; k++) acc += src[base + k * step];
    for (let i = 0; i < n; i++) {
      dst[base + i * step] = acc * inv;
      const add = i + r + 1, sub = i - r;
      if (add < n) acc += src[base + add * step];
      if (sub >= 0) acc -= src[base + sub * step];
    }
  }
}

// A copy of m enlarged by `pad` px on each side (clipped to the canvas).
export function grow(m, pad, W, H) {
  const x0 = Math.max(0, m.x0 - pad), y0 = Math.max(0, m.y0 - pad);
  const x1 = Math.min(W, m.x0 + m.w + pad), y1 = Math.min(H, m.y0 + m.h + pad);
  if (x0 === m.x0 && y0 === m.y0 && x1 === m.x0 + m.w && y1 === m.y0 + m.h) return m;
  const g = new Mask(x0, y0, x1 - x0, y1 - y0);
  for (let y = 0; y < m.h; y++) g.d.set(m.d.subarray(y * m.w, (y + 1) * m.w), (y + m.y0 - y0) * g.w + (m.x0 - x0));
  return g;
}

// Approximate Gaussian blur (three box passes) in place.
export function blur(m, radius) {
  const r = Math.round(radius);
  if (r < 1) return m;
  const tmp = new Float32Array(m.d.length);
  const rr = Math.max(1, Math.round(r / Math.sqrt(3)));
  for (let k = 0; k < 3; k++) { boxPass(m.d, tmp, m.w, m.h, rr, true); boxPass(tmp, m.d, m.w, m.h, rr, false); }
  return m;
}

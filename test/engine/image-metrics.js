// Simple image measurements used by engine tests and the QA tool.
// img: { width, height, rgba }

export function luminance({ width, height, rgba }) {
  const L = new Float32Array(width * height);
  for (let i = 0; i < L.length; i++) L[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  return L;
}

function downsample(L, w, h, f) {
  const W = Math.floor(w / f), H = Math.floor(h / f), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += L[(y * f + j) * w + x * f + i];
    out[y * W + x] = s / (f * f);
  }
  return { d: out, w: W, h: H };
}

const pct = (arr, q) => { const s = Float32Array.from(arr).sort(); return s[Math.floor((s.length - 1) * q)]; };

// Saturation (HSV) at the given percentile over the painted area.
export function saturationPct(img, q = 0.99) {
  const { rgba } = img, n = rgba.length / 4, s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    s[i] = mx ? (mx - mn) / mx : 0;
  }
  return pct(s, q);
}

// Large-scale value contrast: p95 - p5 of 1/8-scale lightness.
export function formContrast(img) {
  const { d } = downsample(luminance(img), img.width, img.height, 8);
  return pct(d, 0.95) - pct(d, 0.05);
}

// Edge definition at form scale: mean gradient of 1/4-scale lightness,
// ignoring the finest texture (grain, spatter).
export function formEdges(img) {
  const { d, w, h } = downsample(luminance(img), img.width, img.height, 4);
  let s = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    s += Math.abs(d[y * w + x + 1] - d[y * w + x - 1]) + Math.abs(d[(y + 1) * w + x] - d[(y - 1) * w + x]); n++;
  }
  return s / n;
}

// Share of pixels whose bytes differ between two images.
export function differs(a, b) {
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) if (Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]) > 6) n++;
  return n / (a.rgba.length / 4);
}

// Pearson correlation of 1/8-scale lightness: how closely the large forms
// of `a` follow those of `b` (used to check that lower control dissolves the
// composition that higher control states clearly).
export function formCorrelation(a, b) {
  const A = downsample(luminance(a), a.width, a.height, 8).d, B = downsample(luminance(b), b.width, b.height, 8).d;
  let ma = 0, mb = 0;
  for (let i = 0; i < A.length; i++) { ma += A[i]; mb += B[i]; }
  ma /= A.length; mb /= B.length;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < A.length; i++) { const x = A[i] - ma, y = B[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb || 1);
}

// Motif geometry helpers. All coordinates are normalised: x as a fraction of
// width, y as a fraction of height; sizes as fractions of width.

const TAU = Math.PI * 2;

// Organic closed blob around (cx, cy).
export function blob(cx, cy, rx, ry, r, lumps = 7, rough = 0.18, n = 28) {
  const ph = Array.from({ length: 3 }, () => r() * TAU);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + rough * (Math.sin(a * lumps * 0.5 + ph[0]) * 0.5 + Math.sin(a * lumps + ph[1]) * 0.35 + Math.sin(a * 2 + ph[2]) * 0.4);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

export const ellipse = (cx, cy, rx, ry, n = 36) =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * TAU) * rx, cy + Math.sin((i / n) * TAU) * ry]);

export const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// Horizontal band between two gently waving edges, full width (overscanned).
export function band(y0, y1, r, wave = 0.01, n = 24) {
  const p0 = r() * TAU, p1 = r() * TAU, f0 = 1.5 + r() * 2, f1 = 1.5 + r() * 2;
  const top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const x = -0.05 + (1.1 * i) / n;
    top.push([x, y0 + Math.sin(x * f0 * TAU + p0) * wave]);
    bot.push([x, y1 + Math.sin(x * f1 * TAU + p1) * wave]);
  }
  return [...top, ...bot.reverse()];
}

// Ridge from a 1-D sum of sines, filled down to `bottom`.
export function ridge(base, amp, r, { x0 = -0.05, x1 = 1.05, bottom = 1.05, n = 48, freq = 1, sharp = 0 } = {}) {
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    let h = Math.sin(x * 2.1 * freq * TAU / 2 + ph[0]) * 0.55 + Math.sin(x * 5.3 * freq + ph[1]) * 0.3 + Math.sin(x * 11.7 * freq + ph[2]) * 0.15;
    if (sharp) h = h * (1 - sharp) + (1 - Math.abs(h)) * sharp * Math.sign(h + 1e-9);
    pts.push([x, base - h * amp]);
  }
  return [...pts, [x1, bottom], [x0, bottom]];
}

// Narrow conifer: jagged tiers from apex to base. w in x-units, h in y-units.
export function conifer(cx, baseY, w, h, r) {
  const tiers = 5, right = [], left = [];
  for (let t = 1; t <= tiers; t++) {
    const y = baseY - h * (1 - t / tiers), half = (w / 2) * (t / tiers) * (0.85 + r() * 0.3);
    right.push([cx + half * 0.5, y - h * 0.05], [cx + half, y]);
    left.unshift([cx - half, y], [cx - half * 0.5, y - h * 0.05]);
  }
  return [[cx, baseY - h], ...right, [cx + w * 0.05, baseY + h * 0.04], [cx - w * 0.05, baseY + h * 0.04], ...left];
}

// Small standing figure: head + tapered body. h is height in y-units,
// A the sheet aspect (H/W) so the figure keeps human proportions.
export function figure(cx, footY, h, A, lean = 0) {
  const w = h * A * 0.24; // shoulder width in x-units
  const body = [
    [cx - w * 0.5 + lean * w, footY - h * 0.8], [cx + w * 0.5 + lean * w, footY - h * 0.8],
    [cx + w * 0.42, footY - h * 0.38], [cx + w * 0.26, footY], [cx + w * 0.04, footY],
    [cx, footY - h * 0.32], [cx - w * 0.04, footY], [cx - w * 0.26, footY], [cx - w * 0.42, footY - h * 0.38],
  ];
  return { body, head: [cx + lean * w * 1.1, footY - h * 0.9, w * 0.3] };
}

// Small boat hull seen from the side.
export function hull(cx, cy, len, depth) {
  return [[cx - len / 2, cy - depth * 0.3], [cx + len / 2, cy - depth * 0.45], [cx + len * 0.38, cy + depth * 0.5], [cx - len * 0.36, cy + depth * 0.45]];
}

// Polyline of a curving ribbon centreline (for rivers, paths, shorelines).
export function curve(points, n = 40) {
  // Catmull-Rom through control points.
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.ceil(n / (points.length - 1));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// Ribbon polygon around a centreline with widths w0 → w1 (x-units).
export function ribbon(line, w0, w1) {
  const L = [], R = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
    const w = (w0 + (w1 - w0) * (i / (line.length - 1))) / 2;
    L.push([line[i][0] + nx * w, line[i][1] + ny * w]); R.push([line[i][0] - nx * w, line[i][1] - ny * w]);
  }
  return [...L, ...R.reverse()];
}

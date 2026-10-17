// Paints a motif at a given vocal-control style onto procedural paper.
// Output: { width, height, rgba } (sRGB bytes).

import { Sheet } from './sheet.js';
import { fillPolygon, stampDisc, blur, grow, Mask } from './raster.js';
import { makeNoise } from './noise.js';
import { rng } from '../render/rng.js';
import { MOTIF_BUILDERS } from './motifs.js';
import { blob } from './shapes.js';
import { styleFor } from './style.js';
import { paletteFor } from '../art/palettes.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Subdivide a polyline/polygon so that wobble applies along its length.
function subdivide(pts, maxSeg, closed) {
  const out = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg));
    for (let s = 0; s < steps; s++) out.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}

function extent(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1, size: Math.max(x1 - x0, y1 - y0) };
}

// Displace the points of a shape: drift of the whole shape (scatter) plus
// smooth wobble along its outline (jitter). Both shrink as control rises.
function loosen(pts, st, r, noise, role, closed, A) {
  if (role === 'ground') return pts;
  const e = extent(pts);
  const sizeK = Math.min(1, Math.max(0.2, e.size / 0.3));
  const j = st.jitter * sizeK * (closed ? 1 : 0.4), sc = st.scatter * (role === 'structure' ? 0.7 : 1);
  const tx = (r() - 0.5) * 2 * sc, ty = ((r() - 0.5) * 2 * sc) / A, rot = (r() - 0.5) * sc * 2.5;
  const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2;
  const fine = subdivide(pts, 0.012, closed);
  const off = r() * 100;
  return fine.map(([x, y], i) => {
    const dx = x - cx, dy = (y - cy) * A;
    const rx = cx + dx * Math.cos(rot) - dy * Math.sin(rot) + tx, ry = cy + (dx * Math.sin(rot) + dy * Math.cos(rot)) / A + ty;
    const t = i * (closed ? 0.35 : 0.12) + off;
    return [rx + (noise(t, 1.7) - 0.5) * 2 * j, ry + ((noise(t, 9.3) - 0.5) * 2 * j) / A];
  });
}

function opacityFor(el, st, pal) {
  const vis = st.visibility[el.role] ?? 1;
  let a = el.alpha * vis;
  if (el.role === 'accent') a *= pal.contrast;
  return a;
}

export function paintScene({ motif = 'abstract', emotion = 'tender', control = 0.5, seed = 1, width = 720, height = 900 }) {
  const r = rng(seed), A = height / width;
  const st = styleFor(control);
  const pal = paletteFor(emotion, motif, rng(seed ^ 0x9e3779b9));
  const sheet = new Sheet(width, height, seed);
  const k = sheet.k;
  const { noise } = makeNoise(seed + 11);
  const scene = (MOTIF_BUILDERS[motif] || MOTIF_BUILDERS.abstract)(rng(seed + 101), A);
  const color = (c) => (typeof c === 'string' ? pal.slots[c] : c);
  const px = (pts) => pts.map(([x, y]) => [x * width, y * height]);
  let layer = 0;

  const glazeMask = (m, el, opacity, extra = {}) => {
    // Thin shapes (frames, stems) wander less than big washes.
    const thin = el._thin ?? 1;
    const vis = st.visibility[el.role] ?? 1;
    // Emerging forms (partly visible) are also softer.
    const softMul = (el.soft ?? 1) * (1 + (1 - vis) * 1.6);
    const rad = Math.max(st.softPx * k * softMul, (el.minBlur ?? 0) * k), wobble = st.wobblePx * k * thin * (el.role === 'detail' || el.kind === 'line' ? 0.3 : el.role === 'focal' ? 0.6 : 1);
    m = grow(m, Math.ceil(rad * 2.2 + wobble + 12 * k), width, height);
    blur(m, rad);
    sheet.glaze(m, {
      color: color(el.color), opacity, seed: ++layer,
      edge: st.edge * (el.edge ?? 1), rim: (4 + 6 * st.bleed) * k,
      gran: st.granulation * (el.gran ?? 1), bloom: st.bloom, wobble,
      frag: st.fragment > 0.05 && el.role !== 'detail' && el.role !== 'ground' ? { t: st.fragment, soft: 0.1 } : null,
      dry: el.dry ? el.dry * (0.6 + 0.4 * st.legibility) : 0,
      fade: el.fade, ...extra,
    });
    // Wet-in-wet halo: pigment creeping out into damp paper.
    if (st.bleed > 0.7 && el.role !== 'detail' && el.kind === 'wash') {
      const r2 = rad * 2.2 + 4 * k;
      m = grow(m, Math.ceil(r2 * 2.2), width, height);
      blur(m, r2);
      sheet.glaze(m, { color: color(el.color), opacity: opacity * 0.22 * st.bleed, seed: ++layer, edge: 0, gran: st.granulation * 0.5, bloom: st.bloom, fade: el.fade });
    }
  };

  // Loose takes: free, unbounded washes in the motif's colours replace part
  // of the drawn composition (painted right after the ground).
  const free = [];
  for (let i = 0; i < st.freeWashes; i++) {
    const horiz = scene.flow === 'horizontal', cx = 0.1 + r() * 0.8, cy = 0.1 + r() * 0.8;
    const rx = horiz ? 0.2 + r() * 0.25 : 0.1 + r() * 0.15, ry = (horiz ? 0.05 + r() * 0.07 : 0.12 + r() * 0.15);
    free.push({ kind: 'wash', role: 'structure', pts: blob(cx, cy, rx, ry, r, 5 + Math.floor(r() * 5), 0.35), color: [scene.main, 'water', 'warm', 'light'][i % 4], alpha: 0.26 + r() * 0.16, soft: 1.3 });
  }
  const els = scene.elements.slice();
  const firstNonGround = Math.max(0, els.findIndex((e) => e.role !== 'ground'));
  els.splice(firstNonGround, 0, ...free);

  for (let el of els) {
    const opacity = opacityFor(el, st, pal);
    if (opacity < 0.02 || (el.kind === 'lift' && (st.visibility[el.role] ?? 1) < 0.05)) continue;
    if (el.kind === 'wash') {
      const rings = (el.rings || [el.pts]).map((p) => px(loosen(p, st, r, noise, el.role, true, A)));
      const all = rings.flat();
      const e = extent(all);
      const pad = (st.softPx * 7 + 30) * k;
      const m = sheet.mask(e.x0, e.y0, e.x1, e.y1, pad);
      fillRings(m, rings);
      el = { ...el, _thin: Math.min(1, Math.max(0.15, Math.min(e.x1 - e.x0, e.y1 - e.y0) / (0.12 * width))) };
      const passes = el.role === 'structure' || el.role === 'focal' ? st.layers : 1;
      glazeMask(m.clone(), el, opacity);
      if (passes > 1) { // second, smaller glaze for depth and a crisper inner edge
        const m2 = m.clone(); blur(m2, 3 * k);
        for (let i = 0; i < m2.d.length; i++) m2.d[i] = clamp01((m2.d[i] - 0.55) * 2.5);
        glazeMask(m2, { ...el, soft: (el.soft ?? 1) * 0.5 }, opacity * 0.35);
      }
    } else if (el.kind === 'line') {
      const pts = px(loosen(el.pts, st, r, noise, el.role, false, A));
      const m = strokeMask(sheet, pts, el.width * width, el.taper, r);
      glazeMask(m, { ...el, soft: (el.soft ?? 0.25) }, opacity, { edge: 0.2 });
    } else if (el.kind === 'dots' || el.kind === 'lift') {
      const e = extent(el.dots.map(([x, y]) => [x, y]));
      const sc = st.scatter * (el.role === 'ground' ? 0 : 1);
      const m = sheet.mask(e.x0 * width, e.y0 * height, e.x1 * width, e.y1 * height, 0.08 * width + st.scatter * width + 30 * k);
      for (const [x, y, rad] of el.dots) {
        const dx = (r() - 0.5) * 2 * sc * width, dy = (r() - 0.5) * 2 * sc * width;
        stampDisc(m, x * width + dx, y * height + dy, rad * width * (1 + (r() - 0.5) * 0.3));
      }
      if (el.kind === 'lift') { blur(m, (el.soft ?? 1) * 1.5 * k); sheet.lift(m, el.amount * (st.visibility[el.role] ?? 1)); }
      else glazeMask(m, el, opacity);
    }
  }

  freeMarks(sheet, st, pal, scene, r, noise);
  reserveMargin(sheet, st, r);
  return { width, height, rgba: sheet.toRGBA(), palette: pal, style: st, focus: scene.focus };
}

function fillRings(m, rings) {
  if (rings.length === 1) { fillPolygon(m, rings[0]); return; }
  // even-odd over all rings: fill outer, then subtract inner rings
  fillPolygon(m, rings[0]);
  for (const ring of rings.slice(1)) {
    const hole = new Mask(m.x0, m.y0, m.w, m.h); fillPolygon(hole, ring);
    for (let i = 0; i < m.d.length; i++) m.d[i] = Math.max(0, m.d[i] - hole.d[i]);
  }
}

// Imperfect brush line: dabs along the path with pressure that swells and
// tapers, plus a little tremor.
function strokeMask(sheet, pts, w, taper = [1, 1], r) {
  const e = extent(pts);
  const m = sheet.mask(e.x0, e.y0, e.x1, e.y1, w * 2 + 20 * sheet.k);
  const fine = subdivide(pts, Math.max(1, w * 0.4), false);
  const ph = r() * 6;
  fine.forEach(([x, y], i) => {
    const t = i / Math.max(1, fine.length - 1);
    const pressure = (taper[0] + (taper[1] - taper[0]) * t) * (0.75 + 0.25 * Math.sin(t * 9 + ph)) * Math.min(1, t * 8 + 0.3, (1 - t) * 8 + 0.3);
    stampDisc(sheet ? m : m, x, y, Math.max(0.6, (w / 2) * pressure));
  });
  return m;
}

// Marks that stand in for drawn form when control is low (scribbles, drips),
// and spatter/sparkle that runs through every tier in small amounts.
function freeMarks(sheet, st, pal, scene, r, noise) {
  const { W, H, k } = sheet;
  const cols = [pal.slots.deep, pal.slots[scene.main] || pal.slots.water, pal.slots.warm];
  // Gestural scribbles: loops and dashes laid over the washes.
  for (let g = 0; g < st.gestures; g++) {
    let x = (0.1 + r() * 0.8) * W, y = (0.1 + r() * 0.8) * H, a = r() * Math.PI * 2;
    const pts = [], len = 18 + Math.floor(r() * 30), curl = (r() - 0.5) * 0.5, step = (5 + r() * 6) * k;
    for (let i = 0; i < len; i++) {
      a += curl + (noise(i * 0.2 + g * 13, 3.3) - 0.5) * 0.9;
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      pts.push([x, y]);
    }
    const m = strokeMask(sheet, pts, (3 + r() * 2.5) * k, [0.6, 1], r);
    blur(m, 0.8 * k);
    sheet.glaze(m, { color: cols[g % cols.length], opacity: 0.32 + r() * 0.15, seed: 900 + g, edge: 0, gran: 0.4, bloom: 0.2, dry: 0.3 });
  }
  // Drips: pigment run down from the washes (vertical motifs drip more).
  const drips = scene.main === 'foliage' ? Math.round(st.drips * 1.5) : 0;
  for (let d = 0; d < drips; d++) {
    const x = (0.06 + r() * 0.88) * W, y0 = (0.1 + r() * 0.5) * H, len = (0.12 + r() * 0.3) * H, w = (7 + r() * 6) * k;
    const pts = [[x, y0], [x + (r() - 0.5) * 6 * k, y0 + len * 0.5], [x + (r() - 0.5) * 8 * k, y0 + len]];
    const m = strokeMask(sheet, pts, w, [1.2, 0.7], r);
    stampDisc(m, pts[2][0], pts[2][1], w * 0.9);
    blur(m, 1.2 * k);
    sheet.glaze(m, { color: cols[d % 2], opacity: 0.28, seed: 1200 + d, edge: 0.9, rim: 3 * k, gran: 0.3, bloom: 0.2, wobble: 3 * k });
  }
  // Spatter around the focal area.
  const [fx, fy] = scene.focus;
  const m = sheet.mask(0, 0, W, H, 0);
  for (let s = 0; s < st.spatter; s++) {
    const ang = r() * Math.PI * 2, dist = Math.abs(r() + r() - 1) * 0.45;
    stampDisc(m, (fx + Math.cos(ang) * dist) * W, (fy + Math.sin(ang) * dist * 0.8) * H, (0.6 + r() * r() * 3.2) * k);
  }
  sheet.glaze(m, { color: pal.slots.deep, opacity: 0.5, seed: 1500, edge: 0.4, rim: 1.5 * k, gran: 0.2, bloom: 0.1 });
}

// Irregular paper margin left unpainted, as on a real sheet.
function reserveMargin(sheet, st, r) {
  const { W, H, k } = sheet;
  const inset = (0.03 + 0.015 * r()) * W;
  const m = new Mask(0, 0, W, H);
  fillPolygon(m, [[inset, inset], [W - inset, inset], [W - inset, H - inset], [inset, H - inset]]);
  blur(m, (4 + 10 * st.bleed) * k);
  const keep = new Mask(0, 0, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const wob = sheet.dx[i] - 0.5;
    keep.d[i] = clamp01(1 - (m.d[i] + wob * 0.9 * (1 - m.d[i] * m.d[i])));
  }
  sheet.lift(keep, 0.92);
}

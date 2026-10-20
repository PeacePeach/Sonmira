// The share video's painting animation: the finished painting is painted
// onto its blank paper, stroke by stroke, in its own colours. Nothing new is
// made: every stroke reveals the finished painting itself, first through a
// soft, blurred copy of it (a first wash of its colours), then a lightly
// blurred one (the body), then the sharp painting (details, edges last). The
// strokes follow the painting's own contours (its structure tensor), go
// light to dark, and travel across the paper from one stroke to the nearest
// next, like one hand at work. The last strokes settle into the exact
// finished painting, so the video's second half is the painting itself.
// Deterministic: the same painting always paints the same way.

import { grain } from './compose.js';
import { rng } from '../../engine/render/rng.js';

/** The painting is finished at this share of the recording. */
export const PAINT_UNTIL = 0.5;

// Brush sizes as a share of the painting's size (√(w·h)); `from`/`to` are
// when the layer paints, as a share of the painting time.
const LAYERS = [
  { plate: 'wash', size: 0.11, spacing: 0.85, steps: 9, alpha: 0.42, from: 0, to: 0.4, order: 'light' },
  { plate: 'body', size: 0.045, spacing: 0.9, steps: 10, alpha: 0.55, from: 0.22, to: 0.74, order: 'light' },
  { plate: 'sharp', size: 0.019, spacing: 1, steps: 7, alpha: 0.8, from: 0.55, to: 0.94, order: 'detail' },
];
const SETTLE_FROM = 0.88; // then any paper left between strokes takes the painting
const TIPS = 4;
const DAB = 6; // floats per dab: x, y, radius, angle, alpha, time

const PAPER = [0xf7, 0xf4, 0xee]; // white watercolour paper
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Strokes for a painting, from a small copy of it. Pure (no canvas), so it is
 * tested on its own.
 * @param {{data: Uint8ClampedArray|number[], width:number, height:number}} px  the painting, small (about 160 px wide)
 * @param {number} W  the painting's width on the video, px
 * @param {number} H  its height
 * @returns {{dabs: Float32Array, tips: Uint8Array, layers: {plate:string, start:number, end:number}[], paper:number[]}}
 *   dabs in paint order, DAB floats each; layers index into them (in dabs);
 *   paper is the blank canvas's colour (r, g, b).
 */
export function planStrokes(px, W, H) {
  const { width: aw, height: ah, data } = px;
  const n = aw * ah;
  let seed = 2166136261;
  for (let i = 0; i < data.length; i += 7) seed = Math.imul(seed ^ data[i], 16777619);
  const rand = rng(seed);

  // Lightness, its gradient, and the structure tensor: which way the
  // painting's forms run at each point, and how clearly.
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  const at = (x, y) => L[Math.min(ah - 1, Math.max(0, y)) * aw + Math.min(aw - 1, Math.max(0, x))];
  const jxx = new Float32Array(n), jyy = new Float32Array(n), jxy = new Float32Array(n), mag = new Float32Array(n);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    const i = y * aw + x;
    jxx[i] = gx * gx; jyy[i] = gy * gy; jxy[i] = gx * gy; mag[i] = Math.hypot(gx, gy);
  }
  const blur = (a, r) => { // box blur, both ways
    const t = new Float32Array(n), o = new Float32Array(n);
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(aw - 1, x + r); k++) { s += a[y * aw + k]; c++; }
      t[y * aw + x] = s / c;
    }
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(ah - 1, y + r); k++) { s += t[k * aw + x]; c++; }
      o[y * aw + x] = s / c;
    }
    return o;
  };
  const r = Math.max(2, Math.round(aw / 40));
  const sxx = blur(jxx, r), syy = blur(jyy, r), sxy = blur(jxy, r), detail = blur(mag, 1);
  // The painting's own paper: its lightest colour (the blank canvas the
  // video starts on), and how far each area is from it (how much paint).
  const byLight = Array.from(L.keys()).sort((a, b) => L[b] - L[a]).slice(0, Math.max(1, Math.floor(n * 0.05)));
  let paper = [0, 1, 2].map((k) => byLight.reduce((s, i) => s + data[i * 4 + k], 0) / byLight.length);
  // A painting with no white paper of its own starts on plain white paper.
  if ((0.2126 * paper[0] + 0.7152 * paper[1] + 0.0722 * paper[2]) / 255 < 0.86 || Math.max(...paper) - Math.min(...paper) > 22) paper = PAPER;
  const ink = new Float32Array(n);
  for (let i = 0; i < n; i++) ink[i] = Math.hypot(data[i * 4] - paper[0], data[i * 4 + 1] - paper[1], data[i * 4 + 2] - paper[2]) / 255;
  const soft = blur(ink, r);
  const sorted = Float32Array.from(detail).sort();
  const dRef = Math.max(1e-3, sorted[Math.floor(n * 0.9)]);
  const field = (x, y) => {
    const i = Math.min(ah - 1, Math.max(0, Math.floor((y / H) * ah))) * aw + Math.min(aw - 1, Math.max(0, Math.floor((x / W) * aw)));
    const a = sxx[i], b = syy[i], c = sxy[i], d = Math.hypot(a - b, 2 * c);
    return {
      along: 0.5 * Math.atan2(2 * c, a - b) + Math.PI / 2, // across the gradient: along the form
      clear: a + b > 1e-6 ? d / (a + b) : 0,
      detail: Math.min(1, detail[i] / dRef),
      ink: soft[i],
    };
  };

  const unit = Math.sqrt(W * H), hand = -0.45; // a right hand's slight diagonal
  const out = [], tips = [], layers = [];
  for (const spec of LAYERS) {
    const R0 = spec.size * unit, gap = R0 * spec.spacing;
    // Brush centres on a jittered grid that covers the whole painting.
    const strokes = [];
    for (let y = gap / 2; y < H + gap / 2; y += gap) for (let x = gap / 2; x < W + gap / 2; x += gap) {
      const cx = x + (rand() - 0.5) * gap * 0.8, cy = y + (rand() - 0.5) * gap * 0.8;
      const f = field(cx, cy);
      if (spec.order === 'detail' ? rand() > 0.3 + 0.7 * f.detail : f.ink < 0.04) continue; // paint only where there is paint
      strokes.push({ x: cx, y: cy, f, R: spec.order === 'detail' ? R0 * (1.35 - 0.6 * f.detail) : R0 * (0.85 + rand() * 0.3) });
    }
    // Light to dark (washes) or quiet to busy (details), in bands; within a
    // band, always the nearest stroke next.
    const key = (s) => (spec.order === 'detail' ? s.f.detail : s.f.ink);
    const keys = strokes.map(key), lo = Math.min(...keys), span = Math.max(...keys) - lo;
    const cut = [lo + span / 3, lo + (2 * span) / 3];
    const bands = [[], [], []];
    for (const s of strokes) bands[key(s) < cut[0] ? 0 : key(s) < cut[1] ? 1 : 2].push(s);
    const ordered = [];
    let px0 = W * 0.5, py0 = 0;
    for (const band of bands) {
      const left = band.slice();
      while (left.length) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < left.length; i++) { const d = (left[i].x - px0) ** 2 + (left[i].y - py0) ** 2; if (d < bd) { bd = d; bi = i; } }
        const s = left[bi]; left[bi] = left[left.length - 1]; left.pop();
        ordered.push(s); px0 = s.x; py0 = s.y;
      }
    }
    // Each stroke: dabs along the painting's contours, the brush swelling
    // then lifting.
    const start = out.length / DAB;
    for (const s of ordered) {
      let x = s.x, y = s.y, dir = hand + (rand() - 0.5) * 1.2;
      if (rand() < 0.5) dir += Math.PI;
      const tip = Math.floor(rand() * TIPS);
      for (let k = 0; k < spec.steps; k++) {
        const f = field(x, y), w = smooth(0.15, 0.5, f.clear) * smooth(0.05, 0.3, f.detail);
        let a = f.along;
        if (Math.cos(a - dir) < 0) a += Math.PI; // keep going the same way
        dir = Math.atan2((1 - w) * Math.sin(dir) + w * Math.sin(a), (1 - w) * Math.cos(dir) + w * Math.cos(a));
        const u = (k + 0.5) / spec.steps;
        out.push(x, y, s.R * (0.6 + 0.4 * Math.sin(Math.PI * u)), dir, spec.alpha * (0.75 + 0.25 * Math.sin(Math.PI * u)), 0);
        tips.push(tip);
        x += Math.cos(dir) * s.R * 0.38; y += Math.sin(dir) * s.R * 0.38;
      }
    }
    const end = out.length / DAB, count = Math.max(1, end - start);
    for (let i = start; i < end; i++) out[i * DAB + 5] = spec.from + ((spec.to - spec.from) * (i - start + 1)) / count;
    layers.push({ plate: spec.plate, start, end });
  }
  return { dabs: Float32Array.from(out), tips: Uint8Array.from(tips), layers, paper: paper.map(Math.round) };
}

// Watercolour brush tips: a soft flat dab with a ragged edge, a little more
// pigment at the rim, and granulation. Only their alpha is used.
function brushTips(rand) {
  const S = 96;
  return Array.from({ length: TIPS }, () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S);
    const ph = [rand(), rand(), rand(), rand()].map((v) => v * Math.PI * 2);
    const grainAt = () => 0.78 + 0.22 * rand();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - S / 2) / (S / 2), dy = (y + 0.5 - S / 2) / (S / 2 * 0.62);
      const th = Math.atan2(dy, dx), d = Math.hypot(dx, dy);
      const edge = 1 - 0.07 * (Math.sin(3 * th + ph[0]) + 0.6 * Math.sin(7 * th + ph[1]) + 0.35 * Math.sin(13 * th + ph[2]) + 0.25 * Math.sin(23 * th + ph[3]) + 1.2);
      const q = d / edge;
      const a = (0.72 + 0.28 * smooth(0.62, 0.92, q)) * (1 - smooth(0.88, 1, q)) * grainAt();
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * a);
    }
    g.putImageData(img, 0, 0);
    return c;
  });
}

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// A soft copy: shrunk in halves, then back up (works on every browser,
// without canvas filters).
function blurred(src, by) {
  let cur = src, w = src.width, h = src.height;
  while (by > 1.5) {
    const nw = Math.max(1, Math.round(w / 2)), nh = Math.max(1, Math.round(h / 2)), c = canvas(nw, nh), g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, nw, nh);
    cur = c; w = nw; h = nh; by /= 2;
  }
  const out = canvas(src.width, src.height), g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, src.width, src.height);
  return out;
}

/**
 * Sets up the painting animation for a drawn composition.
 * @param {HTMLCanvasElement} finished  the whole video frame with the finished painting (no waveform)
 * @param {{x:number,y:number,w:number,h:number}} art  where the painting is on it
 * @returns {{draw:(ctx:CanvasRenderingContext2D, p:number)=>void}}  draws the
 *   painting at progress p (0 blank paper … 1 finished) over the finished frame.
 */
export function createPaintingAnimation(finished, art) {
  // Work on the painting's area only, on whole pixels, with a margin.
  const rx = Math.floor(art.x) - 2, ry = Math.floor(art.y) - 2;
  const rw = Math.ceil(art.x + art.w) + 2 - rx, rh = Math.ceil(art.y + art.h) + 2 - ry;
  const crop = () => { const c = canvas(rw, rh); c.getContext('2d').drawImage(finished, rx, ry, rw, rh, 0, 0, rw, rh); return c; };
  const sharp = crop();
  const unit = Math.sqrt(art.w * art.h);
  const plates = { sharp, body: blurred(sharp, unit / 220), wash: blurred(sharp, unit / 60) };

  const aw = 160, ah = Math.max(8, Math.round((160 * art.h) / art.w));
  const small = canvas(aw, ah), sg = small.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(sharp, art.x - rx, art.y - ry, art.w, art.h, 0, 0, aw, ah);
  const plan = planStrokes(sg.getImageData(0, 0, aw, ah), art.w, art.h);
  // The blank canvas: the painting card in the painting's own paper colour, grain and all.
  const blank = crop();
  {
    const g = blank.getContext('2d');
    g.beginPath(); g.roundRect(art.x - rx, art.y - ry, art.w, art.h, 4); g.clip();
    g.fillStyle = `rgb(${plan.paper.join(' ')})`; g.fillRect(0, 0, rw, rh);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = g.createPattern(grain(), 'repeat');
    g.fillRect(0, 0, rw, rh);
  }
  const tips = brushTips(rng(plan.dabs.length + 7));
  const ox = art.x - rx, oy = art.y - ry;

  const painted = canvas(rw, rh), pg = painted.getContext('2d');
  const scratch = canvas(rw, rh), xg = scratch.getContext('2d');
  let cursor, last;
  const reset = () => { pg.globalCompositeOperation = 'copy'; pg.drawImage(blank, 0, 0); pg.globalCompositeOperation = 'source-over'; cursor = plan.layers.map((l) => l.start); last = 0; };
  reset();

  // Lays the dabs due by p: brush shapes into the scratch canvas, filled
  // with the layer's copy of the painting, then onto the painted paper.
  function paintTo(p) {
    plan.layers.forEach((layer, li) => {
      let i = cursor[li];
      if (i >= layer.end || plan.dabs[i * DAB + 5] > p) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (; i < layer.end && plan.dabs[i * DAB + 5] <= p; i++) {
        const o = i * DAB, x = plan.dabs[o] + ox, y = plan.dabs[o + 1] + oy, r = plan.dabs[o + 2];
        if (x0 === Infinity) xg.clearRect(0, 0, rw, rh), xg.globalCompositeOperation = 'source-over';
        x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
        xg.globalAlpha = plan.dabs[o + 4];
        xg.setTransform(Math.cos(plan.dabs[o + 3]) * r / 48, Math.sin(plan.dabs[o + 3]) * r / 48, -Math.sin(plan.dabs[o + 3]) * r / 48, Math.cos(plan.dabs[o + 3]) * r / 48, x, y);
        xg.drawImage(tips[plan.tips[i]], -48, -48);
      }
      cursor[li] = i;
      xg.setTransform(1, 0, 0, 1, 0, 0);
      xg.globalAlpha = 1;
      const bx = Math.max(0, Math.floor(x0)), by = Math.max(0, Math.floor(y0));
      const bw = Math.min(rw, Math.ceil(x1)) - bx, bh = Math.min(rh, Math.ceil(y1)) - by;
      if (bw <= 0 || bh <= 0) return;
      xg.globalCompositeOperation = 'source-in';
      xg.drawImage(plates[layer.plate], bx, by, bw, bh, bx, by, bw, bh);
      xg.globalCompositeOperation = 'source-over';
      pg.drawImage(scratch, bx, by, bw, bh, bx, by, bw, bh);
    });
  }

  return {
    draw(ctx, p) {
      if (p >= 1) return; // the finished frame is already there
      if (p < last) reset();
      paintTo(p); last = p;
      ctx.drawImage(painted, rx, ry);
      const settle = smooth(SETTLE_FROM, 1, p);
      if (settle > 0) { ctx.save(); ctx.globalAlpha = settle; ctx.drawImage(sharp, rx, ry); ctx.restore(); }
    },
  };
}

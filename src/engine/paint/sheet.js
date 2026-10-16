// The painting surface: procedurally generated cold-press paper plus a
// subtractive glaze model. Each glaze multiplies the paper by the pigment's
// transmittance, so overlapping washes darken and mix like transparent
// watercolour rather than covering like paint.

import { field } from './noise.js';
import { Mask, blur } from './raster.js';

const PAPER = [0.968, 0.952, 0.918];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export class Sheet {
  constructor(W, H, seed) {
    this.W = W; this.H = H; this.k = W / 720; // pixel scale relative to the 720 px reference width
    const k = this.k;
    this.rgb = new Float32Array(W * H * 3);
    // Texture fields, made once per painting and shared by every layer.
    this.tooth = field(W, H, seed + 1, 2.2 * k, 3, 2.6);   // paper tooth (fine)
    this.gran = field(W, H, seed + 2, 7 * k, 3, 2.4);      // pigment granulation
    this.bloom = field(W, H, seed + 3, 60 * k, 4, 2.2);    // backruns / uneven pigment
    this.dx = field(W, H, seed + 4, 38 * k, 4, 2.0);       // edge wobble
    this.dy = field(W, H, seed + 5, 38 * k, 4, 2.0);
    for (let i = 0, p = 0; i < W * H; i++, p += 3) {
      const t = 1 - 0.03 * (this.tooth[i] - 0.5);
      this.rgb[p] = PAPER[0] * t; this.rgb[p + 1] = PAPER[1] * t; this.rgb[p + 2] = PAPER[2] * t;
    }
  }

  mask(minX, minY, maxX, maxY, pad) { return Mask.around(minX, minY, maxX, maxY, pad, this.W, this.H); }

  // Lay one transparent glaze through `m` (coverage 0..1).
  // opts: color [r,g,b] 0..1, opacity, edge (dark rim), rim (rim width px),
  //       gran (granulation), bloom (uneven pigment), wobble (edge wander px),
  //       frag {t, soft} (break the wash into islands), dry (dry-brush 0..1),
  //       fade (x,y)=>factor, seed (offsets texture lookups per layer)
  glaze(m, o) {
    const { W, H, rgb, tooth, gran, bloom, dx, dy } = this;
    const col = o.color, op = o.opacity ?? 0.6, edge = o.edge ?? 0.6, g = o.gran ?? 0.4;
    const bl = o.bloom ?? 0.3, wob = o.wobble ?? 0, dry = o.dry ?? 0, fade = o.fade;
    // Per-layer offset into the shared texture fields, mirrored at the
    // borders so lookups never show a seam.
    const ox = ((o.seed ?? 0) * 7919) % W, oy = ((o.seed ?? 0) * 104729) % H;
    const mx = (v, n) => { v %= 2 * n; return v < n ? v : 2 * n - 1 - v; };
    let wide = null;
    if (edge > 0) wide = blur(m.clone(), Math.max(2, o.rim ?? 6 * this.k));
    const frag = o.frag;
    const a0 = 1 - col[0], a1 = 1 - col[1], a2 = 1 - col[2];
    for (let y = m.y0; y < m.y0 + m.h; y++) {
      for (let x = m.x0; x < m.x0 + m.w; x++) {
        const i = y * W + x;
        let sx = x, sy = y;
        if (wob) { sx += (dx[i] - 0.5) * wob; sy += (dy[i] - 0.5) * wob; }
        const s = m.get(sx, sy);
        if (s < 0.004) continue;
        const j = mx(y + oy, H) * W + mx(x + ox, W);
        let d = s;
        if (wide) d *= 1 + edge * Math.max(0, s - wide.get(sx, sy)) * 2.2;
        d *= 1 + g * ((0.5 - tooth[i]) * 0.5 + (gran[j] - 0.5) * 0.8);
        d *= 1 + bl * (bloom[j] - 0.5) * 2;
        if (frag) d *= smooth(frag.t - frag.soft, frag.t + frag.soft, bloom[mx(y + oy + 131, H) * W + mx(W - 1 - x + ox, W)]);
        if (dry) d *= smooth(dry - 0.12, dry + 0.12, 1 - tooth[i] * 0.7 - gran[j] * 0.3 + 0.35);
        if (fade) d *= fade(x / W, y / H);
        d = clamp01(d * op);
        if (d <= 0) continue;
        const p = i * 3;
        rgb[p] *= 1 - d * a0; rgb[p + 1] *= 1 - d * a1; rgb[p + 2] *= 1 - d * a2;
      }
    }
  }

  // Opaque-ish lift of pigment (white gouache / scraped highlight), used sparingly.
  lift(m, amount = 0.6) {
    const { W, rgb } = this;
    for (let y = m.y0; y < m.y0 + m.h; y++) for (let x = m.x0; x < m.x0 + m.w; x++) {
      const s = m.d[(y - m.y0) * m.w + (x - m.x0)] * amount;
      if (s < 0.01) continue;
      const p = (y * W + x) * 3;
      rgb[p] += (PAPER[0] - rgb[p]) * s; rgb[p + 1] += (PAPER[1] - rgb[p + 1]) * s; rgb[p + 2] += (PAPER[2] - rgb[p + 2]) * s;
    }
  }

  // RGBA bytes (sRGB) for PNG encoding or ImageData.
  toRGBA() {
    const { W, H, rgb, tooth } = this;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let i = 0, p = 0, q = 0; i < W * H; i++, p += 3, q += 4) {
      const t = 1 - 0.025 * (tooth[i] - 0.5); // paper texture shows through pigment too
      out[q] = rgb[p] * t * 255; out[q + 1] = rgb[p + 1] * t * 255; out[q + 2] = rgb[p + 2] * t * 255; out[q + 3] = 255;
    }
    return out;
  }
}

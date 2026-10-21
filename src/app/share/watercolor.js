// The share video's painting animation, painted with p5.brush's own
// watercolour fill (Tyler Hobbs' layered-polygon method: soft, bleeding,
// textured edges). The painting is painted shape by shape onto its blank
// paper: shapes and their order come from planStrokes (pale washes first,
// then the body, then details), and each shape's colour is the painting's
// own colour under it. From midway the finished painting itself glazes in,
// slowly and evenly, so the last frame is exactly the painting with no jump.
// Needs WebGL2; without it, returns null and the caller uses paint.js's
// brush-dab animation. Each fill is costly, so a frame does only so much
// and a slow phone leaves late shapes to the glaze; the glaze keeps time,
// so the pace stays even and the end is always the painting.

import { planStrokes } from './paint.js';

// Per layer: how many dabs make one of planStrokes' strokes, one shape for
// every `every` strokes (each fill is costly, so few big ones), its size,
// and p5.brush's fill settings. The details come from the glaze, not shapes.
const STYLE = {
  wash: { stroke: 9, every: 2, size: 1.15, opacity: 130, bleed: 0.3, texture: 0.5, border: 0.1 },
  body: { stroke: 10, every: 5, size: 1.5, opacity: 210, bleed: 0.2, texture: 0.5, border: 0.12 },
};
const BUDGET_MS = 28; // fill work per frame; the rest waits for the next frame
const LATE = 0.12; // a shape this far behind (a slow phone) is left to the glaze
const SIDES = 14; // points on each shape's outline (p5.brush then bleeds it)
const PAINT_BY = 0.92; // the last shape is down by here
const GLAZE = 0.3; // from here the finished painting glazes in, gently at first, done at 1

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

let brushModule;
const loadBrush = () => (brushModule ??= import('../../vendor/p5.brush/brush.esm.js'));

/**
 * Sets up the watercolour painting animation for a drawn composition.
 * @param {HTMLCanvasElement} finished  the whole video frame with the finished painting (no waveform)
 * @param {{x:number,y:number,w:number,h:number}} art  where the painting is on it
 * @returns {Promise<{draw:(ctx:CanvasRenderingContext2D, p:number)=>void}|null>}  null without WebGL2
 */
export async function createWatercolorAnimation(finished, art) {
  const gl = canvas(Math.round(art.w), Math.round(art.h));
  if (!gl.getContext('webgl2', { preserveDrawingBuffer: true })) return null;
  let brush;
  try { brush = await loadBrush(); brush.load(gl); } catch { return null; }

  const W = gl.width, H = gl.height;
  const sharp = canvas(W, H), sx = sharp.getContext('2d', { willReadFrequently: true });
  sx.drawImage(finished, art.x, art.y, art.w, art.h, 0, 0, W, H);
  const pix = sx.getImageData(0, 0, W, H).data;
  const aw = 160, ah = Math.max(8, Math.round((160 * H) / W));
  const small = canvas(aw, ah), sg = small.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(sharp, 0, 0, aw, ah);
  const plan = planStrokes(sg.getImageData(0, 0, aw, ah), W, H);

  // The painting's average colour inside an ellipse.
  const colourIn = (cx, cy, rx, ry, ang) => {
    let r = 0, g = 0, b = 0, n = 0;
    const ca = Math.cos(ang), sa = Math.sin(ang), R = Math.max(rx, ry), step = Math.max(1, Math.round(R / 12));
    for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(H, cy + R); y += step)
      for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(W, cx + R); x += step) {
        const dx = x - cx, dy = y - cy, u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry;
        if (u * u + v * v > 1) continue;
        const i = (y * W + x) * 4; r += pix[i]; g += pix[i + 1]; b += pix[i + 2]; n++;
      }
    return n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : null;
  };

  // One shape per chosen planned stroke: an ellipse along the stroke.
  const shapes = [];
  for (const layer of plan.layers) {
    const st = STYLE[layer.plate], d = plan.dabs;
    if (!st) continue;
    const size = st.size;
    for (let s = layer.start; s < layer.end; s += st.stroke * st.every) {
      const a = s * 6, e = Math.min(layer.end - 1, s + st.stroke - 1) * 6;
      let r = 0; for (let q = a; q <= e; q += 6) r = Math.max(r, d[q + 2]);
      const cx = (d[a] + d[e]) / 2, cy = (d[a + 1] + d[e + 1]) / 2;
      const ang = Math.atan2(d[e + 1] - d[a + 1], d[e] - d[a]), half = Math.hypot(d[e] - d[a], d[e + 1] - d[a + 1]) / 2;
      const rx = (half + r) * size, ry = r * size, colour = colourIn(cx, cy, rx * 0.6, ry * 0.6, ang);
      if (!colour) continue;
      const pts = [];
      for (let k = 0; k < SIDES; k++) {
        const th = (k / SIDES) * Math.PI * 2, x = Math.cos(th) * rx, y = Math.sin(th) * ry;
        pts.push([cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)]);
      }
      shapes.push({ t: d[a + 5] * (PAINT_BY / 0.95), st, pts, colour });
    }
  }
  shapes.sort((u, v) => u.t - v.t);

  // The blank card is the painting's own paper colour.
  const paperColour = `rgb(${plan.paper.join(',')})`;

  let next = 0, last = -1;
  const reset = () => { brush.load(gl); brush.seed(shapes.length); brush.noiseSeed(shapes.length); brush.clear(paperColour); brush.render(); next = 0; };
  return {
    draw(ctx, p) {
      if (p >= 1) return; // the finished frame is already there
      if (p < last || last < 0) reset();
      last = p;
      if (next < shapes.length && shapes[next].t <= p) {
        brush.load(gl);
        brush.push(); brush.translate(-W / 2, -H / 2); brush.noStroke();
        const until = performance.now() + BUDGET_MS;
        for (; next < shapes.length && shapes[next].t <= p && performance.now() < until; next++) {
          const { t, st, pts, colour } = shapes[next];
          if (t < p - LATE) continue;
          brush.fill(colour, st.opacity);
          brush.fillBleed(st.bleed, 'out');
          brush.fillTexture(st.texture, st.border);
          brush.polygon(pts);
        }
        brush.pop(); brush.render();
      }
      ctx.save();
      ctx.beginPath(); ctx.roundRect(art.x, art.y, art.w, art.h, 4); ctx.clip();
      ctx.drawImage(gl, art.x, art.y, art.w, art.h);
      const glaze = Math.max(0, (p - GLAZE) / (1 - GLAZE)) ** 1.6;
      if (glaze > 0) { ctx.globalAlpha = glaze; ctx.drawImage(sharp, art.x, art.y, art.w, art.h); }
      ctx.restore();
    },
  };
}

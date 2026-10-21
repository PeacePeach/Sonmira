// Shared drawing for Sonmira's share files: the painting card, fonts and
// text helpers. The image card and the video's composition are card.js.
// Works from contract data only (painting, note, date), so it never depends
// on how a painting was generated.

const C = {
  paper: '#F8F5EF', paintingPaper: '#F3EDE1', ink: '#1F1D1A', secondary: '#8C867D', muted: '#A39D93', track: '#E4DDD1',
  serif: '"Cormorant Garamond", "Iowan Old Style", Georgia, serif',
  sans: '"Hanken Grotesk", -apple-system, system-ui, sans-serif',
};
export const COLORS = C;

/** Make sure the design faces are ready before drawing text to canvas. */
export async function ensureFonts() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load(`600 40px ${C.serif}`),
    document.fonts.load(`italic 600 40px ${C.serif}`),
    document.fonts.load(`500 40px ${C.serif}`),
    document.fonts.load(`italic 500 40px ${C.serif}`),
    document.fonts.load(`450 20px ${C.sans}`),
  ]).catch(() => {});
}

/** Resolve a contract Artwork to a decoded image (or null). */
export function loadArtwork(artwork) {
  if (!artwork) return Promise.resolve(null);
  const src = artwork.kind === 'image' && artwork.blob ? URL.createObjectURL(artwork.blob) : artwork.src;
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

let grainTile = null;
export function grain() {
  if (grainTile) return grainTile;
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d'), d = g.createImageData(n, n);
  for (let i = 0; i < d.data.length; i += 4) {
    // same tint and sparsity as the design's #grain SVG filter
    d.data[i] = 107; d.data[i + 1] = 94; d.data[i + 2] = 77;
    d.data[i + 3] = Math.max(0, 0.55 * Math.random() - 0.18) * 255 * 0.7; // a touch finer than on screen at export size
  }
  g.putImageData(d, 0, 0);
  return (grainTile = c);
}

function drawWash(ctx, strokes, x, y, w, h) {
  // The live wash box is inset -6% around the painting.
  const bx = x - w * 0.06, by = y - h * 0.06, bw = w * 1.12, bh = h * 1.12;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.filter = `blur(${Math.max(1, w / 260)}px)`;
  for (const s of strokes || []) {
    const cx = bx + (s.x / 100) * bw, cy = by + (s.y / 100) * bh;
    const rx = ((s.w / 100) * bw) / 2, ry = ((s.h / 100) * bh) / 2;
    const L = s.l, Ch = s.c, H = s.hue.toFixed(1), A = Math.min(0.95, s.a);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((s.rot || 0) * Math.PI) / 180);
    ctx.scale(1, ry / Math.max(1, rx));
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    try {
      gr.addColorStop(0, `oklch(${L} ${Ch} ${H} / ${A})`);
      gr.addColorStop(0.6, `oklch(${L} ${Ch} ${H} / ${A * 0.75})`);
      gr.addColorStop(0.86, `oklch(${L - 0.1} ${Ch + 0.02} ${H} / ${Math.min(1, A * 1.3)})`);
      gr.addColorStop(1, `oklch(${L} ${Ch} ${H} / 0)`);
    } catch { continue; }
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** The painting card: soft shadow, paper, wash, artwork (cover), grain. */
export function drawPainting(ctx, { painting, img, x, y, w, h, scale = 1 }) {
  const r = 4 * scale;
  ctx.save();
  ctx.shadowColor = 'rgba(60,45,30,0.22)';
  ctx.shadowBlur = 36 * scale;
  ctx.shadowOffsetY = 18 * scale;
  ctx.fillStyle = C.paintingPaper;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  ctx.fillStyle = C.paintingPaper; ctx.fillRect(x, y, w, h);
  drawWash(ctx, painting?.wash, x, y, w, h);
  if (img) {
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = ctx.createPattern(grain(), 'repeat');
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export function wrap(ctx, text, maxW, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const pushWord = (wd) => {
    // CJK and very long words: break by character
    if (ctx.measureText(wd).width <= maxW) return [wd];
    const parts = []; let p = '';
    for (const ch of wd) { if (ctx.measureText(p + ch).width > maxW) { parts.push(p); p = ch; } else p += ch; }
    if (p) parts.push(p);
    return parts;
  };
  for (const wd of words.flatMap(pushWord)) {
    const test = line ? line + ' ' + wd : wd;
    if (ctx.measureText(test).width <= maxW || !line) line = test;
    else { lines.push(line); line = wd; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + '…';
    return kept;
  }
  return lines;
}

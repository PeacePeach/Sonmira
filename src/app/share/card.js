// The share image: the painting as a collectible print on paper, its title,
// a quiet line of metadata, and a small colophon (one sentence and the
// Sonmira mark). One composition laid out for three formats; nothing is
// cropped or regenerated: the original artwork is drawn whole.

import { madeLine } from '../format.js';
import { COLORS as C, drawPainting, ensureFonts, loadArtwork, wrap } from './compose.js';

// Feed: Instagram's 3:4 post. Story: Instagram/WeChat stories. Square: WeChat Moments.
export const FORMATS = {
  feed: { W: 1080, H: 1440, label: 'Feed', hint: '3:4' },
  story: { W: 1080, H: 1920, label: 'Story', hint: '9:16' },
  square: { W: 1080, H: 1080, label: 'Square', hint: '1:1' },
};
export const DEFAULT_FORMAT = 'feed';

// Per format: margins, the widest the artwork may be, and a type scale.
const FRAME = {
  feed: { top: 110, bottom: 84, artMaxW: 760, k: 1 },
  story: { top: 210, bottom: 150, artMaxW: 840, k: 1.08 },
  square: { top: 70, bottom: 62, artMaxW: 620, k: 0.86 },
};

export const STORY_LINE = 'I sang this moment into a painting.';
const MARK = new Path2D('M52 106 C64 70 136 70 148 106 Z'); // assets/brand/sonmira-mark.svg
const RIPPLES = [[44, 119, 156], [70, 132, 142], [82, 145, 114]];

function drawMark(ctx, x, y, h, color) {
  // the islet and three ripples, viewBox 40 70 120 82
  const s = h / 82;
  ctx.save();
  ctx.translate(x - 40 * s, y - 70 * s);
  ctx.scale(s, s);
  ctx.fillStyle = color; ctx.fill(MARK);
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
  for (const [x1, yy, x2] of RIPPLES) { ctx.beginPath(); ctx.moveTo(x1, yy); ctx.lineTo(x2, yy); ctx.stroke(); }
  ctx.restore();
  return 120 * s; // drawn width
}

function tracked(ctx, text, x, y, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
  ctx.fillText(text, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{format: keyof typeof FORMATS, painting:any, img:HTMLImageElement|null, note?:string, date:string, createdAt?:number, durationSec?:number}} o
 */
export function drawCard(ctx, { format, painting, img, note, date, createdAt, durationSec }) {
  const { W, H } = FORMATS[format];
  const F = FRAME[format], k = F.k, cx = W / 2;
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  // Type, measured first so the artwork takes whatever height is left.
  const titleSize = Math.round(54 * k), titleLead = Math.round(66 * k);
  ctx.font = `500 ${titleSize}px ${C.serif}`;
  const title = note ? wrap(ctx, note, W - 200, 2) : [];
  const gapArt = Math.round(40 * k); // artwork → title
  const metaSize = Math.round(22 * k), gapMeta = Math.round(title.length ? 26 * k : 0);
  const textH = gapArt + title.length * titleLead + gapMeta + metaSize;

  const storySize = Math.round(31 * k), markH = Math.round(28 * k), gapColophon = Math.round(22 * k);
  const colophonH = storySize + gapColophon + markH;
  const breathe = Math.round(70 * k); // between the metadata and the colophon, at least

  const aspect = img ? img.naturalWidth / img.naturalHeight : 4 / 5;
  const artMaxH = H - F.top - F.bottom - colophonH - breathe - textH;
  let artH = artMaxH, artW = artH * aspect;
  if (artW > F.artMaxW) { artW = F.artMaxW; artH = artW / aspect; }

  // The artwork and its words sit together in the space above the colophon.
  const colophonTop = H - F.bottom - colophonH;
  const groupH = artH + textH;
  const top = Math.max(F.top, F.top + (colophonTop - breathe - F.top - groupH) / 2);
  const artX = cx - artW / 2;
  drawPainting(ctx, { painting, img, x: artX, y: top, w: artW, h: artH, scale: 1 });

  let y = top + artH + gapArt;
  ctx.fillStyle = C.ink;
  ctx.font = `500 ${titleSize}px ${C.serif}`;
  title.forEach((ln, i) => ctx.fillText(ln, cx, y + titleSize * 0.8 + i * titleLead));
  y += title.length * titleLead + gapMeta;

  ctx.fillStyle = C.muted;
  ctx.font = `450 ${metaSize}px ${C.sans}`;
  tracked(ctx, madeLine(date, createdAt, durationSec), cx, y + metaSize * 0.8, 1.6 * k);

  drawColophon(ctx, cx, colophonTop, k);
}

// Colophon: one sentence, then the mark and the wordmark. Returns its height.
function drawColophon(ctx, cx, top, k) {
  const storySize = Math.round(31 * k), markH = Math.round(28 * k), gapColophon = Math.round(22 * k);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.secondary;
  ctx.font = `italic 500 ${storySize}px ${C.serif}`;
  ctx.fillText(STORY_LINE, cx, top + storySize * 0.8);
  const rowY = top + storySize + gapColophon;
  ctx.font = `italic 600 ${Math.round(markH * 1.12)}px ${C.serif}`;
  const word = 'Sonmira', wordW = ctx.measureText(word).width, markW = markH * (120 / 82), gap = Math.round(12 * k);
  const startX = cx - (markW + gap + wordW) / 2;
  drawMark(ctx, startX, rowY + 1, markH * 0.9, C.muted);
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  ctx.fillText(word, startX + markW + gap, rowY + markH * 0.86);
  ctx.textAlign = 'center';
  return storySize + gapColophon + markH;
}

// The video (1080×1920, 9:16), in the first share video's layout: a large
// painting, a left-aligned serif title, quiet caps for the date and the
// Sonmira mark, every element on the painting's edges. The words sit above
// the painting (the detail page's order: caps, then title), so a player's
// controls and playhead at the bottom cover only paper. Everything stays
// inside VIDEO_SAFE, clear of the bars of Moments, Stories and Photos.
export const VIDEO = { W: 1080, H: 1920 };
export const VIDEO_SAFE = { top: 190, bottom: 300, side: 90 };
const WAVE_GAP = 40, WAVE_H = 72;

/**
 * Draws the video's still composition (no waveform) and returns where the
 * waveform goes. The share sheet's video preview is this same drawing.
 * @returns {{art:{x:number,y:number,w:number,h:number}, wave:{x:number,y:number,w:number,h:number}, text:{top:number,bottom:number}}}
 */
export function drawVideoCard(ctx, { painting, img, note, date, createdAt, durationSec }) {
  const { W, H } = VIDEO, S = VIDEO_SAFE;
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // type, as in the first video: serif 600 44/54 title, 20 px caps, 30 px wordmark
  const capsH = 20, gapCaps = 30, titleSize = 44, titleLead = 54, gapArt = 40;
  const aspect = img ? img.naturalWidth / img.naturalHeight : 4 / 5;
  const maxW = W - 2 * S.side;
  // head: the sentence on the left, the mark and wordmark on the right; on a
  // narrow painting the sentence takes a line of its own below them
  ctx.font = `italic 600 30px ${C.serif}`;
  const word = 'Sonmira', wordW = ctx.measureText(word).width, markH = 22, markW = markH * (120 / 82);
  ctx.font = `italic 500 28px ${C.serif}`;
  const lineW = ctx.measureText(STORY_LINE).width;
  const stacked = (w) => lineW > w - wordW - markW - 40;
  const fit = (w) => {
    const headH = stacked(w) ? 34 + 44 : 34, gapHead = 60;
    ctx.font = `600 ${titleSize}px ${C.serif}`;
    const title = note ? wrap(ctx, note, w, 2) : [];
    const textH = headH + gapHead + capsH + (title.length ? gapCaps + title.length * titleLead - (titleLead - titleSize) : 0) + gapArt;
    return { title, headH, gapHead, textH, artH: H - S.top - S.bottom - textH - WAVE_GAP - WAVE_H };
  };
  let artW = maxW, f = fit(artW), artH = artW / aspect;
  if (artH > f.artH) { artH = f.artH; artW = artH * aspect; f = fit(artW); artH = Math.min(artH, f.artH); artW = artH * aspect; }
  const x = (W - artW) / 2, right = x + artW;
  const top = S.top + Math.max(0, (H - S.top - S.bottom - (f.textH + artH + WAVE_GAP + WAVE_H)) / 2);

  const base = top + 34 * 0.8;
  ctx.font = `italic 600 30px ${C.serif}`;
  ctx.fillStyle = C.muted; ctx.textAlign = 'right';
  ctx.fillText(word, right, base);
  drawMark(ctx, right - wordW - 10 - markW, base - markH + 2, markH * 0.9, C.muted);
  ctx.fillStyle = C.secondary; ctx.textAlign = 'left';
  ctx.font = `italic 500 28px ${C.serif}`;
  if (stacked(artW)) { ctx.textAlign = 'right'; ctx.fillText(STORY_LINE, right, base + 44); } // under the mark, on the right edge
  else ctx.fillText(STORY_LINE, x, base);

  // caps line, then the title
  let y = top + f.headH + f.gapHead;
  ctx.fillStyle = C.muted;
  ctx.font = `450 ${capsH}px ${C.sans}`;
  tracked(ctx, madeLine(date, createdAt, durationSec), x, y + capsH * 0.8, 1.6);
  y += capsH;
  if (f.title.length) {
    y += gapCaps;
    ctx.fillStyle = C.ink;
    ctx.font = `600 ${titleSize}px ${C.serif}`;
    f.title.forEach((ln, i) => ctx.fillText(ln, x, y + titleSize * 0.8 + i * titleLead));
    y += f.title.length * titleLead - (titleLead - titleSize);
  }
  const textBottom = y;
  ctx.textAlign = 'center';

  const art = { x, y: textBottom + gapArt, w: artW, h: artH };
  drawPainting(ctx, { painting, img, ...art, scale: 1 });
  return { art, wave: { x: art.x, y: art.y + art.h + WAVE_GAP, w: art.w, h: WAVE_H }, text: { top, bottom: textBottom } };
}

/** @param {{painting:any, note?:string, date:string, durationSec?:number}} item @returns {Promise<Blob>} */
export async function renderShareCard(item, format = DEFAULT_FORMAT) {
  const [img] = await Promise.all([loadArtwork(item.painting?.artwork), ensureFonts()]);
  const { W, H } = FORMATS[format];
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  drawCard(canvas.getContext('2d'), { format, painting: item.painting, img, note: item.note, date: item.date, createdAt: item.createdAt, durationSec: item.durationSec });
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.94));
  if (!blob) throw new Error('image-encode-failed');
  return blob;
}

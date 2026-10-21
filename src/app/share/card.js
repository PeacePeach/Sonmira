// The share image: the painting as a collectible print on paper, its title,
// a quiet line of metadata, and a small colophon (one sentence and the
// Sonmira mark). One composition laid out for three formats; nothing is
// cropped or regenerated: the original artwork is drawn whole.

import { longDate, madeLine } from '../format.js';
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

// The video (1080×1920, 9:16), after Han's design (Frame 92): the sentence
// and the Sonmira mark centred at the top, the painting large, the waveform
// under it, then the title and the full date centred below. Positions are
// the design's, in video pixels; a painting of another shape keeps its own
// proportions and the whole group stays centred where the design puts it.
export const VIDEO = { W: 1080, H: 1920 };
export const VIDEO_SAFE = { top: 120, bottom: 200, side: 120 };
const V = {
  lineY: 154, lineSize: 28,        // "I sang this moment into a painting."
  markY: 213, markH: 22, wordSize: 30,
  artY: 316, artW: 840, artMaxH: 1085,
  waveGap: 74, waveH: 36,
  titleGap: 120, titleSize: 40, titleLead: 52,
  dateGap: 54, dateSize: 19,
};

/** "TUESDAY, OCTOBER 20, 2026" */
const fullDate = (date) => { const [y] = date.split('-'); return `${longDate(date)}, ${y}`; };

/**
 * Draws the video's still composition (no waveform) and returns where the
 * waveform goes. The share sheet's video preview is this same drawing.
 * @returns {{art:{x:number,y:number,w:number,h:number}, wave:{x:number,y:number,w:number,h:number}, text:{top:number,bottom:number}}}
 */
export function drawVideoCard(ctx, { painting, img, note, date }) {
  const { W } = VIDEO, cx = W / 2;
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, VIDEO.H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  const aspect = img ? img.naturalWidth / img.naturalHeight : 4 / 5;
  let artW = V.artW, artH = artW / aspect;
  if (artH > V.artMaxH) { artH = V.artMaxH; artW = artH * aspect; }
  const shift = (V.artMaxH - artH) / 2; // a shorter painting: the group closes up around the design's centre

  ctx.font = `500 ${V.titleSize}px ${C.sans}`;
  const title = note ? wrap(ctx, note, V.artW, 2) : [];

  // head: the sentence, then the mark and the wordmark
  const top = V.lineY + shift;
  ctx.fillStyle = C.secondary;
  ctx.font = `italic 500 ${V.lineSize}px ${C.serif}`;
  ctx.fillText(STORY_LINE, cx, top);
  const markY = V.markY + shift;
  ctx.font = `italic 600 ${V.wordSize}px ${C.serif}`;
  const word = 'Sonmira', wordW = ctx.measureText(word).width, markW = V.markH * (120 / 82), gap = 12;
  const startX = cx - (markW + gap + wordW) / 2;
  drawMark(ctx, startX, markY - V.markH + 3, V.markH * 0.9, C.muted);
  ctx.fillStyle = C.muted; ctx.textAlign = 'left';
  ctx.fillText(word, startX + markW + gap, markY);
  ctx.textAlign = 'center';

  const art = { x: cx - artW / 2, y: V.artY + shift, w: artW, h: artH };
  drawPainting(ctx, { painting, img, ...art, scale: 1 });
  const wave = { x: cx - V.artW / 2, y: art.y + art.h + V.waveGap - V.waveH / 2, w: V.artW, h: V.waveH };
  if (artW < V.artW) { wave.x = art.x; wave.w = art.w; }

  // title and date, centred under the waveform
  let y = wave.y + wave.h / 2 + V.titleGap;
  ctx.fillStyle = C.ink;
  ctx.font = `500 ${V.titleSize}px ${C.sans}`;
  title.forEach((ln, i) => ctx.fillText(ln, cx, y + i * V.titleLead));
  if (title.length) y += (title.length - 1) * V.titleLead + V.dateGap;
  ctx.fillStyle = C.muted;
  ctx.font = `450 ${V.dateSize}px ${C.sans}`;
  tracked(ctx, fullDate(date), cx, y, 1.2);
  return { art, wave, text: { top: top - V.lineSize, bottom: y } };
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

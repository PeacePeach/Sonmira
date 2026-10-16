// Share as image: a 4:5 card at 2160×2700 (JPEG).

import { drawComposition, ensureFonts, loadArtwork, LAYOUTS } from './compose.js';

export const IMAGE_SCALE = 2;

/** @param {{painting:any, note?:string, date:string}} item @returns {Promise<Blob>} */
export async function renderShareImage(item) {
  const [img] = await Promise.all([loadArtwork(item.painting?.artwork), ensureFonts()]);
  const L = LAYOUTS.card, s = IMAGE_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = L.W * s; canvas.height = L.H * s;
  drawComposition(canvas.getContext('2d'), { layout: 'card', scale: s, painting: item.painting, img, note: item.note, date: item.date });
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  if (!blob) throw new Error('image-encode-failed');
  return blob;
}

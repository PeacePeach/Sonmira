// Rendering: interpretation → artwork + wash.
// V1 picks from the bundled watercolor set; a generator that returns pixels
// can replace selectArtwork() and return { kind: 'image', blob } instead.

import { selectArtwork } from './select.js';
import { tintWash, groundWash } from './wash.js';
import { hashSeed } from './rng.js';

export { createWashBuilder, EMOTION_TINT } from './wash.js';
export { CATALOG } from './catalog.js';
export { selectArtwork };

export function render({ interpretation, features, wash = [], note = '' }) {
  const { completeness, emotion, motif } = interpretation;
  const voiceHue = features?.hue?.mean ?? 240;
  const loudness = features?.level?.mean ?? 0;
  const seed = hashSeed(features?.durationSec ?? 0, voiceHue, loudness, note);
  const item = selectArtwork({ completeness, motif, emotion, voiceHue, loudness, seed });
  return {
    artwork: item ? { kind: 'asset', src: item.src, focus: item.focus } : null,
    wash: wash.length > 1 ? tintWash(wash, emotion) : groundWash(emotion, seed),
    artworkId: item?.id ?? null,
  };
}

// Picks the painting from the catalog that best answers an interpretation.
// Completeness decides the pool; motif, emotion and the voice's hue rank
// within it; a small seeded jitter keeps similar takes from always landing
// on the same painting.

import { CATALOG } from './catalog.js';
import { rng } from './rng.js';

export function scoreArtwork(item, { motif, emotion, voiceHue, loudness }) {
  let s = 0;
  if (item.motifs.includes(motif)) s += motif === 'abstract' ? 1 : 3;
  if (item.emotions[0] === emotion) s += 2;
  else if (item.emotions.includes(emotion)) s += 1.4;
  s += 1.5 * Math.max(0, 1 - Math.abs(item.voiceHue - voiceHue) / 150);
  if (item.loud !== undefined) s += item.loud === loudness > 0.45 ? 0.6 : 0;
  return s;
}

export function selectArtwork({ completeness, motif, emotion, voiceHue = 240, loudness = 0, seed = 1 }, catalog = CATALOG) {
  const pool = catalog.filter((c) => c.completeness === completeness);
  if (!pool.length) return null;
  const r = rng(seed);
  let best = null, bestS = -Infinity;
  for (const item of pool) {
    const s = scoreArtwork(item, { motif, emotion, voiceHue, loudness }) + r() * 0.5;
    if (s > bestS) { bestS = s; best = item; }
  }
  return best;
}

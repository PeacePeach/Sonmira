// Words → subject matter. The note is the only text input for now; a
// transcript of the sung words can be passed the same way later. Without
// usable words, a loose painting stays abstract and other paintings take a
// place suggested by the voice's register (as in the design prototype).

import { MOTIF_WORDS, countMatches, topMatches } from './lexicon.js';

export const MOTIFS = ['water', 'sky', 'garden', 'landscape', 'abstract'];
export const DEFAULT_MOTIF = 'abstract';

export function motifFromVoice(features, completeness) {
  if (completeness === 'loose') return 'abstract';
  const hue = features?.hue?.mean;
  if (hue == null || !features.activity?.voicedSec) return null;
  return hue > 200 ? 'water' : hue > 140 ? 'sky' : 'landscape';
}

// text: the user's note, plus a transcript when one exists.
export function interpretMotif(text, features, completeness) {
  const voice = motifFromVoice(features, completeness);
  const top = topMatches(countMatches(text, MOTIF_WORDS), MOTIFS);
  if (top.length === 1) return { value: top[0], source: 'note' };
  if (top.length > 1) return { value: top.includes(voice) ? voice : top[0], source: 'note' };
  if (voice) return { value: voice, source: 'voice' };
  return { value: DEFAULT_MOTIF, source: 'default' };
}

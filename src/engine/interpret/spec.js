// Layer B output: the structured visual specification.
//
// Built from the interpretation (control, emotion, motif) plus a few voice
// measurements. Provider-independent: it says what the painting should be,
// not how any model is asked for it. Voice control sets form completeness
// only; it never changes colour saturation or overall quality.

import { MOODS } from '../art/palettes.js';

export const SPEC_VERSION = 1;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Energy from loudness movement and onsets: how much the painting's marks
// move, not how it feels (feeling comes only from the note).
export function energyFor(features) {
  if (!features?.activity) return { value: 'calm', source: 'default' };
  const sounding = Math.max(0.5, features.activity.soundingSec ?? 0);
  const onsetRate = (features.onsets?.count ?? 0) / sounding;
  const dyn = clamp01((features.energy?.dynamicRangeDb ?? 0) / 18);
  const e = 0.55 * clamp01(onsetRate / 2) + 0.45 * dyn;
  return { value: e > 0.6 ? 'lively' : e > 0.3 ? 'moderate' : 'calm', source: 'voice', amount: Math.round(e * 100) / 100 };
}

export function visualSpec({ interpretation: it, features, seed, note = '' }) {
  const mood = MOODS[it.emotion] || MOODS.tender;
  return {
    version: SPEC_VERSION,
    completeness: it.completeness,          // loose | gathered | resolved
    stylePosition: it.stylePosition,        // 0..1, continuous
    emotion: it.emotion,
    motif: it.motif,
    hasWords: Boolean(note && note.trim()),
    energy: energyFor(features),
    palette: { pigments: mood.pigments.slice(0, 4), depth: mood.depth },
    seed: seed >>> 0,
    sources: it.sources,
  };
}

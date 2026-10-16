// Interpretation: features + words → control, completeness, emotion, motif
// and the descriptive copy. Every part degrades to a neutral default when its
// input is missing, so a painting can always be made.

import { interpretCompleteness, renderPosition, CALIBRATION, COMPLETENESS } from './completeness.js';
import { interpretEmotion, EMOTIONS } from './emotion.js';
import { interpretMotif, MOTIFS } from './motif.js';
import { voiceLabel, summaryLine, dryingLine } from './copy.js';

export { COMPLETENESS, EMOTIONS, MOTIFS, CALIBRATION };

// overrides (developer only):
//   control: number 0..1 (style position) or a tier name
//   completeness: tier name (same as control: tier)
//   emotion, motif: labels
// allowedMotifs: motif labels the caller accepts.
export function interpret({ features, note = '', transcript = '', overrides = {}, allowedMotifs = MOTIFS } = {}) {
  const words = [note, transcript].filter(Boolean).join(' \n ');
  const measured = interpretCompleteness(features);
  const forced = overrides.control ?? overrides.completeness;
  let completeness = measured.value, position = renderPosition(measured.score), cSource = measured.source;
  if (typeof forced === 'number') {
    position = Math.min(1, Math.max(0, forced));
    completeness = position >= 0.7 ? 'resolved' : position >= 0.35 ? 'gathered' : 'loose';
    cSource = 'override';
  } else if (COMPLETENESS.includes(forced)) {
    completeness = forced; position = CALIBRATION.presets[forced]; cSource = 'override';
  }
  const e = EMOTIONS.includes(overrides.emotion) ? { value: overrides.emotion, source: 'override' } : interpretEmotion(words);
  const m = MOTIFS.includes(overrides.motif) ? { value: overrides.motif, source: 'override', secondary: null } : interpretMotif(words, allowedMotifs);
  const label = voiceLabel(features, completeness);
  return {
    completeness,
    controlScore: measured.score,          // from the voice (null-safe); see completeness.js
    controlConfidence: measured.confidence,
    stylePosition: Math.round(position * 1000) / 1000, // what the renderer paints at
    emotion: e.value,
    motif: m.value,
    secondaryMotif: m.secondary,
    voiceLabel: label,
    summary: summaryLine(completeness, label),
    dryingLine: dryingLine(completeness),
    // Where each choice came from: 'voice' | 'note' | 'default' | 'override'.
    sources: { completeness: cSource, emotion: e.source, motif: m.source },
    signals: measured.signals ?? null,
  };
}

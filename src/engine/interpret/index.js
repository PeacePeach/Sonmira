// Interpretation: features + words → completeness, emotion, motif and copy.
// Every part degrades to a neutral default when its input is missing, so a
// painting can always be made.

import { interpretCompleteness, COMPLETENESS } from './completeness.js';
import { interpretEmotion, EMOTIONS } from './emotion.js';
import { interpretMotif, MOTIFS } from './motif.js';
import { voiceLabel, summaryLine, dryingLine } from './copy.js';

export { COMPLETENESS, EMOTIONS, MOTIFS };

// overrides: { completeness?, emotion?, motif? } for developer previews.
export function interpret({ features, note = '', transcript = '', overrides = {} } = {}) {
  const c = COMPLETENESS.includes(overrides.completeness)
    ? { value: overrides.completeness, source: 'override' }
    : interpretCompleteness(features);
  const words = [note, transcript].filter(Boolean).join(' \n ');
  const e = EMOTIONS.includes(overrides.emotion)
    ? { value: overrides.emotion, source: 'override' }
    : interpretEmotion(words, features);
  const m = MOTIFS.includes(overrides.motif)
    ? { value: overrides.motif, source: 'override' }
    : interpretMotif(words, features, c.value);
  const label = voiceLabel(features, c.value);
  return {
    completeness: c.value,
    emotion: e.value,
    motif: m.value,
    voiceLabel: label,
    summary: summaryLine(c.value, label),
    dryingLine: dryingLine(c.value),
    // Where each choice came from: 'voice' | 'note' | 'default' | 'override'.
    sources: { completeness: c.source, emotion: e.source, motif: m.source },
    signals: c.signals ?? null,
  };
}

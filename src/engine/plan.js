// Layers A → C without rendering: what to paint, for any provider.
//
//   planPainting({ features, noteText, transcript, vocalControlOverride,
//                  emotionOverride, motifOverride, familyOverride, seed, allowedMotifs })
//   → { interpretation, spec, direction, seed, summary }
//
// generate.js paints this plan procedurally; providers/ send `direction` to
// an image model. `summary` has the same fields for both, so the caller
// never needs to know which provider made the picture.

import { interpret, MOTIFS } from './interpret/index.js';
import { visualSpec } from './interpret/spec.js';
import { direct } from './direct/index.js';
import { hashSeed } from './render/rng.js';

export function planPainting(opts = {}) {
  const {
    features = null, noteText = '', transcript = '',
    vocalControlOverride, emotionOverride, motifOverride, familyOverride, allowedMotifs = MOTIFS,
  } = opts;
  const it = interpret({
    features, note: noteText, transcript, allowedMotifs,
    overrides: { control: vocalControlOverride, emotion: emotionOverride, motif: motifOverride },
  });
  const seed = (opts.seed ?? hashSeed(features?.durationSec ?? 0, features?.hue?.mean ?? 0, features?.level?.mean ?? 0, noteText)) >>> 0;
  const spec = visualSpec({ interpretation: it, features, seed, note: noteText });
  if (familyOverride) spec.family = familyOverride;
  const direction = direct(spec);
  return {
    interpretation: it, spec, direction, seed,
    summary: {
      controlScore: features ? it.controlScore : null,
      controlConfidence: it.controlConfidence,
      tier: it.completeness,
      stylePosition: it.stylePosition,
      emotion: it.emotion,
      motif: it.motif,
      energy: spec.energy.value,
      seed,
      pigments: direction.pigments,
      family: direction.family,
      familyLabel: direction.familyLabel,
      interpretation: it,
    },
  };
}

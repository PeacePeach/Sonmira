// Vocal control (0..1) → continuous painting style.
//
// Anchors at control 0, 0.5 and 1 are the loose / gathered / resolved means
// measured from the user's own labelled references (art/style-clusters.js,
// generated from annotations.json). Between anchors the values interpolate
// linearly, so any control value gets its own in-between style. These are
// artistic calibration choices, not validated measurements of singing.

import { STYLE_CLUSTERS as C } from '../art/style-clusters.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function anchor(key, c) {
  const a = C.loose.stats[key].mean, b = C.gathered.stats[key].mean, d = C.resolved.stats[key].mean;
  return c <= 0.5 ? lerp(a, b, c / 0.5) : lerp(b, d, (c - 0.5) / 0.5);
}

export function styleFor(control) {
  const c = clamp01(control);
  const legibility = anchor('legibility', c);      // how readable the motif is (hand-rated 0..1)
  const bleed = anchor('edgeBleed', c);            // wet-in-wet softness (observed 0..1)
  const contrast = anchor('valueContrast', c);     // measured p95-p5 lightness
  const structure = anchor('structure', c);        // measured large-scale organisation
  return {
    control: c,
    legibility, bleed, contrast, structure,
    // How each role of a motif shows up.
    visibility: {
      ground: 1,
      structure: 0.55 + 0.45 * legibility,
      focal: smooth(0.22, 0.8, legibility),
      detail: smooth(0.5, 0.86, legibility),
      accent: clamp01((contrast - 0.26) / 0.27),
    },
    // Geometry: how far shapes drift from the composition (fractions of width).
    jitter: 0.012 + 0.09 * (1 - legibility) ** 1.5,
    scatter: 0.25 * (1 - legibility) ** 3,
    // Breaks washes into islands when large-scale structure is weak.
    fragment: Math.max(0, (0.54 - structure) * 1.35),
    // Edge behaviour.
    softPx: 1 + 7 * bleed ** 1.5,
    wobblePx: 2 + 22 * bleed,             // ragged, feathered edges (wet paper)
    edge: 0.15 + 0.85 * (1 - bleed),
    bloom: 0.1 + 0.3 * bleed,
    granulation: 0.15 + 3 * anchor('fineTexture', c),
    // Free marks that replace drawn form as control drops.
    gestures: Math.round(7 * smooth(0.45, 0.8, 1 - legibility)),
    freeWashes: Math.round(7 * smooth(0.55, 0.85, 1 - legibility)),
    drips: Math.round(12 * anchor('drips', c)),
    spatter: Math.round(45 * anchor('spatter', c)),
    contour: smooth(0.6, 0.9, legibility) * 0.85,   // descriptive linework at the focal forms
    layers: legibility > 0.7 ? 2 : 1,                // glaze build-up on main forms
  };
}

// Layer C: art direction and prompt construction.
//
//   direct(spec) → { version, level, family, familyLabel, refs, subject,
//                    pigments, swatches, sections, prompt, avoid }
//
// 1. The control tier comes from the spec (layer B).
// 2. A style family is drawn, by seed, from the families derived from that
//    tier's references (families.js). Weight = number of source references,
//    doubled when the motif matches what those references show.
// 3. The motif picks new content suited to the family's treatment; the
//    emotion shifts light and colour within the family's own palette.
// 4. The family's rules, the tier's form rules and the global Sonmira
//    constraints are assembled into one provider-independent prompt.
//
// Every style statement traces to references through `refs`.

import { rng, hashSeed } from '../render/rng.js';
import { FAMILIES, SUBJECTS, AFFINITY, familiesOfTier } from './families.js';

export { FAMILIES, REFERENCES, LIBRARY_VERSION } from './families.js';
export const DIRECTION_VERSION = 3;

// Global Sonmira constraints: true for every family and every tier.
// Materiality is independent of abstraction: Loose, Gathered and Resolved all
// keep strong watercolor behaviour; only how recognisable the subject is
// changes. Colour intensity is left to the family, because the references
// range from pale to saturated.
export const GLOBAL_STYLE = [
  'A genuine hand-painted watercolor on cold-press cotton paper',
  'visible brushwork and natural pigment variation',
  'transparent layered washes, wet-on-wet diffusion, pigment granulation and natural sedimentation, colour bleeding, blooms and backruns',
  'organic, imperfect edges, intentional negative space of reserved white paper',
  'natural paper texture and selective, unfinished passages; hand-made, uneven colour transitions',
  'restraint and breathing room: only a small part of the picture is resolved, recognisable detail concentrated in a limited focal area, the rest left atmospheric, gestural or unfinished, dissolving into transparent washes and bare paper',
  'asymmetry and quiet areas; no forced foreground, middle ground and background',
  'one clear colour idea: a dominant colour family with at most one accent',
  'elegant and considered, beautiful enough to sit inside a refined, minimal app',
  'an original composition, not a copy of any existing artwork',
].join(', ') + '.';

export const AVOID = [
  'neon or fluorescent colour', 'muddy or overworked colour', 'many unrelated colours',
  'cartoon, anime or comic style', 'sentimental greeting-card art', 'generic stock illustration',
  'photorealism', 'cinematic photography', 'lens blur', 'HDR lighting', 'digital airbrushing',
  'smooth artificial gradients', 'a photo-to-watercolor filter effect', 'uniform detail everywhere',
  'digital illustration', 'excessive detail', 'a composition that fills every corner', 'uniformly sharp detail',
  'equally strong contrast from edge to edge', 'airbrushed lighting', 'generic pastel sunsets', 'generic cinematic landscape compositions',
  'a realistic image with paper texture applied',
  'glossy digital rendering', 'heavy black ink outlines',
  'text, letters, titles, signature, logo or watermark', 'a frame, border or mat', 'a photo of a painting on a table',
];

export const LEVELS = {
  loose: {
    label: 'abstract watercolor',
    form: 'Abstract: nothing is deliberately depicted, there is no focal point and no picture space to step into. The marks are the painting.',
  },
  gathered: {
    label: 'semi-abstract watercolor study',
    form: 'Semi-abstract: ambiguous, emerging forms; a mood of place may be felt but no subject is clearly identifiable, and nothing is drawn in detail. Depth is beginning to appear and one area is starting to draw the eye. No complete silhouettes, clearly identifiable objects, realistic perspective or fully formed scenery: ambiguity, not a blurred illustration. Clearly a study, left unfinished in places.',
  },
  resolved: {
    label: 'finished watercolor painting',
    form: 'Finished and fully considered: a clear, recognisable focal subject, a deliberate composition and a complete sense of space, rendered entirely through watercolor technique, never as a realistic image. Fine detail and the sharpest edges only at the focus; secondary elements simplified into painterly gestures.',
  },
};

// Emotion moves light and colour inside the family's palette; it never
// swaps the palette for another.
const EMOTION = {
  tender: 'Tender: the softest, lightest version of these colours, gentle light, more paper showing.',
  bright: 'Bright: the warmest, clearest version of these colours, open sunlit light.',
  melancholic: 'Melancholic: the coolest, quietest version of these colours, subdued, overcast light.',
  intense: 'Intense: the deepest, richest version of these colours, stronger contrast and weight.',
};

const ENERGY = {
  calm: 'Marks: slow and settled.',
  moderate: 'Marks: settled washes with a few quick strokes.',
  lively: 'Marks: quick and energetic, with flicks and splashes.',
};

function pickWeighted(list, r) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of list) if ((x -= w) <= 0) return k;
  return list[list.length - 1][0];
}

// Families allowed for a tier and motif, with weights. A family is left out
// when it has no subject for the motif (with no words, the families whose
// references centre on people).
export function familiesFor(level, motif) {
  return familiesOfTier(level)
    .filter((id) => FAMILIES[id].tier === 'loose' || SUBJECTS[id]?.[motif] != null)
    .map((id) => [id, FAMILIES[id].refs.length * ((AFFINITY[id] || []).includes(motif) ? 2 : 1)]);
}

export function direct(spec) {
  const level = LEVELS[spec.completeness] ? spec.completeness : 'gathered';
  const motif = spec.motif || 'abstract';
  const r = rng(hashSeed(spec.seed >>> 0, 'direct'));
  const drawn = pickWeighted(familiesFor(level, motif), r);
  // A developer override may pick any family; it brings its own tier rules.
  const familyId = FAMILIES[spec.family] ? spec.family : drawn;
  const F = FAMILIES[familyId];
  const tier = F.tier;
  const subject = tier === 'loose' ? null : (SUBJECTS[familyId]?.[motif] ?? SUBJECTS[familyId]?.landscape ?? null);
  const energy = spec.energy?.value || 'calm';

  // One of the family's observed colour schemes: its two dominant colours,
  // sometimes a third, and its accent when it has one. When generation is
  // guided by one primary reference (spec.reference), its own scheme is used,
  // never one seen in another reference.
  const drawnP = F.palettes[Math.floor(r() * F.palettes.length)];
  const own = F.palettes.find((p) => p.ref && p.ref === spec.reference);
  const P = own || drawnP;
  const guided = Boolean(spec.reference);
  const chosen = P.colors.slice(0, 2);
  const rest = P.colors.slice(2);
  if (rest.length && (!P.accent || r() < 0.5)) chosen.push(rest[Math.floor(r() * rest.length)]);
  if (P.accent) chosen.push(P.accent);

  const sections = {
    subject: `${/^[aeiou]/.test(LEVELS[tier].label) ? 'An' : 'A'} ${LEVELS[tier].label}${subject ? ` of ${subject}` : ''}.`,
    family: `Style — ${F.label}: ${F.rules}`,
    form: LEVELS[tier].form,
    palette: `${guided ? `Colour, as seen in the reference${own ? '' : ' (the reference wins where it differs)'}` : 'Colour'}: ${P.colors.filter((p) => chosen.includes(p)).map((p) => p.name).join(', ')}, on white or warm white paper${P.accent ? `, with ${P.accent.name} as the only accent, kept small` : ''}.${own?.light ? ` Light: ${own.light}.` : ''}`,
    emotion: `${guided ? 'Mood, within the reference\'s own colours and light — ' : ''}${EMOTION[spec.emotion] || EMOTION.tender}`,
    energy: ENERGY[energy],
    style: GLOBAL_STYLE,
  };
  const prompt = [sections.subject, sections.family, sections.form, 'Vertical 4:5 format.', sections.palette, sections.emotion, sections.energy, sections.style, `Avoid: ${AVOID.join(', ')}.`].join('\n');
  return {
    version: DIRECTION_VERSION, level: tier, requestedLevel: level,
    family: familyId, familyLabel: F.label, refs: F.refs.slice(),
    subject, pigments: chosen.map((p) => p.name), swatches: chosen, sections, prompt, avoid: AVOID.slice(),
  };
}

// Reference-guided generation: every family follows ONE primary reference
// per generation, drawn from its references by seed, so stylistically
// different references are never blended. Only that image goes to the model,
// and the prompt separates what it controls from what is free.
export function referenceGuide(familyId, seed = 0) {
  const F = FAMILIES[familyId];
  if (!F) throw new Error(`unknown family ${familyId}`);
  const primary = F.refs[Math.floor(rng(hashSeed(seed >>> 0, 'primary-ref'))() * F.refs.length)];
  const refs = [primary];
  const text = [
    'The attached image is the primary style reference for this painting and the visual authority: it overrides every written description below, including colour, light and composition notes.',
    'Controlled by the reference: (1) dominant palette: its principal colour family, saturation, temperature and supporting accents; (2) colour distribution: the balance of dominant, secondary and accent colour; (3) composition: visual weight, asymmetry, focal placement and spatial rhythm; (4) negative space: roughly how much open, lightly painted or untouched paper there is, and where; (5) detail distribution: where detail concentrates and where forms dissolve; (6) watercolor behaviour: its washes, brush marks, blooms, granulation and edges; (7) level of finish: how much is deliberately left incomplete.',
    'Free: the subject and the exact arrangement. Paint a new, original painting in the same artistic language; do not copy or trace its composition, figures or motifs, and do not reproduce any text, titles or watermarks in it.',
  ].join(' ');
  return { refs, primary, text };
}

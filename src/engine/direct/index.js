// Layer C: art direction and prompt construction.
//
//   direct(spec) → { version, level, family, familyLabel, refs, subject,
//                    pigments, swatches, sections, prompt, avoid }
//
// 1. The control tier comes from the spec (layer B).
// 2. A style family is drawn, by seed, from the families derived from that
//    tier's references (families.js), every eligible family equally likely;
//    then one reference image is drawn from that family (library.js).
// 3. The motif picks new content suited to the family's treatment; the
//    emotion shifts light and colour within the family's own palette.
// 4. The family's rules, the tier's form rules and the global Sonmira
//    constraints are assembled into one provider-independent prompt.
//
// Every style statement traces to references through `refs`.

import { rng, hashSeed } from '../render/rng.js';
import { FAMILIES, SUBJECTS, familiesOfTier } from './families.js';
import { LIBRARY, referencePalette, REFERENCE_AUTHORITY } from './library.js';

export { FAMILIES, REFERENCES, LIBRARY_VERSION } from './families.js';
export { LIBRARY, createLibrary, colourName, referencePalette } from './library.js';
export const DIRECTION_VERSION = 5;

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

// With a reference image attached, the reference is the style authority, so
// the written layer says only what is true of every painting and what the
// reference cannot know: the subject (from the lyrics), how recognisable it
// is (the tier), and the mood and gesture of this take, each phrased
// relative to the reference. The universal watercolor technique, composition
// and avoid rules above remain only for text-only generation (no
// reference), where nothing else defines the style. They contradicted
// several families (flat R1, smooth R4/R6, deep-valued R2/R5) and pulled
// every result toward one generic look.
export const REFERENCE_STYLE = 'A hand-made painting in the artistic language of the attached reference: its medium, technique, texture, brushwork, colour treatment, composition language and degree of stylisation. An original composition, not a copy of the reference or of any existing artwork.';
export const REFERENCE_AVOID = [
  'text, letters, titles, signature, logo or watermark', 'a frame, border or mat', 'a photo of a painting on a table',
  'photorealism or a photograph', 'a photo-to-painting filter effect', 'glossy digital or 3D rendering',
];

export const LEVELS = {
  loose: {
    label: 'abstract watercolor',
    refLabel: 'abstract painting',
    form: 'Abstract: nothing is deliberately depicted, there is no focal point and no picture space to step into. The marks are the painting.',
    refForm: 'Abstract: nothing is deliberately depicted and there is no picture space to step into; the reference\'s own marks, colour and texture are the painting.',
  },
  gathered: {
    label: 'semi-abstract watercolor study',
    refLabel: 'semi-abstract painting',
    refForm: 'Semi-abstract: ambiguous, emerging forms; a mood of place may be felt but no subject is clearly identifiable. No complete silhouettes, clearly identifiable objects or fully formed scenery: ambiguity, not a blurred illustration. Less resolved than the reference itself, in its own technique.',
    form: 'Semi-abstract: ambiguous, emerging forms; a mood of place may be felt but no subject is clearly identifiable, and nothing is drawn in detail. Depth is beginning to appear and one area is starting to draw the eye. No complete silhouettes, clearly identifiable objects, realistic perspective or fully formed scenery: ambiguity, not a blurred illustration. Clearly a study, left unfinished in places.',
  },
  resolved: {
    label: 'finished watercolor painting',
    refLabel: 'finished painting',
    refForm: 'Finished and fully considered: a clear, recognisable subject, carried as far and as richly as the reference carries its own, with the reference\'s own finish, edges, detail distribution and composition language. Never a realistic image.',
    form: 'Finished and fully considered: a clear, recognisable focal subject, a deliberate composition and a complete sense of space, rendered entirely through watercolor technique, never as a realistic image. Fine detail and the sharpest edges only at the focus; secondary elements simplified into painterly gestures.',
  },
};

// With a reference: the same moods as a lean within the reference's own
// range, never a fixed lightness, paper share or kind of light.
const EMOTION_REF = {
  tender: 'Mood: tender, leaning toward the softer, gentler end of the reference\'s own colour and value range.',
  bright: 'Mood: bright, leaning toward the warmer, clearer end of the reference\'s own colour and value range.',
  melancholic: 'Mood: melancholic, leaning toward the cooler, quieter end of the reference\'s own colour and value range.',
  intense: 'Mood: intense, leaning toward the deeper, richer end of the reference\'s own colour and value range.',
};
const ENERGY_REF = {
  calm: 'Pace of the marks, in the reference\'s own technique: slow and settled.',
  moderate: 'Pace of the marks, in the reference\'s own technique: mostly settled, with a few quicker marks.',
  lively: 'Pace of the marks, in the reference\'s own technique: quick and energetic.',
};

// Emotion moves light and colour inside the family's palette; it never
// swaps the palette for another.
const EMOTION = {
  tender: 'Tender: the softest, lightest version of these colours, gentle light, more paper showing.',
  bright: 'Bright: the warmest, clearest version of these colours, open sunlit light.',
  melancholic: 'Melancholic: the coolest, quietest version of these colours, subdued, overcast light.',
  intense: 'Intense: the deepest, richest version of these colours, stronger contrast and weight.',
};

// How the voice moved, as marks (spec.expression, from the recording):
// gesture varies within the reference's language, never its identity.
export const EXPRESSION = {
  range: { narrow: 'strokes kept close and contained', moderate: 'strokes that rise and fall a little', wide: 'long, travelling strokes that sweep across the sheet' },
  flow: { connected: 'one connected flow of washes', broken: 'separate islands of marks with paper between them' },
  dynamics: { even: 'even pressure throughout', swelling: 'washes swelling from pale to deep and back' },
  vibrato: 'a gently trembling edge to some strokes',
};

export const EXPRESSION_REF = {
  range: { narrow: 'marks kept close and contained', moderate: 'marks that rise and fall a little', wide: 'long, travelling marks across the sheet' },
  flow: { connected: 'one connected flow', broken: 'separate islands of marks' },
  dynamics: { even: 'even pressure throughout', swelling: 'marks swelling from light to strong and back' },
  vibrato: 'a gently trembling edge to some marks',
};

export function expressionLine(x, withReference = false) {
  if (!x) return null;
  const E = withReference ? EXPRESSION_REF : EXPRESSION;
  const parts = [E.range[x.range], E.flow[x.flow], E.dynamics[x.dynamics], x.vibrato ? E.vibrato : null].filter(Boolean);
  if (!parts.length) return null;
  return withReference ? `Gesture, from how the voice moved, made only with the reference's own kind of marks: ${parts.join('; ')}.` : `Gesture, from how the voice moved: ${parts.join('; ')}.`;
}

// What the painting expresses, from the song's words (spec.concept). The
// tier decides how recognisable it is; the family and reference decide how it
// looks. Figurative language is painted as its meaning.
const article = (label) => `${/^[aeiou]/.test(label) ? 'An' : 'A'} ${label}`;
const labelOf = (tier, withReference) => (withReference ? LEVELS[tier].refLabel : LEVELS[tier].label);
function subjectFromConcept(tier, c, withReference = false) {
  if (tier === 'loose') return `${article(labelOf('loose', withReference))}. It depicts nothing; its marks carry the feeling of the sung words: ${c.text}`;
  if (tier === 'gathered') return `${article(labelOf('gathered', withReference))}, only suggesting, never spelling out: ${c.text}`;
  return `${article(labelOf('resolved', withReference))} of: ${c.text}`;
}

function meaningLine(tier, c) {
  const out = [];
  if (c.theme?.length) out.push(`theme: ${c.theme.join(', ')}`);
  if (tier !== 'loose' && c.imagery?.length) out.push(`imagery: ${c.imagery.join(', ')}`);
  let line = out.length ? `From the sung words — ${out.join('; ')}.` : '';
  if (c.figurative?.length) line += ` Figurative words are painted as their meaning, never literally: ${c.figurative.map((f) => `"${f.phrase}" means ${f.meaning}`).join('; ')}.`;
  return line.trim() || null;
}

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

// Families allowed for a tier, each equally likely: the style is chosen
// first among families, then an image within the family (library.select),
// so a family with more references is not chosen more often. A family is
// left out only when it cannot be painted: it has no active reference, or
// there are no words and it has no subject of its own for the motif (the
// families whose references centre on people). With words the subject comes
// from the lyrics, so every family of the tier is eligible.
export function familiesFor(level, motif, library = LIBRARY, { concept = false } = {}) {
  const all = familiesOfTier(level);
  const paintable = all.filter((id) => FAMILIES[id].tier === 'loose' || concept || SUBJECTS[id]?.[motif] != null);
  const stocked = paintable.filter((id) => library.pool(id).length > 0);
  return (stocked.length ? stocked : paintable.length ? paintable : all).map((id) => [id, 1]);
}

export function direct(spec) {
  const level = LEVELS[spec.completeness] ? spec.completeness : 'gathered';
  const motif = spec.motif || 'abstract';
  const r = rng(hashSeed(spec.seed >>> 0, 'direct'));
  const library = spec.library || LIBRARY;
  const drawn = pickWeighted(familiesFor(level, motif, library, { concept: Boolean(spec.concept?.text) }), r);
  // A developer override may pick any family; it brings its own tier rules.
  const familyId = FAMILIES[spec.family] ? spec.family : drawn;
  const F = FAMILIES[familyId];
  const tier = F.tier;
  const subject = tier === 'loose' ? null : (SUBJECTS[familyId]?.[motif] ?? SUBJECTS[familyId]?.landscape ?? null);
  const energy = spec.energy?.value || 'calm';

  // The primary reference: drawn from the family's pool by seed (or given,
  // e.g. by a tool, when it belongs to this family).
  const given = spec.reference && library.get(spec.reference);
  const reference = given && given.family === familyId && given.active ? given : library.select(familyId, spec.seed);
  const fromRef = referencePalette(reference);

  // Colour comes from the reference's measured hierarchy. Only a reference
  // that has not been indexed yet falls back to one of the family's observed
  // schemes: its two dominant colours, sometimes a third, and its accent.
  const P = F.palettes[Math.floor(r() * F.palettes.length)];
  const chosen = P.colors.slice(0, 2);
  const rest = P.colors.slice(2);
  if (rest.length && (!P.accent || r() < 0.5)) chosen.push(rest[Math.floor(r() * rest.length)]);
  if (P.accent) chosen.push(P.accent);
  const swatches = fromRef ? fromRef.swatches : chosen;

  // The subject: from the song's words when there are any; a Loose take
  // without words expresses the sound itself; otherwise (no understanding
  // step, e.g. tools) the family's own subject for the motif.
  const concept = spec.concept?.text ? spec.concept : null;
  const withRef = Boolean(reference);
  const subjectLine = concept ? subjectFromConcept(tier, concept, withRef)
    : tier === 'loose' && spec.soundOnly ? `${article(labelOf('loose', withRef))} that expresses the sound of the voice itself, not any subject or story.`
    : `${article(labelOf(tier, withRef))}${subject ? ` of ${subject}` : ''}.`;
  const avoid = withRef ? REFERENCE_AVOID : AVOID;
  const sections = {
    subject: subjectLine,
    meaning: concept ? meaningLine(tier, concept) : null,
    family: `Style — ${F.label}: ${F.rules}${concept ? ' Where this style names people, places or objects, use them only if they fit the subject above.' : ''}`,
    form: withRef ? LEVELS[tier].refForm : LEVELS[tier].form,
    // With a subject from the words, the reference's light note (which can
    // name its own objects, e.g. "sun through leaves") becomes its quality only.
    palette: fromRef ? (concept ? fromRef.text.replace(/Light: [^.]*\./, 'Light: the reference\'s own quality and direction of light, carried onto the new subject.') : fromRef.text) : `Colour: ${P.colors.filter((p) => chosen.includes(p)).map((p) => p.name).join(', ')}, on white or warm white paper${P.accent ? `, with ${P.accent.name} as the only accent, kept small` : ''}.`,
    // Sound varies mood and marks inside the reference's language, never its identity.
    emotion: withRef ? (EMOTION_REF[spec.emotion] || EMOTION_REF.tender) : (EMOTION[spec.emotion] || EMOTION.tender),
    energy: withRef ? ENERGY_REF[energy] : ENERGY[energy],
    gesture: expressionLine(spec.expression, withRef),
    style: withRef ? REFERENCE_STYLE : GLOBAL_STYLE,
  };
  const prompt = [sections.subject, sections.meaning, sections.family, sections.form, 'Vertical 4:5 format.', sections.palette, sections.emotion, sections.energy, sections.gesture, sections.style, `Avoid: ${avoid.join(', ')}.`].filter(Boolean).join('\n');
  return {
    version: DIRECTION_VERSION, level: tier, requestedLevel: level,
    family: familyId, familyLabel: F.label, refs: library.pool(familyId).map((e) => e.path.split('/').pop()),
    // The one reference image to send with `referencePrompt + prompt`.
    reference: reference ? { id: reference.id, path: reference.path, family: reference.family } : null,
    referencePrompt: reference ? REFERENCE_AUTHORITY : null,
    libraryVersion: library.version, seed: spec.seed >>> 0,
    subject: concept ? concept.text : subject, subjectSource: concept ? 'lyrics' : tier === 'loose' && spec.soundOnly ? 'sound' : 'family',
    pigments: swatches.map((p) => p.name), swatches, sections, prompt, avoid: avoid.slice(),
  };
}

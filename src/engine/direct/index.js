// Layer C: art direction and prompt construction.
//
//   direct(spec) → { version, level, family, familyLabel, refs, subject,
//                    pigments, swatches, sections, prompt, avoid }
//
// 1. The control tier comes from the spec (layer B).
// 2. A style family is drawn, by seed, from the families derived from that
//    tier's references (families.js), every eligible family equally likely;
//    then one reference image is drawn from that family (library.js).
// 3. What is depicted comes from the lyrics, else the person's note, else an
//    atmosphere of the motif with no objects (never from the family or its
//    references); the emotion shifts light and colour within the palette.
// 4. The family's rules, the tier's form rules and the global Sonmira
//    constraints are assembled into one provider-independent prompt.
//
// Every style statement traces to references through `refs`.

import { rng, hashSeed } from '../render/rng.js';
import { FAMILIES, familiesOfTier } from './families.js';
import { LIBRARY, referencePalette, referenceColourLanguage, referenceColourRange, REFERENCE_AUTHORITY, REFERENCE_AUTHORITY_RESOLVED, REFERENCE_AUTHORITY_LOOSE, REFERENCE_AUTHORITY_PERFORMANCE, REFERENCE_AUTHORITY_PERFORMANCE_RESOLVED, tierOf } from './library.js';
import { PEOPLE } from './leakage.js';
import { chooseLook, lookLine, signatureOf, cleanRecent, cleanOptions } from './looks.js';
import { compositionPlan, compositionLine } from './composition.js';
import { soundPlan } from './sound.js';
import { performanceDirection, performanceSections, PERFORMANCE_FORM_GATHERED_MOTIF } from './performance.js';

export { FAMILIES, REFERENCES, LIBRARY_VERSION } from './families.js';
export { LIBRARY, createLibrary, colourName, referencePalette } from './library.js';
export { checkLeakage, checkPrompt } from './leakage.js';
export { soundPlan } from './sound.js';
export { performanceDirection, performanceSections } from './performance.js';
export const DIRECTION_VERSION = 15;

// Every tier's people rule in the Avoid line (Resolved with a scene figure: narrativeFor).
export const AVOID_PEOPLE = 'people, human figures, silhouettes or faces';

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
// Resolved without a reference: the same constraints, but a richer palette
// (Han, 19 Oct) instead of one colour idea.
export const GLOBAL_STYLE_RESOLVED = GLOBAL_STYLE.replace('one clear colour idea: a dominant colour family with at most one accent', 'a considered palette of three to five clearly distinct colour families, one of them leading');

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
  AVOID_PEOPLE,
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
// Loose: the reference gives the language, the performance the picture.
export const REFERENCE_STYLE_LOOSE = 'A hand-made painting in the artistic language of the attached reference: its medium, technique, texture, brushwork and degree of abstraction, with a new composition and colour shaped by this performance. An original painting, not a copy of the reference or of any existing artwork.';
// A reference with no family (uploaded straight into a tier folder): no
// family's rules or colours describe it, so the image alone sets the style.
export const REFERENCE_ONLY_STYLE = 'Style: entirely the attached reference\'s own; follow its technique, marks, texture and edges as they are, without adding a technique it does not show. This describes only how it is painted, never what is depicted.';
// Every tier with a measured performance: the reference's language, the
// performance's composition, the words' subject.
export const REFERENCE_STYLE_PERFORMANCE = 'A hand-made painting in the artistic language of the attached reference: its medium, technique, texture, brushwork and degree of stylisation, with a new composition, movement and colour relations shaped by this performance. An original painting, not a copy of the reference or of any existing artwork.';
export const REFERENCE_ONLY_COLOUR = 'Colour: the attached reference\'s own colour language, read from the image.';

export const REFERENCE_AVOID = [
  'text, letters, titles, signature, logo or watermark', 'a frame, border or mat', 'a photo of a painting on a table',
  'photorealism or a photograph', 'a photo-to-painting filter effect', 'glossy digital or 3D rendering',
  AVOID_PEOPLE, 'a centred, symmetrical composition',
];

// What may be depicted, for every tier and family. The references and the
// family rules decide only how the painting is made; the subject above is
// the whole content. No people in any tier: a reference with figures lends
// its treatment, never its figures, and words about people are painted
// through place, light and traces. The one exception is a small figure a
// Resolved scene names (CONTENT_RULE_FIGURE, narrativeFor).
export const CONTENT_RULE = 'Content: paint only what the subject above names, in its own setting, and add no objects, scenery or story that it does not ask for. No people anywhere: no human figures, silhouettes, faces or body parts, however small or distant. When the words tell of love, loss or company, carry that through place, light, weather and the traces left behind.';

// The subject when there are neither reliable words nor a note (Gathered and
// Resolved): an atmosphere of the motif, with nothing placed in it. The tier
// still decides how recognisable it is; the family how it is painted.
export const ATMOSPHERES = {
  water: 'water as atmosphere: its surface, depth, movement and the light on it',
  sky: 'sky as atmosphere: cloud, air, weather and light',
  garden: 'growing things as atmosphere: foliage, blossom and light, close and enveloping',
  landscape: 'open land as atmosphere: ground, horizon, distance and light',
  interior: 'the quiet light of an inside space falling across bare surfaces',
  abstract: 'colour, light and texture alone, nothing named',
};

// Resolved with neither words nor a note: still a scene (Han, 19 Oct), a
// particular place seen from somewhere, with a focal point, not an atmosphere.
// No story is invented for it.
export const RESOLVED_PLACES = {
  water: 'a particular place on or beside the water, seen from a clear viewpoint, with one focal point where the light gathers',
  sky: 'a particular place under a wide sky, the land or water below giving it scale, with one focal point where the weather or the light breaks',
  garden: 'a particular corner of a garden, close and enveloping, with one focal opening or plant where the light falls',
  landscape: 'a particular stretch of open land seen from a clear viewpoint, a path, field edge or horizon giving it depth, with one focal point',
  interior: 'a particular quiet room, with one focal surface, window or doorway where the light falls',
  abstract: 'a particular, quiet place made of colour and light, with one focal point and a clear sense of near and far',
};

// Resolved is a scene, not a mood (Han, 19 Oct), on every Resolved path.
export const RESOLVED_SCENE = 'Resolved means a scene, not a mood: one recognisable visual situation, symbolic event or emotionally readable moment with a clear focal point and readable spatial logic (where things stand, near and far, what leads the eye), visibly about something happening or that has just happened. More specific, more scene-aware, more compositionally intentional and more narratively or symbolically meaningful than a semi-abstract study, not only more finished; never only an atmospheric wash, a pattern or a generic landscape. It may stay poetic, and the viewer must still feel how it answers the words.';
// Resolved words with no scene read from them (an older reading, or a
// reading that found none): the painting is told to imagine one.
export const RESOLVED_IMAGINE = 'When the words name feelings rather than things, imagine where that feeling is lived and paint that place and moment, built from the song\'s own images: waiting, lingering, separation, a long journey, quiet endurance, traces of memory, distance, a parting of ways, a departure or an unfinished return. These are conditions to reason from, not pictures to reuse: invent an original, emotionally grounded situation for this song rather than a familiar or stock setting, with nothing disconnected or generic. Abstract meaning becomes a concrete poetic scene: neither a literal illustration nor an empty abstraction.';

// Gathered with words (Han, 19 Oct): at least one motif from the words is
// recognisable, however loosely painted, so the painting is visibly about
// what was sung. Gathered keeps its ambiguity, atmosphere and unfinished
// passages around it and takes no storyline (that stays Resolved's).
// Without words (unreliable or none) nothing changes: the sound leads.
export const GATHERED_MOTIF = 'The motif from the words must be recognisable at a glance: a viewer can name it. It may be loose, partial, gestural or unfinished, its edges dissolving into the washes, but it is never lost in them. Recognisability is mandatory; realism is not. One or two motifs at most, never every word illustrated, and no complete scene or storyline; everything around them stays atmospheric, ambiguous and only selectively detailed.';
export const GATHERED_MOTIF_FORM = PERFORMANCE_FORM_GATHERED_MOTIF;

export const LEVELS = {
  loose: {
    label: 'abstract watercolor',
    refLabel: 'abstract painting',
    form: 'Abstract: nothing is deliberately depicted, there is no focal point and no picture space to step into. The marks are the painting.',
    refForm: 'Abstract: nothing is deliberately depicted and there is no picture space to step into; the painting is made only of the reference\'s kind of marks, washes and texture, arranged and coloured as the performance plan below describes.',
  },
  gathered: {
    label: 'semi-abstract watercolor study',
    refLabel: 'semi-abstract painting',
    refForm: 'Semi-abstract: ambiguous, emerging forms; a mood of place may be felt but no subject is clearly identifiable. No complete silhouettes, clearly identifiable objects or fully formed scenery: ambiguity, not a blurred illustration. Less resolved than the reference itself, in its own technique. Mood-forward: the feeling leads, the story stays light and the subject may remain partly implied.',
    form: 'Semi-abstract: ambiguous, emerging forms; a mood of place may be felt but no subject is clearly identifiable, and nothing is drawn in detail. Depth is beginning to appear and one area is starting to draw the eye. No complete silhouettes, clearly identifiable objects, realistic perspective or fully formed scenery: ambiguity, not a blurred illustration. Clearly a study, left unfinished in places. Mood-forward: the feeling leads, the story stays light and the subject may remain partly implied.',
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
// Loose with words: the words' mood, free of the reference's own range
// (the performance plan sets the colour; the mood leans it).
const EMOTION_LOOSE = {
  tender: 'Mood, from the words: tender, so softer and gentler colour and light.',
  bright: 'Mood, from the words: bright, so warmer, clearer colour and open light.',
  melancholic: 'Mood, from the words: melancholic, so cooler, quieter colour and subdued light.',
  intense: 'Mood, from the words: intense, so deeper, richer colour and stronger contrast.',
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
  flow: { connected: 'one connected flow of washes', broken: 'separate patches of marks with paper between them' },
  dynamics: { even: 'even pressure throughout', swelling: 'washes swelling from pale to deep and back' },
  vibrato: 'a gently trembling edge to some strokes',
};

export const EXPRESSION_REF = {
  range: { narrow: 'marks kept close and contained', moderate: 'marks that rise and fall a little', wide: 'long, travelling marks across the sheet' },
  flow: { connected: 'one connected flow', broken: 'separate patches of marks' },
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
const wordsOf = (c) => (c.source === 'note' ? "the note written for this moment" : 'the sung words');
function subjectFromConcept(tier, c, withReference = false) {
  if (tier === 'loose') return `${article(labelOf('loose', withReference))}. It depicts nothing; its marks carry the feeling of ${wordsOf(c)}: ${c.text}`;
  if (tier === 'gathered') return `${article(labelOf('gathered', withReference))} with a recognisable motif from ${wordsOf(c)}: ${c.text}`;
  return `${article(labelOf('resolved', withReference))} of: ${c.text}`;
}

function meaningLine(tier, c) {
  const out = [];
  if (c.theme?.length) out.push(`theme: ${c.theme.join(', ')}`);
  // People are never painted, so imagery naming them is left out.
  const imagery = (c.imagery ?? []).filter((x) => !PEOPLE.test(x));
  if (tier !== 'loose' && imagery.length) out.push(`imagery: ${imagery.join(', ')}`);
  let line = out.length ? `From ${wordsOf(c)} — ${out.join('; ')}.` : '';
  if (c.figurative?.length) line += ` Figurative words are painted as their meaning, never literally: ${c.figurative.map((f) => `"${f.phrase}" means ${f.meaning}`).join('; ')}.`;
  return line.trim() || null;
}

// Resolved narrative (Han, 19 Oct): the words read as one story moment
// (openai-understand.js `scene`), so a Resolved painting shows a meaningful
// scene from the song, not an illustration of one keyword. The words decide
// the scene; the reference still how finished; the performance still where
// and how it moves. Without a usable moment there is no narrative.
// People (Han, 19 Oct): Resolved only, and only when the scene itself names
// a figure (`scene.figure`, optional): small, distant and faceless, never a
// portrait or a foreground character, never added because the tier is
// Resolved. Without a figure the no-people rule holds as in every tier: a
// scene part naming people is dropped, a moment naming people is not painted.
export const NARRATIVE_RULE = 'A complete image with narrative or symbolic presence, one meaningful moment from the song: never a decorative symbol or a keyword illustrated for its own sake, and never a generic landscape; an object or symbol may lead only when it embodies the song\'s emotional event. The arrangement, spacing and placement of its elements, and the traces left in it, carry the relationship and the tension. It may stay poetic and painterly. Add nothing that does not serve the words\' meaning.';
export const NARRATIVE_STAGING = 'Stage it inside the performance structure below: the decisive element sits at the focal passage, the gaps of paper between masses are the distances in the scene, and breaks in the singing stay breaks in it.';
export const FIGURE_RULE = 'Small, distant and faceless, painted in a few strokes of the reference\'s own marks, part of the scene rather than its portrait.';
// The content rule when the scene names a figure (Resolved only).
export const CONTENT_RULE_FIGURE = 'Content: paint only what the subject above names, in its own setting, and add no objects, scenery or story that it does not ask for. People only as the scene above names them: small, distant and faceless, a few painterly strokes in the reference\'s own marks; never a portrait, a visible face, a large or foreground figure, or any people the scene does not name. Carry the rest of the story through place, light, weather and the traces left behind.';
export const AVOID_PEOPLE_FIGURE = 'portraits, visible faces, close-up, large or foreground figures, and any people the scene does not name';
// A near view (Han's review of PR #29, 19 Oct): a Resolved direction seen
// close, or a person-led one at middle distance, may be an expressive
// portrait: face, eyes and tears, when the words warrant it. Never the
// default, never people the words do not justify; other tiers unchanged.
export const FIGURE_RULE_NEAR = 'Seen near, as the scene gives it: the face, eyes, tears and expression may show when the scene names them, the emotion legible, painted in the reference\'s own marks and finish; a painted portrait, never a photographic or glamour one.';
export const CONTENT_RULE_FIGURE_NEAR = 'Content: paint only what the subject above names, in its own setting, and add no objects, scenery or story that it does not ask for. People only as the scene above names them, seen near: their face and its emotion may show when the scene names them; no other people, and nothing posed, photographic or glamorous. Carry the rest of the story through gesture, the things held or touched, place and light.';
export const AVOID_PEOPLE_FIGURE_NEAR = 'a posed, photographic or glamour portrait, and any people the scene does not name';
// Many people (Han's review): a crowd when the words call for one.
export const FIGURE_RULE_MANY = 'Many people, painted as massed, gestural strokes in the reference\'s own marks, part of the scene rather than portraits of anyone.';
// A distant figure that would be a portrait or a main character is not painted.
export const PROMINENT = /\b(?:portraits?|faces?|close-?ups?|foreground|large|giant|huge|eyes|expressions?)\b/i;
const FACE = /\b(?:portraits?|faces?|close-?ups?)\b/i;
const withFigure = (list, figure, near = false) => (figure ? list.map((x) => (x === AVOID_PEOPLE ? (near ? AVOID_PEOPLE_FIGURE_NEAR : AVOID_PEOPLE_FIGURE) : x)) : list);
const contentRule = (n) => (n.figure ? (n.near ? CONTENT_RULE_FIGURE_NEAR : CONTENT_RULE_FIGURE) : CONTENT_RULE);
const sentence = (s) => String(s).trim().replace(/[.\s]+$/, '');
export function narrativeFor(tier, c, { performance = false, look = null } = {}) {
  if (tier !== 'resolved') return { applied: false, reason: `tier ${tier}`, line: null, figure: null };
  // A visual direction chosen from the reading's options (looks.js) is the
  // image to paint, with its own figure, if any.
  const chosen = look?.source === 'words' ? look : null;
  const scene = chosen ? { ...c?.scene, moment: chosen.image, figure: chosen.figures !== 'none' ? chosen.figure : '' } : c?.scene;
  if (!scene?.moment) return { applied: false, reason: 'no scene read from the words', line: null, figure: null };
  const near = Boolean(chosen && chosen.figures !== 'none' && (chosen.distance === 'close' || (chosen.distance === 'medium' && chosen.lead === 'person')));
  const many = Boolean(chosen && chosen.figures === 'many');
  const asked = scene.figure && String(scene.figure).trim();
  const figure = asked && (near || !PROMINENT.test(asked)) ? sentence(asked) : null;
  const faceless = (v) => near || !FACE.test(v);
  if (PEOPLE.test(scene.moment) && (!figure || !faceless(scene.moment))) return { applied: false, reason: figure ? 'the scene shows a face or portrait' : asked ? 'the scene\'s figure is too prominent' : 'the scene names people', line: null, figure: null };
  const parts = { situation: scene.situation, relationship: scene.relationship, tension: scene.tension };
  const ok = (v) => v && faceless(v) && (figure || !PEOPLE.test(v));
  const kept = Object.fromEntries(Object.entries(parts).filter(([, v]) => ok(v)));
  const line = [
    kept.situation ? `The moment from ${wordsOf(c)}: ${sentence(kept.situation)}.` : `The moment from ${wordsOf(c)}.`,
    kept.relationship ? `Relationship: ${sentence(kept.relationship)}.` : null,
    kept.tension ? `Tension: ${sentence(kept.tension)}.` : null,
    `Paint this scene: ${sentence(scene.moment)}.`,
    figure ? `Figure: ${figure}. ${near ? FIGURE_RULE_NEAR : many ? FIGURE_RULE_MANY : FIGURE_RULE}` : null,
    NARRATIVE_RULE,
    performance ? NARRATIVE_STAGING : null,
  ].filter(Boolean).join(' ');
  return {
    applied: true, reason: chosen ? `Resolved: direction ${chosen.direction} chosen from the reading's options` : 'Resolved: the words read as one story moment', line, figure, near: Boolean(figure && near),
    scene: { ...kept, moment: scene.moment, ...(figure ? { figure } : {}) },
    dropped: [...Object.keys(parts).filter((k) => parts[k] && !kept[k]), ...(asked && !figure ? ['figure'] : [])],
  };
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

// Families allowed for a tier, each equally likely: the style family is
// chosen among the tier's families, so a family with more references is not
// chosen more often; the reference image is drawn separately from the whole
// tier (library.selectInTier). Every family
// can paint any subject (the subject never comes from the family), so a
// family is left out only when it has no active reference. `motif` and
// `concept` no longer change eligibility; kept for callers.
export function familiesFor(level, motif, library = LIBRARY, { concept = false } = {}) { // eslint-disable-line no-unused-vars
  const all = familiesOfTier(level);
  const stocked = all.filter((id) => library.pool(id).length > 0);
  return (stocked.length ? stocked : all).map((id) => [id, 1]);
}

// Resolved finish inheritance (Han, 19 Oct): a Resolved painting must reach
// the selected reference's level of artistic finish. The reference decides
// how finished and how it is painted; the words what is painted; the
// performance how the composition, movement and gestures unfold. Resolved
// only: Loose and Gathered keep their own, less finished forms.
export const RESOLVED_FINISH = [
  'Level of finish, inherited from the reference: a finished work by an accomplished watercolour artist, not merely a beautiful watercolour sketch.',
  'Match the reference\'s degree of finish, refinement, developed detail and technical sophistication through its own technique: deliberate focal detailing, sophisticated brushwork, layered pigment, controlled edges and an intentional visual hierarchy.',
  'Finish is not photorealism, excessive detail or filling the whole sheet: keep expressive abstraction and open paper where the reference and the plan call for them.',
  'Match its level of artistic accomplishment, never its content or composition.',
].join(' ');

// The performance-led direction (all tiers, with a reference and a measured
// performance): the reference gives technique only, the words the subject,
// the singing everything about how it is painted (performance.js).
function directFromPerformance({ tier, F, refOnly, reference, concept, subjectLine, emotion, perf, withRef, narrative, scene, motif }) {
  const colourLanguage = referenceColourLanguage(refOnly ? null : reference)
    .replace(/^Colour language(?: of the reference)?[^:]*: /, '').replace(/\.$/, '');
  const P = performanceSections(perf, tier, colourLanguage, { palette: tier === 'resolved' ? referenceColourRange(refOnly ? null : reference).text : null, motif: Boolean(motif) });
  const technique = refOnly ? REFERENCE_ONLY_STYLE
    : `Technique — ${F.label}: ${F.technique} This describes only how it is painted, never what is depicted or where.`;
  const avoid = [...withFigure(REFERENCE_AVOID, narrative.figure, narrative.near), 'the reference\'s own layout or placement of colour', ...(perf.disorder ? ['smoothing over the breaks and clashes described above'] : [])];
  const sections = {
    subject: subjectLine,
    meaning: concept ? meaningLine(tier, concept) : null,
    narrative: narrative.line,
    scene,
    motif,
    family: technique,
    content: contentRule(narrative),
    form: P.form,
    finish: tier === 'resolved' && withRef ? RESOLVED_FINISH : null,
    composition: P.structure,
    staging: P.staging,
    passages: P.passages,
    marks: P.marks,
    contrast: P.contrast,
    palette: P.colour,
    // Mood only from the words: without them the singing alone decides.
    emotion: concept ? EMOTION_LOOSE[emotion] || EMOTION_LOOSE.tender : null,
    disorder: P.disorder,
    style: withRef ? REFERENCE_STYLE_PERFORMANCE : tier === 'resolved' ? GLOBAL_STYLE_RESOLVED : GLOBAL_STYLE,
  };
  const prompt = [sections.subject, sections.meaning, sections.narrative, sections.scene, sections.motif, sections.family, sections.content, sections.form, sections.finish, sections.composition, sections.staging, sections.passages, sections.marks, sections.contrast, 'Vertical 4:5 format.', sections.palette, sections.emotion, sections.disorder, sections.style, `Avoid: ${avoid.join(', ')}.`].filter(Boolean).join('\n');
  return { sections, prompt, avoid };
}

export function direct(spec) {
  const level = LEVELS[spec.completeness] ? spec.completeness : 'gathered';
  const motif = spec.motif || 'abstract';
  const r = rng(hashSeed(spec.seed >>> 0, 'direct'));
  const library = spec.library || LIBRARY;
  const drawn = pickWeighted(familiesFor(level, motif, library, { concept: Boolean(spec.concept?.text) }), r);
  // A developer override may pick any family; it brings its own tier rules.
  const pinned = FAMILIES[spec.family] ? spec.family : null;

  // The primary reference: drawn by seed from every reference of the tier,
  // whatever its family, each equally likely (Han, 18 Oct); from the family's
  // pool when a tool pins the family. A given reference is used when it
  // belongs to the pinned family, or else to the tier.
  const tierOfDraw = FAMILIES[pinned ?? drawn].tier;
  const given = spec.reference && library.get(spec.reference);
  const fits = given?.active && (pinned ? given.family === pinned : tierOf(given) === tierOfDraw);
  const reference = fits ? given : pinned ? library.select(pinned, spec.seed) : library.selectInTier(tierOfDraw, spec.seed);
  // The style family follows the reference, so the written style matches
  // the image; a reference with no family (uploaded straight into a tier
  // folder) keeps the drawn family.
  const familyId = pinned ?? reference?.family ?? drawn;
  const F = FAMILIES[familyId];
  const tier = F.tier;
  // A reference with no family takes no family's rules, colours or
  // composition language: only the drawn family's tier applies.
  const refOnly = Boolean(reference) && !pinned && !reference.family;
  const subject = tier === 'loose' ? null : tier === 'resolved' ? (RESOLVED_PLACES[motif] ?? RESOLVED_PLACES.abstract) : (ATMOSPHERES[motif] ?? ATMOSPHERES.abstract);
  const energy = spec.energy?.value || 'calm';
  const fromRef = referencePalette(reference);

  // Colour comes from the reference's measured hierarchy. Only a reference
  // that has not been indexed yet falls back to one of the family's observed
  // schemes: its two dominant colours, sometimes a third, and its accent.
  const P = F.palettes[Math.floor(r() * F.palettes.length)];
  const chosen = P.colors.slice(0, 2);
  const rest = P.colors.slice(2);
  if (rest.length && (!P.accent || r() < 0.5)) chosen.push(rest[Math.floor(r() * rest.length)]);
  if (P.accent) chosen.push(P.accent);
  // Resolved (Han, 19 Oct): the whole observed scheme, for colour richness.
  if (tier === 'resolved') chosen.splice(0, chosen.length, ...P.colors, ...(P.accent ? [P.accent] : []));
  const swatches = fromRef ? fromRef.swatches : refOnly ? [] : chosen;

  // The subject: from the song's words when they are reliable, else from the
  // person's note (both arrive as `concept`, with source 'lyrics' or 'note');
  // a Loose take without either expresses the sound itself; otherwise an
  // atmosphere of the motif, with no objects or figures invented for it.
  const concept = spec.concept?.text ? spec.concept : null;
  const withRef = Boolean(reference);
  // Loose with its reference (Han, 18 Oct): the reference gives the
  // language; how this voice moved gives the composition, marks and colour
  // (sound.js), and the reference no longer dictates layout or exact hues.
  // Every tier, when the take was measured (Han, 18 Oct): the singing
  // decides how it is painted, the reference only the technique.
  const perf = withRef && spec.performance ? performanceDirection(spec.performance) : null;
  const performance = !perf && tier === 'loose' && withRef ? soundPlan({ expression: spec.expression, energy }) : null;
  let subjectLine = concept ? subjectFromConcept(tier, concept, withRef)
    : tier === 'loose' && spec.soundOnly ? `${article(labelOf('loose', withRef))} that expresses the sound of the voice itself, not any subject or story.`
    : `${article(labelOf(tier, withRef))}${subject ? ` of ${subject}` : ''}.`;
  // Resolved (Han, 19 Oct): the strongest of the reading's visual directions
  // that the person's last five Resolved paintings did not already use
  // (looks.js); an option that cannot be painted (it would show a face or
  // unnamed people) gives way to the next.
  const recentLooks = cleanRecent(spec.recentLooks);
  const options = cleanOptions(concept?.scene?.options);
  let look = tier === 'resolved' ? chooseLook({ options, recent: recentLooks, seed: spec.seed }) : null;
  let narrative = narrativeFor(tier, concept, { performance: Boolean(perf), look });
  const unusable = [];
  while (look?.source === 'words' && !narrative.applied) {
    unusable.push({ direction: look.direction, rank: look.rank, reason: narrative.reason });
    look = chooseLook({ options, recent: recentLooks, seed: spec.seed, exclude: unusable.map((u) => u.rank) });
    if (look.source !== 'words') { narrative = narrativeFor(tier, concept, { performance: Boolean(perf) }); break; }
    narrative = narrativeFor(tier, concept, { performance: Boolean(perf), look });
  }
  if (look) look.recentLooks = recentLooks;
  // The chosen direction's image is the subject (the reading's Resolved
  // concept describes only its first option).
  if (look?.source === 'words' && narrative.applied) subjectLine = `${article(labelOf('resolved', withRef))} of: ${look.image}`;
  const lookText = tier === 'resolved' ? lookLine(look) : null;
  const scene = tier !== 'resolved' ? null : [concept && !narrative.applied ? `${RESOLVED_SCENE} ${RESOLVED_IMAGINE}` : RESOLVED_SCENE, lookText].join(' ');
  const motifLine = tier === 'gathered' && concept ? GATHERED_MOTIF : null;
  const avoid = withFigure(withRef ? (performance ? [...REFERENCE_AVOID, 'the reference\'s own layout or placement of colour'] : REFERENCE_AVOID) : AVOID, narrative.figure, narrative.near);
  const drawnPlan = tier === 'loose' ? null : compositionPlan(refOnly ? null : familyId, spec.seed);
  // Resolved: the visual direction decides the distance and angle of view.
  const plan = drawnPlan && look ? { ...drawnPlan, viewpoint: look.source === 'words' ? 'the view the visual direction above gives' : 'the viewpoint above' } : drawnPlan;
  const familyLine = refOnly ? REFERENCE_ONLY_STYLE
    : `Style — ${F.label}: ${F.rules} This describes only how it is painted, never what is depicted.${performance ? ' Where it describes a layout or a direction, the performance plan below decides instead.' : ''}`;
  // The reference's light note can name its own objects ("sun through
  // leaves", "windows under violet shadow"), so only its quality is kept.
  const measured = fromRef ? fromRef.text.replace(/Light: [^.]*\./, 'Light: the reference\'s own quality and direction of light, carried onto the new subject.') : null;
  // Resolved: the measured hierarchy still describes the reference, but the
  // painting inherits its full range of colour rather than staying inside it.
  const range = tier === 'resolved' && withRef ? referenceColourRange(refOnly ? null : reference).text : null;
  const measuredForTier = range && measured ? `${measured.replace(/ Keep these proportions: [^]*$/, '')} ${range}` : measured;
  const fallback = `Colour: ${P.colors.filter((p) => chosen.includes(p)).map((p) => p.name).join(', ')}, on white or warm white paper${P.accent ? `, with ${P.accent.name} as the only accent, kept small` : ''}.`;
  const sections = {
    subject: subjectLine,
    meaning: concept ? meaningLine(tier, concept) : null,
    narrative: narrative.line,
    scene,
    motif: motifLine,
    family: familyLine,
    content: contentRule(narrative),
    form: motifLine ? GATHERED_MOTIF_FORM : withRef ? LEVELS[tier].refForm : LEVELS[tier].form,
    // Gathered and Resolved: how the reference composes, drawn per seed
    // (composition.js). Loose: how the voice moved (sound.js).
    composition: performance ? performance.composition : compositionLine(plan, tier),
    marks: performance?.marks ?? null,
    palette: performance ? `${refOnly ? referenceColourLanguage(null) : referenceColourLanguage(reference)} ${performance.colour}`
      : measuredForTier ?? (range ? `${REFERENCE_ONLY_COLOUR} ${range}` : refOnly ? REFERENCE_ONLY_COLOUR : fallback),
    // Gathered and Resolved: sound varies mood and marks inside the
    // reference's language. Loose: the words' mood only when there are
    // words (no default mood is invented for a wordless take); pace and
    // gesture are in the performance plan.
    emotion: performance ? (concept ? EMOTION_LOOSE[spec.emotion] || EMOTION_LOOSE.tender : null)
      : withRef ? (EMOTION_REF[spec.emotion] || EMOTION_REF.tender) : (EMOTION[spec.emotion] || EMOTION.tender),
    energy: performance ? null : withRef ? ENERGY_REF[energy] : ENERGY[energy],
    gesture: performance ? null : expressionLine(spec.expression, withRef),
    style: performance ? REFERENCE_STYLE_LOOSE : withRef ? REFERENCE_STYLE : tier === 'resolved' ? GLOBAL_STYLE_RESOLVED : GLOBAL_STYLE,
  };
  const resolvedFinish = tier !== 'resolved' ? { applied: false, reason: `tier ${tier}` }
    : !perf ? { applied: false, reason: withRef ? 'no measured performance: the reference authority already sets the level of finish' : 'no reference' }
      : { applied: true, reference: reference.id, reason: 'Resolved: the reference sets the level of finish; the words the subject; the performance the composition' };
  const led = perf ? directFromPerformance({ tier, F, refOnly, reference, concept, subjectLine, emotion: spec.emotion, perf, withRef, narrative, scene, motif: motifLine }) : null;
  const prompt = led ? led.prompt : [sections.subject, sections.meaning, sections.narrative, sections.scene, sections.motif, sections.family, sections.content, sections.form, sections.composition, sections.marks, 'Vertical 4:5 format.', sections.palette, sections.emotion, sections.energy, sections.gesture, sections.style, `Avoid: ${avoid.join(', ')}.`].filter(Boolean).join('\n');
  return {
    version: DIRECTION_VERSION, level: tier, requestedLevel: level,
    family: refOnly ? null : familyId, familyLabel: refOnly ? 'From the reference' : F.label, refs: refOnly ? [] : library.pool(familyId).map((e) => e.path.split('/').pop()),
    // The one reference image to send with `referencePrompt + prompt`.
    reference: reference ? { id: reference.id, path: reference.path, family: reference.family ?? null } : null,
    referencePrompt: reference ? (perf ? (resolvedFinish.applied ? REFERENCE_AUTHORITY_PERFORMANCE_RESOLVED : REFERENCE_AUTHORITY_PERFORMANCE) : performance ? REFERENCE_AUTHORITY_LOOSE : tier === 'resolved' ? REFERENCE_AUTHORITY_RESOLVED : REFERENCE_AUTHORITY) : null,
    // Whether the Resolved painting was told to reach the reference's level of finish.
    resolvedFinish,
    // Whether the Resolved painting was told to inherit the reference's colour range, and which.
    resolvedPalette: tier !== 'resolved' ? { applied: false, reason: `tier ${tier}` }
      : withRef ? (({ names, count, mono }) => ({ applied: true, families: names, count, mono }))(referenceColourRange(refOnly ? null : reference))
        : { applied: true, families: chosen.map((c) => c.name), count: chosen.length, reason: 'no reference: the family\'s whole observed scheme' },
    // Whether the Gathered painting was told to show a recognisable motif from the words.
    gatheredMotif: tier !== 'gathered' ? { applied: false, reason: `tier ${tier}` } : concept ? { applied: true, motif: concept.text, source: concept.source === 'note' ? 'note' : 'lyrics' } : { applied: false, reason: 'no reliable words: the sound leads' },
    // Which visual direction the Resolved painting was given, and why (looks.js).
    resolvedLook: !look ? { applied: false, reason: `tier ${tier}` }
      : { applied: true, source: look.source, signature: signatureOf(look), rank: look.rank, reason: look.reason, recent: recentLooks.length, diversity: look.diversity, ...(look.considered ? { considered: look.considered } : {}), ...(unusable?.length ? { unusable } : {}) },
    // Whether the Resolved painting was given a story moment from the words.
    narrative: { applied: narrative.applied, reason: narrative.reason, figure: narrative.figure, ...(narrative.near ? { near: true } : {}), ...(narrative.applied ? { scene: narrative.scene, dropped: narrative.dropped } : {}) },
    libraryVersion: library.version, seed: spec.seed >>> 0,
    concept: concept ?? null,
    composition: perf ? null : plan,
    performance: perf ? null : performance?.variables ?? null,
    // Every decision with the measurements behind it (performance-led only).
    performanceTrace: perf ? { version: perf.version, indices: perf.indices, focus: perf.focus, decisions: perf.decisions } : null,
    subject: concept ? concept.text : subject, subjectSource: concept ? (concept.source === 'note' ? 'note' : 'lyrics') : tier === 'loose' && spec.soundOnly ? 'sound' : 'atmosphere',
    pigments: swatches.map((p) => p.name), swatches, sections: led ? led.sections : sections, prompt, avoid: (led ? led.avoid : avoid).slice(),
  };
}

// Layer C: art direction and prompt construction.
//
//   direct(spec) → { version, family, variant, subject, pigments, sections, prompt, avoid }
//
// Three layers of style, applied in order:
//   A  GLOBAL      the Sonmira universe: paper, transparency, muted palette,
//                  soft contrast, restraint. Every painting, every provider.
//   B  FAMILIES    four watercolor voices (abstract experimental, atmospheric
//                  landscape, lyrical figurative, quiet interior), each with
//                  its own mark-making, space and subject language.
//   C  LEVEL       loose / gathered / resolved: how abstract, how formed, how
//                  finished. Each level samples from the families it allows.
//
// The seed picks the family (within the level's allowed set), a variant
// inside it, the subject, the line/wash balance and the composition, so
// different takes look like different paintings from one collection.
// Variation never touches the palette or contrast rules. Provider-
// independent: adapters in providers/ decide how to send this to a model.

import { choosePigments } from '../art/palettes.js';
import { rng } from '../render/rng.js';

export const DIRECTION_VERSION = 2;

const PIGMENT_WORDS = {
  mistyBlue: 'misty blue', dustyBlueGrey: 'dusty blue-grey', sage: 'muted sage green',
  blush: 'pale blush', ivory: 'warm ivory', sand: 'soft sand', lavender: 'desaturated lavender',
};

// ---------- A: the Sonmira universe ----------
export const GLOBAL_STYLE = [
  'A traditional transparent watercolor on warm ivory cold-press cotton paper',
  'visible paper grain and gentle pigment granulation',
  'low saturation, soft contrast and a gentle tonal range',
  'generous untouched paper, with the painting fading out toward the edges of the sheet',
  'refined, intimate and poetic, quiet enough to sit inside a minimal, elegant app',
  'hand-painted with a real brush',
].join(', ') + '.';

export const AVOID = [
  'saturated or vibrant colors', 'neon or fluorescent hues', 'orange', 'hot pink', 'electric blue',
  'many different colors', 'decorative multicolor', 'harsh contrast', 'pure black', 'ink outlines',
  'cartoon or anime style', 'sentimental greeting-card or children\'s-book illustration',
  'generic polished stock illustration', 'photorealism', 'glossy digital rendering', 'decorative patterns',
  'text, letters, signature or watermark', 'a frame, border or mat', 'a photo of a painting on a table',
];

const ATMOSPHERE = {
  tender: 'delicate and pale, soft diffused light',
  bright: 'slightly warmer and lighter, airy light',
  melancholic: 'cooler and more subdued, hushed grey light',
  intense: 'deeper but still muted tones, a heavier, more weighted atmosphere',
};

const ENERGY = {
  calm: 'slow, settled marks',
  moderate: 'a mix of settled washes and a few quick strokes',
  lively: 'quick, energetic marks with flicks and splashes',
};

// ---------- B: style families ----------
// Each family: a mark language (how paint is put down), variants (seeded
// sub-voices), and subjects by motif. `abstract` subjects are used when the
// person gave no words, so nothing narrative is invented.
export const FAMILIES = {
  abstractExperimental: {
    label: 'Abstract Experimental',
    language: 'mixed point, line and wash: thin wandering brush lines, scattered dots and flecks, irregular dragged traces, broken contours that start and stop, diffused stains with soft tide-marks, and occasional drips and backrun blooms',
    variants: [
      'a few long, wandering lines drift across pale overlapping stains and lose their way',
      'clusters of small marks gather in one place and disperse across the rest of the sheet',
      'one large bleeding stain is crossed by broken lines and a spray of fine flecks',
      'paint runs downward from a wet upper edge in uneven drips, with stray marks beside them',
      'torn, horizontal fragments of wash interrupted by dry-brush scratches and loose dots',
      'looping, scribbled traces float over faint stains, the loops opening and breaking apart',
    ],
    subjects: {}, // never depicts anything
    balance: ['line-led, with washes only as faint grounds', 'an even mix of lines, marks and stains', 'stain-led, with lines and dots scattered through'],
  },
  atmosphericLandscape: {
    label: 'Atmospheric Landscape',
    language: 'wide wet-in-wet washes, soft gradations of sky and distance, a horizon that dissolves in places, reflections and haze, with the few hard edges kept for the nearest forms',
    variants: [
      'a low horizon beneath a vast sky that takes most of the sheet',
      'layers of distance receding one behind another into mist',
      'a high horizon, looking down across a broad open foreground',
      'a scene mirrored in still water, sky and reflection almost meeting',
    ],
    subjects: {
      water: { gathered: 'a calm shoreline and pale sea, the water and sand only suggested', resolved: 'a quiet bay at low tide, wet sand holding the light, a small boat resting near the waterline' },
      sky: { gathered: 'drifting clouds over a thin strip of land', resolved: 'a great sky of luminous clouds over a low, distant coastline, a few birds crossing' },
      garden: { gathered: 'soft masses of foliage and blossom dissolving into mist', resolved: 'an orchard in blossom on a gentle slope, the trees fading into morning haze' },
      landscape: { gathered: 'layered hills fading into haze, a path barely implied', resolved: 'rolling fields and a winding lane toward distant hills, a single farmhouse catching the light' },
      interior: { gathered: 'a landscape seen through a pale window opening, the view dissolving', resolved: 'a wide view of hills and sky framed by the soft edge of an open window' },
      abstract: { gathered: 'horizontal bands of wash that suggest distance without naming a place', resolved: 'a composed abstraction of soft horizontal bands and one luminous gap, like distance without a place' },
    },
    balance: ['almost all wash, with a few drawn accents', 'washes with a little dry-brush texture in the foreground'],
  },
  lyricalFigurative: {
    label: 'Lyrical Figurative',
    language: 'a poetic, fully composed scene, a small human presence or living subject painted with economy, lost-and-found edges, a clear focal point and calm surrounding space',
    variants: [
      'the living subject kept small within a large, quiet space',
      'a close, intimate view of the subject with the surroundings dissolving',
      'the subject seen from slightly above, long soft shadows across the ground',
      'a quiet moment caught mid-gesture, with generous space around it',
    ],
    subjects: {
      water: { resolved: 'two figures walking along the tide line of a calm sea, their reflections on the wet sand' },
      sky: { resolved: 'a figure on a hilltop beneath a vast evening sky, a scarf lifted by the wind' },
      garden: { resolved: 'a woman reading on a bench beneath a flowering tree, petals on the path' },
      landscape: { resolved: 'a lone walker on a country road between fields, distant hills beyond' },
      interior: { resolved: 'a figure by a tall window, a cup in their hands, morning light across the floor' },
    },
    balance: ['wash-led, with fine brush drawing only in the focal subject'],
  },
  quietInterior: {
    label: 'Quiet Interior / Structural',
    language: 'still, sparse and geometric: translucent planes, window and wall edges, soft rectangles of light, long shadows, a few ruled or hand-drawn straight lines, lots of calm empty paper',
    variants: [
      'tall vertical planes and one soft rectangle of light',
      'a single still shape set against broad, empty planes',
      'overlapping translucent rectangles, slightly misaligned',
      'a long horizontal edge, a shadow, and silence above it',
    ],
    subjects: {
      water: { loose: 'translucent rectangles that drift out of alignment', gathered: 'a window opening onto pale water, the frame and view both dissolving', resolved: 'a quiet room with a tall window opening onto the sea, a chair in the light' },
      sky: { loose: 'pale planes and a broken frame edge', gathered: 'a window full of sky, its frame half painted', resolved: 'an empty room, a large window of soft cloud, light lying across the floor' },
      garden: { loose: 'soft planes and the edge of a shadow', gathered: 'a doorway onto a garden, foliage only suggested beyond', resolved: 'a sunroom with a potted plant and a garden glimpsed through glass' },
      landscape: { loose: 'misaligned planes and a horizon-like line', gathered: 'a window with distant hills suggested beyond', resolved: 'a quiet room with a window onto distant hills, a table with a single cup' },
      interior: { loose: 'soft rectangles of light and a few straight lines', gathered: 'a corner of a room, a window and a table only blocked in', resolved: 'a still corner of a room, sheer curtains, a vase of dried flowers on the sill' },
      abstract: { loose: 'misaligned translucent planes and a few straight lines', gathered: 'quiet geometric planes beginning to settle into balance', resolved: 'a composed geometric abstraction of a few translucent planes and one quiet focal shape' },
    },
    balance: ['wash planes with a few straight lines', 'mostly flat, quiet planes'],
  },
};

// ---------- C: levels ----------
// Allowed families per level, with weights (Han's guidance).
export const LEVEL_FAMILIES = {
  loose: [['abstractExperimental', 0.75], ['quietInterior', 0.25]],
  gathered: [['atmosphericLandscape', 0.65], ['quietInterior', 0.35]],
  resolved: [['atmosphericLandscape', 0.4], ['lyricalFigurative', 0.45], ['quietInterior', 0.15]],
};
// With no words, nothing narrative: no figures.
const NO_WORDS = { resolved: [['atmosphericLandscape', 0.5], ['quietInterior', 0.5]] };

export const LEVELS = {
  loose: {
    label: 'abstract watercolor experiment',
    form: 'This is an abstract experiment, not a landscape: no horizon, no sky, no ground, no water, no objects or figures, nothing to recognise. The visual logic is unstable and incomplete: marks drift, collide and break off, edges appear and vanish, and accidents are left as they happened.',
    finish: 'Disordered, drifting and uncontrolled, yet still beautiful: the elegance comes from the paper, the restraint of the palette and the space left empty.',
  },
  gathered: {
    label: 'semi-abstract watercolor',
    form: 'Partially formed: you can tell what kind of place it is, but nothing is drawn in detail. Forms are blocked in as broad soft washes that bleed into one another, with no small details or crisp contours. Space and depth are beginning to form and one focal area is only emerging.',
    finish: 'Painted quickly and left about half finished: whole areas stay bare paper, washes stop mid-stroke, with blooms where wet washes meet. More coherent than an abstract study, clearly less complete than a finished painting.',
  },
  resolved: {
    label: 'finished watercolor painting',
    form: 'A mature, fully considered composition: clear foreground, middle ground and background, one strong focal point that carries the finest drawing and the crispest edges, and a deliberate path for the eye through the picture. Lost-and-found edges and considered negative space.',
    finish: 'Refined and collectible, like a gallery piece by a master of the medium: the subject treated with poetry and economy, a sophisticated but soft value structure, and complete, confident brushwork. Painterly and alive, never a generic polished illustration.',
  },
};

const PLACEMENTS = [
  'the focal point sits in the lower left third, with open space above and to the right',
  'the focal point sits in the lower right third, with open space above and to the left',
  'the focal point sits low and slightly off-centre beneath a large open area',
  'the focal point sits high in the sheet above a wide, quiet foreground',
];
const LOOSE_SPREAD = [
  'marks gather toward one side and thin out across the rest of the sheet',
  'marks drift diagonally across the sheet, leaving large empty corners',
  'marks scatter unevenly from the centre outward',
];

function pickWeighted(list, r) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of list) if ((x -= w) <= 0) return k;
  return list[list.length - 1][0];
}
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

export function familiesFor(level, motif) {
  if (motif === 'abstract' && NO_WORDS[level]) return NO_WORDS[level];
  return LEVEL_FAMILIES[level] || LEVEL_FAMILIES.gathered;
}

export function direct(spec) {
  const level = LEVELS[spec.completeness] ? spec.completeness : 'gathered';
  const L = LEVELS[level];
  const motif = spec.motif || 'abstract';
  const r = rng((spec.seed ^ 0x5a17) >>> 0);
  // Draw every choice in a fixed order, so overriding one keeps the rest.
  const famDraw = pickWeighted(familiesFor(level, motif), r);
  // An explicit family (developer override) wins over the seeded draw.
  const familyId = FAMILIES[spec.family] ? spec.family : famDraw;
  const F = FAMILIES[familyId];
  const variant = pick(F.variants, r);
  const balance = pick(F.balance, r);
  const placement = level === 'loose' ? pick(LOOSE_SPREAD, r) : pick(PLACEMENTS, r);
  const pigments = choosePigments(spec.emotion, motif, r).map((p) => PIGMENT_WORDS[p]);
  const energy = spec.energy?.value || 'calm';

  // Subject: loose never depicts; other levels take the family's subject for
  // the motif, falling back to the family's abstract subject.
  const subj = F.subjects[motif]?.[level] ?? F.subjects.abstract?.[level] ?? null;
  const subject = level === 'loose'
    ? (familyId === 'quietInterior' ? subj : null)
    : subj ?? F.subjects[motif]?.resolved ?? null;

  const article = /^[aeiou]/i.test(L.label) ? 'An' : 'A';
  const sections = {
    subject: subject ? `${article} ${L.label} of ${subject}.` : `${article} ${L.label}.`,
    family: `Visual voice — ${F.label}: ${F.language}. In this piece, ${variant}.`,
    form: L.form,
    composition: `Vertical 4:5 format; ${placement}. Balance of line and wash: ${balance}.`,
    finish: L.finish,
    palette: `A limited palette of only ${pigments.length} pigments: ${pigments.join(', ')}, on warm ivory paper. Darks are the same pigments layered, never black.`,
    atmosphere: `Atmosphere: ${ATMOSPHERE[spec.emotion] || ATMOSPHERE.tender}. Marks: ${ENERGY[energy]}.`,
    style: GLOBAL_STYLE,
  };
  const prompt = [sections.subject, sections.family, sections.form, sections.composition, sections.finish, sections.palette, sections.atmosphere, sections.style, `Avoid: ${AVOID.join(', ')}.`].join('\n');
  return { version: DIRECTION_VERSION, level, family: familyId, familyLabel: F.label, variant, subject, pigments, sections, prompt, avoid: AVOID.slice() };
}

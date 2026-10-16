// Layer C: art direction and prompt construction.
//
//   direct(spec) → { version, subject, sections, prompt, avoid }
//
// Turns the visual specification into generation instructions that follow
// Sonmira's global rules and the three-level principles drawn from the 22
// references (see docs/art-direction.md). Provider-independent: adapters in
// providers/ decide how to send `sections` / `prompt` to a given model.
//
// Vocal control changes what is painted and how it is arranged (subject
// legibility, spatial depth, focal hierarchy, edge finish). It never changes
// palette saturation, darkness or overall craft: every level is asked to be
// equally beautiful.

import { choosePigments } from '../art/palettes.js';
import { rng } from '../render/rng.js';

export const DIRECTION_VERSION = 1;

const PIGMENT_WORDS = {
  mistyBlue: 'misty blue', dustyBlueGrey: 'dusty blue-grey', sage: 'muted sage green',
  blush: 'pale blush', ivory: 'warm ivory', sand: 'soft sand', lavender: 'desaturated lavender',
};

// One artistic universe: the same paper, transparency, edges and restraint
// for every painting, whatever the level, mood or provider.
export const GLOBAL_STYLE = [
  'A traditional transparent watercolor painting on warm ivory cold-press cotton paper',
  'visible paper grain and gentle pigment granulation',
  'soft pigment diffusion and natural wet-in-wet blooms',
  'generous untouched white paper, with the washes fading out into bare paper toward the edges of the sheet',
  'a gentle, low-contrast tonal range',
  'quiet, intimate and refined, like a page from a private watercolor diary',
  'hand-painted with a real brush',
].join(', ') + '.';

export const AVOID = [
  'saturated or vibrant colors', 'neon or fluorescent hues', 'orange', 'hot pink', 'electric blue',
  'many different colors', 'harsh contrast', 'pure black', 'ink outlines', 'cartoon or anime style', 'sentimental greeting-card or children\'s-book illustration',
  'photorealism', 'glossy digital illustration', 'decorative patterns', 'text, letters, signature or watermark',
  'a frame, border or mat', 'a photo of a painting on a table',
];

const ATMOSPHERE = {
  tender: 'delicate and pale, soft diffused light',
  bright: 'slightly warmer and lighter, airy morning light',
  melancholic: 'cooler and more subdued, hushed grey light',
  intense: 'deeper but still muted tones, a heavier, more weighted atmosphere',
};

const BRUSHWORK = {
  calm: 'slow, broad, settled washes',
  moderate: 'a mix of broad washes and a few lively strokes',
  lively: 'energetic, quick brushstrokes with a few splashes and drips',
};

// What each level is, from the references (3 loose, 5 gathered, 14 resolved).
export const LEVELS = {
  loose: {
    label: 'abstract watercolor study',
    form: 'No recognizable objects, figures or scene. Loose, fragmented washes, scattered pigment, wet-in-wet blooms, a few wandering, broken brush lines and accidental drips. No horizon and no focal point; shapes float with loose spatial relationships.',
    finish: 'Open and airy, still balanced and beautiful, like a painter freely testing colors on good paper.',
  },
  gathered: {
    label: 'semi-abstract atmospheric watercolor',
    form: 'The scene is suggested rather than described: you can tell what kind of place it is, but nothing is drawn in detail. Forms are blocked in only as broad, soft washes that bleed into one another; there are no small details, no defined contours and no crisp edges anywhere. A soft horizon or spatial depth begins to form, foreground and background separate gently, and one focal area is only emerging.',
    finish: 'Painted quickly and spontaneously, left about half finished: whole parts of the scene stay unpainted bare paper, washes stop mid-stroke, with splashes, dry-brush scratches and hard-edged blooms where wet washes meet. Deliberate, but still ambiguous.',
  },
  resolved: {
    label: 'finished watercolor composition',
    form: 'Clear foreground, middle ground and background with cohesive spatial organization. One intentional focal point carries the most detail and the crispest edges, and the rest dissolves into soft washes and white paper.',
    finish: 'Complete but simplified, like a finished piece by an accomplished watercolorist: few elements, large calm areas of bare paper or a single quiet wash, and the subject painted with economy in a few precise strokes rather than rendered in detail. Still painterly and loose, not a detailed illustration.',
  },
};

// Subjects per motif. The same seed picks the same subject at every level,
// so a three-tier set shows one place moving from study to finished piece.
// `loose` names only the rhythm or colour the abstract study echoes.
export const SUBJECTS = {
  water: [
    { resolved: 'two small figures walking along the shallow tide line of a calm sea, their reflections on the wet sand', gathered: 'a calm shoreline with pale water and a low horizon, two small dabs of color that might be figures', loose: 'the horizontal drift of shallow water over wet sand' },
    { resolved: 'a single wooden rowboat moored beside a narrow wooden jetty on still water', gathered: 'still water with the soft shapes of a small boat and a jetty dissolving into mist', loose: 'reflections breaking on still water' },
    { resolved: 'a grey heron standing in reed-fringed shallows at the edge of a quiet lake', gathered: 'misty shallows with reeds and the faint shape of a standing bird', loose: 'reeds and ripples' },
  ],
  sky: [
    { resolved: 'a wide sky of soft cumulus clouds over a low distant coastline, with a few small birds', gathered: 'a vast sky of drifting clouds above a thin line of land', loose: 'billowing cloud shapes' },
    { resolved: 'a lone tree on a gentle hill beneath a large, glowing evening sky', gathered: 'a gentle hill and a suggested tree under a broad evening sky', loose: 'a soft glow spreading through damp washes' },
  ],
  garden: [
    { resolved: 'a narrow garden path between flowering shrubs leading to a small wooden gate', gathered: 'a garden suggested by soft masses of foliage and blossoms around a pale path', loose: 'the colors and dabs of foliage and blossom' },
    { resolved: 'a slender birch grove after rain, wildflowers in the grass between the trunks', gathered: 'pale vertical trunks and soft green foliage in a damp garden', loose: 'vertical drips and soft green blooms' },
  ],
  landscape: [
    { resolved: 'a winding country road through rolling hills toward distant blue mountains', gathered: 'layered hills fading into haze with a road barely suggested', loose: 'layered horizontal bands of land and haze' },
    { resolved: 'a small village of snow-covered roofs at the foot of a forested slope', gathered: 'a hillside with soft roof shapes and trees emerging from snow and mist', loose: 'cool shadows on snow' },
  ],
  interior: [
    { resolved: 'a window with sheer curtains, a small vase of dried flowers on the sill and morning light falling into a quiet room', gathered: 'a window, a curtain and soft light suggested inside a quiet room', loose: 'soft rectangles of window light' },
    { resolved: 'a wooden table by a window with a teacup and an open book in afternoon light', gathered: 'a table near a window, its objects only suggested by soft shapes and light', loose: 'warm light pooling on a surface' },
  ],
  // No words: stay neutral and abstract at every level, never invent a story.
  abstract: [
    { resolved: 'a fully composed abstract arrangement of a few large translucent overlapping forms, one clear focal shape, deliberate balance and considered layering, with no recognizable objects', gathered: 'overlapping translucent shapes beginning to settle into a balanced arrangement that suggests depth, with no recognizable objects', loose: 'free washes with no subject' },
  ],
};

const PLACEMENTS = [
  'the focal subject sits in the lower left third, with open space above and to the right',
  'the focal subject sits in the lower right third, with open space above and to the left',
  'the focal subject sits low and slightly off-centre beneath a large open area',
];

export function direct(spec) {
  const r = rng((spec.seed ^ 0x5a17) >>> 0);
  const level = LEVELS[spec.completeness] || LEVELS.gathered;
  const list = SUBJECTS[spec.motif] || SUBJECTS.abstract;
  const subject = list[Math.floor(r() * list.length)];
  const placement = PLACEMENTS[Math.floor(r() * PLACEMENTS.length)];
  const pigments = choosePigments(spec.emotion, spec.motif, r).map((p) => PIGMENT_WORDS[p]);
  const energy = spec.energy?.value || 'calm';

  const what = spec.completeness === 'loose'
    ? `An ${level.label} whose washes loosely echo ${subject.loose}.`
    : spec.completeness === 'gathered'
      ? `A ${level.label} of ${subject.gathered}.`
      : `A ${level.label} of ${subject.resolved}.`;
  const sections = {
    subject: what,
    form: level.form,
    composition: spec.completeness === 'loose' ? 'Vertical 4:5 format with an open, uneven distribution of marks.' : `Vertical 4:5 format; ${placement}.`,
    finish: level.finish,
    palette: `A limited palette of only ${pigments.length} pigments: ${pigments.join(', ')}, on warm ivory paper. Darks are the same pigments layered, never black.`,
    atmosphere: `Atmosphere: ${ATMOSPHERE[spec.emotion] || ATMOSPHERE.tender}.`,
    brushwork: `Brushwork: ${BRUSHWORK[energy]}.`,
    style: GLOBAL_STYLE,
  };
  const prompt = [sections.subject, sections.form, sections.composition, sections.finish, sections.palette, sections.atmosphere, sections.brushwork, sections.style, `Avoid: ${AVOID.join(', ')}.`].join('\n');
  return { version: DIRECTION_VERSION, subject, pigments, sections, prompt, avoid: AVOID.slice() };
}

// The Sonmira style library: watercolor style families derived only from
// Han's 22 reference images (qa/references, grouped by tier).
//
// Each family is grounded in the references listed in `refs`, all from the
// family's own tier. `observed` records what is visible in those images;
// `rules` turns it into generation instructions; `palettes` lists the
// colour schemes actually seen there, dominant colours first (hex values are
// approximate swatches for the UI). A family with several references that
// differ in colour has one palette per reference. These palettes are only a
// fallback: a generation takes its colour from the measured palette of its
// selected reference (references.js). Nothing here describes a style that
// is not in a reference.
//
// Which references belong to a family is NOT listed here: `refs` and
// REFERENCES are filled from the reference registry (references.js), the
// single source of truth, so adding a reference needs no change in this file.
//
// The references guide treatment only. Subjects are new: they must not
// repeat a reference's composition (no skier on a slope, no cat at a wall,
// no couple at the tide line, no surfer in a wave).

import { REFERENCE_LIBRARY } from './references.js';

export const LIBRARY_VERSION = 3;


const c = (name, hex) => ({ name, hex });

export const FAMILIES = {
  // ---------------- Loose ----------------
  'L1-line-over-wash': {
    tier: 'loose', label: 'Line over wash', figures: false,
    observed: 'Small sheets of scrubbed cyan, cobalt and ultramarine wash with blooms and backruns, drawn over with pencil and crayon: loops, circles, hatching, dotted dashes, short arrows and rain-like vertical ticks. A few thin red or rust lines. No focal point; each sheet is an all-over field of marks with ragged, uneven edges.',
    rules: 'Lay loose, scrubbed washes, then draw over them with a pencil or crayon line that loops, hatches, dashes and circles without describing anything. Lines sit on top of the colour and wander off the edge of the wash. One or two thin warm lines as the only accent. Leave a ragged margin of bare paper around the painted area.',
    palettes: [{ colors: [c('cyan', '#3fb3d9'), c('cobalt blue', '#2f5fae'), c('ultramarine', '#3a4fa0'), c('pale turquoise', '#9fd8dc')], accent: c('a thin rust-red line', '#b5523b') }],
  },
  'L2-bloom-field': {
    tier: 'loose', label: 'Bloom field', figures: false,
    observed: 'An all-over field of wet-in-wet turquoise, cerulean and spring green, saturated and luminous, darker toward the edges and paler in the middle. Cauliflower blooms, backruns and strong granulation speckle like salt texture. No lines and no subject.',
    rules: 'Fill most of the sheet with overlapping wet-in-wet washes that bloom into one another. Let granulation and salt-like speckle show. Darken toward the edges, keep a paler, breathing centre. No drawn lines, no shapes that read as things.',
    palettes: [{ colors: [c('turquoise', '#2fb5c5'), c('cerulean', '#3d9fd6'), c('spring green', '#7cc9a0'), c('deep teal', '#1f7f9a')], accent: null }],
  },
  'L3-drip-curtain': {
    tier: 'loose', label: 'Drip curtain', figures: false,
    observed: 'A wet band of yellow-green, olive and ochre blooms across the top of a square sheet, from which paint runs straight down in long gravity drips of sage, lavender, olive and ochre. Bare paper between the runs; soft pooled tide-marks where the drips gather at the bottom. Reads almost like trees, but by accident.',
    rules: 'Charge a wet band of colour near the top edge and let it run straight down in long, uneven drips of different widths, some reaching the bottom and pooling into soft tide-marks. Keep clear paper between the runs. The drips are the whole painting; nothing is drawn.',
    palettes: [{ colors: [c('yellow-green', '#b8c63a'), c('olive', '#7f8f3a'), c('ochre', '#d4a84a'), c('lavender', '#a99bbf'), c('sage', '#8fae8c')], accent: null }],
  },

  // ---------------- Gathered ----------------
  'G1-atmospheric-study': {
    tier: 'gathered', label: 'Atmospheric study', figures: false,
    observed: 'Quick colour studies in horizontal bands: pale cool washes for sky and water, a sand or ochre band below, and warm coral, apricot or orange light dissolving into them. Distant forms (a skyline, a breaking wave) are only a few thin drawn accents or a dry-brush flick. Very open, airy, mostly light values, wide formats.',
    rules: 'Build the picture from a few broad horizontal bands of pale wash, one of them warmed with coral or apricot light. Suggest the subject with only a handful of thin brush-drawn accents or one dry-brush flick, and leave everything else as wash. Light values, soft edges, generous breathing room.',
    palettes: [{ colors: [c('pale cerulean', '#9cc6e0'), c('ochre sand', '#d9bf86'), c('apricot', '#f2c094'), c('pale grey-green', '#c8d3c4')], accent: c('coral light', '#e9967a') }],
  },
  'G2-splash-wash': {
    tier: 'gathered', label: 'Splash and blot', figures: false,
    observed: 'Large grey and blue-grey blots with soft tide-mark edges floating on white paper, broken by energetic olive and sage splashes, flicks and dragged strokes in the lower half. Mostly white paper; a landscape is only implied by where the marks gather. Calligraphic, fast, ink-wash energy.',
    rules: 'Drop a few large grey and blue-grey blots and let their edges dry into tide-marks, then throw fast olive splashes, flicks and dragged strokes across the lower part. Keep at least half of the sheet white. The place is implied by the gathering of marks, never drawn.',
    palettes: [{ colors: [c('blue-grey', '#7f97ad'), c('olive', '#7d8a4e'), c('warm grey', '#9c9a98'), c('sage', '#a6b48e'), c('ink grey', '#4d5258')], accent: null }],
  },
  'G3-luminous-contrast': {
    tier: 'gathered', label: 'Luminous contrast', figures: false,
    observed: 'Rich near-monochrome colour (vivid yellow-green in one, warm sepia and umber in the other) with strong value contrast. Soft, wet, glowing backgrounds and shafts of light, against crisp dry-brush, splatter and vertical drips in the darks. Forms are blocked in by light and shadow rather than drawn.',
    rules: 'Choose one rich colour family and work it from glowing light to deep dark. Keep the background wet and luminous with a shaft or haze of light, and put crisp dry-brush strokes, splatter and a few vertical drips into the darks. Block forms in with light and shadow only; no outlines, little detail.',
    palettes: [
      { colors: [c('vivid sap green', '#6fae3a'), c('yellow-green light', '#c9df7a'), c('deep green', '#2f5a2a')], accent: null },
      { colors: [c('sepia', '#8a5a33'), c('burnt umber', '#5b3a24'), c('warm light', '#f1d9a8')], accent: null },
    ],
  },

  // ---------------- Resolved ----------------
  'R1-graphic-snow': {
    tier: 'resolved', label: 'Graphic snow and shadow', figures: true,
    observed: 'Two-colour design in cobalt or steel blue and white, with flat shapes, a fine stippled grain and long diagonal cast shadows, seen from a high vantage. Trees and buildings are simplified silhouettes. One tiny warm accent (a red figure or a red house) carries the focus. Note: these two read closer to gouache or print than to transparent watercolor.',
    rules: 'Design the painting with flat, clean shapes in one blue and the white of the paper, seen from a high vantage. Use long, diagonal cast shadows and a fine stippled dry-brush grain for texture. Simplify every form to a silhouette. Place one very small warm accent as the focal point. Painted in watercolor with flat washes and dry-brush stipple.',
    palettes: [{ colors: [c('cobalt blue', '#2f62a8'), c('steel blue', '#4f7fb4'), c('pale blue-grey', '#c9d6e6')], accent: c('one small red', '#b8352e') }],
  },
  'R2-aerial-shallows': {
    tier: 'resolved', label: 'Aerial shallows', figures: false,
    observed: 'Looking straight down onto saturated turquoise and deep teal water with heavy granulation, dark ink spatter and bright splashes, an ochre sand edge, and a cluster of small, crisply painted coloured objects (boats in both) as the focus, linked by thin drawn lines such as ropes. Dramatic value range, energetic texture, signed corners (to avoid).',
    rules: 'Paint from directly above. Make the water a saturated turquoise-to-deep-teal field with strong granulation, dark spatter and white splashes, meeting an ochre edge. Put a small cluster of crisply painted, brightly coloured objects as the focus and connect them with a few thin drawn lines. Loose, wild texture around a precise focal cluster.',
    palettes: [{ colors: [c('turquoise', '#16b2c2'), c('deep teal', '#0b5c73'), c('ochre sand', '#c9a85a'), c('cobalt', '#2a56b0')], accent: c('a few bright orange and red touches', '#e0663a') }],
  },
  'R3-vivid-wash-focal': {
    tier: 'resolved', label: 'Vivid wash, crisp subject', figures: true,
    observed: 'Saturated blue, cerulean and teal washes full of blooms, splashes and torn edges, opening into large areas of white paper. A single subject is left as white paper or painted with fine, careful detail and is the clear focus. Strong contrast between wild wash and precise subject; small warm accents (sand tones, a pink nose).',
    rules: 'Surround the subject with bold, saturated blue and teal washes that bloom, splash and tear open into white paper. Reserve the subject in white or paint it with fine, careful brushwork so it is crisp against the wild wash. One small warm accent. The contrast between loose wash and precise subject is the point.',
    palettes: [{ colors: [c('cobalt blue', '#1f5fc4'), c('cerulean', '#4aa3dc'), c('teal', '#2c9aa4'), c('pale sand', '#e8cfa0')], accent: c('one soft pink touch', '#e89aa6') }],
  },
  'R4-lyrical-everyday': {
    tier: 'resolved', label: 'Lyrical everyday', figures: true,
    observed: 'Clear, light pastel washes with smooth gradients: lavender and periwinkle skies, sea-glass blues, warm peach and golden light, fresh greens. Small people in quiet everyday moments (walking, crouching by water, talking on a street) placed low in a large, airy space. Cinematic, gentle light; clean edges; calm, illustrative but painterly. Some carry titles or watermarks (to avoid).',
    rules: 'Use clear, light, transparent washes and clean, luminous light. Place one to three small people in a fleeting everyday moment within a large, airy space, caught with a few chosen brushstrokes. Only a little recognisable detail; the surroundings stay loose and open.',
    palettes: [
      { colors: [c('fresh leaf green', '#7fb36a'), c('sunlit yellow-green', '#c9d77e'), c('pale sunlit stone', '#ece6c8')], accent: c('small vermilion red', '#c4473a') },
      { colors: [c('lavender', '#b9b3dc'), c('periwinkle', '#9fb2e0'), c('pale blue-grey', '#d5dbe8')], accent: c('warm sand', '#d9b98f') },
      { colors: [c('sky blue', '#8fc3e3'), c('sea-glass blue', '#a7d1d8'), c('peach cloud light', '#f2c6a8')], accent: c('small coral red', '#e0584a') },
      { colors: [c('warm ochre', '#c99a62'), c('golden haze', '#ead19a'), c('soft grey-teal', '#9fb3b0')], accent: c('small red', '#c4473a') },
    ],
  },
  'R5-light-as-subject': {
    tier: 'resolved', label: 'Light as subject', figures: false,
    observed: 'The light itself is the subject: glitter on water made of white spatter and broken strokes, warm window glow under violet shadow, bokeh and raindrops on dark wet glass. Deeper values than the other families, set against sparkling or glowing highlights. Expressive, broken brushwork; cool blue, teal or violet against a warm orange or red accent.',
    rules: 'Make the light the subject: glitter, glow or reflections against deeper values, gathered in one limited area. Use broken, expressive strokes, white spatter and lifted highlights for sparkle only there; everywhere else forms dissolve into loose, quiet washes and open paper. Forms stay painterly and partly lost in the light.',
    palettes: [
      { colors: [c('deep teal', '#1d4e5c'), c('blue-green', '#3f7f86'), c('slate', '#53636e')], accent: c('small red and amber lights', '#c9403a') },
      { colors: [c('cerulean', '#5aa6d4'), c('turquoise', '#55b6c4'), c('pale sand', '#e2c9a6')], accent: c('white glitter', '#fbfaf5') },
      { colors: [c('violet', '#7d6fc4'), c('periwinkle', '#9aa6e0'), c('pale lilac', '#d4cbe8')], accent: c('warm orange glow', '#e3873a') },
    ],
  },
  'R6-misty-monochrome': {
    tier: 'resolved', label: 'Misty monochrome', figures: true,
    observed: 'Nearly monochrome sage and grey-green. A single elegant silhouette, drawn with a few fine contours, dissolves at its lower edge into soft fog washes and darker pooled blooms. Very smooth gradations, large pale empty ground, ink-wash restraint.',
    rules: 'Work in one colour family only, mostly pale. Draw a single elegant form with a few fine contours and let it dissolve into soft fog washes, with a few darker pooled blooms at its base. Large, pale, empty ground and very smooth gradations.',
    palettes: [{ colors: [c('sage', '#9fb3a2'), c('grey-green', '#6f8a7c'), c('deep green', '#2f4f45'), c('pale mist', '#e6ece6')], accent: null }],
  },
};

// New subjects per family and motif, chosen to suit each treatment without
// repeating a reference composition. Loose families depict nothing.
// `abstract` is used when the person gave no words: no people, no story.
export const SUBJECTS = {
  'G1-atmospheric-study': {
    water: 'a distant harbour on still water at dawn', sky: 'a wide evening sky over a low strip of shore', garden: 'a far line of trees in warm haze',
    landscape: 'low fields and a distant village in morning light', interior: 'the view from an open window, sky and roofs in bands', abstract: 'bands of sky, light and ground with nothing named',
  },
  'G2-splash-wash': {
    water: 'a windy shoreline with spray', sky: 'storm clouds gathering over open ground', garden: 'a thicket of grasses and branches in wind',
    landscape: 'hills and scrub after rain', interior: 'a window wall with plants spilling across it', abstract: 'blots and splashes gathering into an unnamed place',
  },
  'G3-luminous-contrast': {
    water: 'a rain-wet street reflecting shop light', sky: 'sun breaking through mist between tall shapes', garden: 'light shafts through a dense, overgrown garden',
    landscape: 'a narrow lane between old walls in late sun', interior: 'a high arcade with light falling through its windows', abstract: 'a shaft of light through deep shadow, nothing named',
  },
  'R1-graphic-snow': {
    water: 'a frozen lake with a few small skaters and their long shadows', sky: 'a snowy ridge under a clear blue sky, a single bird', garden: 'a snow-covered orchard with blue tree shadows and one red bench',
    landscape: 'a snowy field crossed by a row of fence posts and their long shadows, one small walker', interior: 'a window looking out over snowy roofs, a red mug on the sill', abstract: 'an empty snow field with long blue shadows of unseen trees',
  },
  'R2-aerial-shallows': {
    water: 'a small floating dock seen from above with swimmers\' towels and a red buoy', sky: 'cloud shadows moving over turquoise shallows, seen from above', garden: 'a garden pond from above, lily pads and a few bright koi',
    landscape: 'a winding tidal river from above with a few moored canoes', interior: 'a turquoise pool from above with floating bright rings', abstract: 'turquoise shallows and a sandbar from above, no objects',
  },
  'R3-vivid-wash-focal': {
    water: 'a heron standing in a burst of blue water', sky: 'a white gull riding a gust of blue wind', garden: 'a white rabbit among bursting blue blossoms',
    landscape: 'a small white fox crossing a blue hillside', interior: 'a white teacup and steam against a burst of blue', abstract: 'a white reserved shape at the heart of a blue burst',
  },
  'R4-lyrical-everyday': {
    water: 'a child and an older person fishing from a jetty', sky: 'two friends lying in a meadow looking up at drifting clouds', garden: 'someone watering plants on a balcony garden',
    landscape: 'a cyclist on a country road between fields', interior: 'a person reading by a café window', abstract: null,
  },
  'R5-light-as-subject': {
    water: 'light glittering across a calm harbour', sky: 'light breaking through clouds over wet streets', garden: 'lanterns glowing in a dusk garden',
    landscape: 'a mountain village at dusk, windows glowing in the snow', interior: 'a rain-streaked café window at night, warm lights behind the glass', abstract: 'glittering light on dark water, nothing else',
  },
  'R6-misty-monochrome': {
    water: 'a lone figure on a pier dissolving into sea mist', sky: 'a dancer turning, her skirt dissolving into fog', garden: 'a woman under a willow, both dissolving into mist',
    landscape: 'a walker on a ridge fading into mist', interior: 'a figure by a tall window, dissolving into pale light', abstract: null,
  },
};

// Motif affinity: which motifs each family's references actually show.
export const AFFINITY = {
  'G1-atmospheric-study': ['water', 'sky', 'landscape'],
  'G2-splash-wash': ['landscape', 'garden'],
  'G3-luminous-contrast': ['garden', 'interior', 'landscape'],
  'R1-graphic-snow': ['landscape'],
  'R2-aerial-shallows': ['water'],
  'R3-vivid-wash-focal': ['water', 'interior'],
  'R4-lyrical-everyday': ['water', 'sky', 'garden', 'landscape'],
  'R5-light-as-subject': ['water', 'landscape', 'interior'],
  'R6-misty-monochrome': [],
};

export const familiesOfTier = (tier) => Object.keys(FAMILIES).filter((id) => FAMILIES[id].tier === tier);

// Family membership from the registry: active references only, in id order.
const fileOf = (e) => e.path.split('/').pop();
for (const [id, F] of Object.entries(FAMILIES)) {
  F.refs = REFERENCE_LIBRARY.filter((e) => e.active && e.family === id).sort((a, b) => (a.id < b.id ? -1 : 1)).map(fileOf);
}
export const REFERENCES = Object.fromEntries(['loose', 'gathered', 'resolved'].map((t) => [t, familiesOfTier(t).flatMap((id) => FAMILIES[id].refs)]));

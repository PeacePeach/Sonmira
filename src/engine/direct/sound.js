// The Loose performance plan: how this particular voice moved, translated
// into composition, marks and colour character. The reference decides the
// artistic language (medium, technique, kind of marks, texture); this plan
// decides where the marks go, how they move, how dense they are and how
// the colour leans, so two different performances painted from the same
// reference give two different pictures.
//
//   soundPlan({ expression, energy }) → { variables, composition, marks, colour }
//
// Every line is chosen by the audio measurements (spec.expression from
// understand.js expressionFor, spec.energy from interpret/spec.js energyFor);
// nothing here is random, so the same performance always gives the same
// plan. A measurement that is missing is left out, never guessed.
//
// The mapping is an artistic choice, not a measured truth:
//   melody shape (contour)      → direction of movement, temperature shift
//   register                    → value key; where the weight sits when the melody holds level
//   pitch range                 → how far the marks spread across the sheet
//   pauses (flow) and phrases   → one continuous body or separate clusters
//   onset regularity (rhythm)   → even or syncopated spacing
//   pitch continuity (line)     → long gliding strokes or separate dabs
//   energy                      → density and speed of marks, colour strength
//   dynamics                    → one concentrated climax or an even load
//   vibrato                     → feathered or steady edges
// No word here names an object, a figure or a place (leakage.js).

const MOVEMENT = {
  rising: 'the marks begin low on the sheet and climb toward the upper edge, thinning and opening as they rise',
  falling: 'the marks start high on the sheet and descend, gathering weight toward the bottom',
  arching: 'the marks rise across the sheet in one broad arc and fall away on the other side',
  dipping: 'the marks sag through the middle of the sheet and lift again toward both sides',
  level: 'the marks drift mostly sideways across the sheet, on one held horizontal current',
};
const WEIGHT = {
  low: 'the heaviest passage sits in the lower part of the sheet',
  mid: 'the heaviest passage sits at middle height, pushed toward one side',
  high: 'the heaviest passage sits high in the upper part of the sheet',
};
const EXTENT = {
  narrow: 'compact: the painted area covers only a modest part of the sheet, with wide open paper around it',
  moderate: 'the painted area spreads over roughly half of the sheet',
  wide: 'expansive: the marks sweep from edge to edge',
};
const BODY = {
  connected: { single: 'one continuous body of colour in which the washes run into each other wet-in-wet', few: 'one continuous body of colour with a couple of soft narrowings where it almost breaks', many: 'one long chain of colour, pinched in many places but never fully broken' },
  broken: { single: 'two separate masses of marks with a clear gap of dry paper between them', few: 'two or three separate clusters of marks with clear dry paper between them', many: 'many small separate clusters scattered across the sheet, dry paper between them' },
};
const SPACING = {
  regular: 'the strokes and clusters repeat at an even, steady interval',
  irregular: 'the spacing is uneven and syncopated: some marks bunch tightly together, others stand alone',
};
const STROKE = {
  smooth: 'long, gliding strokes that change direction without lifting the brush',
  stepped: 'short, separate dabs and stepped strokes, each set down on its own',
};
const DENSITY = {
  calm: 'few, broad, slow marks; low density; large quiet areas',
  moderate: 'broad washes with some quicker strokes over them; medium density',
  lively: 'many quick, short, energetic marks, flicks and spatter; high density',
};
const LOAD = {
  even: 'an even pigment load throughout, with no single climax',
  swelling: 'the pigment load swells into one strong, concentrated passage and fades back to pale',
};
const EDGE = { true: 'feathered, trembling edges on the main strokes', false: 'clean, steady edges on the main strokes' };

const STRENGTH = {
  calm: 'diluted, transparent colour, quieter than the reference',
  moderate: 'colour at about the reference\'s own strength',
  lively: 'more concentrated pigment and stronger chroma than the reference',
};
const KEY = {
  low: 'a deeper, lower-key version of the colour, with more mid and dark values',
  mid: 'the reference\'s own value range',
  high: 'a lighter, higher-key version of the colour, with more open paper',
};
const TEMPERATURE = {
  rising: 'warming as the marks rise',
  falling: 'cooling as the marks descend',
  arching: 'warmest at the top of the arc',
  dipping: 'coolest in the low middle',
  level: 'the reference\'s own temperature, held steady',
};

// Free hue within the reference's colour language: intentional, not
// arbitrary, because where it moves is tied to the strongest passage.
export const HUE_FREEDOM = 'The reference\'s hues are a starting point, not a requirement: the dominant hue may move to a neighbouring hue, and one contrasting accent may appear in the strongest passage, as long as the colour keeps the reference\'s transparency and value structure.';

const pick = (table, key) => (key == null ? null : table[key] ?? null);

export function soundPlan({ expression = null, energy = null } = {}) {
  const x = expression ?? {};
  const e = energy?.value ?? energy ?? null;
  const variables = {
    movement: x.contour ?? null, weight: x.contour == null || x.contour === 'level' ? x.register ?? null : null, extent: x.range ?? null,
    body: x.flow ?? null, phrasing: x.phrasing ?? null, spacing: x.rhythm ?? null, stroke: x.line ?? null,
    density: e, load: x.dynamics ?? null, edges: typeof x.vibrato === 'boolean' ? x.vibrato : null,
  };
  const body = x.flow ? BODY[x.flow]?.[x.phrasing ?? 'few'] ?? null : null;
  // A rising or falling (or arched) melody already says where the weight
  // goes; register places it only when the melody holds level.
  const weight = x.contour == null || x.contour === 'level' ? pick(WEIGHT, x.register) : null;
  const arrangement = [pick(MOVEMENT, x.contour), weight, pick(EXTENT, x.range), body, pick(SPACING, x.rhythm)].filter(Boolean);
  const marks = [pick(STROKE, x.line), pick(DENSITY, e), pick(LOAD, x.dynamics), variables.edges == null ? null : EDGE[variables.edges]].filter(Boolean);
  const colour = [pick(STRENGTH, e), pick(KEY, x.register), pick(TEMPERATURE, x.contour), x.dynamics === 'swelling' ? 'the strongest colour only at the swell' : null].filter(Boolean);
  return {
    variables,
    composition: arrangement.length ? `Composition, from how this voice moved (not from the reference's layout): ${arrangement.join('; ')}. Nothing sits on the centre line.` : 'Composition: an all-over field of marks, arranged afresh rather than following the reference\'s layout. Nothing sits on the centre line.',
    marks: marks.length ? `Marks, in the reference's own technique: ${marks.join('; ')}.` : null,
    colour: `${colour.length ? `Colour, from this performance: ${colour.join('; ')}. ` : ''}${HUE_FREEDOM}`,
  };
}

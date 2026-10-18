// Composition language per family: how a reference organises a picture
// (structure, viewpoint, placement, scale, negative space), translated into
// principles that apply to any subject. Like the family rules, these name
// no objects: the words decide what is painted, the reference decides how it
// is composed. Each generation draws one viewpoint, one focal placement and
// one scale from the family's own options (seeded), so repeated subjects do
// not settle into one layout; no placement is central.
//
// Loose families have no plan: their references are all-over fields.

import { rng, hashSeed } from '../render/rng.js';

export const COMPOSITION = {
  'G1-atmospheric-study': {
    principles: 'Broad horizontal bands weighted unevenly: one band dominates and the horizon sits high or low, never at the middle; the few accents gather toward one side and the rest stays open and airy.',
    viewpoints: ['a level, distant view', 'a slightly raised, distant view'],
    placements: ['on a low horizon toward the left edge', 'on a low horizon in the right third', 'high in the left third, on a high horizon'],
    scales: ['small and far away within wide space', 'a thin, low strip across part of the width'],
  },
  'G2-splash-wash': {
    principles: 'Marks gather in one lower corner and thin out diagonally across the sheet; weight is lopsided and at least half of the sheet stays open paper.',
    viewpoints: ['a low, close view', 'a level view'],
    placements: ['gathered in the lower-left corner', 'gathered in the lower-right corner', 'along the lower edge, heavier on the right'],
    scales: ['large blots against small flicks', 'a dense cluster against a wide empty field'],
  },
  'G3-luminous-contrast': {
    principles: 'A strong light-to-dark structure: a shaft or haze of light crosses the picture diagonally from an upper corner, darks mass along one side, and depth is built by value rather than line.',
    viewpoints: ['a low view looking into the light', 'a level view into deep space'],
    placements: ['where the light falls in the upper-left third', 'where the light falls in the upper-right third', 'low on the right, at the end of the light'],
    scales: ['small against tall masses of dark', 'mid-sized, half lost in the light'],
  },
  'R1-graphic-snow': {
    principles: 'Strong directional geometry: the picture is built on long parallel diagonals that cross the whole sheet, and light and shadow become sharp graphic bands in a steady rhythm; graphic spatial relationships of small sharp forms against one vast plane; nothing sits on the vertical centre line.',
    viewpoints: ['a high vantage looking steeply down', 'a high oblique vantage, the ground tilted up toward the viewer'],
    placements: ['low in the right third, on one of the diagonals', 'in the upper-left third, on one of the diagonals', 'in the lower-left, where two diagonals cross', 'high on the right, near the edge'],
    scales: ['very small within a vast plane', 'a repeated small form in a stepped diagonal rhythm'],
  },
  'R2-aerial-shallows': {
    principles: 'Aerial composition: looked at from directly or steeply above, with no horizon; asymmetric, with the focus in one third while an organic, irregular band of contrasting colour sweeps across a corner; organic spatial patterns of pigment, granulation and spatter carry the whole field; rich, deep pigment. Anything that would be overhead appears only as its light, reflection or shadow on the surface below.',
    viewpoints: ['directly from above, no horizon', 'a steep aerial view, no horizon'],
    placements: ['in the lower-left third', 'in the upper-right third', 'along the right third, near the contrasting band', 'low on the left, angled across the diagonal'],
    scales: ['a small, precise focus within a large textured field', 'a scattered rhythm of small crisp touches across one diagonal'],
  },
  'R3-vivid-wash-focal': {
    principles: 'A crisp focus reserved against an explosive field: the burst radiates from one side, the focus sits off-axis close to an edge, and large torn openings of white paper balance it.',
    viewpoints: ['a close, level view', 'a slightly low view'],
    placements: ['in the left third, close to the edge', 'in the lower-right third', 'high on the right, partly cropped'],
    scales: ['large and partly cropped by the frame', 'mid-sized, with a much larger burst around it'],
  },
  'R4-lyrical-everyday': {
    principles: 'Atmospheric depth: a very low or very high horizon and layered recession from warmer near passages to cooler far ones; delicate gradients and nuanced warm and cool relationships; the focus small and placed off-centre, while expressive negative space of open sky, air or mist takes most of the sheet.',
    viewpoints: ['a level view with a very low horizon', 'a slightly raised view with a high horizon'],
    placements: ['small, low in the left third', 'small, low in the right third', 'small, near the lower-right edge', 'small, in the upper-left third against open space'],
    scales: ['small within a vast, open space', 'a quiet accent in a large field of air'],
  },
  'R5-light-as-subject': {
    principles: 'The light gathers in one off-centre area, near an edge or a corner, against deep values elsewhere; glints and reflections run as a diagonal or curving rhythm rather than a straight column; close or cropped framing.',
    viewpoints: ['a close, cropped view', 'a low view across the surface'],
    placements: ['in the upper-right corner area', 'along the lower-left diagonal', 'in the right third, curving toward the edge'],
    scales: ['a dense knot of light in a large dark field', 'scattered points of light across one diagonal'],
  },
  'R6-misty-monochrome': {
    principles: 'One form placed far to one side, dissolving downward into mist; a vast, pale, empty ground on the other side; vertical elegance with asymmetric balance.',
    viewpoints: ['a level view', 'a slightly low view'],
    placements: ['far to the left', 'far to the right', 'high on the right, dissolving downward'],
    scales: ['tall and slender in a vast pale field', 'small and distant in a vast pale field'],
  },
};

// How much of the subject is shown: the subject may be cropped or shown only
// through its effects, which keeps a familiar subject from a familiar pose.
const STAGING = [
  'shown whole',
  'partly cropped by the frame',
  'shown mostly through its light, reflection or shadow',
];

// Composition rules for every tier with a plan (Gathered, Resolved): the
// focus is never centred; Resolved asks for real compositional intent.
export const NOT_CENTRED = 'Do not place the focus in the centre or on the vertical centre line, and avoid symmetrical layouts.';
export const RESOLVED_COMPOSITION = 'Compose with real intent, as a painter would: a clear spatial hierarchy of one dominant shape, a few secondary ones and many small ones; asymmetry and one strong directional movement; varied scale and edges; the subject staged with purpose through viewpoint, cropping and partial reveal. Translate the reference\'s structural principles into a new, original arrangement; never copy its layout.';

// For a reference with no family (an upload straight into a tier folder):
// no family's composition language applies, so only principles true of any
// reference, with the same seeded off-centre choices.
export const NEUTRAL_COMPOSITION = {
  principles: 'Follow the reference\'s own way of organising the picture, its balance of busy and quiet areas and its scale of marks, in a new arrangement; weight is asymmetric and the open areas are as deliberate as the painted ones.',
  viewpoints: ['a level view', 'a slightly raised view', 'a slightly low view'],
  placements: ['in the left third', 'in the right third', 'low in the right third', 'high in the left third'],
  scales: ['small within generous open space', 'mid-sized, partly dissolving into its surroundings'],
};

// familyId null: a reference without a family (NEUTRAL_COMPOSITION).
export function compositionPlan(familyId, seed) {
  const C = familyId === null ? NEUTRAL_COMPOSITION : COMPOSITION[familyId];
  if (!C) return null;
  const r = rng(hashSeed(seed >>> 0, 'compose'));
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  return { principles: C.principles, viewpoint: pick(C.viewpoints), placement: pick(C.placements), scale: pick(C.scales), staging: pick(STAGING) };
}

export function compositionLine(plan, tier) {
  if (!plan) return null;
  const arrangement = `This painting: ${plan.viewpoint}; the focus ${plan.placement}, ${plan.scale}, ${plan.staging}.`;
  return [`Composition, in the reference's own language: ${plan.principles}`, arrangement, NOT_CENTRED, tier === 'resolved' ? RESOLVED_COMPOSITION : null].filter(Boolean).join(' ');
}

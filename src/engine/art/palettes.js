// Unified colour system (highest-priority art direction from Han).
//
// Every painting draws on ONE restrained collection of muted watercolour
// pigments, uses only 2–4 of them, and sits on warm paper. Emotion picks and
// weights pigments inside this collection (a subtle shift in temperature and
// depth), it never introduces saturated or extra colours. Darks are the same
// pigments glazed more densely, never black or a new hue, so contrast stays
// soft.

export const PIGMENTS = {
  mistyBlue: '#A7BCCD',
  dustyBlueGrey: '#8D99A6',
  sage: '#A5B399',
  blush: '#E4C5BC',
  ivory: '#F0E6D2',
  sand: '#D8C4A2',
  lavender: '#B5ADC4',
};

// Emotion → pigment preference (first two are always used) and how deep the
// darkest glaze may go (1 = darkest allowed by the art direction).
export const MOODS = {
  tender: { pigments: ['blush', 'lavender', 'mistyBlue', 'sand'], depth: 0.62, note: 'blush and lavender, warm and light' },
  bright: { pigments: ['mistyBlue', 'sand', 'sage', 'ivory'], depth: 0.6, note: 'misty blue with sand and ivory, airy' },
  melancholic: { pigments: ['dustyBlueGrey', 'mistyBlue', 'lavender', 'sage'], depth: 0.8, note: 'blue-greys, cool and quiet' },
  intense: { pigments: ['dustyBlueGrey', 'blush', 'lavender', 'sage'], depth: 1.0, note: 'blue-grey against blush, the most contrast allowed' },
};

// A motif may need one pigment to stay legible (foliage reads green).
const MOTIF_NEEDS = { garden: 'sage', landscape: 'sage', water: 'mistyBlue', sky: 'mistyBlue', interior: 'sand', abstract: null };

const MAX_PIGMENTS = 4;
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const blueness = ([r, g, b]) => b - (r + g) / 2;
const greenness = ([r, g, b]) => g - (r + b) / 2;
const warmth = ([r, g, b]) => r - b;
// Same pigment, glazed `n` times (transmittance multiplies).
const glazed = (c, n) => c.map((v) => v ** n);

export function choosePigments(emotion, motif, r = Math.random) {
  const mood = MOODS[emotion] || MOODS.tender;
  const set = mood.pigments.slice(0, 2);
  const need = MOTIF_NEEDS[motif];
  if (need && !set.includes(need)) set.push(need);
  // Optional extra pigment, chosen by seed, for variety within the mood.
  for (const p of mood.pigments.slice(2)) if (set.length < 3 + (r() < 0.5 ? 1 : 0) && !set.includes(p)) set.push(p);
  return set.slice(0, MAX_PIGMENTS);
}

// Builds the slot colours a motif paints with, all from the chosen pigments.
export function paletteFor(emotion, motif, r = Math.random) {
  const mood = MOODS[emotion] || MOODS.tender;
  const names = choosePigments(emotion, motif, r);
  const pig = Object.fromEntries(names.map((n) => [n, hexToRgb(PIGMENTS[n])]));
  const list = names.map((n) => pig[n]);
  const best = (score) => list.reduce((a, b) => (score(b) > score(a) ? b : a));
  const coolest = best(blueness), warmest = best(warmth), greenest = best(greenness);
  const lightest = best(lum), darkest = best((c) => -lum(c));
  const d = mood.depth;
  const slots = {
    light: lightest,
    sky: coolest,
    water: coolest,
    foliage: greenness(greenest) > 0.01 ? greenest : darkest,
    earth: warmest,
    warm: warmest,
    deep: glazed(darkest, 1 + 0.9 * d),
    shadow: glazed(darkest, 1.4 + 1.3 * d),
    accent: glazed(warmth(warmest) > 0.04 ? warmest : darkest, 1.3 + 0.9 * d),
  };
  return { emotion, motif, pigments: names, depth: d, contrast: 0.65 + 0.35 * d, slots };
}

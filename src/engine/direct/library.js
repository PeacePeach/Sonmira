// Reference library: selection of the primary reference and its colour
// language, on top of the registry in references.js (the single source of
// truth, maintained by tools/index_references.py).
//
//   Sound → interpretation → visual family → primary reference (here)
//         → reference palette and art direction → image model
//
// Each tier's pool is its active references in id order, whatever their
// family (a reference's tier is its family's, or its folder's when it has no
// family). One is drawn per generation with the seed from the decided tier's
// pool, every reference equally likely (selectInTier); the same seed and the
// same library version always give the same reference. Family pools remain
// for the family draw, a pinned family and the leakage check.

import { rng, hashSeed } from '../render/rng.js';
import { REFERENCE_LIBRARY } from './references.js';
import { FAMILIES } from './families.js';

export const tierOf = (e) => (e?.family ? FAMILIES[e.family]?.tier : e?.tier) ?? null;

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export function createLibrary(entries = REFERENCE_LIBRARY) {
  const active = entries.filter((e) => e.active && tierOf(e)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pools = new Map();
  const tiers = new Map();
  for (const e of active) {
    if (e.family) pools.set(e.family, [...(pools.get(e.family) || []), e]);
    tiers.set(tierOf(e), [...(tiers.get(tierOf(e)) || []), e]);
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  const draw = (pool, seed) => (pool?.length ? pool[Math.floor(rng(hashSeed(seed >>> 0, 'primary-ref'))() * pool.length)] : null);
  return {
    // Changes whenever a reference is added, removed, reassigned or retired.
    version: fnv(active.map((e) => `${e.family ?? e.tier}:${e.id}:${e.path}`).join('|')),
    pool: (family) => (pools.get(family) || []).slice(),
    tierPool: (tier) => (tiers.get(tier) || []).slice(),
    get: (id) => byId.get(id) || null,
    select: (family, seed = 0) => draw(pools.get(family), seed),
    selectInTier: (tier, seed = 0) => draw(tiers.get(tier), seed),
  };
}

export const LIBRARY = createLibrary();

// A plain colour name from a measured hex value, so a new reference needs no
// hand-written colour description.
const HUES = [[15, 'red'], [40, 'orange'], [52, 'ochre'], [68, 'yellow'], [95, 'yellow-green'], [150, 'green'],
  [180, 'sea green'], [200, 'teal'], [225, 'blue'], [255, 'ultramarine'], [285, 'violet'], [320, 'magenta'], [345, 'rose'], [361, 'red']];
export function colourName(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  h = (h + 360) % 360;
  const tone = l > 0.85 ? 'pale ' : l > 0.68 ? 'light ' : l < 0.3 ? 'deep ' : '';
  if (d < 0.06 || s < 0.08) return `${tone}${l > 0.9 ? 'off-white' : h < 90 || h > 330 ? 'warm grey' : 'cool grey'}`.trim();
  let hue = HUES.find(([lim]) => h < lim)[1];
  if ((hue === 'orange' || hue === 'ochre') && l < 0.5) hue = 'brown';
  const chroma = s > 0.6 && l > 0.25 && l < 0.75 ? 'vivid ' : s < 0.25 ? 'muted ' : '';
  return `${tone}${chroma}${hue}`.replace(/\s+/g, ' ').trim();
}

const pct = (x) => `${Math.max(1, Math.round(x * 100))}%`;

// Colour hierarchy of a reference, measured by the indexer, as swatches and
// as the prompt's colour instruction.
export function referencePalette(ref) {
  const P = ref?.palette;
  if (!P?.colors?.length) return null;
  const swatches = P.colors.map((c) => ({ name: colourName(c.hex), hex: c.hex, share: c.share }));
  const accent = P.accent ? { name: colourName(P.accent.hex), hex: P.accent.hex, share: P.accent.share } : null;
  const roles = ['dominant', 'secondary', 'supporting'];
  const parts = swatches.map((c, i) => `${roles[i]} ${c.name} (${c.hex}, about ${pct(c.share)} of the picture)`);
  const value = P.lightness > 0.72 ? 'high-key and light' : P.lightness < 0.5 ? 'low-key, with deep values' : 'mid-toned';
  const sat = P.saturation > 0.3 ? 'saturated' : P.saturation < 0.15 ? 'soft, low saturation' : 'moderate saturation';
  const text = [
    `Colour hierarchy, measured from the reference: ${parts.join(', ')}${accent ? `; accent ${accent.name} (${accent.hex}), kept to about ${pct(accent.share)}` : '; no separate accent colour'}.`,
    `Overall ${value}, ${sat}, ${P.temperature} in temperature; about ${pct(P.paper)} open or near-white paper and ${P.dark < 0.01 ? 'almost no' : `about ${pct(P.dark)}`} deep darks.`,
    ref.light ? `Light: ${ref.light}.` : '',
    'Keep these proportions: vary the colour only within this hierarchy, never introduce an unrelated palette.',
  ].filter(Boolean).join(' ');
  return { swatches: accent ? [...swatches, accent] : swatches, text };
}

// What the prompt says when the reference image is attached: the reference is
// the visual authority for everything except subject and arrangement.
export const REFERENCE_AUTHORITY = [
  'The attached image is the primary style reference for this painting and the visual authority: it overrides every written description below, including colour, light and composition notes.',
  'Controlled by the reference: (1) medium and technique: whether it reads as transparent washes, flat graphic colour, ink-like wash or dry-brush, and its paint behaviour, brush marks, texture, granulation and edges, including whether it has blooms and wet-in-wet at all; (2) dominant palette: its principal colour family, saturation, temperature and supporting accents; (3) colour distribution: the balance of dominant, secondary and accent colour; (4) composition language: visual weight, viewpoint, asymmetry, focal placement and spatial rhythm; (5) negative space: roughly how much open, lightly painted or untouched paper there is, and where; (6) detail distribution: where detail concentrates and where forms dissolve; (7) degree of stylisation and level of finish.',
  'Free: the subject and the exact arrangement. Paint a new, original painting in the same artistic language; do not copy or trace its composition, figures or motifs, and do not reproduce any text, titles or watermarks in it.',
  'Content never comes from the reference: its subjects, objects, figures, places and setting are not part of its style. Paint only the subject the text below asks for, even when it is unlike anything in the reference, and keep the reference\'s palette and light while doing so.',
].join(' ');

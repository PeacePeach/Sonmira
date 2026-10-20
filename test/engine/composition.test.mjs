// The reference shapes composition too: each family's own structural
// principles, a seeded viewpoint, off-centre placement and scale, and a
// higher bar for Resolved. No object words; never a centred focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, FAMILIES, LIBRARY } from '../../src/engine/direct/index.js';
import { COMPOSITION, compositionPlan, RESOLVED_COMPOSITION } from '../../src/engine/direct/composition.js';
import { TERMS, affirmed } from '../../src/engine/direct/leakage.js';

const SEA = { text: 'Moonlight spreading across a calm sea at night, a single silver path of light on the water.', theme: ['stillness', 'night'], imagery: ['moonlight', 'calm sea', 'silver path on the water'], figurative: [] };
const painted = Object.keys(FAMILIES).filter((id) => FAMILIES[id].tier !== 'loose');

test('every Gathered and Resolved family has its own composition language, with no object words', () => {
  for (const id of painted) {
    const C = COMPOSITION[id];
    assert.ok(C?.principles && C.viewpoints.length && C.placements.length >= 3 && C.scales.length, id);
    const text = affirmed([C.principles, ...C.viewpoints, ...C.placements, ...C.scales].join('. '));
    for (const [term, re] of Object.entries(TERMS)) assert.doesNotMatch(text, re, `${id}: ${term}`);
  }
  assert.equal(new Set(painted.map((id) => COMPOSITION[id].principles)).size, painted.length, 'each family composes differently');
});

test('no placement is central', () => {
  for (const id of painted) for (const p of COMPOSITION[id].placements) assert.doesNotMatch(p, /\b(centre|center|central|middle)\b/i, `${id}: ${p}`);
});

test('arrangements vary from one generation to the next within a family', () => {
  for (const id of painted) {
    const seen = new Set();
    for (let seed = 1; seed <= 200; seed++) { const p = compositionPlan(id, seed); seen.add(`${p.viewpoint}|${p.placement}|${p.scale}|${p.staging}`); }
    assert.ok(seen.size >= 8, `${id}: ${seen.size}`);
  }
});

test('same words, mood, tier and seed: the three validation references compose differently', () => {
  const ds = [['R1-graphic-snow', 'resolved_01'], ['R2-aerial-shallows', 'resolved_12'], ['R4-lyrical-everyday', 'resolved_06']]
    .map(([family, reference]) => direct({ completeness: 'resolved', emotion: 'tender', motif: 'water', seed: 1, family, reference, energy: { value: 'calm' }, concept: SEA }));
  assert.equal(new Set(ds.map((d) => d.composition.viewpoint)).size, 3);
  assert.match(ds[0].sections.composition, /directional geometry.*diagonals/);
  assert.match(ds[1].sections.composition, /from directly or steeply above, with no horizon/);
  assert.match(ds[2].sections.composition, /Atmospheric depth.*warm and cool.*negative space/);
  for (const d of ds) {
    assert.match(d.prompt, /Do not place the focus in the centre/);
    assert.ok(d.prompt.includes(RESOLVED_COMPOSITION));
    assert.match(d.prompt, /a centred, symmetrical composition/);
  }
});

test('Loose stays an all-over field; Gathered gets the plan without the Resolved bar', () => {
  const loose = direct({ completeness: 'loose', emotion: 'tender', motif: 'water', seed: 3, energy: { value: 'calm' }, concept: SEA });
  assert.equal(loose.composition, null);
  assert.doesNotMatch(loose.prompt, /Composition, in the reference/);
  const g = direct({ completeness: 'gathered', emotion: 'tender', motif: 'water', seed: 3, energy: { value: 'calm' }, concept: SEA });
  assert.match(g.prompt, /Composition, in the reference's own language/);
  assert.ok(!g.prompt.includes(RESOLVED_COMPOSITION));
  for (const ref of LIBRARY.pool(g.family)) assert.ok(ref);
});

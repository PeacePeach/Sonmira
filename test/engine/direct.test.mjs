import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, familiesFor, FAMILIES, REFERENCES } from '../../src/engine/direct/index.js';
import { SUBJECTS } from '../../src/engine/direct/families.js';
import { visualSpec } from '../../src/engine/interpret/spec.js';
import { interpret } from '../../src/engine/interpret/index.js';

const MOTIFS = ['water', 'sky', 'garden', 'landscape', 'interior', 'abstract'];
const LEVELS = ['loose', 'gathered', 'resolved'];
const spec = (completeness, extra = {}) => ({ completeness, emotion: 'tender', motif: 'water', seed: 1248, energy: { value: 'calm' }, ...extra });

test('every family is grounded in references of its own tier, and every reference is used', () => {
  const used = new Set();
  for (const [id, f] of Object.entries(FAMILIES)) {
    assert.ok(f.refs.length > 0, id);
    for (const ref of f.refs) {
      assert.ok(REFERENCES[f.tier].includes(ref), `${id}: ${ref} is not a ${f.tier} reference`);
      used.add(ref);
    }
    assert.ok(f.observed && f.rules && f.palettes.every((P) => P.colors.length >= 2), id);
  }
  assert.equal(used.size, 22);
});

test('each tier draws only from its own families and reaches all of them across seeds', () => {
  for (const level of LEVELS) for (const motif of MOTIFS) {
    const allowed = familiesFor(level, motif).map(([k]) => k);
    const seen = new Set();
    for (let seed = 1; seed <= 400; seed++) {
      const d = direct(spec(level, { seed, motif }));
      assert.equal(FAMILIES[d.family].tier, level);
      assert.ok(allowed.includes(d.family));
      seen.add(d.family);
    }
    assert.equal(seen.size, allowed.length, `${level}/${motif}`);
  }
});

test('the same seed is deterministic', () => {
  assert.deepEqual(direct(spec('resolved', { seed: 99 })), direct(spec('resolved', { seed: 99 })));
});

test('loose depicts nothing; gathered and resolved always have a subject', () => {
  for (const level of LEVELS) for (const motif of MOTIFS) for (let seed = 1; seed <= 40; seed++) {
    const d = direct(spec(level, { seed, motif }));
    if (level === 'loose') assert.equal(d.subject, null);
    else assert.ok(d.subject, `${level}/${motif}/${seed}`);
  }
});

test('palette is one of the family\'s own schemes, keeps its accent, and the avoid list is always sent', () => {
  for (const id of Object.keys(FAMILIES)) for (let seed = 1; seed <= 30; seed++) {
    const d = direct(spec(FAMILIES[id].tier, { seed, family: id }));
    const scheme = FAMILIES[id].palettes.find((P) => P.colors[0].name === d.pigments[0]);
    assert.ok(scheme, id);
    const names = [...scheme.colors, scheme.accent].filter(Boolean).map((p) => p.name);
    assert.ok(d.pigments.every((p) => names.includes(p)), id);
    assert.deepEqual(d.pigments.slice(0, 2), scheme.colors.slice(0, 2).map((p) => p.name));
    if (scheme.accent) assert.equal(d.pigments.at(-1), scheme.accent.name);
    assert.ok(d.pigments.length >= 2 && d.pigments.length <= 4, `${id}: ${d.pigments.length}`);
    assert.match(d.prompt, /Avoid: neon/);
    assert.match(d.prompt, /signature, logo or watermark/);
  }
});

test('emotion changes light within the palette, not the family or colours', () => {
  const [a, b] = ['tender', 'melancholic'].map((emotion) => direct(spec('resolved', { emotion })));
  assert.equal(a.family, b.family);
  assert.deepEqual(a.pigments, b.pigments);
  assert.notEqual(a.sections.emotion, b.sections.emotion);
});

test('no words: no people and no story at any tier', () => {
  const it = interpret({ features: null, note: '' });
  for (let seed = 1; seed <= 200; seed++) {
    const s = visualSpec({ interpretation: it, features: null, seed });
    assert.equal(s.motif, 'abstract');
    for (const level of LEVELS) {
      const d = direct({ ...s, completeness: level });
      assert.ok(SUBJECTS[d.family]?.abstract !== null, d.family);
      assert.doesNotMatch(d.subject || '', /figure|person|people|woman|child|friends|skater|walker|swimmer/i);
    }
  }
});


test('reference guide: R4 follows one primary reference, others send all of theirs', async () => {
  const { referenceGuide, FAMILIES } = await import('../../src/engine/direct/index.js');
  const r4 = referenceGuide('R4-lyrical-everyday', 7);
  assert.equal(r4.refs.length, 1);
  assert.ok(FAMILIES['R4-lyrical-everyday'].refs.includes(r4.primary));
  assert.deepEqual(referenceGuide('R5-light-as-subject', 7).refs, FAMILIES['R5-light-as-subject'].refs);
  assert.equal(referenceGuide('R5-light-as-subject', 7).primary, null);
});

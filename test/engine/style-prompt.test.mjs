// With a reference attached, the reference is the style authority: the
// written layer carries the subject (lyrics), recognisability (tier), and
// mood and gesture relative to the reference. The universal watercolor
// layer remains only for text-only generation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, createLibrary, GLOBAL_STYLE, GLOBAL_STYLE_RESOLVED, AVOID, REFERENCE_STYLE, REFERENCE_STYLE_LOOSE, REFERENCE_AVOID, FAMILIES } from '../../src/engine/direct/index.js';

const lyrics = { text: 'a paper boat drifting past a lit window', theme: ['longing'], imagery: ['paper boat', 'window'], figurative: [] };
const spec = (family, extra = {}) => ({ completeness: FAMILIES[family].tier, emotion: 'melancholic', motif: 'water', seed: 3, family, energy: { value: 'lively' }, concept: lyrics,
  expression: { range: 'wide', flow: 'broken', dynamics: 'swelling', vibrato: true }, ...extra });

test('with a reference, no universal watercolor technique, composition or avoid rules are sent', () => {
  for (const family of Object.keys(FAMILIES)) {
    const d = direct(spec(family));
    assert.ok(d.reference, family);
    assert.ok(!d.prompt.includes(GLOBAL_STYLE), family);
    // Loose has its own style line and performance plan (sound.js).
    if (FAMILIES[family].tier === 'loose') { assert.ok(d.prompt.includes(REFERENCE_STYLE_LOOSE), family); continue; }
    assert.ok(d.prompt.includes(REFERENCE_STYLE), family);
    assert.match(d.prompt, new RegExp(`Avoid: ${REFERENCE_AVOID[0]}`));
    for (const banned of ['wet-on-wet', 'cinematic', 'smooth artificial gradients', 'generic pastel', 'more paper showing', 'overcast light', 'flicks and splashes', 'sharpest edges only at the focus', 'only a small part of the picture']) {
      const outsideFamily = d.prompt.replace(d.sections.family, '');
      assert.ok(!outsideFamily.includes(banned), `${family}: "${banned}"`);
    }
    // Mood and gesture are phrased relative to the reference.
    assert.match(d.sections.emotion, /reference's own colour and value range/);
    assert.match(d.sections.gesture, /reference's own kind of marks/);
    assert.match(d.sections.energy, /reference's own technique/);
  }
});

test('the subject comes from the lyrics and the tier still sets how recognisable it is', () => {
  const R = direct(spec('R1-graphic-snow')), G = direct(spec('G2-splash-wash')), L = direct(spec('L2-bloom-field'));
  assert.match(R.sections.subject, /^A finished painting of: a paper boat/);
  assert.match(G.sections.subject, /^A semi-abstract painting, only suggesting/);
  assert.match(L.sections.subject, /^An abstract painting\. It depicts nothing/);
  assert.match(R.sections.form, /clear, recognisable subject/);
  assert.match(G.sections.form, /no subject is clearly identifiable/);
  assert.match(L.sections.form, /nothing is deliberately depicted/);
  assert.equal(R.subjectSource, 'lyrics');
  // The reference supplies no content.
  assert.match(R.referencePrompt, /Content never comes from the reference/);
  assert.match(R.referencePrompt, /medium and technique/);
});

test('different families give different style and colour instructions', () => {
  const a = direct(spec('R1-graphic-snow')), b = direct(spec('R4-lyrical-everyday'));
  assert.notEqual(a.sections.family, b.sections.family);
  assert.notEqual(a.sections.palette, b.sections.palette);
});

test('without a reference (text-only), the universal watercolor layer still defines the style', () => {
  const empty = createLibrary([]);
  const d = direct(spec('R1-graphic-snow', { library: empty }));
  assert.equal(d.reference, null);
  // Resolved keeps the universal layer with a richer palette (Han, 19 Oct).
  assert.ok(d.prompt.includes(GLOBAL_STYLE_RESOLVED));
  assert.equal(GLOBAL_STYLE_RESOLVED.replace('a considered palette of three to five clearly distinct colour families, one of them leading', 'one clear colour idea: a dominant colour family with at most one accent'), GLOBAL_STYLE);
  assert.match(d.prompt, new RegExp(`Avoid: ${AVOID[0]}`));
});

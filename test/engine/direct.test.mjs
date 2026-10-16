import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, SUBJECTS } from '../../src/engine/direct/index.js';
import { visualSpec } from '../../src/engine/interpret/spec.js';
import { interpret } from '../../src/engine/interpret/index.js';

const spec = (completeness, extra = {}) => ({ completeness, emotion: 'tender', motif: 'water', seed: 1248, energy: { value: 'calm' }, ...extra });

test('same seed keeps the same subject and palette at every level', () => {
  const [l, g, r] = ['loose', 'gathered', 'resolved'].map((c) => direct(spec(c)));
  assert.equal(l.subject, g.subject);
  assert.equal(g.subject, r.subject);
  assert.deepEqual(l.pigments, r.pigments);
  assert.notEqual(l.sections.form, r.sections.form);
});

test('palette stays within 2–4 pigments and the avoid list is always sent', () => {
  for (const emotion of ['tender', 'bright', 'melancholic', 'intense']) for (const motif of Object.keys(SUBJECTS)) {
    const d = direct({ ...spec('resolved'), emotion, motif });
    assert.ok(d.pigments.length >= 2 && d.pigments.length <= 4, `${emotion}/${motif}`);
    assert.match(d.prompt, /Avoid: saturated/);
  }
});

test('control level never changes palette or atmosphere wording', () => {
  const [l, r] = ['loose', 'resolved'].map((c) => direct(spec(c, { emotion: 'melancholic' })));
  assert.equal(l.sections.palette, r.sections.palette);
  assert.equal(l.sections.atmosphere, r.sections.atmosphere);
});

test('no words → abstract motif with no invented subject', () => {
  const it = interpret({ features: null, note: '' });
  const s = visualSpec({ interpretation: it, features: null, seed: 7 });
  assert.equal(s.motif, 'abstract');
  assert.equal(s.hasWords, false);
  assert.match(direct(s).prompt, /no recognizable objects/i);
});

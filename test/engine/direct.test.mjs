import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, FAMILIES, familiesFor } from '../../src/engine/direct/index.js';
import { visualSpec } from '../../src/engine/interpret/spec.js';
import { interpret } from '../../src/engine/interpret/index.js';

const MOTIFS = ['water', 'sky', 'garden', 'landscape', 'interior', 'abstract'];
const spec = (completeness, extra = {}) => ({ completeness, emotion: 'tender', motif: 'water', seed: 1248, energy: { value: 'calm' }, ...extra });

test('each level samples only from its allowed families, and varies with the seed', () => {
  for (const level of ['loose', 'gathered', 'resolved']) {
    const allowed = familiesFor(level, 'water').map(([k]) => k);
    const seen = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      const d = direct(spec(level, { seed }));
      assert.ok(allowed.includes(d.family), `${level}: ${d.family}`);
      seen.add(d.family);
    }
    assert.equal(seen.size, allowed.length, `${level} should reach every allowed family`);
  }
});

test('loose is an abstract experiment, never a landscape', () => {
  for (let seed = 1; seed <= 50; seed++) for (const motif of MOTIFS) {
    const d = direct(spec('loose', { seed, motif }));
    assert.match(d.prompt, /not a landscape/);
    assert.notEqual(d.family, 'atmosphericLandscape');
    assert.notEqual(d.family, 'lyricalFigurative');
  }
});

test('the same seed is deterministic', () => {
  assert.deepEqual(direct(spec('resolved', { seed: 99 })), direct(spec('resolved', { seed: 99 })));
});

test('palette stays within 2–4 pigments and the avoid list is always sent', () => {
  for (const emotion of ['tender', 'bright', 'melancholic', 'intense']) for (const motif of MOTIFS) for (const level of ['loose', 'gathered', 'resolved']) {
    const d = direct({ ...spec(level), emotion, motif });
    assert.ok(d.pigments.length >= 2 && d.pigments.length <= 4, `${emotion}/${motif}`);
    assert.match(d.prompt, /Avoid: saturated/);
  }
});

test('control level never changes palette or atmosphere wording', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const [l, g, r] = ['loose', 'gathered', 'resolved'].map((c) => direct(spec(c, { seed, emotion: 'melancholic' })));
    assert.equal(l.sections.palette, r.sections.palette);
    assert.equal(g.sections.palette, r.sections.palette);
    assert.equal(l.sections.atmosphere, r.sections.atmosphere);
  }
});

test('family override is honoured and every family has a subject at resolved', () => {
  for (const family of Object.keys(FAMILIES)) {
    const d = direct(spec('resolved', { family }));
    assert.equal(d.family, family);
    if (family !== 'abstractExperimental') assert.ok(d.subject, family);
  }
});

test('no words → abstract motif, no figures and no invented story', () => {
  const it = interpret({ features: null, note: '' });
  for (let seed = 1; seed <= 100; seed++) {
    const s = visualSpec({ interpretation: it, features: null, seed });
    assert.equal(s.motif, 'abstract');
    assert.equal(s.hasWords, false);
    for (const level of ['loose', 'gathered', 'resolved']) {
      const d = direct({ ...s, completeness: level });
      assert.notEqual(d.family, 'lyricalFigurative');
      assert.doesNotMatch(d.subject || '', /figure|woman|walker|boat/i);
    }
  }
});

test('no words at gathered and resolved forbids recognisable things', () => {
  for (const level of ['gathered', 'resolved']) assert.match(direct({ ...spec(level), motif: 'abstract' }).prompt, /Nothing recognisable/);
  assert.doesNotMatch(direct(spec('resolved')).prompt, /Nothing recognisable/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples } from '../../src/engine/analysis/index.js';
import { interpret } from '../../src/engine/interpret/index.js';
import { CALIBRATION, renderPosition, tierFor } from '../../src/engine/interpret/completeness.js';
import { scenes, SR } from './synth.js';

const feat = (k) => analyzeSamples(scenes[k](), SR);

test('completeness follows how connected the voice was', () => {
  assert.equal(interpret({ features: feat('steadyPhrase') }).completeness, 'resolved');
  assert.equal(interpret({ features: feat('brokenPhrase') }).completeness, 'gathered');
  assert.equal(interpret({ features: feat('leaping') }).completeness, 'loose');
  assert.equal(interpret({ features: feat('silence') }).completeness, 'loose');
  assert.equal(interpret({ features: feat('noise') }).completeness, 'loose');
});

test('control score is continuous and maps monotonically to style', () => {
  let prev = -1;
  for (let s = 0; s <= 1.0001; s += 0.05) { const p = renderPosition(s); assert.ok(p >= prev); prev = p; }
  assert.equal(tierFor(CALIBRATION.resolvedAt), 'resolved');
  assert.equal(tierFor(CALIBRATION.gatheredAt - 0.01), 'loose');
});

test('confidence is high for clear singing and zero without pitch', () => {
  assert.ok(interpret({ features: feat('steadyPhrase') }).controlConfidence > 0.8);
  assert.equal(interpret({ features: feat('noise') }).controlConfidence, 0);
});

test('note words choose emotion and motif, in English and Chinese', () => {
  const f = feat('steadyPhrase');
  let it = interpret({ features: f, note: 'Rain on the window' });
  assert.deepEqual([it.motif, it.sources.motif, it.emotion], ['water', 'note', 'melancholic']);
  assert.equal(interpret({ features: f, note: 'Happy birthday, Mia' }).emotion, 'bright');
  it = interpret({ features: f, note: '在花园里给宝宝唱的摇篮曲' });
  assert.deepEqual([it.emotion, it.motif], ['tender', 'garden']);
  it = interpret({ features: f, note: '山路上一个人' });
  assert.deepEqual([it.emotion, it.motif], ['melancholic', 'landscape']);
  assert.equal(interpret({ features: f, note: 'tea by the lamp in my room' }).motif, 'interior');
});

test('a note naming several motifs: first mentioned leads, the next is kept', () => {
  const it = interpret({ features: feat('steadyPhrase'), note: 'the garden after rain, sky clearing' });
  assert.equal(it.motif, 'garden');
  assert.ok(['water', 'sky'].includes(it.secondaryMotif));
});

test('without words: neutral mood and an abstract motif (no guessing feelings from the voice)', () => {
  const it = interpret({ features: feat('steadyPhrase'), note: '' });
  assert.deepEqual([it.emotion, it.sources.emotion], ['tender', 'default']);
  assert.deepEqual([it.motif, it.sources.motif], ['abstract', 'default']);
});

test('motifs outside the allowed list are not returned', () => {
  const it = interpret({ features: feat('steadyPhrase'), note: 'tea in my room', allowedMotifs: ['water', 'sky', 'garden', 'landscape', 'abstract'] });
  assert.notEqual(it.motif, 'interior');
});

test('missing features fall back to neutral defaults', () => {
  const it = interpret({});
  assert.equal(it.sources.emotion, 'default');
  assert.equal(it.controlConfidence, 0);
  assert.equal(typeof it.voiceLabel, 'string');
});

test('voice label describes, never grades', () => {
  for (const k of Object.keys(scenes)) {
    const { voiceLabel, dryingLine } = interpret({ features: feat(k) });
    assert.match(voiceLabel, /^(Low|Middle|High), (soft|bright), (steady|drifting|wandering)$/);
    assert.doesNotMatch(dryingLine, /lovely|good|great|well/i);
  }
});

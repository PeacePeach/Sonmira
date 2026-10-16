import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples } from '../../src/engine/analysis/index.js';
import { interpret } from '../../src/engine/interpret/index.js';
import { scenes, SR } from './synth.js';

const feat = (k) => analyzeSamples(scenes[k](), SR);

test('completeness follows how connected the voice was', () => {
  assert.equal(interpret({ features: feat('steadyPhrase') }).completeness, 'resolved');
  assert.equal(interpret({ features: feat('brokenPhrase') }).completeness, 'gathered');
  assert.equal(interpret({ features: feat('leaping') }).completeness, 'loose');
  assert.equal(interpret({ features: feat('silence') }).completeness, 'loose');
  assert.equal(interpret({ features: feat('noise') }).completeness, 'loose');
});

test('note words choose emotion and motif, in English and Chinese', () => {
  const f = feat('steadyPhrase');
  let it = interpret({ features: f, note: 'Rain on the window' });
  assert.deepEqual([it.motif, it.sources.motif], ['water', 'note']);
  assert.equal(it.emotion, 'melancholic');
  it = interpret({ features: f, note: 'Happy birthday, Mia' });
  assert.equal(it.emotion, 'bright');
  it = interpret({ features: f, note: '在花园里给宝宝唱的摇篮曲' });
  assert.deepEqual([it.emotion, it.motif], ['tender', 'garden']);
  it = interpret({ features: f, note: '山路上一个人' });
  assert.deepEqual([it.emotion, it.motif], ['melancholic', 'landscape']);
});

test('without words, the voice suggests a mood and a place', () => {
  const it = interpret({ features: feat('steadyPhrase'), note: '' });
  assert.equal(it.sources.emotion, 'voice');
  assert.equal(it.sources.motif, 'voice');
  assert.notEqual(it.motif, 'abstract');
});

test('loose paintings without words stay abstract', () => {
  const it = interpret({ features: feat('leaping') });
  assert.equal(it.motif, 'abstract');
});

test('missing features fall back to neutral defaults', () => {
  const it = interpret({});
  assert.equal(it.sources.emotion, 'default');
  assert.equal(it.sources.motif, 'default');
  assert.equal(typeof it.voiceLabel, 'string');
});

test('voice label describes, never grades', () => {
  for (const k of Object.keys(scenes)) {
    const { voiceLabel } = interpret({ features: feat(k) });
    assert.match(voiceLabel, /^(Low|Middle|High), (soft|bright), (steady|drifting|wandering)$/);
  }
});

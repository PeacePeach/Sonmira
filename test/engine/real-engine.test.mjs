// End to end through the contract, feeding 2048-sample snapshots every
// "100 ms" the way the app's AnalyserNode does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealEngine } from '../../src/engine/engines/real.js';
import { createMockEngine } from '../../src/engine/engines/mock.js';
import { validateEngine, validateAnalysis, validatePainting } from '../../src/engine/contract.js';
import { scenes, SR, voice } from './synth.js';

const engine = validateEngine(createRealEngine({ width: 240, height: 300 }));

function snapshots(samples, sr = SR, n = 2048) {
  const hop = Math.round(sr * 0.1), out = [];
  for (let end = hop; end <= samples.length; end += hop) out.push(samples.subarray(Math.max(0, end - n), end));
  return out;
}

async function take(samples, note = '', overrides, sr = SR) {
  const s = engine.createLiveSession({ sampleRate: sr, maxSeconds: 15, seed: 1 });
  for (const f of snapshots(samples, sr)) s.push(f);
  const analysis = validateAnalysis(JSON.parse(JSON.stringify(s.finish())));
  return { analysis, painting: validatePainting(await engine.generate({ analysis, note, audioBlob: null, overrides })) };
}

test('steady phrase becomes a resolved, newly painted image', async () => {
  const { analysis, painting } = await take(scenes.steadyPhrase());
  assert.equal(painting.engineId, 'real-v2');
  assert.equal(analysis.flags.silent, false);
  assert.equal(painting.completeness, 'resolved');
  assert.equal(painting.artwork.kind, 'image');
  assert.ok(painting.artwork.blob.size > 10000);
  assert.match(painting.interpretation.voiceLabel, /steady$/);
});

test('works at 48 kHz too', async () => {
  const { painting } = await take(voice([220, 247, 262, 247, 220, 196].map((hz) => ({ hz, sec: 0.8 })), { sr: 48000 }), '', undefined, 48000);
  assert.equal(painting.completeness, 'resolved');
});

test('fragmented takes stay loose', async () => {
  const { painting } = await take(scenes.leaping());
  assert.equal(painting.completeness, 'loose');
  assert.equal(painting.artwork.kind, 'image');
});

test('silence is flagged and still painted', async () => {
  const { analysis, painting } = await take(scenes.silence());
  assert.equal(analysis.flags.silent, true);
  assert.equal(painting.completeness, 'loose');
  assert.equal(painting.emotion.source, 'default');
  assert.ok(painting.wash.length > 0);
});

test('note steers emotion and motif', async () => {
  const { painting } = await take(scenes.steadyPhrase(), 'Singing in the car with the windows down');
  assert.deepEqual(painting.motif, { label: 'landscape', source: 'note' });
  assert.equal(painting.emotion.source, 'note');
});

test('developer override reaches every tier', async () => {
  for (const c of ['loose', 'gathered', 'resolved']) {
    const { painting } = await take(scenes.steadyPhrase(), '', { completeness: c });
    assert.equal(painting.completeness, c);
    assert.ok(painting.artwork);
  }
});

test('an analysis saved by the mock engine still generates', async () => {
  const s = createMockEngine().createLiveSession({ sampleRate: SR, maxSeconds: 15 });
  for (const f of snapshots(scenes.steadyPhrase())) s.push(f);
  const painting = validatePainting(await engine.generate({ analysis: s.finish(), note: 'by the sea', audioBlob: null }));
  assert.equal(painting.motif.label, 'water');
});

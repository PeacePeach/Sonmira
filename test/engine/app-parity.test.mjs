// The app decides exactly as the Playground's singing test (where the tiers
// were validated on real takes): the same decoded samples, frame features
// measured from them (not the live ones), and the same 16 kHz WAV sent for the
// words. No network: fetch is faked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singers, SR } from './synth.js';
import { understandTake } from '../../src/engine/understand.js';
import { createAIEngine } from '../../src/engine/engines/ai.js';
import { encodeWav, decodeWav } from '../../src/engine/analysis/wav.js';
import { analyzeTranscript } from '../../src/engine/interpret/lyrics.js';
import { cleanReading } from '../../src/engine/providers/openai-understand.js';

const line = 'the moon lies quiet on the sea';
const words = {
  transcript: analyzeTranscript(line, { logprobs: line.split(' ').map((token) => ({ token, logprob: Math.log(0.92) })) }),
  lyrics: cleanReading({ language: 'en', lexical: true, coherent: true, structure: 'clause', unfinished: false, linked: true, missing: '', phraseComplete: true, completionConfidence: 0.9, completionReason: 'a full line', theme: [], imagery: [], figurative: [], mood: 'tender', motif: 'water', concepts: { loose: 'x', gathered: 'y', resolved: 'z' } }),
};

for (const kind of ['strong', 'weak', 'hum', 'speech']) {
  test(`app and Playground give the same decision (${kind} singer)`, async () => {
    const samples = singers[kind]();
    const playground = await understandTake({ samples, sampleRate: SR, words: async () => words });
    let sent = null;
    const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ ok: true, ...words }) }; };
    const wav = new Blob([encodeWav(samples.subarray(0, SR), SR)], { type: 'audio/wav' });
    const engine = createAIEngine({ fetchImpl, decode: async () => ({ samples, sampleRate: SR }), toWordsAudio: async () => wav });
    // Live features that disagree with the recording must not change the decision.
    const live = { features: { durationSec: 1, activity: { soundingSec: 0.2, voicedRatio: 0.1 }, pauses: { count: 40 } }, flags: { silent: false } };
    const app = await engine.understand({ analysis: live, audioBlob: new Blob([new Uint8Array(8)], { type: 'audio/mp4' }) });
    assert.equal(app.tier, playground.tier);
    assert.deepEqual(app.decision, playground.decision);
    assert.deepEqual(app.singing.quality, playground.singing.quality);
    assert.equal(sent.mime, 'audio/wav');
    assert.equal(decodeWav(Buffer.from(sent.audio, 'base64')).sampleRate, SR);
  });
}

test('encodeWav round-trips through decodeWav', () => {
  const x = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 10) * 0.5);
  const d = decodeWav(encodeWav(x, 16000));
  assert.equal(d.sampleRate, 16000);
  assert.equal(d.samples.length, x.length);
  assert.ok(Math.max(...d.samples.map((v, i) => Math.abs(v - x[i]))) < 1e-4);
});

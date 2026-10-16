// The app's default engine: real analysis in the browser, painting from the
// server's OpenAI pipeline, and no fallback when that fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAIEngine } from '../../src/engine/engines/ai.js';
import { getEngine } from '../../src/engine/engines/index.js';
import { analyzeSamples } from '../../src/engine/analysis/index.js';

function hum(sr = 22050, sec = 4, hz = 220) {
  const x = new Float32Array(sr * sec);
  for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin((2 * Math.PI * hz * i) / sr) * Math.min(1, i / sr * 4);
  return x;
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('the app uses the AI engine by default', async () => {
  assert.equal((await getEngine()).id, 'ai-openai-v2');
});

test('generate sends the spec from the real analysis and returns the server painting with diagnostics', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith('data:')) return fetch(url);
    sent = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ ok: true, provider: 'openai', model: 'gpt-image-2', quality: 'medium', ms: 9, family: 'R5-light-as-subject', reference: 'resolved_04', referenceSent: true, libraryVersion: 'v', seed: sent.body.spec.seed, image: PNG }) };
  };
  const engine = createAIEngine({ fetchImpl });
  const analysis = { durationSec: 4, flags: { silent: false, tooShort: false }, wash: [], features: analyzeSamples(hum(), 22050) };
  const r = await engine.generate({ analysis, note: 'by the sea' });
  assert.equal(sent.url, '/api/generate');
  assert.ok(['loose', 'gathered', 'resolved'].includes(sent.body.spec.completeness));
  assert.equal(sent.body.spec.motif, 'water');
  assert.equal(r.artwork.kind, 'image');
  assert.ok(r.artwork.blob.size > 0);
  assert.deepEqual([r.generation.provider, r.generation.model, r.generation.family, r.generation.reference, r.generation.referenceSent], ['openai', 'gpt-image-2', 'R5-light-as-subject', 'resolved_04', true]);
});

test('a failed generation throws a clear error instead of returning a substitute', async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => ({ ok: false, error: 'boom', code: 'provider_error' }) });
  await assert.rejects(createAIEngine({ fetchImpl }).generate({ analysis: { durationSec: 3, flags: { silent: true, tooShort: false }, wash: [] } }),
    (e) => e.name === 'GenerationError' && e.code === 'provider_error' && /couldn’t be made/.test(e.message));
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(createAIEngine({ fetchImpl: offline }).generate({ analysis: { durationSec: 3, flags: { silent: true, tooShort: false }, wash: [] } }), { code: 'network' });
});

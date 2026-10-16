import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateOpenAI, openaiConfig } from '../../src/engine/providers/openai.js';
import { planPainting } from '../../src/engine/plan.js';

const direction = planPainting({ noteText: 'by the sea', vocalControlOverride: 'resolved', seed: 3 }).direction;

test('openai provider refuses to run without a server-side key', async () => {
  assert.equal(openaiConfig({}).configured, false);
  await assert.rejects(generateOpenAI(direction, { env: {}, fetchImpl: () => assert.fail('no request without a key') }), { code: 'not_configured' });
});

test('openai provider sends the art-direction prompt and returns the image', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, init }; return { ok: true, json: async () => ({ data: [{ b64_json: 'QUJD' }] }) }; };
  const g = await generateOpenAI(direction, { env: { OPENAI_API_KEY: 'k' }, fetchImpl });
  const body = JSON.parse(sent.init.body);
  assert.equal(body.prompt, direction.prompt);
  assert.equal(sent.init.headers.authorization, 'Bearer k');
  assert.equal(g.provider, 'openai');
  assert.equal(g.b64, 'QUJD');
});

test('provider errors surface with their message', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) });
  await assert.rejects(generateOpenAI(direction, { env: { OPENAI_API_KEY: 'k' }, fetchImpl }), /bad key/);
});

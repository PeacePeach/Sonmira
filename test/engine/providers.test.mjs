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

test('openai edits send the reference images with the prompt', async () => {
  const { editOpenAI } = await import('../../src/engine/providers/openai.js');
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, init }; return { ok: true, json: async () => ({ data: [{ b64_json: 'QUJD' }] }) }; };
  const g = await editOpenAI('P', [{ name: 'a.jpg', mime: 'image/jpeg', bytes: new Uint8Array([1, 2]) }], { env: { OPENAI_API_KEY: 'k' }, fetchImpl });
  assert.match(sent.url, /images\/edits$/);
  assert.equal(sent.init.body.get('prompt'), 'P');
  assert.equal(sent.init.body.get('model'), 'gpt-image-2');
  assert.equal(sent.init.body.getAll('image[]').length, 1);
  assert.equal(g.b64, 'QUJD');
  await assert.rejects(editOpenAI('P', [], { env: { OPENAI_API_KEY: 'k' }, fetchImpl }), { code: 'no_references' });
});

test('openai edits can stream and return the completed image', async () => {
  const { editOpenAI } = await import('../../src/engine/providers/openai.js');
  let sent;
  const sse = [
    'event: image_edit.partial_image', 'data: {"type":"image_edit.partial_image","b64_json":"UEFSVA=="}', '',
    'event: image_edit.completed', 'data: {"type":"image_edit.completed","b64_json":"RklOQUw=","usage":{"total_tokens":9}}', '',
  ].join('\n');
  const fetchImpl = async (url, init) => { sent = init; return { ok: true, text: async () => sse }; };
  const g = await editOpenAI('P', [{ name: 'a.jpg', mime: 'image/jpeg', bytes: new Uint8Array([1]) }], { env: { OPENAI_API_KEY: 'k' }, fetchImpl, stream: true });
  assert.equal(sent.body.get('stream'), 'true');
  assert.equal(g.b64, 'RklOQUw=');
  assert.deepEqual(g.usage, { total_tokens: 9 });
  const bad = async () => ({ ok: true, text: async () => 'data: {"type":"error","error":{"message":"boom"}}\n' });
  await assert.rejects(editOpenAI('P', [{ name: 'a.jpg', mime: 'image/jpeg', bytes: new Uint8Array([1]) }], { env: { OPENAI_API_KEY: 'k' }, fetchImpl: bad, stream: true }), /boom/);
});

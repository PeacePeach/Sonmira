// /api/reference: the Playground's reference ↔ output comparison reads one
// reference image by id through the server; no storage URL or path leaves it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../../api/reference.js';
import { createHandler as createGenerate } from '../../api/generate.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';

const store = {
  kind: 'fake',
  loadRegistry: async () => REFERENCE_LIBRARY,
  loadImage: async (ref) => ({ name: 'x', mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, ref.id.length]) }),
};
const call = (handler, req) => new Promise((resolve) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
    json(j) { resolve({ code: this.code, json: j, headers: this.headers }); }, end(b) { resolve({ code: this.code, body: b, headers: this.headers }); } };
  handler(req, res);
});

test('serves an active reference by id, as bytes, privately', async () => {
  const r = await call(createHandler({ store, env: { VERCEL_ENV: 'preview' } }), { method: 'GET', query: { id: 'resolved_12' } });
  assert.equal(r.code, 200);
  assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.match(r.headers['cache-control'], /private, no-store/);
  assert.deepEqual([...r.body], [0xff, 0xd8, 'resolved_12'.length]);
});

test('refuses unknown or malformed ids, other methods, a missing store and Production', async () => {
  const h = createHandler({ store, env: {} });
  assert.equal((await call(h, { method: 'GET', query: { id: 'nope_99' } })).code, 404);
  assert.equal((await call(h, { method: 'GET', query: { id: '../registry.json' } })).code, 400);
  assert.equal((await call(h, { method: 'POST', query: { id: 'resolved_12' } })).code, 405);
  assert.equal((await call(createHandler({ store: null, env: {} }), { method: 'GET', query: { id: 'resolved_12' } })).code, 503);
  assert.equal((await call(createHandler({ store, env: { VERCEL_ENV: 'production' } }), { method: 'GET', query: { id: 'resolved_12' } })).code, 404);
  assert.equal((await call(createHandler({ store, env: { VERCEL_ENV: 'production', SONMIRA_REFERENCE_VIEW: '1' } }), { method: 'GET', query: { id: 'resolved_12' } })).code, 200);
});

test('generate reports the reference id, settings and prompt check, and honours a pinned reference', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QQ=="}\n', json: async () => ({ data: [{ b64_json: 'QQ==' }] }) });
  const gen = createGenerate({ store, env: { OPENAI_API_KEY: 'k' }, fetchImpl });
  const spec = { completeness: 'resolved', emotion: 'tender', motif: 'water', seed: 1, energy: { value: 'calm' }, family: 'R2-aerial-shallows', reference: 'resolved_12',
    concept: { text: 'moonlight on a calm sea', theme: [], imagery: [], figurative: [], source: 'note' } };
  const r = await call(gen, { method: 'POST', body: { spec } });
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.equal(r.json.reference, 'resolved_12');
  assert.equal(r.json.subjectSource, 'note');
  assert.deepEqual(r.json.settings, { tier: 'resolved', emotion: 'tender', motif: 'water', energy: 'calm', expression: null });
  assert.equal(r.json.promptCheck.verdict, 'ok');
  assert.doesNotMatch(JSON.stringify(r.json), /blob\.vercel|https?:\/\/[^"]*resolved_12/);
});

test('check=1 reads every reference in the store and reports failures without URLs', async () => {
  const good = await call(createHandler({ store, env: {} }), { method: 'GET', query: { check: '1' } });
  const active = REFERENCE_LIBRARY.filter((e) => e.active).length;
  assert.equal(good.code, 200);
  assert.equal(good.json.ok, true);
  assert.equal(good.json.loaded, active);
  assert.equal(good.json.items.length, REFERENCE_LIBRARY.length);
  const broken = { ...store, loadRegistry: async () => REFERENCE_LIBRARY.filter((e) => e.id !== 'resolved_06'),
    loadImage: async (ref) => { if (ref.id === 'resolved_12') throw new Error('fetch failed for https://x.private.blob.vercel-storage.com/references/resolved/resolved_12.jpg'); return store.loadImage(ref); } };
  const bad = await call(createHandler({ store: broken, env: {} }), { method: 'GET', query: { check: '1' } });
  assert.equal(bad.json.ok, false);
  assert.deepEqual(bad.json.missingFromStore, ['resolved_06']);
  const row = bad.json.items.find((i) => i.id === 'resolved_12');
  assert.equal(row.ok, false);
  assert.doesNotMatch(JSON.stringify(bad.json), /blob\.vercel-storage|https?:/);
});

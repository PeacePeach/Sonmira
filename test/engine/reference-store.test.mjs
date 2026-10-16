// Production reference storage (private Vercel Blob), with an in-memory
// stand-in for @vercel/blob and a mocked OpenAI: no network, no paid calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary } from '../../src/engine/direct/index.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';
import { blobStore, addReference, setReferenceActive, removeReference, REGISTRY_PATH, REGISTRY_TTL_MS } from '../../src/engine/providers/reference-store.js';
import { createHandler } from '../../api/generate.js';

const R4 = 'R4-lyrical-everyday';
const NEW_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
const NEW_PALETTE = { colors: [{ hex: '#2e8b57', share: 0.55 }, { hex: '#f4f1de', share: 0.3 }], accent: { hex: '#d1495b', share: 0.01 }, paper: 0.25, dark: 0, lightness: 0.66, saturation: 0.3, temperature: 'cool' };

function fakeBlob() {
  const files = new Map();
  const calls = [];
  return {
    files, calls,
    async get(pathname, o) {
      calls.push(['get', pathname, o.access]);
      if (!files.has(pathname)) return null;
      return { statusCode: 200, stream: new Blob([files.get(pathname).bytes]).stream(), headers: new Headers(), blob: { pathname, url: `https://store.private.blob.vercel-storage.com/${pathname}` } };
    },
    async put(pathname, body, o) {
      calls.push(['put', pathname, o.access]);
      if (files.has(pathname) && !o.allowOverwrite) throw new Error('exists');
      files.set(pathname, { bytes: typeof body === 'string' ? new TextEncoder().encode(body) : body, contentType: o.contentType });
      return { pathname, url: `https://store.private.blob.vercel-storage.com/${pathname}` };
    },
    async del(pathname) { calls.push(['del', pathname]); files.delete(pathname); },
  };
}

async function seeded(clock = { t: 0 }) {
  const client = fakeBlob();
  const store = blobStore({ client, now: () => clock.t });
  await store.saveRegistry(REFERENCE_LIBRARY);
  return { client, store, clock };
}

// Mocked OpenAI streaming edits endpoint that records what it was sent.
function mockOpenAI() {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, form: init.body }); return { ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QUJD","usage":{"total_tokens":1}}\n' }; };
  return { sent, fetchImpl };
}
function call(handler, body) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, json: j }); } };
    handler({ method: 'POST', body }, res);
  });
}

test('a new reference can be uploaded privately and assigned to R4', async () => {
  const { client, store } = await seeded();
  const e = await addReference(store, { family: R4, fileName: 'balcony_morning.jpg', bytes: NEW_BYTES, palette: NEW_PALETTE });
  assert.deepEqual([e.id, e.family, e.path, e.active], ['balcony_morning', R4, 'resolved/R4/balcony_morning.jpg', true]);
  assert.ok(client.files.has('references/resolved/R4/balcony_morning.jpg'));
  assert.ok(client.calls.filter((c) => c[0] !== 'del').every((c) => c[2] === 'private'), 'every read and write is private');
  const reg = JSON.parse(new TextDecoder().decode(client.files.get(REGISTRY_PATH).bytes));
  assert.equal(reg.at(-1).id, 'balcony_morning');
  await assert.rejects(addReference(store, { family: R4, fileName: 'balcony_morning.jpg', bytes: NEW_BYTES, palette: NEW_PALETTE }), /already exists/);
  await assert.rejects(addReference(store, { family: 'R9-nope', fileName: 'x.jpg', bytes: NEW_BYTES, palette: NEW_PALETTE }), /unknown family/);
});

test('it becomes eligible on a running server without redeploying', async () => {
  const clock = { t: 0 };
  const { client } = await seeded(clock);
  const server = blobStore({ client, now: () => clock.t }); // the deployed function's own store
  const before = createLibrary(await server.loadRegistry());
  await addReference(blobStore({ client }), { family: R4, fileName: 'balcony_morning.jpg', bytes: NEW_BYTES, palette: NEW_PALETTE });
  assert.equal(createLibrary(await server.loadRegistry()).version, before.version, 'cached within the TTL');
  clock.t += REGISTRY_TTL_MS + 1;
  const after = createLibrary(await server.loadRegistry());
  assert.notEqual(after.version, before.version);
  assert.ok(after.pool(R4).some((r) => r.id === 'balcony_morning'));
  assert.ok(Array.from({ length: 200 }, (_, s) => after.select(R4, s).id).includes('balcony_morning'));
});

test('the server reads the selected reference from Blob, sends only it to OpenAI, and uses its palette', async () => {
  const { client, store } = await seeded();
  await addReference(store, { family: R4, fileName: 'balcony_morning.jpg', bytes: NEW_BYTES, palette: NEW_PALETTE });
  const lib = createLibrary(await store.loadRegistry());
  const seed = Array.from({ length: 200 }, (_, s) => s).find((s) => lib.select(R4, s).id === 'balcony_morning');
  const { sent, fetchImpl } = mockOpenAI();
  const handler = createHandler({ store, env: { OPENAI_API_KEY: 'k' }, fetchImpl });
  const r = await call(handler, { spec: { completeness: 'resolved', emotion: 'tender', motif: 'garden', seed, family: R4, energy: { value: 'calm' } } });
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.equal(r.json.reference, 'balcony_morning');
  assert.equal(r.json.referenceSent, true);
  assert.equal(r.json.libraryVersion, lib.version);
  // The palette measured at import is in the instructions.
  assert.match(r.json.prompt, /dominant [a-z -]*green \(#2e8b57, about 55%/);
  // Exactly one image, the selected one, with the bytes stored in Blob.
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /images\/edits$/);
  const images = sent[0].form.getAll('image[]');
  assert.equal(images.length, 1);
  assert.equal(images[0].name, 'balcony_morning.jpg');
  assert.deepEqual(new Uint8Array(await images[0].arrayBuffer()), NEW_BYTES);
  // No Blob URL, pathname or token reaches the client.
  assert.doesNotMatch(JSON.stringify(r.json), /blob\.vercel-storage|references\/|BLOB_READ_WRITE/);
  assert.ok(client.calls.some((c) => c[0] === 'get' && c[1] === 'references/resolved/R4/balcony_morning.jpg'));
});

test('references can be disabled, re-enabled and removed', async () => {
  const { client, store } = await seeded();
  await addReference(store, { family: R4, fileName: 'balcony_morning.jpg', bytes: NEW_BYTES, palette: NEW_PALETTE });
  await setReferenceActive(store, 'balcony_morning', false);
  assert.ok(!createLibrary(await store.loadRegistry()).pool(R4).some((r) => r.id === 'balcony_morning'));
  await setReferenceActive(store, 'balcony_morning', true);
  assert.ok(createLibrary(await store.loadRegistry()).pool(R4).some((r) => r.id === 'balcony_morning'));
  await removeReference(store, 'balcony_morning');
  assert.ok(!(await store.loadRegistry()).some((r) => r.id === 'balcony_morning'));
  assert.ok(!client.files.has('references/resolved/R4/balcony_morning.jpg'));
  // Same registry → same version and selections as the bundled library.
  const lib = createLibrary(await store.loadRegistry());
  assert.equal(lib.version, createLibrary(REFERENCE_LIBRARY).version);
});

test('storage errors reach the client as a code, without store details', async () => {
  const store = blobStore({ client: { async get() { throw new Error('https://store.private.blob.vercel-storage.com/x?token=secret'); } } });
  const handler = createHandler({ store, env: { OPENAI_API_KEY: 'k' }, fetchImpl: mockOpenAI().fetchImpl });
  const r = await call(handler, { spec: { completeness: 'resolved', emotion: 'tender', motif: 'garden', seed: 1, family: R4, energy: { value: 'calm' } } });
  assert.equal(r.code, 502);
  assert.equal(r.json.code, 'reference_store');
  assert.doesNotMatch(JSON.stringify(r.json), /secret|vercel-storage/);
});

test('no store or an empty library is an explicit error, never a text-only painting', async () => {
  const { sent, fetchImpl } = mockOpenAI();
  const body = { spec: { completeness: 'resolved', emotion: 'tender', motif: 'garden', seed: 1, family: R4, energy: { value: 'calm' } } };
  const none = await call(createHandler({ store: null, env: { OPENAI_API_KEY: 'k' }, fetchImpl }), body);
  assert.equal(none.code, 503);
  assert.equal(none.json.code, 'no_reference');
  const empty = await call(createHandler({ store: blobStore({ client: fakeBlob() }), env: { OPENAI_API_KEY: 'k' }, fetchImpl }), body);
  assert.equal(empty.json.code, 'no_reference');
  assert.equal(sent.length, 0, 'no OpenAI call was made');
});

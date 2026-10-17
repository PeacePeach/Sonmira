// Reference selection uses the bundled, version-controlled registry
// (src/engine/direct/references.js), never the mutable registry in Blob:
// a reference change ships, and rolls back, with a deploy. Blob supplies only
// the image bytes. (Han, 16 Oct.)

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/generate.js';
import { REFERENCE_LIBRARY } from '../src/engine/direct/references.js';
import { FAMILIES } from '../src/engine/direct/index.js';

const fakeOpenAI = async () => ({ ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QQ=="}\n', json: async () => ({ data: [{ b64_json: 'QQ==' }] }) });

function storeWith(registry) {
  const s = { kind: 'test', registryReads: 0, loaded: [] };
  s.loadRegistry = async () => { s.registryReads++; return registry; };
  s.loadImage = async (ref) => { s.loaded.push(ref.id); return { name: `${ref.id}.jpg`, mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8]) }; };
  return s;
}

async function paint(store, spec) {
  let out;
  const res = { setHeader() {}, status() { return this; }, json(j) { out = j; } };
  await createHandler({ store, env: { OPENAI_API_KEY: 'test-no-network' }, fetchImpl: fakeOpenAI })({ method: 'POST', body: { spec } }, res);
  return out;
}

test('the bundled registry has the 22 active V1 references, in their tiers', () => {
  const active = REFERENCE_LIBRARY.filter((e) => e.active);
  assert.equal(active.length, 22);
  for (const e of active) assert.ok(FAMILIES[e.family], `${e.id}: unknown family ${e.family}`);
  const perTier = Object.groupBy(active, (e) => FAMILIES[e.family].tier);
  assert.deepEqual(Object.keys(perTier).sort(), ['gathered', 'loose', 'resolved']);
});

test('a changed Blob registry does not change which reference is painted', async () => {
  const tampered = REFERENCE_LIBRARY.map((e) => ({ ...e, active: false })).concat([{ id: 'intruder', family: 'R4-lyrical-everyday', path: 'resolved/intruder.jpg', active: true, palette: [] }]);
  for (const tier of ['loose', 'gathered', 'resolved']) {
    for (const seed of [1, 2, 3, 5, 7]) {
      const spec = { completeness: tier, emotion: 'tender', motif: 'garden', seed, energy: { value: 'calm' }, concept: { text: 'a garden after rain', source: 'note' } };
      const bundled = storeWith(REFERENCE_LIBRARY), blob = storeWith(tampered);
      const a = await paint(bundled, spec), b = await paint(blob, spec);
      assert.ok(a.ok && b.ok, `${tier}/${seed}: ${a.error ?? b.error}`);
      assert.equal(b.reference, a.reference, `${tier}/${seed}`);
      assert.equal(b.family, a.family);
      assert.equal(b.prompt, a.prompt);
      assert.equal(b.libraryVersion, a.libraryVersion);
      assert.equal(blob.registryReads, 0, 'the store registry is never read');
      assert.deepEqual(blob.loaded, [a.reference], 'only the image bytes come from the store');
    }
  }
});

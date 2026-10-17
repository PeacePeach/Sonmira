// An image uploaded to private Blob in a family (folder or file-name code)
// joins that family's pool with no code change; the 22 bundled references
// and their selection stay as they are. In-memory @vercel/blob, mocked
// OpenAI: no network, no paid calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY } from '../../src/engine/direct/library.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';
import { direct } from '../../src/engine/direct/index.js';
import { blobStore, discoverReferences, registryFor, libraryFor, REGISTRY_TTL_MS } from '../../src/engine/providers/reference-store.js';
import { createHandler } from '../../api/generate.js';

const bundled = REFERENCE_LIBRARY.map((e) => e.path);

// list() pages two blobs at a time, as the real one pages at its limit.
function fakeBlob(pathnames) {
  const files = new Map(pathnames.map((p) => [p, new Uint8Array([0xff, 0xd8, 1])]));
  return {
    files, lists: 0,
    async list({ prefix, cursor }) {
      this.lists++;
      const all = [...files.keys()].filter((p) => p.startsWith(prefix)).sort();
      const at = Number(cursor ?? 0);
      const page = all.slice(at, at + 2);
      return { blobs: page.map((pathname) => ({ pathname })), hasMore: at + 2 < all.length, cursor: String(at + 2) };
    },
    async get(pathname) {
      return files.has(pathname) ? { statusCode: 200, stream: new Blob([files.get(pathname)]).stream() } : null;
    },
  };
}
const inBlob = (paths) => [...paths.map((p) => `references/${p}`), 'references/registry.json'];

test('the bundled images alone give exactly the bundled library', async () => {
  assert.equal(discoverReferences(bundled), REFERENCE_LIBRARY);
  const store = blobStore({ client: fakeBlob(inBlob(bundled)) });
  assert.equal(await libraryFor(store), LIBRARY);
});

test('a new image joins its family by file-name code or folder', () => {
  const reg = discoverReferences([...bundled, 'resolved/R4-morning window.jpg', 'gathered/G2-splash-wash/blot.PNG', 'loose/L1/a.webp', 'resolved/stray.jpg', 'resolved/R4-notes.txt', 'registry.json']);
  assert.deepEqual(reg.slice(0, REFERENCE_LIBRARY.length), REFERENCE_LIBRARY);
  assert.deepEqual(reg.slice(REFERENCE_LIBRARY.length), [
    { id: 'blot', family: 'G2-splash-wash', path: 'gathered/G2-splash-wash/blot.PNG', active: true },
    { id: 'a', family: 'L1-line-over-wash', path: 'loose/L1/a.webp', active: true },
    { id: 'R4-morning_window', family: 'R4-lyrical-everyday', path: 'resolved/R4-morning window.jpg', active: true },
  ]);
});

test('a file name already used by another reference gets the family code', () => {
  assert.equal(discoverReferences([...bundled, 'resolved/R5/resolved_01.jpg']).at(-1).id, 'R5_resolved_01');
});

test('an upload to Blob is painted, without a palette of its own', async () => {
  const client = fakeBlob(inBlob([...bundled, 'resolved/R4-new.jpg']));
  const store = blobStore({ client });
  const lib = await libraryFor(store);
  assert.notEqual(lib.version, LIBRARY.version);
  assert.ok(lib.pool('R4-lyrical-everyday').some((e) => e.id === 'R4-new'));
  const d = direct({ completeness: 'resolved', emotion: 'tender', motif: 'water', seed: 1, family: 'R4-lyrical-everyday', reference: 'R4-new', energy: { value: 'calm' }, library: lib });
  assert.equal(d.reference.id, 'R4-new');
  assert.ok(d.swatches.length > 0);

  const painted = new Set();
  const fakeOpenAI = async () => ({ ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QQ=="}\n', json: async () => ({ data: [{ b64_json: 'QQ==' }] }) });
  const handler = createHandler({ store, env: { OPENAI_API_KEY: 'test-no-network' }, fetchImpl: fakeOpenAI });
  for (let seed = 1; seed < 120 && !painted.has('R4-new'); seed++) {
    let out;
    const res = { setHeader() {}, status() { return this; }, json(j) { out = j; } };
    await handler({ method: 'POST', body: { spec: { completeness: 'resolved', emotion: 'tender', motif: 'water', seed, energy: { value: 'calm' } } } }, res);
    assert.ok(out.ok, out.error);
    painted.add(out.reference);
  }
  assert.ok(painted.has('R4-new'));
});

test('the listing is cached, and a failed listing keeps the last good one', async () => {
  const clock = { t: 0 };
  const client = fakeBlob(inBlob([...bundled, 'resolved/R4-new.jpg']));
  const store = blobStore({ client });
  const opts = { now: () => clock.t };
  assert.equal((await registryFor(store, opts)).length, REFERENCE_LIBRARY.length + 1);
  const lists = client.lists;
  await registryFor(store, opts);
  assert.equal(client.lists, lists);
  client.list = async () => { throw new Error('down'); };
  clock.t += REGISTRY_TTL_MS + 1;
  assert.equal((await registryFor(store, opts)).length, REFERENCE_LIBRARY.length + 1);
  // A store that cannot list: the bundled registry.
  assert.equal(await registryFor({ kind: 'test', loadImage: async () => null }), REFERENCE_LIBRARY);
});

// The repository's references/ folder: a new image in a family folder joins
// that family's pool after a deploy, with no registry edit; the bundled
// entries stay as they are.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { folderRegistry, FOLDER_REGISTRY, FOLDER_LIBRARY } from '../../src/engine/providers/reference-folder.js';
import { referenceStoreFromEnv } from '../../src/engine/providers/reference-store.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';
import { LIBRARY, createLibrary } from '../../src/engine/direct/library.js';
import { direct } from '../../src/engine/direct/index.js';

function folder(files) {
  const root = mkdtempSync(join(tmpdir(), 'refs-'));
  for (const f of files) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), 'x'); }
  return root;
}
const bundledPaths = REFERENCE_LIBRARY.map((e) => e.path);

test('the bundled images alone give exactly the bundled library', () => {
  const reg = folderRegistry(folder(bundledPaths));
  assert.equal(reg, REFERENCE_LIBRARY);
  assert.equal(createLibrary(reg).version, LIBRARY.version);
  // What the server selects from today is the bundled library.
  assert.equal(FOLDER_LIBRARY.version, LIBRARY.version);
  assert.equal(FOLDER_REGISTRY.length, REFERENCE_LIBRARY.length);
});

test('a new image in a family folder becomes eligible in that family', () => {
  const root = folder([...bundledPaths, 'resolved/R4/new-painting.jpg', 'gathered/G2-splash-wash/Blot 2.PNG', 'resolved/stray.jpg', 'resolved/R4/notes.txt']);
  const reg = folderRegistry(root);
  const added = reg.slice(REFERENCE_LIBRARY.length);
  assert.deepEqual(added, [
    { id: 'Blot_2', family: 'G2-splash-wash', path: 'gathered/G2-splash-wash/Blot 2.PNG', active: true },
    { id: 'new-painting', family: 'R4-lyrical-everyday', path: 'resolved/R4/new-painting.jpg', active: true },
  ]);
  assert.deepEqual(reg.slice(0, REFERENCE_LIBRARY.length), REFERENCE_LIBRARY);
  const lib = createLibrary(reg);
  assert.notEqual(lib.version, LIBRARY.version);
  assert.ok(lib.pool('R4-lyrical-everyday').some((e) => e.id === 'new-painting'));
  // Selectable, and painted without a measured palette (family colours).
  const d = direct({ completeness: 'resolved', emotion: 'tender', motif: 'water', seed: 1, family: 'R4-lyrical-everyday', reference: 'new-painting', energy: { value: 'calm' }, library: lib });
  assert.equal(d.reference.id, 'new-painting');
  assert.ok(d.swatches.length > 0);
});

test('a file name already used by another reference gets the family code', () => {
  const reg = folderRegistry(folder([...bundledPaths, 'resolved/R5/resolved_01.jpg']));
  assert.equal(reg.at(-1).id, 'R5_resolved_01');
});

test('no folder: the bundled registry', () => {
  assert.equal(folderRegistry(join(tmpdir(), 'no-such-refs-folder')), REFERENCE_LIBRARY);
});

test('the repository folder is the store once it holds images, ahead of Blob', () => {
  const root = folder(bundledPaths);
  assert.equal(referenceStoreFromEnv({ BLOB_READ_WRITE_TOKEN: 't' }, { repoDir: root, repoHasImages: true }).kind, 'repo');
  assert.equal(referenceStoreFromEnv({ BLOB_READ_WRITE_TOKEN: 't' }, { repoDir: root, repoHasImages: false }).kind, 'blob');
  assert.equal(referenceStoreFromEnv({ BLOB_READ_WRITE_TOKEN: 't', SONMIRA_REFS_STORE: 'blob' }, { repoDir: root, repoHasImages: true }).kind, 'blob');
  assert.equal(referenceStoreFromEnv({ SONMIRA_REFS_DIR: root }, { repoDir: root, repoHasImages: true }).kind, 'local');
});

test('the repository store reads the image at its registry path', async () => {
  const root = folder(bundledPaths);
  const store = referenceStoreFromEnv({}, { repoDir: root, repoHasImages: true });
  const img = await store.loadImage(REFERENCE_LIBRARY[0]);
  assert.equal(img.bytes.length, 1);
});

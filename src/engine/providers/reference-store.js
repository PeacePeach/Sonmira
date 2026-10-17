// SERVER ONLY: where reference images and the reference registry live.
//
// Two stores with one interface:
//   loadRegistry() → registry entries (same shape as references.js)
//   loadImage(ref) → { name, mime, bytes } of that one reference
// and, for the writable Blob store, saveRegistry(entries), putImage(path,
// bytes, mime), deleteImage(path).
//
//   blob   Vercel Blob, private access. Images at references/<path>, the
//          registry at references/registry.json. Credentials come from the
//          environment (BLOB_READ_WRITE_TOKEN, or Vercel OIDC); no Blob URL
//          or token ever leaves the server.
//   local  a folder (SONMIRA_REFS_DIR) with the registry bundled in
//          references.js: the development workflow (tools/index_references.py).
//
// The Blob registry is re-read at most every REGISTRY_TTL_MS, so a reference
// imported or disabled there becomes (in)eligible without a redeploy.

import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { REFERENCE_LIBRARY } from '../direct/references.js';
import { FAMILIES } from '../direct/families.js';
import { REFERENCE_DIR, folderHasImages } from './reference-folder.js';

const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const mimeOf = (path) => MIME[extname(path).toLowerCase()] || 'image/jpeg';
export const BLOB_PREFIX = 'references/';
export const REGISTRY_PATH = `${BLOB_PREFIX}registry.json`;
export const REGISTRY_TTL_MS = 30_000;

export function localStore(root, registry = REFERENCE_LIBRARY) {
  return {
    kind: 'local',
    loadRegistry: async () => registry,
    loadImage: async (ref) => ({ name: ref.path.split('/').pop(), mime: mimeOf(ref.path), bytes: await readFile(join(root, ref.path)) }),
  };
}

async function readAll(stream) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// client: { get, put, del } from @vercel/blob (injected in tests).
export function blobStore({ client, token, now = Date.now } = {}) {
  const sdk = client ? Promise.resolve(client) : import('@vercel/blob');
  const auth = token ? { token } : {};
  let cache = null;
  // Errors are reduced to a code so no store detail reaches a response.
  const fetchBlob = async (pathname, fresh) => {
    try {
      const r = await (await sdk).get(pathname, { access: 'private', useCache: !fresh, ...auth });
      return r && r.statusCode === 200 ? await readAll(r.stream) : null;
    } catch (e) {
      throw Object.assign(new Error('reference storage unavailable'), { code: 'reference_store', cause: e });
    }
  };
  return {
    kind: 'blob',
    async loadRegistry({ fresh = false } = {}) {
      if (!fresh && cache && now() - cache.at < REGISTRY_TTL_MS) return cache.entries;
      const bytes = await fetchBlob(REGISTRY_PATH, true);
      const entries = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : [];
      cache = { at: now(), entries };
      return entries;
    },
    async saveRegistry(entries) {
      await (await sdk).put(REGISTRY_PATH, JSON.stringify(entries, null, 1), {
        access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ...auth,
      });
      cache = { at: now(), entries };
    },
    async loadImage(ref) {
      const bytes = await fetchBlob(BLOB_PREFIX + ref.path, false);
      if (!bytes) throw Object.assign(new Error(`reference ${ref.id} is missing from storage`), { code: 'reference_missing' });
      return { name: ref.path.split('/').pop(), mime: mimeOf(ref.path), bytes };
    },
    async putImage(path, bytes, mime = mimeOf(path), { overwrite = false } = {}) {
      await (await sdk).put(BLOB_PREFIX + path, bytes, { access: 'private', contentType: mime, addRandomSuffix: false, allowOverwrite: overwrite, ...auth });
    },
    async deleteImage(path) {
      await (await sdk).del(BLOB_PREFIX + path, auth);
    },
  };
}

// SONMIRA_REFS_STORE decides when set. Otherwise the local folder when
// SONMIRA_REFS_DIR is set, else the repository's references/ folder when it
// holds images (shipped with the deploy), else Blob when the deployment has
// Blob credentials, else none (text-only generation from the bundled
// registry's palettes).
export function referenceStoreFromEnv(env = process.env, { repoDir = REFERENCE_DIR, repoHasImages = folderHasImages(repoDir) } = {}) {
  const mode = env.SONMIRA_REFS_STORE || (env.SONMIRA_REFS_DIR ? 'local' : repoHasImages ? 'repo' : env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'none');
  if (mode === 'blob') return blobStore({ token: env.BLOB_READ_WRITE_TOKEN });
  if (mode === 'local' && env.SONMIRA_REFS_DIR) return localStore(env.SONMIRA_REFS_DIR);
  if (mode === 'repo') return { ...localStore(repoDir), kind: 'repo' };
  return null;
}

// ---- Registry edits (import script and tests). Every change rewrites the
// registry, which changes the library version, so selections stay
// reproducible per version.

const tierOf = (family) => ({ L: 'loose', G: 'gathered', R: 'resolved' })[family[0]];

// Add → assign family → (palette measured by the caller) → available.
export async function addReference(store, { family, fileName, bytes, palette, id, light, motif }) {
  if (!FAMILIES[family]) throw new Error(`unknown family ${family}`);
  const entries = await store.loadRegistry({ fresh: true });
  const refId = id || fileName.replace(/\.[^.]+$/, '');
  if (entries.some((e) => e.id === refId)) throw new Error(`reference id ${refId} already exists`);
  const path = `${tierOf(family)}/${family.split('-')[0]}/${fileName}`;
  await store.putImage(path, bytes);
  const entry = { id: refId, family, path, active: true, palette };
  if (light) entry.light = light;
  if (motif) entry.motif = motif;
  await store.saveRegistry([...entries, entry]);
  return entry;
}

export async function setReferenceActive(store, id, active) {
  const entries = await store.loadRegistry({ fresh: true });
  const e = entries.find((x) => x.id === id);
  if (!e) throw new Error(`no reference ${id}`);
  await store.saveRegistry(entries.map((x) => (x.id === id ? { ...x, active } : x)));
}

export async function removeReference(store, id) {
  const entries = await store.loadRegistry({ fresh: true });
  const e = entries.find((x) => x.id === id);
  if (!e) throw new Error(`no reference ${id}`);
  await store.saveRegistry(entries.filter((x) => x.id !== id));
  await store.deleteImage(e.path);
}

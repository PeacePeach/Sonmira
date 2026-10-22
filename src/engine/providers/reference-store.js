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
//
// Both stores also list their image paths (listPaths), so an image uploaded
// to a family (folder or file-name code, see discoverReferences) joins that
// family's pool on its own: libraryFor(store).

import { readFile, readdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { REFERENCE_LIBRARY } from '../direct/references.js';
import { FAMILIES } from '../direct/families.js';
import { createLibrary, LIBRARY } from '../direct/library.js';
import { adminBlobPath, adminNamespace, applyOverlay, loadOverlay, overlayEnabled } from './reference-admin.js';

const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const mimeOf = (path) => MIME[extname(path).toLowerCase()] || 'image/jpeg';
const isImage = (path) => Boolean(MIME[extname(path).toLowerCase()]);
export const BLOB_PREFIX = 'references/';
export const REGISTRY_PATH = `${BLOB_PREFIX}registry.json`;
export const REGISTRY_TTL_MS = 30_000;

export function localStore(root, registry = REFERENCE_LIBRARY) {
  return {
    kind: 'local',
    loadRegistry: async () => registry,
    loadImage: async (ref) => ({ name: ref.path.split('/').pop(), mime: mimeOf(ref.path), bytes: await readFile(join(root, ref.path)) }),
    listPaths: async () => (await readdir(root, { recursive: true })).map((p) => p.split('\\').join('/')).filter(isImage),
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
    // A reference added in the admin portal lives outside references/
    // (its path starts with admin:, see reference-admin.js).
    async loadImage(ref) {
      const bytes = await fetchBlob(adminBlobPath(ref.path) ?? BLOB_PREFIX + ref.path, false);
      if (!bytes) throw Object.assign(new Error(`reference ${ref.id} is missing from storage`), { code: 'reference_missing' });
      return { name: ref.path.split('/').pop(), mime: mimeOf(ref.path), bytes };
    },
    async putImage(path, bytes, mime = mimeOf(path), { overwrite = false } = {}) {
      await (await sdk).put(BLOB_PREFIX + path, bytes, { access: 'private', contentType: mime, addRandomSuffix: false, allowOverwrite: overwrite, ...auth });
    },
    async deleteImage(path) {
      await (await sdk).del(BLOB_PREFIX + path, auth);
    },
    // Every image under references/, as paths relative to it.
    async listPaths() {
      const paths = [];
      let cursor;
      try {
        do {
          const r = await (await sdk).list({ prefix: BLOB_PREFIX, cursor, ...auth });
          for (const b of r.blobs) paths.push(b.pathname.slice(BLOB_PREFIX.length));
          cursor = r.hasMore ? r.cursor : undefined;
        } while (cursor);
      } catch (e) {
        throw Object.assign(new Error('reference storage unavailable'), { code: 'reference_store', cause: e });
      }
      return paths.filter(isImage);
    },
    // Raw access for the admin overlay (reference-admin.js), under any prefix.
    raw: {
      async list(prefix) {
        const blobs = [];
        let cursor;
        do {
          const r = await (await sdk).list({ prefix, cursor, ...auth });
          for (const b of r.blobs) blobs.push({ pathname: b.pathname, size: b.size ?? null, uploadedAt: b.uploadedAt ?? null });
          cursor = r.hasMore ? r.cursor : undefined;
        } while (cursor);
        return blobs;
      },
      get: (pathname) => fetchBlob(pathname, true),
      // overwrite false fails when the blob exists: the store's own atomic
      // create, used to claim ids.
      put: async (pathname, body, { contentType, overwrite = false } = {}) => {
        await (await sdk).put(pathname, body, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: overwrite, ...auth });
      },
      del: async (pathname) => { await (await sdk).del(pathname, auth); },
    },
  };
}

// Blob when the deployment has Blob credentials (or SONMIRA_REFS_STORE=blob),
// else the local folder when SONMIRA_REFS_DIR is set, else none (text-only
// generation from the bundled registry's palettes).
export function referenceStoreFromEnv(env = process.env) {
  const mode = env.SONMIRA_REFS_STORE || (env.BLOB_READ_WRITE_TOKEN ? 'blob' : env.SONMIRA_REFS_DIR ? 'local' : 'none');
  if (mode === 'blob') return blobStore({ token: env.BLOB_READ_WRITE_TOKEN });
  if (mode === 'local' && env.SONMIRA_REFS_DIR) return localStore(env.SONMIRA_REFS_DIR);
  return null;
}

// ---- Discovery: new images join their family's pool.
//
// The bundled registry (direct/references.js) stays the source for the
// references it lists: their family, measured palette and content. An image
// in the store that it does not list is added when its family can be read
// from its path: a folder named after the family, or a file name that starts
// with the family code:
//
//   references/resolved/R4-morning-window.jpg   → R4-lyrical-everyday
//   references/resolved/R4/morning-window.jpg   → R4-lyrical-everyday
//   references/gathered/G2-splash-wash/blot.png → G2-splash-wash
//
// Any other image directly under a tier folder (references/resolved/x.jpg)
// joins that tier with no family; references are drawn from the whole tier
// (library.selectInTier), so it needs no code in its name. Anything else is
// ignored. A new image has no measured palette, so direct() colours it from
// the drawn family's observed schemes; the image itself is still sent as the
// style reference.

const CODE = /^([A-Z]\d)(?:[\s_-]|$)/i;
const TIERS = ['loose', 'gathered', 'resolved'];
const familyOfName = (name) => FAMILIES[name] ? name : Object.keys(FAMILIES).find((id) => id.split('-')[0].toUpperCase() === name.toUpperCase()) || null;

export function discoverReferences(paths, registry = REFERENCE_LIBRARY) {
  const known = new Set(registry.map((e) => e.path));
  const ids = new Set(registry.map((e) => e.id));
  const added = [];
  for (const path of [...paths].sort()) {
    if (known.has(path) || !isImage(path)) continue;
    const parts = path.split('/');
    const file = basename(path, extname(path));
    const family = parts.slice(0, -1).map(familyOfName).filter(Boolean).pop() || (CODE.test(file) ? familyOfName(file.match(CODE)[1]) : null);
    const tier = family ? null : TIERS.includes(parts[0]) && parts.length === 2 ? parts[0] : null;
    if (!family && !tier) continue;
    const stem = file.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 48);
    let id = stem;
    if (ids.has(id)) id = `${family ? family.split('-')[0] : tier}_${stem}`;
    if (ids.has(id)) continue;
    ids.add(id);
    added.push(family ? { id, family, path, active: true } : { id, tier, path, active: true });
  }
  return added.length ? [...registry, ...added] : registry;
}

// The registry and library /api/generate selects from: the bundled registry
// plus the store's new images, listed at most every REGISTRY_TTL_MS. If the
// listing fails, the bundled registry alone (painting never depends on it).
//
// On top of that, the admin portal's overlay (reference-admin.js): images
// added there join their tier like a discovered upload, and archived ids
// leave selection. An empty overlay leaves the registry exactly as it was.
const discovered = new WeakMap();
export async function registryFor(store, { now = Date.now, fresh = false, env = process.env } = {}) {
  if (!store?.listPaths) return REFERENCE_LIBRARY;
  const hit = discovered.get(store);
  if (!fresh && hit && now() - hit.at < REGISTRY_TTL_MS) return hit.registry;
  let base = hit?.base ?? REFERENCE_LIBRARY;
  try { base = discoverReferences(await store.listPaths()); } catch { /* keep the last good list */ }
  let overlay = hit?.overlay ?? null;
  if (store.raw && overlayEnabled(env)) {
    try { overlay = await loadOverlay(store, adminNamespace(env)); } catch { /* keep the last good overlay */ }
  } else overlay = null;
  const registry = applyOverlay(base, overlay);
  discovered.set(store, { at: now(), registry, base, overlay });
  return registry;
}
export function forgetRegistry(store) { discovered.delete(store); }
export async function libraryFor(store, opts) {
  const registry = await registryFor(store, opts);
  return registry === REFERENCE_LIBRARY ? LIBRARY : createLibrary(registry);
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

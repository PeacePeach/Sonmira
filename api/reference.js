// Vercel Serverless Function: one reference image, for the Playground's
// reference-to-output comparison.
//
//   GET /api/reference?id=resolved_01 → the image bytes (jpeg/png/webp)
//   GET /api/reference?check=1 → { ok, store, registry, active, loaded,
//        missingFromStore, items } where
//        each item is { id, family, active, ok, bytes, mime, error }: every
//        reference in the store's registry is read once; ids the bundled
//        registry has but the store lacks are listed as missing.
//
// The bytes are read server-side from the same store /api/generate uses
// (private Vercel Blob, or SONMIRA_REFS_DIR locally) and streamed back, so
// no Blob URL, path or token reaches the browser: only the reference id goes
// in. Only ids in the active registry are served. Off in Production unless
// SONMIRA_REFERENCE_VIEW=1 is set there: the comparison is a Preview tool.

import { referenceStoreFromEnv, registryFor } from '../src/engine/providers/reference-store.js';
import { REFERENCE_LIBRARY } from '../src/engine/direct/references.js';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const referenceViewAllowed = (env) => env.VERCEL_ENV !== 'production' || env.SONMIRA_REFERENCE_VIEW === '1';

export const createHandler = ({ store = referenceStoreFromEnv(), env = process.env } = {}) => async function handler(req, res) {
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  const fail = (code, error) => { res.status(code).json({ ok: false, error }); };
  if (req.method !== 'GET') return fail(405, 'GET only');
  if (!referenceViewAllowed(env)) return fail(404, 'not available here');
  if (!store) return fail(503, 'no reference store configured');
  const q = req.query ?? Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams);
  if (q.check === '1') return res.status(200).json(await checkAll(store, await registryFor(store, { env })));
  const id = q.id;
  if (!ID.test(String(id ?? ''))) return fail(400, 'invalid id');
  try {
    const ref = (await registryFor(store, { env })).find((e) => e.id === id && e.active);
    if (!ref) return fail(404, 'unknown reference');
    const img = await store.loadImage(ref);
    res.setHeader('content-type', img.mime);
    res.status(200).end(Buffer.from(img.bytes));
  } catch {
    fail(502, 'reference unavailable');
  }
};

export default createHandler();

// Reads the image of every active reference /api/generate selects from (the
// bundled registry plus new images uploaded to a family) through the store, a few at a time, and
// reports what loaded; no paths or URLs are returned. The store's own
// registry is compared for information only.
export async function checkAll(store, bundled = REFERENCE_LIBRARY) {
  const items = [];
  const queue = bundled.filter((e) => e.active);
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const row = { id: e.id, family: e.family ?? null, active: true, ok: false, bytes: 0, mime: null, error: null };
      try { const img = await store.loadImage(e); row.bytes = img.bytes.length; row.mime = img.mime; row.ok = row.bytes > 0; if (!row.ok) row.error = 'empty'; } catch (err) { row.error = String(err.code || err.message || err).replace(/https?:\/\/\S+/g, '[url]').slice(0, 120); }
      items.push(row);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  items.sort((a, b) => (a.id < b.id ? -1 : 1));
  let storeRegistry = null;
  try {
    const reg = await store.loadRegistry?.();
    if (Array.isArray(reg)) {
      const byId = new Map(reg.map((e) => [e.id, e]));
      storeRegistry = {
        entries: reg.length,
        missing: items.filter((i) => !byId.get(i.id)?.active).map((i) => i.id),
        otherFamily: items.filter((i) => byId.get(i.id) && byId.get(i.id).family !== i.family).map((i) => i.id),
        extraActive: reg.filter((e) => e.active && !bundled.some((b) => b.id === e.id && b.active)).map((e) => e.id),
      };
    }
  } catch { /* information only */ }
  const loaded = items.filter((i) => i.ok).length;
  return { ok: items.length > 0 && loaded === items.length, store: store.kind, source: 'bundled', active: items.length, loaded, failed: items.filter((i) => !i.ok).map((i) => i.id), storeRegistry, items };
}

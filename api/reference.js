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

import { referenceStoreFromEnv } from '../src/engine/providers/reference-store.js';
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
  if (q.check === '1') return res.status(200).json(await checkAll(store));
  const id = q.id;
  if (!ID.test(String(id ?? ''))) return fail(400, 'invalid id');
  try {
    const ref = (await store.loadRegistry()).find((e) => e.id === id && e.active);
    if (!ref) return fail(404, 'unknown reference');
    const img = await store.loadImage(ref);
    res.setHeader('content-type', img.mime);
    res.status(200).end(Buffer.from(img.bytes));
  } catch {
    fail(502, 'reference unavailable');
  }
};

export default createHandler();

// Reads every reference the store's registry lists (a few at a time) and
// reports what loaded; no paths or URLs are returned.
export async function checkAll(store, bundled = REFERENCE_LIBRARY) {
  let registry;
  try { registry = await store.loadRegistry(); } catch (e) { return { ok: false, store: store.kind, error: `registry unavailable: ${e.code || e.message}` }; }
  const items = [];
  const queue = [...registry];
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const row = { id: e.id, family: e.family ?? null, active: Boolean(e.active), ok: false, bytes: 0, mime: null, error: null };
      try { const img = await store.loadImage(e); row.bytes = img.bytes.length; row.mime = img.mime; row.ok = row.bytes > 0; if (!row.ok) row.error = 'empty'; } catch (err) { row.error = String(err.code || err.message || err).replace(/https?:\/\/\S+/g, '[url]').slice(0, 120); }
      items.push(row);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  items.sort((a, b) => (a.id < b.id ? -1 : 1));
  const inStore = new Set(registry.map((e) => e.id));
  const missing = bundled.filter((e) => e.active && !inStore.has(e.id)).map((e) => e.id);
  const active = items.filter((i) => i.active);
  return { ok: active.length > 0 && active.every((i) => i.ok) && !missing.length, store: store.kind, registry: registry.length, active: active.length, loaded: active.filter((i) => i.ok).length, missingFromStore: missing, items };
}

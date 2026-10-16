// Vercel Serverless Function: one reference image, for the Playground's
// reference-to-output comparison.
//
//   GET /api/reference?id=resolved_01 → the image bytes (jpeg/png/webp)
//
// The bytes are read server-side from the same store /api/generate uses
// (private Vercel Blob, or SONMIRA_REFS_DIR locally) and streamed back, so
// no Blob URL, path or token reaches the browser: only the reference id goes
// in. Only ids in the active registry are served. Off in Production unless
// SONMIRA_REFERENCE_VIEW=1 is set there: the comparison is a Preview tool.

import { referenceStoreFromEnv } from '../src/engine/providers/reference-store.js';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const referenceViewAllowed = (env) => env.VERCEL_ENV !== 'production' || env.SONMIRA_REFERENCE_VIEW === '1';

export const createHandler = ({ store = referenceStoreFromEnv(), env = process.env } = {}) => async function handler(req, res) {
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  const fail = (code, error) => { res.status(code).json({ ok: false, error }); };
  if (req.method !== 'GET') return fail(405, 'GET only');
  if (!referenceViewAllowed(env)) return fail(404, 'not available here');
  if (!store) return fail(503, 'no reference store configured');
  const id = req.query?.id ?? new URL(req.url ?? '/', 'http://x').searchParams.get('id');
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

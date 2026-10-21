// The reference admin portal's API (admin/references/index.html), served by
// api/reference.js for requests with admin=1: the Hobby plan allows 12
// functions per deployment and Sonmira already has 12. Owner only.
//
//   GET  /api/reference?admin=1&action=status           { configured, authed, namespace }
//   POST ?action=login            { password } → session cookie
//   POST ?action=logout
//   GET  ?action=list             every reference + counts + selection pools
//   GET  ?action=image&id=…       the image bytes (any reference, archived too)
//   POST ?action=upload&tier=…&family=…&name=…&note=…   raw image body
//   POST ?action=archive          { id, reason }
//   POST ?action=restore          { id }
//   GET  ?action=audit            the latest changes
//
// Off unless SONMIRA_ADMIN_PASSWORD (12+ characters) is set in the
// deployment. The password is checked here only; the browser gets an
// HttpOnly, SameSite=Strict session cookie signed with a key derived from
// it (changing the password signs every session out). Every POST also needs
// the x-sonmira-admin header, which a cross-site form cannot send. Blob
// credentials, paths and URLs never leave the server: images are streamed
// back by reference id.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { referenceStoreFromEnv, registryFor } from '../src/engine/providers/reference-store.js';
import { createLibrary } from '../src/engine/direct/library.js';
import { adminNamespace, archiveReference, auditLog, listReferences, restoreReference, uploadReference, TIERS, MAX_BYTES } from '../src/engine/providers/reference-admin.js';

const COOKIE = 'sonmira_ref_admin';
const SESSION_S = 12 * 3600;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const keyOf = (password) => createHash('sha256').update(`sonmira-reference-admin\0${password}`).digest();
const sign = (key, body) => createHmac('sha256', key).update(body).digest('base64url');
export function sessionToken(password, ns, now = Date.now) {
  const exp = Math.floor(now() / 1000) + SESSION_S;
  return `v1.${exp}.${sign(keyOf(password), `v1.${exp}.${ns}`)}`;
}
export function validSession(token, password, ns, now = Date.now) {
  const m = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(String(token ?? ''));
  if (!m || Number(m[1]) < now() / 1000) return false;
  const want = Buffer.from(sign(keyOf(password), `v1.${m[1]}.${ns}`)), got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}
const samePassword = (given, expected) => {
  const a = createHash('sha256').update(String(given ?? '')).digest(), b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
};
const cookieOf = (req) => Object.fromEntries(String(req.headers?.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2))[COOKIE];

// Slows guessing on a warm instance; the password length does the rest.
const failures = new Map();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES + 1) throw Object.assign(new Error('The file is larger than 4 MB.'), { code: 'too_large', expected: true, status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const jsonBody = (req) => (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : (() => { try { return JSON.parse(String(req.body ?? '{}')); } catch { return {}; } })());

// How /api/generate would draw from each tier right now (before the
// per-person recent-five rule, which only narrows the pool): every active
// reference equally likely. Simulated over many seeds, no model call.
export function poolReport(registry, draws = 3000) {
  const library = createLibrary(registry);
  return Object.fromEntries(TIERS.map((tier) => {
    const counts = Object.fromEntries(library.tierPool(tier).map((e) => [e.id, 0]));
    for (let s = 1; s <= draws; s++) { const e = library.selectInTier(tier, s); if (e) counts[e.id]++; }
    return [tier, { pool: Object.keys(counts), draws, share: Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, Math.round((n / draws) * 1000) / 10])) }];
  }).concat([['libraryVersion', library.version]]));
}

export const createHandler = ({ store = referenceStoreFromEnv(), env = process.env, now = Date.now } = {}) => async function handler(req, res) {
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  const send = (code, body) => res.status(code).json(body);
  const fail = (code, error, extra = {}) => send(code, { ok: false, error, ...extra });
  const password = env.SONMIRA_ADMIN_PASSWORD;
  const q = req.query ?? Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams);
  const action = String(q.action ?? '');
  const configured = typeof password === 'string' && password.length >= 12;
  if (!configured) return fail(404, 'The reference admin is not enabled on this deployment.', { code: 'not_enabled' });
  let ns;
  try { ns = adminNamespace(env); } catch { return fail(500, 'Invalid admin namespace.'); }
  const post = req.method === 'POST';
  if (!['GET', 'POST'].includes(req.method)) return fail(405, 'GET or POST only');
  // A custom header cannot be sent cross-site without CORS, which is never granted.
  if (post && req.headers?.['x-sonmira-admin'] !== '1') return fail(403, 'Forbidden', { code: 'csrf' });
  const authed = validSession(cookieOf(req), password, ns, now);
  const secure = !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers?.host ?? '')) ? '; Secure' : '';
  const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/api/reference; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;

  if (action === 'status' && !post) return send(200, { ok: true, authed, namespace: ns, writable: Boolean(store?.raw) });
  if (action === 'login' && post) {
    const ip = String(req.headers?.['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();
    const f = failures.get(ip);
    if (f && f.n >= 5 && now() < f.until) return fail(429, 'Too many attempts; wait a minute.');
    if (!samePassword(jsonBody(req).password, password)) {
      failures.set(ip, { n: (f && now() < f.until ? f.n : 0) + 1, until: now() + 60_000 });
      await delay(400);
      return fail(401, 'Wrong password.', { code: 'wrong_password' });
    }
    failures.delete(ip);
    res.setHeader('set-cookie', cookie(sessionToken(password, ns, now), SESSION_S));
    return send(200, { ok: true });
  }
  if (action === 'logout' && post) { res.setHeader('set-cookie', cookie('', 0)); return send(200, { ok: true }); }
  if (!authed) return fail(401, 'Sign in first.', { code: 'signed_out' });
  if (!store?.raw) return fail(503, 'No writable reference store (Vercel Blob) is configured on this deployment.', { code: 'no_store' });

  try {
    if (action === 'list' && !post) {
      const out = await listReferences(store, env);
      return send(200, { ok: true, ...out, pools: poolReport(await registryFor(store, { env })) });
    }
    if (action === 'image' && !post) {
      if (!ID.test(String(q.id ?? ''))) return fail(400, 'Invalid id.');
      const ref = (await registryFor(store, { env })).find((e) => e.id === q.id);
      if (!ref) return fail(404, 'No such reference.');
      const img = await store.loadImage(ref);
      res.setHeader('content-type', img.mime);
      res.setHeader('cache-control', 'private, max-age=600');
      return res.status(200).end(Buffer.from(img.bytes));
    }
    if (action === 'upload' && post) {
      const bytes = await rawBody(req);
      const meta = await uploadReference(store, env, { tier: String(q.tier ?? ''), family: q.family ? String(q.family) : null, bytes, originalName: q.name, note: q.note }, { now });
      return send(200, { ok: true, reference: meta });
    }
    if (action === 'archive' && post) {
      const b = jsonBody(req);
      return send(200, { ok: true, ...(await archiveReference(store, env, String(b.id ?? ''), { reason: b.reason, now })) });
    }
    if (action === 'restore' && post) {
      return send(200, { ok: true, ...(await restoreReference(store, env, String(jsonBody(req).id ?? ''), { now })) });
    }
    if (action === 'audit' && !post) return send(200, { ok: true, entries: await auditLog(store, env) });
    return fail(400, 'Unknown action.');
  } catch (e) {
    if (e.expected) return fail(e.status ?? 400, e.message, { code: e.code });
    return fail(502, 'Reference storage is unavailable. Reload and try again.', { code: 'storage' });
  }
};


// HTTP handlers for the account endpoints (Vercel Node functions, also
// callable from tests with plain objects).
//
//   POST /api/account/apple          { identityToken, rawNonce, accountId }        → { status, accountId, token }
//   POST /api/account/session        { token }                                     → { accountId, token }
//   POST /api/account/delete         { token, identityToken, rawNonce, authorizationCode } → { deleted, revoked }
//   POST /api/account/notifications  { payload }   (Apple's server-to-server events) → { ok }
//
// Errors answer { error: code } with the code's status. Nothing here logs a
// token, an Apple user id or an account id in full.
//
// deps.authorize(req, accountId) → boolean proves the caller holds the
// account id it sends (the generation guard's install token). Without it,
// /apple answers 503 not_configured: a client-supplied id is never trusted,
// or anyone who learned a guest's id could merge that guest into their own
// account. The other endpoints prove who is calling with a session token or
// Apple's signature.
// deps.limit(req, name) → boolean caps requests per address (429 rate_limited).

import { AccountError } from './accounts.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 64 * 1024) throw new AccountError('too_large', 413); }
  return JSON.parse(raw || '{}');
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * @param {() => Promise<{ accounts: any, verifyNotification: (payload: string) => Promise<{type: string, sub: string}>, authorize?: ((req: any, accountId: string) => Promise<boolean>) | null, limit?: (req: any, name: string) => Promise<boolean> }>} getDeps
 *   resolved per request so a missing configuration answers 503 instead of crashing at import
 */
export function createAccountHandlers(getDeps) {
  const route = (name, fn) => async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    try {
      let body;
      try { body = await readBody(req); } catch (e) { if (e instanceof AccountError) throw e; throw new AccountError('bad_request', 400); }
      const deps = await getDeps();
      if (deps.limit && !(await deps.limit(req, name))) throw new AccountError('rate_limited', 429);
      return send(res, 200, await fn(body || {}, deps, req));
    } catch (e) {
      if (e instanceof AccountError) return send(res, e.status, { error: e.code });
      console.error('[sonmira.account]', e?.message || e);
      return send(res, 500, { error: 'server_error' });
    }
  };

  return {
    apple: route('apple', async (b, { accounts, authorize }, req) => {
      if (!authorize) throw new AccountError('not_configured', 503);
      if (typeof b.accountId !== 'string' || !(await authorize(req, b.accountId))) throw new AccountError('unauthorized', 401);
      return accounts.signInWithApple({ identityToken: b.identityToken, rawNonce: b.rawNonce, accountId: b.accountId });
    }),
    session: route('session', (b, { accounts }) => accounts.renew(b.token)),
    delete: route('delete', (b, { accounts }) => accounts.deleteAccount({ token: b.token, identityToken: b.identityToken, rawNonce: b.rawNonce, authorizationCode: b.authorizationCode })),
    notifications: route('notifications', async (b, { accounts, verifyNotification }) => {
      let ev;
      try { ev = await verifyNotification(b.payload); } catch { throw new AccountError('invalid_notification', 400); }
      await accounts.appleEvent(ev);
      return { ok: true };
    }),
  };
}

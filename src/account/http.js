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
 * @param {() => Promise<{ accounts: any, verifyNotification: (payload: string) => Promise<{type: string, sub: string}> }>} getDeps
 *   resolved per request so a missing configuration answers 503 instead of crashing at import
 */
export function createAccountHandlers(getDeps) {
  const route = (fn) => async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    try {
      let body;
      try { body = await readBody(req); } catch (e) { if (e instanceof AccountError) throw e; throw new AccountError('bad_request', 400); }
      const deps = await getDeps();
      return send(res, 200, await fn(body || {}, deps));
    } catch (e) {
      if (e instanceof AccountError) return send(res, e.status, { error: e.code });
      console.error('[sonmira.account]', e?.message || e);
      return send(res, 500, { error: 'server_error' });
    }
  };

  return {
    apple: route((b, { accounts }) => accounts.signInWithApple({ identityToken: b.identityToken, rawNonce: b.rawNonce, accountId: b.accountId })),
    session: route((b, { accounts }) => accounts.renew(b.token)),
    delete: route((b, { accounts }) => accounts.deleteAccount({ token: b.token, identityToken: b.identityToken, rawNonce: b.rawNonce, authorizationCode: b.authorizationCode })),
    notifications: route(async (b, { accounts, verifyNotification }) => {
      let ev;
      try { ev = await verifyNotification(b.payload); } catch { throw new AccountError('invalid_notification', 400); }
      await accounts.appleEvent(ev);
      return { ok: true };
    }),
  };
}

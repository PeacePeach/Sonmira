// Account session tokens: what the app keeps (in the Keychain) after Sign in
// with Apple, and sends to renew its session, delete the account, or ask the
// generation guard for access on a new iPhone.
//
//   sa1.<payload>.<sig>   payload = { a: accountId, v: record version, iat, exp }
//
// The signature proves we issued it; the version is checked against the
// account record, so signing out everywhere, Apple revoking consent or
// deleting the account makes every older token useless at once.

import { hmac, jsonB64url, parseB64urlJson, safeEqual } from './encoding.js';

const PREFIX = 'sa1';
export const SESSION_TTL_S = 365 * 24 * 3600;

export async function issueSession(secret, { accountId, version }, now = Date.now) {
  const iat = Math.floor(now() / 1000);
  const body = jsonB64url({ a: accountId, v: version, iat, exp: iat + SESSION_TTL_S });
  return `${PREFIX}.${body}.${await hmac(secret, `${PREFIX}.${body}`)}`;
}

/** Signature and expiry only. → { accountId, version } | null */
export async function readSession(secret, token, now = Date.now) {
  if (typeof token !== 'string') return null;
  const [p, body, sig, extra] = token.split('.');
  if (p !== PREFIX || !body || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, await hmac(secret, `${PREFIX}.${body}`))) return null;
  let c;
  try { c = parseB64urlJson(body); } catch { return null; }
  if (typeof c.a !== 'string' || typeof c.v !== 'number' || typeof c.exp !== 'number') return null;
  if (c.exp < Math.floor(now() / 1000)) return null;
  return { accountId: c.a, version: c.v };
}

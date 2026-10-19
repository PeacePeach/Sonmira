// Wires the account endpoints from the environment. Fails closed: without
// its secret or a shared store, every endpoint answers 503 not_configured.
//
// Environment (Vercel, Production):
//   SONMIRA_ACCOUNT_SECRET     32+ random characters, only for accounts (not the guard's secret)
//   KV_REST_API_URL / _TOKEN   the Upstash store the guard and billing already use
//   APPLE_BUNDLE_ID            defaults to app.sonmira
//   APPLE_TEAM_ID, APPLE_SIGNIN_KEY_ID, APPLE_SIGNIN_PRIVATE_KEY
//                              the Sign in with Apple key, for revoking tokens on deletion
// Locally (no VERCEL_ENV) a memory store is allowed so the endpoints can be tried.
//
// The integration composes this without editing it, through buildFromEnv's
// second argument:
//   ledger, seats   the hooks described in accounts.js
//   authorize       (req, accountId) → boolean, the guard's install-token check.
//                   Deployed (VERCEL set) and not supplied, sign-in answers
//                   503 not_configured; locally every caller is allowed.
//   limit           (req, name) → boolean; defaults to a per-address limit
//                   per minute on the account store (LIMITS below).

import { createAccounts, AccountError } from './accounts.js';
import { createAppleKeys, verifyIdentityToken, verifyAppleNotification, createRevoker } from './apple.js';
import { createMemoryStore, createUpstashStore } from './stores.js';
import { createAccountHandlers } from './http.js';
import { kvNamespace } from '../../server/protect/kv.js';

// Requests per address per minute. apple and delete each call Apple, so they
// stay tight; Apple's notifications get room for bursts (Apple retries a 429).
export const LIMITS = { apple: 10, session: 60, delete: 5, notifications: 600 };

export const clientAddress = (req) => String(req.headers?.['x-real-ip'] || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'unknown';

export function perAddressLimit(store, { limits = LIMITS, now = Date.now } = {}) {
  return async (req, name) => {
    if (!store?.hit) return true;
    try { return (await store.hit(`acct:rate:${name}:${clientAddress(req)}:${Math.floor(now() / 60_000)}`, 90)) <= (limits[name] ?? 30); }
    catch { return true; } // the store being down shouldn't lock everyone out; Apple's checks still apply
  };
}

export function buildFromEnv(env = process.env, { fetchImpl = fetch, ledger, seats, authorize, limit } = {}) {
  const deployed = !!env.VERCEL_ENV;
  const secret = env.SONMIRA_ACCOUNT_SECRET;
  const kv = env.KV_REST_API_URL && env.KV_REST_API_TOKEN;
  if (!secret || secret.length < 32 || (deployed && !kv)) return null;
  const audience = env.APPLE_BUNDLE_ID || 'app.sonmira';
  const revokerConfigured = !!(env.APPLE_TEAM_ID && env.APPLE_SIGNIN_KEY_ID && env.APPLE_SIGNIN_PRIVATE_KEY);
  // App Review expects deletion to revoke Apple's tokens, so Production won't delete without the key.
  if (env.VERCEL_ENV === 'production' && !revokerConfigured) return null;

  const getKey = createAppleKeys({ fetchImpl });
  const store = kv ? createUpstashStore({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN, fetchImpl, prefix: kvNamespace(env) }) : createMemoryStore();
  const accounts = createAccounts({
    store,
    secret,
    verifyIdentity: (token, rawNonce) => verifyIdentityToken(token, { audience, rawNonce, getKey }),
    revokeApple: createRevoker({ clientId: audience, teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_SIGNIN_KEY_ID, privateKey: env.APPLE_SIGNIN_PRIVATE_KEY, fetchImpl }),
    // Until the integration passes them: no-ops (see accounts.js).
    ledger,
    seats,
  });
  return {
    accounts,
    verifyNotification: (payload) => verifyAppleNotification(payload, { audience, getKey }),
    authorize: authorize ?? (env.VERCEL || env.VERCEL_ENV ? null : async () => true),
    limit: limit ?? perAddressLimit(store),
  };
}

/**
 * Handlers built lazily from the environment plus the integration's pieces,
 * so each api/account/*.js file stays a single line:
 *   export default createDeployedHandlers({ authorize, ledger, seats }).apple;
 */
export function createDeployedHandlers(options = {}, env = process.env) {
  let deps = null;
  return createAccountHandlers(async () => {
    deps ||= buildFromEnv(env, options);
    if (!deps) throw new AccountError('not_configured', 503);
    return deps;
  });
}

export const handlers = createDeployedHandlers();

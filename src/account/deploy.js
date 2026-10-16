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

import { createAccounts, AccountError } from './accounts.js';
import { createAppleKeys, verifyIdentityToken, verifyAppleNotification, createRevoker } from './apple.js';
import { createMemoryStore, createUpstashStore } from './stores.js';
import { createAccountHandlers } from './http.js';

let built = null;

export function buildFromEnv(env = process.env, { fetchImpl = fetch } = {}) {
  const deployed = !!env.VERCEL_ENV;
  const secret = env.SONMIRA_ACCOUNT_SECRET;
  const kv = env.KV_REST_API_URL && env.KV_REST_API_TOKEN;
  if (!secret || secret.length < 32 || (deployed && !kv)) return null;
  const audience = env.APPLE_BUNDLE_ID || 'app.sonmira';
  const revokerConfigured = !!(env.APPLE_TEAM_ID && env.APPLE_SIGNIN_KEY_ID && env.APPLE_SIGNIN_PRIVATE_KEY);
  // App Review expects deletion to revoke Apple's tokens, so Production won't delete without the key.
  if (env.VERCEL_ENV === 'production' && !revokerConfigured) return null;

  const getKey = createAppleKeys({ fetchImpl });
  const store = kv ? createUpstashStore({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN, fetchImpl }) : createMemoryStore();
  const accounts = createAccounts({
    store,
    secret,
    verifyIdentity: (token, rawNonce) => verifyIdentityToken(token, { audience, rawNonce, getKey }),
    revokeApple: createRevoker({ clientId: audience, teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_SIGNIN_KEY_ID, privateKey: env.APPLE_SIGNIN_PRIVATE_KEY, fetchImpl }),
    // Agreed hooks, wired once those branches land (see accounts.js):
    //   ledger: { merge, erase } from the Payments thread's server/billing
    //   seats:  { adoptSeat, eraseAccount } from Production Readiness's server/protect
  });
  return { accounts, verifyNotification: (payload) => verifyAppleNotification(payload, { audience, getKey }) };
}

export const handlers = createAccountHandlers(async () => {
  built ||= buildFromEnv();
  if (!built) throw new AccountError('not_configured', 503);
  return built;
});

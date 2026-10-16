// Accounts: linking a guest's account id to an Apple ID, and undoing it.
//
// Sonmira has no accounts in the usual sense. Every install has a random
// account id (kept in iCloud Keychain on iOS) that is also the generation
// guard's install id, StoreKit's appAccountToken and the billing ledger's
// key. Sign in with Apple adds one thing: a record saying which Apple ID that
// id belongs to, so the person can find it again on a new iPhone.
//
// What this stores, and nothing more:
//   acct:apple:<appleKey>  → { accountId }        appleKey = keyed hash of Apple's user id
//   acct:rec:<accountId>   → { id, appleKey, createdAt, version, merged: [guest ids] }
//   acct:alias:<guestId>   → { accountId }        a guest id that was merged into an account
// No name, no email, no device details, and never a diary entry, recording or
// painting: those stay on the iPhone.
//
// Billing and the generation guard keep their own data under the account id.
// When a guest signs in with an Apple ID that already has an account, their
// modules move it across through two hooks, both idempotent:
//   ledger.merge(fromId, toId) / ledger.erase(id)      (Payments thread)
//   seats.adoptSeat(fromId, toId) / seats.eraseAccount(id)   (Production Readiness)

import { hmac, ID_PATTERN } from './encoding.js';
import { issueSession, readSession } from './session.js';

export class AccountError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const NOOP_LEDGER = { merge: async () => {}, erase: async () => {} };
const NOOP_SEATS = { adoptSeat: async () => {}, eraseAccount: async () => {} };

const K = {
  apple: (k) => `acct:apple:${k}`,
  rec: (id) => `acct:rec:${id}`,
  alias: (id) => `acct:alias:${id}`,
};

/**
 * @param {{
 *   store: { get: Function, set: Function, del: Function },
 *   secret: string,
 *   verifyIdentity: (identityToken: string, rawNonce?: string) => Promise<{ sub: string }>,
 *   revokeApple?: (authorizationCode: string) => Promise<any>,
 *   ledger?: { merge: Function, erase: Function },
 *   seats?: { adoptSeat: Function, eraseAccount: Function },
 *   now?: () => number,
 * }} deps
 */
export function createAccounts({ store, secret, verifyIdentity, revokeApple = async () => ({ revoked: false, skipped: 'not_configured' }), ledger = NOOP_LEDGER, seats = NOOP_SEATS, now = Date.now }) {
  if (!secret || secret.length < 32) throw new Error('account secret must be at least 32 characters');

  const appleKeyOf = (sub) => hmac(secret, `apple-sub:${sub}`);
  const session = (rec) => issueSession(secret, { accountId: rec.id, version: rec.version }, now);

  async function apple(identityToken, rawNonce) {
    try { return await verifyIdentity(identityToken, rawNonce); }
    catch (e) { if (e instanceof AccountError) throw e; throw new AccountError('invalid_identity', 401); }
  }

  async function resolve(id) {
    const a = await store.get(K.alias(id));
    return a?.accountId || id;
  }

  async function ensureRecord(id, appleKey) {
    const rec = await store.get(K.rec(id));
    if (rec) return rec;
    const fresh = { id, appleKey, createdAt: now(), version: 1, merged: [] };
    await store.set(K.rec(id), fresh);
    return fresh;
  }

  // Billing and the guard first, the alias last: a retry after a failure part
  // way through runs the (idempotent) hooks again instead of skipping them.
  async function merge(fromId, rec) {
    try {
      await ledger.merge(fromId, rec.id);
      await seats.adoptSeat(fromId, rec.id);
    } catch (e) {
      console.error('[sonmira.account] merge hook failed', e);
      throw new AccountError('merge_failed', 503);
    }
    await store.set(K.alias(fromId), { accountId: rec.id });
    if (!rec.merged.includes(fromId)) {
      rec.merged = [...rec.merged, fromId];
      await store.set(K.rec(rec.id), rec);
    }
  }

  async function sessionRecord(token) {
    const s = await readSession(secret, token, now);
    if (!s) return null;
    const rec = await store.get(K.rec(s.accountId));
    return rec && rec.version === s.version ? rec : null;
  }

  async function erase(rec) {
    await ledger.erase(rec.id);
    for (const id of [rec.id, ...rec.merged]) await seats.eraseAccount(id);
    await store.del(K.rec(rec.id), K.apple(rec.appleKey), ...rec.merged.map(K.alias));
  }

  return {
    /**
     * A guest signs in with Apple.
     * → { status: 'linked' | 'returning', accountId, token }
     *   linked     this Apple ID is now tied to the device's account id
     *   returning  this Apple ID already had an account; the device's guest
     *              data was merged into it and the device should adopt accountId
     */
    async signInWithApple({ identityToken, rawNonce, accountId }) {
      if (typeof accountId !== 'string' || !ID_PATTERN.test(accountId)) throw new AccountError('bad_request', 400);
      const { sub } = await apple(identityToken, rawNonce);
      const appleKey = await appleKeyOf(sub);
      const deviceId = await resolve(accountId);

      const deviceRec = await store.get(K.rec(deviceId));
      if (deviceRec) {
        // Only a guest signs in; an account signed in to another Apple ID never merges.
        if (deviceRec.appleKey !== appleKey) throw new AccountError('signed_in_elsewhere', 409);
        if (deviceId !== accountId) await merge(accountId, deviceRec); // a retried merge finishes
        return { status: deviceId === accountId ? 'linked' : 'returning', accountId: deviceId, token: await session(deviceRec) };
      }

      let linked = await store.get(K.apple(appleKey));
      if (!linked && await store.set(K.apple(appleKey), { accountId: deviceId }, { nx: true })) {
        const rec = await ensureRecord(deviceId, appleKey);
        return { status: 'linked', accountId: deviceId, token: await session(rec) };
      }
      linked ||= await store.get(K.apple(appleKey)); // lost a race with another device
      const rec = await ensureRecord(linked.accountId, appleKey);
      if (rec.id === deviceId) return { status: 'linked', accountId: deviceId, token: await session(rec) };
      await merge(deviceId, rec);
      if (accountId !== deviceId) await merge(accountId, rec);
      return { status: 'returning', accountId: rec.id, token: await session(rec) };
    },

    /** Renew a session on launch. → { accountId, token } */
    async renew(token) {
      const rec = await sessionRecord(token);
      if (!rec) throw new AccountError('session_ended', 401);
      return { accountId: rec.id, token: await session(rec) };
    },

    /** For the generation guard's /api/session: → { accountId } | null */
    async verifyAccount(token) {
      const rec = await sessionRecord(token);
      return rec ? { accountId: rec.id } : null;
    },

    /**
     * Delete the account. Needs the session and a fresh Apple sign-in for the
     * same Apple ID, so a stolen session token alone can't delete anything.
     * Apple's tokens are revoked first; if that fails, nothing is removed.
     */
    async deleteAccount({ token, identityToken, rawNonce, authorizationCode }) {
      const rec = await sessionRecord(token);
      if (!rec) throw new AccountError('session_ended', 401);
      const { sub } = await apple(identityToken, rawNonce);
      if (await appleKeyOf(sub) !== rec.appleKey) throw new AccountError('not_this_account', 403);
      let revoked;
      try { revoked = await revokeApple(authorizationCode); }
      catch (e) { console.error('[sonmira.account] revoke failed', e); throw new AccountError('apple_unavailable', 502); }
      await erase(rec);
      return { deleted: true, revoked: !!revoked?.revoked };
    },

    /** Apple's server-to-server notifications. */
    async appleEvent({ type, sub }) {
      const linked = await store.get(K.apple(await appleKeyOf(sub)));
      const rec = linked && await store.get(K.rec(linked.accountId));
      if (!rec) return { handled: false };
      if (type === 'consent-revoked') {
        // Signed out everywhere; the link stays so signing in again finds the same account.
        await store.set(K.rec(rec.id), { ...rec, version: rec.version + 1 });
        return { handled: true, action: 'signed_out' };
      }
      if (type === 'account-delete') { await erase(rec); return { handled: true, action: 'deleted' }; }
      return { handled: false };
    },
  };
}

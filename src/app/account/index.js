// The account on this device: a guest by default, optionally linked to an
// Apple ID. Sign-in never touches the diary; the diary belongs to the device.
//
//   id          this install's account id (guard install id, StoreKit appAccountToken,
//               billing ledger key). On iOS it lives in iCloud Keychain.
//   status()    { signedIn, since, id }
//   signIn()    → { status: 'linked' | 'returning' | 'cancelled' }
//   signOut()   the device becomes a fresh guest; the account keeps its paintings and purchases
//   remove()    → { status: 'deleted' | 'cancelled' }   after Apple confirms it's the same person
//   check()     on launch: → 'guest' | 'signedIn' | 'signedOut' (Apple or the server ended it) | 'offline'
//
// Failures throw AccountError with a kind:
//   'network' | 'notAvailable' (no Apple ID on the device) | 'failed' | 'server' | 'notThisAccount' | 'sessionEnded'

import { randomId, sha256Hex } from '../../account/encoding.js';

export class AccountError extends Error {
  constructor(kind, message) { super(message || kind); this.kind = kind; }
}

const KEY = 'sonmira.account';
export const localStorageBox = {
  read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
};

function fromRemote(e) {
  if (e?.status === 0) return new AccountError('network');
  if (e?.code === 'not_this_account') return new AccountError('notThisAccount');
  if (e?.code === 'session_ended') return new AccountError('sessionEnded');
  if (e?.code === 'invalid_identity') return new AccountError('failed');
  return new AccountError('server');
}
const fromApple = (e) => new AccountError(e?.kind === 'network' || e?.kind === 'notAvailable' ? e.kind : 'failed');

/**
 * @param {{ apple: any, remote: any, box?: { read: () => any, write: (v: any) => void }, newId?: () => string, now?: () => number }} deps
 *   newId makes a fresh guest id (on iOS a UUID, to match the Keychain id StoreKit uses)
 */
export function createAccount({ apple, remote, box = localStorageBox, newId = randomId, now = Date.now }) {
  let s = box.read();
  if (!s || typeof s.id !== 'string') { s = { id: newId(), token: null, user: null, since: null }; box.write(s); }
  const listeners = new Set();
  const save = (patch) => { s = { ...s, ...patch }; box.write(s); listeners.forEach((fn) => fn(status())); };
  const status = () => ({ signedIn: !!s.token, since: s.since, id: s.id });
  const becomeGuest = () => save({ id: newId(), token: null, user: null, since: null });

  async function askApple(opts) {
    const rawNonce = randomId();
    let r;
    try { r = await apple.signIn({ nonce: await sha256Hex(rawNonce), ...opts }); }
    catch (e) { throw fromApple(e); }
    return { ...r, rawNonce };
  }

  return {
    simulated: !!(apple.simulated || remote.simulated),
    get id() { return s.id; },
    get appleUser() { return s.user; },
    status,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async signIn() {
      if (s.token) return { status: 'linked' };
      const a = await askApple({ purpose: 'signIn' });
      if (a.status === 'cancelled') return { status: 'cancelled' };
      let r;
      try { r = await remote.signIn({ identityToken: a.identityToken, rawNonce: a.rawNonce, accountId: s.id }); }
      catch (e) { throw fromRemote(e); }
      save({ id: r.accountId, token: r.token, user: a.user, since: now() });
      return { status: r.status };
    },

    signOut() { if (s.token) becomeGuest(); },

    async remove() {
      if (!s.token) throw new AccountError('sessionEnded');
      const a = await askApple({ purpose: 'confirm', user: s.user });
      if (a.status === 'cancelled') return { status: 'cancelled' };
      try { await remote.remove({ token: s.token, identityToken: a.identityToken, rawNonce: a.rawNonce, authorizationCode: a.authorizationCode }); }
      catch (e) {
        const err = fromRemote(e);
        if (err.kind === 'sessionEnded') becomeGuest();
        throw err;
      }
      becomeGuest();
      return { status: 'deleted' };
    },

    async check() {
      if (!s.token) return 'guest';
      try {
        const state = await apple.credentialState(s.user);
        if (state === 'revoked' || state === 'notFound') { becomeGuest(); return 'signedOut'; }
      } catch { /* can't tell; keep the session */ }
      try {
        const r = await remote.renew(s.token);
        save({ token: r.token });
        return 'signedIn';
      } catch (e) {
        if (e?.status === 401) { becomeGuest(); return 'signedOut'; }
        return 'offline'; // no connection or a server hiccup: nothing in the app waits on this
      }
    },

    dev: {
      revokeAtApple() { if (s.user) { apple.dev?.revoke(s.user); remote.dev?.appleEvent?.({ type: 'consent-revoked', sub: s.user }); } },
      reset() { apple.dev?.forget(); remote.dev?.forget(); becomeGuest(); },
    },
  };
}

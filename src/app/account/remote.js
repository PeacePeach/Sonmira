// The account service as the app sees it: our own endpoints in the iOS app,
// or, in web previews, the same server code running in the browser against a
// simulated Apple (clearly a development stand-in: anyone can edit it).
//
//   signIn({ identityToken, rawNonce, accountId }) → { status: 'linked' | 'returning', accountId, token }
//   renew(token)                                   → { accountId, token }
//   remove({ token, identityToken, rawNonce, authorizationCode }) → { deleted, revoked }
//
// Failures throw RemoteError { code, status }; status 0 means no connection.

import { createAccounts, AccountError } from '../../account/accounts.js';
import { createMemoryStore } from '../../account/stores.js';
import { randomId, sha256Hex } from '../../account/encoding.js';

export class RemoteError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export function createHttpRemote({ base = '', fetchImpl = (...a) => fetch(...a) } = {}) {
  async function post(path, body) {
    let r;
    try { r = await fetchImpl(`${base}/api/account/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new RemoteError('network', 0); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new RemoteError(data.error || 'server_error', r.status);
    return data;
  }
  return {
    simulated: false,
    signIn: (b) => post('apple', b),
    renew: (token) => post('session', { token }),
    remove: (b) => post('delete', b),
  };
}

const SIM_KEY = 'sonmira.sim.accounts';
const SIM_SECRET = 'development-simulation-only-not-a-real-secret';

/** Development only: the real account logic, in the browser, with a stand-in for Apple's signature check. */
export function createSimulatedRemote() {
  const store = createMemoryStore({ onChange: () => { try { localStorage.setItem(SIM_KEY, JSON.stringify(store.dump())); } catch {} } });
  try { store.load(JSON.parse(localStorage.getItem(SIM_KEY) || '{}')); } catch {}

  // Simulated identity tokens look like sim.<user>.<sha256(nonce)>.
  async function verifyIdentity(token, rawNonce) {
    const [p, sub, nonce] = String(token).split('.');
    if (p !== 'sim' || !sub) throw new Error('not a simulated token');
    if (rawNonce !== undefined && nonce !== await sha256Hex(rawNonce)) throw new Error('nonce');
    if (sub === 'sim-server-down') throw new AccountError('server_error', 503);
    return { sub };
  }
  const accounts = createAccounts({ store, secret: SIM_SECRET, verifyIdentity });

  const wrap = (fn) => async (...a) => {
    await new Promise((r) => setTimeout(r, 700)); // a network round trip, so the waiting state is visible
    try { return await fn(...a); }
    catch (e) { throw new RemoteError(e.code || 'server_error', e.status || 500); }
  };

  // "Already has an account": make sure that Apple ID belongs to someone else's id first.
  async function seedReturning() {
    const nonce = randomId();
    await accounts.signInWithApple({ identityToken: `sim.sim-returning.${await sha256Hex(nonce)}`, rawNonce: nonce, accountId: randomId() }).catch(() => {});
  }

  return {
    simulated: true,
    signIn: wrap(async (b) => { if (b.identityToken.startsWith('sim.sim-returning.')) await seedReturning(); return accounts.signInWithApple(b); }),
    renew: wrap((token) => accounts.renew(token)),
    remove: wrap((b) => accounts.deleteAccount(b)),
    dev: {
      appleEvent: (ev) => accounts.appleEvent(ev),
      forget() { try { localStorage.removeItem(SIM_KEY); } catch {} store.load({}); },
    },
  };
}

// Puts the server's parts together, once per function instance:
//
//   the generation guard (server/protect)  invitation seats, limits, spend cap, idempotency
//   the paintings ledger (server/billing)  free paintings, Daily Ritual, packs
//   the account service (src/account)      Sign in with Apple, one id per person
//
// They share one id (the install id: the app's Keychain UUID on iOS, the
// guard's install id in a browser) and one store, so:
//   - /api/generate counts a painting on that id's ledger only when it is made
//     (deps.charge), and refuses with 402 no_paintings when none is left;
//   - /api/billing/* answers only to a request holding that id's install token
//     (authorize), never to an id named in the body alone;
//   - /api/session gives a signed-in account a token for its own id;
//   - signing in moves the guest's seat and ledger to the account, deleting it
//     frees the seat and removes stored results (seats, ledger).

import { kvFromEnv } from './protect/kv.js';
import { createAuthorize, createSeats } from './protect/index.js';
import { createLedger } from './billing/ledger.js';
import { createCharge, billingMode } from './billing/charge.js';
import { billingFromEnv } from './billing/http.js';
import { buildFromEnv as buildAccounts } from '../src/account/deploy.js';

let cached = null;

export function wiring(env = process.env) {
  if (cached && cached.env === env) return cached;
  const kv = kvFromEnv(env);
  const ledger = kv ? createLedger({ kv }) : null;
  const authorize = createAuthorize({ env, kv });
  const seats = kv ? createSeats({ env, kv }) : null;
  let accounts;
  const account = () => {
    if (accounts === undefined) accounts = buildAccounts(env, { ledger: ledger && { merge: ledger.merge, erase: ledger.erase }, seats, authorize }) ?? null;
    return accounts;
  };
  cached = {
    env,
    kv,
    ledger,
    authorize,
    seats,
    account,
    /** protect('generate', …, deps): counts paintings when SONMIRA_BILLING is on (Production). */
    guard: () => ({ charge: ledger ? createCharge({ ledger, mode: billingMode(env) }) : null }),
    /** createSessionHandler(deps): a signed-in account gets a token for its own id. */
    session: () => ({ verifyAccount: async (token) => (await account()?.accounts.verifyAccount(token)) ?? null }),
    /** create*Handler(deps) in server/billing/http.js. */
    billing: () => ({ ...billingFromEnv(env), kv, ledger, authorize }),
  };
  return cached;
}

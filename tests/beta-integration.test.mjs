// The Beta server as one piece (server/wire.js): the generation guard, the
// paintings ledger and the account service sharing one id and one store.
// Real modules throughout; the paid call is a counting fake and Apple's
// signatures come from a test chain, so nothing here costs anything.
// Runs on the in-memory store and, when redis-server is installed, on Redis.
//
// Covers: unauthorized billing access, free paintings, Daily Ritual and
// packs spent by the guard, quota exhaustion, failed generations, retries
// and duplicate requests, duplicate transactions, account switching,
// account recovery on a new install, and account deletion.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { protect, createSessionHandler, createAuthorize, createSeats, memoryKV, redisKV } from '../server/protect/index.js';
import { createLedger } from '../server/billing/ledger.js';
import { createCharge } from '../server/billing/charge.js';
import { createAppleVerifier } from '../server/billing/apple.js';
import { createTransactionsHandler, createStatusHandler } from '../server/billing/http.js';
import { createAccounts } from '../src/account/accounts.js';
import { createMemoryStore } from '../src/account/stores.js';
import { testAppleChain } from './helpers/apple-sign.mjs';
import { hasRedis, startRedis } from './helpers/redis.mjs';

const chain = testAppleChain();
const SECRET = 'test-secret-0123456789abcdef0123456789';
const ACCOUNT_SECRET = 'account-secret-0123456789abcdef012345';
const ENV = {
  SONMIRA_TOKEN_SECRET: SECRET, SONMIRA_INVITE_CODES: 'MOON-RIVER-01, SUNNY-DAY-02', SONMIRA_DAILY_CAP_USD: '100',
  SONMIRA_LIMIT_GENERATE_HOUR: '100', SONMIRA_LIMIT_GENERATE_DAY: '100', SONMIRA_LIMIT_INVITE_GENERATE_DAY: '1000', SONMIRA_LIMIT_IP_HOUR: '1000', SONMIRA_LIMIT_SESSION_IP_HOUR: '1000',
};
const PACK = 'app.sonmira.little_moments.10';
const SUB = 'app.sonmira.daily_ritual.monthly';
const PHONE = '5b6f8c1e-3d2a-4c7b-9e0f-1a2b3c4d5e6f';
const DAY = 24 * 3600_000;
const id = () => randomUUID(); // the iOS app's Keychain ids are lowercase UUIDs

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.end = () => res;
  return res;
}
const call = async (handler, req) => { const res = fakeRes(); await handler({ headers: {}, ...req }, res); return res; };
const auth = (token) => (token ? { authorization: `Bearer ${token}` } : {});

function suite(name, makeKV) {
  describe(`beta server (${name})`, () => {
    async function setup({ cap } = {}) {
      const kv = await makeKV();
      const clock = { now: Date.now() };
      const now = () => clock.now;
      const env = { ...ENV, ...(cap ? { SONMIRA_DAILY_CAP_USD: cap } : {}) };
      const ledger = createLedger({ kv, now, sleep: async () => {} });
      const authorize = createAuthorize({ env, kv });
      const seats = createSeats({ env, kv, now });
      const accounts = createAccounts({
        store: createMemoryStore(), secret: ACCOUNT_SECRET, now,
        verifyIdentity: async (token) => ({ sub: token }), // the Apple user, for the test
        revokeApple: async () => ({ revoked: true }),
        ledger: { merge: ledger.merge, erase: ledger.erase }, seats,
      });
      const log = () => {};
      const session = createSessionHandler({ env, kv, now, log, verifyAccount: (t) => accounts.verifyAccount(t) });
      const day = () => new Date(clock.now).toISOString().slice(0, 10);

      // The paid handler: counts would-be provider calls; `fail` makes the next ones fail.
      const paid = { calls: 0, fail: null };
      const generate = protect('generate', async (_req, res) => {
        paid.calls += 1;
        if (paid.fail === 'throw') throw new Error('provider crashed');
        if (paid.fail) return res.status(paid.fail).json({ ok: false, code: 'provider_error' });
        res.status(200).json({ ok: true, image: 'data:image/jpeg;base64,QUJD' });
      }, { env, kv, now, log, charge: createCharge({ ledger, mode: 'on', now }) });

      const billingDeps = { ledger, log, authorize, limit: async () => true, verifier: createAppleVerifier({ bundleId: 'app.sonmira', roots: [chain.rootFingerprint] }) };
      const transactions = createTransactionsHandler(billingDeps);
      const statusHandler = createStatusHandler(billingDeps);

      const join = async (installId, invite = 'MOON-RIVER-01') => (await call(session, { method: 'POST', body: { invite, installId } })).body;
      const accountSession = async (installId, accountToken) => (await call(session, { method: 'POST', body: { accountToken, installId } })).body;
      const paint = (token, key) => call(generate, { method: 'POST', body: { spec: {} }, headers: { ...auth(token), 'idempotency-key': key, 'x-sonmira-day': day() } });
      const status = (token, account) => call(statusHandler, { method: 'GET', query: { account, day: day() }, headers: auth(token) });
      const left = async (account) => (await ledger.status(account, day()));
      let seq = 5000;
      const tx = (account, o = {}) => {
        const n = String(++seq), sub = (o.productId ?? PACK) === SUB, nonce = randomUUID();
        return chain.sign({
          transactionId: n, originalTransactionId: n, bundleId: 'app.sonmira', productId: PACK, purchaseDate: clock.now, originalPurchaseDate: clock.now, quantity: 1,
          type: sub ? 'Auto-Renewable Subscription' : 'Consumable', inAppOwnershipType: 'PURCHASED', signedDate: clock.now, environment: 'Sandbox',
          transactionReason: 'PURCHASE', storefront: 'USA', storefrontId: '143441', appAccountToken: account,
          deviceVerificationNonce: nonce, deviceVerification: createHash('sha384').update(nonce + PHONE).digest('base64'),
          ...(sub ? { expiresDate: clock.now + 30 * DAY, subscriptionGroupIdentifier: '21000000' } : {}), ...o,
        });
      };
      const buy = (token, account, jws) => call(transactions, { method: 'POST', body: { account, transactions: [jws], day: day(), device: PHONE }, headers: auth(token) });
      return { kv, clock, ledger, accounts, paid, join, accountSession, paint, status, left, tx, buy, seats };
    }

    test('billing answers only to the install token of the account it names', async () => {
      const s = await setup();
      const a = id(), b = id();
      const ta = (await s.join(a)).token, tb = (await s.join(b)).token;
      assert.equal((await s.status(null, a)).statusCode, 401);
      assert.equal((await s.status(tb, a)).statusCode, 401); // someone else's token
      const [v, body, sig] = ta.split('.'); // forged: the signature's first byte changed
      assert.equal((await s.status(`${v}.${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`, a)).statusCode, 401);
      assert.equal((await s.status(ta, a)).statusCode, 200);
      // A purchase can't be posted, read or restored for another account.
      assert.equal((await s.buy(tb, a, s.tx(a))).statusCode, 401);
      assert.equal((await s.buy(null, a, s.tx(a))).statusCode, 401);
      assert.equal((await s.left(a)).credits, 0);
      // An upper-case twin of a UUID never gets a token of its own.
      assert.equal((await s.join(a.toUpperCase())).code, 'bad_install');
    });

    test('three free paintings, then 402 no_paintings with no paid call', async () => {
      const s = await setup();
      const a = id(), t = (await s.join(a)).token;
      for (let i = 1; i <= 3; i++) assert.equal((await s.paint(t, `take-${i}.generate`)).statusCode, 200);
      const r = await s.paint(t, 'take-4.generate');
      assert.equal(r.statusCode, 402);
      assert.equal(r.body.code, 'no_paintings');
      assert.equal(s.paid.calls, 3);
      assert.equal((await s.left(a)).free, 0);
    });

    test('failed generations never use a painting', async () => {
      const s = await setup({ cap: '0.3' }); // two images a day
      const a = id(), t = (await s.join(a)).token;
      s.paid.fail = 502;
      assert.equal((await s.paint(t, 'take-1.generate')).statusCode, 502);
      s.paid.fail = 'throw';
      assert.equal((await s.paint(t, 'take-2.generate')).statusCode, 500);
      assert.equal((await s.left(a)).free, 3);
      // The two failures kept their (possibly billed) reservations: the cap is reached.
      s.paid.fail = null;
      const capped = await s.paint(t, 'take-3.generate');
      assert.equal(capped.body.code, 'spend_cap');
      assert.equal((await s.left(a)).free, 3);
      assert.equal(s.paid.calls, 2);
    });

    test('retries and duplicate requests count one painting once', async () => {
      const s = await setup();
      const a = id(), t = (await s.join(a)).token;
      // A failure, then the retry with the same key succeeds: one painting.
      s.paid.fail = 502;
      await s.paint(t, 'take-1.generate');
      s.paid.fail = null;
      assert.equal((await s.paint(t, 'take-1.generate')).statusCode, 200);
      assert.equal((await s.left(a)).free, 2);
      // The same key again: the stored painting, no paid call, nothing counted.
      const replay = await s.paint(t, 'take-1.generate');
      assert.equal(replay.headers['x-sonmira-replay'], '1');
      assert.equal(s.paid.calls, 2);
      assert.equal((await s.left(a)).free, 2);
      // Two at once with one key: one paid call, one painting.
      const both = await Promise.all([s.paint(t, 'take-2.generate'), s.paint(t, 'take-2.generate')]);
      assert.deepEqual(both.map((r) => r.statusCode).sort(), [200, 409]);
      assert.equal((await s.left(a)).free, 1);
      // After the stored result expires, the same key paints again but is not counted again.
      s.clock.now += 25 * 3600_000;
      assert.equal((await s.paint(t, 'take-1.generate')).statusCode, 200);
      assert.equal((await s.left(a)).free, 1);
    });

    test('Daily Ritual first, then free paintings, then pack credits; a pack is granted once', async () => {
      const s = await setup();
      const a = id(), t = (await s.join(a)).token;
      const pack = s.tx(a);
      assert.equal((await s.buy(t, a, pack)).body.results[0].effect, 'granted');
      assert.equal((await s.buy(t, a, pack)).body.results[0].effect, 'already_granted'); // the same transaction again
      const b = id(), tb = (await s.join(b)).token;
      // Sent from another account, it still belongs to the account Apple signed it for.
      assert.equal((await s.buy(tb, b, pack)).body.results[0].effect, 'already_granted');
      assert.equal((await s.left(b)).credits, 0);
      assert.equal((await s.buy(t, a, s.tx(a, { productId: SUB }))).statusCode, 200);
      const before = await s.left(a);
      assert.equal(before.credits, 10);
      await s.paint(t, 'take-d1.generate'); // today's Daily Ritual painting
      let now = await s.left(a);
      assert.equal(now.free, before.free);
      assert.equal(now.credits, 10);
      for (let i = 0; i < 3; i++) await s.paint(t, `take-f${i}.generate`); // the free ones
      await s.paint(t, 'take-c1.generate'); // then a pack credit
      now = await s.left(a);
      assert.equal(now.free, 0);
      assert.equal(now.credits, 9);
      assert.equal(s.paid.calls, 5);
    });

    test('signing in on a second phone moves its seat and ledger to the account; deletion ends both', async () => {
      const s = await setup();
      // Phone 1: a guest joins, buys a pack, paints once, signs in with Apple (linked).
      const g1 = id(), t1 = (await s.join(g1)).token;
      await s.buy(t1, g1, s.tx(g1));
      await s.paint(t1, 'p1-take-1.generate');
      const linked = await s.accounts.signInWithApple({ identityToken: 'apple-user-1', accountId: g1 });
      assert.equal(linked.status, 'linked');
      assert.equal(linked.accountId, g1);

      // Phone 2: another guest joins on another code and paints once, then signs in to the same Apple ID.
      const g2 = id(), t2 = (await s.join(g2, 'SUNNY-DAY-02')).token;
      await s.paint(t2, 'p2-take-1.generate');
      const back = await s.accounts.signInWithApple({ identityToken: 'apple-user-1', accountId: g2 });
      assert.equal(back.status, 'returning');
      assert.equal(back.accountId, g1);
      // The guest's own token ends: its seat was given back.
      assert.equal((await s.paint(t2, 'p2-take-2.generate')).body.code, 'invite_required');
      assert.equal((await s.status(t2, g2)).statusCode, 401);
      // Phone 2 now paints as the account, with no new invitation code.
      assert.equal((await s.accountSession(g2, back.token)).code, 'invite_required'); // not its own id
      const ta = (await s.accountSession(g1, back.token)).token;
      assert.ok(ta);
      assert.equal((await s.paint(ta, 'p2-take-3.generate')).statusCode, 200);
      // One wallet: phone 1's pack, both phones' paintings, the lower free count.
      const w = await s.left(g1);
      assert.equal(w.credits, 10);
      assert.equal(w.free, 1);
      assert.equal((await s.status(ta, g1)).body.status.credits, 10);

      // Delete the account: the ledger, the seats and the stored paintings go.
      await s.accounts.deleteAccount({ token: back.token, identityToken: 'apple-user-1' });
      assert.equal((await s.paint(ta, 'p2-take-4.generate')).body.code, 'invite_required');
      assert.equal((await s.paint(t1, 'p1-take-2.generate')).body.code, 'invite_required');
      assert.equal((await s.status(ta, g1)).statusCode, 401);
      assert.equal(await s.kv.get(`idem:generate:${g1}:p2-take-3.generate`), null);
      assert.equal((await s.accountSession(g1, back.token)).code, 'invite_required');
    });

    test('a returning account on a fresh install recovers its paintings without a code', async () => {
      const s = await setup();
      const a = id(), t = (await s.join(a)).token;
      await s.buy(t, a, s.tx(a));
      await s.accounts.signInWithApple({ identityToken: 'apple-user-2', accountId: a });
      // Reinstall without iCloud Keychain: a new guest id with no seat and no token.
      const fresh = id();
      const back = await s.accounts.signInWithApple({ identityToken: 'apple-user-2', accountId: fresh });
      assert.equal(back.accountId, a);
      const ta = (await s.accountSession(a, back.token)).token;
      assert.equal((await s.paint(ta, 'r-take-1.generate')).statusCode, 200);
      assert.equal((await s.left(a)).credits, 10);
      // Signing out leaves a fresh guest, who needs a code again.
      assert.equal((await s.accountSession(id(), back.token)).code, 'invite_required');
    });
  });
}

suite('memory', async () => memoryKV());

if (hasRedis()) {
  let redis, n = 0;
  before(async () => { redis = await startRedis(); });
  after(() => redis?.stop());
  suite('redis', async () => redisKV(redis.exec, { prefix: `b${++n}:` }));
}

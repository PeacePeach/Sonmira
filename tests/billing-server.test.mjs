// Server-side billing: Apple-signed transactions grant paintings once, the
// generation guard's charge step spends them once, and refunds, renewals,
// expiry and Restore Purchases keep the ledger right. No network: a test
// signing chain stands in for Apple's. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { testAppleChain } from './helpers/apple-sign.mjs';
import { memoryKV } from '../server/billing/kv.js';
import { createLedger } from '../server/billing/ledger.js';
import { createAppleVerifier } from '../server/billing/apple.js';
import { createCharge } from '../server/billing/charge.js';
import { createTransactionsHandler, createStatusHandler, createNotificationsHandler } from '../server/billing/http.js';

const chain = testAppleChain();
const PACK = 'app.sonmira.little_moments.10';
const SUB = 'app.sonmira.daily_ritual.monthly';
const A = '0e1c6a4e-2b8a-4a8e-9b1d-3f0b0f8f8f8f';
const B = '7d3f1b52-91c4-4f0e-8a77-2c9e5d1a6b30';
const DAY = 24 * 3600_000;
// The test chain's certificates start now, so the clock starts now too.
const START = Date.now();
const dayAt = (n) => new Date(START + n * DAY).toISOString().slice(0, 10);

function setup({ allowXcode = false } = {}) {
  const clock = { now: START };
  const now = () => clock.now;
  const kv = memoryKV({ now });
  const ledger = createLedger({ kv, now, sleep: async () => {} });
  const verifier = createAppleVerifier({ bundleId: 'app.sonmira', roots: [chain.rootFingerprint], allowXcode });
  const deps = { ledger, verifier, log: () => {} };
  const call = async (handler, req) => {
    const res = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ headers: {}, ...req }, res);
    return res;
  };
  const post = (b) => call(createTransactionsHandler(deps), { method: 'POST', body: b });
  const notify = (payload) => call(createNotificationsHandler(deps), { method: 'POST', body: { signedPayload: payload } });
  const status = async (account, day = dayAt(0)) => (await call(createStatusHandler(deps), { method: 'GET', query: { account, day } })).body.status;
  let seq = 1000;
  const tx = (o = {}) => {
    const id = String(++seq);
    const sub = (o.productId ?? PACK) === SUB;
    return {
      transactionId: id, originalTransactionId: id, bundleId: 'app.sonmira', productId: PACK,
      purchaseDate: clock.now, originalPurchaseDate: clock.now, quantity: 1,
      type: sub ? 'Auto-Renewable Subscription' : 'Consumable', inAppOwnershipType: 'PURCHASED',
      signedDate: clock.now, environment: 'Sandbox', transactionReason: 'PURCHASE', storefront: 'USA', storefrontId: '143441',
      appAccountToken: A, ...(sub ? { expiresDate: clock.now + 30 * DAY, subscriptionGroupIdentifier: '21000000' } : {}), ...o,
    };
  };
  const note = (type, { transaction, renewal, subtype } = {}) => chain.sign({
    notificationType: type, ...(subtype ? { subtype } : {}), notificationUUID: `n-${++seq}`, version: '2.0', signedDate: clock.now,
    data: { bundleId: 'app.sonmira', environment: 'Sandbox', ...(transaction ? { signedTransactionInfo: chain.sign(transaction) } : {}), ...(renewal ? { signedRenewalInfo: chain.sign(renewal) } : {}) },
  });
  const charge = createCharge({ ledger, mode: 'on', now });
  const paint = async (account, key, day = dayAt(0)) => {
    const r = await charge.reserve({ installId: account, key, endpoint: 'generate', req: { headers: { 'x-sonmira-day': day } } });
    if (r.ok && r.counted) await charge.settle({ installId: account, key, outcome: 'commit' });
    return r;
  };
  return { clock, kv, ledger, verifier, post, notify, status, tx, note, charge, paint };
}

test('a pack is granted once, however often its transaction arrives', async () => {
  const s = setup();
  const t = chain.sign(s.tx());
  const r1 = await s.post({ account: A, transactions: [t] });
  assert.equal(r1.code, 200);
  assert.equal(r1.body.results[0].effect, 'granted');
  const r2 = await s.post({ account: A, transactions: [t, t], restore: true });
  assert.deepEqual(r2.body.results.map((r) => r.effect), ['already_granted', 'already_granted']);
  assert.equal((await s.status(A)).credits, 10);
});

test('the purchase goes to the account Apple signed for, not to whoever sends it', async () => {
  const s = setup();
  await s.post({ account: B, transactions: [chain.sign(s.tx({ appAccountToken: A }))] });
  assert.equal((await s.status(A)).credits, 10);
  assert.equal((await s.status(B)).credits, 0);
});

test('forged, tampered, other-app and Xcode transactions grant nothing', async () => {
  const s = setup();
  const good = chain.sign(s.tx());
  const [h, , sig] = good.split('.');
  const tampered = [h, Buffer.from(JSON.stringify(s.tx({ productId: SUB }))).toString('base64url'), sig].join('.');
  const otherApp = chain.sign(s.tx({ bundleId: 'com.example.other' }));
  const xcode = chain.unsigned(s.tx({ environment: 'Xcode' }));
  const untrusted = createAppleVerifier({ bundleId: 'app.sonmira' }); // Apple's real root only
  await assert.rejects(untrusted.transaction(good), { code: 'untrusted_root' });
  const r = await s.post({ account: A, transactions: [tampered, otherApp, xcode, 'not-a-jws'] });
  assert.deepEqual(r.body.results.map((x) => x.ok), [false, false, false, false]);
  assert.equal(r.body.results[2].code, 'xcode_not_allowed');
  assert.equal((await s.status(A)).credits, 0);
});

test('Xcode StoreKit testing works only where allowed', async () => {
  const s = setup({ allowXcode: true });
  const r = await s.post({ account: A, transactions: [chain.unsigned(s.tx({ environment: 'Xcode' }))] });
  assert.equal(r.body.results[0].effect, 'granted');
});

test('three free paintings, then credits; only successful paintings count, each take once', async () => {
  const s = setup();
  for (const k of ['t1.generate', 't2.generate', 't3.generate']) assert.equal((await s.paint(A, k)).source, 'free');
  assert.deepEqual(await s.paint(A, 't4.generate'), { ok: false, status: 402, code: 'no_paintings' });

  await s.post({ account: A, transactions: [chain.sign(s.tx())] });
  // A failed generation hands its painting back.
  const r = await s.charge.reserve({ installId: A, key: 'f.generate', endpoint: 'generate', req: { headers: {} } });
  assert.equal(r.source, 'credits');
  await s.charge.settle({ installId: A, key: 'f.generate', outcome: 'release' });
  assert.equal((await s.status(A)).credits, 10);
  // The same take reserved again after it was counted is not counted again.
  await s.paint(A, 't5.generate');
  await s.paint(A, 't5.generate');
  assert.equal((await s.status(A)).credits, 9);
});

test('two requests racing for the last painting: one wins', async () => {
  const s = setup();
  await s.paint(A, 'a.generate'); await s.paint(A, 'b.generate');
  const results = await Promise.all(['c.generate', 'd.generate'].map((key) => s.charge.reserve({ installId: A, key, endpoint: 'generate', req: { headers: {} } })));
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
});

test('a painting held by a function that died is handed back after a while', async () => {
  const s = setup();
  await s.paint(A, 'a.generate'); await s.paint(A, 'b.generate');
  assert.equal((await s.charge.reserve({ installId: A, key: 'c.generate', endpoint: 'generate', req: { headers: {} } })).ok, true);
  assert.equal((await s.status(A)).canCreate, false);
  s.clock.now += 4 * 60_000;
  assert.equal((await s.status(A)).free, 1);
});

test('every install is counted alike when billing is on; nobody when it is off', async () => {
  const s = setup();
  const web = 'i0123456789abcdef0123456789abcdef';
  assert.equal((await s.paint(web, 'w1.generate')).source, 'free', 'an id the client picks gets no way around paying');
  const off = createCharge({ ledger: s.ledger, mode: 'off', now: () => s.clock.now });
  assert.equal((await off.reserve({ installId: A, key: 'x.generate', endpoint: 'generate', req: { headers: {} } })).counted, false);
  const understand = await s.charge.reserve({ installId: A, key: 'u.understand', endpoint: 'understand' });
  assert.equal(understand.counted, false, 'only paintings are counted');
});

test('Daily Ritual: one painting per local day, renewals extend, expiry ends it', async () => {
  const s = setup();
  const first = s.tx({ productId: SUB });
  await s.post({ account: A, transactions: [chain.sign(first)] });
  assert.equal((await s.paint(A, 'd1.generate')).source, 'daily');
  assert.equal((await s.paint(A, 'd2.generate')).source, 'free', 'second painting today comes from elsewhere');
  s.clock.now += DAY;
  assert.equal((await s.paint(A, 'd3.generate', dayAt(1))).source, 'daily', 'a new day, a new painting');
  // A day no time zone is in right now isn't believed, and a used day never reopens.
  assert.equal((await s.paint(A, 'd4.generate', dayAt(70))).source, 'free');
  assert.notEqual(await s.ledger.reserve(A, 'd5.generate', dayAt(0)), 'daily', 'yesterday is not reopened');
  await s.ledger.release('d5.generate', A);

  // Renewal (Apple notification) with a later expiry; an older transaction arriving late doesn't shorten it.
  s.clock.now += 29 * DAY;
  const renewal = s.tx({ productId: SUB, originalTransactionId: first.originalTransactionId, appAccountToken: undefined, expiresDate: s.clock.now + 30 * DAY });
  assert.equal((await s.notify(s.note('DID_RENEW', { transaction: renewal }))).code, 200);
  await s.post({ account: A, transactions: [chain.sign(first)] });
  const st = await s.status(A, dayAt(30));
  assert.equal(st.subscribed, true);
  assert.equal(st.sub.expiresAt, renewal.expiresDate);

  // Turned off: active to the end of the period, then over.
  await s.notify(s.note('DID_CHANGE_RENEWAL_STATUS', { subtype: 'AUTO_RENEW_DISABLED', renewal: { originalTransactionId: first.originalTransactionId, autoRenewProductId: SUB, productId: SUB, autoRenewStatus: 0, signedDate: s.clock.now, environment: 'Sandbox' } }));
  assert.equal((await s.status(A, dayAt(30))).sub.willRenew, false);
  s.clock.now += 31 * DAY;
  const ended = await s.status(A, dayAt(61));
  assert.equal(ended.subscribed, false);
  assert.equal(ended.source, 'free', 'back to what is left: one free painting');
});

test('a billing grace period keeps Daily Ritual going while Apple retries', async () => {
  const s = setup();
  const t = s.tx({ productId: SUB });
  await s.post({ account: A, transactions: [chain.sign(t)] });
  s.clock.now = t.expiresDate + 3600_000;
  await s.notify(s.note('DID_FAIL_TO_RENEW', { subtype: 'GRACE_PERIOD', renewal: { originalTransactionId: t.originalTransactionId, autoRenewProductId: SUB, productId: SUB, autoRenewStatus: 1, gracePeriodExpiresDate: s.clock.now + 6 * DAY, isInBillingRetryPeriod: true, signedDate: s.clock.now, environment: 'Sandbox' } }));
  assert.equal((await s.status(A, dayAt(30))).subscribed, true);
});

test('refunds: credits and Daily Ritual are taken back, and an old transaction cannot undo it', async () => {
  const s = setup();
  const pack = s.tx();
  const sub = s.tx({ productId: SUB });
  await s.post({ account: A, transactions: [chain.sign(pack), chain.sign(sub)] });
  await s.paint(A, 'p1.generate'); // daily
  for (const k of ['f1', 'f2', 'f3', 'c1']) await s.paint(A, `${k}.generate`);
  assert.equal((await s.status(A)).credits, 9);

  await s.notify(s.note('REFUND', { transaction: { ...pack, revocationDate: s.clock.now, revocationReason: 0 } }));
  await s.notify(s.note('REFUND', { transaction: { ...sub, revocationDate: s.clock.now, revocationReason: 0 } }));
  let st = await s.status(A);
  assert.equal(st.credits, 0, 'never below zero');
  assert.equal(st.subscribed, false);

  // The app (or anyone holding them) sends the pre-refund transactions again.
  await s.post({ account: A, transactions: [chain.sign(pack), chain.sign(sub)], restore: true });
  st = await s.status(A);
  assert.equal(st.credits, 0);
  assert.equal(st.subscribed, false);

  // Apple reverses the pack's refund.
  await s.notify(s.note('REFUND_REVERSED', { transaction: pack }));
  assert.equal((await s.status(A)).credits, 9);
});

test('Restore Purchases on a new install brings credits back, never the free paintings', async () => {
  const s = setup();
  for (const k of ['a', 'b', 'c']) await s.paint(A, `${k}.generate`);
  const pack = s.tx({ appAccountToken: A });
  await s.post({ account: A, transactions: [chain.sign(pack)] });
  await s.paint(A, 'd.generate');

  // Reinstalled without iCloud Keychain: a new id, B, with three "new" free paintings.
  assert.equal((await s.status(B)).free, 3);
  const r = await s.post({ account: B, transactions: [chain.sign(pack)], restore: true });
  assert.equal(r.body.status.credits, 9);
  assert.equal(r.body.status.free, 0);
  // The old id now leads to the same ledger.
  assert.equal((await s.status(A)).account, B);
  assert.equal((await s.paint(A, 'e.generate')).source, 'credits');
  assert.equal((await s.status(B)).credits, 8);
});

test('account deletion erases the ledger', async () => {
  const s = setup();
  await s.post({ account: A, transactions: [chain.sign(s.tx())] });
  await s.ledger.erase(A);
  const st = await s.status(A);
  assert.equal(st.credits, 0);
  assert.equal(st.free, 3);
});

test('notifications Sonmira cannot use are still acknowledged; bad signatures are not', async () => {
  const s = setup();
  assert.equal((await s.notify(s.note('TEST'))).code, 200);
  assert.equal((await s.notify(s.note('ONE_TIME_CHARGE', { transaction: s.tx({ productId: 'app.sonmira.unknown' }) }))).code, 200);
  assert.equal((await s.notify('nope')).code, 400);
});

test('bad requests', async () => {
  const s = setup();
  assert.equal((await s.post({ account: 'nope', transactions: [] })).code, 400);
  const h = createTransactionsHandler({ ledger: null, verifier: s.verifier });
  const res = { status(c) { this.code = c; return this; }, json() { return this; }, setHeader() {} };
  await h({ method: 'POST', body: { account: A } }, res);
  assert.equal(res.code, 503, 'no store, no ledger');
});

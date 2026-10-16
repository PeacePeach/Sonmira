// The app's billing with the App Store behind it (iOS): a fake StoreKit plugin
// and a fake billing server stand in for Apple and api/billing. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilling } from '../src/app/billing/index.js';
import { createNativeStore } from '../src/app/billing/native-store.js';

const PACK = 'app.sonmira.little_moments.10';
const SUB = 'app.sonmira.daily_ritual.monthly';
const ACCOUNT = '0E1C6A4E-2B8A-4A8E-9B1D-3F0B0F8F8F8F';

const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};

function fakePlugin() {
  const listeners = [];
  const p = {
    finished: [], purchases: [], next: { status: 'success' }, past: [], sub: null, syncError: null,
    id: ACCOUNT,
    accountId: async () => ({ id: p.id }),
    deviceId: async () => ({ id: '5b6f8c1e-3d2a-4c7b-9e0f-1a2b3c4d5e6f' }),
    setAccountId: async ({ id }) => ({ id: (p.id = id) }),
    resetAccountId: async () => ({ id: (p.id = '11111111-2222-4333-8444-555555555555') }),
    products: async ({ ids }) => ({ products: ids.map((id) => ({ id, displayPrice: id === PACK ? '¥450' : '¥750' })) }),
    async purchase({ productId, appAccountToken }) {
      p.purchases.push({ productId, appAccountToken });
      if (p.next.error) throw Object.assign(new Error(p.next.error), { code: p.next.error });
      if (p.next.status !== 'success') return { status: p.next.status };
      return { status: 'success', transaction: { id: `t${p.purchases.length}`, originalId: `t${p.purchases.length}`, productId, jws: `jws-${productId}-${p.purchases.length}`, expiresAt: productId === SUB ? Date.now() + 30 * 864e5 : null } };
    },
    finish: async ({ transactionId }) => { p.finished.push(transactionId); },
    sync: async () => { if (p.syncError) throw Object.assign(new Error('x'), { code: p.syncError }); },
    history: async () => ({ transactions: p.past }),
    currentSubscription: async () => p.sub ?? {},
    manageSubscriptions: async () => {},
    addListener: (event, fn) => { listeners.push(fn); return Promise.resolve({ remove() {} }); },
    deliver: async (t) => { for (const fn of listeners) await fn(t); },
  };
  return p;
}

// A server that grants what it's sent, once per JWS, and can be unreachable.
function fakeServer() {
  const ledger = { v: 1, free: 3, credits: 0, sub: null, dailyUsed: null, holds: {}, spent: {}, granted: {}, revoked: {}, purchased: false };
  const s = {
    down: false, sent: [],
    async send(req) {
      s.sent.push(req);
      if (s.down) throw Object.assign(new Error('offline'), { code: 'network' });
      for (const jws of req.transactions) {
        if (jws.includes(PACK) && !ledger.granted[jws]) { ledger.granted[jws] = 10; ledger.credits += 10; ledger.purchased = true; }
        if (jws.includes(SUB)) { ledger.sub = { productId: SUB, expiresAt: Date.now() + 30 * 864e5, willRenew: true }; ledger.purchased = true; }
      }
      return { ok: true, status: { wallet: structuredClone(ledger) } };
    },
    async status() { if (s.down) throw new Error('offline'); return { wallet: structuredClone(ledger) }; },
  };
  return s;
}

const make = (plugin, server) => {
  const b = createBilling({ ask: () => { throw new Error('the simulator must not appear in the app'); }, native: createNativeStore(plugin), server });
  return b;
};

test.beforeEach(() => memory.clear());

test('a pack: Apple sheet, the server records it, then the transaction is finished', async () => {
  const plugin = fakePlugin(), server = fakeServer();
  const b = make(plugin, server);
  await b.ready;
  assert.equal(b.simulated, false);
  assert.equal(b.price(PACK), '¥450', 'the store’s localized price');
  assert.equal(await b.accountId(), ACCOUNT.toLowerCase());

  const r = await b.purchase(PACK);
  assert.equal(r.status, 'success');
  assert.equal(plugin.purchases[0].appAccountToken, ACCOUNT.toLowerCase(), 'purchase carries the account id');
  assert.deepEqual(server.sent.at(-1).transactions, [`jws-${PACK}-1`]);
  assert.deepEqual(plugin.finished, ['t1']);
  assert.equal(b.status().credits, 10);
});

test('paid while the server is unreachable: shown at once, finished only once recorded, never doubled', async () => {
  const plugin = fakePlugin(), server = fakeServer();
  server.down = true;
  const b = make(plugin, server);
  await b.ready;
  await b.purchase(PACK);
  assert.equal(b.status().credits, 10, 'the person sees their paintings');
  assert.deepEqual(plugin.finished, [], 'not finished: StoreKit will deliver it again');

  // Next launch: StoreKit re-delivers the unfinished transaction.
  server.down = false;
  const plugin2 = fakePlugin(); plugin2.purchases = plugin.purchases;
  const b2 = make(plugin2, server);
  await b2.ready;
  await plugin2.deliver({ id: 't1', originalId: 't1', productId: PACK, jws: `jws-${PACK}-1` });
  assert.deepEqual(plugin2.finished, ['t1']);
  assert.equal(b2.status().credits, 10);
});

test('cancel, pending, and an Ask to Buy approval arriving later', async () => {
  const plugin = fakePlugin(), server = fakeServer();
  const b = make(plugin, server);
  await b.ready;
  plugin.next = { status: 'userCancelled' };
  assert.equal((await b.purchase(PACK)).status, 'cancelled');
  plugin.next = { error: 'userCancelled' };
  assert.equal((await b.purchase(PACK)).status, 'cancelled');
  plugin.next = { status: 'pending' };
  assert.equal((await b.purchase(SUB)).status, 'pending');

  const events = [];
  b.onChange((e) => events.push(e));
  await plugin.deliver({ id: 's1', originalId: 's1', productId: SUB, jws: `jws-${SUB}-approved`, expiresAt: Date.now() + 30 * 864e5 });
  assert.equal(events.find((e) => e.type === 'transaction')?.product?.id, SUB, 'approval announced');
  assert.equal(b.status().subscribed, true);

  // A monthly renewal arriving while the app is open is applied quietly.
  events.length = 0;
  await plugin.deliver({ id: 's2', originalId: 's1', productId: SUB, jws: `jws-${SUB}-renewal`, expiresAt: Date.now() + 60 * 864e5 });
  assert.equal(events.find((e) => e.type === 'transaction').product, null);
  assert.deepEqual(plugin.finished, ['s1', 's2']);
});

test('store errors keep the paywall’s calm messages', async () => {
  const plugin = fakePlugin();
  const b = make(plugin, fakeServer());
  for (const code of ['network', 'notAllowed', 'failed', 'somethingElse']) {
    plugin.next = { error: code };
    await assert.rejects(b.purchase(PACK), { kind: code === 'somethingElse' ? 'failed' : code });
  }
});

test('Restore Purchases sends the whole history to the server', async () => {
  const plugin = fakePlugin(), server = fakeServer();
  plugin.past = [`jws-${PACK}-old`, `jws-${SUB}-old`];
  const b = make(plugin, server);
  await b.ready;
  const r = await b.restore();
  assert.deepEqual(r, { subscription: true, credits: 10 });
  const req = server.sent.at(-1);
  assert.equal(req.restore, true);
  assert.equal(req.device, '5b6f8c1e-3d2a-4c7b-9e0f-1a2b3c4d5e6f', 'proves the history is this phone’s');
  assert.deepEqual(req.transactions, plugin.past);

  plugin.syncError = 'userCancelled';
  await assert.rejects(b.restore(), { kind: 'userCancelled' });
  plugin.syncError = null; server.down = true;
  await assert.rejects(b.restore(), { kind: 'network' });
});

test('Daily Ritual from StoreKit reaches the server on launch; Manage opens Apple’s settings', async () => {
  const plugin = fakePlugin(), server = fakeServer();
  plugin.sub = { productId: SUB, expiresAt: Date.now() + 864e5, willRenew: false, jws: `jws-${SUB}-current`, renewalJws: 'renewal' };
  const b = make(plugin, server);
  await b.ready;
  assert.deepEqual(server.sent[0].transactions, [`jws-${SUB}-current`]);
  assert.deepEqual(server.sent[0].renewals, ['renewal']);
  assert.equal(b.status().subscribed, true);
  assert.equal(typeof b.manageSubscriptions, 'function');
});

test('a new account after sign-in: purchases carry it and the wallet follows its ledger', async () => {
  const plugin = fakePlugin(), server = fakeServer();
  const b = make(plugin, server);
  await b.ready;
  const other = '7d3f1b52-91c4-4f0e-8a77-2c9e5d1a6b30';
  await b.useAccount(other);
  assert.equal(await b.accountId(), other);
  await b.purchase(PACK);
  assert.equal(plugin.purchases.at(-1).appAccountToken, other);
  assert.equal(server.sent.at(-1).account, other);

  // Sign-out: a fresh guest id, kept in the Keychain and used from then on.
  const guest = await b.resetAccountId();
  assert.equal(guest, plugin.id);
  assert.equal(await b.accountId(), guest);
  assert.equal(await b.setAccountId(other), other);
  assert.equal(plugin.id, other);
});

test('in a browser the simulator stays', async () => {
  const b = createBilling({ ask: async () => 'success' });
  assert.equal(b.simulated, true);
  assert.equal(await b.accountId(), null);
  assert.equal(b.manageSubscriptions, null);
  globalThis.location = { reload() {} };
});

test('on the released site a browser cannot buy; previews keep the simulator', async () => {
  globalThis.location = { hostname: 'sonmira.vercel.app', reload() {} };
  try {
    const b = createBilling({ ask: () => { throw new Error('no simulator on the released site'); } });
    assert.equal(b.simulated, false);
    await assert.rejects(b.purchase(PACK), { kind: 'appOnly' });
    await assert.rejects(b.restore(), { kind: 'appOnly' });
    assert.equal(b.status().free, 3, 'the free paintings are still there');
    globalThis.location = { hostname: 'sonmira-git-claude-storekit-iap-18jb4y-zizibittergourd-9441.vercel.app', reload() {} };
    assert.equal(createBilling({ ask: async () => 'success' }).simulated, true);
  } finally { globalThis.location = { reload() {} }; }
});

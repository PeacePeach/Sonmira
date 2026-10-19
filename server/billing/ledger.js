// The paintings ledger: the server's copy of the wallet, one per account,
// which is the truth for what someone may paint. The rules are the app's own
// (src/app/billing/wallet.js: today's Daily Ritual painting → free → credits,
// reserve / commit / release per take key), run here under a per-account lock.
//
// Keys (all under the store's prefix):
//   bill:acct:<id>    the wallet state (JSON)
//   bill:subs:<id>    Daily Ritual transactions seen: expiry, refunds, renewal
//   bill:otid:<otid>  which account an Apple subscription belongs to
//   bill:txid:<txid>  which account a pack belongs to (one account, ever)
//   bill:alias:<id>   a ledger that Restore Purchases merged into another
//   bill:hold:<key>   which account a take's painting is held on
//   bill:lock:<id>    short lock while one request changes the account
//
// An account id is the app's StoreKit appAccountToken (a UUID kept in iCloud
// Keychain), which is also the generation guard's install id, so a purchase,
// its credits and the paintings they pay for all meet under one id.

import { randomUUID } from 'node:crypto';
import { createWallet } from '../../src/app/billing/wallet.js';
import { productById } from '../../src/app/billing/products.js';

const KEEP = 5 * 365 * 86400; // refreshed on every change
const LOCK_TTL = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTALL = /^[A-Za-z0-9_-]{16,64}$/; // the guard's install ids (web)
export function normalizeAccount(id) {
  const v = String(id ?? '').trim();
  if (UUID.test(v)) return v.toLowerCase();
  return INSTALL.test(v) ? v : null;
}

const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
/**
 * The person's local calendar day as the app reports it, if it is a date some
 * time zone (UTC−12 to UTC+14) is in right now; else the UTC day. With the
 * wallet never reopening a day at or before one already used, someone moving
 * their clock gains at most one early painting, once.
 */
export function clientDay(v, now = Date.now()) {
  const s = String(v ?? '');
  return [utcDay(now - 12 * 3600_000), utcDay(now), utcDay(now + 14 * 3600_000)].includes(s) ? s : utcDay(now);
}

const busy = () => Object.assign(new Error('ledger busy'), { code: 'ledger_busy' });
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ kv: any, now?: () => number, holdTtlMs?: number, sleep?: (ms:number)=>Promise<void> }} deps
 */
export function createLedger({ kv, now = Date.now, holdTtlMs = 180_000, sleep = defaultSleep }) {
  async function lock(id) {
    const token = randomUUID();
    for (let i = 0; !(await kv.claim(`bill:lock:${id}`, token, LOCK_TTL)); i++) {
      if (i >= 40) throw busy();
      await sleep(25 + i * 10);
    }
    return async () => { if ((await kv.get(`bill:lock:${id}`)) === token) await kv.del(`bill:lock:${id}`); };
  }

  async function load(id, day) {
    const raw = await kv.get(`bill:acct:${id}`);
    const subsRaw = await kv.get(`bill:subs:${id}`);
    const box = { state: raw ? JSON.parse(raw) : null, dirty: false };
    const wallet = createWallet({
      load: () => box.state,
      save: (s) => { box.state = s; box.dirty = true; },
      today: () => day ?? utcDay(now()),
      now,
    });
    wallet.releaseStale(holdTtlMs);
    const subs = subsRaw ? JSON.parse(subsRaw) : { txs: {}, willRenew: null, graceUntil: 0 };
    return { id, exists: !!raw, wallet, box, subs, subsDirty: false };
  }
  async function save(a) {
    if (a.subsDirty) await kv.set(`bill:subs:${a.id}`, JSON.stringify(a.subs), KEEP);
    if (a.box.dirty) await kv.set(`bill:acct:${a.id}`, JSON.stringify(a.box.state), KEEP);
  }
  async function withAccount(id, day, fn) {
    const unlock = await lock(id);
    try {
      const a = await load(id, day);
      const out = await fn(a);
      await save(a);
      return out;
    } finally { await unlock(); }
  }

  /** Follow merges made by Restore Purchases. */
  async function resolve(id) {
    let cur = id;
    for (let i = 0; i < 8; i++) {
      const next = await kv.get(`bill:alias:${cur}`);
      if (!next) return cur;
      cur = next;
    }
    return cur;
  }

  // Daily Ritual as of now: the latest expiry among its unrefunded
  // transactions, extended by a billing grace period while Apple grants one.
  function syncSubscription(a, productId) {
    const live = Object.values(a.subs.txs).filter((t) => !t.revoked);
    if (!live.length) { a.wallet.setSubscription(null); return; }
    const latest = live.reduce((x, y) => (y.exp > x.exp ? y : x));
    const expiresAt = Math.max(latest.exp, a.subs.graceUntil || 0);
    a.wallet.setSubscription({ productId: latest.productId || productId, expiresAt, willRenew: a.subs.willRenew ?? expiresAt > now() });
  }

  const view = (a) => ({ account: a.id, ...a.wallet.status(), wallet: { ...a.wallet.snapshot(), holds: {} } });

  /**
   * Apply one verified Apple transaction.
   * source 'app' (sent by the app) or 'notification' (from Apple directly).
   * Only Apple's own notification can undo a refund, so an old signed
   * transaction replayed by a client never brings refunded credits back.
   */
  async function applyTransaction(tx, { fallback, source = 'app' } = {}) {
    const product = productById(tx.productId);
    if (!product) return { ignored: 'unknown_product' };
    let owner = normalizeAccount(tx.appAccountToken);
    const txId = String(tx.transactionId);
    if (!owner && tx.originalTransactionId) owner = await kv.get(`bill:otid:${tx.originalTransactionId}`);
    if (!owner && product.kind === 'consumable') owner = await kv.get(`bill:txid:${txId}`);
    owner ??= normalizeAccount(fallback);
    if (!owner) return { ignored: 'no_account' };
    // A pack is granted to one account only, whoever sends it later.
    if (product.kind === 'consumable' && !(await kv.claim(`bill:txid:${txId}`, owner, KEEP))) {
      const first = await kv.get(`bill:txid:${txId}`);
      if (first && (await resolve(first)) !== (await resolve(owner))) return { ignored: 'other_account' };
    }
    const id = await resolve(owner);
    return withAccount(id, null, async (a) => {
      let effect;
      if (product.kind === 'consumable') {
        const granted = a.wallet.grant(txId, product.credits);
        if (tx.revocationDate) effect = a.wallet.revoke(txId) ? 'revoked' : 'already_revoked';
        else if (source === 'notification' && a.wallet.unrevoke(txId)) effect = 'restored';
        else effect = granted ? 'granted' : 'already_granted';
      } else {
        const prev = a.subs.txs[txId];
        const revoked = !!tx.revocationDate || (!!prev?.revoked && source !== 'notification');
        a.subs.txs[txId] = { exp: Number(tx.expiresDate) || 0, productId: tx.productId, revoked };
        a.subsDirty = true;
        await kv.set(`bill:otid:${tx.originalTransactionId}`, id, KEEP);
        syncSubscription(a, tx.productId);
        effect = revoked ? 'revoked' : prev ? 'updated' : 'subscribed';
      }
      return { effect, ...view(a) };
    });
  }

  /** Verified renewal info: whether it will renew, and any billing grace period. */
  async function applyRenewal(info) {
    const owner = await kv.get(`bill:otid:${info.originalTransactionId}`);
    if (!owner) return { ignored: 'unknown_subscription' };
    return withAccount(await resolve(owner), null, async (a) => {
      a.subs.willRenew = info.autoRenewStatus === 1;
      a.subs.graceUntil = Number(info.gracePeriodExpiresDate) || 0;
      a.subsDirty = true;
      syncSubscription(a);
      return view(a);
    });
  }

  /**
   * Restore Purchases on a new install: the old account's ledger moves into
   * this one and the old id points here from now on. Free paintings don't
   * come back: the merged ledger keeps the lower count.
   */
  async function merge(fromRaw, toRaw) {
    const from = await resolve(fromRaw), to = await resolve(toRaw);
    if (from === to) return false;
    const [first, second] = [from, to].sort();
    const unlockA = await lock(first);
    try {
      const unlockB = await lock(second);
      try {
        const src = await load(from), dst = await load(to);
        if (!src.exists) return false;
        const s = src.wallet.snapshot(), d = dst.wallet.snapshot();
        dst.wallet.replace({
          ...d,
          free: Math.min(s.free, d.free),
          credits: d.credits + s.credits,
          dailyUsed: [s.dailyUsed, d.dailyUsed].filter(Boolean).sort().at(-1) ?? null,
          spent: { ...s.spent, ...d.spent },
          granted: { ...s.granted, ...d.granted },
          revoked: { ...s.revoked, ...d.revoked },
          purchased: s.purchased || d.purchased,
        });
        dst.subs = { ...dst.subs, txs: { ...src.subs.txs, ...dst.subs.txs }, willRenew: dst.subs.willRenew ?? src.subs.willRenew, graceUntil: Math.max(dst.subs.graceUntil || 0, src.subs.graceUntil || 0) };
        dst.subsDirty = true;
        if (Object.keys(dst.subs.txs).length) syncSubscription(dst);
        await save(dst);
        await kv.set(`bill:alias:${from}`, to, KEEP);
        await kv.del(`bill:acct:${from}`, `bill:subs:${from}`);
        return true;
      } finally { await unlockB(); }
    } finally { await unlockA(); }
  }

  async function holder(key, account) {
    if (account) return resolve(normalizeAccount(account) ?? account);
    return kv.get(`bill:hold:${key}`);
  }

  /** Account deletion: the ledger goes. Apple subscriptions stay Apple's and land here again if renewed. */
  async function erase(account) {
    const id = await resolve(account);
    const unlock = await lock(id);
    try { await kv.del(`bill:acct:${id}`, `bill:subs:${id}`); } finally { await unlock(); }
    return true;
  }

  return {
    resolve,
    erase,
    /** Admin-only test action: replenish FREE attempts without touching purchases or history. */
    async replenishTestFree(account) {
      const id = await resolve(account);
      return withAccount(id, null, async (a) => {
        const state = a.wallet.snapshot();
        a.wallet.replace({ ...state, free: 3 });
        return view(a);
      });
    },
    applyTransaction,
    applyRenewal,
    merge,
    async status(account, day) { return withAccount(await resolve(account), day, async (a) => view(a)); },
    /** Set one painting aside for this take. → the source, or null when nothing is left. */
    async reserve(account, key, day) {
      const id = await resolve(account);
      return withAccount(id, day, async (a) => {
        const source = a.wallet.reserve(key);
        if (source) await kv.set(`bill:hold:${key}`, id, Math.ceil(holdTtlMs / 1000) + 60);
        return source;
      });
    },
    /** The painting was made: count it, once. */
    async commit(key, account) {
      const id = await holder(key, account);
      if (!id) return null;
      return withAccount(id, null, async (a) => a.wallet.commit(key));
    },
    /** The painting wasn't made: hand it back. */
    async release(key, account) {
      const id = await holder(key, account);
      if (!id) return false;
      return withAccount(id, null, async (a) => a.wallet.release(key));
    },
  };
}

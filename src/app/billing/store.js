// The store boundary. Its shape follows StoreKit 2 so the native app can put
// the real thing behind it without touching the paywall:
//
//   products()            Product.products(for:)          → localized displayPrice
//   purchase(id)          product.purchase()               → success | userCancelled | pending
//   finish(tx)            transaction.finish()
//   sync()                AppStore.sync()                  (Restore Purchases)
//   currentSubscription() Transaction.currentEntitlements + renewal info
//   onTransaction(fn)     Transaction.updates              (Ask to Buy approvals, renewals)
//
// Failures throw StoreError with a kind: 'network' | 'failed' | 'notAllowed' | 'appOnly'.
//
// Until App Store products exist, the only store is the development
// simulation below. It never takes money and every screen it touches says so.

import { PRODUCTS, productById } from './products.js';

export class StoreError extends Error {
  constructor(kind, message) { super(message || kind); this.kind = kind; }
}

const SIM_KEY = 'sonmira.sim.store';

/**
 * Development-only purchase simulation. `ask` shows the simulator sheet and
 * resolves to the outcome the tester picks:
 *   purchase: 'success' | 'cancel' | 'pending' | 'failed' | 'network'
 *   restore:  'success' | 'cancel' | 'network'
 * @param {{ ask: (req: {kind: 'purchase'|'restore', product?: any}) => Promise<string>, now?: () => number }} opts
 */
export function createSimulatedStore({ ask, now = () => Date.now() }) {
  const listeners = new Set();
  const read = () => { try { return { sub: null, pending: [], seq: 0, ...JSON.parse(localStorage.getItem(SIM_KEY) || '{}') }; } catch { return { sub: null, pending: [], seq: 0 }; } };
  const write = (st) => { try { localStorage.setItem(SIM_KEY, JSON.stringify(st)); } catch {} };
  const txId = (st) => `sim-${Date.now().toString(36)}-${++st.seq}`;

  function transactionFor(st, product) {
    const tx = { id: txId(st), productId: product.id, purchaseDate: now(), simulated: true };
    if (product.kind === 'subscription') {
      tx.expiresAt = addMonths(now(), 1);
      st.sub = { productId: product.id, expiresAt: tx.expiresAt, willRenew: true };
    }
    return tx;
  }

  // An auto-renewing simulated subscription renews itself while time passes.
  function renewed(st) {
    if (st.sub?.willRenew) while (st.sub.expiresAt <= now()) st.sub.expiresAt = addMonths(st.sub.expiresAt, 1);
    return st;
  }

  return {
    id: 'simulated',
    simulated: true,

    async products() {
      return PRODUCTS.map((p) => ({ id: p.id, displayPrice: p.fallbackPrice }));
    },

    async purchase(id) {
      const product = productById(id);
      if (!product) throw new StoreError('failed', 'unknown product');
      const outcome = await ask({ kind: 'purchase', product });
      if (outcome === 'cancel') return { status: 'userCancelled' };
      if (outcome === 'network') throw new StoreError('network');
      if (outcome === 'failed') throw new StoreError('failed');
      const st = read();
      if (outcome === 'pending') { st.pending.push(id); write(st); return { status: 'pending' }; }
      const tx = transactionFor(st, product);
      write(st);
      return { status: 'success', transaction: tx };
    },

    async finish() {},

    async sync() {
      const outcome = await ask({ kind: 'restore' });
      if (outcome === 'cancel') throw new StoreError('userCancelled');
      if (outcome === 'network') throw new StoreError('network');
    },

    async currentSubscription() {
      const st = renewed(read());
      write(st);
      return st.sub ? { ...st.sub } : null; // expired ones too, so the app can say when it ended
    },

    onTransaction(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // ── development controls (Settings → Development, ?dev panel) ──────────
    dev: {
      hasPending: () => read().pending.length > 0,
      /** Ask to Buy: the parent approves; the transaction arrives later. */
      approvePending() {
        const st = read();
        const id = st.pending.shift();
        if (!id) return false;
        const tx = transactionFor(st, productById(id));
        write(st);
        listeners.forEach((fn) => fn(tx));
        return true;
      },
      declinePending() { const st = read(); st.pending = []; write(st); },
      cancelSubscription() { const st = read(); if (st.sub) st.sub.willRenew = false; write(st); },
      expireSubscription() { const st = read(); if (st.sub) { st.sub.willRenew = false; st.sub.expiresAt = now() - 1000; } write(st); },
      forget() { try { localStorage.removeItem(SIM_KEY); } catch {} },
    },
  };
}

function addMonths(t, n) { const d = new Date(t); d.setMonth(d.getMonth() + n); return d.getTime(); }

/**
 * The released website in a browser: no App Store, and the simulation would
 * offer purchases the server never honours, so buying and restoring say
 * they happen in the iOS app ('appOnly').
 */
export function createAppOnlyStore() {
  const appOnly = async () => { throw new StoreError('appOnly'); };
  return {
    id: 'none', simulated: false, dev: null,
    products: async () => [], purchase: appOnly, sync: appOnly, finish: async () => {},
    currentSubscription: async () => null, onTransaction: () => () => {},
  };
}

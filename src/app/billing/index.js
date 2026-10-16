// Billing for the app: the wallet (what can be made now) + the store (how
// more is bought), persisted on the device.
//
// DEVELOPMENT ONLY. Purchases are simulated and nothing is charged. The
// wallet and its limits live in localStorage, so anyone can edit or reset
// them: this is presentation and flow logic, not secure billing. Production
// needs the server-side ledger and signed StoreKit transactions below.
//
// Production plan (see docs/paywall.md): the ledger lives with the
// generation service, keyed by an anonymous id kept in iCloud Keychain, so
// credits survive reinstalls and new devices without an account. Here the
// "account ledger" is a second local copy that a simulated reinstall keeps.

import { createWallet } from './wallet.js';
import { createSimulatedStore, StoreError } from './store.js';
import { PRODUCTS, productById } from './products.js';
import { dayKey } from '../format.js';

export { StoreError };

const LOCAL = 'sonmira.wallet';
const ACCOUNT = 'sonmira.sim.ledger';
const DAY_SHIFT = 'sonmira.sim.dayShift';

const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const forget = (...ks) => { try { ks.forEach((k) => localStorage.removeItem(k)); } catch {} };

/** @param {{ ask: (req: any) => Promise<string> }} opts  ask = the development purchase simulator */
export function createBilling({ ask }) {
  const store = createSimulatedStore({ ask });
  const today = () => { const d = new Date(); d.setDate(d.getDate() + (Number(readJSON(DAY_SHIFT)) || 0)); return dayKey(d); };
  const wallet = createWallet({
    load: () => readJSON(LOCAL) ?? readJSON(ACCOUNT),
    save: (s) => { writeJSON(LOCAL, s); writeJSON(ACCOUNT, { ...s, holds: {} }); },
    today,
  });
  // Generation runs inside the app, so after a restart nothing is in flight:
  // anything set aside goes back. (With a generation service, ask it first.)
  wallet.releaseAll();

  const prices = Object.fromEntries(PRODUCTS.map((p) => [p.id, p.fallbackPrice]));
  const listeners = new Set();
  const emit = (event) => listeners.forEach((fn) => fn(event));

  // Grant first, finish after: an unfinished transaction is re-delivered on
  // the next launch, so a crash in between never loses a purchase, and
  // wallet.grant() ignores a transaction it has already counted.
  async function apply(tx) {
    const product = productById(tx.productId);
    if (!product) return null;
    if (product.kind === 'consumable') wallet.grant(tx.id, product.credits);
    else wallet.setSubscription({ productId: tx.productId, expiresAt: tx.expiresAt, willRenew: true });
    await store.finish(tx);
    return product;
  }

  store.onTransaction(async (tx) => {
    const product = await apply(tx);
    emit({ type: 'transaction', product, simulated: !!tx.simulated });
  });

  async function refresh() {
    try {
      for (const p of await store.products()) prices[p.id] = p.displayPrice;
      wallet.setSubscription(await store.currentSubscription());
    } catch (e) { console.warn('[sonmira] store refresh failed', e); }
    emit({ type: 'refresh' });
  }

  const billing = {
    simulated: store.simulated,
    products: PRODUCTS,
    ready: refresh(),
    price: (id) => prices[id],
    status: () => wallet.status(),
    /** A new generation key, one per take. */
    newKey: () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    reserve: (key) => wallet.reserve(key),
    commit: (key) => { const r = wallet.commit(key); emit({ type: 'spent' }); return r; },
    release: (key) => wallet.release(key),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** → { status: 'success' | 'pending' | 'cancelled', product }. Throws StoreError. */
    async purchase(id) {
      const product = productById(id);
      const r = await store.purchase(id);
      if (r.status === 'userCancelled') return { status: 'cancelled', product };
      if (r.status === 'pending') return { status: 'pending', product };
      await apply(r.transaction);
      emit({ type: 'purchase', product });
      return { status: 'success', product, simulated: !!r.transaction.simulated };
    },

    /** Restore Purchases → { subscription, credits }. Throws StoreError. */
    async restore() {
      await store.sync();
      const ledger = readJSON(ACCOUNT);
      if (ledger) wallet.replace(ledger);
      wallet.setSubscription(await store.currentSubscription());
      emit({ type: 'restore' });
      const s = wallet.status();
      return { subscription: s.subscribed, credits: s.credits };
    },

    // Development-only controls, shown only while the store is simulated.
    dev: {
      store: store.dev,
      useUpFree() { wallet.replace({ ...wallet.snapshot(), free: 0 }); emit({ type: 'dev' }); },
      nextDay() { writeJSON(DAY_SHIFT, (Number(readJSON(DAY_SHIFT)) || 0) + 1); emit({ type: 'dev' }); },
      async expireSubscription() { store.dev.expireSubscription(); await refresh(); },
      async cancelSubscription() { store.dev.cancelSubscription(); await refresh(); },
      approvePending: () => store.dev.approvePending(),
      /** Delete the app: the device copy goes, the account ledger and App Store history stay. */
      reinstall() { forget(LOCAL); location.reload(); },
      /** A brand-new person on a brand-new Apple ID. */
      reset() { forget(LOCAL, ACCOUNT, DAY_SHIFT); store.dev.forget(); location.reload(); },
    },
  };
  return billing;
}

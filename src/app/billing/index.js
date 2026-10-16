// Billing for the app: the wallet (what can be made now) + the store (how
// more is bought).
//
// In the iOS app the store is the App Store (StoreKit 2, native-store.js)
// and the server's ledger (api/billing) is the truth: it verifies Apple's
// signed transactions, grants each one once, and the generation guard
// spends a painting only when one is made. The wallet here is the app's
// copy of that ledger, so the paywall and Settings answer instantly.
// See docs/billing-iap.md.
//
// In a browser (web previews) purchases are a DEVELOPMENT SIMULATION and
// nothing is charged. The wallet lives in localStorage; the "account ledger"
// is a second local copy that a simulated reinstall keeps.

import { createWallet } from './wallet.js';
import { createSimulatedStore, StoreError } from './store.js';
import { createNativeStore } from './native-store.js';
import { createBillingServer } from './remote.js';
import { PRODUCTS, productById } from './products.js';
import { nativePlugin } from '../native/platform.js';
import { dayKey } from '../format.js';

export { StoreError };

const LOCAL = 'sonmira.wallet';
const ACCOUNT = 'sonmira.sim.ledger';
const DAY_SHIFT = 'sonmira.sim.dayShift';

const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const forget = (...ks) => { try { ks.forEach((k) => localStorage.removeItem(k)); } catch {} };

/**
 * @param {{ ask: (req: any) => Promise<string>, native?: any, server?: any }} opts
 *   ask = the development purchase simulator; native / server default to the
 *   App Store and the billing API in the iOS app, and to none in a browser.
 */
export function createBilling({ ask, native, server }) {
  if (native === undefined) { const plugin = nativePlugin('SonmiraStore'); native = plugin ? createNativeStore(plugin) : null; }
  if (server === undefined) server = native ? createBillingServer() : null;
  const store = native ?? createSimulatedStore({ ask });
  let account = native ? native.accountId().catch((e) => { console.warn('[sonmira] no account id', e); return null; }) : Promise.resolve(null);
  const today = () => { const d = new Date(); if (!native) d.setDate(d.getDate() + (Number(readJSON(DAY_SHIFT)) || 0)); return dayKey(d); };
  const wallet = createWallet({
    load: () => readJSON(LOCAL) ?? readJSON(ACCOUNT),
    save: (s) => { writeJSON(LOCAL, s); if (!native) writeJSON(ACCOUNT, { ...s, holds: {} }); },
    today,
  });
  // Generation runs inside the app, so after a restart nothing is in flight:
  // anything set aside goes back. (With a generation service, ask it first.)
  wallet.releaseAll();

  const prices = Object.fromEntries(PRODUCTS.map((p) => [p.id, p.fallbackPrice]));
  const listeners = new Set();
  const emit = (event) => listeners.forEach((fn) => fn(event));

  // The server's ledger replaces the local copy; paintings being made right
  // now (holds) stay as they are.
  const adopt = (status) => { if (status?.wallet) wallet.replace(status.wallet); };

  // Grant first, finish after: an unfinished transaction is re-delivered on
  // the next launch, so a crash in between never loses a purchase, and
  // wallet.grant() (and the server) ignore a transaction already counted.
  // In the app the transaction is finished only once the server has it.
  // → { product, fresh } where fresh = something new arrived (worth a toast)
  async function apply(tx) {
    const product = productById(tx.productId);
    if (!product) return { product: null };
    let fresh = false;
    if (!tx.revoked) {
      if (product.kind === 'consumable') fresh = wallet.grant(tx.id, product.credits);
      else {
        fresh = !wallet.status().subscribed && (!tx.originalId || tx.originalId === tx.id);
        wallet.setSubscription({ productId: tx.productId, expiresAt: tx.expiresAt, willRenew: true });
      }
    }
    if (server) {
      try { adopt((await server.send({ account: await account, transactions: [tx.jws], day: today() })).status); }
      catch (e) { console.warn('[sonmira] purchase not recorded yet; StoreKit delivers it again', e); return { product, fresh }; }
    }
    await store.finish(tx);
    return { product, fresh };
  }

  store.onTransaction(async (tx) => {
    const { product, fresh } = await apply(tx);
    emit({ type: 'transaction', product: fresh ? product : null, simulated: !!tx.simulated });
  });

  async function refresh() {
    try { for (const p of await store.products()) prices[p.id] = p.displayPrice; }
    catch (e) { console.warn('[sonmira] store prices unavailable', e); }
    try {
      const sub = await store.currentSubscription();
      wallet.setSubscription(sub);
      if (server) {
        const id = await account;
        adopt(sub?.jws
          ? (await server.send({ account: id, transactions: [sub.jws], renewals: [sub.renewalJws].filter(Boolean), day: today() })).status
          : await server.status(id, today()));
      }
    } catch (e) { console.warn('[sonmira] billing refresh failed', e); }
    emit({ type: 'refresh' });
  }

  // After a painting, the server has counted it too; take its numbers.
  let settling = null;
  const settle = () => {
    if (!server || settling) return;
    settling = setTimeout(async () => {
      settling = null;
      try { adopt(await server.status(await account, today())); emit({ type: 'refresh' }); } catch {}
    }, 1500);
  };

  const billing = {
    simulated: store.simulated,
    products: PRODUCTS,
    /** The account id (iOS app) shared with the generation guard and the ledger; null in a browser. */
    accountId: () => account,
    /** Sign-in, sign-out or deletion changed the device's account: follow it. */
    useAccount(id) { account = Promise.resolve(id); return refresh(); },
    ready: refresh(),
    /** Ask the store (and, in the app, the server) again. */
    refresh: () => refresh(),
    price: (id) => prices[id],
    status: () => wallet.status(),
    /** A new generation key, one per take. */
    newKey: () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    reserve: (key) => wallet.reserve(key),
    commit: (key) => { const r = wallet.commit(key); emit({ type: 'spent' }); settle(); return r; },
    release: (key) => wallet.release(key),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** → { status: 'success' | 'pending' | 'cancelled', product }. Throws StoreError. */
    async purchase(id) {
      const product = productById(id);
      const r = await store.purchase(id, { appAccountToken: await account });
      if (r.status === 'userCancelled') return { status: 'cancelled', product };
      if (r.status === 'pending') return { status: 'pending', product };
      if (r.transaction.revoked) throw new StoreError('failed');
      await apply(r.transaction);
      emit({ type: 'purchase', product });
      return { status: 'success', product, simulated: !!r.transaction.simulated };
    },

    /** Restore Purchases → { subscription, credits }. Throws StoreError. */
    async restore() {
      await store.sync();
      const sub = await store.currentSubscription();
      if (server) {
        // Every purchase this Apple ID has made goes to the server, which
        // brings back a ledger left under an earlier install's id.
        try {
          adopt((await server.send({ account: await account, transactions: await store.history(), renewals: [sub?.renewalJws].filter(Boolean), restore: true, day: today() })).status);
        } catch { throw new StoreError('network'); }
      } else {
        const ledger = readJSON(ACCOUNT);
        if (ledger) wallet.replace(ledger);
        wallet.setSubscription(sub);
      }
      emit({ type: 'restore' });
      const s = wallet.status();
      return { subscription: s.subscribed, credits: s.credits };
    },

    /** Apple's subscription settings (iOS app); null in a browser. */
    manageSubscriptions: native ? () => native.manageSubscriptions() : null,

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

// The App Store behind store.js's interface, through the iOS app's StoreKit 2
// plugin (ios/App/App/SonmiraStorePlugin.swift). Every transaction comes with
// Apple's signed JWS, which the server verifies before it counts anything.

import { PRODUCTS } from './products.js';
import { StoreError } from './store.js';

const KINDS = new Set(['network', 'failed', 'notAllowed', 'userCancelled']);
const storeError = (e) => new StoreError(KINDS.has(e?.code) ? e.code : 'failed', e?.message);

const tx = (t) => t && {
  id: String(t.id), originalId: String(t.originalId ?? t.id), productId: t.productId, jws: t.jws,
  expiresAt: t.expiresAt ?? null, revoked: !!t.revoked,
};

export function createNativeStore(plugin) {
  const subscription = PRODUCTS.find((p) => p.kind === 'subscription');
  let account = null;
  const accountId = async () => (account ??= String((await plugin.accountId()).id).toLowerCase());

  return {
    id: 'appstore',
    simulated: false,
    /** A random id kept in iCloud Keychain: StoreKit's appAccountToken and the server ledger's key. */
    accountId,

    async products() {
      try { return (await plugin.products({ ids: PRODUCTS.map((p) => p.id) })).products ?? []; }
      catch (e) { throw storeError(e); }
    },

    async purchase(id) {
      try {
        const r = await plugin.purchase({ productId: id, appAccountToken: await accountId() });
        if (r.status === 'success') return { status: 'success', transaction: tx(r.transaction) };
        return { status: r.status === 'pending' ? 'pending' : 'userCancelled' };
      } catch (e) {
        if (e?.code === 'userCancelled') return { status: 'userCancelled' };
        throw storeError(e);
      }
    },

    finish: (t) => plugin.finish({ transactionId: t.id }),

    async sync() {
      try { await plugin.sync(); } catch (e) { throw storeError(e); }
    },

    /** Every signed transaction for this Apple ID (consumables included on iOS 18+). */
    async history() { return (await plugin.history()).transactions ?? []; },

    async currentSubscription() {
      const r = await plugin.currentSubscription({ productId: subscription.id });
      if (!r?.productId) return null;
      return {
        productId: r.productId, expiresAt: r.revoked ? Math.min(r.expiresAt, Date.now()) : r.expiresAt,
        willRenew: !r.revoked && !!r.willRenew, jws: r.jws, renewalJws: r.renewalJws,
      };
    },

    /** Transaction.updates and unfinished transactions, from launch. */
    onTransaction(fn) {
      const handle = plugin.addListener('transaction', (t) => fn(tx(t)));
      return () => Promise.resolve(handle).then((h) => h?.remove?.());
    },

    manageSubscriptions: () => plugin.manageSubscriptions(),
  };
}

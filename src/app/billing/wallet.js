// The painting wallet: how many new paintings someone can make right now, and
// the bookkeeping that makes sure only a successful painting is ever counted.
//
// Sources, spent in this order:
//   daily   — Daily Ritual's one painting per calendar day (does not carry over)
//   free    — the first three paintings
//   credits — Little Moments credits (never expire)
//
// Every generation has a key (one per take). reserve(key) sets a source
// aside before the engine runs, commit(key) counts it once the painting
// exists, release(key) hands it back if anything fails. All three are
// idempotent per key, so retries never count twice.
//
// Pure logic: storage and the clock are injected, so it runs in Node tests.

import { FREE_PAINTINGS } from './products.js';

const KEEP_SPENT = 60; // recent committed keys kept for de-duplication

// The server's ledger counts a take under its guarded request's key, the
// take key plus '.generate' (protect/client.js). The app adopts that ledger
// (iOS), so a take counted there is the same take here.
const SERVER_SUFFIX = '.generate';

export function freshState() {
  return { v: 1, free: FREE_PAINTINGS, credits: 0, sub: null, dailyUsed: null, holds: {}, spent: {}, granted: {}, revoked: {}, purchased: false };
}

/**
 * @param {{ load?: () => any, save?: (s: any) => void, today: () => string, now?: () => number }} io
 */
export function createWallet({ load = () => null, save = () => {}, today, now = () => Date.now() }) {
  let s = normalize(load());

  const persist = () => save(s);
  const spentFor = (key) => s.spent[key] ?? s.spent[key + SERVER_SUFFIX];
  const held = (source) => Object.values(s.holds).filter((x) => x.source === source).length;
  const subscribed = () => !!(s.sub && s.sub.expiresAt > now());
  // A day already used, or one before it, never opens again (the server takes
  // the phone's local day, within limits, and must not be walked back and forth).
  const dailyOpen = () => subscribed() && !(s.dailyUsed && s.dailyUsed >= today()) && !held('daily');

  function nextSource() {
    if (dailyOpen()) return 'daily';
    if (s.free - held('free') > 0) return 'free';
    if (s.credits - held('credits') > 0) return 'credits';
    return null;
  }

  return {
    /** What the person can do right now (holds already subtracted). */
    status() {
      const source = nextSource();
      return {
        canCreate: !!source,
        source,
        free: Math.max(0, s.free - held('free')),
        credits: Math.max(0, s.credits - held('credits')),
        subscribed: subscribed(),
        sub: s.sub ? { ...s.sub } : null,
        dailyOpen: dailyOpen(),
        dailyUsedToday: subscribed() && s.dailyUsed === today(),
        purchased: s.purchased,
      };
    },

    /** Set a painting aside for this generation. Returns the source, or null if none is left. */
    reserve(key) {
      if (spentFor(key)) return spentFor(key).source;
      if (s.holds[key]) return s.holds[key].source;
      const source = nextSource();
      if (!source) return null;
      s.holds[key] = { source, day: today(), at: now() };
      persist();
      return source;
    },

    /** The painting exists: count it. Safe to call more than once. */
    commit(key) {
      if (spentFor(key)) { if (s.holds[key]) { delete s.holds[key]; persist(); } return spentFor(key).source; }
      const hold = s.holds[key];
      if (!hold) return null;
      if (hold.source === 'daily') s.dailyUsed = hold.day;
      else if (hold.source === 'free') s.free = Math.max(0, s.free - 1);
      else s.credits = Math.max(0, s.credits - 1);
      delete s.holds[key];
      s.spent[key] = { source: hold.source, at: now() };
      const keys = Object.keys(s.spent);
      if (keys.length > KEEP_SPENT) keys.sort((a, b) => s.spent[a].at - s.spent[b].at).slice(0, keys.length - KEEP_SPENT).forEach((k) => delete s.spent[k]);
      persist();
      return hold.source;
    },

    /** The painting didn't happen: hand the reservation back. */
    release(key) {
      if (!s.holds[key]) return false;
      delete s.holds[key];
      persist();
      return true;
    },

    /** After a restart nothing is still generating (generation runs in-app), so every hold goes back. */
    releaseAll() {
      const n = Object.keys(s.holds).length;
      if (n) { s.holds = {}; persist(); }
      return n;
    },

    /** Add a pack's credits once per store transaction. */
    grant(transactionId, credits) {
      if (s.granted[transactionId]) return false;
      s.granted[transactionId] = credits;
      s.credits += credits;
      s.purchased = true;
      persist();
      return true;
    },

    /** A refunded pack: take back what's left of its credits, never below zero. */
    revoke(transactionId) {
      if (!s.granted[transactionId] || s.revoked[transactionId] != null) return 0;
      const taken = Math.min(s.granted[transactionId], s.credits);
      s.revoked[transactionId] = taken;
      s.credits -= taken;
      persist();
      return taken;
    },

    /** A refund that Apple reversed: give back what revoke() took. */
    unrevoke(transactionId) {
      const taken = s.revoked[transactionId];
      if (taken == null) return 0;
      delete s.revoked[transactionId];
      s.credits += taken;
      persist();
      return taken;
    },

    /** Holds older than maxAgeMs belong to a generation that died; hand them back. */
    releaseStale(maxAgeMs) {
      const old = Object.keys(s.holds).filter((k) => now() - s.holds[k].at > maxAgeMs);
      old.forEach((k) => delete s.holds[k]);
      if (old.length) persist();
      return old.length;
    },

    /** Mirror the store's current subscription entitlement (or null). */
    setSubscription(sub) {
      s.sub = sub ? { productId: sub.productId, expiresAt: sub.expiresAt, willRenew: !!sub.willRenew } : null;
      if (sub) s.purchased = true;
      persist();
    },

    snapshot: () => JSON.parse(JSON.stringify(s)),
    /** Adopt a ledger (e.g. after a reinstall); in-flight holds stay local. */
    replace(next) { s = { ...normalize(next), holds: s.holds }; persist(); },
  };
}

function normalize(x) {
  const base = freshState();
  if (!x || typeof x !== 'object' || x.v !== 1) return base;
  return {
    ...base, ...x,
    free: num(x.free, base.free), credits: num(x.credits, 0),
    holds: obj(x.holds), spent: obj(x.spent), granted: obj(x.granted), revoked: obj(x.revoked),
  };
}
const num = (v, d) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
const obj = (v) => (v && typeof v === 'object' ? { ...v } : {});

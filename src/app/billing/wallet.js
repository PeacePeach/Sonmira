// The painting wallet: how many new paintings someone can make right now, and
// the bookkeeping that makes sure only a successful painting is ever counted.
//
// Sources (none of them expire; people see only their total):
//   daily   — Daily Ritual credits: one per subscription day, saved up to 30
//   free    — the first three paintings
//   credits — Little Moments credits (no cap)
// They are spent in that order: a Daily Ritual credit spent makes room under
// the cap, so a day is never lost to a full balance while other paintings wait.
//
// Daily Ritual days are counted from the moment a subscription starts: a
// credit then, and one every 24 hours while it is paid for (renewals, a
// billing grace period, and auto-renew turned off until the period ends all
// count). A credit is never given ahead of its day, so the balance can't go
// below zero or borrow from days to come, and spending doesn't bring the next
// one sooner. A day lands only while the balance is under 30. When the paid
// subscription ends no new days come, and what's left stays, whenever (or
// whether) they subscribe again. Being 24-hour steps from a moment Apple signs, the days don't depend on the phone's clock or time zone.
//
// Every generation has a key (one per take). reserve(key) sets a source
// aside before the engine runs, commit(key) counts it once the painting
// exists, release(key) hands it back if anything fails. All three are
// idempotent per key, so retries never count twice.
//
// Pure logic: storage and the clock are injected, so it runs in Node tests.

import { FREE_PAINTINGS, RITUAL_CAP } from './products.js';

const KEEP_SPENT = 60; // recent committed keys kept for de-duplication
const DAY = 24 * 3600_000;
// A renewal that starts within this of the previous period's end continues the
// same run of days (Apple's renewal can be signed a little after the expiry).
const JOIN = 3600_000;
// A period known only by its expiry (records from before credits rolled
// over, or StoreKit's latest transaction) is taken to start a month before it.
const MONTH = 31 * DAY;

// The server's ledger counts a take under its guarded request's key, the
// take key plus '.generate' (protect/client.js). The app adopts that ledger
// (iOS), so a take counted there is the same take here.
const SERVER_SUFFIX = '.generate';

/** Paid periods [from, to) → sorted, merged runs of days. */
export function ritualRuns(periods = []) {
  const out = [];
  for (const [a, b] of [...periods].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a <= last[1] + JOIN) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
// Credit moments in a run [a, b): a, a + 1 day, … before b. → how many are at or before t.
const upTo = ([a, b], t) => (t < a ? 0 : Math.floor((Math.min(t, b - 1) - a) / DAY) + 1);
const between = (runs, t0, t1) => runs.reduce((n, r) => n + upTo(r, t1) - (t0 === -Infinity ? 0 : upTo(r, t0)), 0);
const covered = (periods, t) => periods.some(([a, b]) => a <= t && t < b);

export function freshState() {
  return {
    v: 1, free: FREE_PAINTINGS, credits: 0, sub: null, dailyUsed: null, holds: {}, spent: {}, granted: {}, revoked: {}, purchased: false,
    // Daily Ritual: the balance, paid periods, the moment counted up to, and
    // the moment before which no credit is given late (set by the migration).
    ritual: 0, periods: [], ritualAt: null, ritualFloor: null, ritualRevoked: {},
  };
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

  // Bring the Daily Ritual balance up to now: credits for the days that have
  // begun since last time (capped).
  function accrue() {
    const t = now();
    if (s.ritual == null) {
      // A wallet from before credits rolled over: today's painting, if it
      // wasn't used, becomes one credit; days before now are not paid out.
      s.ritual = subscribed() && !(s.dailyUsed && s.dailyUsed >= today()) ? 1 : 0;
      s.ritualAt = t;
      // Older paid periods the server may still send are not paid out late.
      s.ritualFloor = s.periods.length ? Math.min(...s.periods.map((p) => p[0])) : null;
      persist();
      return;
    }
    if (s.ritualAt != null && t <= s.ritualAt) return;
    const n = between(ritualRuns(s.periods), s.ritualAt ?? -Infinity, t);
    const was = s.ritual;
    if (n) s.ritual = Math.min(RITUAL_CAP, s.ritual + n);
    s.ritualAt = t;
    if (s.ritual !== was) persist();
  }

  // New paid time that began before the balance was last brought up to date
  // (a renewal that arrived late, a purchase just made): its credits, once.
  function backfill(before, after) {
    if (s.ritualAt == null) return;
    const runs = ritualRuns(after);
    const had = ritualRuns(before);
    const floor = s.ritualFloor ?? -Infinity;
    let n = 0;
    for (const [a, b] of runs) {
      const first = Math.max(a, a + Math.ceil((Math.max(floor, s.ritualAt - 400 * DAY) - a) / DAY) * DAY);
      for (let t = first; t < b && t <= s.ritualAt; t += DAY) if (t > floor && !covered(had, t)) n++;
    }
    if (n) s.ritual = Math.min(RITUAL_CAP, s.ritual + n);
  }

  const ritualLeft = () => Math.max(0, (s.ritual ?? 0) - held('daily'));

  function nextSource() {
    if (ritualLeft() > 0) return 'daily';
    if (s.free - held('free') > 0) return 'free';
    if (s.credits - held('credits') > 0) return 'credits';
    return null;
  }

  // When the next credit lands, while subscribed: within the paid period, or
  // past its end when it renews (the renewal continues the same rhythm).
  function ritualNext() {
    const t = now();
    const run = ritualRuns(s.periods).find(([a, b]) => a <= t && t < b);
    if (!run || !subscribed()) return null;
    const at = run[0] + Math.ceil((t - run[0] + 1) / DAY) * DAY;
    return at < run[1] || s.sub.willRenew ? at : null;
  }

  return {
    /** What the person can do right now (holds already subtracted). */
    status() {
      accrue();
      const source = nextSource();
      return {
        canCreate: !!source,
        source,
        free: Math.max(0, s.free - held('free')),
        credits: Math.max(0, s.credits - held('credits')),
        ritual: ritualLeft(),
        ritualCap: RITUAL_CAP,
        ritualNextAt: s.ritual < RITUAL_CAP ? ritualNext() : null,
        subscribed: subscribed(),
        sub: s.sub ? { ...s.sub } : null,
        purchased: s.purchased,
        now: now(), // the clock the times above are on (a web preview's can be moved on)
      };
    },

    /** Set a painting aside for this generation. Returns the source, or null if none is left. */
    reserve(key) {
      if (spentFor(key)) return spentFor(key).source;
      if (s.holds[key]) return s.holds[key].source;
      accrue();
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
      if (hold.source === 'daily') s.ritual = Math.max(0, (s.ritual ?? 0) - 1);
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

    /**
     * Mirror the subscription (or null). sub.periods, when given (the
     * server's ledger), are all its paid periods; otherwise the period ending
     * at sub.expiresAt is added or updated, matched by sub.from when known.
     * { backfill: false } when restoring time a refund took (refundRitual's
     * credits come back with unrefundRitual instead).
     */
    setSubscription(sub, { backfill: late = true } = {}) {
      accrue();
      const before = s.periods.map((p) => [...p]);
      if (sub?.periods) s.periods = sub.periods.map(([a, b]) => [Number(a), Number(b)]).filter(([a, b]) => b > a);
      else if (sub?.expiresAt) s.periods = withPeriod(s.periods, sub, now());
      s.sub = sub ? { productId: sub.productId, expiresAt: sub.expiresAt, willRenew: !!sub.willRenew } : null;
      if (sub) s.purchased = true;
      if (late) backfill(before, s.periods);
      persist();
    },

    /** A refunded Daily Ritual period: take back what's left of the credits it earned, never below zero. → taken */
    refundRitual(id, [from, to]) {
      accrue();
      if (s.ritualRevoked?.[id] != null) return 0;
      const earned = ritualRuns(s.periods).reduce((n, r) => n + Math.max(0, upTo(r, Math.min(now(), to - 1)) - upTo(r, from - 1)), 0);
      const taken = Math.min(earned, s.ritual);
      s.ritual -= taken;
      s.ritualRevoked = { ...s.ritualRevoked, [id]: taken };
      persist();
      return taken;
    },

    /** Apple reversed that refund: give back what refundRitual took. */
    unrefundRitual(id) {
      const taken = s.ritualRevoked?.[id];
      if (taken == null) return 0;
      accrue();
      s.ritual = Math.min(RITUAL_CAP, s.ritual + taken);
      delete s.ritualRevoked[id];
      persist();
      return taken;
    },

    snapshot: () => { accrue(); return JSON.parse(JSON.stringify(s)); },
    /** Adopt a ledger (e.g. after a reinstall); in-flight holds stay local. */
    replace(next) { s = { ...normalize(next), holds: s.holds }; persist(); },
  };
}

// Add or update the paid period ending at sub.expiresAt. A period continuing
// one that is still running (a renewal) extends it; one known by its start
// replaces that period's end (a renewal, a cancellation that took effect).
function withPeriod(periods, sub, t) {
  const out = periods.map((p) => [...p]);
  const end = Number(sub.expiresAt);
  if (sub.from != null) {
    const same = out.find(([a]) => a === Number(sub.from));
    if (same) same[1] = end; else out.push([Number(sub.from), end]);
    return out;
  }
  const last = out.sort((x, y) => x[0] - y[0]).at(-1);
  if (last && last[1] + JOIN >= Math.min(t, end) && last[0] < end) { last[1] = end; return out; }
  out.push([Math.min(t, end - 1), end]);
  return out;
}

function normalize(x) {
  const base = freshState();
  if (!x || typeof x !== 'object' || x.v !== 1) return base;
  const periods = Array.isArray(x.periods)
    ? x.periods.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    : x.sub?.expiresAt ? [[x.sub.expiresAt - MONTH, x.sub.expiresAt]] : [];
  return {
    ...base, ...x,
    free: num(x.free, base.free), credits: num(x.credits, 0),
    holds: obj(x.holds), spent: obj(x.spent), granted: obj(x.granted), revoked: obj(x.revoked),
    // A wallet saved before Daily Ritual credits rolled over has no balance
    // yet (null): the first look gives it one (accrue).
    ritual: 'ritual' in x ? num(x.ritual, 0) : null, periods,
    ritualAt: Number.isFinite(x.ritualAt) ? x.ritualAt : null, ritualFloor: Number.isFinite(x.ritualFloor) ? x.ritualFloor : null,
    ritualRevoked: obj(x.ritualRevoked),
  };
}
const num = (v, d) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
const obj = (v) => (v && typeof v === 'object' ? { ...v } : {});

// HTTP handlers for /api/billing/*. Each is a factory so tests can pass a
// store, a verifier and a clock.
//
//   POST /api/billing/transactions { account, transactions: [jws], renewals?: [jws], restore?: true, device? }
//        The app sends every signed transaction it sees (purchase, Ask to Buy
//        approval, renewal, restore). Each is verified and applied once.
//   GET  /api/billing/status?account=<id>&day=YYYY-MM-DD
//   POST /api/billing/apple-notifications { signedPayload }   (App Store Server Notifications V2)
//
// A purchase always goes to the account Apple signed it for
// (appAccountToken), whoever sends it, and a pack to one account only. Moving
// a ledger (Restore Purchases) or claiming a purchase that names no account
// also needs the transaction to be signed for the sending device (`device`,
// StoreKit's device verification id), so a signed transaction copied from a
// log or a screenshot moves nothing.
//
// deps.authorize(req, account) → boolean proves the caller holds the account
// (the generation guard's install token, wired where the guard lives);
// deps.limit caps requests per address.

import { kvFromEnv } from './kv.js';
import { createLedger, normalizeAccount, clientDay } from './ledger.js';
import { createAppleVerifier, onDevice } from './apple.js';

const MAX_JWS = 300;
const defaultLog = (e) => { try { console.log(JSON.stringify({ evt: 'sonmira.billing', ...e })); } catch {} };

export function billingFromEnv(env = process.env) {
  const kv = kvFromEnv(env);
  const bundleId = env.SONMIRA_BUNDLE_ID || 'app.sonmira';
  // Sonmira's numeric Apple ID (App Store Connect → App Information). Not a secret.
  const appAppleId = env.SONMIRA_APPLE_APP_ID || (bundleId === 'app.sonmira' ? '6823759268' : undefined);
  return {
    kv,
    // Deployed, the account check must be supplied (the guard's install
    // token); without one the app's endpoints refuse rather than run open.
    authorize: env.VERCEL ? null : async () => true,
    ledger: kv ? createLedger({ kv }) : null,
    verifier: createAppleVerifier({
      bundleId,
      appAppleId,
      allowXcode: env.VERCEL_ENV !== 'production' && env.SONMIRA_ALLOW_XCODE_STOREKIT === '1',
    }),
  };
}

function body(req) {
  if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch { return null; } }
  return req.body && typeof req.body === 'object' ? req.body : {};
}
const deny = (res, status, code) => res.status(status).json({ ok: false, code });

const LIMITS = { transactions: 30, status: 120 }; // per address per minute
const address = (req) => String(req.headers?.['x-real-ip'] || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'unknown';
function perAddress(kv) {
  return async (req, name) => {
    if (!kv?.hit) return true;
    try { return (await kv.hit(`bill:rate:${name}:${address(req)}:${Math.floor(Date.now() / 60_000)}`, 90)) <= LIMITS[name]; }
    catch { return true; }
  };
}

function lazy(deps) {
  let d = null;
  return () => {
    if (d) return d;
    d = deps ? { log: defaultLog, authorize: async () => true, ...deps } : { log: defaultLog, ...billingFromEnv() };
    d.limit ??= perAddress(d.kv);
    return d;
  };
}

export function createTransactionsHandler(deps) {
  const get = lazy(deps);
  return async function transactions(req, res) {
    res.setHeader?.('cache-control', 'no-store');
    if (req.method !== 'POST') return deny(res, 405, 'method');
    const { ledger, verifier, log, authorize, limit } = get();
    if (!ledger || !authorize) return deny(res, 503, 'not_configured');
    if (!(await limit(req, 'transactions'))) return deny(res, 429, 'rate_limited');
    const b = body(req);
    const account = normalizeAccount(b?.account);
    if (!account) return deny(res, 400, 'bad_account');
    if (!(await authorize(req, account))) return deny(res, 401, 'unauthorized');
    const list = Array.isArray(b.transactions) ? b.transactions.slice(0, MAX_JWS) : [];
    const renewals = Array.isArray(b.renewals) ? b.renewals.slice(0, 10) : [];
    const results = [];
    try {
      for (const jws of list) {
        let tx;
        try { tx = await verifier.transaction(jws); } catch (e) { results.push({ ok: false, code: e.code || 'invalid' }); log({ outcome: 'rejected', code: e.code }); continue; }
        // Restore: a purchase made under another id (an earlier install
        // without iCloud Keychain) brings that ledger here, if this device
        // holds it.
        const mine = onDevice(tx, b.device);
        const owner = normalizeAccount(tx.appAccountToken);
        if (b.restore && mine && owner && owner !== account) await ledger.merge(owner, account);
        const r = await ledger.applyTransaction(tx, { fallback: mine ? account : null, source: 'app' });
        results.push({ ok: !r.ignored, id: String(tx.transactionId), productId: tx.productId, effect: r.effect ?? r.ignored });
        log({ outcome: r.effect ?? r.ignored, env: tx.environment, product: tx.productId, tx: String(tx.transactionId), account: account.slice(0, 8) });
      }
      for (const jws of renewals) {
        try { await ledger.applyRenewal(await verifier.renewal(jws)); } catch (e) { log({ outcome: 'renewal_rejected', code: e.code }); }
      }
      const status = await ledger.status(account, clientDay(b.day));
      return res.status(200).json({ ok: true, results, status });
    } catch (e) {
      log({ outcome: 'error', code: e.code || String(e.message).slice(0, 60) });
      return deny(res, 503, e.code === 'ledger_busy' ? 'busy' : 'unavailable');
    }
  };
}

export function createStatusHandler(deps) {
  const get = lazy(deps);
  return async function status(req, res) {
    res.setHeader?.('cache-control', 'no-store');
    if (req.method !== 'GET') return deny(res, 405, 'method');
    const { ledger, authorize, limit } = get();
    if (!ledger || !authorize) return deny(res, 503, 'not_configured');
    if (!(await limit(req, 'status'))) return deny(res, 429, 'rate_limited');
    const q = req.query ?? Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const account = normalizeAccount(q.account);
    if (!account) return deny(res, 400, 'bad_account');
    if (!(await authorize(req, account))) return deny(res, 401, 'unauthorized');
    try { return res.status(200).json({ ok: true, status: await ledger.status(account, clientDay(q.day)) }); }
    catch { return deny(res, 503, 'unavailable'); }
  };
}

// Apple retries a notification that isn't answered with 200, for days, so
// anything we can't use (unknown product, unrelated type) is still a 200.
export function createNotificationsHandler(deps) {
  const get = lazy(deps);
  return async function notifications(req, res) {
    if (req.method !== 'POST') return deny(res, 405, 'method');
    const { ledger, verifier, log } = get();
    if (!ledger) return deny(res, 503, 'not_configured');
    const b = body(req);
    let n;
    try { n = await verifier.notification(b?.signedPayload); }
    catch (e) { log({ source: 'notification', outcome: 'rejected', code: e.code }); return deny(res, 400, 'invalid'); }
    try {
      const out = { type: n.notificationType, subtype: n.subtype };
      if (n.data?.signedTransactionInfo) {
        const tx = await verifier.transaction(n.data.signedTransactionInfo);
        out.effect = (await ledger.applyTransaction(tx, { source: 'notification' })).effect ?? 'ignored';
        out.tx = String(tx.transactionId);
      }
      if (n.data?.signedRenewalInfo) await ledger.applyRenewal(await verifier.renewal(n.data.signedRenewalInfo));
      log({ source: 'notification', outcome: 'ok', ...out });
      return res.status(200).json({ ok: true });
    } catch (e) {
      log({ source: 'notification', outcome: 'error', code: e.code || String(e.message).slice(0, 60) });
      return deny(res, 500, 'retry');
    }
  };
}

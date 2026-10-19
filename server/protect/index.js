// Guard for the paid endpoints (/api/generate, /api/understand).
//
//   export default protect('generate', createHandler({ fetchImpl: timedFetch(100_000) }));
//
// For every POST, in this order, before any paid call:
//   1. a signed install token from an invitation code, for an install that
//      still holds its seat on that code                → 401 invite_required
//   2. an Idempotency-Key per take and endpoint          → 400 idempotency_key_required
//   3. same key already done → the stored response, no new paid call
//      same key still running → 409 in_progress (the client waits and asks again)
//   4. rate limits per network address, install and invitation code → 429 rate_limited
//   5. one painting set aside on the install's ledger (deps.charge, billing)
//                                                        → 402 no_paintings
//   6. the call's worst-case cost reserved against the daily cap, atomically,
//      so requests already in flight count against it    → 503 spend_cap
// Afterwards the reservation is settled: released when no paid call was
// made, kept when one may have been (an error after the provider was called,
// a timeout, a crash). The painting set aside is counted only when the
// response succeeded, and handed back otherwise. A successful response is
// kept for 24 h under its key, listed under the install so deleting the
// account deletes it.
//
// GET (configuration) is passed straight through. Without KV, a secret or
// invitation codes the guard refuses paid work instead of running open.

import { protectConfig, normalizeInvite, MICRO } from './config.js';
import { kvFromEnv, saveLarge, loadLarge } from './kv.js';
import { signToken, verifyToken, inviteId, INSTALL_ID } from './token.js';

export { protectConfig } from './config.js';
export { memoryKV, redisKV, upstashExec } from './kv.js';
export { signToken, verifyToken, inviteId } from './token.js';

const KEY = /^[A-Za-z0-9_.:-]{8,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPEND_TTL = 3 * 86400;
const SEAT_TTL = 365 * 86400;
const seatsOf = (invite) => `invite:${invite}:installs`;
// Seats live in the shared store. The only store a deployment can have
// without one is no-cost mode's in-memory store (server/dev/mode.js), where
// each function has its own memory and nothing paid is at stake: there a
// valid token is enough, as before seats were checked.
const seatHeld = async (kv, env, invite, installId) => (env.VERCEL && kv.kind === 'memory') || kv.isMember(seatsOf(invite), installId);

export const MESSAGES = {
  invite_required: 'An invitation code is needed to paint.',
  rate_limited: 'Many paintings in a short while. Please try again a little later.',
  spend_cap: 'Sonmira has painted all it can for today. Please try again tomorrow.',
  in_progress: 'This painting is still being made.',
  no_paintings: 'There are no paintings left to make right now.',
};

const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const utcHour = (t) => new Date(t).toISOString().slice(0, 13);
const header = (req, name) => { const v = req.headers?.[name]; return Array.isArray(v) ? v[0] : v; };
const bearer = (req) => { const a = header(req, 'authorization') || ''; return a.startsWith('Bearer ') ? a.slice(7).trim() : null; };
export function clientIp(req) {
  const f = header(req, 'x-vercel-forwarded-for') || header(req, 'x-forwarded-for') || header(req, 'x-real-ip') || '';
  return String(f).split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}
function parseBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body && typeof req.body === 'object' ? req.body : {};
}

export function estimate(endpoint, body, cost) {
  if (endpoint === 'generate') return cost.image;
  return body?.mode === 'eval' ? cost.eval : cost.transcribe + cost.text;
}
// What a successful call actually used, with the same unit prices: the text
// model is called only when the transcript has words.
export function settledCost(endpoint, body, result, cost) {
  if (endpoint === 'generate') return cost.image;
  if (body?.mode === 'eval') return cost.eval;
  return cost.transcribe + (result?.lyrics ? cost.text : 0);
}

// Abort a provider request (headers and body) after ms. Not cleared on
// headers, because a streamed image keeps arriving long after them.
export function timedFetch(ms, base = (...a) => globalThis.fetch(...a)) {
  return (url, init = {}) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(Object.assign(new Error('provider timeout'), { code: 'timeout' })), ms);
    timer.unref?.();
    init.signal?.addEventListener?.('abort', () => ctl.abort(init.signal.reason), { once: true });
    return base(url, { ...init, signal: ctl.signal });
  };
}

const defaultLog = (e) => { try { console.log(JSON.stringify({ evt: 'sonmira.guard', ...e })); } catch { /* never break a request */ } };

// The handler writes into this instead of the real response, so its result
// can be stored and its cost settled before anything is sent.
function capture(real) {
  const out = { status: 200, body: undefined, raw: undefined };
  const proxy = {
    setHeader(k, v) { real.setHeader?.(k, v); return proxy; },
    getHeader: (k) => real.getHeader?.(k),
    status(n) { out.status = n; return proxy; },
    json(o) { out.body = o; return proxy; },
    send(o) { if (o && typeof o === 'object' && !(o instanceof Uint8Array)) out.body = o; else out.raw = o; return proxy; },
    end(b) { out.raw = b; return proxy; },
    get statusCode() { return out.status; },
    set statusCode(n) { out.status = n; },
  };
  return { proxy, out };
}

/**
 * @param {'generate'|'understand'} endpoint
 * @param {(req:any, res:any) => any} handler
 * @param {{ env?: any, kv?: any, now?: () => number, log?: (e:any) => void,
 *   charge?: { reserve: (o:any) => Promise<any>, settle: (o:any) => Promise<any> } | null }} [deps]
 *   charge: the billing ledger's charge step (server/billing/charge.js)
 */
export function protect(endpoint, handler, deps = {}) {
  return async function guarded(req, res) {
    if (req.method !== 'POST') return handler(req, res);
    const env = deps.env ?? process.env;
    const cfg = protectConfig(env);
    if (cfg.off) return handler(req, res);
    const kv = deps.kv !== undefined ? deps.kv : kvFromEnv(env);
    const now = deps.now ?? Date.now, log = deps.log ?? defaultLog;
    res.setHeader?.('cache-control', 'no-store');
    const deny = (status, code, extra = {}) => res.status(status).json({ ok: false, code, error: MESSAGES[code] || code, ...extra });

    if (!kv || !cfg.secret || !cfg.invites.length) return deny(503, 'not_configured');
    if (Number(header(req, 'content-length') || 0) > cfg.maxBody[endpoint]) return deny(413, 'too_large');
    let body;
    try { body = parseBody(req); } catch { return deny(400, 'bad_json'); }
    if (endpoint === 'understand' && typeof body.audio === 'string' && body.audio.length > cfg.maxAudioBase64) return deny(413, 'too_large');

    const who = verifyToken(cfg.secret, bearer(req));
    if (!who || !cfg.invites.some((c) => inviteId(c) === who.invite)) return deny(401, 'invite_required');
    const key = header(req, 'idempotency-key');
    if (!KEY.test(key || '')) return deny(400, 'idempotency_key_required');

    const t = now(), day = utcDay(t), hour = utcHour(t);
    const rec = `idem:${endpoint}:${who.installId}:${key}`;
    const spendKey = `spend:${day}`;
    const base = { endpoint, install: who.installId.slice(0, 8), invite: who.invite, key };
    const charge = deps.charge ?? null;
    const chargeArgs = { installId: who.installId, key, endpoint };
    let est, claimed = false, held = false;
    try {
      // A seat moved to an account or freed by deletion ends the old token.
      if (!(await seatHeld(kv, env, who.invite, who.installId))) {
        log({ ...base, outcome: 'no_seat' });
        return deny(401, 'invite_required');
      }
      const existing = await kv.get(rec);
      if (existing) {
        const r = JSON.parse(existing);
        if (r.state !== 'done') return deny(409, 'in_progress', { retryAfterMs: 2000 });
        const text = await loadLarge(kv, `${rec}:body`, r.chunks);
        if (text != null) {
          log({ ...base, outcome: 'replay', status: r.status });
          res.setHeader?.('x-sonmira-replay', '1');
          return res.status(r.status).json(JSON.parse(text));
        }
        await kv.del(rec); // the stored body expired first: run it again
      }
      if (!(await kv.claim(rec, JSON.stringify({ state: 'pending', at: t }), cfg.pendingTtlSec))) return deny(409, 'in_progress', { retryAfterMs: 2000 });
      claimed = true;

      const E = endpoint.toUpperCase();
      const limits = [
        [`rl:ip:${clientIp(req)}:${hour}`, cfg.limits.IP_HOUR, 3600],
        [`rl:${endpoint}:i:${who.installId}:${hour}`, cfg.limits[`${E}_HOUR`], 3600],
        [`rl:${endpoint}:i:${who.installId}:${day}`, cfg.limits[`${E}_DAY`], 2 * 86400],
      ];
      if (endpoint === 'generate') limits.push([`rl:generate:c:${who.invite}:${day}`, cfg.limits.INVITE_GENERATE_DAY, 2 * 86400]);
      for (const [k, max, ttl] of limits) {
        if ((await kv.hit(k, ttl)) > max) {
          await kv.del(rec);
          log({ ...base, outcome: 'rate_limited', limit: k.split(':').slice(0, 3).join(':') });
          return deny(429, 'rate_limited', { retryAfterSec: ttl === 3600 ? 3600 - Math.floor((t / 1000) % 3600) : 86400 - Math.floor((t / 1000) % 86400) });
        }
      }

      if (charge) {
        const c = await charge.reserve({ ...chargeArgs, req });
        if (!c?.ok) {
          await kv.del(rec);
          log({ ...base, outcome: c?.code || 'no_paintings' });
          return deny(c?.status || 402, c?.code || 'no_paintings');
        }
        held = !!c.counted;
      }

      est = estimate(endpoint, body, cfg.cost);
      const r = await kv.reserve(spendKey, est, cfg.capMicros, SPEND_TTL);
      if (!r.ok) {
        if (held) await charge.settle({ ...chargeArgs, outcome: 'release' });
        await kv.del(rec);
        log({ ...base, outcome: 'spend_cap', dayUsd: r.total / MICRO, capUsd: cfg.capMicros / MICRO });
        return deny(503, 'spend_cap');
      }
    } catch (e) {
      log({ ...base, outcome: 'guard_unavailable', error: String(e.code || e.message).slice(0, 80) });
      // Hand back what this request took, so asking again isn't blocked.
      try { if (held) await charge.settle({ ...chargeArgs, outcome: 'release' }); } catch { /* the hold expires */ }
      try { if (claimed) await kv.del(rec); } catch { /* the pending record expires */ }
      return deny(503, 'protection_unavailable');
    }

    // Authenticated account identity for per-account reference history.
    if (endpoint === 'generate') req.sonmiraInstallId = who.installId;
    const { proxy, out } = capture(res);
    let threw = null;
    try { await handler(req, proxy); } catch (e) { threw = e; }
    const ok = !threw && out.status < 300 && out.body?.ok !== false;
    // 4xx and 503 are answered before any provider call; 5xx otherwise, a
    // throw or a timeout may have been billed, so the reservation stays.
    const settled = ok ? settledCost(endpoint, body, out.body, cfg.cost) : !threw && (out.status < 500 || out.status === 503) ? 0 : est;
    let dayTotal = null, counted;
    // Only a painting that was made is counted; a failed one costs nothing.
    // Counted before the result is stored, so a replay is never free and
    // never counted twice (the ledger counts one key once).
    if (held) {
      try { counted = (await charge.settle({ ...chargeArgs, outcome: ok ? 'commit' : 'release' })) ?? undefined; }
      catch (e) { log({ ...base, outcome: ok ? 'charge_commit_failed' : 'charge_release_failed', error: String(e.code || e.message).slice(0, 80) }); }
    }
    try {
      if (settled !== est) dayTotal = await kv.adjust(spendKey, settled - est, SPEND_TTL);
      if (ok && out.body !== undefined) {
        const chunks = await saveLarge(kv, `${rec}:body`, JSON.stringify(out.body), cfg.resultTtlSec);
        await kv.set(rec, JSON.stringify({ state: 'done', status: out.status, chunks, at: now() }), cfg.resultTtlSec);
        await kv.addMember(`results:${who.installId}`, rec, cfg.resultTtlSec);
      } else {
        await kv.del(rec);
      }
    } catch (e) {
      log({ ...base, outcome: 'guard_settle_failed', error: String(e.code || e.message).slice(0, 80) });
    }
    log({ ...base, outcome: ok ? 'ok' : 'failed', charged: held ? (ok ? (counted ?? true) : 'released') : undefined, status: threw ? 500 : out.status, code: out.body?.code ?? (threw ? 'threw' : undefined), ms: now() - t, reservedUsd: est / MICRO, settledUsd: settled / MICRO, dayUsd: dayTotal == null ? undefined : dayTotal / MICRO, usage: out.body?.usage ?? undefined });

    if (threw) return deny(500, 'error');
    if (out.body !== undefined) return res.status(out.status).json(out.body);
    res.status(out.status);
    return res.end(out.raw);
  };
}

// POST /api/session { invite, installId } → { ok, token }
//                   { accountToken, installId } → { ok, token }
// One invitation code admits at most INSTALLS_PER_INVITE installs; the same
// install asking again gets a fresh token without using another place.
// A signed-in account (deps.verifyAccount, the account service) gets a token
// for its own id without a code, if that id still holds a seat on a code
// that is still live: how a returning account on a new install paints.
export function createSessionHandler(deps = {}) {
  return async function session(req, res) {
    const env = deps.env ?? process.env;
    const cfg = protectConfig(env);
    const kv = deps.kv !== undefined ? deps.kv : kvFromEnv(env);
    const now = deps.now ?? Date.now, log = deps.log ?? defaultLog;
    res.setHeader?.('cache-control', 'no-store');
    const deny = (status, code, error) => res.status(status).json({ ok: false, code, error });
    if (req.method !== 'POST') return deny(405, 'method', 'POST only');
    if (!kv || !cfg.secret || !cfg.invites.length) return deny(503, 'not_configured', 'Invitations aren’t set up on this server yet.');
    if (Number(header(req, 'content-length') || 0) > cfg.maxBody.session) return deny(413, 'too_large', 'Request too large.');
    let body;
    try { body = parseBody(req); } catch { return deny(400, 'bad_json', 'Bad request.'); }
    const installId = String(body.installId ?? '');
    // One spelling per id: the ledger and the account service key UUIDs in
    // lower case, so an upper-case twin must not get a token of its own.
    if (!INSTALL_ID.test(installId) || (UUID.test(installId) && installId !== installId.toLowerCase())) return deny(400, 'bad_install', 'Bad request.');
    try {
      if ((await kv.hit(`rl:session:ip:${clientIp(req)}:${utcHour(now())}`, 3600)) > cfg.limits.SESSION_IP_HOUR) return deny(429, 'rate_limited', 'Too many tries. Please wait a while.');
      if (body.accountToken != null && body.invite == null) {
        const a = deps.verifyAccount ? await deps.verifyAccount(String(body.accountToken)) : null;
        const invite = a?.accountId === installId ? await kv.get(`seat:${installId}`) : null;
        const live = invite && cfg.invites.some((c) => inviteId(c) === invite) && (await kv.isMember(seatsOf(invite), installId));
        log({ endpoint: 'session', outcome: live ? 'ok_account' : 'account_no_seat', install: installId.slice(0, 8) });
        if (!live) return deny(401, 'invite_required', 'An invitation code is needed to paint.');
        return res.status(200).json({ ok: true, token: signToken(cfg.secret, { installId, invite, now: now() }) });
      }
      const code = cfg.invites.find((c) => c === normalizeInvite(body.invite));
      if (!code) { log({ endpoint: 'session', outcome: 'invalid_invite' }); return deny(401, 'invalid_invite', 'That code didn’t work.'); }
      const invite = inviteId(code);
      const j = await kv.join(seatsOf(invite), installId, cfg.limits.INSTALLS_PER_INVITE, SEAT_TTL);
      if (!j.ok) { log({ endpoint: 'session', outcome: 'invite_full', invite }); return deny(403, 'invite_full', 'This code is already in use on its maximum number of devices.'); }
      await kv.set(`seat:${installId}`, invite, SEAT_TTL);
      log({ endpoint: 'session', outcome: 'ok', invite, install: installId.slice(0, 8), installs: j.size });
      return res.status(200).json({ ok: true, token: signToken(cfg.secret, { installId, invite, now: now() }) });
    } catch (e) {
      log({ endpoint: 'session', outcome: 'guard_unavailable', error: String(e.code || e.message).slice(0, 80) });
      return deny(503, 'protection_unavailable', 'Please try again in a moment.');
    }
  };
}

/**
 * For the billing and account endpoints: does this request carry the install
 * token of exactly this id, on a live invitation, with its seat still held?
 * (req, id) → boolean. Without KV or a secret, nothing is authorized.
 */
export function createAuthorize(deps = {}) {
  return async function authorize(req, id) {
    const env = deps.env ?? process.env;
    const cfg = protectConfig(env);
    const kv = deps.kv !== undefined ? deps.kv : kvFromEnv(env);
    if (!kv || !cfg.secret || typeof id !== 'string') return false;
    const who = verifyToken(cfg.secret, bearer(req));
    if (!who || who.installId !== id || !cfg.invites.some((c) => inviteId(c) === who.invite)) return false;
    return seatHeld(kv, env, who.invite, who.installId);
  };
}

/**
 * The account service's hooks into the guard's records (both idempotent):
 *   adoptSeat(from, to)  sign-in merged guest `from` into account `to`: the
 *                        seat moves to `to` (or is freed if `to` has one),
 *                        this hour's and day's counts follow, and `from`'s
 *                        token stops working
 *   eraseAccount(id)     deletion: the seat is freed and stored results go
 */
export function createSeats(deps = {}) {
  const env = deps.env ?? process.env;
  const store = () => { const kv = deps.kv !== undefined ? deps.kv : kvFromEnv(env); if (!kv) throw Object.assign(new Error('no store'), { code: 'not_configured' }); return kv; };
  const now = deps.now ?? Date.now;

  async function adoptSeat(from, to) {
    const kv = store();
    if (!from || !to || from === to) return 0;
    const invite = await kv.get(`seat:${from}`);
    if (!invite) return 0;
    const t = now();
    for (const ep of ['generate', 'understand']) {
      for (const [w, ttl] of [[utcHour(t), 3600], [utcDay(t), 2 * 86400]]) {
        const n = Number(await kv.get(`rl:${ep}:i:${from}:${w}`)) || 0;
        if (n > 0) { await kv.adjust(`rl:${ep}:i:${to}:${w}`, n, ttl); await kv.del(`rl:${ep}:i:${from}:${w}`); }
      }
    }
    for (const rec of await kv.members(`results:${from}`)) await kv.addMember(`results:${to}`, rec, 86400);
    await kv.del(`results:${from}`);
    return kv.moveSeat(`seat:${from}`, `seat:${to}`, seatsOf(invite), from, to, invite, SEAT_TTL);
  }

  async function eraseAccount(id) {
    const kv = store();
    if (!id) return false;
    const invite = await kv.get(`seat:${id}`);
    if (invite) await kv.removeMember(seatsOf(invite), id);
    for (const rec of await kv.members(`results:${id}`)) {
      const r = await kv.get(rec).then((v) => (v ? JSON.parse(v) : null)).catch(() => null);
      const parts = Array.from({ length: Math.max(1, Number(r?.chunks) || 1) }, (_, i) => `${rec}:body:${i}`);
      await kv.del(rec, ...parts);
    }
    await kv.del(`seat:${id}`, `results:${id}`);
    return true;
  }

  return { adoptSeat, eraseAccount };
}

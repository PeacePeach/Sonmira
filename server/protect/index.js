// Guard for the paid endpoints (/api/generate, /api/understand).
//
//   export default protect('generate', createHandler({ fetchImpl: timedFetch(100_000) }));
//
// For every POST, in this order, before any paid call:
//   1. a signed install token from an invitation code   → 401 invite_required
//   2. an Idempotency-Key per take and endpoint          → 400 idempotency_key_required
//   3. same key already done → the stored response, no new paid call
//      same key still running → 409 in_progress (the client waits and asks again)
//   4. rate limits per network address, install and invitation code → 429 rate_limited
//   5. the call's worst-case cost reserved against the daily cap, atomically,
//      so requests already in flight count against it    → 503 spend_cap
// Afterwards the reservation is settled: released when no paid call was
// made, kept when one may have been (an error after the provider was called,
// a timeout, a crash). A successful response is kept for 24 h under its key.
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
const SPEND_TTL = 3 * 86400;

export const MESSAGES = {
  invite_required: 'An invitation code is needed to paint.',
  rate_limited: 'Many paintings in a short while. Please try again a little later.',
  spend_cap: 'Sonmira has painted all it can for today. Please try again tomorrow.',
  in_progress: 'This painting is still being made.',
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
 * @param {{ env?: any, kv?: any, now?: () => number, log?: (e:any) => void }} [deps]
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
    let est;
    try {
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

      est = estimate(endpoint, body, cfg.cost);
      const r = await kv.reserve(spendKey, est, cfg.capMicros, SPEND_TTL);
      if (!r.ok) {
        await kv.del(rec);
        log({ ...base, outcome: 'spend_cap', dayUsd: r.total / MICRO, capUsd: cfg.capMicros / MICRO });
        return deny(503, 'spend_cap');
      }
    } catch (e) {
      log({ ...base, outcome: 'guard_unavailable', error: String(e.code || e.message).slice(0, 80) });
      return deny(503, 'protection_unavailable');
    }

    const { proxy, out } = capture(res);
    let threw = null;
    try { await handler(req, proxy); } catch (e) { threw = e; }
    const ok = !threw && out.status < 300 && out.body?.ok !== false;
    // 4xx and 503 are answered before any provider call; 5xx otherwise, a
    // throw or a timeout may have been billed, so the reservation stays.
    const settled = ok ? settledCost(endpoint, body, out.body, cfg.cost) : !threw && (out.status < 500 || out.status === 503) ? 0 : est;
    let dayTotal = null;
    try {
      if (settled !== est) dayTotal = await kv.adjust(spendKey, settled - est, SPEND_TTL);
      if (ok && out.body !== undefined) {
        const chunks = await saveLarge(kv, `${rec}:body`, JSON.stringify(out.body), cfg.resultTtlSec);
        await kv.set(rec, JSON.stringify({ state: 'done', status: out.status, chunks, at: now() }), cfg.resultTtlSec);
      } else {
        await kv.del(rec);
      }
    } catch (e) {
      log({ ...base, outcome: 'guard_settle_failed', error: String(e.code || e.message).slice(0, 80) });
    }
    log({ ...base, outcome: ok ? 'ok' : 'failed', status: threw ? 500 : out.status, code: out.body?.code ?? (threw ? 'threw' : undefined), ms: now() - t, reservedUsd: est / MICRO, settledUsd: settled / MICRO, dayUsd: dayTotal == null ? undefined : dayTotal / MICRO, usage: out.body?.usage ?? undefined });

    if (threw) return deny(500, 'error');
    if (out.body !== undefined) return res.status(out.status).json(out.body);
    res.status(out.status);
    return res.end(out.raw);
  };
}

// POST /api/session { invite, installId } → { ok, token }
// One invitation code admits at most INSTALLS_PER_INVITE installs; the same
// install asking again gets a fresh token without using another place.
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
    if (!INSTALL_ID.test(installId)) return deny(400, 'bad_install', 'Bad request.');
    try {
      if ((await kv.hit(`rl:session:ip:${clientIp(req)}:${utcHour(now())}`, 3600)) > cfg.limits.SESSION_IP_HOUR) return deny(429, 'rate_limited', 'Too many tries. Please wait a while.');
      const code = cfg.invites.find((c) => c === normalizeInvite(body.invite));
      if (!code) { log({ endpoint: 'session', outcome: 'invalid_invite' }); return deny(401, 'invalid_invite', 'That code didn’t work.'); }
      const invite = inviteId(code);
      const j = await kv.join(`invite:${invite}:installs`, installId, cfg.limits.INSTALLS_PER_INVITE, 365 * 86400);
      if (!j.ok) { log({ endpoint: 'session', outcome: 'invite_full', invite }); return deny(403, 'invite_full', 'This code is already in use on its maximum number of devices.'); }
      log({ endpoint: 'session', outcome: 'ok', invite, install: installId.slice(0, 8), installs: j.size });
      return res.status(200).json({ ok: true, token: signToken(cfg.secret, { installId, invite, now: now() }) });
    } catch (e) {
      log({ endpoint: 'session', outcome: 'guard_unavailable', error: String(e.code || e.message).slice(0, 80) });
      return deny(503, 'protection_unavailable', 'Please try again in a moment.');
    }
  };
}

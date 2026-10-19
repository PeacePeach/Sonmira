import { fakeProviderOn } from '../dev/mode.js';

// Small key-value layer for the generation guard. Every operation that has
// to be atomic across concurrent function instances is one Lua script on
// Redis (Upstash / Vercel KV over REST), and one synchronous step in the
// in-memory store used by tests and local development.
//
//   hit(key, ttlSec)                    → count in the window after this hit
//   reserve(key, amount, cap, ttlSec)   → { ok, total }  (never passes cap)
//   adjust(key, delta, ttlSec)          → total
//   claim(key, value, ttlSec)           → true if the key was free
//   join(key, member, max, ttlSec)      → { ok, size }   (set with a size cap)
//   get(key) / set(key, value, ttlSec) / del(...keys)
//   isMember(key, member) / addMember(key, member, ttlSec) / removeMember(key, member) / members(key)
//   moveSeat(fromSeat, toSeat, setKey, from, to, inviteId, ttlSec)
//                                       → 1 moved, 2 freed (to already had one), 0 nothing

const LUA = {
  hit: "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n",
  reserve: "local cur = tonumber(redis.call('GET', KEYS[1]) or '0') local amt = tonumber(ARGV[1]) if cur + amt > tonumber(ARGV[2]) then return {0, cur} end local n = redis.call('INCRBY', KEYS[1], amt) redis.call('EXPIRE', KEYS[1], ARGV[3]) return {1, n}",
  adjust: "local n = redis.call('INCRBY', KEYS[1], ARGV[1]) if n < 0 then redis.call('SET', KEYS[1], 0) n = 0 end redis.call('EXPIRE', KEYS[1], ARGV[2]) return n",
  // KEYS: seat of from, seat of to, the invitation's set. Re-checks that from
  // still holds a seat on that invitation, so a retry or a race is a no-op.
  moveSeat: "if redis.call('GET', KEYS[1]) ~= ARGV[3] then return 0 end redis.call('SREM', KEYS[3], ARGV[1]) redis.call('DEL', KEYS[1]) if redis.call('GET', KEYS[2]) then return 2 end redis.call('SADD', KEYS[3], ARGV[2]) redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4]) return 1",
  addMember: "redis.call('SADD', KEYS[1], ARGV[1]) redis.call('EXPIRE', KEYS[1], ARGV[2]) return 1",
  join: "if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return {1, redis.call('SCARD', KEYS[1])} end local n = redis.call('SCARD', KEYS[1]) if n >= tonumber(ARGV[2]) then return {0, n} end redis.call('SADD', KEYS[1], ARGV[1]) redis.call('EXPIRE', KEYS[1], ARGV[3]) return {1, n + 1}",
};

// exec(['CMD', ...args]) → reply. Upstash REST and any RESP client fit this.
export function redisKV(exec, { prefix = 'sonmira:' } = {}) {
  const k = (key) => prefix + key;
  const s = (v) => String(v);
  return {
    kind: 'redis',
    hit: async (key, ttl) => Number(await exec(['EVAL', LUA.hit, '1', k(key), s(ttl)])),
    async reserve(key, amount, cap, ttl) {
      const [ok, total] = await exec(['EVAL', LUA.reserve, '1', k(key), s(amount), s(cap), s(ttl)]);
      return { ok: Number(ok) === 1, total: Number(total) };
    },
    adjust: async (key, delta, ttl) => Number(await exec(['EVAL', LUA.adjust, '1', k(key), s(delta), s(ttl)])),
    claim: async (key, value, ttl) => (await exec(['SET', k(key), s(value), 'NX', 'EX', s(ttl)])) === 'OK',
    async join(key, member, max, ttl) {
      const [ok, size] = await exec(['EVAL', LUA.join, '1', k(key), s(member), s(max), s(ttl)]);
      return { ok: Number(ok) === 1, size: Number(size) };
    },
    isMember: async (key, member) => Number(await exec(['SISMEMBER', k(key), s(member)])) === 1,
    addMember: async (key, member, ttl) => { await exec(['EVAL', LUA.addMember, '1', k(key), s(member), s(ttl)]); },
    removeMember: async (key, member) => { await exec(['SREM', k(key), s(member)]); },
    members: async (key) => ((await exec(['SMEMBERS', k(key)])) || []).map(String),
    moveSeat: async (fromSeat, toSeat, setKey, from, to, invite, ttl) => Number(await exec(['EVAL', LUA.moveSeat, '3', k(fromSeat), k(toSeat), k(setKey), s(from), s(to), s(invite), s(ttl)])),
    get: async (key) => { const v = await exec(['GET', k(key)]); return v == null ? null : String(v); },
    set: async (key, value, ttl) => { await exec(['SET', k(key), s(value), 'EX', s(ttl)]); },
    del: async (...keys) => { if (keys.length) await exec(['DEL', ...keys.map(k)]); },
  };
}

// Upstash / Vercel KV REST: POST the command as a JSON array.
export function upstashExec({ url, token, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, '');
  return async (cmd) => {
    const res = await fetchImpl(base, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.error) throw Object.assign(new Error(`kv ${cmd[0]} failed`), { code: 'kv_unavailable', detail: json?.error ?? res.status });
    return json.result;
  };
}

// One process only: tests and local development.
export function memoryKV({ now = Date.now } = {}) {
  const m = new Map(); // key → { v, exp }
  const live = (key) => { const e = m.get(key); if (e && e.exp && e.exp <= now()) { m.delete(key); return null; } return e ?? null; };
  const put = (key, v, ttl) => m.set(key, { v, exp: ttl ? now() + ttl * 1000 : 0 });
  return {
    kind: 'memory',
    async hit(key, ttl) { const e = live(key); if (!e) { put(key, 1, ttl); return 1; } e.v += 1; return e.v; },
    async reserve(key, amount, cap, ttl) {
      const cur = live(key)?.v ?? 0;
      if (cur + amount > cap) return { ok: false, total: cur };
      put(key, cur + amount, ttl);
      return { ok: true, total: cur + amount };
    },
    async adjust(key, delta, ttl) { const n = Math.max(0, (live(key)?.v ?? 0) + delta); put(key, n, ttl); return n; },
    async claim(key, value, ttl) { if (live(key)) return false; put(key, String(value), ttl); return true; },
    async join(key, member, max, ttl) {
      const e = live(key); const set = e?.v ?? new Set();
      if (set.has(member)) return { ok: true, size: set.size };
      if (set.size >= max) return { ok: false, size: set.size };
      set.add(member); put(key, set, ttl);
      return { ok: true, size: set.size };
    },
    async isMember(key, member) { const e = live(key); return !!(e?.v instanceof Set && e.v.has(member)); },
    async addMember(key, member, ttl) { const e = live(key); const set = e?.v instanceof Set ? e.v : new Set(); set.add(member); put(key, set, ttl); },
    async removeMember(key, member) { const e = live(key); if (e?.v instanceof Set) e.v.delete(member); },
    async members(key) { const e = live(key); return e?.v instanceof Set ? [...e.v] : []; },
    async moveSeat(fromSeat, toSeat, setKey, from, to, invite, ttl) {
      if (live(fromSeat)?.v !== invite) return 0;
      const e = live(setKey); const set = e?.v instanceof Set ? e.v : new Set();
      set.delete(from); m.delete(fromSeat);
      if (live(toSeat)) return 2;
      set.add(to); if (e) e.v = set; else put(setKey, set, ttl);
      put(toSeat, invite, ttl);
      return 1;
    },
    async get(key) { const e = live(key); return e ? String(e.v) : null; },
    async set(key, value, ttl) { put(key, String(value), ttl); },
    async del(...keys) { keys.forEach((key) => m.delete(key)); },
  };
}

// Preview deployments keep their own keys in the shared store: their own
// day's spend and cap, rate limits, invitation seats and results, so a
// Preview can never use up or read Production's. Production's keys are
// unchanged.
export const kvNamespace = (env = process.env) => (env.VERCEL_ENV === 'preview' ? 'preview:' : '');

let shared = null;
// Upstash / Vercel KV when configured. Off Vercel, one in-memory store per
// process. On Vercel without KV: null, and the guard refuses paid work,
// except in no-cost mode (server/dev/mode.js), where nothing paid is at stake.
export function kvFromEnv(env = process.env, { fetchImpl = fetch } = {}) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisKV(upstashExec({ url, token, fetchImpl }), { prefix: `sonmira:${kvNamespace(env)}` });
  if (env.VERCEL && !fakeProviderOn(env)) return null;
  shared ??= memoryKV();
  return shared;
}

// Large values (a generated painting is ~0.5 MB of base64) are split so no
// single KV request gets near the provider's request size limit.
const CHUNK = 400_000;
export async function saveLarge(kv, key, text, ttl) {
  const n = Math.max(1, Math.ceil(text.length / CHUNK));
  for (let i = 0; i < n; i++) await kv.set(`${key}:${i}`, text.slice(i * CHUNK, (i + 1) * CHUNK), ttl);
  return n;
}
export async function loadLarge(kv, key, n) {
  const parts = [];
  for (let i = 0; i < n; i++) { const p = await kv.get(`${key}:${i}`); if (p == null) return null; parts.push(p); }
  return parts.join('');
}

// The few key-value operations billing needs, in the same shape as the
// generation guard's store (server/protect/kv.js on the Production Readiness
// branch), so either can be passed in. Once that branch is merged, billing
// takes the guard's store and this file goes.
//
//   get(key) / set(key, value, ttlSec) / claim(key, value, ttlSec) / del(...keys)
//   hit(key, ttlSec) → the count in this window

export function memoryKV({ now = Date.now } = {}) {
  const m = new Map();
  const live = (k) => { const e = m.get(k); if (e && e.exp && e.exp <= now()) { m.delete(k); return null; } return e ?? null; };
  const put = (k, v, ttl) => m.set(k, { v: String(v), exp: ttl ? now() + ttl * 1000 : 0 });
  return {
    kind: 'memory',
    async get(k) { return live(k)?.v ?? null; },
    async set(k, v, ttl) { put(k, v, ttl); },
    async claim(k, v, ttl) { if (live(k)) return false; put(k, v, ttl); return true; },
    async del(...ks) { ks.forEach((k) => m.delete(k)); },
    async hit(k, ttl) { const e = live(k); const n = (e ? Number(e.v) : 0) + 1; m.set(k, { v: String(n), exp: e?.exp || now() + ttl * 1000 }); return n; },
  };
}

// Upstash / Vercel KV over REST.
export function upstashKV({ url, token, fetchImpl = fetch, prefix = 'sonmira:' }) {
  const base = url.replace(/\/+$/, '');
  const exec = async (cmd) => {
    const res = await fetchImpl(base, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.error) throw Object.assign(new Error(`kv ${cmd[0]} failed`), { code: 'kv_unavailable' });
    return json.result;
  };
  const k = (key) => prefix + key;
  return {
    kind: 'redis',
    async get(key) { const v = await exec(['GET', k(key)]); return v == null ? null : String(v); },
    async set(key, v, ttl) { await exec(['SET', k(key), String(v), 'EX', String(ttl)]); },
    async claim(key, v, ttl) { return (await exec(['SET', k(key), String(v), 'NX', 'EX', String(ttl)])) === 'OK'; },
    async del(...keys) { if (keys.length) await exec(['DEL', ...keys.map(k)]); },
    async hit(key, ttl) {
      const n = Number(await exec(['INCR', k(key)]));
      if (n === 1) await exec(['EXPIRE', k(key), String(ttl)]);
      return n;
    },
  };
}

let shared = null;
// Deployed without a store, billing refuses (null) rather than keep a ledger
// that vanishes with the function instance.
export function kvFromEnv(env = process.env, { fetchImpl = fetch } = {}) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return upstashKV({ url, token, fetchImpl });
  if (env.VERCEL) return null;
  shared ??= memoryKV();
  return shared;
}

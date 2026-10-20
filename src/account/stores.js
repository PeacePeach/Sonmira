// The account records' key-value store. Production uses the same Upstash
// Redis that the generation guard and the billing ledger use (Vercel injects
// KV_REST_API_URL / KV_REST_API_TOKEN); tests and the development simulation
// use memory.
//
// Interface (values are JSON):
//   get(key) → value | null
//   set(key, value, { nx?: boolean }) → boolean   (false when nx and the key exists)
//   del(...keys)
//   hit(key, ttlSec) → number   increments a counter that expires after ttlSec (rate limits)

export function createMemoryStore({ onChange } = {}) {
  const m = new Map();
  const hits = new Map(); // counters live apart from the records, so they aren't persisted
  return {
    kind: 'memory',
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async set(k, v, { nx = false } = {}) {
      if (nx && m.has(k)) return false;
      m.set(k, JSON.stringify(v)); onChange?.(m); return true;
    },
    async del(...ks) { ks.forEach((k) => m.delete(k)); onChange?.(m); },
    async hit(k, ttlSec) {
      const now = Date.now(), t = hits.get(k);
      const e = t && t.exp > now ? { n: t.n + 1, exp: t.exp } : { n: 1, exp: now + ttlSec * 1000 };
      if (hits.size > 5000) for (const [key, v] of hits) if (v.exp <= now) hits.delete(key);
      hits.set(k, e); return e.n;
    },
    dump: () => Object.fromEntries(m),
    load(obj) { m.clear(); for (const [k, v] of Object.entries(obj || {})) m.set(k, v); },
  };
}

/** Upstash Redis over its REST API (one command per request). */
export function createUpstashStore({ url, token, fetchImpl = fetch, prefix = '' }) {
  async function cmd(op, ...args) {
    // The key is always the first argument; DEL takes several.
    args = op === 'DEL' ? args.map((k) => prefix + k) : [prefix + args[0], ...args.slice(1)];
    const r = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify([op, ...args]) });
    if (!r.ok) throw new Error(`kv ${r.status}`);
    const { result, error } = await r.json();
    if (error) throw new Error(`kv ${error}`);
    return result;
  }
  return {
    kind: 'upstash',
    async get(k) { const v = await cmd('GET', k); return v == null ? null : JSON.parse(v); },
    async set(k, v, { nx = false } = {}) { return (await cmd('SET', k, JSON.stringify(v), ...(nx ? ['NX'] : []))) === 'OK'; },
    async del(...ks) { if (ks.length) await cmd('DEL', ...ks); },
    async hit(k, ttlSec) { const n = await cmd('INCR', k); if (n === 1) await cmd('EXPIRE', k, ttlSec); return n; },
  };
}

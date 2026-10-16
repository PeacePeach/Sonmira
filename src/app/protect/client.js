// The app's side of the generation guard (server/protect/).
//
// Requests to /api/generate and /api/understand get the install token and an
// Idempotency-Key derived from the take, so a retry, a relaunch or a resumed
// draft asks for the same painting again and never pays for it twice:
//
//   await withGenerationKey(take.key, () => app.engine.generate(...))
//
// The engine keeps calling fetch as it does today; installApiClient() wraps
// the global fetch for those two paths only. It also
//   - asks for an invitation code (askInvite) when the server needs one, then
//     sends the request again;
//   - waits and asks again while the server says the same key is still
//     running (409 in_progress), within the caller's own timeout.

const TOKEN = 'sonmira.access';
const INSTALL = 'sonmira.install';
const GUARDED = { '/api/generate': 'generate', '/api/understand': 'understand' };

// The app paints one take at a time; overlapping calls (a resumed draft
// while another finishes) each remove only their own entry, so the key
// never sticks after both are done.
const active = [];
const currentKey = () => active.at(-1)?.key ?? null;

/** Runs fn with every guarded request keyed to this take. */
export async function withGenerationKey(key, fn) {
  const mine = { key };
  active.push(mine);
  try { return await fn(); } finally { active.splice(active.indexOf(mine), 1); }
}

const randomId = () => {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

function safeStorage(storage) {
  return {
    get: (k) => { try { return storage?.getItem(k) ?? null; } catch { return null; } },
    set: (k, v) => { try { storage?.setItem(k, v); } catch { /* private mode: lives for this session */ } },
    del: (k) => { try { storage?.removeItem(k); } catch {} },
  };
}

const sleepFor = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }, { once: true });
});

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * @param {{
 *   fetchImpl: typeof fetch,
 *   storage?: Storage,
 *   askInvite?: (o: {error?: string}) => Promise<string|null>,  // null = not now
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>,
 *   origin?: string,
 *   pollLimitMs?: number,
 * }} opts
 */
export function createApiClient({ fetchImpl, storage = globalThis.localStorage, askInvite = async () => null, sleep = sleepFor, origin = globalThis.location?.href ?? 'http://localhost/', pollLimitMs = 170_000, now = Date.now }) {
  const store = safeStorage(storage);
  let memoryInstall = null, memoryToken = null;

  function installId() {
    let id = store.get(INSTALL) ?? memoryInstall;
    if (!id) { id = `i${randomId()}`; store.set(INSTALL, id); }
    memoryInstall = id;
    return id;
  }
  const getToken = () => store.get(TOKEN) ?? memoryToken;
  const setToken = (t) => { memoryToken = t; if (t) store.set(TOKEN, t); else store.del(TOKEN); };

  // One invitation prompt at a time, however many requests need it.
  let asking = null;
  function obtainToken() {
    asking ??= (async () => {
      let error;
      for (let tries = 0; tries < 6; tries++) {
        const code = await askInvite({ error });
        if (!code) return null;
        let res, body;
        try {
          res = await fetchImpl(new URL('/api/session', origin).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invite: code, installId: installId() }) });
          body = await res.json().catch(() => null);
        } catch { error = 'network'; continue; }
        if (res.ok && body?.token) { setToken(body.token); return body.token; }
        error = body?.code || `http_${res.status}`;
      }
      return null;
    })().finally(() => { asking = null; });
    return asking;
  }

  function guarded(input, init) {
    if ((init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase() !== 'POST') return null;
    let url;
    try { url = new URL(typeof input === 'string' ? input : input?.url ?? String(input), origin); } catch { return null; }
    if (url.origin !== new URL(origin).origin) return null;
    return GUARDED[url.pathname] ?? null;
  }

  async function guardedFetch(input, init = {}) {
    const endpoint = guarded(input, init);
    if (!endpoint) return fetchImpl(input, init);
    const key = `${currentKey() ?? `x${randomId()}`}.${endpoint}`;
    const until = now() + pollLimitMs;
    let invited = false;
    for (;;) {
      let token = getToken();
      if (!token) {
        token = await obtainToken();
        if (!token) return jsonResponse(401, { ok: false, code: 'invite_required', error: 'An invitation code is needed to paint.' });
      }
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
      headers.set('idempotency-key', key);
      const res = await fetchImpl(input, { ...init, headers });
      if (res.status === 401 || res.status === 409) {
        const body = await res.clone().json().catch(() => null);
        if (res.status === 401 && body?.code === 'invite_required' && !invited) { setToken(null); invited = true; continue; }
        if (res.status === 409 && body?.code === 'in_progress' && now() < until) { await sleep(body.retryAfterMs || 2000, init.signal); continue; }
      }
      return res;
    }
  }

  return { fetch: guardedFetch, installId, hasAccess: () => Boolean(getToken()), forget: () => setToken(null) };
}

/** Wraps globalThis.fetch for the guarded paths. Call once at boot. */
export function installApiClient(opts = {}) {
  const base = globalThis.fetch.bind(globalThis);
  const client = createApiClient({ fetchImpl: base, ...opts });
  globalThis.fetch = (input, init) => client.fetch(input, init);
  return client;
}

// Calm copy for the guard's refusals, for the generation error screen. The
// take is always kept (as a draft), so every line says it can wait.
const COPY = {
  invite_required: 'Sonmira needs an invitation code to paint. Your song is kept.',
  rate_limited: 'You’ve painted a lot in a short while. Your song is kept, so try again a little later.',
  spend_cap: 'Sonmira has painted all it can for today. Your song is kept, so try again tomorrow.',
  in_progress: 'Your painting is still being made. Your song is kept, so try again in a moment.',
  protection_unavailable: 'The painting service is busy right now. Your song is kept, so try again in a moment.',
};
export const guardMessage = (code) => COPY[code] ?? null;

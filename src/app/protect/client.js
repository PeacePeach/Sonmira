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
//
// The install id is the device's one id (installId option: the account id,
// which is the Keychain id in the iOS app). A token belongs to one id, so
// when the id changes (sign-in, sign-out) the old token is not used. A
// signed-in account gets its token with its account session (accountToken
// option) before anyone is asked for a code. The billing and sign-in
// endpoints get the same token, so the server knows the caller holds the id
// they name:
//   POST /api/billing/transactions   a token, asking for a code if needed
//   GET  /api/billing/status         the token if there is one, never asks
//   POST /api/account/apple          the token if there is one, never asks

const TOKEN = 'sonmira.access';
const INSTALL = 'sonmira.install';
const GUARDED = { '/api/generate': 'generate', '/api/understand': 'understand' };
// method + path → may it ask for an invitation code?
const AUTHED = { 'POST /api/billing/transactions': true, 'GET /api/billing/status': false, 'POST /api/account/apple': false };

// The install id a token was issued for (its signed body), or null.
function tokenId(token) {
  try {
    const body = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(body)).i ?? null;
  } catch { return null; }
}

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
 *   installId?: () => string | Promise<string>,   // the device's id; default: one kept here
 *   accountToken?: () => string | null,            // the account session, when signed in
 * }} opts
 */
export function createApiClient({ fetchImpl, storage = globalThis.localStorage, askInvite = async () => null, sleep = sleepFor, origin = globalThis.location?.href ?? 'http://localhost/', pollLimitMs = 170_000, now = Date.now, installId: deviceId = null, accountToken = () => null }) {
  const store = safeStorage(storage);
  let memoryInstall = null, memoryToken = null;

  function localId() {
    let id = store.get(INSTALL) ?? memoryInstall;
    if (!id) { id = `i${randomId()}`; store.set(INSTALL, id); }
    memoryInstall = id;
    return id;
  }
  const currentId = async () => (deviceId ? await deviceId() : localId());
  // Only a token issued for the current id; one for an earlier id is dropped.
  async function getToken() {
    const t = store.get(TOKEN) ?? memoryToken;
    if (!t) return null;
    if (tokenId(t) === await currentId()) return t;
    setToken(null);
    return null;
  }
  const setToken = (t) => { memoryToken = t; if (t) store.set(TOKEN, t); else store.del(TOKEN); };

  async function session(body) {
    const res = await fetchImpl(new URL('/api/session', origin).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { res, body: await res.json().catch(() => null) };
  }

  // A signed-in account first; then, if allowed, one invitation prompt at a
  // time, however many requests need it.
  let asking = null, previewAccess;
  async function previewEnabled() {
    previewAccess ??= fetchImpl(new URL('/api/session', origin).href)
      .then((res) => res.ok ? res.json() : null)
      .then((body) => body?.autoAccess === true)
      .catch(() => false);
    return previewAccess;
  }
  async function obtainToken({ ask = true } = {}) {
    const installId = await currentId();
    const acct = accountToken();
    if (acct) {
      try {
        const r = await session({ accountToken: acct, installId });
        if (r.res.ok && r.body?.token) { setToken(r.body.token); return r.body.token; }
      } catch { /* no connection: an invitation can't be checked either */ }
    }
    if (!ask) return null;
    asking ??= (async () => {
      if (await previewEnabled()) {
        // Keep the server's signed token, seats, rate limits and spend cap.
        // Only the named Preview deployment allows this admission path.
        const r = await session({ preview: true, installId: await currentId() });
        if (r.res.ok && r.body?.token) { setToken(r.body.token); return r.body.token; }
        return null;
      }
      let error;
      for (let tries = 0; tries < 6; tries++) {
        const code = await askInvite({ error });
        if (!code) return null;
        let r;
        try { r = await session({ invite: code, installId: await currentId() }); } catch { error = 'network'; continue; }
        if (r.res.ok && r.body?.token) { setToken(r.body.token); return r.body.token; }
        error = r.body?.code || `http_${r.res.status}`;
      }
      return null;
    })().finally(() => { asking = null; });
    return asking;
  }

  function route(input, init) {
    const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
    let url;
    try { url = new URL(typeof input === 'string' ? input : input?.url ?? String(input), origin); } catch { return null; }
    if (url.origin !== new URL(origin).origin) return null;
    if (method === 'POST' && GUARDED[url.pathname]) return { endpoint: GUARDED[url.pathname] };
    const ask = AUTHED[`${method} ${url.pathname}`];
    return ask === undefined ? null : { authed: true, ask };
  }

  // Billing and sign-in: the token if there is (or can be) one; a refused
  // token is dropped and fetched again once.
  async function authedFetch(input, init, { ask }) {
    for (let retried = false; ; retried = true) {
      const token = (await getToken()) ?? (await obtainToken({ ask }));
      const headers = new Headers(init.headers);
      if (token) headers.set('authorization', `Bearer ${token}`);
      const res = await fetchImpl(input, { ...init, headers });
      if (res.status !== 401 || !token || retried) return res;
      setToken(null);
    }
  }

  async function guardedFetch(input, init = {}) {
    const r = route(input, init);
    if (!r) return fetchImpl(input, init);
    if (r.authed) return authedFetch(input, init, r);
    const { endpoint } = r;
    const key = `${currentKey() ?? `x${randomId()}`}.${endpoint}`;
    const until = now() + pollLimitMs;
    let invited = false;
    for (;;) {
      let token = await getToken();
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

  return { fetch: guardedFetch, installId: currentId, hasAccess: async () => Boolean(await getToken()), forget: () => setToken(null) };
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
  no_paintings: 'There are no paintings left to make right now. Your song is kept, so you can paint it later.',
};
export const guardMessage = (code) => COPY[code] ?? null;

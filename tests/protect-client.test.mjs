// The app's access client against the real guard, in-process: invitation,
// idempotency keys per take, waiting while a painting is still being made.
// The "paid" handler is a fake that counts calls. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, withGenerationKey, guardMessage } from '../src/app/protect/client.js';
import { protect, createSessionHandler, memoryKV } from '../server/protect/index.js';

const ENV = { SONMIRA_TOKEN_SECRET: 'client-test-secret-0123456789abcdef', SONMIRA_INVITE_CODES: 'MOON-RIVER-01' };
const ORIGIN = 'https://sonmira.test/';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// Routes fetch() to Vercel-style handlers, like the deployment would.
function server({ delay = 0, fail = () => false } = {}) {
  const kv = memoryKV();
  const calls = { generate: 0, understand: 0, other: 0 };
  const paid = (name) => async (_req, res) => {
    calls[name] += 1;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (fail(name, calls[name])) return res.status(502).json({ ok: false, code: 'provider_error' });
    res.status(200).json(name === 'generate' ? { ok: true, image: `img-${calls.generate}` } : { ok: true, transcript: { text: 'la' }, lyrics: null });
  };
  const deps = { env: ENV, kv, log: () => {} };
  const routes = {
    '/api/generate': protect('generate', paid('generate'), deps),
    '/api/understand': protect('understand', paid('understand'), deps),
    '/api/session': createSessionHandler(deps),
  };
  const seen = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
    const route = routes[url.pathname];
    if (!route) { calls.other += 1; return new Response('static', { status: 200 }); }
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    seen.push({ path: url.pathname, headers });
    let status = 200, body = null;
    const res = { setHeader() {}, status(n) { status = n; return res; }, json(o) { body = o; return res; }, end() { return res; } };
    await route({ method: init.method || 'GET', headers: { ...headers, 'x-forwarded-for': '1.1.1.1' }, body: init.body ? JSON.parse(init.body) : {} }, res);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls, seen };
}

const post = (client, path, body = {}, init = {}) => client.fetch(new URL(path, ORIGIN).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...init });
const noSleep = async () => {};

test('other requests pass through untouched', async () => {
  const s = server();
  const client = createApiClient({ fetchImpl: s.fetchImpl, storage: memoryStorage(), origin: ORIGIN, askInvite: async () => assert.fail('no invitation needed') });
  await client.fetch(`${ORIGIN}index.html`);
  await client.fetch(`${ORIGIN}api/generate`); // GET: configuration only
  assert.equal(s.calls.other, 1);
  assert.equal(s.seen.at(-1).headers.authorization, undefined);
});

test('asks for an invitation once, then paints; the code is remembered', async () => {
  const s = server(), storage = memoryStorage();
  const asked = [];
  const askInvite = async (o) => { asked.push(o.error ?? null); return asked.length === 1 ? 'wrong-code' : 'moon-river-01'; };
  const client = createApiClient({ fetchImpl: s.fetchImpl, storage, origin: ORIGIN, askInvite });
  const res = await withGenerationKey('take-a', () => post(client, '/api/generate', { spec: {} }));
  assert.equal(res.status, 200);
  assert.deepEqual(asked, [null, 'invalid_invite']);
  // A second client on the same device (a relaunch) needs no invitation.
  const again = createApiClient({ fetchImpl: s.fetchImpl, storage, origin: ORIGIN, askInvite: async () => assert.fail('asked twice') });
  assert.equal((await withGenerationKey('take-b', () => post(again, '/api/generate'))).status, 200);
  assert.equal(s.calls.generate, 2);
});

test('“Not now” returns invite_required without any paid call', async () => {
  const s = server();
  const client = createApiClient({ fetchImpl: s.fetchImpl, storage: memoryStorage(), origin: ORIGIN, askInvite: async () => null });
  const res = await post(client, '/api/generate');
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'invite_required');
  assert.equal(s.calls.generate, 0);
  assert.match(guardMessage('invite_required'), /kept/);
});

test('one take, many tries: understanding and painting are each paid once', async () => {
  const s = server();
  const client = createApiClient({ fetchImpl: s.fetchImpl, storage: memoryStorage(), origin: ORIGIN, askInvite: async () => 'MOONRIVER01' });
  const once = () => withGenerationKey('take-c', async () => {
    await post(client, '/api/understand', { audio: 'QUJD', mime: 'audio/mp4' });
    return post(client, '/api/generate', { spec: {} });
  });
  const first = await (await once()).json();
  const retry = await (await once()).json(); // e.g. the app timed out and Try again was tapped
  assert.deepEqual(retry, first);
  assert.deepEqual([s.calls.understand, s.calls.generate], [1, 1]);
  const keys = s.seen.filter((x) => x.path !== '/api/session').map((x) => x.headers['idempotency-key']);
  assert.deepEqual([...new Set(keys)].sort(), ['take-c.generate', 'take-c.understand']);
});

test('a failed painting is retried for real with the same take', async () => {
  const s = server({ fail: (name, n) => name === 'generate' && n === 1 });
  const client = createApiClient({ fetchImpl: s.fetchImpl, storage: memoryStorage(), origin: ORIGIN, askInvite: async () => 'MOONRIVER01' });
  assert.equal((await withGenerationKey('take-d', () => post(client, '/api/generate'))).status, 502);
  assert.equal((await withGenerationKey('take-d', () => post(client, '/api/generate'))).status, 200);
  assert.equal(s.calls.generate, 2);
});

test('while the same take is still painting, the client waits for it instead of paying again', async () => {
  const s = server({ delay: 40 });
  const sleeps = [];
  const client = createApiClient({ fetchImpl: s.fetchImpl, storage: memoryStorage(), origin: ORIGIN, askInvite: async () => 'MOONRIVER01', sleep: (ms) => { sleeps.push(ms); return new Promise((r) => setTimeout(r, 15)); } });
  await withGenerationKey('take-e', () => post(client, '/api/understand', { audio: 'QUJD', mime: 'audio/mp4' })); // token first
  // Two requests for one take at once (e.g. a relaunch resumed a draft while the first was in flight).
  const [a, b] = await Promise.all([withGenerationKey('take-e', () => post(client, '/api/generate')), withGenerationKey('take-e', () => post(client, '/api/generate'))]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(await b.json(), await a.json());
  assert.equal(s.calls.generate, 1);
  assert.ok(sleeps.length >= 1);
});

test('waiting stops when the caller gives up (its own timeout)', async () => {
  const s = server({ delay: 200 });
  const client = createApiClient({ fetchImpl: s.fetchImpl, storage: memoryStorage(), origin: ORIGIN, askInvite: async () => 'MOONRIVER01' });
  const first = withGenerationKey('take-f', () => post(client, '/api/generate'));
  await new Promise((r) => setTimeout(r, 30));
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 50);
  await assert.rejects(withGenerationKey('take-f', () => post(client, '/api/generate', {}, { signal: ctl.signal })));
  assert.equal((await first).status, 200);
  assert.equal(s.calls.generate, 1);
});

test('a revoked token asks for a new invitation once', async () => {
  const s = server(), storage = memoryStorage();
  storage.setItem('sonmira.access', 'v1.bogus.token');
  let asked = 0;
  const client = createApiClient({ fetchImpl: s.fetchImpl, storage, origin: ORIGIN, askInvite: async () => { asked += 1; return 'MOONRIVER01'; } });
  assert.equal((await post(client, '/api/generate')).status, 200);
  assert.equal(asked, 1);
});

test('without a take key every request still gets its own key', async () => {
  const s = server();
  const client = createApiClient({ fetchImpl: s.fetchImpl, storage: memoryStorage(), origin: ORIGIN, askInvite: async () => 'MOONRIVER01', sleep: noSleep });
  await post(client, '/api/generate');
  await post(client, '/api/generate');
  assert.equal(s.calls.generate, 2);
});

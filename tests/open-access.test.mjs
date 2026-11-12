// Open access: the App Store release paints without an invitation code
// (App Review Guideline 2.2 asked for no beta-only features in production).
// Everything after admission stays: the signed install token, rate limits,
// the paintings ledger (3 free, then 402 → the paywall) and the daily spend
// cap. Real guard, client and ledger; the paid call is a counting fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApiClient, withGenerationKey } from '../src/app/protect/client.js';
import { protect, createSessionHandler, createAuthorize, createSeats, memoryKV, protectConfig, openAccessOn, OPEN_INVITE } from '../server/protect/index.js';
import { createLedger } from '../server/billing/ledger.js';
import { createCharge } from '../server/billing/charge.js';

const ORIGIN = 'https://sonmira.test/';
// Production as Vercel runs it, with no invitation codes configured at all.
const PROD = {
  VERCEL_ENV: 'production', SONMIRA_TOKEN_SECRET: 'open-test-secret-0123456789abcdef0123',
  SONMIRA_DAILY_CAP_USD: '100', SONMIRA_LIMIT_IP_HOUR: '1000', SONMIRA_LIMIT_SESSION_IP_HOUR: '1000',
};

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function server(env = PROD, { billing = true, ip = '1.1.1.1' } = {}) {
  const kv = memoryKV();
  const ledger = createLedger({ kv, sleep: async () => {} });
  const calls = { generate: 0 };
  const paid = async (_req, res) => { calls.generate += 1; res.status(200).json({ ok: true, image: `img-${calls.generate}` }); };
  const deps = { env, kv, log: () => {}, charge: billing ? createCharge({ ledger, mode: 'on' }) : null };
  const authorize = createAuthorize({ env, kv });
  const routes = {
    '/api/generate': protect('generate', paid, deps),
    '/api/session': createSessionHandler({ env, kv, log: () => {} }),
    '/api/billing/status': async (req, res) => {
      const id = new URL(req.url, ORIGIN).searchParams.get('account');
      if (!(await authorize(req, id))) return res.status(401).json({ ok: false, code: 'unauthorized' });
      res.status(200).json({ ok: true });
    },
  };
  const seen = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    seen.push({ path: url.pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    let status = 200, body = null;
    const res = { setHeader() {}, status(n) { status = n; return res; }, json(o) { body = o; return res; }, end() { return res; } };
    await routes[url.pathname]({ method: init.method || 'GET', url: url.href, headers: { ...headers, 'x-forwarded-for': ip }, body: init.body ? JSON.parse(init.body) : {} }, res);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls, seen, kv, ledger };
}

// One take: the client derives the Idempotency-Key from it, as the app does.
const paint = (client, key) => withGenerationKey(key.replace(/\.generate$/, ''), () => client.fetch(new URL('/api/generate', ORIGIN).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
const newClient = (s, opts = {}) => {
  const id = opts.id ?? randomUUID();
  let asked = 0;
  const client = createApiClient({ fetchImpl: s.fetchImpl, storage: memoryStorage(), origin: ORIGIN, sleep: async () => {}, installId: async () => id, ...(opts.askInvite ? { askInvite: async () => { asked += 1; return null; } } : {}) });
  return { client, id, asked: () => asked };
};

test('open access is on in Production by default, off elsewhere, and can be switched', () => {
  assert.equal(openAccessOn({ VERCEL_ENV: 'production' }), true);
  assert.equal(openAccessOn({ VERCEL_ENV: 'production', SONMIRA_OPEN_ACCESS: '0' }), false);
  assert.equal(openAccessOn({ VERCEL_ENV: 'preview' }), false);
  assert.equal(openAccessOn({ VERCEL_ENV: 'preview', SONMIRA_OPEN_ACCESS: '1' }), true);
  assert.equal(openAccessOn({}), false);
  // Open access never runs without a token secret and a store.
  assert.equal(protectConfig({ VERCEL_ENV: 'production' }).secret, '');
});

test('a fresh install paints in Production without an invitation code, and is never asked for one', async () => {
  const s = server();
  const { client, asked } = newClient(s, { askInvite: true });
  const res = await paint(client, 'take-0001.generate');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).image, 'img-1');
  assert.equal(asked(), 0);
  assert.deepEqual(s.seen.filter((x) => x.path === '/api/session').map((x) => Object.keys(x.body).sort()), [['installId', 'open']]);
});

test('three free paintings, then 402 no_paintings (the paywall); a replay is free and counted once', async () => {
  const s = server();
  const { client, id } = newClient(s);
  for (let i = 1; i <= 3; i++) assert.equal((await paint(client, `take-000${i}.generate`)).status, 200);
  // The same take again: the stored result, no new paid call, not counted again.
  assert.equal((await paint(client, 'take-0003.generate')).status, 200);
  assert.equal(s.calls.generate, 3);
  const fourth = await paint(client, 'take-0004.generate');
  assert.equal(fourth.status, 402);
  assert.equal((await fourth.json()).code, 'no_paintings');
  assert.equal(s.calls.generate, 3);
  assert.equal((await s.ledger.status(id)).free, 0);
});

test('a returning install keeps its token and paints again without a new admission', async () => {
  const s = server();
  const id = randomUUID(), storage = memoryStorage();
  const make = () => createApiClient({ fetchImpl: s.fetchImpl, storage, origin: ORIGIN, sleep: async () => {}, installId: async () => id });
  assert.equal((await paint(make(), 'take-0001.generate')).status, 200);
  assert.equal((await paint(make(), 'take-0002.generate')).status, 200); // relaunch: same storage
  assert.equal(s.seen.filter((x) => x.path === '/api/session' && x.method === 'POST').length, 1);
});

test('open tokens are not capped per invitation code, but per install, per network and by the spend cap', async () => {
  // The per-code daily cap (60) would have stopped the whole public at 1 here.
  const s = server({ ...PROD, SONMIRA_LIMIT_INVITE_GENERATE_DAY: '1' }, { billing: false });
  for (let i = 0; i < 3; i++) assert.equal((await paint(newClient(s).client, `take-000${i}.generate`)).status, 200);
  // Per install per hour still applies.
  const lim = server({ ...PROD, SONMIRA_LIMIT_GENERATE_HOUR: '1' }, { billing: false });
  const { client } = newClient(lim);
  assert.equal((await paint(client, 'take-0001.generate')).status, 200);
  assert.equal((await paint(client, 'take-0002.generate')).status, 429);
  // The daily spend cap still applies (0.15 USD = one image).
  const capped = server({ ...PROD, SONMIRA_DAILY_CAP_USD: '0.15' }, { billing: false });
  assert.equal((await paint(newClient(capped).client, 'take-0001.generate')).status, 200);
  const over = await paint(newClient(capped).client, 'take-0002.generate');
  assert.equal(over.status, 503);
  assert.equal((await over.json()).code, 'spend_cap');
});

test('new installs per network address a day are limited; an install already admitted is not counted again', async () => {
  const s = server({ ...PROD, SONMIRA_LIMIT_OPEN_INSTALLS_IP_DAY: '2' });
  const session = (installId) => s.fetchImpl(`${ORIGIN}api/session`, { method: 'POST', body: JSON.stringify({ open: true, installId }) });
  const a = randomUUID(), b = randomUUID();
  assert.equal((await session(a)).status, 200);
  assert.equal((await session(b)).status, 200);
  assert.equal((await session(a)).status, 200); // again: same seat, not a new install
  const third = await session(randomUUID());
  assert.equal(third.status, 429);
  assert.equal((await third.json()).code, 'rate_limited');
});

test('without open access (a test deployment) the server refuses it and the invitation flow is unchanged', async () => {
  const env = { ...PROD, VERCEL_ENV: 'preview', SONMIRA_INVITE_CODES: 'MOON-RIVER-01' };
  const s = server(env, { billing: false });
  const refused = await s.fetchImpl(`${ORIGIN}api/session`, { method: 'POST', body: JSON.stringify({ open: true, installId: randomUUID() }) });
  assert.equal(refused.status, 401);
  // No code given ("Not now"): calm copy, no paid call.
  const { client, asked } = newClient(s, { askInvite: true });
  const res = await paint(client, 'take-0001.generate');
  assert.equal(res.status, 401);
  assert.equal(asked(), 1);
  assert.equal(s.calls.generate, 0);
  // Nor without any way in: no codes and open access off.
  const closed = server({ ...PROD, SONMIRA_OPEN_ACCESS: '0' });
  assert.equal((await paint(newClient(closed).client, 'take-0001.generate')).status, 401);
});

test('turning open access off revokes open tokens; deleting an account frees its open seat', async () => {
  const s = server(PROD, { billing: false });
  const id = randomUUID();
  const r = await s.fetchImpl(`${ORIGIN}api/session`, { method: 'POST', body: JSON.stringify({ open: true, installId: id }) });
  const { token } = await r.json();
  assert.equal(await s.kv.get(`seat:${id}`), OPEN_INVITE);
  const req = { headers: { authorization: `Bearer ${token}` } };
  assert.equal(await createAuthorize({ env: PROD, kv: s.kv })(req, id), true);
  assert.equal(await createAuthorize({ env: { ...PROD, SONMIRA_OPEN_ACCESS: '0', SONMIRA_INVITE_CODES: 'MOON-RIVER-01' }, kv: s.kv })(req, id), false);
  // Deletion: the seat goes, so the token stops working.
  await createSeats({ env: PROD, kv: s.kv }).eraseAccount(id);
  assert.equal(await s.kv.get(`seat:${id}`), null);
  assert.equal(await createAuthorize({ env: PROD, kv: s.kv })(req, id), false);
});

test('an open token authorizes billing for its own id only', async () => {
  const s = server();
  const { client, id } = newClient(s);
  assert.equal((await paint(client, 'take-0001.generate')).status, 200);
  assert.equal((await client.fetch(`${ORIGIN}api/billing/status?account=${id}`)).status, 200);
  assert.equal((await client.fetch(`${ORIGIN}api/billing/status?account=${randomUUID()}`)).status, 401);
});

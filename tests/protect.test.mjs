// Generation guard: invitations, install limits, the daily spend cap and
// idempotent results. No network and no paid calls: the paid handler is a
// fake that counts how often it would have called the provider. Every case
// runs against the in-memory store and, when redis-server is installed,
// against real Redis (the same Lua scripts Upstash runs).

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { protect, createSessionHandler, memoryKV, redisKV, signToken, verifyToken, inviteId, timedFetch } from '../server/protect/index.js';
import { hasRedis, startRedis } from './helpers/redis.mjs';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const ENV = { SONMIRA_TOKEN_SECRET: SECRET, SONMIRA_INVITE_CODES: 'MOON-RIVER-01, SUNNY-DAY-02' };
const INSTALL = 'install-aaaaaaaaaaaaaaaa';
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);

const tokenFor = (installId = INSTALL, code = 'MOONRIVER01') => signToken(SECRET, { installId, invite: inviteId(code), now: T0 });
// A token is only good while its install holds a seat on the code (the
// session handler gives it one); guard() seats the request's install first.
const seatFor = async (kv, r) => {
  const who = verifyToken(SECRET, String(r.headers?.authorization ?? '').slice(7));
  if (who) await kv.join(`invite:${who.invite}:installs`, who.installId, 100, 86400);
};

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.end = () => res;
  return res;
}
const req = ({ token = tokenFor(), key = 'take-0001-generate', body = { spec: {} }, ip = '1.2.3.4', method = 'POST' } = {}) => ({
  method, body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}), 'x-forwarded-for': ip },
});

// Stands in for api/generate.js: one "paid call" per run.
function paidHandler({ status = 200, body = { ok: true, image: 'data:image/jpeg;base64,QUJD', usage: { total_tokens: 1 } }, delay = 0, throws = false } = {}) {
  const h = async (_req, res) => {
    h.calls += 1;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (throws) throw new Error('boom');
    res.status(status).json(typeof body === 'function' ? body() : body);
  };
  h.calls = 0;
  return h;
}

const call = async (handler, r = req()) => { const res = fakeRes(); await handler(r, res); return res; };

function suite(name, makeKV) {
  describe(`guard (${name})`, () => {
    let kv, clock;
    const env = (extra = {}) => ({ ...ENV, ...extra });
    const guard = (endpoint, h, extra) => {
      const g = protect(endpoint, h, { env: env(extra), kv, now: () => clock, log: () => {} });
      return async (r, res) => { await seatFor(kv, r); return g(r, res); };
    };
    const fresh = async () => { kv = await makeKV(); clock = T0; };

    test('refuses without an invitation token, a valid signature or a live code', async () => {
      await fresh();
      const h = paidHandler(), g = guard('generate', h);
      assert.equal((await call(g, req({ token: null }))).body.code, 'invite_required');
      assert.equal((await call(g, req({ token: tokenFor().replace(/.$/, 'x') }))).body.code, 'invite_required');
      // A code removed from SONMIRA_INVITE_CODES revokes its tokens.
      const revoked = protect('generate', h, { env: env({ SONMIRA_INVITE_CODES: 'SUNNY-DAY-02' }), kv, now: () => clock, log: () => {} });
      assert.equal((await call(revoked)).statusCode, 401);
      assert.equal(h.calls, 0);
    });

    test('requires an idempotency key, and passes GET through', async () => {
      await fresh();
      const h = paidHandler(), g = guard('generate', h);
      assert.equal((await call(g, req({ key: null }))).body.code, 'idempotency_key_required');
      await call(g, req({ method: 'GET' }));
      assert.equal(h.calls, 1); // the GET only
    });

    test('fails closed when the store, secret or codes are missing', async () => {
      await fresh();
      const h = paidHandler();
      assert.equal((await call(protect('generate', h, { env: ENV, kv: null, log: () => {} }))).body.code, 'not_configured');
      assert.equal((await call(protect('generate', h, { env: { ...ENV, SONMIRA_TOKEN_SECRET: '' }, kv, log: () => {} }))).statusCode, 503);
      assert.equal(h.calls, 0);
    });

    test('the same key twice makes one paid call; the second gets the stored result', async () => {
      await fresh();
      const h = paidHandler(), g = guard('generate', h);
      const a = await call(g), b = await call(g);
      assert.equal(h.calls, 1);
      assert.deepEqual(b.body, a.body);
      assert.equal(b.headers['x-sonmira-replay'], '1');
    });

    test('a large result is stored in parts and replayed intact', async () => {
      await fresh();
      const image = `data:image/jpeg;base64,${'A'.repeat(900_000)}`;
      const h = paidHandler({ body: { ok: true, image } }), g = guard('generate', h);
      await call(g);
      assert.equal((await call(g)).body.image, image);
      assert.equal(h.calls, 1);
    });

    test('a request with the same key while one is running gets in_progress, not a second paid call', async () => {
      await fresh();
      const h = paidHandler({ delay: 60 }), g = guard('generate', h);
      const [a, b] = await Promise.all([call(g), call(g)]);
      assert.equal(h.calls, 1);
      const codes = [a, b].map((r) => r.body.code ?? 'ok').sort();
      assert.deepEqual(codes, ['in_progress', 'ok']);
      assert.equal([a, b].find((r) => r.body.code)?.statusCode, 409);
    });

    test('a failed generation can be retried with the same key', async () => {
      await fresh();
      let fail = true;
      const h = paidHandler({ body: () => (fail ? { ok: false, code: 'provider_error' } : { ok: true, image: 'x' }) });
      const g = guard('generate', async (r, res) => { await h(r, { status: (n) => res.status(fail ? 502 : n), json: (o) => res.json(o), setHeader: () => {} }); });
      assert.equal((await call(g)).statusCode, 502);
      fail = false;
      assert.equal((await call(g)).body.ok, true);
      assert.equal(h.calls, 2);
    });

    test('per-install hourly and daily limits; replays do not count', async () => {
      await fresh();
      const h = paidHandler(), g = guard('generate', h, { SONMIRA_LIMIT_GENERATE_HOUR: '2', SONMIRA_LIMIT_GENERATE_DAY: '3' });
      assert.equal((await call(g, req({ key: 'take-0001-g' }))).statusCode, 200);
      assert.equal((await call(g, req({ key: 'take-0001-g' }))).statusCode, 200); // replay
      assert.equal((await call(g, req({ key: 'take-0002-g' }))).statusCode, 200);
      const limited = await call(g, req({ key: 'take-0003-g' }));
      assert.equal(limited.statusCode, 429);
      assert.equal(limited.body.code, 'rate_limited');
      clock += 3600_000; // next hour: the hourly window resets, the daily one does not
      assert.equal((await call(g, req({ key: 'take-0003-g' }))).statusCode, 200);
      assert.equal((await call(g, req({ key: 'take-0004-g' }))).statusCode, 429);
      // Another install is not affected.
      assert.equal((await call(g, req({ key: 'take-0004-g', token: tokenFor('install-bbbbbbbbbbbbbbbb') }))).statusCode, 200);
      assert.equal(h.calls, 4);
    });

    test('per-invitation and per-address limits cover many installs', async () => {
      await fresh();
      const h = paidHandler(), g = guard('generate', h, { SONMIRA_LIMIT_INVITE_GENERATE_DAY: '2' });
      for (const [i, want] of [[1, 200], [2, 200], [3, 429]]) {
        assert.equal((await call(g, req({ key: `take-000${i}-g`, token: tokenFor(`install-${'x'.repeat(15)}${i}`) }))).statusCode, want);
      }
      const byIp = guard('generate', paidHandler(), { SONMIRA_LIMIT_IP_HOUR: '1' });
      assert.equal((await call(byIp, req({ key: 'take-0101-g', ip: '9.9.9.9' }))).statusCode, 200);
      assert.equal((await call(byIp, req({ key: 'take-0102-g', ip: '9.9.9.9', token: tokenFor('install-cccccccccccccccc') }))).statusCode, 429);
    });

    test('the daily cap is hard and counts requests still in flight', async () => {
      await fresh();
      // $0.50 cap, $0.15 per image: three may run at once, the fourth is refused
      // while the first three are still painting.
      const h = paidHandler({ delay: 80 }), g = guard('generate', h, { SONMIRA_DAILY_CAP_USD: '0.5', SONMIRA_LIMIT_IP_HOUR: '100' });
      const tokens = [1, 2, 3, 4].map((i) => tokenFor(`install-${'y'.repeat(15)}${i}`));
      const results = await Promise.all(tokens.map((token, i) => call(g, req({ token, key: `take-100${i}-g` }))));
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 200, 200, 503]);
      assert.equal(results.find((r) => r.statusCode === 503).body.code, 'spend_cap');
      assert.equal(h.calls, 3);
      // The next UTC day starts a new budget.
      clock += 24 * 3600_000;
      assert.equal((await call(g, req({ token: tokens[3], key: 'take-2000-g' }))).statusCode, 200);
    });

    test('a refusal before the provider releases its reservation; a provider failure keeps it', async () => {
      await fresh();
      const cap = { SONMIRA_DAILY_CAP_USD: '0.3' }; // two images
      const bad = guard('generate', paidHandler({ status: 400, body: { ok: false, error: 'invalid spec' } }), cap);
      for (let i = 0; i < 3; i++) assert.equal((await call(bad, req({ key: `take-300${i}-g` }))).statusCode, 400);
      const broken = guard('generate', paidHandler({ status: 502, body: { ok: false, code: 'provider_error' } }), cap);
      assert.equal((await call(broken, req({ key: 'take-4000-g' }))).statusCode, 502);
      const good = guard('generate', paidHandler(), cap);
      assert.equal((await call(good, req({ key: 'take-4001-g' }))).statusCode, 200);
      assert.equal((await call(good, req({ key: 'take-4002-g' }))).body.code, 'spend_cap');
    });

    test('a handler that throws keeps the reservation and answers 500', async () => {
      await fresh();
      const g = guard('generate', paidHandler({ throws: true }), { SONMIRA_DAILY_CAP_USD: '0.15' });
      assert.equal((await call(g)).statusCode, 500);
      assert.equal((await call(guard('generate', paidHandler(), { SONMIRA_DAILY_CAP_USD: '0.15' }), req({ key: 'take-5000-g' }))).body.code, 'spend_cap');
    });

    test('understand: oversized audio is refused, and a hum settles without the text model', async () => {
      await fresh();
      const big = { audio: 'A'.repeat(1_400_001), mime: 'audio/mp4' };
      const h = paidHandler({ body: { ok: true, transcript: { text: '' }, lyrics: null } });
      const g = guard('understand', h, { SONMIRA_DAILY_CAP_USD: '0.02', SONMIRA_COST_TRANSCRIBE_USD: '0.01', SONMIRA_COST_TEXT_USD: '0.01' });
      assert.equal((await call(g, req({ body: big, key: 'take-6000-u' }))).statusCode, 413);
      // Each call reserves $0.02 but settles $0.01 (no words): two fit in $0.02.
      assert.equal((await call(g, req({ body: { audio: 'QUJD', mime: 'audio/mp4' }, key: 'take-6001-u' }))).statusCode, 200);
      assert.equal((await call(g, req({ body: { audio: 'QUJD', mime: 'audio/mp4' }, key: 'take-6002-u' }))).statusCode, 503);
      assert.equal(h.calls, 1);
    });

    test('session: a valid code admits an install, a bad code does not, and each code has a device limit', async () => {
      await fresh();
      const s = createSessionHandler({ env: env({ SONMIRA_LIMIT_INSTALLS_PER_INVITE: '2' }), kv, now: () => clock, log: () => {} });
      const ask = (invite, installId, ip = '5.5.5.5') => call(s, { method: 'POST', body: { invite, installId }, headers: { 'x-forwarded-for': ip } });
      assert.equal((await ask('nope-nope', INSTALL)).body.code, 'invalid_invite');
      const ok = await ask(' moon-river-01 ', INSTALL);
      assert.equal(ok.body.ok, true);
      // The token it returns works on the paid endpoint.
      const h = paidHandler();
      assert.equal((await call(guard('generate', h), req({ token: ok.body.token }))).statusCode, 200);
      assert.equal((await ask('MOONRIVER01', INSTALL)).body.ok, true); // same device again: no new place
      assert.equal((await ask('MOONRIVER01', 'install-dddddddddddddddd')).body.ok, true);
      assert.equal((await ask('MOONRIVER01', 'install-eeeeeeeeeeeeeeee')).body.code, 'invite_full');
    });

    test('session: guessing codes is rate limited per address', async () => {
      await fresh();
      const s = createSessionHandler({ env: env({ SONMIRA_LIMIT_SESSION_IP_HOUR: '3' }), kv, now: () => clock, log: () => {} });
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await call(s, { method: 'POST', body: { invite: `GUESS-${i}00000`, installId: INSTALL }, headers: { 'x-forwarded-for': '6.6.6.6' } })).body.code);
      assert.deepEqual(codes, ['invalid_invite', 'invalid_invite', 'invalid_invite', 'rate_limited']);
    });
  });
}

suite('memory', async () => memoryKV({ now: () => Date.now() }));

if (hasRedis()) {
  let redis, n = 0;
  before(async () => { redis = await startRedis(); });
  after(() => redis?.stop());
  // Each case gets its own prefix, so cases never see each other's keys.
  suite('redis', async () => redisKV(redis.exec, { prefix: `t${++n}:` }));
}

test('timedFetch aborts a request that runs too long, body included', async () => {
  const slow = (_url, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  await assert.rejects(timedFetch(30, slow)('https://example.invalid'), { code: 'timeout' });
});

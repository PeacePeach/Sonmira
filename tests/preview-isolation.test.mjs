// A Preview with real AI may share Production's Redis. Its keys live under
// their own namespace (spend and cap, rate limits, seats, results, billing,
// accounts), and Production's key names are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kvFromEnv, kvNamespace } from '../server/protect/kv.js';
import { kvFromEnv as billingKV } from '../server/billing/kv.js';
import { createUpstashStore } from '../src/account/stores.js';
import { createSessionHandler } from '../server/protect/index.js';

const KV = { KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 'kv-token' };
const recorder = () => {
  const sent = [];
  const fetchImpl = async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ result: 1 }), { status: 200 }); };
  return { sent, fetchImpl };
};
const keyOf = (cmd) => (cmd[0] === 'EVAL' ? cmd[3] : cmd[1]);

test('Preview keys are namespaced; Production keys are unchanged', async () => {
  assert.equal(kvNamespace({ VERCEL_ENV: 'production' }), '');
  assert.equal(kvNamespace({ VERCEL_ENV: 'preview' }), 'preview:');
  assert.equal(kvNamespace({}), '');
  for (const [env, prefix] of [['production', 'sonmira:spend:'], ['preview', 'sonmira:preview:spend:']]) {
    const r = recorder();
    const kv = kvFromEnv({ VERCEL: '1', VERCEL_ENV: env, ...KV }, { fetchImpl: r.fetchImpl });
    await kv.adjust('spend:2026-10-19', 1, 60);
    await kv.hit('rl:ip:x', 60);
    await kv.get('seat:a');
    assert.equal(keyOf(r.sent[0]), `${prefix}2026-10-19`, env);
    for (const c of r.sent) assert.ok(keyOf(c).startsWith(env === 'preview' ? 'sonmira:preview:' : 'sonmira:') && (env === 'preview' || !keyOf(c).startsWith('sonmira:preview:')), env);
  }
});

test('billing and account keys follow the same namespace', async () => {
  const p = recorder();
  await billingKV({ VERCEL: '1', VERCEL_ENV: 'preview', ...KV }, { fetchImpl: p.fetchImpl }).get('wallet:a');
  assert.equal(p.sent[0][1], 'sonmira:preview:wallet:a');
  const q = recorder();
  await billingKV({ VERCEL: '1', VERCEL_ENV: 'production', ...KV }, { fetchImpl: q.fetchImpl }).get('wallet:a');
  assert.equal(q.sent[0][1], 'sonmira:wallet:a');
  const a = recorder();
  const store = createUpstashStore({ url: 'https://kv.test', token: 't', fetchImpl: a.fetchImpl, prefix: 'preview:' });
  await store.get('acct:1');
  await store.set('acct:1', { x: 1 }, { nx: true });
  await store.del('acct:1', 'acct:2');
  await store.hit('rl:1', 60);
  assert.deepEqual(a.sent.map((c) => c.slice(0, c[0] === 'DEL' ? 3 : 2)), [['GET', 'preview:acct:1'], ['SET', 'preview:acct:1'], ['DEL', 'preview:acct:1', 'preview:acct:2'], ['INCR', 'preview:rl:1'], ['EXPIRE', 'preview:rl:1']]);
  assert.deepEqual(a.sent[1].slice(2), [JSON.stringify({ x: 1 }), 'NX']);
  assert.equal(a.sent[4][2], 60);
  const plain = recorder();
  await createUpstashStore({ url: 'https://kv.test', token: 't', fetchImpl: plain.fetchImpl }).get('acct:1');
  assert.deepEqual(plain.sent[0], ['GET', 'acct:1']);
});

test('GET /api/session reports Preview readiness with no secret, and nothing extra in Production', async () => {
  const get = async (env) => {
    let body; const res = { setHeader() {}, status() { return res; }, json(v) { body = v; return res; } };
    await createSessionHandler({ env, log: () => {}, kv: kvFromEnv(env, { fetchImpl: recorder().fetchImpl }) })({ method: 'GET', headers: {} }, res);
    return body;
  };
  const secret = 'preview-secret-0123456789abcdef0123';
  const ready = await get({ VERCEL: '1', VERCEL_ENV: 'preview', ...KV, SONMIRA_TOKEN_SECRET: secret, SONMIRA_INVITE_CODES: 'HAN-TEST-28', SONMIRA_FAKE_PROVIDER: '0', SONMIRA_DAILY_CAP_USD: '3' });
  assert.deepEqual(ready.guard, { ready: true, store: 'redis', namespace: 'sonmira:preview:', tokenSecret: true, inviteCodes: 1, dailyCapUsd: 3, fakeProvider: false });
  assert.doesNotMatch(JSON.stringify(ready), /preview-secret|HANTEST28|HAN-TEST-28|kv-token/);
  const missing = await get({ VERCEL: '1', VERCEL_ENV: 'preview' });
  assert.equal(missing.guard.ready, false);
  assert.equal(missing.guard.store, 'none');
  const prod = await get({ VERCEL: '1', VERCEL_ENV: 'production', ...KV, SONMIRA_TOKEN_SECRET: secret, SONMIRA_INVITE_CODES: 'HAN-TEST-28' });
  assert.equal(prod.guard, undefined);
});

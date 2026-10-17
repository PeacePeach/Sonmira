import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountHandlers } from '../src/account/http.js';
import { createAccounts } from '../src/account/accounts.js';
import { createMemoryStore } from '../src/account/stores.js';
import { verifyIdentityToken, verifyAppleNotification } from '../src/account/apple.js';
import { buildFromEnv, handlers as deployed, createDeployedHandlers, perAddressLimit, LIMITS } from '../src/account/deploy.js';
import { randomId } from '../src/account/encoding.js';
import { fakeApple, SECRET } from './account-helpers.mjs';

const apple = await fakeApple();
const deps = {
  accounts: createAccounts({ store: createMemoryStore(), secret: SECRET, verifyIdentity: (t, n) => verifyIdentityToken(t, { audience: 'app.sonmira', rawNonce: n, getKey: apple.getKey }) }),
  verifyNotification: (p) => verifyAppleNotification(p, { audience: 'app.sonmira', getKey: apple.getKey }),
  authorize: async () => true,
};
const h = createAccountHandlers(async () => deps);

async function call(handler, body, method = 'POST', req = {}) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method, body, headers: {}, ...req }, res);
  return { status: res.statusCode, json: JSON.parse(res.body), headers: res.headers };
}

test('sign in, renew, and the error shapes', async () => {
  const rawNonce = randomId(), accountId = randomId();
  const r = await call(h.apple, { identityToken: await apple.token({ sub: 'h-1', rawNonce }), rawNonce, accountId });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'linked');
  assert.equal(r.json.accountId, accountId);
  assert.equal(r.headers['cache-control'], 'no-store');
  const s = await call(h.session, { token: r.json.token });
  assert.equal(s.status, 200);
  assert.equal(s.json.accountId, accountId);
  assert.equal((await call(h.session, { token: 'bad' })).status, 401);
  assert.equal((await call(h.apple, { identityToken: 'bad', rawNonce, accountId })).json.error, 'invalid_identity');
  assert.equal((await call(h.apple, {}, 'GET')).status, 405);
  assert.equal((await call(h.apple, '{not json')).status, 400);
});

test('notifications: verified events are applied, forged ones refused', async () => {
  const t = Math.floor(Date.now() / 1000);
  const payload = await apple.sign({ iss: 'https://appleid.apple.com', aud: 'app.sonmira', iat: t, exp: t + 600, events: JSON.stringify({ type: 'consent-revoked', sub: 'h-1' }) });
  assert.deepEqual((await call(h.notifications, { payload })).json, { ok: true });
  assert.equal((await call(h.notifications, { payload: 'forged' })).status, 400);
});

test('fails closed without configuration', async () => {
  assert.equal(buildFromEnv({}), null);
  assert.equal(buildFromEnv({ SONMIRA_ACCOUNT_SECRET: 'short' }), null);
  assert.equal(buildFromEnv({ SONMIRA_ACCOUNT_SECRET: SECRET, VERCEL_ENV: 'preview' }), null, 'deployed needs the shared store');
  assert.equal(buildFromEnv({ SONMIRA_ACCOUNT_SECRET: SECRET, VERCEL_ENV: 'production', KV_REST_API_URL: 'https://kv', KV_REST_API_TOKEN: 't' }), null, 'production needs the Apple key for deletion');
  assert.ok(buildFromEnv({ SONMIRA_ACCOUNT_SECRET: SECRET }), 'local development may use memory');
  const saved = process.env.SONMIRA_ACCOUNT_SECRET;
  delete process.env.SONMIRA_ACCOUNT_SECRET;
  const r = await call(deployed.apple, { identityToken: 'x', rawNonce: 'y', accountId: randomId() });
  assert.deepEqual([r.status, r.json.error], [503, 'not_configured']);
  if (saved) process.env.SONMIRA_ACCOUNT_SECRET = saved;
});

test('sign-in needs proof that the caller holds the account id it sends', async () => {
  const owner = randomId(), stranger = randomId();
  const authorize = async (req, id) => req.headers['x-install-token'] === `token-for-${id}`;
  const guarded = createAccountHandlers(async () => ({ ...deps, authorize }));
  const signIn = async (accountId, token, sub) => {
    const rawNonce = randomId();
    return call(guarded.apple, { identityToken: await apple.token({ sub, rawNonce }), rawNonce, accountId }, 'POST', { headers: { 'x-install-token': token } });
  };
  // Someone who learned a guest's id can't sign it into their own Apple ID.
  const r = await signIn(owner, `token-for-${stranger}`, 'attacker');
  assert.deepEqual([r.status, r.json.error], [401, 'unauthorized']);
  assert.equal((await signIn(owner, undefined, 'attacker')).status, 401);
  assert.equal((await signIn(owner, `token-for-${owner}`, 'owner')).json.status, 'linked');
  // Recovery on a fresh install, before it has an install token: the Apple ID's
  // account comes back, and the unproven id is neither linked nor merged.
  const fresh = randomId();
  const back = await signIn(fresh, undefined, 'owner');
  assert.deepEqual([back.status, back.json.status, back.json.accountId], [200, 'returning', owner]);
  // A different, proven guest signing in with that Apple ID is merged as before.
  const other = randomId();
  assert.deepEqual((await signIn(other, `token-for-${other}`, 'owner')).json.accountId, owner);
  // No check configured → refuse rather than trust the id.
  const open = createAccountHandlers(async () => ({ ...deps, authorize: null }));
  const rawNonce = randomId();
  const o = await call(open.apple, { identityToken: await apple.token({ sub: 'x', rawNonce }), rawNonce, accountId: randomId() });
  assert.deepEqual([o.status, o.json.error], [503, 'not_configured']);
});

test('deployed builds refuse sign-in until the guard check is supplied; local allows', async () => {
  const kv = { KV_REST_API_URL: 'https://kv', KV_REST_API_TOKEN: 't' };
  assert.equal(buildFromEnv({ SONMIRA_ACCOUNT_SECRET: SECRET, VERCEL: '1', VERCEL_ENV: 'preview', ...kv }).authorize, null);
  const check = async () => true;
  assert.equal(buildFromEnv({ SONMIRA_ACCOUNT_SECRET: SECRET, VERCEL: '1', VERCEL_ENV: 'preview', ...kv }, { authorize: check }).authorize, check);
  assert.equal(await buildFromEnv({ SONMIRA_ACCOUNT_SECRET: SECRET }).authorize({}, randomId()), true);
});

test('the integration composes the endpoints through createDeployedHandlers', async () => {
  const seen = [];
  const hs = createDeployedHandlers({ authorize: async () => false, limit: async (req, name) => { seen.push(name); return true; } }, { SONMIRA_ACCOUNT_SECRET: SECRET });
  const r = await call(hs.apple, { identityToken: 'x', rawNonce: 'y', accountId: randomId() });
  assert.deepEqual([r.status, seen], [401, ['apple']]);
  const ledger = { merge: async () => {}, erase: async () => {} };
  assert.ok(buildFromEnv({ SONMIRA_ACCOUNT_SECRET: SECRET }, { ledger }).accounts);
});

test('each endpoint is rate limited per address', async () => {
  let t = 0;
  const limit = perAddressLimit(createMemoryStore(), { now: () => t });
  const limited = createAccountHandlers(async () => ({ ...deps, limit }));
  const from = (ip) => ({ headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } });
  for (let i = 0; i < LIMITS.delete; i++) assert.notEqual((await call(limited.delete, {}, 'POST', from('1.1.1.1'))).status, 429);
  const r = await call(limited.delete, {}, 'POST', from('1.1.1.1'));
  assert.deepEqual([r.status, r.json.error], [429, 'rate_limited']);
  assert.notEqual((await call(limited.delete, {}, 'POST', from('2.2.2.2'))).status, 429, 'another address is unaffected');
  assert.notEqual((await call(limited.session, {}, 'POST', from('1.1.1.1'))).status, 429, 'limits are per endpoint');
  t += 60_000;
  assert.notEqual((await call(limited.delete, {}, 'POST', from('1.1.1.1'))).status, 429, 'the window moves on');
});

test('an unproven id is never merged, even when the Apple ID has an account', async () => {
  const calls = [];
  const ledger = { merge: async (a, b) => calls.push(['merge', a, b]), erase: async () => {} };
  const seats = { adoptSeat: async (a, b) => calls.push(['adopt', a, b]), eraseAccount: async () => {} };
  const verifyIdentity = (t, n) => verifyIdentityToken(t, { audience: 'app.sonmira', rawNonce: n, getKey: apple.getKey });
  const accounts = createAccounts({ store: createMemoryStore(), secret: SECRET, verifyIdentity, ledger, seats });
  const signIn = async (accountId, deviceProven) => { const rawNonce = randomId(); return accounts.signInWithApple({ identityToken: await apple.token({ sub: 'u', rawNonce }), rawNonce, accountId, deviceProven }); };
  const a = randomId(), victim = randomId(), b = randomId();
  await assert.rejects(signIn(a, false), { code: 'unauthorized' }, 'nothing to recover, nothing linked');
  await signIn(a, true);
  assert.equal((await signIn(victim, false)).accountId, a);
  assert.deepEqual(calls, []);
  await signIn(b, true);
  assert.deepEqual(calls, [['merge', b, a], ['adopt', b, a]]);
});

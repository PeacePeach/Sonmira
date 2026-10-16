import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountHandlers } from '../src/account/http.js';
import { createAccounts } from '../src/account/accounts.js';
import { createMemoryStore } from '../src/account/stores.js';
import { verifyIdentityToken, verifyAppleNotification } from '../src/account/apple.js';
import { buildFromEnv, handlers as deployed } from '../src/account/deploy.js';
import { randomId } from '../src/account/encoding.js';
import { fakeApple, SECRET } from './account-helpers.mjs';

const apple = await fakeApple();
const deps = {
  accounts: createAccounts({ store: createMemoryStore(), secret: SECRET, verifyIdentity: (t, n) => verifyIdentityToken(t, { audience: 'app.sonmira', rawNonce: n, getKey: apple.getKey }) }),
  verifyNotification: (p) => verifyAppleNotification(p, { audience: 'app.sonmira', getKey: apple.getKey }),
};
const h = createAccountHandlers(async () => deps);

async function call(handler, body, method = 'POST') {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method, body }, res);
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

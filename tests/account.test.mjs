import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../src/account/accounts.js';
import { createMemoryStore } from '../src/account/stores.js';
import { verifyIdentityToken } from '../src/account/apple.js';
import { randomId } from '../src/account/encoding.js';
import { fakeApple, SECRET } from './account-helpers.mjs';

const apple = await fakeApple();

function setup(over = {}) {
  const store = createMemoryStore();
  const calls = [];
  const ledger = { merge: async (a, b) => calls.push(['merge', a, b]), erase: async (a) => calls.push(['erase', a]) };
  const seats = { adoptSeat: async (a, b) => calls.push(['adoptSeat', a, b]), eraseAccount: async (a) => calls.push(['eraseAccount', a]) };
  const revoked = [];
  const accounts = createAccounts({
    store, secret: SECRET, ledger, seats,
    verifyIdentity: (t, n) => verifyIdentityToken(t, { audience: 'app.sonmira', rawNonce: n, getKey: apple.getKey }),
    revokeApple: async (code) => { revoked.push(code); return { revoked: true }; },
    ...over,
  });
  return { store, accounts, calls, revoked };
}

async function signIn(accounts, { sub = 'apple-1', accountId = randomId() } = {}) {
  const rawNonce = randomId();
  return { accountId, ...(await accounts.signInWithApple({ identityToken: await apple.token({ sub, rawNonce }), rawNonce, accountId })) };
}
const errCode = (code) => (e) => e.code === code;

test('a guest signing in with a new Apple ID keeps its own account id', async () => {
  const { accounts, calls, store } = setup();
  const id = randomId();
  const r = await signIn(accounts, { accountId: id });
  assert.equal(r.status, 'linked');
  assert.equal(r.accountId, id);
  assert.deepEqual(calls, [], 'nothing to merge');
  const keys = Object.keys(store.dump());
  assert.ok(!keys.some((k) => k.includes('apple-1')), 'the Apple user id is never stored in plain form');
  assert.ok(!JSON.stringify(store.dump()).includes('apple-1'));
});

test('signing in again on the same device is idempotent', async () => {
  const { accounts } = setup();
  const id = randomId();
  await signIn(accounts, { accountId: id });
  const again = await signIn(accounts, { accountId: id });
  assert.equal(again.status, 'linked');
  assert.equal(again.accountId, id);
});

test('a second device merges its guest data into the existing account', async () => {
  const { accounts, calls } = setup();
  const first = await signIn(accounts, { sub: 'apple-1' });
  const guest = randomId();
  const r = await signIn(accounts, { sub: 'apple-1', accountId: guest });
  assert.equal(r.status, 'returning');
  assert.equal(r.accountId, first.accountId);
  assert.deepEqual(calls, [['merge', guest, first.accountId], ['adoptSeat', guest, first.accountId]]);
  // the old guest id keeps resolving to the account (a retry, or a delayed request)
  const retry = await signIn(accounts, { sub: 'apple-1', accountId: guest });
  assert.equal(retry.accountId, first.accountId);
  assert.equal(retry.status, 'returning');
});

test('a merge whose hook failed finishes on retry', async () => {
  let fail = true;
  const done = [];
  const { accounts } = setup({ ledger: { merge: async (a, b) => { if (fail) throw new Error('kv down'); done.push([a, b]); }, erase: async () => {} } });
  const first = await signIn(accounts, { sub: 'apple-1' });
  const guest = randomId();
  await assert.rejects(signIn(accounts, { sub: 'apple-1', accountId: guest }), errCode('merge_failed'));
  fail = false;
  const r = await signIn(accounts, { sub: 'apple-1', accountId: guest });
  assert.equal(r.accountId, first.accountId);
  assert.deepEqual(done, [[guest, first.accountId]]);
});

test('an account signed in to one Apple ID never merges with another', async () => {
  const { accounts } = setup();
  const a = await signIn(accounts, { sub: 'apple-1' });
  await assert.rejects(signIn(accounts, { sub: 'apple-2', accountId: a.accountId }), errCode('signed_in_elsewhere'));
});

test('two devices racing with the same new Apple ID end on one account', async () => {
  const { accounts } = setup();
  const [x, y] = await Promise.all([signIn(accounts, { sub: 'apple-r' }), signIn(accounts, { sub: 'apple-r' })]);
  assert.equal(x.accountId === y.accountId || [x.status, y.status].includes('returning'), true);
  const z = await signIn(accounts, { sub: 'apple-r' });
  assert.ok([x.accountId, y.accountId].includes(z.accountId));
});

test('bad input and bad tokens are refused', async () => {
  const { accounts } = setup();
  await assert.rejects(accounts.signInWithApple({ identityToken: 'x', rawNonce: 'n', accountId: 'short' }), errCode('bad_request'));
  await assert.rejects(accounts.signInWithApple({ identityToken: 'x.y.z', rawNonce: 'n', accountId: randomId() }), errCode('invalid_identity'));
  const replay = await apple.token({ sub: 'apple-1', rawNonce: 'original' });
  await assert.rejects(accounts.signInWithApple({ identityToken: replay, rawNonce: 'different', accountId: randomId() }), errCode('invalid_identity'));
});

test('sessions renew and verify for the guard', async () => {
  const { accounts } = setup();
  const r = await signIn(accounts);
  const renewed = await accounts.renew(r.token);
  assert.equal(renewed.accountId, r.accountId);
  assert.deepEqual(await accounts.verifyAccount(renewed.token), { accountId: r.accountId });
  assert.equal(await accounts.verifyAccount(r.token.slice(0, -2) + 'xx'), null);
  assert.equal(await accounts.verifyAccount('nonsense'), null);
  await assert.rejects(accounts.renew('nonsense'), errCode('session_ended'));
});

test('a token from another secret is refused', async () => {
  const a = setup();
  const b = setup({ secret: 'another-secret-another-secret-another-sec' });
  const r = await signIn(a.accounts);
  assert.equal(await b.accounts.verifyAccount(r.token), null);
});

test('deletion needs the same Apple ID, revokes Apple first and erases everything', async () => {
  const { accounts, calls, revoked, store } = setup();
  const first = await signIn(accounts, { sub: 'apple-1' });
  const guest = randomId();
  await signIn(accounts, { sub: 'apple-1', accountId: guest });
  calls.length = 0;

  const other = randomId();
  await assert.rejects(accounts.deleteAccount({ token: first.token, identityToken: await apple.token({ sub: 'apple-2', rawNonce: other }), rawNonce: other, authorizationCode: 'c' }), errCode('not_this_account'));
  assert.deepEqual(revoked, []);
  assert.deepEqual(calls, []);

  const n = randomId();
  const r = await accounts.deleteAccount({ token: first.token, identityToken: await apple.token({ sub: 'apple-1', rawNonce: n }), rawNonce: n, authorizationCode: 'code-1' });
  assert.deepEqual(r, { deleted: true, revoked: true });
  assert.deepEqual(revoked, ['code-1']);
  assert.deepEqual(calls, [['erase', first.accountId], ['eraseAccount', first.accountId], ['eraseAccount', guest]]);
  assert.deepEqual(store.dump(), {}, 'nothing left on the server');
  assert.equal(await accounts.verifyAccount(first.token), null, 'old sessions stop working');

  // signing in again later starts fresh
  const again = await signIn(accounts, { sub: 'apple-1' });
  assert.equal(again.status, 'linked');
});

test('if Apple revocation fails, nothing is deleted', async () => {
  const { accounts, calls } = setup({ revokeApple: async () => { throw new Error('apple down'); } });
  const a = await signIn(accounts);
  const n = randomId();
  await assert.rejects(accounts.deleteAccount({ token: a.token, identityToken: await apple.token({ sub: 'apple-1', rawNonce: n }), rawNonce: n, authorizationCode: 'c' }), errCode('apple_unavailable'));
  assert.deepEqual(calls, []);
  assert.ok(await accounts.verifyAccount(a.token));
});

test('Apple consent revoked signs out everywhere but keeps the account findable', async () => {
  const { accounts } = setup();
  const a = await signIn(accounts, { sub: 'apple-1' });
  assert.deepEqual(await accounts.appleEvent({ type: 'consent-revoked', sub: 'apple-1' }), { handled: true, action: 'signed_out' });
  assert.equal(await accounts.verifyAccount(a.token), null);
  const back = await signIn(accounts, { sub: 'apple-1' });
  assert.equal(back.accountId, a.accountId);
  assert.equal(back.status, 'returning');
});

test('Apple ID deleted erases the account', async () => {
  const { accounts, calls, store } = setup();
  const a = await signIn(accounts, { sub: 'apple-1' });
  assert.equal((await accounts.appleEvent({ type: 'account-delete', sub: 'apple-1' })).action, 'deleted');
  assert.deepEqual(calls, [['erase', a.accountId], ['eraseAccount', a.accountId]]);
  assert.deepEqual(store.dump(), {});
  assert.deepEqual(await accounts.appleEvent({ type: 'account-delete', sub: 'nobody' }), { handled: false });
});

test('refuses to start with a short secret', () => {
  assert.throws(() => createAccounts({ store: createMemoryStore(), secret: 'short', verifyIdentity: async () => ({}) }));
});

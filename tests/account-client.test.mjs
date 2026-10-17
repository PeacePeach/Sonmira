// The account on the device, against the real account logic (in-process) and
// a scripted Apple. Covers the states the screens show.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount } from '../src/app/account/index.js';
import { AppleError } from '../src/app/account/apple.js';
import { createAccounts, AccountError as ServerError } from '../src/account/accounts.js';
import { createMemoryStore } from '../src/account/stores.js';
import { sha256Hex } from '../src/account/encoding.js';
import { SECRET } from './account-helpers.mjs';

function world() {
  const accounts = createAccounts({
    store: createMemoryStore(), secret: SECRET,
    verifyIdentity: async (t, n) => { const [, sub, nonce] = t.split('.'); if (nonce !== await sha256Hex(n)) throw new Error('nonce'); return { sub }; },
  });
  let online = true;
  const guard = (fn) => async (...a) => { if (!online) { const e = new Error('offline'); e.status = 0; throw e; } try { return await fn(...a); } catch (e) { if (e instanceof ServerError) { const x = new Error(e.code); x.code = e.code; x.status = e.status; throw x; } throw e; } };
  const remote = { signIn: guard((b) => accounts.signInWithApple(b)), renew: guard((t) => accounts.renew(t)), remove: guard((b) => accounts.deleteAccount(b)) };
  return { accounts, remote, setOnline: (v) => { online = v; } };
}

function scriptedApple(script) {
  const states = {};
  return {
    states,
    async signIn({ nonce }) {
      const next = script.shift();
      if (next instanceof Error) throw next;
      if (next === 'cancel') return { status: 'cancelled' };
      return { status: 'success', user: next, identityToken: `t.${next}.${nonce}`, authorizationCode: 'code' };
    },
    async credentialState(user) { return states[user] || 'authorized'; },
  };
}

function memoryBox() { let v = null; return { read: () => v, write: (x) => { v = JSON.parse(JSON.stringify(x)); } }; }

test('starts as a guest with a guard-compatible id that survives a relaunch', () => {
  const box = memoryBox();
  const a = createAccount({ apple: scriptedApple([]), remote: world().remote, box });
  assert.match(a.id, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(a.status().signedIn, false);
  const b = createAccount({ apple: scriptedApple([]), remote: world().remote, box });
  assert.equal(b.id, a.id);
});

test('sign in links, cancel changes nothing, errors keep the guest as it was', async () => {
  const w = world();
  const apple = scriptedApple(['cancel', new AppleError('network'), new AppleError('notAvailable'), 'u-1']);
  const a = createAccount({ apple, remote: w.remote, box: memoryBox() });
  const id = a.id;
  assert.deepEqual(await a.signIn(), { status: 'cancelled' });
  await assert.rejects(a.signIn(), (e) => e.kind === 'network');
  await assert.rejects(a.signIn(), (e) => e.kind === 'notAvailable');
  assert.equal(a.id, id);
  assert.equal(a.status().signedIn, false);
  assert.deepEqual(await a.signIn(), { status: 'linked' });
  assert.equal(a.id, id);
  assert.equal(a.status().signedIn, true);
  assert.ok(a.status().since);
});

test('server down after Apple says yes: nothing changes', async () => {
  const w = world();
  const a = createAccount({ apple: scriptedApple(['u-1']), remote: w.remote, box: memoryBox() });
  w.setOnline(false);
  await assert.rejects(a.signIn(), (e) => e.kind === 'network');
  assert.equal(a.status().signedIn, false);
});

test('a second iPhone adopts the existing account id', async () => {
  const w = world();
  const phone1 = createAccount({ apple: scriptedApple(['u-1']), remote: w.remote, box: memoryBox() });
  await phone1.signIn();
  const phone2 = createAccount({ apple: scriptedApple(['u-1']), remote: w.remote, box: memoryBox() });
  assert.notEqual(phone2.id, phone1.id);
  assert.deepEqual(await phone2.signIn(), { status: 'returning' });
  assert.equal(phone2.id, phone1.id);
});

test('sign out makes the device a fresh guest', async () => {
  const w = world();
  const a = createAccount({ apple: scriptedApple(['u-1', 'u-1']), remote: w.remote, box: memoryBox() });
  await a.signIn();
  const accountId = a.id;
  a.signOut();
  assert.equal(a.status().signedIn, false);
  assert.notEqual(a.id, accountId);
  assert.deepEqual(await a.signIn(), { status: 'returning' }, 'signing in again finds the account');
  assert.equal(a.id, accountId);
});

test('delete: cancel keeps everything; another Apple ID is refused; same Apple ID deletes', async () => {
  const w = world();
  const apple = scriptedApple(['u-1', 'cancel', 'u-2', 'u-1']);
  const a = createAccount({ apple, remote: w.remote, box: memoryBox() });
  await a.signIn();
  const token = () => a.status().signedIn;
  assert.deepEqual(await a.remove(), { status: 'cancelled' });
  assert.equal(token(), true);
  await assert.rejects(a.remove(), (e) => e.kind === 'notThisAccount');
  assert.equal(token(), true);
  const accountId = a.id;
  assert.deepEqual(await a.remove(), { status: 'deleted' });
  assert.equal(token(), false);
  assert.notEqual(a.id, accountId);
});

test('launch check: revoked at Apple or ended on the server signs out; offline keeps the session', async () => {
  const w = world();
  const apple = scriptedApple(['u-1', 'u-1']);
  const a = createAccount({ apple, remote: w.remote, box: memoryBox() });
  assert.equal(await a.check(), 'guest');
  await a.signIn();
  assert.equal(await a.check(), 'signedIn');
  w.setOnline(false);
  assert.equal(await a.check(), 'offline');
  assert.equal(a.status().signedIn, true);
  w.setOnline(true);
  apple.states['u-1'] = 'revoked';
  assert.equal(await a.check(), 'signedOut');
  assert.equal(a.status().signedIn, false);

  delete apple.states['u-1'];
  await a.signIn();
  await w.accounts.appleEvent({ type: 'consent-revoked', sub: 'u-1' });
  assert.equal(await a.check(), 'signedOut', 'a session the server ended');
});

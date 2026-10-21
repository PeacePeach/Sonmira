// The painting wallet: free tier, Daily Ritual, Little Moments, and the
// rule that only a successful painting is ever counted. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWallet } from '../src/app/billing/wallet.js';

function setup({ day = '2026-10-16', now = 1_800_000_000_000 } = {}) {
  const clock = { day, now };
  let saved = null;
  const make = () => createWallet({ load: () => saved, save: (s) => { saved = JSON.parse(JSON.stringify(s)); }, today: () => clock.day, now: () => clock.now });
  return { clock, make, w: make() };
}
const paint = (w, key) => { assert.ok(w.reserve(key), `reserve ${key}`); return w.commit(key); };

test('three free paintings, then nothing', () => {
  const { w } = setup();
  assert.equal(w.status().free, 3);
  for (const k of ['a', 'b', 'c']) assert.equal(paint(w, k), 'free');
  assert.equal(w.status().canCreate, false);
  assert.equal(w.reserve('d'), null);
});

test('a failed or interrupted generation is never counted', () => {
  const { w } = setup();
  w.reserve('a');
  assert.equal(w.status().free, 2, 'held while painting');
  w.release('a');
  assert.equal(w.status().free, 3, 'given back');
});

test('retrying the same take counts once', () => {
  const { w } = setup();
  w.reserve('a'); w.reserve('a');
  assert.equal(w.status().free, 2);
  w.commit('a'); w.commit('a');
  assert.equal(w.reserve('a'), 'free', 'already painted: no new hold');
  assert.equal(w.status().free, 2);
});

test('the last free painting, counted by the server, stays usable after the app adopts its ledger', () => {
  // The server counts a take under its request key (take key + '.generate').
  const server = setup().w;
  for (const k of ['a.generate', 'b.generate', 'c.generate']) paint(server, k);
  const { w } = setup();
  w.reserve('c'); // the app was painting c when it closed
  w.releaseAll(); // and opened again
  w.replace(server.snapshot());
  assert.equal(w.status().free, 0);
  assert.equal(w.status().canCreate, false, 'nothing new can be made');
  assert.equal(w.reserve('c'), 'free', 'the painting already made needs no credit');
  assert.equal(w.commit('c'), 'free');
  assert.equal(w.status().free, 0, 'and is not counted again');
  assert.equal(w.reserve('d'), null, 'a new take still needs one');
});

test('a take the server counted while the app held it is counted once', () => {
  const server = setup().w;
  paint(server, 'a.generate');
  const { w } = setup();
  w.reserve('a');
  w.replace(server.snapshot()); // the ledger arrives before the app's own commit
  assert.equal(w.commit('a'), 'free');
  assert.equal(w.status().free, 2, 'counted once');
  assert.deepEqual(w.snapshot().holds, {});
});

test('holds left by a restart go back', () => {
  const { w, make } = setup();
  w.reserve('a');
  const after = make();
  assert.equal(after.releaseAll(), 1);
  assert.equal(after.status().free, 3);
});

test('a pack adds ten once per transaction, and they never expire', () => {
  const { w, clock } = setup();
  ['a', 'b', 'c'].forEach((k) => paint(w, k));
  assert.equal(w.grant('tx1', 10), true);
  assert.equal(w.grant('tx1', 10), false, 'same transaction delivered twice');
  clock.day = '2027-10-16'; clock.now += 365 * 864e5;
  assert.equal(w.status().credits, 10);
  assert.equal(paint(w, 'd'), 'credits');
  assert.equal(w.status().credits, 9);
});

test('Daily Ritual: a credit a day, saved up; extra from packs', () => {
  const { w, clock } = setup();
  ['a', 'b', 'c'].forEach((k) => paint(w, k));
  w.setSubscription({ productId: 'sub', from: clock.now, expiresAt: clock.now + 30 * 864e5, willRenew: true });
  assert.equal(w.status().ritual, 1, 'the first day’s credit at once');
  assert.equal(paint(w, 'd'), 'daily');
  assert.equal(w.status().canCreate, false, 'tomorrow’s credit is not lent today');
  w.grant('tx1', 10);
  assert.equal(paint(w, 'e'), 'credits', 'same-day extra comes from the pack');
  clock.now += 2 * 864e5; // two more days: two credits
  assert.equal(w.status().ritual, 2);
  assert.equal(paint(w, 'f'), 'daily');
  assert.equal(paint(w, 'g'), 'daily');
  assert.equal(w.status().source, 'credits');
});

test('Daily Ritual credits are used before free paintings and packs', () => {
  const { w, clock } = setup();
  w.grant('tx1', 10);
  w.setSubscription({ productId: 'sub', from: clock.now, expiresAt: clock.now + 864e5, willRenew: true });
  assert.equal(paint(w, 'a'), 'daily');
  assert.equal(paint(w, 'b'), 'free');
});

test('an ended subscription keeps pack credits and its Daily Ritual credits', () => {
  const { w, clock } = setup();
  ['a', 'b', 'c'].forEach((k) => paint(w, k));
  w.grant('tx1', 10);
  w.setSubscription({ productId: 'sub', from: clock.now, expiresAt: clock.now + 864e5, willRenew: false });
  clock.now += 2 * 864e5; clock.day = '2026-10-18';
  const s = w.status();
  assert.equal(s.subscribed, false);
  assert.equal(s.credits, 10);
  assert.equal(s.ritual, 1, 'the one day paid for');
  assert.equal(s.source, 'daily');
  clock.now += 365 * 864e5;
  assert.equal(w.status().ritual, 1, 'never expires');
  assert.equal(w.status().source, 'daily');
});

test('the ledger survives a reinstall when adopted', () => {
  const { w } = setup();
  w.grant('tx1', 10); paint(w, 'a'); paint(w, 'b');
  const ledger = w.snapshot();
  const fresh = setup().w;
  fresh.replace(ledger);
  assert.deepEqual([fresh.status().free, fresh.status().credits], [1, 10]);
  assert.equal(fresh.grant('tx1', 10), false, 'restored transactions are not granted again');
});

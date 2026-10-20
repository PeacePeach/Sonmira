// Daily Ritual credits: one per subscription day, saved up to 30, kept for
// 30 days after the paid subscription ends, never lent ahead of their day.
// The wallet's rules, which the server's ledger runs too. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWallet } from '../src/app/billing/wallet.js';

const DAY = 864e5, HOUR = 3600e3;
const T0 = 1_800_000_000_000;
const SUB = 'app.sonmira.daily_ritual.monthly';

function setup(saved = null) {
  const clock = { now: T0, day: '2027-01-15' };
  let state = saved;
  const make = () => createWallet({ load: () => state, save: (s) => { state = JSON.parse(JSON.stringify(s)); }, today: () => clock.day, now: () => clock.now });
  const w = make();
  // Paid periods as Apple signs them: a start and an end per transaction.
  const periods = [];
  const pay = (from, days, { willRenew = true, backfill } = {}) => {
    periods.push([from, from + days * DAY]);
    w.setSubscription({ productId: SUB, expiresAt: Math.max(...periods.map((p) => p[1])), willRenew, periods }, backfill === undefined ? undefined : { backfill });
  };
  return { clock, w, pay, periods, make, state: () => state };
}
const paint = (w, key) => { const src = w.reserve(key); if (src) w.commit(key); return src; };
const useFree = (w) => ['f1', 'f2', 'f3'].forEach((k) => w.replace({ ...w.snapshot(), free: 0 }));

test('one credit when Daily Ritual starts, then one every 24 hours; unused ones add up', () => {
  const { w, clock, pay } = setup();
  useFree(w);
  pay(clock.now, 30);
  assert.equal(w.status().ritual, 1);
  clock.now += DAY - 1;
  assert.equal(w.status().ritual, 1, 'not a moment early');
  clock.now += 1;
  assert.equal(w.status().ritual, 2);
  clock.now += 3 * DAY;
  assert.equal(w.status().ritual, 5, 'days unopened still count');
});

test('several paintings in one day, while credits last', () => {
  const { w, clock, pay } = setup();
  useFree(w);
  pay(clock.now, 30);
  clock.now += 4 * DAY;
  for (const k of ['a', 'b', 'c', 'd', 'e']) assert.equal(paint(w, k), 'daily');
  assert.equal(w.status().ritual, 0);
  assert.equal(w.status().canCreate, false);
});

test('credits are never lent from days to come, and spending doesn’t bring the next one sooner', () => {
  const { w, clock, pay } = setup();
  useFree(w);
  pay(clock.now, 30);
  assert.equal(paint(w, 'a'), 'daily');
  assert.equal(w.reserve('b'), null, 'tomorrow’s credit can’t be used today');
  assert.equal(w.status().ritual, 0, 'never below zero');
  assert.equal(w.status().ritualNextAt, T0 + DAY, 'the next one lands on its day');
  clock.now += 23 * HOUR;
  assert.equal(w.reserve('b'), null, 'still not');
  clock.now += HOUR;
  assert.equal(paint(w, 'b'), 'daily');
  assert.equal(w.status().ritualNextAt, T0 + 2 * DAY, 'same rhythm after spending');
});

test('a Little Moments pack can be used at once, the same day the daily credit ran out', () => {
  const { w, clock, pay } = setup();
  useFree(w);
  pay(clock.now, 30);
  paint(w, 'a');
  w.grant('pack1', 10);
  assert.equal(paint(w, 'b'), 'credits');
  assert.equal(w.status().credits, 9);
});

test('the balance stops at 30; a day at 30 is not banked for later', () => {
  const { w, clock, pay } = setup();
  useFree(w);
  pay(clock.now, 400);
  clock.now += 45 * DAY;
  assert.equal(w.status().ritual, 30);
  assert.equal(w.status().ritualNextAt, null, 'nothing more to come while full');
  paint(w, 'a');
  assert.equal(w.status().ritual, 29);
  clock.now += DAY;
  assert.equal(w.status().ritual, 30);
  clock.now += DAY;
  assert.equal(w.status().ritual, 30);
});

test('Little Moments credits are separate: no cap, no expiry, spent after Daily Ritual and free', () => {
  const { w, clock, pay } = setup();
  for (let i = 0; i < 5; i++) w.grant(`pack${i}`, 10);
  pay(clock.now, 1, { willRenew: false });
  clock.now += 40 * DAY;
  assert.equal(w.status().credits, 50);
  assert.equal(w.status().ritual, 0);
  pay(clock.now, 30);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((k) => paint(w, k)), ['daily', 'free', 'free', 'free', 'credits']);
});

test('auto-renew turned off: credits keep coming until the paid month ends, then stay 30 days', () => {
  const { w, clock, pay } = setup();
  useFree(w);
  pay(clock.now, 30, { willRenew: false });
  clock.now += 10 * DAY;
  assert.equal(w.status().subscribed, true);
  assert.equal(w.status().ritual, 11);
  assert.equal(w.status().ritualExpiresAt, T0 + 60 * DAY, 'shown while it is ending');
  clock.now = T0 + 30 * DAY + HOUR; // the month is over
  assert.equal(w.status().subscribed, false);
  assert.equal(w.status().ritual, 30, 'all 30 days of the month, none after it');
  clock.now += 5 * DAY;
  assert.equal(w.status().ritual, 30);
  assert.equal(w.status().ritualNextAt, null);
  clock.now = T0 + 60 * DAY - 1;
  assert.equal(w.status().ritual, 30, 'still there on the last moment');
  clock.now = T0 + 60 * DAY;
  assert.equal(w.status().ritual, 0, 'gone 30 days after the end');
  assert.equal(w.status().ritualExpiresAt, null);
});

test('subscribing again within 30 days keeps the balance and starts the days again, still capped', () => {
  const { w, clock, pay } = setup();
  useFree(w);
  pay(clock.now, 30, { willRenew: false });
  clock.now += 9 * DAY;
  paint(w, 'a');
  clock.now = T0 + 40 * DAY;
  assert.equal(w.status().ritual, 29);
  pay(clock.now, 30);
  assert.equal(w.status().ritual, 30, 'kept, plus today, capped');
  paint(w, 'b'); paint(w, 'c');
  clock.now += DAY;
  assert.equal(w.status().ritual, 29);
});

test('subscribing again after the 30 days starts from one', () => {
  const { w, clock, pay } = setup();
  useFree(w);
  pay(clock.now, 30, { willRenew: false });
  clock.now = T0 + 75 * DAY;
  pay(clock.now, 30);
  assert.equal(w.status().ritual, 1);
});

test('a lapse the app never saw still clears the old balance before new days count', () => {
  const { w, clock, pay, make } = setup();
  useFree(w);
  pay(clock.now, 30, { willRenew: false });
  clock.now += 10 * DAY;
  assert.equal(w.status().ritual, 11);
  // Away for months; meanwhile Apple says they subscribed again on day 70.
  clock.now = T0 + 72 * DAY;
  pay(T0 + 70 * DAY, 30);
  assert.equal(w.status().ritual, 3, 'only the new days: 70, 71 and 72');
  assert.equal(make().status().ritual, 3, 'as saved');
});

test('renewals continue the same rhythm; the same period sent again adds nothing', () => {
  const { w, clock, pay, periods } = setup();
  useFree(w);
  pay(clock.now, 30);
  clock.now = T0 + 29 * DAY + HOUR;
  assert.equal(w.status().ritual, 30);
  paint(w, 'a'); paint(w, 'b');
  pay(T0 + 30 * DAY + 5000, 30); // Apple signs the renewal seconds after the expiry
  for (let i = 0; i < 3; i++) w.setSubscription({ productId: SUB, expiresAt: T0 + 60 * DAY, willRenew: true, periods }); // StoreKit refresh, notification, restore
  assert.equal(w.status().ritual, 28);
  clock.now = T0 + 30 * DAY + HOUR;
  assert.equal(w.status().ritual, 29, 'day 31, once');
  assert.equal(w.status().ritualNextAt, T0 + 31 * DAY);
});

test('a renewal that arrives late (offline, no notification) pays the days it covered, once', () => {
  const { w, clock, pay, periods } = setup();
  useFree(w);
  pay(clock.now, 30);
  clock.now = T0 + 29 * DAY + HOUR;
  for (let i = 0; i < 29; i++) paint(w, `d${i}`);
  clock.now = T0 + 33 * DAY + HOUR; // the server only knew of the first month
  assert.equal(w.status().subscribed, false);
  assert.equal(w.status().ritual, 1);
  pay(T0 + 30 * DAY, 30);
  assert.equal(w.status().ritual, 5, 'days 30 to 33');
  w.setSubscription({ productId: SUB, expiresAt: T0 + 60 * DAY, willRenew: true, periods });
  assert.equal(w.status().ritual, 5, 'sent again: nothing more');
});

test('a billing grace period counts as paid days; billing retry without grace does not', () => {
  const { w, clock, pay, periods } = setup();
  useFree(w);
  pay(clock.now, 1);
  paint(w, 'a');
  // Grace: Apple keeps access for 6 days while it retries.
  periods.push([T0 + DAY, T0 + 7 * DAY]);
  w.setSubscription({ productId: SUB, expiresAt: T0 + 7 * DAY, willRenew: true, periods });
  clock.now = T0 + 3 * DAY;
  assert.equal(w.status().ritual, 3);
  // Without grace nothing accrues until a renewal goes through.
  const b = setup();
  useFree(b.w);
  b.pay(b.clock.now, 1);
  b.clock.now = T0 + 4 * DAY;
  assert.equal(b.w.status().ritual, 1);
  b.pay(T0 + 4 * DAY, 30); // the retry succeeds on day 4: a new run
  assert.equal(b.w.status().ritual, 2);
});

test('a refund takes back what is left of that period’s credits; reversing it gives them back', () => {
  const { w, clock, pay, periods } = setup();
  useFree(w);
  w.grant('pack1', 10);
  pay(clock.now, 30);
  clock.now += 9 * DAY;
  paint(w, 'a'); paint(w, 'b');
  assert.equal(w.status().ritual, 8);
  assert.equal(w.refundRitual('t1', periods[0]), 8);
  assert.equal(w.refundRitual('t1', periods[0]), 0, 'once');
  w.setSubscription(null);
  assert.equal(w.status().ritual, 0);
  assert.equal(w.status().credits, 10, 'packs untouched');
  assert.equal(w.unrefundRitual('t1'), 8);
  w.setSubscription({ productId: SUB, expiresAt: periods[0][1], willRenew: true, periods }, { backfill: false });
  assert.equal(w.status().ritual, 8, 'given back once, not paid again');
});

test('a failed painting uses nothing; the same take never pays twice', () => {
  const { w, clock, pay } = setup();
  useFree(w);
  pay(clock.now, 30);
  clock.now += DAY;
  assert.equal(w.reserve('a'), 'daily');
  assert.equal(w.status().ritual, 1, 'held while painting');
  w.release('a');
  assert.equal(w.status().ritual, 2, 'handed back');
  paint(w, 'b');
  assert.equal(w.reserve('b'), 'daily', 'already painted');
  w.commit('b');
  assert.equal(w.status().ritual, 1);
  assert.equal(w.commit('b.generate'), null, 'nothing held under the server key');
  assert.equal(w.status().ritual, 1);
});

test('calendar days and time zones don’t move credits: only paid time does', () => {
  const { w, clock, pay } = setup();
  useFree(w);
  pay(clock.now, 30);
  paint(w, 'a');
  for (const day of ['2027-01-16', '2027-01-17', '2026-12-01']) { clock.day = day; assert.equal(w.status().ritual, 0); }
});

test('migration: a subscriber from before keeps today’s painting as one credit, and nothing is paid out for past days', () => {
  const old = (dailyUsed) => ({ v: 1, free: 0, credits: 4, sub: { productId: SUB, expiresAt: T0 + 20 * DAY, willRenew: true }, dailyUsed, holds: {}, spent: {}, granted: { p: 10 }, revoked: {}, purchased: true });
  const unused = setup(old('2027-01-14'));
  assert.equal(unused.w.status().ritual, 1);
  assert.equal(unused.w.status().credits, 4, 'packs as they were');
  const used = setup(old('2027-01-15'));
  assert.equal(used.w.status().ritual, 0);
  assert.equal(used.w.status().canCreate, true, 'packs still usable');
  // Days keep coming from here on, from the period the old record knew.
  used.clock.now += DAY;
  assert.equal(used.w.status().ritual, 1);
  // The server then learns the real start of that month: no back pay.
  used.w.setSubscription({ productId: SUB, expiresAt: T0 + 20 * DAY, willRenew: true, periods: [[T0 - 10 * DAY, T0 + 20 * DAY]] });
  assert.equal(used.w.status().ritual, 1);
  const lapsed = setup({ ...old('2027-01-01'), sub: { productId: SUB, expiresAt: T0 - DAY, willRenew: false } });
  assert.equal(lapsed.w.status().ritual, 0, 'not subscribed: nothing to carry');
});

test('the app’s copy adopts the ledger and keeps counting the same way', () => {
  const server = setup();
  useFree(server.w);
  server.pay(server.clock.now, 30);
  server.clock.now += 2 * DAY;
  const phone = setup();
  phone.clock.now = server.clock.now;
  phone.w.replace(server.w.snapshot());
  assert.equal(phone.w.status().ritual, 3);
  phone.clock.now += DAY;
  assert.equal(phone.w.status().ritual, 4);
});

test('StoreKit’s subscription without its start (the app’s refresh) neither lends nor repeats credits', () => {
  const { w, clock } = setup();
  useFree(w);
  // A purchase just made: the first credit, at once.
  w.setSubscription({ productId: SUB, expiresAt: clock.now + 30 * DAY, willRenew: true });
  assert.equal(w.status().ritual, 1);
  for (let i = 0; i < 3; i++) w.setSubscription({ productId: SUB, expiresAt: clock.now + 30 * DAY, willRenew: true });
  assert.equal(w.status().ritual, 1);
  clock.now += DAY;
  w.setSubscription({ productId: SUB, expiresAt: T0 + 60 * DAY, willRenew: true }); // renewed early in the period's end
  assert.equal(w.status().ritual, 2);
});

test('what the paywall, Sing and Settings say about Daily Ritual credits', async () => {
  const { balanceLabel, usesLabel, ritualLabel } = await import('../src/app/paywall/copy.js');
  const base = { free: 0, credits: 0, ritual: 0, ritualCap: 30, ritualNextAt: null, ritualExpiresAt: null, subscribed: true };
  const now = new Date(2027, 0, 15, 20, 0).getTime();
  const tomorrow9 = new Date(2027, 0, 16, 9, 0).getTime();
  assert.equal(balanceLabel({ ...base, ritual: 3, credits: 4 }), '3 Daily Ritual credits + 4');
  assert.equal(balanceLabel({ ...base, ritual: 1 }), '1 Daily Ritual credit');
  assert.match(balanceLabel({ ...base, ritualNextAt: tomorrow9 }, now), /^Next credit tomorrow at 9:00/);
  assert.equal(balanceLabel({ ...base, subscribed: false }), 'None left');
  assert.equal(usesLabel({ ...base, source: 'daily', ritual: 4 }), 'Uses 1 of your 4 Daily Ritual credits');
  assert.equal(usesLabel({ ...base, source: 'daily', ritual: 1 }), 'Uses your last Daily Ritual credit');
  assert.match(ritualLabel({ ...base, ritual: 12, ritualNextAt: tomorrow9 }, now), /^12 of 30 · next tomorrow at 9:00/);
  assert.equal(ritualLabel({ ...base, ritual: 30 }), '30 of 30');
  assert.equal(ritualLabel({ ...base, ritual: 4, subscribed: false, ritualExpiresAt: new Date(2027, 10, 16).getTime() }), '4 · kept until November 16');
});

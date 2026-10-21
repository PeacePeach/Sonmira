// The two App Store Connect products, as the app, the Xcode StoreKit file
// and the guide name them. Product ids can never be reused, so a typo here
// would only show once a TestFlight build fails to load them. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRODUCTS, FREE_PAINTINGS } from '../src/app/billing/products.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the app sells exactly the two App Store Connect products', () => {
  assert.deepEqual(PRODUCTS.map((p) => [p.id, p.kind, p.fallbackPrice]), [
    ['app.sonmira.daily_ritual.monthly', 'subscription', '$5.99'],
    ['app.sonmira.little_moments.10', 'consumable', '$2.99'],
  ]);
  assert.equal(PRODUCTS.find((p) => p.kind === 'consumable').credits, 10);
  assert.equal(FREE_PAINTINGS, 3);
});

test('Sonmira.storekit mirrors them for Xcode testing', () => {
  const kit = JSON.parse(read('ios/App/App/Sonmira.storekit'));
  const pack = kit.products.find((p) => p.productID === 'app.sonmira.little_moments.10');
  assert.equal(pack?.type, 'Consumable');
  assert.equal(String(pack.displayPrice), '2.99');
  const subs = kit.subscriptionGroups.flatMap((g) => g.subscriptions.map((s) => ({ ...s, group: g.name })));
  assert.deepEqual(subs.map((s) => [s.productID, s.recurringSubscriptionPeriod, String(s.displayPrice), s.group]), [
    ['app.sonmira.daily_ritual.monthly', 'P1M', '5.99', 'Sonmira'],
  ]);
});

test('the iOS app and the server agree on the bundle and the products', () => {
  assert.match(read('capacitor.config.json'), /"appId":\s*"app\.sonmira"/);
  const ids = [...read('ios/App/App.xcodeproj/project.pbxproj').matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
  assert.ok(ids.length && ids.every((id) => id === 'app.sonmira'), 'Debug and Release build app.sonmira');
  const guide = read('docs/billing-iap.md');
  for (const p of PRODUCTS) assert.ok(guide.includes(p.id), `${p.id} in docs/billing-iap.md`);
});

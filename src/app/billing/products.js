// What Sonmira sells. Prices here are fallbacks for the prototype and for the
// moment before the store answers; the UI always shows the store's localized
// displayPrice when it has one. Product ids are the App Store Connect
// products (bundle app.sonmira); ios/App/App/Sonmira.storekit mirrors them
// for Xcode testing, and tests/billing-products.test.mjs keeps the two equal.

export const FREE_PAINTINGS = 3;
// Daily Ritual: one credit per subscription day, saved up to RITUAL_CAP; earned
// credits never expire (src/app/billing/wallet.js).
export const RITUAL_CAP = 30;

export const PRODUCTS = [
  {
    id: 'app.sonmira.daily_ritual.monthly',
    kind: 'subscription', // auto-renewable, one subscription group
    name: 'Daily Ritual',
    blurb: 'One painting credit every day. Save up to 30.',
    fallbackPrice: '$5.99',
    period: 'month',
  },
  {
    id: 'app.sonmira.little_moments.10',
    kind: 'consumable',
    name: 'Little Moments',
    blurb: '10 paintings, whenever you like.',
    fallbackPrice: '$2.99',
    credits: 10,
  },
];

// The option the paywall opens with. The pack keeps the paywall from
// leaning on the subscription; either one is a single tap away.
export const DEFAULT_PRODUCT = 'app.sonmira.little_moments.10';

export const productById = (id) => PRODUCTS.find((p) => p.id === id);

// What Sonmira sells. Prices here are fallbacks for the prototype and for the
// moment before the store answers; the UI always shows the store's localized
// displayPrice when it has one. Product ids match the planned App Store
// Connect products (not created yet).

export const FREE_PAINTINGS = 3;

export const PRODUCTS = [
  {
    id: 'app.sonmira.daily_ritual.monthly',
    kind: 'subscription', // auto-renewable, one subscription group
    name: 'Daily Ritual',
    blurb: 'One painting every day.',
    fallbackPrice: '$4.99',
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

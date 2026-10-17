# Paywall and paintings

Sonmira charges for making new paintings, never for keeping, revisiting,
listening to or sharing the ones someone already has.

> **Development only, not production billing.** Every purchase is simulated
> and nothing is charged. The wallet and usage limits are kept in the
> browser's localStorage, so anyone can edit or reset them; they shape the
> experience but enforce nothing. Real billing needs StoreKit 2 with signed
> transactions verified by a server, and a server-side ledger that the
> generation service checks before it paints (see *Restoring after a
> reinstall* below).
>
> The iOS app now uses the real App Store and a server ledger: see
> `docs/billing-iap.md`. Everything below about the simulation still holds
> for web previews.

## Model

| | |
| --- | --- |
| Free | 3 successful paintings per person. No card, no account. |
| Daily Ritual | Auto-renewable monthly subscription, `$4.99` fallback price. One painting per calendar day; unused days don't carry over. |
| Little Moments | Consumable, `$2.99` fallback price, adds 10 paintings that never expire. Can be bought any number of times, including by subscribers. |

Prices and product ids live in `src/app/billing/products.js`. The UI shows the
store's localized `displayPrice` and only falls back to the configured price
before the store answers. The paywall opens with Little Moments selected
(`DEFAULT_PRODUCT`) so it doesn't lean on the subscription.

A painting is taken from the first source that has one: **today's Daily
Ritual painting → free paintings → Little Moments credits.**

## Where the paywall appears

- **Diary +** when nothing is left: the sheet rises over the diary. Closing it
  leaves the diary exactly as it was.
- **Create painting** when the last painting was used during this visit (for
  example after *Sing again*). The take and its note stay; after a purchase
  *Create painting* carries straight on.
- **Settings → Paintings → More paintings**, for buying ahead.

Before *Create painting*, a quiet line says what the painting will use
("Uses 1 of your 3 free paintings", "Uses today's painting from Daily Ritual").

A subscriber who has used today's painting sees *Today's painting is made.*
with only Little Moments offered.

## Counting only successful paintings

`src/app/billing/wallet.js` keeps the books. Each take gets a generation key.

1. **reserve(key)** when *Create painting* is tapped: one painting is set aside.
2. **commit(key)** when the painting is shown: it's counted.
3. **release(key)** if the engine fails (the app shows its wash-only
   fallback, which isn't counted), or the screen closes before the painting
   is shown: it's handed back.

All three are idempotent per key, so retrying a take never counts twice.
After a restart every leftover hold is released, because generation runs in
the app and can't still be going.

The metering lives at the edges of `sing.js` (reserve before the engine is
called, commit or release when the result is shown or the screen closes), so
the engine call and its error handling are untouched. A dedicated failure
screen with *Try again* belongs with the engine work and can count on the
same key: release on error, reserve again on retry.

## Purchases (StoreKit 2)

`src/app/billing/store.js` has the StoreKit 2 shape; the native app puts the
real store behind it.

| Prototype | StoreKit 2 |
| --- | --- |
| `products()` | `Product.products(for:)`, use `displayPrice` |
| `purchase(id)` → `success` / `userCancelled` / `pending` | `product.purchase(options: [.appAccountToken(id)])`, verify `VerificationResult` |
| grant, then `finish(tx)` | grant credits / entitlement, then `transaction.finish()` |
| `onTransaction` | `Transaction.updates`, listened to from launch (Ask to Buy approvals, renewals, refunds) |
| `currentSubscription()` | `Transaction.currentEntitlements` + `Product.SubscriptionInfo.RenewalInfo` for `willAutoRenew` |
| `sync()` | `AppStore.sync()` behind *Restore purchases* |
| Settings → Daily Ritual | `AppStore.showManageSubscriptions(in:)` |

Credits are granted before the transaction is finished, and each transaction
id is granted once. An unfinished transaction is re-delivered on next launch,
so a crash between payment and grant never loses a purchase.

| Outcome | What the person sees |
| --- | --- |
| Cancelled | Nothing. The sheet is as it was. |
| Failed | "The purchase didn't go through, and nothing was charged." |
| No connection | "We couldn't reach the App Store… Nothing was charged." |
| Pending (Ask to Buy) | "Waiting for approval… nothing is charged until then." When approved later, the sheet (or a toast) confirms it. |
| Purchases restricted | "Purchases are turned off on this device." |
| Success | *Ten more moments.* / *Your Daily Ritual begins.* with *Sing a moment* (or *Create painting*). |

### Development simulation

No App Store products exist yet and nothing can be charged. Until they do, a
development simulator stands where Apple's sheet will be. It is marked
"Development only · no real payment", the paywall carries "Development build ·
purchases are simulated", and a simulated success says "Simulated purchase ·
nothing was charged". Settings gets a *Development* group to use up the free
paintings, start a new day, approve a pending purchase, cancel or end Daily
Ritual, simulate a reinstall, and start over. None of it appears once a real
store is behind `store.js`.

## Restoring after a reinstall or on a new device

StoreKit restores subscriptions (`currentEntitlements`), but not what's left
of consumables: a finished consumable doesn't come back as an entitlement,
and even where its history is available (iOS 18's
`SKIncludeConsumableInAppPurchaseHistory`) nothing says how many of the 10
were already used. The free tier has the same problem: a reinstall would
otherwise hand out three more.

**Proposal, no account system:**

1. On first launch, create a random `appAccountId` (UUID) and keep it in the
   Keychain with `kSecAttrSynchronizable`, so iCloud Keychain carries it to
   reinstalls and the person's other devices.
2. The generation service (needed anyway to run the AI) keeps the ledger
   under that id: free paintings left, credits, granted transaction ids and
   committed generation keys. It does reserve / commit / release itself, so
   a painting is charged once per key even if the app retries or restarts.
3. Purchases pass `appAccountToken: appAccountId`. The app sends each signed
   transaction (JWS) to the service, which verifies it, grants once per
   transaction id, and listens to App Store Server Notifications for renewals,
   refunds and revocations.
4. *Restore purchases*: `AppStore.sync()`, then send the current entitlements
   and transaction history to the service, which re-links them to the
   current id. This covers people without iCloud Keychain.
5. Use DeviceCheck's two per-device bits to mark the free paintings as
   claimed, so reinstalling doesn't reset them.

In the prototype, a second local copy plays the account ledger: *Delete and
reinstall the app* (Development) wipes the device copy, and the credits come
back on launch.

**Limits to accept:** someone with iCloud Keychain off who also has no
purchase history keeps their credits only on the device; a family member
sharing an Apple ID shares the ledger; and the daily boundary follows the
device's local date until the service checks it.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Free paintings used up | + opens the paywall; the diary, playback and sharing all keep working. |
| Generation fails | Nothing used; the usual wash-only fallback is shown. |
| Sing closed while painting | Nothing used. |
| App restarts while painting | Hold released on launch. |
| Same take generated again | Counted at most once (per-take key). |
| Painting made, then *Sing again* or close without *Keep it* | Counted: the painting was made. |
| Subscriber used today's painting | Paywall offers Little Moments only; tomorrow's painting comes on its own. |
| Subscription cancelled | Stays active to the end of the period, then ends. |
| Subscription ended | Diary untouched; Little Moments credits stay; new paintings need a credit or a new subscription. |
| Pending purchase approved later | Credits or subscription added via `Transaction.updates`; toast if the sheet is closed. |
| Reinstall | Subscription from StoreKit; credits and free count from the ledger. |

## Watercolor illustrations

`assets/illustrations/`, shown with `illustration(name)` from
`src/app/ui/illustration.js`:

| Name | Where |
| --- | --- |
| `drops` | Empty diary, paintings added, purchases restored, Daily Ritual begins |
| `mic-off` | Microphone off, missing or busy |

The today's-painting-made state has no illustration.
Both were generated with OpenAI's image model and flattened so the paper is
white and multiplies cleanly onto any surface.

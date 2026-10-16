# Apple In-App Purchase (StoreKit 2)

The iOS app sells through the App Store; web previews and local development
keep the purchase simulation described in `docs/paywall.md`. On the released
site (`sonmira.vercel.app`) a browser can't buy: the paywall says purchases
are made in the iPhone app, since the server counts every painting there. The paywall's design, copy and
states are the same in both.

## Products

| Product | ID | Type | Price |
| --- | --- | --- | --- |
| Daily Ritual | `app.sonmira.daily_ritual.monthly` | Auto-renewable, 1 month, group *Sonmira* | US$4.99 |
| Little Moments | `app.sonmira.little_moments.10` | Consumable, 10 paintings | US$2.99 |

Bundle ID `app.sonmira`. The first three successful paintings are free. The
diary, recordings, playback and sharing never need a purchase.

## How it fits together

1. **Account id.** On first launch the app creates a random UUID and keeps it
   in iCloud Keychain (`AccountKeychain` in `ios/App/App/SonmiraStorePlugin.swift`).
   It is StoreKit's `appAccountToken`, the server ledger's key, and the
   generation guard's install id. It identifies no person.
2. **Purchase.** `SonmiraStorePlugin` (StoreKit 2) buys with that token and
   hands the app Apple's signed transaction (JWS). The app sends it to
   `POST /api/billing/transactions`; the server verifies Apple's signature
   (`server/billing/apple.js`, Apple's own library, root pinned by
   fingerprint) and grants it once per Apple transaction id. Only then does
   the app call `finish`. An unfinished transaction is delivered again on the
   next launch, so a crash or lost connection never loses a purchase.
3. **Later events.** `Transaction.updates` (Ask to Buy approvals, renewals,
   refunds) is listened to from launch and goes the same way. Apple's App
   Store Server Notifications V2 (`/api/billing/apple-notifications`) cover
   what happens while the app is closed: renewals, auto-renew off, billing
   grace periods, expiry, refunds and refund reversals.
4. **Spending.** The ledger (`server/billing/ledger.js`) runs the app's own
   wallet rules (`src/app/billing/wallet.js`): today's Daily Ritual painting,
   then free, then credits. The generation guard reserves one painting per
   take key before the image is made, commits it only when the image exists
   and releases it otherwise (`server/billing/charge.js`). A replay of the
   same key is answered from the guard's store and never charged again. A
   hold left by a function that died is released after 3 minutes.
5. **Restore Purchases.** `AppStore.sync()`, then every signed transaction for
   the Apple ID (consumables included on iOS 18, `SKIncludeConsumableInAppPurchaseHistory`)
   goes to the server with `restore: true`. A ledger left under an earlier
   install's id is merged into this one; free paintings never come back.
   A ledger moves only when the transaction is signed for the phone sending
   it (StoreKit's device verification), so a signed transaction copied from a
   log or a screenshot moves nothing, and a pack is granted to one account,
   ever.
6. **The app's wallet** is a copy of the server's ledger, so the paywall and
   Settings answer instantly. Settings → Daily Ritual opens Apple's
   subscription settings.

Refunds take back what's left of a pack (never below zero) and end Daily
Ritual at once. Only Apple's own notification can undo a refund, so a client
replaying an old signed transaction gets nothing back. The Daily Ritual day is
the phone's local date, accepted only if some time zone (UTC−12 to UTC+14)
is on that date right now, and a day at or before one already used never
opens again, so moving the clock gains at most one early painting, once.

## Server configuration

| Variable | Value |
| --- | --- |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | The same Upstash store as the generation guard. Without it, billing answers `503 not_configured`. |
| `SONMIRA_APPLE_APP_ID` | Optional, default `6823759268`, Sonmira's numeric Apple ID (App Store Connect → App Information). Production purchases are checked against it. |
| `SONMIRA_BUNDLE_ID` | Optional, default `app.sonmira`. |
| `SONMIRA_BILLING` | `on` (default in Production, which TestFlight and App Review also use): every install is counted, whatever id it registers. `off` (default elsewhere): web previews keep their simulated wallet. |
| `SONMIRA_ALLOW_XCODE_STOREKIT=1` | Optional, never in Production: accept Xcode's locally signed test transactions. |

No App Store Connect API key, shared secret or certificate file is needed.

## Building the iOS app

```bash
npm install
npm run ios          # builds www/, syncs the Xcode project
npx cap open ios     # Xcode: pick your team, then Product → Archive → upload
```

Without a Mac: `.github/workflows/testflight.yml` archives, signs (Apple-managed
signing through an App Store Connect API key) and uploads to TestFlight. It
needs four repository secrets, listed at the top of the file.

`native/ios.json` chooses how the app loads:

- `hosted` (default): the app opens `appUrl`, so web changes reach phones on
  deploy. Opening the app needs a connection; a calm offline page ships inside
  it. Keep the domain permanent: the diary is stored per site address.
- `bundled`: the files ship in the build and open offline; API calls go to
  `appUrl` (the API must allow the `capacitor://localhost` origin). Every web
  change needs a new build.

`.github/workflows/ios.yml` builds the app for the Simulator on every change
to the native code.

## Testing without real money

- `npm test`: the ledger, Apple signature checks (with a test signing chain),
  refunds, renewals, grace periods, restore, racing requests, and the app's
  billing against a fake StoreKit plugin.
- Xcode: `ios/App/App/Sonmira.storekit` holds both products for local
  StoreKit testing (Edit Scheme → Run → Options → StoreKit Configuration).
- TestFlight builds buy in Sandbox: nothing is charged, and a monthly
  subscription renews every 5 minutes.

## Sandbox test plan

| Step | Needs the Paid Apps Agreement active? |
| --- | --- |
| Xcode run with `Sonmira.storekit` (already selected in the shared App scheme): buy, cancel, Ask to Buy, refund and renewals from Xcode's Transaction Manager | No |
| Upload to TestFlight (`.github/workflows/testflight.yml`, or Xcode → Archive) and install | No |
| Create a Sandbox Apple Account (App Store Connect → Users and Access → Sandbox) | No |
| Products load in a TestFlight build, Sandbox purchases, renewals every 5 minutes, Restore | **Yes** |
| App Store Server Notifications (Sandbox) reaching `/api/billing/apple-notifications` | Yes, and a deployed server with the billing ledger |

Xcode's local transactions are signed by Xcode, so a server only accepts them
with `SONMIRA_ALLOW_XCODE_STOREKIT=1` (never in Production). Against the
released site they show in the app but are not recorded, which is enough to
check the paywall and StoreKit flows.

In TestFlight, with a Sandbox account:

1. First launch: 3 free paintings; the paywall shows US$2.99 and US$4.99.
2. Buy Little Moments: 10 paintings, in Settings and on the server
   (`/api/billing/status`).
3. Kill the app during the purchase sheet, reopen: the purchase is applied once.
4. Buy Daily Ritual: one painting today; a second opens the paywall with
   Little Moments only. Wait 5 minutes: it renews; after 6 renewals it ends.
5. Settings → Daily Ritual opens Apple's subscription settings; cancel there:
   it stays until the period ends, then stops.
6. Delete and reinstall, Restore Purchases: the remaining paintings and Daily
   Ritual come back, the free paintings do not.
7. A painting that fails to generate takes nothing.

## Joining the generation guard

The guard lives on the Production Readiness branch. When it merges:

- `protect('generate', handler, { charge: createCharge({ ledger }) })`, with
  the ledger on the guard's store;
- `createApiClient({ installId: await app.billing.accountId() })` in the iOS
  app, so the guard and the ledger share the id;
- the Account thread calls `ledger.merge(guestId, accountId)` on sign-in and
  `ledger.erase(accountId)` on deletion; on the device,
  `app.billing.setAccountId(id)` after a returning sign-in and
  `app.billing.resetAccountId()` on sign-out or deletion (the Keychain item
  has one writer: the StoreKit plugin);
- `402 no_paintings` from `/api/generate` opens the paywall, with the take
  kept;
- `/api/billing/transactions` and `/status` take `authorize(req, account)`:
  the guard's install token, with `account === token.installId`. On Vercel
  they answer `503 not_configured` until it is supplied (Apple's
  notifications keep working); locally they stay open;
- in the bundled build, the guard answers CORS for `capacitor://localhost`,
  including the `x-sonmira-day` header.

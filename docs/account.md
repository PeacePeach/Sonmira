# Account and Sign in with Apple

Sonmira is guest-first. Nobody is asked to sign in before making a painting,
and sign-in is offered in one place only: **Settings → Account**.

> **Development only in web previews.** Apple's sheet is replaced by a
> labeled simulator and the account service runs in the browser. The iOS app
> uses the native plugin and the `/api/account/*` functions below.

## What an account is

Every install has a random **account id** (22 characters, kept in iCloud
Keychain on iOS). It is also the generation guard's install id, StoreKit's
`appAccountToken` and the billing ledger's key. Signing in with Apple adds a
record saying which Apple ID that id belongs to, so the same paintings left,
Little Moments credits, Daily Ritual and beta access can be found again after
a reset or on a new iPhone.

**The diary, original recordings and paintings stay on the device** and are
not part of the account. Signing in doesn't back them up or sync them; the
Account screen says so in both states.

We ask Apple for no name and no email. The server stores a keyed hash of
Apple's user id, never the id itself.

## Flows

| | |
| --- | --- |
| Sign in, Apple ID new to Sonmira | The device's account id is linked. Nothing moves. |
| Sign in, Apple ID already has an account | The device's guest data is merged into it (billing `ledger.merge`, guard `adoptSeat`) and the device adopts that account id. |
| Cancel on Apple's sheet | Nothing changes, no message. |
| Offline / no Apple ID / Apple error / server error | A calm line under the button; nothing changes. |
| Sign out | The device becomes a fresh guest. The account keeps its paintings and purchases. |
| Delete account | Two taps, then Apple confirms it's the same Apple ID. The server revokes Apple's tokens, then erases the account record, ledger and invite seat. The diary is erased only if the person ticks *Also erase the diary on this iPhone* (off by default). If Daily Ritual renews, the screen says deletion doesn't cancel it and links to Apple's subscription settings. |
| Removed at Apple, or the session ended on the server | The next launch signs out quietly with one toast. |

## Server

`src/account/` is plain Web Crypto and fetch, shared by the Vercel functions
and the browser simulation:

- `apple.js`: verifies identity tokens (RS256 against Apple's published keys; issuer, audience `app.sonmira`, expiry, and `nonce = sha256(rawNonce)`), signs the ES256 client secret and revokes tokens on deletion, verifies Apple's server-to-server notifications.
- `accounts.js`: linking, merging, sessions, deletion, Apple events.
- `session.js`: signed session tokens with a record version, so sign-out everywhere, Apple revoking consent or deletion ends every older token.
- `http.js`, `deploy.js`, `api/account/*.js`: the endpoints. They fail closed (`503 not_configured`) without their secret and shared store.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `POST /api/account/apple` | `identityToken, rawNonce, accountId` | `status: linked \| returning, accountId, token` |
| `POST /api/account/session` | `token` | `accountId, token` |
| `POST /api/account/delete` | `token, identityToken, rawNonce, authorizationCode` | `deleted, revoked` |
| `POST /api/account/notifications` | `payload` (Apple's signed event) | `ok` |

`accounts.verifyAccount(token)` is what Production Readiness's `/api/session`
calls to let a signed-in person on a new iPhone skip the invite code.

**Who may send an account id.** `/apple` never trusts the `accountId` in the
body on its own. `deps.authorize(req, accountId)` (the generation guard's
install token) decides: proven, the id is linked, or merged into the Apple
ID's existing account; unproven, the Apple ID's existing account is returned
(recovery on a fresh install needs no invite code) and the id is neither
linked nor merged, and with no existing account the answer is
`401 unauthorized`. Without that rule, someone who learned a guest's id could
link it to their own Apple ID and take its balance and seat. Deployed
(`VERCEL` set) with no check supplied, `/apple` answers `503 not_configured`;
locally every caller is allowed. The other endpoints prove the caller with a
session token (`session`, `delete`) or Apple's signature (`notifications`).

**Rate limits.** Each endpoint is limited per address per minute on the
account store (`LIMITS` in `deploy.js`): `apple` 10 and `delete` 5, because
both call Apple; `session` 60; `notifications` 600. Over the limit:
`429 rate_limited`.

### Environment

| Variable | Value |
| --- | --- |
| `SONMIRA_ACCOUNT_SECRET` | 32+ random characters, only for accounts |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | the Upstash store the guard and billing already use |
| `APPLE_BUNDLE_ID` | defaults to `app.sonmira` |
| `APPLE_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY` | a Sign in with Apple key (free, developer portal), for revoking tokens on deletion. Production refuses to run without it. |

Apple setup, when the iOS shell exists: enable *Sign in with Apple* on the App
ID, create the key above, and optionally set the server-to-server
notification URL to `/api/account/notifications`.

## Hooks owned by other workstreams

The integration passes them without editing these files, through
`createDeployedHandlers({ ledger, seats, authorize, limit })` (or
`buildFromEnv(env, { … })`) in the one-line `api/account/*.js` files. Until
then they are no-ops. On the client, `createAccountForDevice(app, { box })`
and `newId` let the native build keep the account id in the same Keychain
item billing and the guard use, and make new guest ids as UUIDs.

- Payments: `ledger.merge(fromId, toId)`, `ledger.erase(id)`.
- Production Readiness: `adoptSeat(fromId, toId)`, `eraseAccount(id)`, and `/api/session` accepting `verifyAccount`.

## Tests

`npm test` runs the account tests with test-signed tokens (a local RSA key
stands in for Apple's; nothing calls Apple). `node tests/e2e/account.mjs` runs
the screens with the simulator.

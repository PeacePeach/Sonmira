# App Store release audit (Sonmira iOS 1.0, after the Guideline 2.2 rejection)

12 Nov 2026. Branch `claude/project-thread-zxqij3`, from main `b35d8f7`.

## 1. Root cause of the 9 Nov Guideline 2.2 rejection

Apple's message names no screen, so the cause is inferred from the code that
build 5 loads (hosted mode: the app opens `https://sonmira.vercel.app`,
`native/ios.json`, `scripts/ios.mjs`).

Confirmed from the code (these screens are what a reviewer reaches on main):

1. **Private beta invitation screen.** A fresh install that records and taps
   *Create painting* gets `POST /api/generate` → `401 invite_required`
   (`server/protect/index.js`), and the app opens "Your invitation — Sonmira is
   in a small private beta. Enter the invitation code you were given…"
   (`src/app/protect/invite-sheet.js`). Without a code the core feature does not
   work at all. Production had no way in without a code
   (`autoAccess` was hard-wired to one Preview branch).
2. **Simulated Sign in with Apple.** The iOS project has no
   `SonmiraAppleSignIn` plugin and no Sign in with Apple entitlement, so
   `src/app/account/setup.js` falls back to the development simulation in the
   App Store build. Settings → Account → *Sign in with Apple* opens a sheet
   tagged "Development only · not Apple" with test outcomes ("Apple returns an
   error", "Apple says yes, Sonmira's server fails"…), and the Account screen
   shows "Development build · sign-in is simulated" and a
   "Development · sign-in simulation" section.

Likely contributing (unfinished features, Guideline 2.1/2.2):

3. Settings showed four disabled rows labelled **"Coming soon"** (Daily
   reminder, Diary lock, Backup / restore, Rate Sonmira).
4. Beta wording: Terms "Sonmira is in early release. Access may require an
   invitation code"; Privacy "invitation codes"; the account-deletion screen
   "your beta access"; Save to Photos error "needs the latest Sonmira from
   TestFlight".

Not reachable in the App Store app, but reachable on the public website (fixed
anyway, requirement 6): `?dev` developer panel, `?engine=mock` mock paintings,
`#dev`.

Unknown: what the App Review notes in App Store Connect said (an invitation
code given there would itself signal a beta).

## 2. Every production-facing beta/test feature found

| Feature | Where | Reachable in App Store app on main | Fix |
|---|---|---|---|
| Invitation-code gate + sheet | `server/protect`, `src/app/protect` | Yes, first painting | Open access in Production; prompt only on test hosts |
| Sign in with Apple simulator | `src/app/account/*`, `screens/account.js` | Yes, Settings → Account | Account hidden unless the native plugin exists (or a test host) |
| "Coming soon" rows | `screens/settings.js` | Yes, Settings | Removed |
| Beta / TestFlight / invitation wording | legal content, account-delete, share sheet | Yes | Reworded |
| `?dev` panel, `#dev` | `main.js`, `dev.js` | No (URL fixed) — yes on the website | Only on localhost / test deployments |
| `?engine=mock|real` | `engine/engines/index.js` | No — yes on the website | Ignored on the app and the released site |
| `?ux-preview` | `ux-preview.js` | No (already blocked on release host + native) | Unchanged |
| Purchase simulator + Settings → Development | `billing/store.js`, `paywall/simulator.js` | No (native StoreKit; release site "app only") | Unchanged |
| `/api/admin/reset-test-free` | `api/admin` | No UI; 404 without `SONMIRA_TEST_RESET_KEY` | Unchanged (keep that key unset in Production) |
| `/admin/references/`, `/playground/`, `/dev/gallery.html`, `/qa/` static pages | repo root | No link from the app; password/noindex | Unchanged |

## 3. Fixes

- **Open access** (`server/protect/config.js`, `index.js`): `POST /api/session
  { open: true, installId }` admits any install without a code when
  `SONMIRA_OPEN_ACCESS` is on — **on by default in Production**, off on Previews
  and locally unless set to `1`; `0` turns it off. Tokens stay signed and
  seat-checked (`seat:<id>` = `open`), so account deletion and seat moves work
  as before. Everything after admission is unchanged: per-install and per-IP
  rate limits, idempotency, the paintings ledger (3 free → `402 no_paintings`
  → paywall), the daily spend cap. The per-invitation-code daily cap does not
  apply to open tokens (it would cap all users together at 60/day). New: at most
  `OPEN_INSTALLS_IP_DAY` (30, env `SONMIRA_LIMIT_OPEN_INSTALLS_IP_DAY`) new
  installs per IP per UTC day. Invitation codes still work where configured.
- **Client** (`src/app/protect/client.js`, `main.js`): tries open access first
  with no UI; only on localhost/test deployments does it fall back to the
  Preview auto-access or the invitation prompt. The app and the released site
  never get an `askInvite`. Error copy no longer mentions invitations.
- **Developer tools** gated to localhost/test deployments: `?dev`, `#dev`,
  `?engine=`; never in the iOS app or on `sonmira.vercel.app`.
- **Sign in with Apple**: `createAccountForDevice` sets `signInOffered` only
  with the native plugin (or on a test host). Settings hides Account otherwise;
  the Account screen sends you back to Settings. The guest id, StoreKit's
  `appAccountToken`, the ledger and Restore Purchases are unchanged.
- **Settings**: the four "Coming soon" rows are gone.
- **Copy**: microphone-denied text in the app points to Settings → Sonmira;
  Save to Photos error no longer names TestFlight; legal text no longer
  mentions early release or invitation codes (public `/privacy`, `/terms`
  regenerated, updated date 12 Nov 2026).

Not changed: tiers (Loose/Gathered/Resolved), lyrics fixes, grounding,
prompts, references, motif rotation, 30 s limit, generation config, billing and
credit rules, UX/animations.

## 4. Compliance audit

| Area | Result |
|---|---|
| 2.1 completeness | Core flow works for a guest without a code (e2e). "Coming soon" removed. Offline: native `offline.html` + calm generation errors, take kept as draft. |
| 2.2 beta features | All items in §2 fixed or unreachable. |
| 2.3 metadata | Check App Store Connect (§6). Do not mention Sign in with Apple, invitations or beta. |
| 3.1.1 IAP | Both products sold only through StoreKit (`SonmiraStorePlugin.swift`); Restore Purchases in Settings and paywall; server verifies Apple JWS, accepts Sandbox for App Review (`server/billing/apple.js`). |
| 3.1.2 subscriptions | Paywall shows price/period, auto-renew, cancel terms next to the button; "More information" has full terms + Terms/Privacy links; Manage subscription opens Apple's sheet. Risk: Terms/Privacy are one tap away, not on the first paywall screen. App Store Connect needs a Terms of Use (EULA) link. |
| 4.8 Sign in with Apple | Not offered in 1.0 (no third-party login exists either), so not required. |
| 5.1.1 data/privacy | Mic purpose string accurate; Photos add-only string accurate; no account required; Privacy Policy and Terms in-app and at `/privacy`, `/terms`. Account deletion only exists with sign-in, which is not offered. |
| iPad | App is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), so iPad runs it in the phone-sized compatibility window. e2e at 375×667 and 414×896: all screens work; at 375×667 the result screen's *Next* button sits partly below the fold and is reached by scrolling (pre-existing). |

## 5. Native build

Not needed. Every change is web/backend; build 5 opens
`https://sonmira.vercel.app` (`native/ios.json` mode `hosted`, `scripts/ios.mjs`
sets `server.url`), and Info.plist/entitlements/Swift are untouched. After the
Production deploy, build 5 shows the fixed app. Bundle id, product ids and
signing unchanged.

Adding real Sign in with Apple later does need a new build (Swift plugin
`SonmiraAppleSignIn`, the capability on App ID `app.sonmira`, an entitlements
file, server env for the account service).

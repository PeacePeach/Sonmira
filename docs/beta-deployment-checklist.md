# Beta deployment checklist

Merging code and deploying Production are separate steps, each with its own approval from Han. `vercel.json` keeps `git.deploymentEnabled.main: false`, so a merge into main deploys nothing.

## A. Before asking to merge PR #9

- [x] Engine V1 (PR #2) integrated with its frozen visual rules (`tests/visual-freeze.test.mjs` passes).
- [x] Latest main merged in; Paywall, Diary, Sharing and Settings unchanged against main.
- [x] Fake provider only by `SONMIRA_FAKE_PROVIDER=1`, never in Production. A Preview without it fails closed.
- [x] `SONMIRA_PROTECT=off` ignored on every deployment.
- [x] Unit tests, readiness e2e (reloads, interruptions, quota), Paywall, flow, loading and dev diagnostics all pass.
- [x] Payments (PR #6, iOS shell, StoreKit, ledger, TestFlight workflow) and Account (PR #8) merged into PR #9 and wired to the guard: one id per device, paintings counted by the server only when made, billing and sign-in answer only to the holder of the id (section F).
- [x] Unit tests, readiness e2e (now with server-counted quota), Paywall, Account, flow, loading and diagnostics pass; screens match main apart from the new Account row in Settings.
- [ ] PR #9 marked ready for review, then Han approves the merge.

## B. Code merge (Han's approval: merge)

1. Merge PR #9 into main. Nothing is deployed.
2. PR #2 is closed as merged through PR #9.
3. PR #6 and PR #8 are closed as merged through PR #9 (their commits are in it).

## C. Production setup in Vercel (Han, no code)

Following `docs/beta-vercel-config.md`:

1. Connect Upstash Redis to Production (`KV_REST_API_URL`, `KV_REST_API_TOKEN`).
2. Add `OPENAI_API_KEY` from a dedicated beta OpenAI project with a monthly budget and alerts.
3. Add `SONMIRA_TOKEN_SECRET`, `SONMIRA_INVITE_CODES` and `SONMIRA_DAILY_CAP_USD=3`.
4. Confirm the Blob store (`BLOB_READ_WRITE_TOKEN`) is connected to Production.
5. Accounts: `SONMIRA_ACCOUNT_SECRET` (32+ random characters, different from the token secret) and the Sign in with Apple key `APPLE_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY`. Without them `/api/account/*` answers `not_configured` (Production refuses to run accounts without the key, so deletion can revoke Apple's tokens).
6. Purchases: `SONMIRA_BILLING` stays unset (counting is on in Production). In App Store Connect, set the App Store Server Notifications V2 URL (Production and Sandbox) to `https://<production domain>/api/billing/apple-notifications`.
7. Native beta: raise `SONMIRA_LIMIT_IP_HOUR` and `SONMIRA_LIMIT_SESSION_IP_HOUR` (for example to 200 and 50) because testers on one carrier can share an address.
8. Confirm `SONMIRA_FAKE_PROVIDER`, `SONMIRA_PROTECT`, `SONMIRA_REFERENCE_VIEW` and `SONMIRA_ALLOW_XCODE_STOREKIT` are not set in Production.
9. Turn Deployment Protection on for Previews.

## D. Beta setup task: transcription check (Engine)

Tracked separately; it does not block Engine V1. When the beta's OpenAI key exists, add it to the PR #2 Preview, re-run the Playground Singing test on the 9 saved takes (about $0.04, no images), confirm takes 1 and 3 pass the words gate, then remove the key from that Preview. Details are in `docs/beta-vercel-config.md` section 5.

## E. Production deployment (Han's approval: deploy)

1. Deploy main to Production by hand, from the Vercel dashboard or with `vercel deploy --prod` from a clean checkout of main. Nothing deploys on its own.
2. Smoke test on the Production URL (costs about $0.16):
   - `POST /api/generate` with no token answers `401 invite_required`.
   - Enter a code, sing, paint once: the painting arrives; the log shows one `sonmira.guard` line with `outcome: "ok"`.
   - The OpenAI usage page shows one image and one transcription.
3. Share the invitation codes with the testers.

## F. TestFlight (Han's approval: upload)

The iOS app is a native shell that opens the Production site (`native/ios.json`: hosted mode, `https://sonmira.vercel.app`). Its screens and logic come from the Production deployment and its shell from the commit the workflow builds. So both must be the approved commit:

1. Production is deployed from the approved commit (section E), and its deployment page shows that commit's SHA.
2. Push a tag to exactly that SHA, for example `git tag testflight-1 <approved sha> && git push origin testflight-1`. The workflow runs on a `testflight-*` tag only, and it checks out the tagged commit. Avoid "Run workflow" on a branch, which builds whatever that branch's head is at that moment.
3. Leave the workflow's `app_url` input empty, so the app opens Production.

The secrets and the Sandbox tester are already set up. Nothing in PR #9 runs the workflow on its own.

## Testing the Preview end to end at no cost

The PR's Vercel Preview is safe to test only in no-cost mode. In Vercel → Settings → Environment Variables, the **Preview** environment needs `SONMIRA_FAKE_PROVIDER=1` and must have no `SONMIRA_BILLING`. Then:
- Painting uses the offline renderer, and no OpenAI call is made. The invitation code is `SONMIRA-PREVIEW`.
- Purchases use the labeled development simulator in the browser. Nothing goes to Apple.
- Sign in with Apple uses the labeled development simulator in the browser.

Without that switch, a Preview never pays: unless it has its own secret, codes and store, painting answers "not configured".

## Notes for testers

- **Signing out never touches the diary.** Recordings, paintings and drafts stay on the device; the sign-out sheet says so.
- **Signing out does change the device's id**, because the paintings and purchases stay with the Apple ID. To paint again, the person either signs back in with the same Apple ID (no code needed; their paintings and purchases come back) or enters an invitation code as a new guest (a new seat, with the guest's own free paintings).
- **Deleting the account** keeps the diary too. The device becomes a guest that needs a code to paint.

## How the server enforces the Beta (server/wire.js)

- One id per device: the Keychain UUID in the iOS app (StoreKit's appAccountToken), the account id, the guard's install id and the ledger key are the same value.
- `/api/generate` sets one painting aside (Daily Ritual credits, then free, then pack credits) before any paid call, counts it only when the painting is made, and hands it back on any failure. One take key is counted once, however often it is retried. None left: `402 no_paintings`, no paid call.
- `/api/billing/*` and `/api/account/apple` answer only to a request carrying the install token of the id they name, on a live invitation with its seat held.
- Signing in moves the guest's seat and ledger to the account only when the device proves it holds the guest id; deleting the account erases the ledger, frees the seat and removes stored results.

## If something goes wrong

- Stop all paid work: set `SONMIRA_DAILY_CAP_USD=0` and redeploy the current Production deployment.
- Cut off one group: remove its code from `SONMIRA_INVITE_CODES` and redeploy.
- Roll back code: Vercel Instant Rollback to the previous Production deployment.

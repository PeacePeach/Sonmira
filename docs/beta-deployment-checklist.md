# Beta deployment checklist

Merging code and deploying Production are separate steps, each with its own approval from Han. `vercel.json` keeps `git.deploymentEnabled.main: false`, so a merge into main deploys nothing.

## A. Before asking to merge PR #9

- [x] Engine V1 (PR #2) integrated with its frozen visual rules (`tests/visual-freeze.test.mjs` passes).
- [x] Latest main merged in; Paywall, Diary, Sharing and Settings unchanged against main.
- [x] Fake provider only by `SONMIRA_FAKE_PROVIDER=1`, never in Production. A Preview without it fails closed.
- [x] `SONMIRA_PROTECT=off` ignored on every deployment.
- [x] Unit tests, readiness e2e (reloads, interruptions, quota), Paywall, flow, loading and dev diagnostics all pass.
- [x] Trial merge with Payments (PR #6), Account (PR #8) and the brand icons (PR #7) is clean apart from additive conflicts and one privacy-text conflict. All tests pass.
- [ ] Open items with PR #6 and PR #8 settled (section F).
- [ ] PR #9 marked ready for review, then Han approves the merge.

## B. Code merge (Han's approval: merge)

1. Merge PR #9 into main. Nothing is deployed.
2. PR #2 is closed as merged through PR #9.
3. Payments (PR #6) and Account (PR #8) merge after it, each on Han's approval, with their wiring into the guard (section F).

## C. Production setup in Vercel (Han, no code)

Following `docs/beta-vercel-config.md`:

1. Connect Upstash Redis to Production (`KV_REST_API_URL`, `KV_REST_API_TOKEN`).
2. Add `OPENAI_API_KEY` from a dedicated beta OpenAI project with a monthly budget and alerts.
3. Add `SONMIRA_TOKEN_SECRET`, `SONMIRA_INVITE_CODES` and `SONMIRA_DAILY_CAP_USD=3`.
4. Confirm the Blob store (`BLOB_READ_WRITE_TOKEN`) is connected to Production.
5. Confirm `SONMIRA_FAKE_PROVIDER`, `SONMIRA_PROTECT` and `SONMIRA_REFERENCE_VIEW` are not set in Production.
6. Turn Deployment Protection on for Previews.

## D. Beta setup task: transcription check (Engine)

Tracked separately; it does not block Engine V1. When the beta's OpenAI key exists, add it to the PR #2 Preview, re-run the Playground Singing test on the 9 saved takes (about $0.04, no images), confirm takes 1 and 3 pass the words gate, then remove the key from that Preview. Details are in `docs/beta-vercel-config.md` section 5.

## E. Production deployment (Han's approval: deploy)

1. Deploy main to Production by hand, from the Vercel dashboard or with `vercel deploy --prod` from a clean checkout of main. Nothing deploys on its own.
2. Smoke test on the Production URL (costs about $0.16):
   - `POST /api/generate` with no token answers `401 invite_required`.
   - Enter a code, sing, paint once: the painting arrives; the log shows one `sonmira.guard` line with `outcome: "ok"`.
   - The OpenAI usage page shows one image and one transcription.
3. Share the invitation codes with the testers.

## F. Open items before calling the whole Beta app ready

- Payments (PR #6): billing endpoints take the account id from the request without proof of ownership, and have no rate limit. Its ledger is not yet called by the guard (`deps.charge` in `protect()`).
- Account (PR #8): privacy text to reconcile ("Nothing is uploaded" is no longer true). The guard is not yet wired for `verifyAccount`, `adoptSeat`, `eraseAccount`, or a seat check on every request.
- App: `createApiClient({ installId, storage })` fed by the native account id.
- Native beta: raise the per-address limits (`SONMIRA_LIMIT_IP_HOUR`, `SONMIRA_LIMIT_SESSION_IP_HOUR`) for carrier networks that share one address.

## If something goes wrong

- Stop all paid work: set `SONMIRA_DAILY_CAP_USD=0` and redeploy the current Production deployment.
- Cut off one group: remove its code from `SONMIRA_INVITE_CODES` and redeploy.
- Roll back code: Vercel Instant Rollback to the previous Production deployment.

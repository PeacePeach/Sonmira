# Vercel configuration for a real beta

The smallest setup that turns the guarded integration into a paid beta. The order of the steps, and the line between merging code and deploying Production, are in `docs/beta-deployment-checklist.md`.

## 1. Storage (one shared store)

Add **Upstash Redis** from Vercel Storage → Marketplace and connect it to the **Production** environment. Vercel then injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`. The guard keeps invitation seats, rate-limit counters, the day's spend and stored results there, so every function instance sees the same numbers.

Without it, Production refuses paid requests (`503 not_configured`); the in-memory store is never used in a deployed function.

## 2. Environment variables (Production)

| Variable | Value | Without it |
| --- | --- | --- |
| `OPENAI_API_KEY` | Key of a dedicated OpenAI project for the beta, with a monthly budget and alerts | Painting answers `not_configured` |
| `SONMIRA_TOKEN_SECRET` | 32+ random characters (`openssl rand -base64 32`), only in Production | Paid endpoints refuse (`not_configured`) |
| `SONMIRA_INVITE_CODES` | `CODE-ONE,CODE-TWO`: one code per group of testers, 5 devices each | Paid endpoints refuse (`not_configured`) |
| `SONMIRA_DAILY_CAP_USD` | `3` | Defaults to 3 |
| `BLOB_READ_WRITE_TOKEN` | Set by connecting the Engine's private Blob store (references) | Painting answers `no_reference`; nothing is charged |

Nothing else is required. Optional later: `SONMIRA_COST_IMAGE_USD` once the real per-image price is known from OpenAI usage, and `SONMIRA_LIMIT_<NAME>` to tune a limit (`GENERATE_HOUR`, `GENERATE_DAY`, `UNDERSTAND_HOUR`, `UNDERSTAND_DAY`, `INVITE_GENERATE_DAY`, `INSTALLS_PER_INVITE`, `IP_HOUR`, `SESSION_IP_HOUR`).

Never set in Production: `SONMIRA_FAKE_PROVIDER` and `SONMIRA_PROTECT` (both are ignored there anyway), `SONMIRA_REFERENCE_VIEW`.

Kill switch, no deploy needed: set `SONMIRA_DAILY_CAP_USD` to `0` (every paid request is refused with `spend_cap`), or remove a code from `SONMIRA_INVITE_CODES` (its devices lose access). Vercel applies environment changes on the next deployment, so redeploy the current Production deployment after changing them.

## 3. Project settings

- **Production deploys stay manual** (decided by Han). `vercel.json` keeps `git.deploymentEnabled.main: false`, so merging to main deploys nothing; Production is deployed by hand, after approval (see the checklist).
- **Function duration.** `vercel.json` asks for 120 s on `/api/generate` and 60 s on `/api/understand`; the plan must allow 120 s.
- **System environment variables** stay exposed (the default), so functions see `VERCEL_ENV`.
- **Deployment Protection** on Preview deployments, so only the team opens Preview URLs.

## 4. No-cost test deployments

The fake provider is on only where `SONMIRA_FAKE_PROVIDER=1` is set, and never in Production. To keep a Preview usable for testing at no cost, add `SONMIRA_FAKE_PROVIDER=1` to the Preview environment (it can be limited to one branch). It then uses the invitation code `SONMIRA-PREVIEW`, a fixed token secret and an in-memory store, and paints with the offline renderer.

A Preview without that switch uses the real provider behind the full guard. Without its own secret, codes and shared store, it refuses paid requests (`503 not_configured`). `SONMIRA_PROTECT=off` is ignored on every Vercel deployment.

## 5. Beta setup task: transcription check (Engine)

A separate setup task; it does not block Engine V1. When `OPENAI_API_KEY` is added for the beta, before the merge into main:

1. Add the same key to the Preview of `engine/procedural-watercolor` (PR #2). That Preview has no invitation guard, so keep it behind Deployment Protection.
2. Open its Playground **Singing test** in the browser that holds the 9 saved takes. Each take's words are transcribed once, with no re-recording (about $0.04, no images).
3. Tap **Copy results for Claude** and paste them into the Engine thread. Confirm that no words are invented for the hum, that the unfinished line fails the words gate, and that the sung lines with words (takes 1 and 3) pass it and keep their tiers.
4. Take the key off that Preview.

Details: `docs/engine-v1.md`, "Beta setup: transcription check".

## 6. Check after setting it up

1. `POST /api/generate` with no token: `401 invite_required`.
2. Open the app, enter a code, sing, paint once: the painting arrives; the function log shows one `sonmira.guard` line with `outcome: "ok"` and `dayUsd` of about 0.16.
3. The OpenAI project's usage shows one image and one transcription.

## Proof that a deployment can't make an unguarded paid call

`tests/no-paid-calls.test.mjs` loads the deployed functions under each environment a deployment can have, with a real-looking OpenAI key set, and counts requests to `api.openai.com`. The counts are zero in every case: a Preview with the switch paints on the fake provider; a Preview without it on any branch, a Preview with `SONMIRA_PROTECT=off`, a half-configured Preview, and Production with either switch set all refuse before any provider call.

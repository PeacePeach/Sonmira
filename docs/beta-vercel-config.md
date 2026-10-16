# Vercel configuration for a real beta

The smallest setup that turns the guarded integration into a paid beta. Nothing here is needed for the no-cost Preview, which runs on the fake provider with no setup (see the end).

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

## 3. Project settings

- **Production deploys.** `vercel.json` currently has `git.deploymentEnabled.main: false`, so merging to main does not deploy. For the beta, either remove that line in the merge or promote a deployment by hand.
- **Function duration.** `vercel.json` asks for 120 s on `/api/generate` and 60 s on `/api/understand`; the plan must allow 120 s.
- **System environment variables** stay exposed (the default), so functions see `VERCEL_ENV`.
- **Deployment Protection** on Preview deployments, so only the team opens Preview URLs.

## 4. Code change at merge time

Remove the branch-name switch in `server/dev/mode.js` (Previews of `claude/production-readiness*` turn the fake provider on by themselves). With it gone, a Preview is free only with `SONMIRA_FAKE_PROVIDER=1` in the Preview environment; without that, and without Preview's own secret, codes and store, a Preview refuses paid requests.

## 5. Check after setting it up

1. `POST /api/generate` with no token: `401 invite_required`.
2. Open the app, enter a code, sing, paint once: the painting arrives; the function log shows one `sonmira.guard` line with `outcome: "ok"` and `dayUsd` of about 0.16.
3. The OpenAI project's usage shows one image and one transcription.

## Today's no-cost Preview, for reference

Previews of the `claude/production-readiness*` branches use the fake provider: invitation code `SONMIRA-PREVIEW`, a fixed token secret, an in-memory store per function instance, and a procedural painting instead of an OpenAI call. `tests/no-paid-calls.test.mjs` loads the deployed functions under each environment a deployment can have, with a real-looking OpenAI key set, and shows no request reaches `api.openai.com`.

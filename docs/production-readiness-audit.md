# Production readiness audit

Date: 2026-10-16 · Scope: reliability, security, operating cost.
Audited read-only: `main` (370fc91), PR #2 engine (`engine/procedural-watercolor`, 61b6ba5), PR #4 paywall (`claude/paywall-1ktg9q`, 801e6d7). Findings describe what ships once both PRs land. Nothing here touches singing classification, prompts, references, compositions, pricing or the paywall UI.

## Baseline

- **What runs where.** The app is the web prototype (IndexedDB on the device). With PR #2 the default engine is `ai`: the browser analyses the voice, then calls two Vercel functions, `/api/understand` (transcription + text model) and `/api/generate` (gpt-image edits with one reference). The OpenAI key and Blob token are read only on the server (`src/engine/providers/*`, `api/*`); no key reaches the client. Good.
- **Tests.** `npm test` passes on all three branches (main, PR #2 157/157, PR #4 42/42) with no network. Provider and handler code is unit-tested with mocked `fetch`.
- **Latency (measured).** Provider time for the image alone was 23.6 to 33.8 s across 9 saved validation runs (`sonmira-v2/validation*/results.json`, medium quality, 1024×1536). Recording-to-image end to end is not measured anywhere yet.
- **Paid calls per Create painting:** 1 transcription + 1 text-model call (only when words are heard) + 1 image edit.

## P0: must fix before external beta

| # | Finding and risk | Files | Recommended fix | Size |
| --- | --- | --- | --- | --- |
| P0-1 | **Paid endpoints are open.** `/api/generate` and `/api/understand` have no auth, quota or rate limit. Anyone with the URL can loop image generations on our key, and `spec.concept.text` (240 chars) makes it a general image proxy. `/api/understand` accepts up to 4 MB of audio with no duration check (minutes of transcription per call at a low bitrate). | `api/generate.js`, `api/understand.js` | Shared guard `api/_guard.js`: anonymous install id + beta invite token in a header, per-install and per-IP limits (for example 5/hour, 15/day) and a **global daily spend cap** that returns a calm "resting" error. Counters in Vercel KV / Upstash. Reject audio over ~1 MB or 35 s. | M |
| P0-2 | **No spend ceiling outside the code.** One key, no budget, Preview and Production share it. | Vercel + OpenAI config | Separate OpenAI project and key per environment, hard monthly budget and alerts on the OpenAI project, Vercel Deployment Protection on Preview URLs. Config only. | S |
| P0-3 | **The recording is not preserved before generation.** The take (audio, analysis, note) lives only in memory in `sing.js`. A reload, iOS discarding the page during the 30 to 60 s wait, or closing Sing loses the song. A finished painting that was not yet *Kept* is also lost on close, although it was paid for (and PR #4 counts it). | `src/app/screens/sing.js`, `src/app/storage.js`, `src/app/main.js`, `src/app/screens/diary.js` | A `drafts` store (IndexedDB v2) written at stop with `{key, audio, analysis, note, status}`; status moves `recorded → understanding → painting → ready(painting) → kept`, or `failed(code)`. On launch the diary offers pending drafts: *Paint it* / *Keep it* / *Discard*. Saving an entry and deleting its draft happen in one transaction. | M |
| P0-4 | **Retries and interruptions pay twice.** The server never sees a request key. *Try again* reruns transcription, text model and image. The client gives up at 150 s while the function runs to 120 s and the OpenAI call has no abort, so a slow image completes, bills, and is thrown away. On iPhone, locking the screen mid-wait kills the fetch while the server finishes and bills; the retry bills again. | `src/engine/engines/ai.js`, `api/generate.js`, `api/understand.js`, `src/engine/providers/openai*.js` | Send the per-take key (PR #4 already creates `take.key`) as `Idempotency-Key`. Server keeps `{status, result}` per install+key for 24 h (metadata in KV, image in private Blob); a second call with the same key returns the stored result or `in_progress`, never a new paid call. Same for `/api/understand`. Client resumes by key after a timeout or a relaunch (works with P0-3). | M–L |
| P0-5 | **Privacy text is now false.** Legal says "Nothing is uploaded", but with the `ai` engine the recording goes to our server and to OpenAI. | `src/app/screens/legal.js` | State what is sent (audio, note), to whom, that nothing is stored server-side beyond the P0-4 cache window, and OpenAI's retention. Owner: app track. | S |
| P0-6 | **No regression coverage for the failure paths**, and none can run without paid calls today. Nothing tests the handlers for abuse limits, duplicate keys, timeouts, or the app for reload mid-generation, retry after failure, double tap. | `test/`, `tests/e2e/` | A fake generation backend (handlers with injected `fetchImpl` + in-memory KV; Playwright `route()` for e2e) and tests: rate limit, spend cap, same key twice → one paid call, timeout → resume, reload while painting → draft recovered, *Try again* after failure, double tap on *Create painting*. Ships together with P0-1, P0-3, P0-4. | M |

## P1: should fix before public launch

| # | Finding and risk | Files | Recommended fix | Size |
| --- | --- | --- | --- | --- |
| P1-1 | **Entitlements are client-only.** PR #4's wallet is `localStorage`; clearing site data restores the 3 free paintings, and nothing on the server checks them. Its own `docs/paywall.md` already plans a server ledger. | `src/app/billing/*` (PR #4), `api/generate.js` | Ledger in the generation service, reserve/commit/release keyed by the same idempotency key as P0-4, so one key = one charge = one paid call. Built with the paywall thread; I would add only the server hooks. | L |
| P1-2 | **Timeouts disagree and the server never retries.** Client 150 s, function 120 s, OpenAI unbounded. A 504 from Vercel is not JSON, so the user gets the generic error. | `api/*.js`, `vercel.json`, `src/engine/engines/ai.js` | OpenAI abort at ~100 s, function 120 s, client ~125 s then resume by key. One server retry with jitter only on OpenAI 429/5xx before any image bytes (not billed). Guard the bare `JSON.parse` in `api/generate.js`. | S |
| P1-3 | **No usage or cost visibility.** `usage` comes back from OpenAI but is only returned to the browser. | `api/*.js` | One structured log line per paid call: install id, key, endpoint, model, quality, size, ms, usage, outcome, estimated cost. Daily counters in KV (same as the P0-1 cap), a protected `/api/usage` summary, alerts at 50/80 % of the cap. | S–M |
| P1-4 | **One bad diary record hides the whole diary.** `listEntries()` maps every record; one throw marks storage failed. No schema version or migration; `navigator.storage.persist()` result ignored (Safari in a tab may evict after 7 days unused). | `src/app/storage.js`, `src/app/main.js` | Per-record try/catch with a quarantine list, explicit DB migrations, check `persist()` and suggest *Add to Home Screen* when it is refused. | S–M |
| P1-5 | **Diary boot loads every audio and image.** `getAll()` decodes all blobs at launch; at one painting a day that is hundreds of MB after a year. | `src/app/storage.js`, `src/app/screens/diary.js` | Store metadata and blobs separately; load blobs on demand; keep a small thumbnail per entry. | M |
| P1-6 | **No backup.** Backup / restore says *Coming soon*; losing the phone loses every memory. | `src/app/screens/settings.js` | Export / import an archive (entries + audio + paintings) first; iCloud in the native app. | M |
| P1-7 | **Latency is unmeasured and partly avoidable.** Steps run in series: decode + pitch track, then base64 upload, transcription, text model, a second request, a Blob read of the reference (registry is cached, image bytes are not), the full image stream buffered on the server, then ~400 KB base64 back. | `src/engine/engines/ai.js`, `api/generate.js`, `src/engine/providers/reference-store.js` | First, per-stage timings into the P1-3 log and the dev panel. Then, without touching quality: start the upload while the local pitch analysis runs, cache reference bytes in the warm function, return the image as bytes or a Blob URL instead of base64 JSON. Expected saving is a few seconds; the image itself (~24–34 s) stays. | S–M |

## P2: can defer

| # | Finding | Files | Fix | Size |
| --- | --- | --- | --- | --- |
| P2-1 | `GET /api/generate` publishes model, quality and size; `?dev` (force tier, analyze only) and the Playground ship with Production. | `api/generate.js`, `src/app/dev.js`, `.vercelignore` | Answer config only on Preview; leave `?dev` and `playground/` out of Production builds. | S |
| P2-2 | Partial image from the stream is dropped; it could reveal the painting earlier. Changes the loading experience, so it is a product call. | `src/engine/providers/openai.js`, `api/generate.js` | Forward the partial image over SSE if wanted. | M |
| P2-3 | Generated images are kept as JPEG ~300–500 KB with no size check before save; a quota error only shows a toast. | `src/app/storage.js` | Estimate quota with `navigator.storage.estimate()` and warn early. | S |

## Coordination and order

1. **Merge hazard, not mine to fix.** PR #2 and PR #4 both rewrite `generate()` in `sing.js` from the same base and will conflict: PR #2 adds stage captions and its error screen, PR #4 adds reserve/commit/release and its own error screen. Whoever merges second has to combine them by hand. Also, PR #4 releases every hold on launch (`wallet.releaseAll()`), which assumes generation runs in the app; with server generation a painting can finish after the relaunch. P0-4's key fixes this once both use it.
2. **Order.** P0-2 now (config). P0-1, P0-4 and their tests in new server files (`api/_guard.js`, `api/_idempotency.js`) plus small edits in `api/*.js`, which do not overlap PR #4. P0-3 touches `sing.js`, so it lands after PR #2 and PR #4 merge, or on top of whichever lands first, as a separate `src/app/drafts.js` with a few hooks.
3. **Native app.** `design-reference/README.md` recommends SwiftUI later. Everything server-side here carries over unchanged; the drafts state machine (P0-3) is the same design for the native app.

## Decisions needed from Han

1. **Beta access.** Invite code + per-install limits (recommended), or anonymous with limits only.
2. **Daily spend cap** for the beta (a dollar amount; the app shows a calm "resting" message when it is hit).
3. **Unkept paintings.** Keep a finished painting as a draft when Sing is closed without *Keep it* (recommended, it was paid for), or discard as today.

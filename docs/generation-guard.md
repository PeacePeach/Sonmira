# Generation guard and recoverable drafts

P0-1, P0-3, P0-4 and P0-6 of `docs/production-readiness-audit.md`. Everything here is new files; the hooks into existing files are listed at the end and are not applied yet.

## Server: `server/protect/`, `api/session.js`

Every POST to a paid endpoint passes, before any provider call:

1. **Invitation.** `Authorization: Bearer <token>`. The app gets the token once from `POST /api/session { invite, installId }`. One code admits at most `INSTALLS_PER_INVITE` devices (5); the same device asking again doesn't use another place. Removing a code from `SONMIRA_INVITE_CODES` revokes all its tokens. Code guesses are limited per network address (10/hour).
2. **Idempotency.** `Idempotency-Key: <take key>.<endpoint>`. A key that already succeeded returns the stored response (24 h) with no new paid call; a key still running returns `409 in_progress` and the app waits. Failures are not stored, so *Try again* really tries again.
3. **Limits.** Per install: 6 paintings/hour, 15/day; 12 understandings/hour, 30/day. Per invitation code: 60 paintings/day across its devices. Per network address: 60 guarded requests/hour. Replays don't count.
4. **Hard daily cap** (`SONMIRA_DAILY_CAP_USD`, default **$3**, UTC day). Each call reserves its worst-case cost atomically before it starts, so requests already in flight count; one that would pass the cap is refused with `503 spend_cap`. Afterwards: released if no provider call was made (4xx, `not_configured`, `no_reference`), kept if one may have been (provider error, timeout, crash), and reduced to the transcription alone when no words were heard.
5. **Fails closed.** Without KV, a secret or invitation codes, paid endpoints answer `503 not_configured`; if KV is unreachable, `503 protection_unavailable`.

One JSON log line per decision (`evt: "sonmira.guard"`): endpoint, install prefix, invitation id (never the code), key, outcome, status, ms, reserved and settled USD, the day's total, provider usage.

### Costs the cap counts

The guard counts fixed unit costs, not the provider bill: **$0.15 per image**, $0.01 per transcription, $0.005 per text-model call. At $3/day that is about 18 paintings with words, or 20 without. Set `SONMIRA_COST_IMAGE_USD` to the real per-image price from the OpenAI usage page once a few beta days are in; a higher estimate only makes the cap stricter.

### Environment (Production and Preview)

| Variable | Value |
| --- | --- |
| `SONMIRA_TOKEN_SECRET` | 32+ random characters, different per environment |
| `SONMIRA_INVITE_CODES` | `CODE-ONE,CODE-TWO` (case, spaces and dashes are ignored) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Vercel KV / Upstash Redis (Storage → Marketplace → Upstash) |
| `SONMIRA_DAILY_CAP_USD` | `3` |
| optional | `SONMIRA_COST_*_USD`, `SONMIRA_LIMIT_<NAME>` (see `server/protect/config.js`) |
| local only | `SONMIRA_PROTECT=off` (ignored on every Vercel deployment) |

Also (P0-2, OpenAI dashboard, no code): a separate project and key per environment, a monthly budget with alerts, and Vercel Deployment Protection on Preview URLs.

## App: `src/app/protect/`, `src/app/drafts/`

- `installApiClient({ askInvite })` wraps `fetch` for `/api/generate` and `/api/understand` only: adds the token and the key, asks for an invitation when needed (`askInviteCode`, a small sheet in the Share sheet's style), and waits on `in_progress`. The engine is unchanged.
- `withGenerationKey(take.key, fn)` keys every request of one take.
- `createDrafts()`: its own IndexedDB database (`sonmira-drafts`), so the diary's schema is untouched and drafts never show among entries.
  - `begin(take)` when *Create painting* is tapped, before any paid call;
  - `ready(key, painting)` when it arrives; `failed(key, code)` on an error;
  - `keep(key, entry, app.addEntry)` writes the entry (id `e-<key>`, so a second keep can't duplicate it), then removes the draft;
  - `discard(key)`; `reconcile(entryIds)` at launch.
- `mountDraftsRow(app)`: one quiet line at the top of the diary, "One painting is waiting for you. Open", opening a sheet with each draft (painting or wash, note, length), *Open* and a two-tap *Discard*.
- Opening a draft that was still painting when the app closed asks with the same key: the server returns the painting it already made, or the app waits for it.

## Tests (no network, no paid calls)

- `tests/protect.test.mjs`: invitation, revocation, fail-closed, idempotent replay (large bodies too), concurrent same key, retry after failure, per-install / per-code / per-address limits, the hard cap with requests in flight, reservation release and keep, session limits. Runs on the in-memory store and on real Redis when `redis-server` is installed (the same Lua scripts Upstash runs).
- `tests/protect-client.test.mjs`: the app client against the real guard in-process: invitation flow, one paid call per take across retries, waiting while painting, the caller's timeout.
- `tests/drafts.test.mjs`: draft lifecycle, keep once, failed save keeps the draft, discard, reconcile, storage failure never blocks painting.

## Hooks into existing files (not applied yet)

| File | Owner, overlap | Change |
| --- | --- | --- |
| `api/generate.js`, `api/understand.js` | Engine (PR #2) only | `export default protect('generate', createHandler({ fetchImpl: timedFetch(100_000) }))`; understand with 50 s |
| `playground/app.js` | Engine (PR #2) only | `installApiClient(...)`, or the Playground gets 401 once the guard is on |
| `src/app/main.js` | Paywall (PR #4) edits `boot()` too | install the client; `app.drafts = createDrafts()`, `init()`, `reconcile()` |
| `src/app/screens/diary.js` | Paywall (PR #4) edits one line | the drafts row above the list |
| `src/app/screens/sing.js` | Engine (PR #2) and Paywall (PR #4) both rewrite `generate()` | `mountSing(app, { draft })` resume; take key; `drafts.begin` before the engine; `withGenerationKey`; `ready` / `failed`; `guardMessage(e.code)`; *Keep it* through `drafts.keep`; *Sing again* discards only a draft with no painting |
| `src/app/screens/legal.js` | Paywall (PR #4) edits it | privacy text: the recording and note go to our server and OpenAI to paint; a finished painting is held on the server for 24 h so it isn't lost |

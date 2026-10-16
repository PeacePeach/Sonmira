# Engine V1: where it runs, how it changes, what it can't do yet

## Where each part runs

Sonmira on iPhone is this web app, added to the Home Screen. There is no native iOS project and no service worker, and pages are served with `Cache-Control: no-cache`. The browser loads the current code from Vercel on every launch.

| Step | Runs on | Code |
|---|---|---|
| Recording, live wash | Client | `src/app/`, `engines/real.js` |
| Pitch track, singing analysis, singing thresholds | Client | `analysis/` (`SINGING_CALIBRATION`) |
| Words gate, tier decision | Client | `interpret/lyrics.js` (`GATE_CALIBRATION`), `understand.js` |
| Emotion, motif, style family and seed | Client | `plan.js`, `direct/` |
| Transcription and lyrics reading (prompt, models) | Server | `api/understand.js`, `providers/openai-understand.js` |
| Image prompt, reference choice within the family, image call | Server | `api/generate.js`, `direct/`, `providers/openai.js` |
| Reference library (registry and images) | Server, Vercel Blob | `providers/reference-store.js` |
| Invites, limits, spend cap | Server | Production Readiness branch |

The server re-checks what the client sends. `cleanSpec` validates every field, and a family from a different tier is refused. A tampered client can only change its own painting, and the guard still applies its limits.

## What can change without a new iOS build

All of it. Client and server code ship together in one Vercel deploy, and the next launch picks it up. There are three ways to make a change:

| Change | How it ships |
|---|---|
| Image prompts, family rules, composition | Code change, then deploy. `tests/visual-freeze.test.mjs` fails until the change is approved and the snapshot is refreshed. |
| Singing thresholds, words gate, interpretation | Code change, then deploy. Re-check them for free in the Playground Singing test, which re-analyses the saved takes. |
| Image or text models, image quality and size | Environment variables (`OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `OPENAI_IMAGE_SIZE`, `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TEXT_MODEL`), then redeploy |
| Reference images and registry | `tools/references.mjs`. It writes the Blob registry, which the live server reads within 30 s, with no deploy. |

Iteration is safe in these ways:
- Every branch gets its own Preview.
- Production never deploys from a push (`main` auto-deploy is off).
- A bad deploy can be undone with Vercel's instant rollback.

If the app is ever wrapped as a native App Store app, the wrapper should load the hosted URL. Bundling the files into the app would make every client-side change above wait for a new iOS build.

## The one gap: reference edits bypass deploys

Production picks references from the registry in Blob, not from the tested registry in the repo (`direct/references.js`). An edit there has three problems:
- It reaches Production within 30 s, without Preview, without tests and without review.
- If Preview shares the Blob store, a reference experiment on Preview changes Production.
- Vercel's rollback doesn't undo it.

**Proposed minimal fix:** select from the bundled registry, which is in git, covered by the freeze test and rolled back with the deploy. Blob would keep only the image files. The change is a few lines in `api/generate.js`, plus a test.

Before switching, run one check with the Blob token (`node tools/references.mjs verify` and `list`, compared with the bundled registry). It confirms that every active bundled reference has its image in Blob. The 10 approved Validation 4 requests were rebuilt from the bundled registry with identical prompts and references, so at least those families already match.

## Known classification limitations (V1)

The thresholds are provisional. They were calibrated on one singer, 9 takes, Chrome on Mac, on 16 Oct. The engine's tier matches Han's ear on takes 4, 6, 7 and 8, and spoken words are Loose.

1. **Wide vibrato can read as weaker tuning.**
   - Take 9 (slow, with vibrato) is Gathered; Han hears Resolved.
   - On short notes, the raw pitch centre shifts with where the vibrato cycle stops.
   - A candidate fix (centres from the smoothed line) was tried on the 9 takes and rejected. It didn't lift take 9, it moved take 7 down, and agreement fell from 6/9 to 5/9.
   - The error is conservative: a take can land one tier low, never high.
2. **Key drift is noisy when there are few notes.**
   - It compares the tuning grid of 2 s windows, and short takes have only about 2 notes per window.
   - So a 10–15¢ change in one note can move the result by 30¢ or more (take 7: 39¢ → 73¢ under the rejected fix).
   - Drift near the 50¢ limit is not a reliable signal on its own.
3. **A hesitant start isn't detected.** Take 6 is still Gathered, but because of key drift, not because of the hesitation.
4. **Slow pitch wavering** (about ±50¢ at 1–2 Hz on long notes) can still pass as Resolved, in synthetic tests.
5. **Words on real audio are untested.**
   - The Preview has no OpenAI key, so the hum and the unfinished line were judged on the singing alone.
   - The current rule is that a take with no words is Loose at the words gate, so a controlled, expressive hum cannot be Resolved. Changing that is a product decision.
6. **Real takes so far** are one voice, one browser and one microphone. iPhone Safari (which records AAC) is covered by format tests, not by labelled takes.

## Beta setup: transcription check (agreed with Han, 16 Oct)

When the beta's `OPENAI_API_KEY` is set, before the merge into main:
1. Enable the key for the PR #2 Preview as well.
2. Han opens the Playground Singing test in the same browser as the 9 saved takes. Each take's words are transcribed once, automatically, with no re-recording. This costs about $0.04 and makes no images.
3. Han taps **Copy results for Claude** and pastes the results into the Engine thread.
4. Check:
   - whether any words are invented for the hum;
   - that the unfinished line fails the words gate;
   - that sung lines with words keep their tiers.

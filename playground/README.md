# Watercolor Engine Playground

A local page for trying the real engine with your own voice before it goes into the app.

```sh
npm run playground        # starts http://localhost:5180/playground/ and opens it
```

Needs Node 18 or newer and nothing else. Use Chrome, Safari or Edge on the Mac (Chromium builds without AAC cannot read M4A).

- **Voice:** record up to 30 s with the microphone, or upload WAV, MP3 or M4A. Recording turns off echo cancellation, noise suppression and auto gain so the analysis hears the raw voice.
- **Analysis:** the take goes through `src/engine/analysis` (measurements) and `src/engine/interpret` (control score, confidence, tier, emotion and motif from the note). Warnings show when confidence is low, the take is short or silent, or an override is active.
- **Painting:** `src/engine/generate.js` paints it in a worker at 720 × 900, with the same style curve and palette rules as the app.
- **Developer overrides:** tier (Loose, Gathered, Resolved or any style position), emotion, motif and seed. "Paint all three tiers" keeps the audio, note and seed fixed and changes only the tier.
- **Library:** every run (audio, note, overrides, features, result, PNG) is kept in this browser's IndexedDB. Load restores a run into the studio with its seed; PNG, JSON and audio download; tick runs to compare them side by side.

Browser check: `npm run playground -- --no-open &` then `node tools/playground-e2e.mjs` (needs Playwright and ffmpeg).

## Hosted preview

The repo is connected to Vercel, which builds a preview for each pushed branch and posts the link on its PR. The Playground lives at `<preview>/playground/`. `vercel.json` serves the files as they are (no build), marks every page noindex, and turns off deployments from `main`. Keep Vercel Authentication on in Deployment Protection so only signed-in project members can open previews.

## Image providers

"Painted by" picks the provider. Every painting and library card is labelled with the provider that made it.

- **Procedural renderer (JS, no AI):** runs in the page, free.
- **OpenAI image model:** the page runs analysis, interpretation and the visual spec, then posts the spec to `/api/generate`. The server builds the prompt from the spec (`src/engine/direct/`) and calls OpenAI with its own key, so the key never reaches the browser. Configure it with `OPENAI_API_KEY` (and optionally `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `OPENAI_IMAGE_SIZE`) in the Vercel project's Preview environment, or in your shell before `npm run playground`. Each AI painting is billed to that OpenAI account.

## Reference ↔ output comparison

OpenAI paintings show the original reference on the left and the output on the right, with the reference id, style family, tier, emotion, motif, energy, where the subject came from, seed, model and the prompt check. "Reference (OpenAI only)" pins one reference so several styles can be painted with the same note, tier, emotion, motif and seed. In Library & compare, tick runs and press Compare to stack their pairs. Under each pair, "What the painting shows" takes a short description and flags people, objects from that reference, and objects the words do not name (no paid call).

The reference image comes from `/api/reference?id=…`, which reads it on the server from the same private store as `/api/generate`, so no storage URL reaches the page. It is off in Production unless `SONMIRA_REFERENCE_VIEW=1` is set there.

Browser check without paid generation: `SONMIRA_REFS_DIR=… npm run playground -- --no-open &` then `node tests/e2e/playground-compare.mjs`.

## Singing test

`?view=singing` guides nine takes recorded in the page (hum, spoken words, an unfinished line, casual, falling apart, hesitant start, best line, the same song sung well, slow with vibrato). Each take goes through the app's own decision (`src/engine/understand.js`): the words are transcribed and read by `/api/understand` (one transcription, plus one short text call when there are words; no image), then the lyrical-completion gate and whole-take singing control pick the tier. The page shows the tier, why (the checks that decided it), the transcript, a pitch timeline with each 2 s stretch shaded by how controlled it was, and every measurement. The singer sets the tier they expect before singing and the tier they judge after listening; the calibration table lays every check's value against its threshold for all takes. Takes, audio and the word readings stay in this browser's IndexedDB; reloading or "Re-analyse" re-measures with the current code for free. "Copy results for Claude" copies the measurements and labels (no audio) as JSON.

Browser check without paid calls: `npm run playground -- --no-open &` then `node tests/e2e/singing-test.mjs`.

Results can reach Claude without copying: with `RESULTS_GITHUB_TOKEN` (fine-grained, Contents read/write on one private repository only) and `RESULTS_REPO` (`owner/name`) set in Vercel's Preview environment, `/api/singing-results` saves each take's results (no audio) to `singing-test/<recordedAt>-take<n>.json` in that repository after analysis and whenever its label changes. Off in Production; the token stays on the server.

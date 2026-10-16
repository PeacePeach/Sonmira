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

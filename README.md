# Sonmira (声忆) — interactive prototype

A singing diary that turns short voice recordings into watercolor paintings.
Plain HTML, CSS and JavaScript (ES modules). There is no build step and nothing to install to run it.

## Run it

```bash
cd sonmira
node server.js            # Node 18+ → http://localhost:5173
```

Open it in a desktop browser to see it in an iPhone-sized frame (402×874). In a narrow window or on a phone it fills the screen and respects safe areas.

### On an iPhone

Browsers only allow the microphone on `localhost` or `https`, so:

```bash
node server.js --https    # makes a self-signed certificate with openssl
```

The terminal prints `https://<your-computer-ip>:5173`. Open that in Safari on the same Wi-Fi. Safari warns about the certificate the first time, so tap **Show Details → visit this website**. For a full-screen, app-like view, use **Share → Add to Home Screen**.

If that's awkward, any HTTPS tunnel also works, e.g. `npx localtunnel --port 5173` or `cloudflared tunnel --url http://localhost:5173`.

## What works

| | |
| --- | --- |
| Diary | Paintings newest-first, grouped by day. A calendar view with a dot on days that have entries; tap a day to filter, tap again to clear. Start day of week comes from Settings. |
| Sing | Ready → recording (real mic, timer, audio-reactive halo and live wash, auto-stop at the limit) → preview (playback, optional note, *Sing again*) → “Finding the shape of your song…” → result (painting, playback with progress, interpretation line, editable note, *Keep it* / *Sing again*). |
| Painting | Full painting, date, note, play/pause of the original recording. Delete asks for a second tap. |
| Settings | Recording length 15 / 30 s and start day Sun / Mon both work and are remembered. Daily reminder, Diary lock, Backup / restore and Rate say **Coming soon** and do nothing. Privacy policy and Terms open short prototype drafts. |
| Share | A share icon on the result screen and on a saved painting. **Share image** makes a 2160×2700 (4:5) card with the painting, the optional note, the date and a small *Sonmira* wordmark. **Make a video** records a 1080×1920 (9:16) MP4 with the original recording (up to 30 s), the painting and a quiet waveform. Both open the system share sheet (on iPhone, the native iOS sheet with Save Image, Messages, Instagram…). Everything happens on the device and nothing is uploaded. Video is offered only where the browser can record MP4. |
| Paintings & paywall | 3 free paintings, then a quiet sheet offers **Daily Ritual** (monthly, one painting credit a day, saved up to 30) or **Little Moments** (10 paintings, one-time), with *Why we charge*, renewal details, Restore purchases, Terms and Privacy. A painting is counted only when it's made. Purchases are a clearly labeled **development simulation**: nothing is charged. Settings → Paintings shows what's left. See `docs/paywall.md`. |
| Account | Optional, never asked before painting. **Settings → Account** offers Sign in with Apple, which keeps paintings left and purchases with the person on a new iPhone; the diary, recordings and paintings stay on the device. Sign out and Delete account (two taps, Apple confirms; the diary is erased only if chosen). In web previews Apple is a labeled **development simulation**. See `docs/account.md`. |
| Persistence | Entries, audio and paintings are stored in IndexedDB and survive reloads. Settings are kept in localStorage. |

### Edge cases handled

- **Microphone denied, missing, busy, or on an insecure page**: a calm explanation with *Try again* and *Back to diary*. Nothing is faked.
- **Very short take (under ~1.5 s)**: goes back to the start with “That was very short. Hold a note a little longer.”
- **Near-silent take**: the preview says “We could barely hear you…” and still lets you continue.
- **Backgrounding the app mid-take** (call, lock screen) ends the take cleanly instead of losing it.
- **Storage failure on save**: the result stays on screen and a quiet message asks you to try again. Private modes without storage show a notice on the diary.
- **Playback the browser can't decode**: the player says so instead of failing silently.
- **Engine missing or throwing**: the app falls back to the mock engine, or to a wash-only painting. Neither a failed nor an interrupted generation is counted as a painting, and a take is never counted twice.

## Architecture: two tracks, one contract

```
src/
  app/                    Track A: screens, recorder, player, storage (no engine internals)
    share/                share card + video composition, export, system share sheet
    billing/              products, painting wallet (reserve/commit/release), StoreKit-shaped store + dev simulation
    paywall/              paywall sheet, purchase simulator, legal sheet, balance copy
    main.js               state + navigation
    screens/              diary, sing, detail, settings, legal
    ui/                   painting card, playback row, dom helpers, icon registry (docs/icons.md)
    recorder.js           getUserMedia + MediaRecorder + AnalyserNode frames
    storage.js            IndexedDB (memory fallback)
    dev.js                developer panel (only with ?dev)
  engine/
    contract.js           ← the shared interface (shapes + validators)
    engines/index.js      registry: getEngine() picks mock | real
    engines/mock.js       simple stand-in engine (Track A keeps the app working)
    analysis/ interpret/ render/ engines/real.js   Track B: the real voice-to-watercolor engine
```

The app only calls `getEngine()` and uses the contract:

```js
const session = engine.createLiveSession({ sampleRate, maxSeconds });
session.push(samples)  // every ~100 ms → { level, hue, stroke }
session.finish()       // → Analysis { durationSec, flags: { silent, tooShort }, wash, features }
await engine.generate({ analysis, note, audioBlob })  // → Painting
```

A `Painting` carries `completeness` (loose / gathered / resolved), `emotion` (tender / bright / melancholic / intense), `motif` (water / sky / garden / landscape / abstract), `artwork` (a bundled asset or a generated image blob), `wash` and an `interpretation` ({ voiceLabel, summary, dryingLine }). Each entry stores its `analysis` too, so a future engine can re-paint old entries.

**Switching engines:** add `?engine=real` (or `?engine=mock`) to the URL, or change `DEFAULT_ENGINE` in `src/engine/engines/index.js`. No UI file changes. The default is currently `mock`. More detail is in `ENGINE.md` and `docs/engine-pipeline.md`.

The audio measurements are descriptive only. Nothing in the UI presents them as singing accuracy, pitch or rhythm scores.

## Developer tools

- `?dev` shows a small panel outside the phone frame. It can force *loose / gathered / resolved*, paint with a synthetic “sample voice” (no mic needed), add sample entries (with playable audio), clear the diary, and switch engines.
- `dev/gallery.html` runs the engine on synthetic voices and notes for all three completeness levels and shows what it picks, along with emotion, motif and copy. Use `?engine=real` to compare.
- `window.sonmira` in the console exposes app state.

## Tests

```bash
npm test                  # contract + engine tests (Node, no browser)
ENGINE_ID=real npm test   # contract tests against the real engine

# end-to-end in Chromium at iPhone size with a fake microphone singing tests/e2e/hum.wav
npm i -D playwright && npx playwright install chromium
node server.js &  npm run e2e          # SHOTS=./shots saves screenshots; ENGINE_ID=real to use the real engine
node tests/e2e/paywall.mjs             # free tier → paywall → simulated purchases, failures, restore, reinstall
node tests/e2e/account.mjs             # guest-first, Sign in with Apple (simulated), sign out, delete
```

The e2e test covers all 11 prototype requirements (record, stop, auto-stop at 20 s, playback, retry, note, generate, result, save, open, replay, reload), plus mic-denied, a too-short take, settings, calendar and delete.

## Notes

- The design source (Claude Design handoff) is in `design-reference/`. Visual values in `styles.css` are transcribed 1:1 from it.
- The watercolor images in `assets/art/` are the client-supplied style references. **Verify licensing before shipping.**
- Fonts (Cormorant Garamond, Hanken Grotesk) load from Google Fonts. Offline, the app falls back to Iowan Old Style / system fonts.
- Tested in Chromium. The wash uses SVG displacement filters and `oklch()` colours, so iOS 15.4+ is needed.

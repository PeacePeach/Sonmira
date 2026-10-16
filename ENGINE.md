# Voice-to-watercolor engine — integration notes

Two tracks meet only at `src/engine/contract.js`.

| Path | Owner |
| --- | --- |
| `src/app/`, `index.html`, `styles.css`, `server.js` | Track A (app) |
| `src/engine/contract.js`, `src/engine/engines/index.js`, `engines/mock.js`, `engines/mock-catalog.js` | Track A (shared contract + mock); changes to the contract are agreed across tracks |
| `src/engine/analysis/`, `interpret/`, `render/`, `engines/real.js` | Track B (engine) |

## Plugging in the real engine
1. Create `src/engine/engines/real.js` exporting `createRealEngine()` that returns an `Engine` (see contract).
2. The registry already maps `real` → `./real.js`. Open the app with `?engine=real` to try it; change `DEFAULT_ENGINE` in `engines/index.js` to make it the default. No UI file changes.
3. `ENGINE_ID=real npm test` runs the contract conformance tests against it.

## Rules of the contract
- `createLiveSession({sampleRate, maxSeconds}).push(Float32Array)` is called every ~100 ms with ~2048 time-domain samples (Web Audio AnalyserNode). Keep it fast (< 5 ms on a phone).
- `finish()` returns an `Analysis` that must be JSON-serialisable; the app stores it with the entry so a future engine can re-generate.
- `generate()` must always resolve with a valid `Painting`, falling back to neutral defaults when any classifier / transcription is unavailable.
- `overrides.completeness` is developer-only (`?dev` panel); never derived from user UI.
- Measurements are descriptive only. Never label them as singing accuracy, pitch accuracy or rhythm scores.

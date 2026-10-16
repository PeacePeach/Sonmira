# Voice-to-watercolor engine (Track B)

`src/engine/engines/real.js` implements the shared contract (`src/engine/contract.js`) as three independent stages. Try it in the app with `?engine=real`.

| Stage | Folder | In → out |
| --- | --- | --- |
| Analysis | `analysis/` | 2048-sample snapshots every 100 ms → `features` (signal measurements) |
| Interpretation | `interpret/` | features + note → completeness, emotion, motif, copy |
| Rendering | `render/` | interpretation → artwork from the watercolor set + tinted wash |

## Analysis: what is measured
Per frame: RMS level, and pitch via a YIN detector (80–1100 Hz). Per take:
- `level` mean / peak / p90 of sounding frames
- `activity` seconds sounding and seconds with a clear pitch
- `pauses` gaps of 300 ms or more between sounds
- `pitch` median, range and spread in semitones, and `continuity` (share of neighbouring frames whose pitch moves by at most a semitone)
- `hue` mean voice hue (low pitch → blue, high → warm, as in the design)

These describe the signal. They are not singing accuracy, rhythm or quality scores, since there is no melody or rhythm reference to compare against, and the app should not present them that way.

## Interpretation
- **Completeness**: `sustain^0.35 × continuity^0.45 × flow^0.2`, where sustain is pitched seconds (4 s or more counts as full), continuity is the pitch continuity above, and flow drops with pauses per sounding second. A score of 0.78 or more gives resolved, 0.5 or more gives gathered, and anything lower gives loose. Under 1 s of pitched sound, or a silent take, is always loose.
- **Emotion**: keywords in the note (English and Chinese, `interpret/lexicon.js`). With no matching words the voice gives a gentle guess (loud and wide → intense, high and present → bright, low and quiet → melancholic, otherwise tender). With no voice at all it falls back to tender.
- **Motif**: keywords in the note. Without them, a loose painting stays abstract and other paintings take a place from the voice register (low → water, middle → sky, high → landscape).
- `interpret()` takes an optional `transcript` alongside the note, ready for speech-to-text later.

## Rendering
`render/catalog.js` tags each of the 19 supplied paintings with tier, emotions, motifs and the voice hue it answers to. `select.js` picks within the tier by motif (+3), emotion (+2 primary, +1.4 secondary) and hue closeness (up to +1.5), with a small seeded jitter so the same take always gets the same painting. The live wash follows the design prototype and is tinted 30% toward the emotion's hue when the take finishes. Images are expected at `assets/art/<id>.png`.

A real image generator can replace `selectArtwork()` and return `{ kind: 'image', blob }`; nothing else changes.

## Tests
`node --test test/engine/*.test.mjs` uses synthetic voices (`test/engine/synth.js`): a connected phrase, a phrase broken by gaps, leaping pitch, silence and noise, at 16 and 48 kHz. `ENGINE_ID=real npm test` runs the app's contract tests against this engine.

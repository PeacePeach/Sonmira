# Voice-to-watercolor engine (Track B)

`src/engine/generate.js` is the single generation API. `src/engine/engines/real.js` wraps it in the app contract (`src/engine/contract.js`). Open the app with `?engine=real` to use it.

```
generatePainting({ audioFile?, samples?, sampleRate?, features?, noteText?,
                   vocalControlOverride?, emotionOverride?, motifOverride?,
                   seed?, width?, height? })
→ { image: {width, height, rgba}, controlScore, controlConfidence, tier,
    stylePosition, emotion, motif, seed, focus, pigments, interpretation, method }
```

| Stage | Folder | What it does |
| --- | --- | --- |
| Analysis | `analysis/` | 100 ms frames → level, pauses, YIN pitch, continuity, phrases, onsets, dynamics, clarity. Reads WAV in Node and any browser-decodable audio. |
| Interpretation | `interpret/` | control score + confidence → tier and style position; note → emotion and motif |
| Painting | `paint/` | procedural watercolour renderer: paper, transparent glazes, edges, granulation, motifs |
| Art data | `art/` | reference annotations, per-tier statistics, unified palette |
| Live wash | `render/` | the soft marks shown while recording |

## What is real and what is heuristic
- **Measured from the audio:** RMS level, pauses (≥ 300 ms of quiet), pitch per frame (YIN, 80–1100 Hz) with its clarity, pitch continuity, phrase count and length, onset count, and dynamic range.
- **Robust to expressive singing:** vibrato (a step reversed on the next frame) and slides (steps continuing the same way) count as connected. Leaps between held notes are fine, because continuity looks at frame-to-frame motion, not at the size of intervals.
- **Proxies only:** `onsets.regularityProxy` says how even the onsets are. Without a beat reference it cannot say whether the rhythm is right. Nothing measures pitch accuracy, because there is no reference melody.
- **Heuristic (calibration in `interpret/completeness.js`):** control = sustain^0.35 × continuity^0.6 × flow^0.2. Thresholds are 0.5 for gathered and 0.78 for resolved. Low confidence (little pitched sound, unclear pitch, a lot of noise) pulls the score toward a neutral prior, and there is no score at all without audio. These are artistic choices, not validated against listeners.
- **Emotion** comes only from the words in the note (or a transcript later). With no words the default is neutral. The voice is never used to guess feelings.
- **Motif** comes from note keywords (water, sky, garden, landscape, interior, abstract). With no words it is abstract. When several motifs tie, the first one mentioned leads.

## Painting
- **Style:** `paint/style.js` maps a style position (0 loose, 0.5 gathered, 1 resolved) to continuous parameters. The anchors are the per-tier means measured from the user's 22 labelled references (`art/style_clusters.json`). As control rises, legibility, value contrast and structure increase, and bleed, edge wander, drift, fragmentation, free washes, scribbles and drips decrease.
- **Motifs:** `paint/motifs.js` builds an original composition per motif from simple geometry and the seed. Its elements have roles (ground, structure, focal, detail, accent), and the style decides how each role appears, so the same composition dissolves or resolves.
- **Colour:** the unified muted collection in `art/palettes.js`, with 2–4 pigments per painting. Darks are the same pigments glazed more densely.
- **No reference pixels:** the renderer reads no image files, and a test enforces this.

## Tests and QA
- `npm test` runs the contract tests and the engine tests (synthetic voices plus `tests/e2e/hum.wav`).
- `node tools/qa-grid.mjs` writes the comparison grids. Review criteria are in `qa/CRITERIA.md`.

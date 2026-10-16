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

## Reference library (image-model generation)
Sound → interpretation → visual family → **one primary reference** → its palette and art direction → OpenAI image edits → artwork.
- **Registry:** `src/engine/direct/references.js` is the single source of truth: each reference has an `id`, `family`, `path` (relative to the reference root, `$SONMIRA_REFS_DIR`), `active` flag, a measured `palette`, and optional `light`/`motif` hints. Generation code never lists references.
- **Adding references:** put the image under the reference root in a folder named after its family (`resolved/R4/new.jpg` or `.../R4-lyrical-everyday/new.jpg`), or pass `--assign <path>=<FAMILY>`, then run `python3 tools/index_references.py <root>`. It discovers new files, keeps existing assignments, marks missing files inactive and measures every palette from the pixels (colour hierarchy with shares, accent, paper and dark shares, lightness, saturation, temperature). No colour text is written by hand.
- **Selection:** `src/engine/direct/library.js` draws one active reference per generation from the family's pool with the seed (equal odds). The same seed and library `version` always give the same reference; both are in the metadata.
- **Responsibilities:** the reference sets palette and colour hierarchy, composition, negative space, detail distribution and watercolour handling; sound sets the family, level, mood and marks within that language.
- **Calling the model:** `generateFromDirection()` sends only the selected reference to the edits endpoint (streamed), or falls back to text-only generation with the reference's measured palette when no reference files are available.
- **Production storage (private Vercel Blob):** images at `references/<path>` and the registry at `references/registry.json`, both `access: 'private'`. `src/engine/providers/reference-store.js` gives Blob and the local folder one interface; `/api/generate` reads the registry (cached `REGISTRY_TTL_MS`, 30 s), selects by seed, reads the selected image's bytes and sends only that image to OpenAI. Clients get the reference id only, never a Blob URL or token.
- **Importing to production:** `node tools/references.mjs add <image> R4` uploads privately, measures the palette (same code as the indexer) and adds the entry; it is selectable within 30 s, with no redeploy. `disable`, `enable`, `remove`, `list`; `sync <refs_root>` uploads the bundled registry's images once. Needs `BLOB_READ_WRITE_TOKEN` in the shell and python3 with Pillow.
- **Store selection:** Blob when `BLOB_READ_WRITE_TOKEN` is set (or `SONMIRA_REFS_STORE=blob`), else `SONMIRA_REFS_DIR`, else text-only with the bundled registry's palettes.


## Sound-to-Art Intelligence V2 (ai engine)

Three separate responsibilities: the **words** decide what the painting
expresses, the **singing** decides how abstract it is, the **reference**
decides how it looks. Loose, Gathered and Resolved are modes, not grades.

```
recording ─┬─ pitch track (10 ms YIN) → singing analysis        browser
           └─ /api/understand: gpt-4o-transcribe (+logprobs)     server
                               → gpt-4.1-mini reading (strict JSON schema)
→ stage 1  lyrical-completion gate      src/engine/interpret/lyrics.js
→ stage 2  singing quality → tier       (only after the gate passes)
→ semantics for the tier + gesture      src/engine/understand.js
→ family → seeded reference → prompt    src/engine/direct/index.js
→ /api/generate (OpenAI image edits)    rejects a family of another tier
```

**Stage 1 (strict).** All must hold, else Loose: a transcript that is not a
known ASR hallucination; ≥ 3 real words (≥ 2 distinct) and ≥ 60 % of words not
vocables (la, ooh, mm, 啦, 嗯…); ASR confidence ≥ 0.6 (mean token probability);
the voice is sung (sustained pitched notes, so speech fails); a plausible word
rate (rules out background speech and lone fragments); the language model
reads the words as lexical, coherent and a complete phrase with confidence
≥ 0.7 (≥ 0.85 if the transcriber gave no confidence); and the voice ends
rather than being cut off. Singing quality is never consulted here, so a
perfect hum cannot pass. "Complete" means a finished lyrical phrase, never a
claim that a known song was sung.

**Stage 2.** Resolved only when the singing is confidently strong; otherwise
Gathered. Measured without a target melody: pitch stability inside notes
(drift, slow wandering, jitter; regular 4–9 Hz vibrato recognised and not
penalised), relative intonation (note centres on one semitone grid at the
singer's own tuning), clean arrival on notes (slides are fine, hunting is
not), steadiness, onset regularity and continuity (proxies only), and interval
coherence. Note or rhythm *accuracy* is not measurable and is not claimed.
Every threshold is in `SINGING_CALIBRATION` / `GATE_CALIBRATION` and is
provisional: set on synthetic voices, to be calibrated on real recordings.

Those components only see notes that settled, so Strong also needs control
across the **whole performance** (`analysis/performance.js`): every voiced
frame is a settled note, an expressive bend between notes, a phrase onset or
release, or unstable (pauses and breaths are not counted). Strong needs
enough controlled voiced time, controlled weaker 2-second windows (p25), few
weak windows, no sliding key (a constant transposition is free), and rhythm
and coherence above an extreme-case floor. Confidence is evidence (how much
clean material) × consistency (the weaker windows). These only decide
Resolved vs Gathered; a complete phrase is never sent to Loose for how it was
sung. Every condition is listed ✓/✗ in the `?dev` panel.

**Semantics.** The reading gives theme, imagery, figurative meanings
("drowning in memories" → overwhelmed by the past), mood, motif and one
concept per tier (Loose: no objects, only movement and weight; Gathered:
suggested; Resolved: one recognisable subject). Words carry meaning only when
the transcript is reliable; a Loose take without them expresses the sound
itself. The reference keeps palette, light and technique; its own subjects
never enter the painting (`REFERENCE_AUTHORITY`).

**Style prompt with a reference.** The attached reference decides medium,
technique, texture, colour treatment, composition language and degree of
stylisation. The written prompt adds only the subject (lyrics), how
recognisable it is (tier), the family's own observed rules, the reference's
measured palette, and mood and gesture phrased as a lean *within* the
reference. The universal watercolor technique and long avoid list
(`GLOBAL_STYLE`, `AVOID`) are used only for text-only generation;
`tools/prompt-audit.mjs` builds the exact request without sending it and
flags any shared prescription that would compete with the reference.

**How it is composed.** Each Gathered and Resolved family carries its
references' composition language (`src/engine/direct/composition.js`):
structural principles such as R1's directional diagonals, R2's aerial,
asymmetric field and R4's atmospheric depth and negative space, plus
viewpoints, off-centre placements and scales, one of each drawn per seed.
The focus is never centred; Resolved adds a bar for spatial hierarchy,
directional movement and purposeful staging. The words still decide the
subject; the plan is in the dev panel and the Playground comparison.

**What is depicted.** References decide how a painting is made, never what
it shows. Family labels and rules name no objects, figures or scenery; the
reference's light note keeps only its quality. The subject comes from
reliable lyrics, else the person's note, else (Gathered and Resolved) an
atmosphere of the motif with nothing placed in it (`ATMOSPHERES`). No tier
paints people: words about people are carried by place, light and traces.
`src/engine/direct/leakage.js` checks for leakage against each reference's
curated `content` (references.js): on every prompt in the tests, and on a
reviewer's description of a generated image in the Playground comparison.

**Validate on real voices (no image made):**
`node --env-file=.env.local tools/understand.mjs take.m4a` prints the tier,
reasons, transcript, singing measures and concept (`VERBOSE=1` for all). On
the Preview, `?dev` → "analyze only" runs the whole decision on a real take
and shows it in the dev panel without calling the image model.

**Added cost and latency (estimates, list prices):** transcription
$0.006/min (≈ $0.0015 for 15 s) plus one short text call (≈ $0.001), about
$0.003 per painting; roughly 2–5 s before the image request starts. A wordless
take skips the text call. Models: `OPENAI_TRANSCRIBE_MODEL`
(`gpt-4o-mini-transcribe` halves the transcription cost, likely less robust on
singing) and `OPENAI_TEXT_MODEL`.

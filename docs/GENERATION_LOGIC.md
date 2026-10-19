# Generation logic: the source of truth

This is how the **AI engine** (`ai-openai-v2`, the app's default, `src/engine/engines/index.js`) turns a recording into an artwork, as of `main` at `886ba38` (18 Oct 2026). It describes what the code does, not what it was meant to do; where the two differ, it says so under **Gaps**.

Related docs, not repeated here:
- [`engine-v1.md`](engine-v1.md): where each step runs, how changes ship, known classification limits.
- [`engine-pipeline.md`](engine-pipeline.md): the stage-1 and stage-2 rules in prose, the reference library, and the procedural `real` engine. Its "Heuristic control score" (`interpret/completeness.js`, 0.5 / 0.78) belongs to the procedural engine; the AI engine overrides it with the tier (see stage 4).
- [`GENERATION_TEST_MATRIX.md`](GENERATION_TEST_MATRIX.md): what to test, and how.

**Production versus proposed.** Stages 1–11 below describe **Production logic** (`main`). Two changes are on draft branches and are not deployed:
- **PR #14** changes stages 6 and 7 only. Each change is marked **PR #14**.
- **Phase 2** (draft PR #15, which includes PR #14) changes how Loose is prompted, and how references without a family are described. Han approved its visual direction on 18 Oct 2026, but it is not deployed. It is summarised at the end, under **Phase 2**, with the stages it touches.

## The pipeline at a glance

| # | Stage | Runs on | Code | Random? |
|---|---|---|---|---|
| 1 | Recording (max 20 s) | client | `src/app/screens/sing.js`, `src/app/settings.js` (`MAX_SECONDS`) | — |
| 2 | Audio analysis | client | `analysis/features.js`, `analysis/pitchtrack.js` | deterministic |
| 3 | Performance assessment | client | `analysis/singing.js`, `analysis/performance.js` | deterministic |
| 3b | Words: transcription and reading | server | `api/understand.js`, `providers/openai-understand.js` | model output (text model at temperature 0) |
| 4 | Tier classification | client | `interpret/lyrics.js` (`completionGate`, `decideTier`), `understand.js` | deterministic given 3 and 3b |
| 5 | Semantics, mood, motif, energy, gesture | client | `understand.js` (`semanticsFor`, `expressionFor`), `interpret/spec.js` (`energyFor`), `interpret/emotion.js`, `interpret/motif.js` | deterministic |
| — | Seed | client | `engines/ai.js` (`randomSeed`) | **random**, `crypto.getRandomValues`, new for every generation |
| 6 | Family selection | server | `direct/index.js` (`familiesFor`, `direct`) | seeded |
| 7 | Reference selection | server | `direct/library.js` (`select`), `providers/reference-store.js` (`libraryFor`) | seeded |
| 8 | Visual interpretation (subject, form, composition) | server | `direct/index.js`, `direct/composition.js` | seeded (composition only) |
| 9 | Palette | server | `direct/library.js` (`referencePalette`) | deterministic per reference |
| 10 | Final prompt | server | `direct/index.js` (`direct().prompt`), `library.js` (`REFERENCE_AUTHORITY`) | — |
| 11 | Image generation | server | `providers/openai.js` (`generateFromDirection`, `editOpenAI`) | model sampling |

All randomness that Sonmira controls comes from **one 32-bit seed per generation**. The client draws it (`ai.js` `randomSeed`), sends it in the spec, and the server derives every choice from it with salted hashes: family `hashSeed(seed,'direct')`, reference `hashSeed(seed,'primary-ref')`, composition `hashSeed(seed,'compose')`. The same seed and library version always give the same family, reference and composition. A generation is replayed, not redrawn, when the same take is retried within 24 h, because the guard returns the stored response for the same idempotency key (`server/protect/index.js`, `resultTtlSec`). That is intended: a retry is not a new painting.

## 1–2. Audio analysis

**Input:** the decoded recording, mono (`ai.js` `decodeAudioBlob`). **Output:** frame features (100 ms hop) and a fine pitch track (10 ms YIN).

`analyzeSamples` (`analysis/features.js`) measures level, activity (sounding and voiced seconds), pauses (≥ 300 ms quiet), pitch (median Hz, range and spread in semitones, continuity), phrases (count, mean length), onsets (count, `regularityProxy`), dynamic range in dB, and pitch clarity. These are descriptive only; nothing knows the melody or the beat.

## 3. Performance assessment

`singingAnalysis(pitchTrack(...), features)` (`analysis/singing.js`) finds settled notes on a vibrato-smoothed line and scores six components with weights `stability 0.3, intonation 0.25, transitions 0.15, control 0.15, rhythm 0.1, coherence 0.05`. `performanceProfile` (`analysis/performance.js`) labels every voiced frame as note, bend, edge or unstable, and measures 2 s windows of voiced time.

`quality.strong` needs **all 11** of these checks (`SINGING_CALIBRATION.strong` and `.strongPerformance`):

| Check | Threshold |
|---|---|
| weighted score | ≥ 0.8 |
| confidence = evidence × consistency | ≥ 0.6 |
| stability | ≥ 0.7 |
| intonation (relative tuning consistency) | ≥ 0.8 |
| transitions (when measured) | ≥ 0.6 |
| controlled share of voiced time | ≥ 0.6 |
| 25th percentile of 2 s windows | ≥ 0.6 |
| weak windows (< 0.5) | ≤ 15 %, at least 1 allowed |
| key drift | ≤ 50 cents |
| rhythm (when measured) | ≥ 0.25 |
| coherence (when measured) | ≥ 0.25 |

Evidence is `min(1, noteSec/4) × min(1, notes/6) × clarity term × (0.6 without intonation)`, so takes with less than about 4 s of settled notes or fewer than 6 notes lose confidence (`singing.js:307`). Duration therefore matters, and short takes cannot be Strong.

It is also "sung" (`vocal.sung`) when there are ≥ 1.5 s of pitched voice with ≥ 30 % of it on held notes. Speech fails this.

Every threshold is provisional: synthetic voices plus 9 real takes from one singer (`engine-v1.md`).

## 3b. Words

When there is ≥ 1 s of sound (`understand.js` `MIN_SOUND_FOR_WORDS_SEC`), the first 60 s, as 16 kHz WAV, go to `/api/understand`:
1. `gpt-4o-transcribe` with logprobs and a neutral prompt ("possibly only humming").
2. `analyzeTranscript` counts lexical words and vocables (`la, ooh, mm, 啦, 嗯…`), flags known ASR hallucinations, and computes ASR confidence (mean token probability).
3. Only if there is at least one lexical word: `gpt-4.1-mini` at temperature 0 with a strict schema returns lexical, coherent, structure, unfinished, linked, phraseComplete, completionConfidence, theme, imagery, figurative, **mood** (one of 4), **motif** (one of 6), and one **concept per tier**.

The text model sees only the transcript. It does not know how long the words lasted, or what share of the take they cover.

## 4. Tier classification

**Stage 1, the words gate** (`completionGate`, `interpret/lyrics.js:102`). All checks must pass, else **Loose**:

| Check | Threshold (`GATE_CALIBRATION`) |
|---|---|
| transcribed | non-empty, not a known hallucination |
| lexical_words | ≥ 3 words, ≥ 2 distinct |
| mostly_words | ≥ 60 % of words are not vocables |
| asr_confident | mean token probability ≥ 0.6 (when available) |
| sung | `vocal.sung` from stage 3 |
| word_rate | 0.15–4.5 lexical words per sounding second |
| language_model | a reading came back |
| lexical_meaning | lexical and coherent |
| phrase_complete | structure is `clause` or `image_phrase`, not unfinished, linked, confidence ≥ 0.7 (≥ 0.85 without ASR confidence) |

**Stage 2** (`decideTier`, `lyrics.js:146`): gate passed and `quality.strong` gives **Resolved**; gate passed otherwise gives **Gathered**.

**Sustained lyrical singing floor** (`lyricalFloor`, Han, 19 Oct): when the gate fails **only** on `phrase_complete`, a take that is sung throughout with recognisable words is lifted to **Gathered** (never Resolved). A song excerpt is often cut mid-line or holds several lines, so the text model calls it unfinished; before this rule such a 19 s sung take ("你能体谅我的雨天吗…") was Loose. All of these must hold, from measurements already taken; if any input is missing the old decision stands:

| Check | Needs (provisional) |
|---|---|
| only_phrase_complete_failed | every other gate check passed (transcribed, real words, ASR confidence, sung, word rate, coherent reading) |
| sounding_sec | ≥ 8 s of sound |
| sung_throughout | sung, and pitched voice (YIN) ≥ 0.6 of the sounding time |
| lyric_words | lexical reading, ≥ 8 real words and ≥ 0.8 words per sounding second |

The result is `understanding.lyricalFloor` (`applied`, `reason`, `evidence.checks`), also on `decision.lyricalFloor`; the decision stage reads `lyrical_floor` when it applied. The dev panel shows it under the decision. No singing score or threshold changed.

Consequences that follow directly from the code:
- **A take without words is always Loose**, however well it is sung. `engine-v1.md` already lists this as a product decision.
- **Words decide the floor; singing decides only Gathered versus Resolved.** A complete phrase sung badly is Gathered, never Loose.
- **The words need not cover the take.** Three words in a 20 s take give 0.15 words/s, which passes `word_rate`. The text model judges the words alone. Stage 2 then scores the whole take, hum included. So "short lyric + strong hum" can be Resolved.
- Stage 2 does evaluate the whole performance (all voiced frames, windows, key drift). Stage 1 does not: any 3 coherent words anywhere in the first 60 s count.

In the AI engine the tier is then forced into the plan (`ai.js`: `vocalControlOverride: u.tier`), so `interpret/completeness.js` (control score, 0.5 / 0.78) does not decide anything there.

## 5. Semantics, mood, motif, energy, gesture

| Output | Source | Values | Without words |
|---|---|---|---|
| concept (subject) | `semanticsFor`: the text model's concept for the tier, only when the words are reliable (ASR ≥ 0.6, lexical, coherent). Else the user's typed note. | free text | none. Loose gets `soundOnly`. |
| **mood (emotion)** | text model `mood`; else keywords in the note (`interpretEmotion`) | tender, bright, melancholic, intense | **always `tender`** (`DEFAULT_EMOTION`). The voice is never used. |
| motif | text model `motif`; else note keywords | water, sky, garden, landscape, interior, abstract | `abstract` |
| energy | `energyFor` (`interpret/spec.js:16`): 0.55 × onset rate + 0.45 × dynamic range | calm, moderate, lively | from the voice |
| gesture | `expressionFor` (`understand.js:24`) | range narrow/moderate/wide (pitch range < 300 / < 900 cents); flow connected/broken (pauses per sounding second > 0.25); dynamics even/swelling (> 12 dB); vibrato (≥ 30 % of notes) | from the voice |

That makes 4 audio variables with 3 × 3 × 2 × 2 × 2 = 72 combinations. Register, melodic contour (rising, falling, arching), phrase length and count, tempo, regularity, duration and clarity are measured but never reach the image.

## 6. Family selection

`familiesFor` returns every family of the tier that has at least one active reference, **each with equal weight** (`direct/index.js:205`); motif and words no longer change it (since `8a05e88`, 16 Oct). `direct()` draws one by seed.

| Tier | Families (bundled references) |
|---|---|
| Loose | L1 line over wash (1), L2 bloom field (1), L3 drip curtain (1) |
| Gathered | G1 atmospheric study (2), G2 splash and blot (1), G3 luminous contrast (2) |
| Resolved | R1 (2), R2 (2), R3 (2), R4 (4), R5 (3), R6 (1) |

**PR #14:** the family is no longer drawn first in effect: the reference is drawn from the whole tier, and the family becomes the reference's family. The drawn family is used only for a reference with no family (a tier-folder upload).

## 7. Reference selection

The library is the bundled registry (`direct/references.js`, 22 active references, each with a measured palette) plus Blob images discovered by `libraryFor` / `discoverReferences` (`providers/reference-store.js`), relisted at most every 30 s.

- **main:** a reference is drawn uniformly from the family's pool (`library.select`). Per-reference probability = 1 / (families in tier) / (refs in family). Gathered `gathered_02` gets 33 %, the other four 17 % each. Resolved R6's single reference gets 17 % and each R4 reference 4 %. A Blob upload joins a pool only if its path names a family (`R4-…` or a `R4/` folder); others are ignored.
- **PR #14:** `library.selectInTier` draws uniformly from all active references of the tier (1 / N). Images directly under `references/<tier>/` with any name join that tier with no family.

Measured on the bundled library (60 000 seeds), the chance that **two independent generations in the same tier get the same reference**:

| Tier | main | PR #14 |
|---|---|---|
| Loose (3 refs) | 33 % | 33 % |
| Gathered (5) | 22 % | 20 % |
| Resolved (14) | 8.6 % | 7.1 % |

The Blob store is private and was not reachable for this audit, so these numbers do not include uploaded images.

## 8. Visual interpretation

The subject line (`direct/index.js:246`):
- concept present: Loose "depicts nothing; its marks carry the feeling of the sung words: …"; Gathered "only suggesting…"; Resolved "of: …";
- Loose without words: **always the same sentence**: "An abstract painting that expresses the sound of the voice itself, not any subject or story.";
- Gathered or Resolved without words: an atmosphere of the motif (`ATMOSPHERES`).

Form comes from `LEVELS[tier].refForm`. Loose's form says "the reference's own marks, colour and texture are the painting."

Composition (`direct/composition.js`): Gathered and Resolved get the family's principles plus a seeded viewpoint, placement, scale and staging. **Loose gets no composition plan** (`direct/index.js:250`), so its arrangement is left to the model and the reference.

People are excluded at every tier, and reference content is checked for leakage (`direct/leakage.js`).

## 9. Palette

A reference with a measured palette (all 22 bundled ones) puts its colour hierarchy into the prompt (`referencePalette`, `library.js:64`): up to 3 colours with **hex values and picture shares**, lightness, saturation, temperature, paper and dark shares, and then: *"Keep these proportions: vary the colour only within this hierarchy, never introduce an unrelated palette."*

A reference without a palette (any Blob upload) gets one of its family's observed schemes from `families.js` instead, phrased more loosely ("Colour: …, with … as the only accent").

What the song can change: only the mood line, a lean "toward the softer / warmer / cooler / deeper end of the reference's own colour and value range" (`EMOTION_REF`). Without words, mood is always tender. The mood-to-pigment table in `art/palettes.js` (`MOODS`) is used only by the procedural engine.

## 10. Final prompt

`[REFERENCE_AUTHORITY] + subject, meaning, family style, content rule, form, composition, "Vertical 4:5 format.", palette, mood, pace, gesture, REFERENCE_STYLE, avoid`, joined by newlines (`direct/index.js:269`).

`REFERENCE_AUTHORITY` (`library.js:84`) opens the prompt and states that the attached image "overrides every written description below, including colour, light and composition notes", controls medium, palette, colour distribution, composition language, negative space and detail distribution, and leaves "free" only the subject and exact arrangement.

**Resolved finish inheritance** (Han, 19 Oct; performance-led prompts, i.e. every measured take): a Resolved painting must reach the selected reference's level of artistic finish. The reference decides how finished and how it is painted, the words what is painted, the performance how the composition and gestures unfold. Two additions, Resolved only:
- `REFERENCE_AUTHORITY_PERFORMANCE_RESOLVED` (`library.js`): the performance authority plus one sentence saying the reference also sets the level of finish, while the subject comes only from the text.
- `RESOLVED_FINISH` (`direct/index.js`), placed right after the form line: a finished work by an accomplished watercolour artist, not a beautiful sketch; match the reference's finish through deliberate focal detail, sophisticated brushwork, layered pigment, controlled edges and visual hierarchy; not photorealism, excessive detail or a filled sheet; never its content or composition.

Before this, the performance-led authority limited the reference to "the artistic language only" and the Resolved form line said nothing about finish, so the reference's level of finish (item 7 of the older `REFERENCE_AUTHORITY`) no longer reached Resolved prompts. The direction records `resolvedFinish` (`applied`, `reference`, `reason`), returned by `/api/generate` and shown in the dev panel. Loose and Gathered prompts are byte-identical to before; the non-performance path (unmeasured takes, the frozen V1 prompts) is unchanged and already carries the reference's level of finish. Not yet checked with a real image.

`tools/prompt-audit.mjs` builds the exact request without sending it.

## 11. Image generation

`generateFromDirection` (`providers/openai.js:97`) sends the one selected reference image and the prompt to `/v1/images/edits` (`gpt-image-2`, `medium`, `1024x1536` by default; `OPENAI_IMAGE_INPUT_FIDELITY` is sent only if set). If the store or the reference is missing, it returns a 503 `no_reference`, with no text-only fallback in production. The server refuses a family from another tier (`api/generate.js:86`).

## What reaches the image, in practice: a wordless Loose take

Measured with `direct()` on the bundled library:
- The request is about **606 words**. Between the most different possible performances (calm, narrow, connected, even versus lively, wide, broken, swelling, vibrato), **about 15 words change**: the pace and gesture lines. Everything else is identical for every wordless take with the same reference.
- Across every audio variable (including unmeasured values) and seed there are **648 distinct requests**, but only 3 reference images, and the prompt tells the model that the image overrides the text.
- Two of the three Loose references are blue: `loose_01` (light blue, blue, light teal) and `loose_02` (teal 59 %, light teal 37 %). So **2 in 3 wordless takes get a blue reference with an instruction to keep its exact colour proportions**, and 1 in 3 pairs of takes get the very same image.
- 14 synthetic voices of very different kinds (strong, weak, hum, speech-like, improvised, broken, leaping) produced only 7 distinct gesture combinations, and 7 of the 14 had the same one (moderate range, connected, even, vibrato). Synthetic dynamics are flat, so real voices may spread more on the `dynamics` axis. That needs real takes to confirm.

## Gaps between intent and implementation

1. **Performance barely conditions Loose** (addressed by Phase 2). The intent is "the singing decides how abstract, the sound itself is expressed". In practice, about 2.5 % of the prompt carries the voice, against an image that is declared authoritative over colour and composition, and a Loose form line that says the reference's marks are the painting.
2. **Mood is constant without words** (Phase 2 drops it for Loose). `tender` for every wordless take. The voice never sets mood, by design (`engine-pipeline.md`), and nothing replaces it.
3. **The palette is locked to the reference** (Phase 2 loosens it for Loose only) by hex values, shares and "never introduce an unrelated palette". This contradicts the intent that the song meaningfully influences colour. It is already recorded as a limitation for intense emotion (`engine-pipeline.md`, Validation 4).
4. **Loose has the smallest pool** (3) and the most skewed colour (2 blue). PR #14 does not change Loose, because each Loose family has one reference.
5. **Stage 1 does not weigh how much of the take is words.** A short phrase plus a long hum passes `word_rate` (≥ 0.15/s). Stage 2 then scores the hum.
6. **Strong humming cannot leave Loose.** This is a documented product decision, but it conflicts with "strong humming should not be inherently penalised".
7. **The client's planned family** (`understanding.plannedFamily`, `ai.js`) is computed against the bundled library and can differ from the server's family once Blob uploads exist. It is diagnostics only, and becomes more likely to differ under PR #14.
8. **PR #14, references without a family** (fixed by Phase 2) get the drawn family's rules and fallback palette, chosen independently of the image. For example, a new image can be described as "Drip curtain… yellow-green, olive, lavender" whatever it shows (checked with `discoverReferences` + `direct()` on the PR branch).

## Phase 2 (draft PR #15: approved 18 Oct, not in Production)

These are the changes from Production, by stage. Audio analysis, the words gate, stage-2 scoring, every threshold, and the Gathered and Resolved prompts are unchanged.

**Stage 5, gesture** (`understand.js` `expressionFor`): five more descriptive fields, all from measurements that already existed:

| Field | From | Values |
|---|---|---|
| `contour` | `analysis/singing.js` `melodicContour`: duration-weighted pitch of the first, middle and last third of the settled notes, 150-cent margin | rising, falling, arching, dipping, level (null under 3 notes) |
| `register` | `pitch.medianHz` | low (< 165 Hz), mid (< 300 Hz), high |
| `phrasing` | `phrases.count` | single (≤ 1), few (≤ 3), many |
| `rhythm` | `onsets.regularityProxy` | regular (≥ 0.6), irregular |
| `line` | `pitch.continuity` | smooth (≥ 0.8), stepped |

None of them is scored. `quality`, the gate and the tier never read them. `api/generate.js` `cleanSpec` accepts only these values.

**Stages 6–7, a reference without a family** (an upload straight into `references/<tier>/`, with PR #14): the drawn family still fixes the tier, but none of its rules, palettes or composition language is sent. `direct()` returns `family: null`. The style line becomes `REFERENCE_ONLY_STYLE`, colour becomes "the attached reference's own colour language, read from the image", and Gathered and Resolved get `NEUTRAL_COMPOSITION` (`direct/composition.js`). `api/generate.js` checks the tier with `direction.level`.

**Stages 8–10, Loose with a reference** (`direct/index.js`, `direct/sound.js`, `direct/library.js`): the reference gives the language; the performance gives the picture.

| Prompt part | Production | Phase 2 |
|---|---|---|
| Opening authority | `REFERENCE_AUTHORITY`: the image "overrides every written description… including colour, light and composition" | `REFERENCE_AUTHORITY_LOOSE`: the image defines medium, technique, marks, texture, edges and degree of abstraction; it "does not dictate the composition or the exact colours" |
| Form | "the reference's own marks, colour and texture are the painting" | the reference's kind of marks and texture, "arranged and coloured as the performance plan below describes" |
| Family style | the family's rules | the same rules, plus "where it describes a layout or a direction, the performance plan below decides instead" |
| Composition | none | **from the voice**: movement (contour), where the weight sits (register), extent (range), one body or separate clusters (flow and phrasing), spacing (rhythm) |
| Marks | pace (energy) and gesture lines, ~15 words | **from the voice**: stroke (line), density and speed (energy), pigment load (dynamics), edges (vibrato) |
| Colour | measured hex values and shares, "keep these proportions… never introduce an unrelated palette" | the reference's colour language by name as a starting point, then **from the voice**: strength (energy), value key (register), temperature (contour), climax (dynamics), and a bounded hue freedom (`HUE_FREEDOM`) |
| Mood | always "tender" without words | none without words. With words, the words' mood, no longer confined to the reference's range |
| Avoid | `REFERENCE_AVOID` | the same, plus "the reference's own layout or placement of colour" |

The mapping is deterministic: the same measurements always give the same lines, and the seed still only picks the reference. It is an artistic choice, documented in the head of `direct/sound.js`.

Measured on the same reference (`loose_02`) and seed with 7 lyric-free synthetic performances, the share of the request that differs between two performances goes from 0–9 % (mean 6 %) to 26–35 % (mean 31 %). In Production a rising and a falling melody produce the identical request. Text-only Loose (no reference attached, never used in Production) is unchanged.

Real images (18 Oct, 16 images, one per cell, same seed, reference and performance in each pair; scored by eye): the 6 Production images on `loose_02` are near-copies of the reference's layout. In Phase 2, extent, clustering, density and open paper visibly follow the performance. Direction (rising vs falling) reads mostly through colour. Style fidelity drops slightly, because Phase 2 uses more open paper and adds new hues. The grids and scores are kept outside the repository, in the project's `generation-audit/phase2/ab-results.md`. Han approved the direction on 18 Oct, including the palette flexibility: yellow and purple accents on a blue reference are acceptable.

**Snapshots** (`tests/visual-freeze.test.mjs`): the 3 Loose Validation 4 runs (S1, S3, S6) and the 3 Loose per-reference snapshots changed. Han approved them as the new Loose baseline on 18 Oct, and they are checked against `looseApproved` in the fixture. The 7 Gathered and Resolved approved runs and the 19 Gathered and Resolved snapshots are byte-identical to `main`. The Gathered and Resolved prompts were also compared to `main` across 2,052 combinations (every reference, 3 moods, 3 energies, 3 gestures including the new fields, 2 seeds, with and without words); all are identical.

### Open issues (for future investigation)

1. **Rising and falling are not directional enough.** On a full-bleed reference (`loose_02`), the rising and falling takes differ mainly in colour: one warms at the top and the other is cooler and heavier at the bottom. Both keep a similar diagonal, all-over layout. On `loose_03`, rising turned the drips upward, but the warm colour landed at the bottom. Two levers to look at:
   - Give `MOVEMENT` a stronger, mutually exclusive layout, such as the empty part of the sheet: top for falling, bottom for rising.
   - Check whether the family's own direction rules (bloom field's darkened edges, drip curtain's downward drips) still pull against the plan.
2. **Staccato reads like a smooth, rising take, which points at analysis.** The "energetic staccato, wide leaps" test take was measured as connected flow, smooth line (`pitch.continuity ≥ 0.8`), no rhythm, moderate energy and rising contour. The plan followed those measurements, so the image looks like the rising one. Energy never reached "lively", and line was "smooth" on every synthetic take. Two things to investigate:
   - Whether `pitch.continuity`, the onset measures and `energyFor` separate detached notes from legato on real phone recordings.
   - Whether `expressionFor` needs a detached or staccato signal, for example from short notes with gaps. Any change here is analysis, not thresholds for the tier.

## Phase 3: performance-led direction for every tier (draft PR, approved by Han 18 Oct, not in Production)

Han approved two changes on 18 Oct: Gathered and Resolved stop taking composition from the reference, and every reference family gets a technique-only description. Lyrics decide what is painted, the singing decides how, and the reference gives only technique and palette family. This now applies in all three tiers.

**Measurement** (`analysis/performance-measure.js`, in the browser, inside `understandTake`):
- It sends a numbers-only summary, `performance`, along with the spec. The summary holds passages (phrases split where the pitch did not settle or the voice leapt), unstable episodes and whole-take measures.
- It never touches the tier decision.
- **Level.** Each take is scaled to a common loud level before tracking, and any frame more than 24 dB below that level counts as silence. As a result, gain changes from −12 to +6 dB give identical directions.
- **Grid alignment.** The analysis grid is anchored 0.2 s before the first loud sound, so leading silence doesn't change any decision.
- **Voice drops.** A quiet note far below both of its neighbours is a voice drop: a creak or fry as the voice gives way. It is counted as a voice break, not as a melodic leap.
- **Strays.** A short burst an octave or more away from the sound around it is ignored. An example is a start beep that the tracker reads as a high note.
- **Arrival overshoot** (shared with the transitions score, `singing.js` `arrivalOvershoot`, 19 Oct). It counts only the voice's own path from the previous note's end to 80 ms into the note, after it crosses the note's pitch from the previous note's side, and stops at an octave-size jump between frames (a voice break). The old fixed 0.25 s window reached back into a neighbouring low note and read it as an overshoot: on the casual take a 461 c "missed landing" that was really 60 c, and 154 c on the chaotic take's first passage that was really 0. Real overshoots of 40–100 c still count.
- **What an unstable stretch did** (19 Oct). Each unstable stretch (≥ 150 ms where the pitch does not settle on a note) is described by what the pitch line measurably did there: a **run** stops on at least 3 pitches (each ≥ 60 ms within 30 c) and passes straight through at least 2 of them; a **moving** stretch stops on at least 2 pitches otherwise; a **slide** holds no pitch but travels one way by the singing analysis's own bend test (net movement ≥ 0.7 of the path on the smoothed line, never more than 100 c past its ends or back against its direction), as a slide longer than the 0.6 s bend limit does; an **unsteady** one holds no pitch, or only one, and swings back on itself or dips past where it ends. The pitch line alone cannot tell a fast legato figure from a voice searching in steps (benchmark: 11 of 24 fast legato figures read as runs, and so did 8 of 26 stretches that hunt in steps), so this reading only chooses words. Every stretch cuts passages, counts toward the unstable share and the indices, and is drawn at its time position the same way whatever its kind. A run, a moving stretch or a slide is painted as one continuous gesture that changes height without settling: never torn, never described as controlled (the pitch line cannot tell a deliberate slide from drifting either). Only where the voice held no pitch and swung back is the paint torn, with hard edges and backruns. The singing analysis, controlled share and tier are unchanged.
- **Overshoot wording** (19 Oct). An overshoot is described as pitch movement past the note before the voice settles on it ("runs slightly past its mark" over 50 c, "carries well past its mark" over 150 c), never as a missed landing: the measure shows the movement, not whether it was a mistake. A voice drop is likewise described as sound ("the sound falls far below the melody and turns quiet"), not as the voice giving way.

**Direction** (`direct/performance.js`):
- Each decision carries its measurements and the anchor it was scaled against. Anchors come from `SINGING_CALIBRATION` where one exists.
- The prompt receives only the visual wording, with the numbers stripped out. The full trace is returned as `performanceTrace`.
- Time runs left to right and pitch sets height. Everything else is decided per passage or for the whole take: strokes, pigment load, joins (soft turn, torn collision or jolt), rhythm, edges, contrast, colour relations, temperature, fragmentation, tension and water.

**Prompt** (`direct/index.js` `directFromPerformance`):
- **Opening authority:** `REFERENCE_AUTHORITY_PERFORMANCE`. The image defines medium, marks, texture, edges, palette family and stylisation. It does not set layout, focal placement, direction, density, contrast or colour relations.
- **Style line:** the family's `technique`, which is its `rules` with layout, placement and direction removed.
- **Form:** comes from the tier. Gathered lets the subject emerge from the structure. Resolved stages the subject's main form at the focal passage and draws it in the performance's own marks.
- **Mood:** only from the words.
- **Fallback:** without a measured performance (an older client, or a failed measurement), the prompt is exactly the Phase 2 prompt.

**Evidence:** the benchmark on Han's takes A, B and C is in the project folder, `audio-benchmark/step6` and `step7`. On the same reference and the same lyric, A and B differ in 11 of 17 decisions, and C differs from both in 16 or more. C gets one breathless mass, a torn join, jolts, discordant colour, hard edges and uncontrolled water.

**C's "21-semitone jump"** is not a tracker error. Three quiet notes at about 107 Hz (6.1, 13.0 and 15.6 s) show a clean 106/213/319 Hz harmonic series, about 23 dB above the room noise, which has no such series. This is the voice dropping into a creak, which is real sound but not a sung leap, so it is now treated as a voice drop. B's "26-semitone onset blip" is a roughly 3 kHz start tone, and it is now ignored.

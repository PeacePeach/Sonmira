# Generation test matrix

This is a regression and evaluation framework for the generation engine. It covers what each scenario should do, what the code does today, and how to check it. The pipeline itself is in [`GENERATION_LOGIC.md`](GENERATION_LOGIC.md).

There are three kinds of validation, and they prove different things:

| Kind | What it proves | Cost | Where |
|---|---|---|---|
| **Unit** | A decision rule does what the code says: gate checks, tier, seed, pool, prompt text. | free | `npm test` (`test/engine/`, `tests/`) |
| **Integration** | The request the server would send: reference, family, the full prompt, for a real or synthetic take. No image. | free | `tools/prompt-audit.mjs`, `tools/understand.mjs`, Playground "analyze only", `?dev` panel |
| **AI evaluation** | What the image model actually paints: style fidelity and distinctiveness. Only this can judge perceptual quality. | paid (one image each) | Playground comparison, `tools/qa-grid.mjs`, human review against `qa/CRITERIA.md` |

Passing unit or integration tests says nothing about how the images look. On 18 Oct `npm test` passes 332/332 on `main` and 334/334 on PR #14.

**What this audit could not use:** real Beta audio, Beta artworks, and the Beta generation metadata (it is kept on testers' devices, see Observability below), and the private Blob store (no token here). Every "current behaviour" below is derived from code or from synthetic voices, not from Beta outcomes.

## Scenarios

| # | Scenario | Expected | Current (from code) | Existing coverage | Missing coverage | Validate with |
|---|---|---|---|---|---|---|
| 1 | Same audio generated twice | A new painting each time: another reference is likely, and the composition differs. | Each generation draws a fresh `crypto` seed, but the same take reuses its idempotency key, so a retry within 24 h replays the stored painting. Same tier: 33 % (Loose), 22 % (Gathered), 9 % (Resolved) chance of the same reference. Before `8a05e88` (16 Oct) the seed was derived from the take, so a repeat always gave the same reference. | `reference-selection`: "each generation of the same take draws a new seed" | Which commit Production runs (it is deployed by hand). A test that two generations of the same features differ in the request, not only the seed. | Unit (request differs); check the deployed commit in Vercel |
| 2 | Different songs, same user | Visibly different works. | Lyric songs differ through the concept, mood and motif. Without lyrics, see 3. | `understanding` fixtures 7–9 (concepts) | Distinctiveness metric across songs | Integration (prompt diff); AI eval (pairwise review) |
| 3 | Different users humming | Distinct works from distinct performances. | Tier is Loose. Mood is always `tender`, motif `abstract`, and the subject is one fixed sentence. Only pace and gesture (~15 of ~606 words) vary. 2 of 3 references are blue. 1 in 3 pairs share the reference. | none for distinctiveness | Prompt-diversity test (how many words vary with audio), reference colour balance per tier | Unit (prompt diff threshold); AI eval (N hums × fixed seed, blind pairwise "same or different?") |
| 4 | Same reference, different humming | The same artistic language, but a different composition, density and movement per performance. | Same request except pace and gesture. Loose has no composition plan. | `composition`: Loose stays all-over | Any test that audio changes composition or colour | Integration (pin `reference`, vary audio); AI eval (grid: 1 reference × 6 hums) |
| 5 | Same humming, different references | Each image follows its reference's language. | The image is sent as authoritative, and the family rules and palette follow it. | `style-prompt`: different families give different instructions; `prompt-audit` | Perceptual fidelity | AI eval (grid: 1 hum × all references in the tier, compared with the reference) |
| 6 | Strong humming without lyrics | Tier reflects how it is sung, or by product decision stays Loose and still looks compelling. | Always Loose (gate fails without words). Synthetic strong takes score `strong: true` and are Loose. | `understanding`: "high pitch continuity and strong singing cannot pass the gate", `hum.wav` → Loose | A product decision first (`engine-v1.md` §5), then labelled real hums | Unit (rule); labelled real takes in the Playground Singing test |
| 7 | Short lyrics + long humming | The whole performance decides. A brief phrase should not make a mostly-hummed take Resolved. | Passes the gate with ≥ 3 coherent words and ≥ 0.15 words/s (3 words in 20 s). Stage 2 then scores the hum, and Resolved is possible. | `performance-profile`: mixed-quality singing; `understanding`: "uncertain transcription… background speech → Loose" | A test with 3–4 words then 15 s of strong hum (expected Gathered or Loose, currently Resolved). No word coverage in time. | Unit with synthetic audio and a stub transcript; real labelled takes |
| 8 | Weak singing, complete lyrics | Not Resolved. | Gathered (stage 2 not strong). Never Loose. | fixture 5 → Gathered | Weak lyric takes at boundary scores | Unit (exists); real labelled takes |
| 9 | Strong singing with lyrics | Resolved. | Resolved only if all 9 gate checks and all 11 strong checks pass. Known misses: wide vibrato on short notes, key drift with few notes, ASR confidence below 0.6 on sung words (sends to Loose), short takes (evidence needs ~4 s of notes and 6 notes). | fixture 6 → Resolved; `performance-profile` strong variants | Real strong takes from more than one singer, device and language; ASR confidence distribution on singing | Playground Singing test with labelled takes (free); `tools/understand.mjs` |
| 10 | Same reference, different moods | Colour and atmosphere shift with the song's emotion while the style stays. | Mood is a one-line "lean within the reference's own range", after a palette line with hex values and "never introduce an unrelated palette". Without words, mood is always tender. | `direct`: "emotion changes light within the palette, not the family or colours" (it asserts the lock) | A test that each mood produces materially different colour guidance | Unit (prompt); AI eval (1 reference × 4 moods, measure the hue and lightness shift) |
| 11 | New uncoded Blob uploads | Discovered and selectable, with style text that does not contradict the image. | main: ignored without a family code or folder. PR #14: joins the tier with no family, gets a randomly drawn family's rules and fallback palette. | `reference-discovery` (both branches) | A test that a family-less reference gets no family-specific rules or colours | Unit; integration on a Preview with the Blob token (`tools/prompt-audit.mjs`) |
| 12 | Uneven reference pools | Each reference in a tier equally likely (if that is the chosen policy), and colour-balanced. | main: per family (`gathered_02` 33 % versus 17 %; `resolved_11` 17 % versus R4 4 %). PR #14: 1/N per tier. Loose is unaffected either way (3 × 1). | `reference-selection`, `references` | A colour-balance report per tier (share of blue references) | Unit (exists); a free diagnostic counting dominant hue families per tier |
| 13 | **P0: Loose collapse**, different improvised or nonsense singing | Different, recognisably personal works, not one blue template. | See 3. In addition, the ASR usually returns vocables or nothing, so no words reach the prompt. | none | A request-diversity floor for wordless Loose; a fixed seed set to separate model variance from pipeline variance | Integration: 10 synthetic or real wordless takes with a fixed seed, the share of the prompt that varies. AI eval: same takes, review grid. |

## Proposed additions, smallest first

These improve existing tests rather than add a framework.

1. **Wordless prompt diversity** (unit, `test/engine/style-prompt.test.mjs`): build `direct()` for two contrasting wordless Loose expressions with one seed, and report the share of differing words. It records today's ~2.5 % as a baseline. It should only become a threshold once a target is agreed.
2. **Short lyric + long hum** (unit, `test/engine/understanding.test.mjs`): `mixedTakes`-style audio with a stubbed 3-word complete transcript. Record the current tier (Resolved). It becomes a regression test after the product rule is decided.
3. **Family-less reference text** (unit, `reference-discovery`, PR #14 only): a tier-folder upload must not receive another family's `rules` or palette.
4. **Tier colour balance** (free diagnostic, extend `tools/sample-references.mjs`): per tier, the share of references by dominant hue, from the measured palettes. Blob uploads have no palette, so this needs the indexer run on them.
5. **Fixed-seed AI grids** (paid, Playground): for Loose, 6 wordless takes × 1 pinned reference, and 1 take × 3 references. Review blind for "can you tell the takes apart?" and "does it read as the reference's language?". About 9 images per round.

## Observability (proposal only, nothing implemented)

**Recorded today:**
- On the device, with each kept painting: `painting.generation` (`engines/ai.js`) holds the tier, family, reference id, seed, library version, model, emotion, motif, and the full `understanding` (singing measures, gate checks, transcript text, lyrics reading, expression). The `?dev` panel shows it for an opened artwork. It is not sent anywhere.
- On the server: the guard logs one `sonmira.guard` line per request (endpoint, install prefix, invite, key, outcome), with no generation content. The full `/api/generate` response, including the prompt and the image, sits in KV under the idempotency key for 24 h, then expires.
- Not recorded anywhere: the prompt alongside the device record, the `expression` and `energy` actually used, `soundOnly`, and the deployed commit.

**Smallest proposal:** one server log line per successful `/api/generate`, with no audio, no transcript text, no image and no reference URL:
`{ evt: 'sonmira.generation', key, install8, commit (VERCEL_GIT_COMMIT_SHA), tier, family, reference id, libraryVersion, seed, emotion, motif, energy, expression, subjectSource, promptHash, model, quality }`.
The prompt itself is reproducible from these inputs with `direct()`, so only its hash is needed to confirm the match. With the seed and library version, any Beta report can be rebuilt as the exact request and re-run on a Preview. The tier inputs (gate checks, strong checks) are already on the device and can be read in the `?dev` panel for the tester's artwork.

# Art engine visual QA

Render: `node tools/qa-grid.mjs [outDir] [width]` (default `qa/out`, git-ignored).
It paints six scenarios (water/tender, sky/bright, garden/melancholic,
landscape/intense, interior/tender, abstract/melancholic). Each one is painted
at loose, gathered and resolved with the **same motif, mood and seed**. It also
paints four seeds per tier for two scenarios.

Review each grid against these criteria:

| Criterion | What to look for | Automated proxy |
| --- | --- | --- |
| Legibility progression | Loose has no readable subject, gathered shows the subject emerging, and resolved states it clearly. | `formCorrelation` with the resolved image rises from loose to gathered (test/engine/paint.test.mjs) |
| Coherence | Resolved has a clear horizon or main mass and a focal point. Loose still reads as a deliberate abstract wash, not noise. | — |
| Palette continuity | All three tiers use the same 2–4 pigments from the unified collection, and only form changes. | pigment count test; 99th-percentile saturation < 0.4 |
| Novelty | No output resembles a reference artwork. | the renderer reads no image files (test); thumbnail correlation check in the QA report |
| Distinctness | Neighbouring tiers differ in structure, not just in colour or noise. | > 30% of pixels differ between tiers |
| Seed variety | Different seeds in one tier give different compositions in the same family. | seeds differ test |

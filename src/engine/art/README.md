# Art direction data

- `annotations.json` has one record per reference image (22 total: loose 3, gathered 5, resolved 14), using the user's own tier labels. Each record holds measurements taken by `tools/annotate_refs.py` on a region of interest (palette, value contrast, saturation, whitespace, edge density, fine texture, large-scale structure) plus hand observations from `tools/reference_observations.json`. Screenshots, collages, watermarks and captions are flagged and cropped out of the analysis.
- `style_clusters.json` / `style-clusters.js` hold the per-tier means, minimums and maximums derived from those annotations by `tools/derive-style.mjs`. `paint/style.js` interpolates between the tier means to get a continuous style.
- `palettes.js` is the unified colour system: 7 muted pigments, 2–4 per painting, with emotion shifting temperature and depth inside it.

The reference images themselves are third-party artworks and are **not** stored in this repository. They are used only for analysis and never as rendering inputs or outputs. To re-run the analysis, pass the folder from the handoff package to `tools/annotate_refs.py`.

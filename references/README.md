# Reference Library

The reference images Sonmira paints from. They ship with each deploy, and
`/api/generate` reads them from here (`src/engine/providers/reference-folder.js`).

## Add a reference

Put the image (jpg, jpeg, png or webp) in its family's folder, commit and
deploy. It joins that family's random pool on the next deploy, with no code
or list to edit:

    references/<tier>/<FAMILY>/<file>

`<FAMILY>` is a family code or full id from `src/engine/direct/families.js`:

| Tier | Families |
| --- | --- |
| `loose/` | `L1` line over wash, `L2` bloom field, `L3` drip curtain |
| `gathered/` | `G1` atmospheric study, `G2` splash wash, `G3` luminous contrast |
| `resolved/` | `R1` graphic snow, `R2` aerial shallows, `R3` vivid wash focal, `R4` lyrical everyday, `R5` light as subject, `R6` misty monochrome |

For example `references/resolved/R4/morning-window.jpg`. The file name
(without extension) is its id. An image outside a family folder is ignored.

## Remove a reference

Delete the file and deploy. For one of the original images below, also remove
its entry from `src/engine/direct/references.js`.

## The original 22

The images directly in `loose/`, `gathered/` and `resolved/` are listed in
`src/engine/direct/references.js`, which keeps their family, measured colours
and content tags. A new image has no measured colours, so its colour line
comes from its family's observed schemes; the image itself is still sent as
the style reference. To measure one, run
`python3 tools/index_references.py references` (needs Pillow).

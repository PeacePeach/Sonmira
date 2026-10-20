# Animation performance (20 Oct)

Han reported that almost every animation stuttered in the TestFlight build,
and that on iPhone the recording's watercolour had lost its bleed (smooth
ellipses instead of feathered, granulated edges).

## Root cause: one shared bottleneck

Every painting card (`src/app/ui/painting.js`) carried two SVG filters:

- the wash, `filter: url(#wc)`: 4-octave fractal noise, a 46 px displacement
  and a granulation noise over the whole wash (plus a 40 % margin);
- the paper grain, an SVG rect with `filter="url(#grain)"`.

SVG reference filters run on the CPU. WebKit runs them on the main thread
every time the card repaints. A card repaints:

- on every frame of the artwork morph (`ui/morph.js` animates width and
  height, so the card is repainted at its new size each frame);
- on every frame of the recording and generating states (the strokes drift,
  bloom and bleed inside the filtered wash);
- on the first frame of every screen that shows paintings (diary, detail,
  Sing), so page transitions started with a long frame.

The wash ran even when the opaque artwork covered it completely, in the
diary, on the detail page and in every morph. So the cost was paid in all of
these places for something nobody could see.

Measured in Chromium (393×852 at 3×, CPU slowed 4×; `tests/e2e/animation-perf.mjs`):
hiding the wash alone removed almost every dropped frame in every scenario.
Hiding the grain alone barely changed the frames but halved raster time. Layout
was not the problem: the morph's per-frame layout cost was about 1 ms.

On iOS the wash filter is also not drawn while its strokes animate (Han's
screenshot from the preview). This was not reproducible in WebKitGTK, which
draws it, so the exact cause on iOS is inferred. The likeliest cause is that
the strokes' CSS animations make them composited layers, and iOS WebKit
doesn't run a software reference filter over composited content.

## Changes

1. **The wash is drawn on the GPU** (`src/app/ui/wash.js`, WebGL2). It uses
   the same strokes (gradients interpolated in Oklab, the same rounded
   shapes, multiplied) and the same noise: the Filter Effects reference
   turbulence, with the same seeds and frequencies, displacement and
   granulation. The stroke motion (bloom, drift, bleed, pause) is replayed
   from the same keyframes and easings. The noise is computed once per size.
   A moving wash draws on its own canvas. A still wash is drawn once by a
   shared context and copied. Without WebGL2 the old DOM strokes and SVG
   filter are used.
2. **A covered wash isn't drawn.** Once the artwork is decoded and faded in,
   the painting gets `.covered` and the wash is `display: none`. A saved
   painting waits up to 400 ms for its artwork before drawing the wash at all
   (`.art-pending`).
3. **The grain is baked once** into a bitmap on the GPU after boot. It is the
   same noise in the same place, shared by every painting
   (`html.grain-baked`). It is drawn in sRGB from the filter's linearRGB tint.
4. **One object URL per artwork blob** for the session. The diary, detail
   page and Sing reuse one decoded image instead of decoding the JPEG again on
   every visit.
5. **Progress bars are scaled, not resized** (recording bar, player bar), so
   they cause no layout on every tick.
6. **Detail page touch:** only drags outside the journal register a blocking
   `touchmove`. Inside the journal, iOS scrolls without waiting for script.

Unchanged: every animation, its duration and easing, the morph, Reduce
Motion, the Engine, billing and storage.

## Before / after

Chromium on Linux, no GPU: WebGL is off for these runs, so the wash uses the
SVG fallback here. The GPU path can't be measured faithfully without a GPU,
so the recording and generating rows still show the SVG filter's cost. This
is the median of 3 runs.

| Scenario | Dropped frames | p95 frame ms | Long tasks ms | Raster ms |
|---|---|---|---|---|
| diary → detail | 2 → 2 | 16.8 → 16.8 | 105 → 67 | 169 → 65 |
| detail expanded → compact | 13 → 0 | 50.1 → 16.7 | 181 → 0 | 611 → 290 |
| detail compact → expanded | 11 → 0 | 66.6 → 16.7 | 300 → 0 | 793 → 425 |
| detail Edit (→ editing) | 16 → 2 | 66.6 → 16.8 | 168 → 0 | 675 → 287 |
| detail → diary | 2 → 2 | 16.8 → 16.8 | 260 → 201 | 250 → 91 |
| diary scroll | 0 → 0 | 16.7 → 16.7 | 0 → 0 | 354 → 61 |
| diary → sing | 2 → 2 | 16.7 → 16.8 | 73 → 0 | 26 → 34 |
| sing: generating → reveal → expanded | 74 → 64 | 66.6 → 50.1 | 223 → 0 | 1088 → 416 |
| sing: Next (→ thumbnail) | 6 → 1 | 33.4 → 16.7 | 58 → 0 | 354 → 111 |
| sing: thumbnail → expanded | 13 → 0 | 50 → 16.7 | 106 → 0 | 704 → 376 |
| sing: Save → diary | 5 → 3 | 50 → 16.8 | 345 → 182 | 217 → 93 |

Without the SVG wash in the recording (the experiment above), the recording
went from 54 dropped frames to 1. On a phone the GPU path does that work on
the GPU.

`tests/e2e/wash-gpu.mjs` compares the GPU wash with the SVG filter on the same
strokes. The mean difference is about 4/255, and under 0.1 % of pixels differ
by more than 32. It also checks that a recording keeps moving.

## Limits

- No iPhone profiling from here. iOS frame rates are not verified; Chromium
  and WebKitGTK were used (WebKitGTK confirms the GPU wash draws in WebKit).
- The detail and Sing morph still animate width and height. Per-frame layout
  measured about 1 ms, and the visual (unstretched artwork, shadow, corners)
  depends on it.
- The diary still rebuilds its list when you return to it (about 15 ms
  unthrottled).
- The grain bake (once, 700 ms after launch) costs one short main-thread task.

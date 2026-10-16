# Handoff: Sonmira — V1 iOS App

## Overview
Sonmira turns short singing recordings (up to 15 s) into watercolor paintings and keeps them as a personal visual diary. It is not a vocal-training app, AI art generator, or social platform — it is quiet, intimate, artistic. Core idea: *Sing a moment. Keep it as a painting.*

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing intended look and behavior, not production code. Recreate the design in the target environment. No codebase exists yet; **SwiftUI** (iOS 17+) is recommended, with `AVAudioEngine` for live pitch/level analysis and `AVAudioRecorder` for capture.

Open `Sonmira.dc.html` in a browser (serve the folder locally so `assets/` and `ios-frame.jsx` resolve). All logic lives in the `<script data-dc-script>` class at the bottom of that file.

## Fidelity
**High-fidelity.** Colors, type, spacing and flows are final. Recreate pixel-accurately at the 402×874 pt iPhone canvas.

## Screens / Views

### 1. Diary (home)
- **Purpose:** browse past paintings, newest first.
- **Top bar:** fixed; 54 pt status-bar inset + 52 pt row; background `#F8F5EF`, bottom hairline `1px #ECE7DE`.
  - Left: empty 44 pt spacer (keeps title optically centered).
  - Center (absolutely centered): wordmark **"Sonmira"**, Cormorant Garamond 600 italic, 24 pt, letter-spacing −0.015em.
  - Right: calendar/list toggle icon (44 pt hit area, 20 pt line icon, stroke 1.3 `#1F1D1A`), then "⋯" settings icon. Hover bg `#EFEBE3`, radius 22.
- **List:** scrolls under the top bar; padding top 110, bottom 140.
  - **Date group header:** padding 30/28/14. "October 15" — Cormorant Garamond 600, 30 pt, −0.015em; then weekday "Thursday" — Cormorant Garamond 600 italic 18 pt `#A39D93`; baseline-aligned, gap 10.
  - **Entry card:** horizontal padding 24, bottom 30. Painting: full width, aspect 3:2, radius 4, bg `#F3EDE1`, shadow `0 1px 2px rgba(60,45,30,.08), 0 10px 24px -14px rgba(60,45,30,.25)`. Below (padding 14/4/0): caption Hanken Grotesk 15 pt `#5E5850` left; duration "0:12" 12 pt `#A39D93` tabular-nums right.
- **Record button:** fixed bottom-center, 64 pt circle `#1F1D1A`, white + (22 pt, stroke 1.6), shadow `0 8px 22px rgba(30,25,20,.28)`, bottom 40. Behind it a 130 pt fade: transparent → `#F8F5EF` at 55%. Active: scale .95.
- **Empty state:** Cormorant italic 18 pt `#A39D93`, centered — "Nothing here yet. Tap + and sing." / "Nothing sung on October 14."

### 1b. Calendar view (toggle)
Appears above the list. Month name (Cormorant 30) + year (17 `#A39D93`); prev/next chevrons 40 pt. 7-col grid; weekday labels 12 pt `#A39D93`. Day cells 46 pt tall, 40 pt circle: today bg `#EFEAE1`; selected bg `#1F1D1A` text white; 4 pt dot under days with entries. Only days with entries are tappable; tapping filters the list to that day (tap again clears). Out-of-month days `#CFC9BF`. Bottom border `1px #ECE7DE`.

### 2. Sing (record) — full-screen modal
- Top: close ✕ (left), date "THURSDAY, OCTOBER 15" 13 pt `#A39D93` tracking .04em (center).
- **Canvas:** same painting card as list, 3:2, margin 28/24.
- **Progress:** 2 pt track `#ECE7DE`, fill `#1F1D1A`; below, elapsed "0:04" left / max "0:15" right, 12 pt.
- Phases:
  1. **Ready** — "Sing a moment." (Cormorant 34) + "A hum, a line, a lullaby. The color follows your voice." (14 pt `#8C867D`). 84 pt black mic button, label "Tap to begin".
  2. **Singing** — rotating italic line ("Keep going…", "Let it out.", "Softly, softly.", "That’s it.") every 3.5 s; mic status line. Stop button: 84 pt black circle with 22 pt white rounded square; behind it a halo whose scale = 1 + level×0.55 and color = `oklch(0.78 0.1 <currentHue> / .55)`. Auto-stops at max length.
  3. **Drying** (1.7 s) — italic line by tier (see below). The final painting crossfades in over the live wash (opacity 1.6 s ease-in-out).
  4. **Name** — summary line (12 pt caps), caption input (Cormorant 24, underline `#DDD6CA`, placeholder "What was this moment?" `#B5AFA5`), primary "Keep it" (56 pt pill `#1F1D1A`, white 16 pt), secondary "Sing again" (14 pt `#8C867D`).

### 3. Painting (detail)
Back chevron left, "Delete" (13 pt `#A39D93`) right. Painting 4:5, side padding 18, larger shadow `0 18px 36px -18px rgba(60,45,30,.3)`. Below (padding 26/28): long date caps 12 pt; caption Cormorant 26 pt; bottom row: 48 pt outlined play/pause circle (1px `#1F1D1A`), progress track 2 pt `#E4DDD1`, elapsed left, "0:12 · Low, soft, steady" right.

### 4. Settings
Whole page in **Cormorant Garamond 600**. Background `#F8F5EF` (same as app). Title "Settings" 38 pt. Section labels italic 16 pt `#A39D93` ("Diary", "About"). Groups: margin 0 18, bg `#F2EDE4`, border `1px #E6DFD3`, radius 20; rows 56 pt, padding 0 20, 19 pt, dividers `1px #E6DFD3`; values `#A39D93`; chevrons `#C2BBB0`.
- Diary: Recording length (tap cycles 10/15/30 seconds), Start day of week (Sun), Daily reminder (22:00), Diary lock ›, Backup / restore ›
- About: Rate Sonmira ›, Privacy policy ›, Terms ›
- Footer: "Recordings stay on this device." italic 15 pt.

## Interactions & Behavior

### Voice → painting
1. **Live analysis (every 100 ms):** RMS level (×7, clamp 0–1) and dominant frequency in 80–1100 Hz (FFT 2048). Pitch maps to hue: `p = clamp((log2(f) − log2(110)) / 3)`, `hue = 255 − p·235` (low → blue/violet, high → warm). Hue smoothed `h = .8h + .2·hue`.
2. **Live wash:** every 400 ms with level > .12, add a pigment blob at a random-walk position: width 22 + level·42 %, chroma .06 + level·.09, alpha .28 + level·.3, lightness .84 − level·.2. Blobs bloom in (scale .5→1, ~1 s). Rendering: radial gradient with a darker ring at 86% (watercolor edge), `multiply` blend, then the whole layer is displaced by fractal noise (SVG `feTurbulence` baseFrequency .016, 4 octaves; `feDisplacementMap` scale 46 soft / 70 bold) plus a paper-grain overlay. In SwiftUI use a Metal shader or `Canvas` + noise distortion.
3. **Result tier** — decided at stop:
   - score = (duration ≥ 4 s) + (avg level > .25) + (pitch std-dev < 35 → 1, < 60 → .5)
   - **good** (≥ 2.5) → clear representational scene. Picks by voice: avg hue > 200 → `scene-shore`; 120–200 & level > .45 → `scene-bay`; 120–200 & softer → `scene-bay-light`; < 120 → `scene-city`. Voice label suffix "steady". Drying line: "That was lovely. Something is appearing…"; summary "STEADY VOICE — IT BECAME A PLACE".
   - **okay** (≥ 1.5) → impressionistic, half-legible scene (`impression-1…6`). Pool by hue: > 220 → [3,5,6]; > 140 → [2,6,1]; else [1,4,5]. Suffix "drifting". Drying: "Almost. A place is half-showing…"; summary "ALMOST STEADY — A PLACE IN THE MIST".
   - **poor** → disordered abstract (`abstract-1…9`). Pool: > 235 → [4,6,7,9]; > 150 → [1,2,5,8]; else [3,5,7]. Suffix "wandering". Drying: "Letting it dry…".
   - Voice label prefix: avg hue > 190 "Low", > 110 "Middle", else "High"; then "bright" if avg level > .5 else "soft".
   - In production these bundled images stand in for generated paintings; the tier/hue logic is the contract the generator should follow.
4. Without mic permission the prototype simulates a voice; production should show a permission prompt instead.

### Navigation
Diary → + → Sing (modal) → Keep it → Diary (new entry at top, today). Diary → card → Painting → back. Diary → ⋯ → Settings → back. Delete on Painting removes the entry and returns to Diary. ✕ on Sing discards.

### Playback
Play toggles audio of the saved recording; progress updates every 100 ms; ends → pause state, bar full.

## State
- `entries[]`: `{ id, date (YYYY-MM-DD), caption, dur (s), voice (label), tier, scene | impression | abstract, audioURL }`
- `view`: list | calendar; `selDay`; `calMonth/Year`
- Record: `phase` (ready / singing / drying / name), elapsed, level, smoothed hue, blob list, tier, caption
- Detail: `detailId`, `playing`, `playT`
- Settings: `maxSeconds` (10/15/30)

## Design Tokens
**Colors**
- Paper (app bg) `#F8F5EF`
- Painting paper `#F3EDE1`
- Settings tile `#F2EDE4`, tile border/divider `#E6DFD3`
- Hairline `#ECE7DE`; hover `#EFEBE3`; today `#EFEAE1`
- Ink `#1F1D1A`; body `#5E5850`; secondary `#8C867D`; muted `#A39D93`; placeholder `#B5AFA5`; chevron `#C2BBB0`; disabled day `#CFC9BF`
- Progress track (detail) `#E4DDD1`; input underline `#DDD6CA`

**Type**
- Display / settings: Cormorant Garamond 600 (and 600 italic), letter-spacing −0.015em. Sizes: 38 / 34 / 30 / 26 / 24 / 19 / 18 / 16 / 15
- UI body: Hanken Grotesk, weight 450. Sizes: 16 / 15 / 14 / 13 / 12

**Radius:** painting 4; settings group 20; icon buttons 22 (44 pt); FAB 32; record 42; pill 28.
**Shadows:** card `0 1px 2px rgba(60,45,30,.08), 0 10px 24px -14px rgba(60,45,30,.25)`; FAB `0 8px 22px rgba(30,25,20,.28)`; record `0 10px 28px rgba(30,25,20,.28)`.
**Spacing:** screen side padding 24–28; group header 30 top / 14 bottom; card gap 30.

## Assets
All in `assets/`, supplied by the client as style references (verify licensing before shipping):
- `scene-shore.png`, `scene-city.png`, `scene-bay.png`, `scene-bay-light.png` — "sang well" tier
- `impression-1…6.png` — "okay" tier
- `abstract-1…9.png` — "sang poorly" tier
Icons are simple 1.3–1.6 pt line glyphs; use SF Symbols equivalents (`plus`, `calendar`, `list.bullet.rectangle`, `ellipsis`, `chevron.left/right`, `mic`, `stop.fill`, `play.fill`, `pause.fill`, `xmark`).

## Files
- `Sonmira.dc.html` — the full prototype (template + logic class)
- `ios-frame.jsx` — device bezel used only for presentation
- `support.js` — prototype runtime (not needed in production)
- `assets/` — painting images

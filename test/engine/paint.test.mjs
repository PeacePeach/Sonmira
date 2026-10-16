// The procedural watercolour renderer and the unified colour system.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { paintScene } from '../../src/engine/paint/painter.js';
import { ALL_MOTIFS } from '../../src/engine/paint/motifs.js';
import { styleFor } from '../../src/engine/paint/style.js';
import { PIGMENTS, MOODS, paletteFor } from '../../src/engine/art/palettes.js';
import { createWashBuilder, tintWash } from '../../src/engine/render/index.js';
import { saturationPct, formCorrelation, differs } from './image-metrics.js';

const small = (o) => paintScene({ width: 200, height: 250, ...o });

test('every motif renders at every tier and every mood', () => {
  for (const motif of ALL_MOTIFS) for (const emotion of Object.keys(MOODS)) for (const control of [0, 0.5, 1]) {
    const img = small({ motif, emotion, control, seed: 3 });
    assert.equal(img.rgba.length, 200 * 250 * 4);
  }
});

test('same motif, mood and seed: lower control dissolves the composition', () => {
  for (const motif of ALL_MOTIFS) {
    const [lo, mid, hi] = [0, 0.5, 1].map((control) => small({ motif, emotion: 'tender', control, seed: 5 }));
    const cLo = formCorrelation(lo, hi), cMid = formCorrelation(mid, hi);
    assert.ok(cLo < cMid, `${motif}: loose ${cLo.toFixed(2)} should be further from resolved than gathered ${cMid.toFixed(2)}`);
    assert.ok(cLo < 0.8, `${motif}: loose too close to resolved (${cLo.toFixed(2)})`);
    assert.ok(differs(lo, mid) > 0.3 && differs(mid, hi) > 0.3, motif);
  }
});

test('style is continuous in control (no jumps between tiers)', () => {
  const keys = ['legibility', 'bleed', 'jitter', 'scatter', 'softPx', 'edge'];
  for (let c = 0; c < 1; c += 0.05) {
    const a = styleFor(c), b = styleFor(c + 0.05);
    for (const k of keys) assert.ok(Math.abs(a[k] - b[k]) < 0.25 * (Math.abs(a[k]) + 1), `${k} at ${c}`);
  }
});

test('repeated seeds give identical paintings, other seeds differ', () => {
  const a = small({ motif: 'water', emotion: 'bright', control: 0.6, seed: 42 });
  const b = small({ motif: 'water', emotion: 'bright', control: 0.6, seed: 42 });
  const c = small({ motif: 'water', emotion: 'bright', control: 0.6, seed: 43 });
  assert.deepEqual(a.rgba, b.rgba);
  assert.ok(differs(a, c) > 0.2);
});

test('unified colours: 2–4 pigments from the collection, muted output', () => {
  for (const emotion of Object.keys(MOODS)) for (const motif of ALL_MOTIFS) for (const seed of [1, 2, 3]) {
    const p = paletteFor(emotion, motif, () => seed / 4);
    assert.ok(p.pigments.length >= 2 && p.pigments.length <= 4, `${emotion}/${motif}: ${p.pigments}`);
    assert.ok(p.pigments.every((n) => n in PIGMENTS));
  }
  for (const emotion of Object.keys(MOODS)) {
    const img = small({ motif: 'garden', emotion, control: 1, seed: 8 });
    const s = saturationPct(img, 0.99);
    assert.ok(s < 0.4, `${emotion}: 99th percentile saturation ${s.toFixed(2)}`);
  }
});

test('the renderer uses no image files', () => {
  const dir = new URL('../../src/engine/paint/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /\.(png|jpe?g|webp)\b|assets\/|references\//i, f);
  }
});

test('live wash stays muted and follows the voice', () => {
  const next = createWashBuilder(5);
  const strokes = [];
  for (let i = 0; i < 40; i++) { const s = next(0.6, 230); if (s) strokes.push(s); }
  assert.ok(strokes.length >= 9);
  assert.ok(strokes.every((s) => s.c <= 0.08));
  assert.equal(next(0.05, 230), null);
  assert.equal(tintWash(strokes, 'intense').length, strokes.length);
});

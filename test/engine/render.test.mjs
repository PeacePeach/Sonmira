import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATALOG, selectArtwork, render, createWashBuilder } from '../../src/engine/render/index.js';
import { COMPLETENESS, EMOTIONS, MOTIFS } from '../../src/engine/contract.js';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('catalog tags use contract vocabulary and cover every tier', () => {
  for (const c of COMPLETENESS) assert.ok(CATALOG.some((i) => i.completeness === c), c);
  for (const i of CATALOG) {
    assert.ok(i.emotions.every((e) => EMOTIONS.includes(e)), i.id);
    assert.ok(i.motifs.every((m) => MOTIFS.includes(m)), i.id);
  }
});

test('catalog images exist once the app has copied them in', (t) => {
  if (!existsSync(APP_ROOT + 'assets/art')) return t.skip('assets/art not present yet');
  for (const i of CATALOG) assert.ok(existsSync(APP_ROOT + i.src), i.src);
});

test('every interpretation gets an artwork from its own tier', () => {
  for (const completeness of COMPLETENESS) for (const emotion of EMOTIONS) for (const motif of MOTIFS) {
    const a = selectArtwork({ completeness, emotion, motif, voiceHue: 200, seed: 7 });
    assert.equal(a.completeness, completeness);
  }
});

test('motif steers the choice', () => {
  const pick = (motif) => selectArtwork({ completeness: 'resolved', emotion: 'bright', motif, voiceHue: 160, seed: 3 });
  assert.ok(pick('landscape').motifs.includes('landscape'));
  assert.ok(pick('water').motifs.includes('water'));
  assert.ok(selectArtwork({ completeness: 'gathered', emotion: 'tender', motif: 'garden', seed: 1 }).motifs.includes('garden'));
});

test('same take renders the same way', () => {
  const args = { interpretation: { completeness: 'gathered', emotion: 'tender', motif: 'sky' }, features: { durationSec: 6, hue: { mean: 210 }, level: { mean: 0.4 } }, note: 'x' };
  assert.deepEqual(render(args), render(args));
});

test('wash marks follow the voice and get tinted by emotion', () => {
  const next = createWashBuilder(5);
  const strokes = [];
  for (let i = 0; i < 40; i++) { const s = next(0.6, 230); if (s) strokes.push(s); }
  assert.ok(strokes.length >= 9);
  assert.equal(next(0.05, 230), null);
  const { wash } = render({ interpretation: { completeness: 'loose', emotion: 'intense', motif: 'abstract' }, wash: strokes });
  assert.equal(wash.length, strokes.length);
  assert.ok(wash.slice(1).every((s, i) => s.hue !== strokes[i + 1].hue));
  const { wash: ground } = render({ interpretation: { completeness: 'loose', emotion: 'tender', motif: 'abstract' }, wash: [] });
  assert.ok(ground.length > 0);
});

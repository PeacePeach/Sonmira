// The single generation API, including the robustness cases from the brief.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { generatePainting, METHOD } from '../../src/engine/generate.js';
import { voice, scenes, rng, SR } from './synth.js';

const gen = (o) => generatePainting({ width: 160, height: 200, seed: 7, ...o });

test('returns a rendered image and the full description', async () => {
  const g = await gen({ samples: scenes.steadyPhrase(), sampleRate: SR, noteText: 'by the sea' });
  assert.equal(g.image.rgba.length, 160 * 200 * 4);
  assert.equal(g.method, METHOD);
  assert.equal(g.tier, 'resolved');
  assert.equal(g.motif, 'water');
  assert.ok(g.controlScore > 0.78 && g.controlConfidence > 0.8);
  assert.match(g.focus, /^\d+% \d+%$/);
});

test('a real recording (WAV file) is analysed', async () => {
  const wav = fileURLToPath(new URL('../../tests/e2e/hum.wav', import.meta.url));
  const g = await gen({ audioFile: wav });
  assert.notEqual(g.controlScore, null);
  assert.ok(g.interpretation.signals.sustain > 0);
});

test('quiet and incomplete takes: low confidence, loose, still painted', async () => {
  const quiet = voice([{ hz: 220, sec: 0.7, amp: 0.02 }]);
  const g = await gen({ samples: quiet, sampleRate: SR });
  assert.equal(g.tier, 'loose');
  assert.ok(g.controlConfidence < 0.3);
  const none = await gen({});
  assert.equal(none.controlScore, null);
  assert.equal(none.image.rgba.length, 160 * 200 * 4);
});

test('singing a tune with leaps (no reference melody) is not treated as uncontrolled', async () => {
  // held notes with 4–7 semitone leaps, like an ordinary song
  const tune = voice([196, 262, 330, 262, 392, 330, 262, 196].map((hz) => ({ hz, sec: 0.6 })));
  const g = await gen({ samples: tune, sampleRate: SR });
  assert.notEqual(g.tier, 'loose');
});

test('vibrato and slides count as connected', async () => {
  const vib = await gen({ samples: voice([{ hz: 220, sec: 5 }], { vibratoSt: 1.2, vibratoHz: 5.5 }), sampleRate: SR });
  assert.ok(vib.interpretation.signals.continuity > 0.85);
  // octave slides up and down, 0.8 s each
  const slide = new Float32Array(SR * 4); let ph = 0;
  for (let i = 0; i < slide.length; i++) { const t = ((i / SR) % 1.6) / 1.6; const hz = 150 * 2 ** (t < 0.5 ? t * 2 : 2 - t * 2); ph += (2 * Math.PI * hz) / SR; slide[i] = 0.2 * Math.sin(ph) + 0.08 * Math.sin(2 * ph); }
  const sg = await gen({ samples: slide, sampleRate: SR });
  assert.ok(sg.interpretation.signals.continuity > 0.8, `slide continuity ${sg.interpretation.signals.continuity}`);
});

test('loud environmental noise lowers confidence; noise alone stays loose', async () => {
  const clean = scenes.steadyPhrase(), noisy = new Float32Array(clean.length), r = rng(4);
  for (let i = 0; i < clean.length; i++) noisy[i] = clean[i] + (r() - 0.5) * 0.5;
  const a = await gen({ samples: clean, sampleRate: SR }), b = await gen({ samples: noisy, sampleRate: SR });
  assert.ok(b.controlConfidence < a.controlConfidence, `${b.controlConfidence} vs ${a.controlConfidence}`);
  const n = await gen({ samples: scenes.noise(), sampleRate: SR });
  assert.equal(n.tier, 'loose');
  assert.equal(n.controlConfidence, 0);
});

test('without a note: neutral mood, abstract motif', async () => {
  const g = await gen({ samples: scenes.steadyPhrase(), sampleRate: SR });
  assert.deepEqual([g.emotion, g.motif], ['tender', 'abstract']);
});

test('a note naming several motifs gives one lead motif', async () => {
  const g = await gen({ noteText: 'mountain road down to the sea', samples: scenes.steadyPhrase(), sampleRate: SR });
  assert.equal(g.motif, 'landscape');
  assert.equal(g.interpretation.secondaryMotif, 'water');
});

test('overrides are deterministic and hold motif and mood fixed', async () => {
  const base = { noteText: '', emotionOverride: 'melancholic', motifOverride: 'garden', seed: 11 };
  const tiers = [];
  for (const v of ['loose', 'gathered', 'resolved', 0.25, 0.8]) {
    const g = await gen({ ...base, vocalControlOverride: v });
    assert.deepEqual([g.emotion, g.motif, g.seed], ['melancholic', 'garden', 11]);
    tiers.push(g.tier);
  }
  assert.deepEqual(tiers, ['loose', 'gathered', 'resolved', 'loose', 'resolved']);
  const a = await gen({ ...base, vocalControlOverride: 0.4 }), b = await gen({ ...base, vocalControlOverride: 0.4 });
  assert.deepEqual(a.image.rgba, b.image.rgba);
});

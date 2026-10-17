// One generation API for the voice-to-watercolor engine.
//
//   generatePainting({ audioFile?, samples?, sampleRate?, features?, noteText?,
//                      vocalControlOverride?, emotionOverride?, motifOverride?,
//                      seed?, width?, height?, allowedMotifs? })
//   → { image: { width, height, rgba }, controlScore, controlConfidence, tier,
//       stylePosition, emotion, motif, seed, focus, interpretation, method }
//
// Audio can come as a WAV file (path or bytes in Node, Blob in the browser),
// raw samples, or already-measured features. Everything after the audio is
// deterministic for a given seed. The image is rendered here, procedurally:
// no reference artwork or stored painting is used.
//
// What is real and what is heuristic:
//   real (measured)   level, pauses, pitch track, pitch continuity, phrase and
//                     onset counts, dynamic range, pitch clarity
//   heuristic         turning those into a control score and tier (thresholds
//                     in interpret/completeness.js CALIBRATION), keyword
//                     emotion and motif from the note, the style curve
//   artistic          motifs, palettes and the watercolour renderer

import { analyzeSamples, decodeWav } from './analysis/index.js';
import { interpret, MOTIFS } from './interpret/index.js';
import { paintScene } from './paint/painter.js';
import { hashSeed } from './render/rng.js';

export const METHOD = 'procedural-watercolor-v1';

async function loadAudio(audioFile) {
  if (!audioFile) return null;
  if (typeof Blob !== 'undefined' && audioFile instanceof Blob) {
    if (typeof OfflineAudioContext === 'undefined') return null;
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buf = await ctx.decodeAudioData(await audioFile.arrayBuffer());
    return { samples: buf.getChannelData(0), sampleRate: buf.sampleRate };
  }
  if (typeof audioFile === 'string') {
    const { readFile } = await import('node:fs/promises');
    return decodeWav(await readFile(audioFile));
  }
  return decodeWav(audioFile);
}

export async function generatePainting(opts = {}) {
  const {
    audioFile, samples, sampleRate, noteText = '', transcript = '',
    vocalControlOverride, emotionOverride, motifOverride,
    width = 720, height = 900, allowedMotifs = MOTIFS,
  } = opts;
  let features = opts.features ?? null;
  if (!features && samples && sampleRate) features = analyzeSamples(samples, sampleRate);
  if (!features && audioFile) {
    try {
      const a = await loadAudio(audioFile);
      if (a) features = analyzeSamples(a.samples, a.sampleRate);
    } catch { features = null; } // unreadable audio → neutral defaults below
  }
  const it = interpret({
    features, note: noteText, transcript, allowedMotifs,
    overrides: { control: vocalControlOverride, emotion: emotionOverride, motif: motifOverride },
  });
  const seed = (opts.seed ?? hashSeed(features?.durationSec ?? 0, features?.hue?.mean ?? 0, features?.level?.mean ?? 0, noteText)) >>> 0;
  const painted = paintScene({ motif: it.motif, emotion: it.emotion, control: it.stylePosition, seed, width, height });
  return {
    image: { width: painted.width, height: painted.height, rgba: painted.rgba },
    controlScore: features ? it.controlScore : null,
    controlConfidence: it.controlConfidence,
    tier: it.completeness,
    stylePosition: it.stylePosition,
    emotion: it.emotion,
    motif: it.motif,
    seed,
    focus: `${Math.round(painted.focus[0] * 100)}% ${Math.round(painted.focus[1] * 100)}%`,
    pigments: painted.palette.pigments,
    interpretation: it,
    method: METHOD,
  };
}

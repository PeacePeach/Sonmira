// Fine pitch track for singing analysis: one YIN estimate every 10 ms on a
// downsampled copy of the recording (the 100 ms live frames are too coarse
// to see vibrato, drift or how a note is reached).
//
//   pitchTrack(samples, sampleRate) → { hopSec, frames: [{ t, hz, cents, clarity, rms }] }
//
// cents are relative to A4 = 440 Hz; hz and cents are null when unvoiced.

import { detectPitch, rms } from './frame.js';

export const TRACK_HOP_SEC = 0.01;
const TARGET_SR = 11025;       // ample for an 1100 Hz ceiling
const WIN_SEC = 0.032;         // two periods of 80 Hz, with margin
const MIN_CLARITY = 0.7;
const MIN_RMS = 0.006;

// Box-filter decimation by an integer factor: crude, but enough to keep
// energy above the new Nyquist from folding into the pitch range.
function downsample(x, sr) {
  const f = Math.max(1, Math.floor(sr / TARGET_SR));
  if (f === 1) return { x, sr };
  const n = Math.floor(x.length / f), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < f; k++) s += x[i * f + k];
    out[i] = s / f;
  }
  return { x: out, sr: sr / f };
}

export function pitchTrack(samples, sampleRate) {
  const { x, sr } = downsample(samples, sampleRate);
  const hop = Math.max(1, Math.round(sr * TRACK_HOP_SEC)), win = Math.round(sr * WIN_SEC);
  const frames = [];
  for (let start = 0; start + win <= x.length; start += hop) {
    const frame = x.subarray(start, start + win);
    const r = rms(frame);
    let hz = null, clarity = 0;
    if (r >= MIN_RMS) ({ hz, clarity } = detectPitch(frame, sr, { threshold: 0.12 }));
    const voiced = hz != null && clarity >= MIN_CLARITY;
    frames.push({ t: (start + win / 2) / sr, hz: voiced ? hz : null, cents: voiced ? 1200 * Math.log2(hz / 440) : null, clarity, rms: r });
  }
  // Octave-error repair: a lone frame an octave away from both neighbours.
  for (let i = 1; i < frames.length - 1; i++) {
    const [a, b, c] = [frames[i - 1].cents, frames[i].cents, frames[i + 1].cents];
    if (a == null || b == null || c == null || Math.abs(a - c) > 150) continue;
    const mid = (a + c) / 2;
    for (const k of [-1200, 1200]) {
      if (Math.abs(b + k - mid) < 150) { frames[i].cents = b + k; frames[i].hz = 440 * 2 ** (frames[i].cents / 1200); }
    }
  }
  return { hopSec: TRACK_HOP_SEC, frames };
}

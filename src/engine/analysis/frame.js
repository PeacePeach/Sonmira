// Per-frame signal measurements: loudness and fundamental frequency.
// Pure functions over Float32Array (or any array of numbers in -1..1),
// so they run the same in the browser and in Node tests.

export const PITCH_MIN_HZ = 80;
export const PITCH_MAX_HZ = 1100;

// Root-mean-square amplitude of a frame.
export function rms(frame) {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return frame.length ? Math.sqrt(s / frame.length) : 0;
}

// Display level 0..1, same scaling as the design prototype (rms × 7).
export function levelFromRms(r) {
  return Math.min(1, Math.max(0, r * 7));
}

// Fundamental frequency estimate using the YIN difference function
// (de Cheveigné & Kawahara, 2002), simplified.
// Returns { hz, clarity } where clarity is 0..1 (1 = strongly periodic),
// or { hz: null, clarity } when no clear pitch is found.
export function detectPitch(frame, sampleRate, opts = {}) {
  const minHz = opts.minHz ?? PITCH_MIN_HZ;
  const maxHz = opts.maxHz ?? PITCH_MAX_HZ;
  const threshold = opts.threshold ?? 0.15;

  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(frame.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const W = frame.length - maxLag;
  if (maxLag <= minLag || W < minLag) return { hz: null, clarity: 0 };

  // Difference function d(tau) and its cumulative mean normalisation d'(tau).
  const d = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const diff = frame[i] - frame[i + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // First dip below threshold (then walk to its local minimum);
  // otherwise the global minimum in range, if it is reasonably low.
  let best = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let min = Infinity;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmnd[tau] < min) { min = cmnd[tau]; best = tau; }
    }
    if (min > 0.35) return { hz: null, clarity: Math.max(0, 1 - min) };
  }

  // Parabolic interpolation around the chosen lag for sub-sample accuracy.
  let lag = best;
  if (best > minLag && best < maxLag) {
    const a = cmnd[best - 1], b = cmnd[best], c = cmnd[best + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) lag = best + (a - c) / (2 * denom);
  }
  const hz = sampleRate / lag;
  if (hz < minHz || hz > maxHz) return { hz: null, clarity: 0 };
  return { hz, clarity: Math.max(0, Math.min(1, 1 - cmnd[best])) };
}

// Pitch → hue, as in the design prototype: low voices are blue/violet,
// high voices warm. 110 Hz → 255, 880 Hz → 20.
export function hueFromPitch(hz) {
  const p = Math.min(1, Math.max(0, (Math.log2(hz) - Math.log2(110)) / 3));
  return 255 - p * 235;
}

export function semitones(hz, refHz = 440) {
  return 12 * Math.log2(hz / refHz);
}

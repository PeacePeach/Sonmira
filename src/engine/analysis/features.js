// Turns a stream of audio samples into AudioFeatures.
//
// These are plain signal measurements (how loud, how much silence, how
// smoothly the detected pitch moves). They are NOT singing-quality scores:
// there is no melody or rhythm reference to judge against, and nothing here
// should be shown to the user as accuracy, rhythm or "how well you sang".

import { rms, levelFromRms, detectPitch, hueFromPitch, semitones } from './frame.js';

export const FEATURES_VERSION = 1;
const HOP_SEC = 0.1;            // one frame every 100 ms, matching the live UI tick
const MIN_PAUSE_FRAMES = 3;     // a pause is ≥ 300 ms of quiet between sounds
const MIN_CLARITY = 0.6;        // pitch confidence needed to count a frame as voiced
const SMOOTH_STEP_ST = 1.0;     // frame-to-frame pitch change counted as continuous
const NEUTRAL_HUE = 240;

function windowSizeFor(sampleRate) {
  // Long enough for two periods of the lowest pitch (80 Hz).
  let n = 1024;
  while (n < (sampleRate / 80) * 2) n *= 2;
  return n;
}

// Halve high sample rates before pitch detection: plenty for an 1100 Hz
// ceiling and about four times cheaper, which keeps a frame well under 5 ms.
function decimate(frame, sampleRate) {
  if (sampleRate <= 32000) return { x: frame, sr: sampleRate };
  const n = frame.length >> 1, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * (frame[2 * i] + frame[2 * i + 1]);
  return { x, sr: sampleRate / 2 };
}

// One measurement every ~100 ms. Each addFrame() call is one frame: in the
// app that is a 2048-sample snapshot from a Web Audio AnalyserNode (snapshots
// can overlap or leave gaps, so time is counted in frames, not samples).
export class FrameAnalyzer {
  constructor(sampleRate) {
    if (!(sampleRate > 0)) throw new Error('FrameAnalyzer: sampleRate required');
    this.sampleRate = sampleRate;
    this.frames = [];
    this.hue = NEUTRAL_HUE;
  }

  // Returns { level, hue } for the live wash and halo.
  addFrame(samples) {
    const r = samples && samples.length ? rms(samples) : 0;
    const level = levelFromRms(r);
    let hz = null, clarity = 0;
    if (r > 0.003) {
      const { x, sr } = decimate(samples, this.sampleRate);
      ({ hz, clarity } = detectPitch(x, sr));
    }
    if (hz && clarity >= MIN_CLARITY) this.hue = 0.8 * this.hue + 0.2 * hueFromPitch(hz);
    this.frames.push({ rms: r, level, hz, clarity });
    return { level, hue: this.hue };
  }

  finish() {
    return summarize(this.frames);
  }
}

// Whole buffers (tests, or a decoded recording): one frame per 100 ms hop,
// each frame being the analysis window that ends at that hop.
export function analyzeSamples(samples, sampleRate) {
  const a = new FrameAnalyzer(sampleRate);
  const hop = Math.round(sampleRate * HOP_SEC), win = windowSizeFor(sampleRate);
  for (let end = hop; end <= samples.length; end += hop) {
    a.addFrame(samples.subarray(Math.max(0, end - Math.max(win, hop)), end));
  }
  return a.finish();
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x, d = 3) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
function quantile(xs, q) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function summarize(frames) {
  const durationSec = frames.length * HOP_SEC;

  // Activity: a frame is "sounding" when clearly above the quiet floor.
  const rmsAll = frames.map((f) => f.rms);
  const activeRms = Math.max(0.008, 0.15 * quantile(rmsAll, 0.95));
  const rawActive = frames.map((f) => f.rms >= activeRms);

  // Bridge gaps shorter than a pause; trim leading/trailing quiet.
  const first = rawActive.indexOf(true);
  const last = rawActive.lastIndexOf(true);
  const active = rawActive.slice();
  let pauses = [];
  if (first >= 0) {
    let i = first;
    while (i <= last) {
      if (!active[i]) {
        let j = i;
        while (j <= last && !active[j]) j++;
        const len = j - i;
        if (len < MIN_PAUSE_FRAMES) for (let k = i; k < j; k++) active[k] = true;
        else pauses.push(len * HOP_SEC);
        i = j;
      } else i++;
    }
  }
  const activeFrames = frames.filter((_, i) => active[i]);
  const voiced = frames.map((f, i) => active[i] && f.hz != null && f.clarity >= MIN_CLARITY);
  const voicedFrames = frames.filter((_, i) => voiced[i]);

  // Pitch continuity: share of neighbouring voiced frames whose pitch moves
  // by at most a semitone. Describes how connected the line is, not whether
  // the notes are "right".
  let pairs = 0, smooth = 0;
  for (let i = 1; i < frames.length; i++) {
    if (voiced[i] && voiced[i - 1]) {
      pairs++;
      if (Math.abs(semitones(frames[i].hz) - semitones(frames[i - 1].hz)) <= SMOOTH_STEP_ST) smooth++;
    }
  }
  const st = voicedFrames.map((f) => semitones(f.hz));
  const hasPitch = voicedFrames.length >= 3;

  const levels = activeFrames.map((f) => f.level);
  const voicedHues = voicedFrames.map((f) => hueFromPitch(f.hz));

  return {
    version: FEATURES_VERSION,
    kind: 'signal-measurements', // descriptive only; not quality scores
    durationSec: round(durationSec, 2),
    frameHopSec: HOP_SEC,
    level: {
      mean: round(mean(levels)),
      peak: round(Math.max(0, ...frames.map((f) => f.level))),
      p90: round(quantile(levels, 0.9)),
    },
    activity: {
      soundingSec: round(activeFrames.length * HOP_SEC, 2),
      soundingRatio: round(frames.length ? activeFrames.length / frames.length : 0),
      voicedSec: round(voicedFrames.length * HOP_SEC, 2),
      voicedRatio: round(activeFrames.length ? voicedFrames.length / activeFrames.length : 0),
    },
    pauses: {
      count: pauses.length,
      totalSec: round(pauses.reduce((a, b) => a + b, 0), 2),
      longestSec: round(Math.max(0, ...pauses), 2),
    },
    pitch: hasPitch
      ? {
          medianHz: round(440 * 2 ** (quantile(st, 0.5) / 12), 1),
          rangeSemitones: round(quantile(st, 0.9) - quantile(st, 0.1), 2),
          spreadSemitones: round(std(st), 2),
          continuity: round(pairs ? smooth / pairs : 0),
        }
      : null,
    hue: { mean: round(voicedHues.length ? mean(voicedHues) : NEUTRAL_HUE, 1) },
  };
}

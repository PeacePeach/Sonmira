// Vocal control → completeness (loose / gathered / resolved).
//
// "Control" here means how connected and sustained the recorded voice was:
// seconds of clear pitch, how smoothly that pitch moved (vibrato and slides
// count as smooth), and how broken it was by pauses. It picks an artistic
// register for the painting. It is NOT a judgement of singing skill: with no
// reference melody or beat, nothing here can say whether notes or rhythm
// were right, and no number here should be shown to the user as a score.
//
// All thresholds live in CALIBRATION and are artistic choices, not values
// validated against listeners.

export const COMPLETENESS = ['loose', 'gathered', 'resolved'];

export const CALIBRATION = {
  sustainSec: 4,          // pitched seconds that count as fully sustained
  pausesPerSecFull: 0.8,  // this many pauses per sounding second = fragmented
  weights: { sustain: 0.35, continuity: 0.6, flow: 0.2 },
  gatheredAt: 0.5,        // control score thresholds for the tiers
  resolvedAt: 0.78,
  minVoicedSec: 1,        // less pitched sound than this → loose
  prior: 0.45,            // where low-confidence takes are pulled toward
  // control score → renderer style position (0 = loose anchor, 0.5 = gathered, 1 = resolved)
  renderMap: [[0, 0.04], [0.5, 0.36], [0.64, 0.5], [0.78, 0.7], [1, 1]],
  presets: { loose: 0, gathered: 0.5, resolved: 1 },
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function completenessSignals(features, cal = CALIBRATION) {
  if (!features || !features.activity) return null;
  const voicedSec = features.activity.voicedSec ?? 0;
  const soundingSec = Math.max(0.1, features.activity.soundingSec ?? 0);
  const continuity = features.pitch?.continuity ?? 0;
  const pausesPerSec = (features.pauses?.count ?? 0) / soundingSec;
  return {
    sustain: clamp01(voicedSec / cal.sustainSec),
    continuity: clamp01(continuity),
    flow: clamp01(1 - pausesPerSec / cal.pausesPerSecFull),
  };
}

// How much to trust the measurements: enough pitched sound, clear pitch,
// and not mostly unpitched noise.
export function controlConfidence(features) {
  if (!features?.activity) return 0;
  const voicedSec = features.activity.voicedSec ?? 0;
  const clarity = features.clarity?.mean ?? (voicedSec > 0 ? 0.8 : 0);
  const voicedRatio = features.activity.voicedRatio ?? 0;
  return Math.round(clamp01(voicedSec / 3) * clamp01((clarity - 0.55) / 0.35) * (0.5 + 0.5 * voicedRatio) * 1000) / 1000;
}

export function tierFor(score, cal = CALIBRATION) {
  return score >= cal.resolvedAt ? 'resolved' : score >= cal.gatheredAt ? 'gathered' : 'loose';
}

export function renderPosition(score, cal = CALIBRATION) {
  const m = cal.renderMap;
  for (let i = 1; i < m.length; i++) {
    if (score <= m[i][0]) {
      const [x0, y0] = m[i - 1], [x1, y1] = m[i];
      return y0 + ((score - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return m[m.length - 1][1];
}

// Multiplicative, so one badly broken signal (e.g. pitch leaping about)
// keeps the painting loose even when the others are high. Pauses weigh
// least: breathing between phrases is normal.
export function interpretCompleteness(features, cal = CALIBRATION) {
  const s = completenessSignals(features, cal);
  if (!s) return { value: 'gathered', source: 'default', score: cal.prior, confidence: 0, signals: null };
  const w = cal.weights;
  const raw = s.sustain ** w.sustain * s.continuity ** w.continuity * (0.3 + 0.7 * s.flow) ** w.flow;
  const confidence = controlConfidence(features);
  let score = confidence * raw + (1 - confidence) * Math.min(raw, cal.prior);
  if ((features.activity.voicedSec ?? 0) < cal.minVoicedSec) score = Math.min(score, raw, cal.gatheredAt - 0.01);
  score = Math.round(score * 1000) / 1000;
  return { value: tierFor(score, cal), source: 'voice', score, rawScore: Math.round(raw * 1000) / 1000, confidence, signals: s };
}

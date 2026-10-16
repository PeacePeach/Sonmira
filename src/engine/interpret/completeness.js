// Completeness: how "gathered" the painting should be.
//
// Derived from how connected the recorded voice was: how long it sounded
// with a clear pitch, how smoothly that pitch moved, and how broken it was
// by pauses. This chooses an artistic register for the painting. It is not
// a judgement of singing skill, and none of these numbers should be shown
// to the user as a score.

export const COMPLETENESS = ['loose', 'gathered', 'resolved'];

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function completenessSignals(features) {
  if (!features || !features.activity) return null;
  const voicedSec = features.activity.voicedSec ?? 0;
  const soundingSec = Math.max(0.1, features.activity.soundingSec ?? 0);
  const continuity = features.pitch?.continuity ?? 0;
  const pausesPerSec = (features.pauses?.count ?? 0) / soundingSec;
  return {
    sustain: clamp01(voicedSec / 4),            // ~4 s of pitched sound is "sustained"
    continuity: clamp01(continuity),
    flow: clamp01(1 - pausesPerSec / 0.8),      // ≥ 0.8 pauses per sounding second → fragmented
  };
}

export function interpretCompleteness(features) {
  const s = completenessSignals(features);
  if (!s) return { value: 'gathered', source: 'default', signals: null };
  // Multiplicative, so one badly broken signal (e.g. pitch leaping about)
  // keeps the painting loose even when the others are high. Pauses weigh
  // least: breathing between phrases is normal.
  const weight = s.sustain ** 0.35 * s.continuity ** 0.45 * (0.3 + 0.7 * s.flow) ** 0.2;
  let value = weight >= 0.78 ? 'resolved' : weight >= 0.5 ? 'gathered' : 'loose';
  // Too little pitched sound to build a scene from.
  if ((features.activity.voicedSec ?? 0) < 1) value = 'loose';
  return { value, source: 'voice', weight: Math.round(weight * 1000) / 1000, signals: s };
}

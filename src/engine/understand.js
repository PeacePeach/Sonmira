// Sound-to-art understanding (V2): the decision pipeline before any image.
//
//   recording ─┬─ fine pitch track → singing analysis (here, in the browser)
//              └─ /api/understand: transcription → lyrics reading (server)
//   → stage 1: lyrical-completion gate (words only decide whether it passes)
//   → stage 2: singing quality (only after the gate) → Loose | Gathered | Resolved
//   → semantics for the tier: what to express (the words' concept, mood, motif)
//   → expression: how the voice moved, as gesture
//
// Responsibilities stay separate: the words decide WHAT is expressed, the
// singing decides HOW ABSTRACT, the reference (chosen later, on the server)
// decides HOW IT LOOKS. Every step's output is kept for diagnostics.

import { pitchTrack } from './analysis/pitchtrack.js';
import { singingAnalysis } from './analysis/singing.js';
import { analyzeSamples } from './analysis/features.js';
import { completionGate, decideTier, GATE_CALIBRATION } from './interpret/lyrics.js';

export const UNDERSTAND_VERSION = 1;
// Below this much sound there is nothing to transcribe: skip the paid call.
export const MIN_SOUND_FOR_WORDS_SEC = 1.0;

// How the voice moved → gesture words (never colour, never quality).
export function expressionFor(features, singing) {
  const cents = singing?.expression?.pitchRangeCents ?? (features?.pitch?.rangeSemitones != null ? features.pitch.rangeSemitones * 100 : null);
  const sounding = Math.max(0.5, features?.activity?.soundingSec ?? 0);
  const pauseRate = (features?.pauses?.count ?? 0) / sounding;
  const dyn = features?.energy?.dynamicRangeDb ?? singing?.expression?.dynamicRangeDb ?? null;
  return {
    range: cents == null ? null : cents < 300 ? 'narrow' : cents < 900 ? 'moderate' : 'wide',
    flow: features?.activity ? (pauseRate > 0.25 ? 'broken' : 'connected') : null,
    dynamics: dyn == null ? null : dyn > 12 ? 'swelling' : 'even',
    vibrato: (singing?.expression?.vibratoShare ?? 0) >= 0.3,
  };
}

// Words are trusted for meaning only when the transcript is not a known
// hallucination, is confident enough, and reads as coherent words. A Loose
// take may still carry the feeling of reliable words; unreliable words carry
// nothing, and the painting expresses the sound itself.
export function semanticsFor(tier, transcript, lyrics) {
  const asr = transcript?.asrConfidence;
  const reliable = Boolean(transcript && !transcript.hallucination && transcript.lexicalWords > 0
    && (asr == null || asr >= GATE_CALIBRATION.minAsrConfidence) && lyrics && !lyrics.error && lyrics.lexical && lyrics.coherent);
  const text = reliable ? lyrics.concepts?.[tier] : '';
  if (!reliable || !text) return { source: 'sound', concept: null, mood: null, motif: null, reason: transcript?.lexicalWords ? 'words not reliable enough to carry meaning' : 'no words' };
  return {
    source: 'lyrics',
    concept: { text, theme: lyrics.theme ?? [], imagery: lyrics.imagery ?? [], figurative: lyrics.figurative ?? [] },
    mood: lyrics.mood ?? null,
    motif: lyrics.motif ?? null,
    reason: 'coherent words',
  };
}

// samples/sampleRate: the decoded recording; features: the frame features
// (computed from the samples when not given); words(): async → the
// /api/understand result ({ transcript, lyrics }) — injected so tests and the
// CLI can run the same pipeline.
export async function understandTake({ samples = null, sampleRate = 0, features = null, words = null, forcedTier = null } = {}) {
  const t0 = Date.now();
  const feats = features ?? (samples ? analyzeSamples(samples, sampleRate) : null);
  const singing = samples ? singingAnalysis(pitchTrack(samples, sampleRate), feats) : null;
  const sounding = feats?.activity?.soundingSec ?? 0;
  const ask = Boolean(words) && sounding >= MIN_SOUND_FOR_WORDS_SEC;
  const w = ask ? await words() : null;
  const transcript = w?.transcript ?? null, lyrics = w?.lyrics ?? null;
  const gate = completionGate({ transcript, lyrics, singing, features: feats });
  const decision = decideTier({ gate, quality: singing?.quality });
  const tier = forcedTier ?? decision.tier;
  const semantics = semanticsFor(tier, transcript, lyrics);
  return {
    version: UNDERSTAND_VERSION,
    audio: feats ? {
      durationSec: feats.durationSec, soundingSec: feats.activity?.soundingSec, voicedSec: feats.activity?.voicedSec,
      voicedRatio: feats.activity?.voicedRatio, pauses: feats.pauses?.count, pitchContinuity: feats.pitch?.continuity ?? null,
      medianHz: feats.pitch?.medianHz ?? null, dynamicRangeDb: feats.energy?.dynamicRangeDb ?? null,
    } : null,
    singing,
    wordsRequested: ask,
    wordsSkipped: words && !ask ? `less than ${MIN_SOUND_FOR_WORDS_SEC}s of sound` : null,
    transcript, lyrics,
    gate, decision,
    tier, tierSource: forcedTier ? 'override' : 'decision',
    semantics,
    expression: expressionFor(feats, singing),
    ms: Date.now() - t0,
  };
}

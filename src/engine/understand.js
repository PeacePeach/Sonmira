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
import { measurePerformance } from './analysis/performance-measure.js';
import { completionGate, decideTier, lyricalFloor, imageryFloor, GATE_CALIBRATION } from './interpret/lyrics.js';
import { concreteImagery } from './interpret/imagery.js';

export const UNDERSTAND_VERSION = 2;
// Below this much sound there is nothing to transcribe: skip the paid call.
export const MIN_SOUND_FOR_WORDS_SEC = 1.0;

// How the voice moved → gesture words (never a quality judgement). The
// Loose plan (direct/sound.js) also turns them into colour character.
export function expressionFor(features, singing) {
  const cents = singing?.expression?.pitchRangeCents ?? (features?.pitch?.rangeSemitones != null ? features.pitch.rangeSemitones * 100 : null);
  const sounding = Math.max(0.5, features?.activity?.soundingSec ?? 0);
  const pauseRate = (features?.pauses?.count ?? 0) / sounding;
  const dyn = features?.energy?.dynamicRangeDb ?? singing?.expression?.dynamicRangeDb ?? null;
  const hz = features?.pitch?.medianHz ?? null, phrases = features?.phrases?.count ?? null, reg = features?.onsets?.regularityProxy ?? null;
  const cont = features?.pitch?.continuity ?? null;
  return {
    range: cents == null ? null : cents < 300 ? 'narrow' : cents < 900 ? 'moderate' : 'wide',
    flow: features?.activity ? (pauseRate > 0.25 ? 'broken' : 'connected') : null,
    dynamics: dyn == null ? null : dyn > 12 ? 'swelling' : 'even',
    vibrato: (singing?.expression?.vibratoShare ?? 0) >= 0.3,
    // For the Loose performance plan (direct/sound.js): the melody's shape,
    // the voice's register, how many phrases, how even the note onsets
    // were, and whether the pitch glides or steps.
    contour: singing?.expression?.contour ?? null,
    register: hz == null ? null : hz < 165 ? 'low' : hz < 300 ? 'mid' : 'high',
    phrasing: phrases == null ? null : phrases <= 1 ? 'single' : phrases <= 3 ? 'few' : 'many',
    rhythm: reg == null ? null : reg >= 0.6 ? 'regular' : 'irregular',
    line: cont == null ? null : cont >= 0.8 ? 'smooth' : 'stepped',
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
  const grounding = reliable && tier === 'gathered' ? groundGathered(lyrics.concepts?.gathered ?? '', transcript.text) : null;
  const text = grounding ? grounding.text : reliable ? lyrics.concepts?.[tier] : '';
  if (!reliable || !text) return { source: 'sound', concept: null, mood: null, motif: null, reason: transcript?.lexicalWords ? 'words not reliable enough to carry meaning' : 'no words' };
  return {
    source: 'lyrics',
    ...(grounding ? { grounding: { motifs: grounding.motifs, added: grounding.added } } : {}),
    concept: { text, theme: lyrics.theme ?? [], imagery: lyrics.imagery ?? [], figurative: lyrics.figurative ?? [],
      // Resolved only: the lyrics read as one story moment (direct: narrative section).
      ...(tier === 'resolved' && lyrics.scene?.moment ? { scene: lyrics.scene } : {}) },
    mood: lyrics.mood ?? null,
    motif: lyrics.motif ?? null,
    reason: 'coherent words',
  };
}

// Gathered grounded in the lyrics (Han, 21 Oct): when the words name
// concrete imagery (interpret/imagery.js), the Gathered concept must name at
// least one of those motifs. The reading's own Gathered concept is kept
// as it is whenever it already does (the usual case, so the prompt does not
// change); otherwise the one or two first-sung motifs are put in front of
// it, and an empty concept becomes just those motifs. Nothing is invented:
// only motifs sung in the transcript are named.
const MASS = new Set(['sunlight', 'stars', 'clouds', 'rain', 'snow', 'mist', 'flowers', 'trees', 'waves']);
const named = (m) => (MASS.has(m) ? m : `the ${m}`);
export function groundGathered(concept, transcriptText) {
  const sung = [...new Set(concreteImagery(transcriptText).map((f) => f.motif))];
  if (!sung.length) return null;
  const inConcept = new Set(concreteImagery(concept).map((f) => f.motif));
  const shared = sung.filter((m) => inConcept.has(m));
  if (shared.length) return { text: concept, motifs: shared, added: false };
  const motifs = sung.slice(0, 2);
  const lead = motifs.map(named).join(' and ');
  return { text: concept ? `${lead}; ${concept}` : lead, motifs, added: true };
}

// A failed measurement leaves the take on the existing direction.
function safeMeasure(samples, sampleRate) {
  try { return measurePerformance(samples, sampleRate); } catch { return null; }
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
  // The transcription request goes out first; the performance is measured
  // while it is in flight, so it adds no waiting when there are words.
  // A yield first lets the page paint between the two blocks of analysis.
  const pending = ask ? words() : null;
  pending?.catch(() => {}); // still awaited (and thrown) below
  if (samples) await new Promise((r) => setTimeout(r, 0));
  const performance = samples ? safeMeasure(samples, sampleRate) : null;
  const w = pending ? await pending : null;
  const transcript = w?.transcript ?? null, lyrics = w?.lyrics ?? null;
  const gate = completionGate({ transcript, lyrics, singing, features: feats });
  const floor = lyricalFloor({ gate, transcript, lyrics, singing, features: feats });
  const imagery = floor.applied ? null : imageryFloor({ gate, transcript, lyrics, singing });
  const decision = decideTier({ gate, quality: singing?.quality, floor, imagery });
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
    // Whether the sustained-lyrical-singing floor lifted a failed gate to Gathered, and why.
    lyricalFloor: floor,
    // Whether the concrete imagery floor lifted a failed gate to Gathered, and why.
    imageryFloor: imagery,
    tier, tierSource: forcedTier ? 'override' : 'decision',
    semantics,
    expression: expressionFor(feats, singing),
    // How it was sung, over time, for the art direction of every tier
    // (direct/performance.js); never part of the tier decision.
    performance,
    ms: Date.now() - t0,
  };
}

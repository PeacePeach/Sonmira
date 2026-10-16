// Real engine (Track B): analysis → interpretation → rendering, behind the
// shared contract in ../contract.js. Each stage is its own module and can be
// replaced on its own:
//   analysis/   signal measurements (level, pauses, pitch continuity)
//   interpret/  completeness, emotion, motif and the descriptive copy
//   render/     artwork choice and the watercolor wash

import { CONTRACT_VERSION, COMPLETENESS } from '../contract.js';
import { FrameAnalyzer, analyzeSamples, FEATURES_VERSION } from '../analysis/index.js';
import { interpret } from '../interpret/index.js';
import { render, createWashBuilder } from '../render/index.js';

export const ENGINE_ID = 'real-v1';
const TOO_SHORT_SEC = 1.5;

function flagsFor(features) {
  const silent = features.activity.soundingSec < 0.3 || features.level.peak < 0.05;
  return { silent, tooShort: features.durationSec < TOO_SHORT_SEC };
}

function createLiveSession({ sampleRate, seed } = {}) {
  const analyzer = new FrameAnalyzer(sampleRate);
  const nextStroke = createWashBuilder(seed ?? ((Math.random() * 2 ** 32) >>> 0));
  const wash = [];
  return {
    push(samples) {
      const { level, hue } = analyzer.addFrame(samples);
      const stroke = nextStroke(level, hue);
      if (stroke) wash.push(stroke);
      return { level, hue, stroke };
    },
    finish() {
      const features = analyzer.finish();
      return { durationSec: features.durationSec, flags: flagsFor(features), wash: wash.slice(), features };
    },
  };
}

// An analysis made by another engine (e.g. an entry saved with the mock)
// lacks our features; rebuild them from the recording when we can.
async function featuresFor(analysis, audioBlob) {
  const f = analysis?.features;
  if (f && f.version === FEATURES_VERSION && f.activity) return f;
  if (!audioBlob || typeof globalThis.OfflineAudioContext === 'undefined') return null;
  try {
    const buf = await audioBlob.arrayBuffer();
    const ctx = new globalThis.OfflineAudioContext(1, 1, 44100);
    const audio = await ctx.decodeAudioData(buf);
    return analyzeSamples(audio.getChannelData(0), audio.sampleRate);
  } catch {
    return null;
  }
}

export function createRealEngine() {
  return {
    id: ENGINE_ID,
    createLiveSession,
    async generate({ analysis, note = '', audioBlob = null, overrides = {} } = {}) {
      const features = await featuresFor(analysis, audioBlob);
      const silent = analysis?.flags?.silent ?? !features;
      const forced = COMPLETENESS.includes(overrides?.completeness) ? overrides.completeness : null;
      const it = interpret({
        features: silent ? null : features,
        note,
        overrides: { completeness: forced ?? (silent ? 'loose' : undefined) },
      });
      const { artwork, wash } = render({ interpretation: it, features, wash: analysis?.wash ?? [], note });
      const src = (s) => (s === 'override' ? 'default' : s);
      return {
        engineId: ENGINE_ID,
        contractVersion: CONTRACT_VERSION,
        completeness: it.completeness,
        emotion: { label: it.emotion, source: src(it.sources.emotion) },
        motif: { label: it.motif, source: src(it.sources.motif) },
        artwork,
        wash,
        interpretation: { voiceLabel: it.voiceLabel, summary: it.summary, dryingLine: it.dryingLine },
      };
    },
  };
}

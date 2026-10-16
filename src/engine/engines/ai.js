// AI engine: the recording is understood first, then painted on the server
// by the OpenAI reference-guided pipeline (/api/generate):
//
//   voice → pitch track + singing analysis           (here, in the browser)
//         → transcription + lyrics reading            (/api/understand)
//         → lyrical-completion gate → singing quality → tier
//         → the words' concept for that tier, the voice's gesture
//         → family → one primary reference from the private library
//         → OpenAI image edits with that reference   (/api/generate)
//         → the generated watercolour                (displayed)
//
// The live wash while recording is the real engine's. There is no fallback:
// if understanding or painting fails, generate() throws with a message the
// app shows, and nothing procedural or from a reference is substituted.

import { CONTRACT_VERSION, COMPLETENESS, MOTIFS } from '../contract.js';
import { createRealEngine } from './real.js';
import { planPainting } from '../plan.js';
import { understandTake } from '../understand.js';
import { tintWash, groundWash } from '../render/index.js';

// A fresh seed for every generation, so each painting makes its own
// independent choice of style family and reference (and the choices the
// seed drives inside the direction). The same take created again gets a new
// draw; a fixed seed is used only when one is given explicitly
// (overrides.seed, e.g. a deliberate regeneration).
export function randomSeed() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

export const ENGINE_ID = 'ai-openai-v2';
const ENDPOINT = '/api/generate';
const UNDERSTAND = '/api/understand';

export class GenerationError extends Error {
  constructor(message, detail = {}) { super(message); this.name = 'GenerationError'; Object.assign(this, detail); }
}

async function dataUrlToBlob(url) {
  return (await fetch(url)).blob();
}

// The recording as mono samples (browser decoder).
export async function decodeAudioBlob(blob) {
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('no audio decoder');
  const ab = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
  const out = new Float32Array(ab.length);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels; }
  return { samples: out, sampleRate: ab.sampleRate };
}

async function blobToBase64(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// Generous ceilings: transcription + reading, and one streamed image.
export const TIMEOUTS = { understand: 60_000, generate: 150_000 };

async function postJSON(fetchImpl, url, body, timeoutMs) {
  let res, json;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl && timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl?.signal });
    json = await res.json().catch(() => null);
  } catch (e) {
    if (ctl?.signal.aborted) throw new GenerationError('This is taking much longer than usual. Please try again.', { code: 'timeout', cause: e });
    throw new GenerationError('Couldn’t reach the painting service. Check your connection and try again.', { code: 'network', cause: e });
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { res, json };
}

// Let the browser paint the loading state before synchronous analysis.
const nextFrame = () => new Promise((r) => setTimeout(r, 32));

export function createAIEngine({ fetchImpl = (...a) => globalThis.fetch(...a), decode = decodeAudioBlob, timeouts = TIMEOUTS } = {}) {
  const real = createRealEngine();

  // Everything before the image: returns the understanding (diagnostics).
  async function understand({ analysis, audioBlob, forcedTier }) {
    await nextFrame();
    let audio = null;
    if (audioBlob && !analysis?.flags?.silent) {
      try { audio = await decode(audioBlob); } catch (e) {
        throw new GenerationError('This recording couldn’t be read. Please sing again.', { code: 'audio_decode', cause: e });
      }
    }
    const words = audioBlob ? async () => {
      const { res, json } = await postJSON(fetchImpl, UNDERSTAND, { audio: await blobToBase64(audioBlob), mime: audioBlob.type || 'audio/webm' }, timeouts.understand);
      if (!res.ok || !json?.ok) {
        const code = json?.code || `http_${res.status}`;
        throw new GenerationError(code === 'not_configured' ? 'The painting service isn’t set up on this server yet.' : 'Couldn’t listen to the words this time. Please try again.', { code, status: res.status, detail: json?.error });
      }
      return json;
    } : null;
    return understandTake({ samples: audio?.samples ?? null, sampleRate: audio?.sampleRate ?? 0, features: analysis?.flags?.silent ? null : analysis?.features ?? null, words, forcedTier });
  }

  return {
    id: ENGINE_ID,
    // Each generate() is one paid image generation on the server (plus one
    // transcription and one short text-model call).
    paid: true,
    createLiveSession: real.createLiveSession,
    understand,
    // onStage(stage, info): the real processing steps, for the loading screen.
    //   'listening' {words}  decoding, voice analysis, transcription and reading
    //   'feeling'   {tier}   understanding done: tier, concept and spec decided
    //   'painting'           the image request is in flight
    async generate({ analysis, note = '', audioBlob = null, overrides = {}, onStage = () => {} } = {}) {
      const stage = (...a) => { try { onStage(...a); } catch { /* display only */ } };
      stage('listening', { words: Boolean(audioBlob) });
      const features = analysis?.features ?? null;
      const silent = analysis?.flags?.silent ?? !features;
      const forced = COMPLETENESS.includes(overrides?.completeness) ? overrides.completeness : null;
      let u;
      try { u = await understand({ analysis, audioBlob, forcedTier: forced }); } catch (e) {
        if (e instanceof GenerationError) throw e;
        throw new GenerationError('Couldn’t listen to this recording. Please try again.', { code: 'understand', cause: e });
      }
      const sem = u.semantics;
      // What is depicted: the words when they are reliable, else the
      // person's own note; the reference never supplies a subject.
      const noteText = String(note ?? '').trim();
      const concept = sem.concept ? { ...sem.concept, source: 'lyrics' } : noteText ? { text: noteText, theme: [], imagery: [], figurative: [], source: 'note' } : null;
      const plan = planPainting({
        features: silent ? null : features,
        noteText: note,
        vocalControlOverride: u.tier,
        emotionOverride: sem.mood ?? undefined,
        motifOverride: sem.motif ?? undefined,
        allowedMotifs: MOTIFS,
        seed: Number.isInteger(overrides?.seed) ? overrides.seed >>> 0 : randomSeed(),
      });
      const { spec, interpretation: it } = plan;
      const body = { spec: {
        completeness: spec.completeness, emotion: spec.emotion, motif: spec.motif, seed: spec.seed, energy: spec.energy, family: spec.family,
        concept, soundOnly: !concept && spec.completeness === 'loose', expression: u.expression,
      } };
      const understanding = { ...u, emotion: { value: it.emotion, source: sem.mood ? 'lyrics' : it.sources.emotion }, motif: { value: it.motif, source: sem.motif ? 'lyrics' : it.sources.motif }, plannedFamily: plan.direction.family };
      stage('feeling', { tier: u.tier });
      if (overrides?.analyzeOnly) {
        throw new GenerationError('Analysis only: no painting was made (dev).', { code: 'analyze_only', understanding });
      }

      stage('painting');
      const { res, json } = await postJSON(fetchImpl, ENDPOINT, body, timeouts.generate);
      if (!res.ok || !json?.ok || !json.image) {
        const code = json?.code || `http_${res.status}`;
        const message = code === 'not_configured' ? 'The painting service isn’t set up on this server yet.'
          : code === 'no_reference' || code === 'reference_store' ? 'The reference library isn’t available on this server right now.'
          : 'The painting couldn’t be made this time. Please try again.';
        throw new GenerationError(message, { code, status: res.status, detail: json?.error, understanding });
      }

      const blob = await dataUrlToBlob(json.image);
      const wash = (analysis?.wash ?? []).length > 1 ? tintWash(analysis.wash, it.emotion) : groundWash(it.emotion, spec.seed);
      const src = (s) => (s === 'override' ? 'default' : s);
      return {
        engineId: ENGINE_ID,
        contractVersion: CONTRACT_VERSION,
        completeness: it.completeness,
        emotion: { label: it.emotion, source: src(it.sources.emotion) },
        motif: { label: it.motif, source: src(it.sources.motif) },
        artwork: { kind: 'image', blob },
        wash,
        interpretation: { voiceLabel: it.voiceLabel, summary: it.summary, dryingLine: it.dryingLine },
        // How the painting was made (dev diagnostics; ignored by the app).
        generation: {
          provider: json.provider, model: json.model, quality: json.quality, size: json.size, ms: json.ms,
          family: json.family, familyLabel: json.familyLabel, reference: json.reference, referenceSent: json.referenceSent,
          libraryVersion: json.libraryVersion, seed: json.seed, tier: it.completeness, emotion: it.emotion, motif: it.motif,
          subjectSource: json.subjectSource ?? null,
          understanding,
        },
      };
    },
  };
}

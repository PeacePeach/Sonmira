// AI engine: the real audio analysis and interpretation, then the painting is
// made on the server by the OpenAI reference-guided pipeline (/api/generate):
//
//   voice → analysis → interpretation → visual spec  (here, in the browser)
//         → family → one primary reference from the private library
//         → OpenAI image edits with that reference   (server)
//         → the generated watercolour                (displayed)
//
// The live wash while recording is the real engine's. There is no fallback:
// if the server cannot make the painting, generate() throws with a message
// the app shows, and nothing procedural or from a reference is substituted.

import { CONTRACT_VERSION, COMPLETENESS, MOTIFS } from '../contract.js';
import { createRealEngine } from './real.js';
import { planPainting } from '../plan.js';
import { tintWash, groundWash } from '../render/index.js';

export const ENGINE_ID = 'ai-openai-v1';
const ENDPOINT = '/api/generate';

export class GenerationError extends Error {
  constructor(message, detail = {}) { super(message); this.name = 'GenerationError'; Object.assign(this, detail); }
}

async function dataUrlToBlob(url) {
  return (await fetch(url)).blob();
}

export function createAIEngine({ fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  const real = createRealEngine();
  return {
    id: ENGINE_ID,
    // Each generate() is one paid image generation on the server.
    paid: true,
    createLiveSession: real.createLiveSession,
    async generate({ analysis, note = '', overrides = {} } = {}) {
      const features = analysis?.features ?? null;
      const silent = analysis?.flags?.silent ?? !features;
      const forced = COMPLETENESS.includes(overrides?.completeness) ? overrides.completeness : null;
      const plan = planPainting({
        features: silent ? null : features,
        noteText: note,
        vocalControlOverride: forced ?? (silent ? 'loose' : undefined),
        allowedMotifs: MOTIFS,
      });
      const { spec, interpretation: it } = plan;
      const body = { spec: { completeness: spec.completeness, emotion: spec.emotion, motif: spec.motif, seed: spec.seed, energy: spec.energy, family: spec.family } };

      let res, json;
      try {
        res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        json = await res.json().catch(() => null);
      } catch (e) {
        throw new GenerationError('Couldn’t reach the painting service. Check your connection and try again.', { code: 'network', cause: e });
      }
      if (!res.ok || !json?.ok || !json.image) {
        const code = json?.code || `http_${res.status}`;
        const message = code === 'not_configured' ? 'The painting service isn’t set up on this server yet.'
          : code === 'no_reference' || code === 'reference_store' ? 'The reference library isn’t available on this server right now.'
          : 'The painting couldn’t be made this time. Please try again.';
        throw new GenerationError(message, { code, status: res.status, detail: json?.error });
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
          controlScore: features && !silent ? it.controlScore : null,
        },
      };
    },
  };
}

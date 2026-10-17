// Vercel Serverless Function: server-side image generation for the
// Playground preview. Keeps provider keys out of the browser.
//
//   GET  /api/generate              → which providers are configured
//   POST /api/generate { spec, provider? }
//        → { ok, provider, model, image: data URL, prompt, ms } | { ok:false, error }
//
// The browser sends the visual spec (layer B); the prompt is built here from
// it by the provider-independent art direction (layer C).

import { direct, FAMILIES, checkPrompt } from '../src/engine/direct/index.js';
import { generateFromDirection, openaiConfig } from '../src/engine/providers/openai.js';
import { referenceStoreFromEnv, libraryFor } from '../src/engine/providers/reference-store.js';
import { REFERENCE_LIBRARY } from '../src/engine/direct/references.js';
import { protect, timedFetch } from '../server/protect/index.js';
import { wiring } from '../server/wire.js';
import { fakeProviderOn, fakeOpenAIFetch, fakeReferenceStore } from '../server/dev/fake-openai.js';

// References come from private Vercel Blob in production (registry and
// images), or SONMIRA_REFS_DIR locally. The selected primary reference's
// bytes are read here and sent with the prompt (edits endpoint, streamed).
// Without a store or an eligible reference the request fails with
// no_reference: there is no silent text-only fallback. Nothing about the
// store reaches the client beyond the reference id.
// createHandler takes its dependencies so tests can run it with mocks.

const LEVELS = ['loose', 'gathered', 'resolved'];
const EMOTIONS = ['tender', 'bright', 'melancholic', 'intense'];
const MOTIFS = ['water', 'sky', 'garden', 'landscape', 'interior', 'abstract'];

function cleanSpec(s) {
  if (!s || !LEVELS.includes(s.completeness) || !EMOTIONS.includes(s.emotion) || !MOTIFS.includes(s.motif)) return null;
  const energy = ['calm', 'moderate', 'lively'].includes(s.energy?.value) ? s.energy.value : 'calm';
  const out = { completeness: s.completeness, emotion: s.emotion, motif: s.motif, seed: Number(s.seed) >>> 0, energy: { value: energy } };
  if (Object.hasOwn(FAMILIES, s.family)) out.family = s.family;
  // A developer may pin one reference (Playground); direct() uses it only
  // when it is active and belongs to the family.
  if (out.family && typeof s.reference === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.reference)) out.reference = s.reference;
  const c = cleanConcept(s.concept);
  if (c) out.concept = c;
  else if (s.completeness === 'loose' && s.soundOnly === true) out.soundOnly = true;
  const x = s.expression;
  if (x && typeof x === 'object') {
    out.expression = {
      range: ['narrow', 'moderate', 'wide'].includes(x.range) ? x.range : null,
      flow: ['connected', 'broken'].includes(x.flow) ? x.flow : null,
      dynamics: ['even', 'swelling'].includes(x.dynamics) ? x.dynamics : null,
      vibrato: x.vibrato === true,
    };
  }
  return out;
}

// The words' concept goes into the prompt, so it is bounded and flattened.
const flat = (v, n) => String(v ?? '').replace(/[\u0000-\u001f"`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function cleanConcept(c) {
  if (!c || typeof c !== 'object' || !flat(c.text, 240)) return null;
  const list = (xs, k, n) => (Array.isArray(xs) ? xs : []).map((x) => flat(x, n)).filter(Boolean).slice(0, k);
  return {
    source: c.source === 'note' ? 'note' : 'lyrics',
    text: flat(c.text, 240), theme: list(c.theme, 3, 60), imagery: list(c.imagery, 5, 60),
    figurative: (Array.isArray(c.figurative) ? c.figurative : []).slice(0, 4).map((f) => ({ phrase: flat(f?.phrase, 80), meaning: flat(f?.meaning, 120) })).filter((f) => f.phrase && f.meaning),
  };
}

export const createHandler = ({ store = referenceStoreFromEnv(), env = process.env, fetchImpl = fetch } = {}) => async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method === 'GET') {
    const o = openaiConfig(env);
    res.status(200).json({ providers: { openai: { configured: o.configured, model: o.model, quality: o.quality, size: o.size } }, references: store?.kind ?? 'none' });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only' }); return; }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const spec = cleanSpec(body.spec);
  if (!spec) { res.status(400).json({ ok: false, error: 'invalid spec' }); return; }
  if ((body.provider || 'openai') !== 'openai') { res.status(400).json({ ok: false, error: 'unknown provider' }); return; }
  try {
    // References are selected from the bundled, version-controlled registry
    // (direct/references.js: tested, shipped and rolled back with the deploy)
    // plus any new image uploaded to a family in the store (libraryFor). The
    // store's own registry.json is never read here.
    const library = await libraryFor(store);
    const direction = direct({ ...spec, library });
    // The decided tier is authoritative: never paint a family of another tier.
    if (FAMILIES[direction.family].tier !== spec.completeness) {
      res.status(409).json({ ok: false, error: `family ${direction.family} is not a ${spec.completeness} family`, code: 'tier_mismatch' });
      return;
    }
    if (!store || !direction.reference) {
      res.status(503).json({ ok: false, error: store ? `no active reference for ${direction.family}` : 'no reference store configured', code: 'no_reference' });
      return;
    }
    const g = await generateFromDirection(direction, { loadReference: store?.loadImage, stream: true, env, fetchImpl });
    res.status(200).json({ ok: true, provider: g.provider, model: g.model, quality: g.quality, size: g.size, ms: g.ms, usage: g.usage, prompt: direction.prompt, family: direction.family, familyLabel: direction.familyLabel, familyRefs: direction.refs, subjectSource: direction.subjectSource, subject: direction.subject, reference: direction.reference?.id ?? null, composition: direction.composition, settings: { tier: direction.level, emotion: spec.emotion, motif: spec.motif, energy: spec.energy.value, expression: spec.expression ?? null }, promptCheck: checkPrompt(direction, { library }), referenceSent: Boolean(g.reference), seed: direction.seed, libraryVersion: direction.libraryVersion, swatches: direction.swatches, image: `data:${g.mime};base64,${g.b64}` });
  } catch (e) {
    // A reference image missing or unreadable in the store happens before any
    // provider call: 503 no_reference, like a missing store.
    if (e.code === 'reference_missing' || e.code === 'reference_store') { res.status(503).json({ ok: false, error: 'reference image unavailable', code: e.code === 'reference_store' ? 'reference_store' : 'no_reference' }); return; }
    res.status(e.code === 'not_configured' ? 503 : 502).json({ ok: false, error: e.message, code: e.code || 'error' });
  }
};

// Guarded (invitation, limits, daily spend cap, idempotency: server/protect)
// and counted on the install's paintings ledger (server/wire.js), with the
// provider call bounded under the function's 120 s. A Preview with
// SONMIRA_FAKE_PROVIDER=1 paints with the offline renderer instead: no cost.
const fake = fakeProviderOn() ? fakeOpenAIFetch({ delayMs: Number(process.env.SONMIRA_FAKE_DELAY_MS ?? 4000) }) : null;
export default protect('generate', createHandler(fake
  ? { fetchImpl: fake, env: { ...process.env, OPENAI_API_KEY: 'fake' }, store: fakeReferenceStore(REFERENCE_LIBRARY) }
  : { fetchImpl: timedFetch(100_000) }), wiring().guard());

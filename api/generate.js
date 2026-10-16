// Vercel Serverless Function: server-side image generation for the
// Playground preview. Keeps provider keys out of the browser.
//
//   GET  /api/generate              → which providers are configured
//   POST /api/generate { spec, provider? }
//        → { ok, provider, model, image: data URL, prompt, ms } | { ok:false, error }
//
// The browser sends the visual spec (layer B); the prompt is built here from
// it by the provider-independent art direction (layer C).

import { direct, FAMILIES } from '../src/engine/direct/index.js';
import { generateOpenAI, openaiConfig } from '../src/engine/providers/openai.js';

const LEVELS = ['loose', 'gathered', 'resolved'];
const EMOTIONS = ['tender', 'bright', 'melancholic', 'intense'];
const MOTIFS = ['water', 'sky', 'garden', 'landscape', 'interior', 'abstract'];

function cleanSpec(s) {
  if (!s || !LEVELS.includes(s.completeness) || !EMOTIONS.includes(s.emotion) || !MOTIFS.includes(s.motif)) return null;
  const energy = ['calm', 'moderate', 'lively'].includes(s.energy?.value) ? s.energy.value : 'calm';
  const out = { completeness: s.completeness, emotion: s.emotion, motif: s.motif, seed: Number(s.seed) >>> 0, energy: { value: energy } };
  if (Object.hasOwn(FAMILIES, s.family)) out.family = s.family;
  return out;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method === 'GET') {
    const o = openaiConfig();
    res.status(200).json({ providers: { openai: { configured: o.configured, model: o.model, quality: o.quality, size: o.size } } });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only' }); return; }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const spec = cleanSpec(body.spec);
  if (!spec) { res.status(400).json({ ok: false, error: 'invalid spec' }); return; }
  if ((body.provider || 'openai') !== 'openai') { res.status(400).json({ ok: false, error: 'unknown provider' }); return; }
  const direction = direct(spec);
  try {
    const g = await generateOpenAI(direction);
    res.status(200).json({ ok: true, provider: g.provider, model: g.model, quality: g.quality, size: g.size, ms: g.ms, usage: g.usage, prompt: direction.prompt, family: direction.family, familyLabel: direction.familyLabel, image: `data:${g.mime};base64,${g.b64}` });
  } catch (e) {
    res.status(e.code === 'not_configured' ? 503 : 502).json({ ok: false, error: e.message, code: e.code || 'error' });
  }
}

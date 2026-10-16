// OpenAI image provider (layer D). SERVER ONLY: reads the API key from the
// environment and must never be bundled into the browser or the iOS app.
//
// Configuration (environment variables):
//   OPENAI_API_KEY        required
//   OPENAI_IMAGE_MODEL    default 'gpt-image-2'
//   OPENAI_IMAGE_QUALITY  default 'medium' (low | medium | high)
//   OPENAI_IMAGE_SIZE     default '1024x1536' (portrait)
// Output is JPEG so a response stays well under Vercel's 4.5 MB body limit.

export const PROVIDER_ID = 'openai';

export function openaiConfig(env = process.env) {
  return {
    configured: Boolean(env.OPENAI_API_KEY),
    model: env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    quality: env.OPENAI_IMAGE_QUALITY || 'medium',
    size: env.OPENAI_IMAGE_SIZE || '1024x1536',
  };
}

// Prompt adapter: this model takes one prompt, so the direction's sections
// are sent as written, avoid list included.
export const adaptPrompt = (direction) => direction.prompt;

export async function generateOpenAI(direction, { env = process.env, fetchImpl = fetch } = {}) {
  const cfg = openaiConfig(env);
  if (!cfg.configured) throw Object.assign(new Error('OPENAI_API_KEY is not set'), { code: 'not_configured' });
  const t0 = Date.now();
  const res = await fetchImpl('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: cfg.model, prompt: adaptPrompt(direction), size: cfg.size, quality: cfg.quality, output_format: 'jpeg', output_compression: 90, n: 1 }),
  });
  return readImage(res, cfg, t0);
}

// Reference-guided generation through the image edits endpoint: the family's
// reference images go in as visual input next to the prompt.
//   images: [{ name, bytes, mime }]   prompt: the full text prompt
export async function editOpenAI(prompt, images, { env = process.env, fetchImpl = fetch } = {}) {
  const cfg = openaiConfig(env);
  if (!cfg.configured) throw Object.assign(new Error('OPENAI_API_KEY is not set'), { code: 'not_configured' });
  if (!images?.length) throw Object.assign(new Error('no reference images'), { code: 'no_references' });
  const form = new FormData();
  for (const [k, v] of Object.entries({ model: cfg.model, prompt, size: cfg.size, quality: cfg.quality, output_format: 'jpeg', output_compression: '90', n: '1' })) form.append(k, v);
  if (env.OPENAI_IMAGE_INPUT_FIDELITY) form.append('input_fidelity', env.OPENAI_IMAGE_INPUT_FIDELITY);
  for (const im of images) form.append('image[]', new Blob([im.bytes], { type: im.mime }), im.name);
  const t0 = Date.now();
  const res = await fetchImpl('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form,
  });
  return readImage(res, cfg, t0);
}

async function readImage(res, cfg, t0) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.message || `OpenAI returned ${res.status}`), { code: 'provider_error', status: res.status });
  }
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw Object.assign(new Error('OpenAI returned no image'), { code: 'provider_error' });
  return {
    provider: PROVIDER_ID, model: cfg.model, quality: cfg.quality, size: cfg.size,
    mime: 'image/jpeg', b64, ms: Date.now() - t0, usage: body.usage ?? null,
  };
}

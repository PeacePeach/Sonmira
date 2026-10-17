// A stand-in for the OpenAI API, for tests and for a Preview that must not
// spend money. It answers the requests the providers make
// (src/engine/providers/openai*.js), so the whole pipeline runs (guard,
// handler, art direction, reference selection) and only the paid calls are
// replaced:
//
//   /audio/transcriptions   no words (a hum), so the text model is skipped
//   /chat/completions       not expected; answers 500 so it would show up
//   /images/edits (stream)  a procedural watercolour from the offline painter
//   /images/generations     the same, as JSON
//
// Turned on as server/dev/mode.js says; never in Production. The image is
// clearly not a real generation: it is the offline renderer's work, seeded by
// the prompt, so two takes differ.

import { paintScene } from '../../src/engine/paint/painter.js';
import { encodePNG } from '../../src/engine/paint/png.js';

export { fakeProviderOn } from './mode.js';

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MOTIFS = ['water', 'sky', 'garden', 'landscape', 'abstract'];
const EMOTIONS = ['tender', 'bright', 'melancholic', 'intense'];

async function paint(prompt) {
  const seed = hash(String(prompt ?? ''));
  const img = paintScene({ motif: MOTIFS[seed % MOTIFS.length], emotion: EMOTIONS[(seed >>> 3) % EMOTIONS.length], control: ((seed >>> 6) % 100) / 100, seed, width: 512, height: 768 });
  return Buffer.from(await encodePNG(img)).toString('base64');
}

/** @returns {typeof fetch & { calls: Record<string, number> }} */
export function fakeOpenAIFetch({ delayMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const calls = { transcribe: 0, text: 0, image: 0 };
  const fake = async (url, init = {}) => {
    const path = new URL(String(url)).pathname.replace(/^\/v1/, '');
    if (delayMs) await sleep(delayMs);
    if (init.signal?.aborted) throw init.signal.reason ?? new Error('aborted');
    if (path === '/audio/transcriptions') {
      calls.transcribe += 1;
      return json(200, { text: '', logprobs: [], usage: { type: 'fake' } });
    }
    if (path === '/images/edits' || path === '/images/generations') {
      calls.image += 1;
      const prompt = init.body instanceof FormData ? init.body.get('prompt') : JSON.parse(init.body || '{}').prompt;
      const stream = init.body instanceof FormData && init.body.get('stream') === 'true';
      const b64 = await paint(prompt);
      const usage = { fake: true, total_tokens: 0 };
      if (!stream) return json(200, { data: [{ b64_json: b64 }], usage });
      return new Response(`data: ${JSON.stringify({ type: 'image_edit.completed', b64_json: b64, usage })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    if (path === '/chat/completions') calls.text += 1;
    return json(500, { error: { message: `fake provider: ${path} is not mocked` } });
  };
  fake.calls = calls;
  return fake;
}

// The bundled registry with placeholder bytes, so reference selection runs
// without the private reference images.
export function fakeReferenceStore(registry) {
  return {
    kind: 'fake',
    loadRegistry: async () => registry,
    loadImage: async (ref) => ({ name: `${ref.id}.png`, mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }),
  };
}

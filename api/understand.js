// Vercel Serverless Function: what the recording's words say.
//
//   POST /api/understand { audio: base64, mime }
//     → { ok, transcript: { text, lexicalWords, asrConfidence, … , model, ms },
//         lyrics: reading | null, ms }
//     | { ok:false, code, error }
//
// The browser measures the singing itself and makes the tier decision
// (interpret/lyrics.js); this only transcribes and reads the words, because
// those need the OpenAI key. The language model is asked only when the
// transcript has real words, so a hum costs one transcription. No audio or
// text is stored.

import { transcribeAudio, interpretLyrics, understandConfig, audioExtension } from '../src/engine/providers/openai-understand.js';
import { analyzeTranscript } from '../src/engine/interpret/lyrics.js';

const MAX_BASE64 = 4_000_000; // under Vercel's 4.5 MB request limit (~45 s of compressed audio)

export const createHandler = ({ env = process.env, fetchImpl = fetch } = {}) => async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method === 'GET') {
    const c = understandConfig(env);
    res.status(200).json({ configured: c.configured, transcribeModel: c.transcribeModel, textModel: c.textModel });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method', error: 'POST only' }); return; }
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { body = {}; }
  const { audio, mime } = body;
  if (typeof audio !== 'string' || !audio || audio.length > MAX_BASE64 || !audioExtension(mime)) {
    res.status(400).json({ ok: false, code: 'bad_audio', error: 'audio (base64) with a supported mime type is required' });
    return;
  }
  const t0 = Date.now();
  try {
    const asr = await transcribeAudio(Buffer.from(audio, 'base64'), mime, { env, fetchImpl });
    const transcript = { ...analyzeTranscript(asr.text, { logprobs: asr.logprobs }), model: asr.model, ms: asr.ms };
    const lyrics = transcript.lexicalWords > 0 ? await interpretLyrics(transcript.text, { env, fetchImpl }) : null;
    res.status(200).json({ ok: true, transcript, lyrics, ms: Date.now() - t0 });
  } catch (e) {
    res.status(e.code === 'not_configured' ? 503 : e.code === 'bad_audio' ? 400 : 502).json({ ok: false, code: e.code || 'error', error: e.code === 'not_configured' ? 'not configured' : String(e.message).slice(0, 200) });
  }
};

export default createHandler();

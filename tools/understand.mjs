// Run the V2 decision pipeline on a real recording, without making an image:
// pitch track → singing analysis → transcription → lyrics reading → gate →
// tier → semantics, printed as JSON. Use it to validate on real voices and to
// calibrate thresholds before any paid painting.
//
//   node --env-file=.env.local tools/understand.mjs <recording> [--no-words] [--mime TYPE]
//
// <recording> is a WAV (decoded here) or any file ffmpeg can read (m4a, webm,
// mp3…; converted to WAV for the signal analysis, sent as-is for
// transcription). --no-words skips the OpenAI calls (signal analysis only).
// The OpenAI calls cost about $0.003 for a 15 s take; no image is made.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';
import { decodeWav } from '../src/engine/analysis/wav.js';
import { understandTake } from '../src/engine/understand.js';
import { transcribeAudio, interpretLyrics } from '../src/engine/providers/openai-understand.js';
import { analyzeTranscript } from '../src/engine/interpret/lyrics.js';

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, k === '--mime' ? 2 : 1)[1] ?? true : null; };
const noWords = flag('--no-words'), mimeArg = flag('--mime');
const [file] = args;
if (!file) { console.error('usage: tools/understand.mjs <recording> [--no-words] [--mime TYPE]'); process.exit(2); }

const MIME = { '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
const mime = typeof mimeArg === 'string' ? mimeArg : MIME[extname(file).toLowerCase()];
const bytes = readFileSync(file);
const wav = mime === 'audio/wav' ? bytes : execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '22050', '-f', 'wav', '-'], { maxBuffer: 1 << 28 });
const { samples, sampleRate } = decodeWav(wav);

if (!noWords && !process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY is not set (use --env-file, or --no-words). Never commit it.'); process.exit(2); }
const words = noWords ? null : async () => {
  const asr = await transcribeAudio(bytes, mime);
  const transcript = { ...analyzeTranscript(asr.text, { logprobs: asr.logprobs }), model: asr.model, ms: asr.ms };
  const lyrics = transcript.lexicalWords > 0 ? await interpretLyrics(transcript.text) : null;
  return { transcript, lyrics };
};
const u = await understandTake({ samples, sampleRate, words });
const brief = { tier: u.tier, reason: u.decision.reason, gateFailed: u.gate.failed, transcript: u.transcript?.text ?? null, asrConfidence: u.transcript?.asrConfidence ?? null,
  singing: { sung: u.singing.vocal.sung, score: u.singing.quality.score, confidence: u.singing.quality.confidence, strong: u.singing.quality.strong },
  concept: u.semantics.concept?.text ?? null, mood: u.semantics.mood, motif: u.semantics.motif, expression: u.expression };
console.log(JSON.stringify(process.env.VERBOSE ? u : brief, null, 2));

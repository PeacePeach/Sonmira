// Reliable lyrics = minimum Gathered (Han, 22 Oct, Beta 46.mp4 and 13.mp4):
//   "If Sonmira understands what the user sang, that meaning must enter the
//   painting. Words decide whether meaning enters the image. Performance
//   decides how fully that meaning is resolved."
//   1. Quiet but legitimate singing is listened to (transcribed): low
//      absolute volume no longer means "do not listen"; silence and steady
//      noise still skip the call.
//   2. Reliable, meaningful lyrics are at least Gathered, however they were
//      sung (quiet, slow, weak, unfinished, stopped mid-line, odd word rate).
//   3. Gathered shows the words' meaning: a sung motif when there is one, a
//      visual equivalent when the words are abstract.
//   4. Loose stays for humming, vocables, silence, noise, unreliable or
//      nonsensical transcripts, and speech; Resolved is unchanged.
// The transcript and the reading are GIVEN (no paid call); the audio is
// synthetic (synth.js), levels matched to the two Beta recordings (46: frame
// median −46.7 dBFS over a −72 dBFS floor; 13: −41.7 dBFS). The recordings
// themselves are not committed (the repository is public).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singers, sungLyrics, spokenLyrics, voice, silence, SR } from './synth.js';
import { analyzeSamples } from '../../src/engine/analysis/features.js';
import { analyzeTranscript, completionGate, wordsFloor, decideTier } from '../../src/engine/interpret/lyrics.js';
import { understandTake, semanticsFor, audibleSec, MIN_SOUND_FOR_WORDS_SEC } from '../../src/engine/understand.js';
import { cleanReading } from '../../src/engine/providers/openai-understand.js';
import { createAIEngine } from '../../src/engine/engines/ai.js';
import { createRealEngine } from '../../src/engine/engines/real.js';
import { direct, GATHERED_MOTIF } from '../../src/engine/direct/index.js';

const tokens = (text) => (/[一-鿿]/.test(text) ? [...text.replace(/\s/g, '')] : text.split(/\s+/));
const transcriptOf = (text, p = 0.85) => analyzeTranscript(text, { logprobs: tokens(text).map((token) => ({ token, logprob: Math.log(p) })) });
const reading = (o = {}) => cleanReading({
  language: 'zh', lexical: true, coherent: true, structure: 'fragment', unfinished: true, linked: false, missing: 'the rest of the line',
  phraseComplete: false, completionConfidence: 0.5, completionReason: 'cut mid-line',
  theme: ['longing'], imagery: [], sungImagery: [], figurative: [], mood: 'melancholic', motif: 'abstract',
  concepts: { loose: 'slow marks sinking', gathered: 'a lamp left on in an empty room at night', resolved: 'an empty room at night, one lamp still on by the window' }, ...o,
});
const run = (samples, words) => understandTake({ samples, sampleRate: SR, words: words ? async () => words : null });

const ABSTRACT = '我想你 想你在每一个夜里';
const MOON = '月亮照着海 我在等你回来';
const MOON_IMAGERY = [{ motif: 'moon', quote: '月亮' }, { motif: 'sea', quote: '海' }];
const moonReading = () => reading({ imagery: ['moon', 'sea'], sungImagery: MOON_IMAGERY, motif: 'water', mood: 'tender', concepts: { loose: 'x', gathered: 'the moon over a dark sea', resolved: 'y' } });

// Beta-like takes: 46 (quiet, a quiet room) and 13 (low, at the old floor).
const quiet46 = () => sungLyrics({ amp: 0.012, noise: 0.0004 });
const low13 = () => sungLyrics({ amp: 0.02, noise: 0.0004 });

// ── 1. quiet singing is listened to ───────────────────────────────────────

test('regression 46.mp4: quiet singing measured as 0 s of sound before, is now transcribed', async () => {
  const x = quiet46();
  const f = analyzeSamples(x, SR);
  assert.equal(f.activity.soundingSec, 0, 'the absolute floor hears nothing (the old reason it was skipped)');
  assert.ok(audibleSec(x, SR) >= MIN_SOUND_FOR_WORDS_SEC);
  let asked = 0;
  const u = await understandTake({ samples: x, sampleRate: SR, words: async () => { asked++; return { transcript: transcriptOf(ABSTRACT), lyrics: reading() }; } });
  assert.equal(asked, 1);
  assert.equal(u.wordsRequested, true);
  assert.equal(u.tier, 'gathered', u.decision.reason);
  assert.equal(u.decision.stage, 'words_floor');
});

test('regression 46.mp4 through the app engine: a take the live analysis flags "silent" is still decoded and listened to', async () => {
  const x = quiet46();
  const live = createRealEngine().createLiveSession({ sampleRate: SR });
  for (let end = 1600; end <= x.length; end += 1600) live.push(x.subarray(Math.max(0, end - 2048), end));
  const analysis = live.finish();
  assert.equal(analysis.flags.silent, true, 'the live flag is absolute: a quiet singer is "silent"');
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ ok: true, transcript: transcriptOf(MOON), lyrics: moonReading() }) }; };
  const engine = createAIEngine({ fetchImpl, decode: async () => ({ samples: x, sampleRate: SR }), toWordsAudio: async (b) => b });
  const e = await engine.generate({ analysis, audioBlob: new Blob([new Uint8Array(8)], { type: 'audio/wav' }), overrides: { analyzeOnly: true } }).catch((err) => err);
  assert.equal(e.code, 'analyze_only');
  assert.deepEqual(calls, ['/api/understand']);
  assert.equal(e.understanding.tier, 'gathered');
  assert.match(e.understanding.semantics.concept.text, /moon/);
});

test('real silence and steady room noise still skip the transcription', async () => {
  for (const [name, x] of [['digital silence', new Float32Array(SR * 6)], ['room noise', voice([silence(6)], { noise: 0.0004 })], ['louder room noise', voice([silence(6)])]]) {
    assert.ok(audibleSec(x, SR) < MIN_SOUND_FOR_WORDS_SEC, name);
    let asked = 0;
    const u = await understandTake({ samples: x, sampleRate: SR, words: async () => { asked++; return null; } });
    assert.equal(asked, 0, name);
    assert.equal(u.tier, 'loose', name);
  }
  // Through the app engine, a silent take keeps its old path (no call, no decode result used).
  const calls = [];
  const engine = createAIEngine({ fetchImpl: async (url) => { calls.push(url); return { ok: false, status: 500, json: async () => ({ ok: false }) }; }, decode: async () => ({ samples: new Float32Array(SR * 4), sampleRate: SR }) });
  const e = await engine.generate({ analysis: { durationSec: 4, flags: { silent: true, tooShort: false }, wash: [] }, audioBlob: new Blob([new Uint8Array(8)]), overrides: { analyzeOnly: true } }).catch((err) => err);
  assert.equal(e.code, 'analyze_only');
  assert.deepEqual(calls, []);
  assert.equal(e.understanding.tier, 'loose');
  assert.equal(e.understanding.performance, null, 'silent takes keep no performance, as before');
});

test('the recording is never changed by listening', async () => {
  const x = quiet46(), copy = x.slice();
  await run(x, { transcript: transcriptOf(ABSTRACT), lyrics: reading() });
  assert.deepEqual(x, copy);
});

// ── 2. reliable meaningful lyrics → minimum Gathered ──────────────────────

test('regression 13.mp4: low-volume singing with reliable lyrics is not Loose', async () => {
  const u = await run(low13(), { transcript: transcriptOf(ABSTRACT), lyrics: reading() });
  assert.equal(u.wordsRequested, true);
  assert.equal(u.tier, 'gathered', u.decision.reason);
});

test('reliable lyrics are at least Gathered: incomplete, weak, slow, quiet, stopped mid-line', async () => {
  const takes = {
    weak: singers.weak(),
    slow: sungLyrics({ syl: [1.4, 2.0] }),
    slowAndQuiet: sungLyrics({ syl: [1.4, 2.0], amp: 0.012, noise: 0.0004 }),
    stoppedMidLine: sungLyrics().slice(0, 3 * SR),
  };
  for (const [name, take] of Object.entries(takes)) {
    for (const lyrics of [reading(), reading({ structure: 'clause', unfinished: false, linked: true, phraseComplete: true, completionConfidence: 0.5 })]) {
      const u = await run(take, { transcript: transcriptOf(ABSTRACT), lyrics });
      assert.equal(u.tier, 'gathered', `${name} (${lyrics.structure}): ${u.decision.reason}`);
    }
  }
});

test('the floor waives only how it was sung, never what the words are', () => {
  // A very fast or very slow word rate, an unfinished phrase, a weak voice: waived.
  const transcript = transcriptOf(ABSTRACT);
  const singing = { vocal: { voicedSec: 0.4, sustainedRatio: 0, sung: false, sungChecks: [] } };
  for (const soundingSec of [0.6, 200]) {
    const gate = completionGate({ transcript, lyrics: reading(), singing, features: { activity: { soundingSec } } });
    assert.ok(gate.failed.includes('word_rate') && gate.failed.includes('sung') && gate.failed.includes('phrase_complete'));
    const f = wordsFloor({ gate, transcript, lyrics: reading(), singing });
    assert.equal(f.applied, true, f.reason);
    assert.equal(decideTier({ gate, quality: { strong: true }, words: f }).tier, 'gathered', 'never Resolved through the floor');
  }
});

// ── 3. Gathered shows the meaning ─────────────────────────────────────────

const gatheredPrompt = (u) => direct({ completeness: 'gathered', seed: 7, motif: u.semantics.motif ?? 'abstract', emotion: u.semantics.mood ?? 'tender', energy: { value: 'calm' }, concept: { ...u.semantics.concept, source: 'lyrics' } });

test('concrete imagery: Gathered carries a recognisable motif the words really sang', async () => {
  const u = await run(singers.weak(), { transcript: transcriptOf(MOON), lyrics: moonReading() });
  assert.equal(u.tier, 'gathered');
  assert.equal(u.semantics.source, 'lyrics');
  assert.match(u.semantics.concept.text, /moon/);
  const d = gatheredPrompt(u);
  assert.equal(d.sections.motif, GATHERED_MOTIF);
  assert.match(d.sections.subject, /moon over a dark sea/);
  // An imagined image never enters: the concept is grounded on the transcript.
  const drifted = await run(singers.weak(), { transcript: transcriptOf(MOON), lyrics: reading({ sungImagery: [...MOON_IMAGERY, { motif: 'whale', quote: 'whale' }], concepts: { loose: 'x', gathered: 'a paper boat', resolved: 'y' } }) });
  assert.equal(drifted.semantics.concept.text, 'moon and sea; a paper boat');
});

test('abstract lyrics: Gathered shows a visible poetic equivalent, not a fully abstract Loose painting', async () => {
  const u = await run(quiet46(), { transcript: transcriptOf(ABSTRACT), lyrics: reading() });
  assert.equal(u.tier, 'gathered');
  assert.equal(u.semantics.source, 'lyrics');
  assert.equal(u.semantics.concept.text, 'a lamp left on in an empty room at night');
  const d = gatheredPrompt(u);
  assert.equal(d.sections.motif, GATHERED_MOTIF, 'the motif must be recognisable');
  assert.doesNotMatch(d.sections.subject, /expresses the sound of the voice itself/);
  // No Gathered concept from the reading: its Resolved visual equivalent stands in.
  const s = semanticsFor('gathered', transcriptOf(ABSTRACT), reading({ concepts: { loose: 'x', gathered: '', resolved: 'an empty room at night, one lamp still on by the window' } }));
  assert.equal(s.source, 'lyrics');
  assert.equal(s.concept.text, 'an empty room at night, one lamp still on by the window');
  // Other tiers keep their own concepts exactly.
  assert.equal(semanticsFor('loose', transcriptOf(ABSTRACT), reading({ concepts: { loose: '', gathered: 'g', resolved: 'r' } })).source, 'sound');
});

// ── 4. Loose stays for what cannot carry meaning ──────────────────────────

test('humming, vocables, unreliable ASR, nonsense, hallucination and speech stay Loose', async () => {
  const take = sungLyrics();
  const cases = {
    humming: [singers.hum(), transcriptOf('mm mm mm hmm'), reading({ lexical: false, coherent: false, structure: 'vocables' })],
    vocablesEn: [take, transcriptOf('la la la ooh ooh la la la'), reading({ lexical: false, coherent: false, structure: 'vocables' })],
    vocablesZh: [take, transcriptOf('啦 啦 啦 嗯 啊 啊 啦'), reading({ lexical: false, coherent: false, structure: 'vocables' })],
    unreliableAsr: [take, transcriptOf(ABSTRACT, 0.4), reading()],
    noAsrConfidence: [take, analyzeTranscript(ABSTRACT), reading()],
    nonsense: [take, transcriptOf('blue chair running seven spoon under'), reading({ language: 'en', coherent: false })],
    hallucination: [take, transcriptOf('thank you for watching'), reading({ language: 'en' })],
    nothingTranscribed: [take, transcriptOf(''), null],
    speech: [spokenLyrics(), transcriptOf(ABSTRACT), reading()],
  };
  for (const [name, [x, transcript, lyrics]] of Object.entries(cases)) {
    const u = await run(x, { transcript, lyrics });
    assert.equal(u.tier, 'loose', `${name}: ${u.decision.reason}`);
  }
  // No words heard at all (a hum, with nothing transcribed).
  assert.equal((await run(singers.hum(), null)).tier, 'loose');
});

// ── 5. Resolved is unchanged ──────────────────────────────────────────────

test('Resolved still needs the full gate and confidently strong singing', async () => {
  const complete = reading({ language: 'en', structure: 'clause', unfinished: false, linked: true, phraseComplete: true, completionConfidence: 0.9 });
  const LINE = 'the moon is shining on the quiet sea';
  const strong = await run(singers.strong(), { transcript: transcriptOf(LINE), lyrics: complete });
  assert.equal(strong.gate.pass, true);
  assert.equal(strong.decision.stage, 2);
  assert.equal(strong.tier, strong.singing.quality.strong ? 'resolved' : 'gathered');
  assert.equal(strong.wordsFloor.applied, false, 'not needed when the gate passes');
  const weak = await run(singers.weak(), { transcript: transcriptOf(LINE), lyrics: complete });
  assert.notEqual(weak.tier, 'resolved');
  // Unfinished words sung strongly: Gathered, never Resolved.
  const unfinished = await run(singers.strong(), { transcript: transcriptOf(LINE), lyrics: reading({ language: 'en' }) });
  assert.equal(unfinished.tier, 'gathered');
});

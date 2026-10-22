// Han, 19 Oct: two tier rules on top of the existing gate and Strong checks.
//   1. Sustained lyrical singing floor: a take sung throughout with
//      recognisable words is at least Gathered, even when phrase_complete
//      fails. Never a route to Resolved; no evidence → no change.
//   2. Resolved finish inheritance: a Resolved painting is told to reach the
//      reference's level of finish; the words still decide the subject.
// The transcript and the reading are GIVEN (no paid call); the audio is the
// synthetic voices in synth.js, run through the real understandTake().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singers, sungLyrics, spokenLyrics, SR } from './synth.js';
import { analyzeTranscript, lyricalFloor, completionGate, FLOOR_CALIBRATION } from '../../src/engine/interpret/lyrics.js';
import { understandTake } from '../../src/engine/understand.js';
import { cleanReading } from '../../src/engine/providers/openai-understand.js';
import { measurePerformance } from '../../src/engine/analysis/performance-measure.js';
import { direct, RESOLVED_FINISH, checkPrompt } from '../../src/engine/direct/index.js';
import { REFERENCE_AUTHORITY_PERFORMANCE, REFERENCE_AUTHORITY_PERFORMANCE_RESOLVED } from '../../src/engine/direct/library.js';

const confident = (text) => analyzeTranscript(text, { logprobs: text.split(/\s+/).map((token) => ({ token, logprob: Math.log(0.9) })) });
const reading = (o = {}) => cleanReading({
  language: 'zh', lexical: true, coherent: true, structure: 'clause', unfinished: false, linked: true, missing: '',
  phraseComplete: true, completionConfidence: 0.9, completionReason: 'a full line',
  theme: ['patience in love'], imagery: ['rainy days'], figurative: [], mood: 'melancholic', motif: 'abstract',
  concepts: { loose: 'rain on a window', gathered: 'a rainy street at dusk', resolved: 'a window on a rainy day, a lamp lit behind it' }, ...o,
});
// Han's take: several sung lines of 修炼爱情, judged unfinished by the model.
const LINES = '你能体谅我的雨天吗 原谅我也曾经爱错 我愿意 用一生的时间 修炼爱情的悲欢';
const UNFINISHED = reading({ structure: 'multiple_fragments', unfinished: true, linked: false, phraseComplete: false, completionConfidence: 0.8, completionReason: 'song lines cut mid-verse' });
const join = (...xs) => { const out = new Float32Array(xs.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length; } return out; };
const run = (samples, words) => understandTake({ samples, sampleRate: SR, words: words ? async () => words : null });

// About 20 s of continuous singing, as in Han's recording.
const strong19 = join(singers.strong(), singers.strong());
const weak19 = join(singers.weak(), singers.weak());

test('sustained Chinese lyrical singing with failed phrase_complete is Gathered, not Loose', async () => {
  const u = await run(strong19, { transcript: confident(LINES), lyrics: UNFINISHED });
  assert.deepEqual(u.gate.failed, ['phrase_complete'], 'the gate still fails, on phrase_complete only');
  assert.equal(u.tier, 'gathered');
  assert.equal(u.decision.stage, 'lyrical_floor');
  assert.equal(u.lyricalFloor.applied, true, JSON.stringify(u.lyricalFloor));
  assert.equal(u.decision.lyricalFloor, u.lyricalFloor);
  assert.match(u.decision.reason, /meaningful sung lyrics.*minimum Gathered.*phrase_complete/);
  // The evidence is measured, with every check and its threshold.
  assert.deepEqual(u.lyricalFloor.evidence.checks.map((c) => [c.id, c.ok]), [['only_phrase_complete_failed', true], ['sounding_sec', true], ['sung_throughout', true], ['lyric_words', true], ['meaningful_phrase', true]]);
  assert.ok(u.lyricalFloor.evidence.pitchedShare >= FLOOR_CALIBRATION.minPitchedShare);
  // A floor, not a promotion: strong singing does not make it Resolved.
  assert.equal(u.singing.quality.strong, true);
  assert.notEqual(u.tier, 'resolved');
  // The words carry the meaning at Gathered.
  assert.equal(u.semantics.source, 'lyrics');
  assert.equal(u.semantics.concept.text, 'a rainy street at dusk');
});

test('imperfect pitch but continuous lyrical singing is still Gathered', async () => {
  const u = await run(weak19, { transcript: confident(LINES), lyrics: UNFINISHED });
  assert.equal(u.singing.quality.strong, false);
  assert.equal(u.tier, 'gathered');
  assert.equal(u.lyricalFloor.applied, true);
  // With a complete phrase the same take reaches Gathered through the gate, as before.
  const complete = await run(weak19, { transcript: confident(LINES), lyrics: reading() });
  assert.equal(complete.gate.pass, true);
  assert.equal(complete.tier, 'gathered');
  assert.equal(complete.decision.stage, 2);
  assert.equal(complete.lyricalFloor.applied, false);
});

test('a complete phrase sung strongly is still Resolved through the gate, untouched by the floor', async () => {
  const u = await run(strong19, { transcript: confident(LINES), lyrics: reading() });
  assert.equal(u.tier, 'resolved');
  assert.equal(u.decision.stage, 2);
  assert.match(u.lyricalFloor.reason, /not needed/);
});

test('short fragments stay Loose; a short meaningful phrase is Gathered', async () => {
  // Han, 19 Oct (Gathered grounding): a short sung take with meaningful
  // lines is no longer Loose just for being short.
  const short = singers.strong().slice(0, 5 * SR);
  const meaningful = await run(short, { transcript: confident(LINES), lyrics: UNFINISHED });
  assert.equal(meaningful.tier, 'gathered');
  assert.equal(meaningful.lyricalFloor.applied, true);
  // A syllable or two of sound, a single cut-off fragment, or one short
  // fragment in a long take: not this floor, but reliable words are still
  // at least Gathered through the reliable lyrics floor (Han, 22 Oct).
  const tiny = await run(singers.strong().slice(0, 2 * SR), { transcript: confident(LINES), lyrics: UNFINISHED });
  assert.equal(tiny.lyricalFloor.applied, false);
  assert.equal(tiny.tier, 'gathered');
  const a = await run(short, { transcript: confident(LINES), lyrics: reading({ structure: 'fragment', unfinished: true, linked: false, phraseComplete: false }) });
  assert.equal(a.lyricalFloor.applied, false);
  assert.match(a.lyricalFloor.reason, /meaningful_phrase/);
  assert.equal(a.tier, 'gathered');
  assert.equal(a.decision.stage, 'words_floor');
  const b = await run(strong19, { transcript: confident('遥远的夜空月亮月亮下面'), lyrics: UNFINISHED });
  assert.match(b.lyricalFloor.reason, /lyric_words/);
  assert.equal(b.tier, 'gathered');
});

test('speech stays Loose, even with many words', async () => {
  const u = await run(join(spokenLyrics(), spokenLyrics({ seed: 21 })), { transcript: confident(LINES), lyrics: UNFINISHED });
  assert.equal(u.singing.vocal.sung, false);
  assert.equal(u.tier, 'loose');
  assert.equal(u.lyricalFloor.applied, false);
  assert.match(u.lyricalFloor.reason, /only_phrase_complete_failed/, 'the gate also failed on "sung"');
});

test('humming without recognisable lyrics stays Loose', async () => {
  const vocables = await run(strong19, { transcript: confident('嗯 嗯 啦 啦 啦 嗯 啊 啊 啦 啦'), lyrics: reading({ lexical: false, coherent: false, structure: 'vocables', phraseComplete: false }) });
  assert.equal(vocables.tier, 'loose');
  assert.equal(vocables.lyricalFloor.applied, false);
  const silent = await run(join(singers.hum(), singers.hum()), null);
  assert.equal(silent.tier, 'loose');
  assert.equal(silent.lyricalFloor.applied, false);
});

test('without reliable evidence the existing decision stands', async () => {
  // No transcript, no reading, a failed reading: nothing to go on.
  const none = await run(strong19, null);
  assert.equal(none.tier, 'loose');
  assert.match(none.lyricalFloor.reason, /insufficient evidence/);
  const failed = await run(strong19, { transcript: confident(LINES), lyrics: { error: 'timeout' } });
  assert.equal(failed.tier, 'loose');
  assert.equal(failed.lyricalFloor.applied, false);
  // An uncertain transcription fails more than phrase_complete: no floor.
  const unsure = analyzeTranscript(LINES, { logprobs: LINES.split(/\s+/).map((token) => ({ token, logprob: Math.log(0.3) })) });
  const low = await run(strong19, { transcript: unsure, lyrics: UNFINISHED });
  assert.equal(low.tier, 'loose');
  // No singing analysis or no sounding time: the floor cannot be judged.
  const gate = completionGate({ transcript: confident(LINES), lyrics: UNFINISHED, singing: null, features: null });
  assert.match(lyricalFloor({ gate, transcript: confident(LINES), lyrics: UNFINISHED, singing: null, features: null }).reason, /insufficient evidence/);
});

// ── Resolved finish inheritance ──────────────────────────────────────────
const CONCEPT = { source: 'lyrics', text: 'a sun and a moon sharing one evening sky', theme: ['patience in love'], imagery: ['sun', 'moon'] };
const perf = measurePerformance(sungLyrics(), SR);
const paint = (completeness, family, reference) => direct({ completeness, family, reference, seed: 7, motif: 'abstract', emotion: 'melancholic', energy: { value: 'lively' }, concept: CONCEPT, performance: perf });

test('Resolved prompt inherits the reference\'s level of finish; the subject still comes from the lyrics', () => {
  const d = paint('resolved', 'R3-vivid-wash-focal', 'resolved_02');
  assert.equal(d.level, 'resolved');
  assert.deepEqual(d.resolvedFinish, { applied: true, reference: 'resolved_02', reason: d.resolvedFinish.reason });
  assert.equal(d.sections.finish, RESOLVED_FINISH);
  assert.ok(d.prompt.includes(RESOLVED_FINISH));
  assert.equal(d.referencePrompt, REFERENCE_AUTHORITY_PERFORMANCE_RESOLVED);
  assert.match(d.referencePrompt, /level of artistic finish/);
  // Subject and meaning from the words; the reference still gives no content or composition.
  assert.match(d.sections.subject, /sun and a moon sharing one evening sky/);
  assert.match(d.sections.meaning, /imagery: sun, moon/);
  assert.match(RESOLVED_FINISH, /never its content or composition/);
  assert.match(RESOLVED_FINISH, /not photorealism/);
  assert.match(d.referencePrompt, /Content never comes from the reference/);
  // The finish line sits right after the form line, before the performance plan.
  const lines = d.prompt.split('\n');
  assert.equal(lines.indexOf(RESOLVED_FINISH), lines.indexOf(d.sections.form) + 1);
  assert.equal(checkPrompt(d).verdict, 'ok', JSON.stringify(checkPrompt(d)));
});

test('the performance sections are the same with or without finish inheritance', () => {
  const r = paint('resolved', 'R3-vivid-wash-focal', 'resolved_02'), g = paint('gathered', 'G2-splash-wash', 'gathered_02');
  for (const s of ['composition', 'passages', 'marks', 'contrast', 'disorder']) assert.equal(r.sections[s], g.sections[s], s);
});

test('Loose and Gathered are unchanged: no finish inheritance', () => {
  for (const [tier, family, ref] of [['loose', 'L2-bloom-field', 'loose_02'], ['gathered', 'G2-splash-wash', 'gathered_02']]) {
    const d = paint(tier, family, ref);
    assert.equal(d.resolvedFinish.applied, false);
    assert.equal(d.sections.finish, null);
    assert.ok(!d.prompt.includes('Level of finish'));
    assert.equal(d.referencePrompt, REFERENCE_AUTHORITY_PERFORMANCE);
  }
});

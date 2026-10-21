// Han, 20 Oct: a beta tester's slow, soft English song was Loose.
//   1. The meaningful-lyrics floor counted words per sounding second, so
//      sustained notes alone pushed slow songs under it. It now counts words
//      per sung phrase (between breaths), which does not depend on tempo.
//   2. Real English words ("a", "am", "do") were read as vocables.
// Lyrics alone still lift nothing: the floor gives Gathered only, every
// other gate check must pass, and Resolved still needs the full gate.
// The transcript and the reading are GIVEN (no paid call); the audio is the
// synthetic voices in synth.js, run through the real understandTake().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singers, sungLyrics, spokenLyrics, SR } from './synth.js';
import { analyzeTranscript, FLOOR_CALIBRATION } from '../../src/engine/interpret/lyrics.js';
import { understandTake } from '../../src/engine/understand.js';
import { cleanReading } from '../../src/engine/providers/openai-understand.js';

const confident = (text, p = 0.9) => analyzeTranscript(text, { logprobs: text.split(/\s+/).map((token) => ({ token, logprob: Math.log(p) })) });
const reading = (o = {}) => cleanReading({
  language: 'en', lexical: true, coherent: true, structure: 'clause', unfinished: false, linked: true, missing: '',
  phraseComplete: true, completionConfidence: 0.9, completionReason: 'a full line',
  theme: ['staying'], imagery: ['night', 'morning light'], figurative: [], mood: 'tender', motif: 'abstract',
  concepts: { loose: 'slow marks settling', gathered: 'a lamp by a window at night', resolved: 'a window at dawn, a lamp still lit' }, ...o,
});
// Several sung lines, judged unfinished: the usual case for a song excerpt.
const LINES = reading({ structure: 'multiple_fragments', unfinished: true, linked: false, phraseComplete: false, completionConfidence: 0.8 });
const EN = 'I will hold you in the quiet of the night and I will stay until the morning light';
const ZH = '你能体谅我的雨天吗 原谅我也曾经爱错 我愿意 用一生的时间';
const silence = (sec) => new Float32Array(Math.round(sec * SR));
const join = (...xs) => { const out = new Float32Array(xs.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length; } return out; };
const run = (samples, words) => understandTake({ samples, sampleRate: SR, words: words ? async () => words : null });

// The same 20-syllable tune at three tempos, and a soft slow take.
const fast = sungLyrics();                                   // ~0.4 s a syllable, ~9 s
const slow = sungLyrics({ syl: [0.8, 1.2] });                // ~1 s a syllable, ~21 s
const verySlow = sungLyrics({ syl: [1.2, 1.6] });            // held notes, ~29 s
const softSlow = sungLyrics({ syl: [0.8, 1.2], amp: 0.03 }); // quiet, still above the level floor
// Two slow lines with a breath between them.
const slowTwoLines = join(sungLyrics({ syl: [0.8, 1.1], seed: 3 }).slice(0, 12 * SR), silence(0.6), sungLyrics({ syl: [0.8, 1.1], seed: 4 }).slice(0, 12 * SR));
// Long held notes: four syllables across ~8 s (sustained notes, melisma-like).
const sustained = sungLyrics({ syl: [1.8, 2.2], seed: 6 }).slice(0, 9 * SR);

for (const [name, take] of [['fast', fast], ['slow', slow], ['very slow', verySlow], ['soft and slow', softSlow], ['slow, two lines', slowTwoLines]]) {
  for (const [lang, text] of [['English', EN], ['Chinese', ZH]]) {
    test(`${name} ${lang} lyrical singing, phrase judged unfinished: Gathered through the floor`, async () => {
      const u = await run(take, { transcript: confident(text), lyrics: { ...LINES, language: lang === 'English' ? 'en' : 'zh' } });
      assert.deepEqual(u.gate.failed, ['phrase_complete']);
      assert.equal(u.tier, 'gathered', JSON.stringify(u.lyricalFloor));
      assert.equal(u.lyricalFloor.applied, true);
      assert.ok(u.lyricalFloor.evidence.wordsPerPhrase >= FLOOR_CALIBRATION.minWordsPerPhrase);
    });
  }
}

test('the floor no longer depends on tempo: slower singing gives the same words per phrase', async () => {
  const a = await run(fast, { transcript: confident(EN), lyrics: LINES });
  const b = await run(verySlow, { transcript: confident(EN), lyrics: LINES });
  assert.ok(b.lyricalFloor.evidence.soundingSec > 3 * a.lyricalFloor.evidence.soundingSec);
  assert.ok(b.lyricalFloor.evidence.wordsPerSec < 0.8, 'under the old 0.8 words/s bar');
  assert.equal(a.lyricalFloor.evidence.wordsPerPhrase, b.lyricalFloor.evidence.wordsPerPhrase);
  assert.deepEqual([a.tier, b.tier], ['gathered', 'gathered']);
  const c = b.lyricalFloor.evidence.checks.find((x) => x.id === 'lyric_words');
  assert.match(c.value, /18 words in 1 sung phrase/);
  assert.match(c.need, /per sung phrase/);
});

test('sustained notes with few words: Gathered when every phrase carries words', async () => {
  const u = await run(sustained, { transcript: confident('stay with me tonight'), lyrics: LINES });
  assert.equal(u.tier, 'gathered', JSON.stringify(u.lyricalFloor));
});

test('a complete phrase, sung slowly: the gate decides as before (Resolved only with strong singing)', async () => {
  const complete = await run(slow, { transcript: confident(EN), lyrics: reading() });
  assert.equal(complete.gate.pass, true);
  assert.equal(complete.decision.stage, 2);
  assert.equal(complete.tier, complete.singing.quality.strong ? 'resolved' : 'gathered');
  // Through the floor, the same take is never Resolved.
  const floor = await run(slow, { transcript: confident(EN), lyrics: LINES });
  assert.equal(floor.tier, 'gathered');
});

test('lyrics alone lift nothing: humming, speech, fragments and unsure words stay Loose', async () => {
  const long = join(singers.strong(), singers.strong()); // 5 sung phrases
  const cases = {
    // A short fragment in a take of several phrases: most phrases are wordless.
    fragmentEn: await run(long, { transcript: confident('I love you so'), lyrics: LINES }),
    fragmentZh: await run(long, { transcript: confident('遥远的夜空月亮月亮下面'), lyrics: LINES }),
    // Vocables, English and Chinese.
    humEn: await run(slow, { transcript: confident('mm mm ooh ooh la la la ah ah mmm'), lyrics: reading({ lexical: false, coherent: false, structure: 'vocables', phraseComplete: false }) }),
    humZh: await run(slow, { transcript: confident('嗯 嗯 啦 啦 啦 嗯 啊 啊'), lyrics: reading({ lexical: false, coherent: false, structure: 'vocables', phraseComplete: false }) }),
    // A hum with nothing transcribed.
    silentHum: await run(join(singers.hum(), singers.hum()), null),
    // Spoken, not sung.
    speech: await run(join(spokenLyrics(), spokenLyrics({ seed: 21 })), { transcript: confident(EN), lyrics: LINES }),
    // An unsure transcription.
    unsure: await run(slow, { transcript: confident(EN, 0.4), lyrics: LINES }),
    // One cut-off fragment, however slowly sung.
    oneFragment: await run(slow, { transcript: confident(EN), lyrics: reading({ structure: 'fragment', unfinished: true, linked: false, phraseComplete: false }) }),
  };
  for (const [k, u] of Object.entries(cases)) {
    assert.equal(u.lyricalFloor.applied, false, k);
    // Han, 21 Oct (Concrete Imagery Floor): reliable words naming a concrete
    // image (夜空, 月亮) are at least Gathered, also as a short fragment.
    assert.equal(u.tier, k === 'fragmentZh' ? 'gathered' : 'loose', k);
  }
  assert.match(cases.fragmentEn.lyricalFloor.reason, /lyric_words/);
  assert.match(cases.fragmentZh.lyricalFloor.reason, /lyric_words/);
  assert.equal(cases.fragmentZh.imageryFloor.applied, true);
});

test('without the sung phrases the floor cannot be judged and the old decision stands', async () => {
  const u = await understandTake({ samples: slow, sampleRate: SR, features: null, words: async () => ({ transcript: confident(EN), lyrics: LINES }) });
  assert.equal(u.lyricalFloor.applied, true, 'measured from the samples');
  const { lyricalFloor, completionGate } = await import('../../src/engine/interpret/lyrics.js');
  const features = { activity: { soundingSec: 20 }, phrases: null };
  const singing = { vocal: { sung: true, voicedSec: 19, sustainedRatio: 0.8 } };
  const gate = completionGate({ transcript: confident(EN), lyrics: LINES, singing, features });
  assert.match(lyricalFloor({ gate, transcript: confident(EN), lyrics: LINES, singing, features }).reason, /insufficient evidence/);
});

test('real English words are not vocables', () => {
  for (const w of ['a', 'am', 'do', 'mama', 'mom', 'mum', 'made', 'dude', 'nada', 'ya', 'ohm']) {
    assert.equal(analyzeTranscript(w).lexicalWords, 1, w);
  }
  for (const w of ['ah', 'aah', 'oh', 'ooh', 'uh', 'um', 'mm', 'mmm', 'hmm', 'la', 'lalala', 'na', 'nanana', 'da', 'dada', 'doo', 'dum', 'yeah', 'hey', 'whoa', 'woo', 'shh', '啊', '嗯', '啦啦']) {
    assert.equal(analyzeTranscript(w).lexicalWords, 0, w);
  }
  const t = analyzeTranscript('Oh oh oh I am home, yeah, a love like a song');
  assert.equal(t.lexicalWords, 8);
  assert.ok(t.lexicalRatio >= 0.6, 'mostly words now');
});

test('a filler-heavy English take with real words reaches the floor; before, "a"/"am"/"do" counted as filler', async () => {
  const text = 'oh I am home a love like a song oh do you hear me I am here';
  const u = await run(slow, { transcript: confident(text), lyrics: LINES });
  assert.equal(u.transcript.lexicalWords, 15);
  assert.equal(u.tier, 'gathered', JSON.stringify(u.gate.failed));
});

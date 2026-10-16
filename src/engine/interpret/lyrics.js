// Lyrics: from a transcript to the tier decision (pure functions; the
// transcription and language-model calls live in providers/openai-understand.js).
//
//   analyzeTranscript(text, { logprobs }) → lexical vs non-lexical words, ASR confidence
//   completionGate({ transcript, lyrics, singing, features }) → stage 1: is this a
//        sung, lexically meaningful, complete lyrical phrase? (strict)
//   decideTier({ gate, quality }) → stage 2: Loose | Gathered | Resolved
//
// Stage 1 never looks at singing quality and stage 2 never looks at the
// words: a beautiful hum cannot pass the gate, and a complete phrase sung
// unsteadily is Gathered, not Loose. "Complete" means a coherent, finished
// lyrical phrase in the transcript; it is not a claim that a known song was
// sung correctly or completely (nothing here recognises songs).
// Every threshold is provisional and needs calibration on real recordings.

export const LYRICS_VERSION = 1;

export const GATE_CALIBRATION = {
  minLexicalWords: 3,
  minDistinctWords: 2,
  minLexicalRatio: 0.6,        // share of words that are real words, not vocables
  minAsrConfidence: 0.6,       // mean token probability of the transcript
  minCompletion: 0.7,          // the language model's confidence the phrase is complete
  minCompletionNoAsr: 0.85,    // when the transcriber gave no confidence
  maxWordsPerSec: 4.5,         // more words than a voice sings → background speech, or spoken
  minWordsPerSec: 0.15,        // a few words in a long hum are fragments, not a phrase
};

// Non-lexical singing syllables (vocables), in English and Chinese, and the
// bracketed tags transcribers emit for music.
const VOCABLE = /^(?:(?:a+h*|o+h*|u+h*|m+|h+m+|e+h|la|na|da|doo?|du|ba|bum|dum|di|de|ya|yeah|hey|whoa|wo+|woah|ooh|aah|uh|um|hmm|mmm|sh+)+|[啊哦嗯啦呀哼喔噢呜唔哈嘿咿哎嘛呐哒嘟呣]+)$/i;
const MUSIC_TAG = /[♪♫🎵🎶]|\[(?:music|singing|humming|instrumental|音乐)[^\]]*\]|\((?:music|singing|humming|instrumental|音乐)[^)]*\)/gi;

// Phrases speech recognisers are known to invent on music or silence.
const HALLUCINATIONS = [
  /thank(s| you) (for|so much for) watching/i, /^thank you\.?$/i, /please subscribe/i, /like and subscribe/i,
  /subtitles? (by|from)/i, /amara\.org/i, /字幕/, /请不吝点赞/, /订阅/, /谢谢观看/, /明镜与点点/, /优优独播/,
];

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

function words(text) {
  if (segmenter) return [...segmenter.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment.toLowerCase());
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const r3 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);

// logprobs: [{ token, logprob }] as returned by gpt-4o-transcribe with include[]=logprobs.
export function asrConfidence(logprobs) {
  const lp = (logprobs ?? []).map((t) => t?.logprob).filter((x) => typeof x === 'number' && isFinite(x));
  if (!lp.length) return null;
  return r3(Math.exp(lp.reduce((a, b) => a + b, 0) / lp.length));
}

export function analyzeTranscript(text = '', { logprobs = null } = {}) {
  const raw = String(text ?? '').trim();
  const musicTags = (raw.match(MUSIC_TAG) ?? []).length;
  const clean = raw.replace(MUSIC_TAG, ' ').replace(/\s+/g, ' ').trim();
  const hallucination = Boolean(clean) && HALLUCINATIONS.some((re) => re.test(clean));
  const all = words(clean);
  const vocables = all.filter((w) => VOCABLE.test(w));
  const lexical = hallucination ? [] : all.filter((w) => !VOCABLE.test(w));
  return {
    text: clean,
    wordCount: all.length,
    lexicalWords: lexical.length,
    distinctLexicalWords: new Set(lexical).size,
    nonLexicalWords: vocables.length,
    lexicalRatio: all.length ? r3(lexical.length / all.length) : 0,
    musicTags,
    hallucination,
    asrConfidence: asrConfidence(logprobs),
  };
}

// Stage 1. Every check must pass; anything missing or uncertain fails.
//   transcript: analyzeTranscript(...) (null when nothing was transcribed)
//   lyrics:     the language model's reading (null when not asked or failed)
//   singing:    singingAnalysis(...); features: analyzeSamples(...)
export function completionGate({ transcript = null, lyrics = null, singing = null, features = null } = {}, cal = GATE_CALIBRATION) {
  const checks = [];
  const add = (id, ok, value, need) => checks.push({ id, ok: Boolean(ok), value, need });
  const t = transcript;
  add('transcribed', t && t.text && !t.hallucination, t ? (t.hallucination ? 'known ASR hallucination' : t.text ? 'yes' : 'empty') : 'no transcript', 'a transcript');
  add('lexical_words', (t?.lexicalWords ?? 0) >= cal.minLexicalWords && (t?.distinctLexicalWords ?? 0) >= cal.minDistinctWords,
    `${t?.lexicalWords ?? 0} words (${t?.distinctLexicalWords ?? 0} distinct)`, `≥ ${cal.minLexicalWords} words, ≥ ${cal.minDistinctWords} distinct`);
  add('mostly_words', (t?.lexicalRatio ?? 0) >= cal.minLexicalRatio, t?.lexicalRatio ?? 0, `≥ ${cal.minLexicalRatio} of words are not vocables`);
  const asr = t?.asrConfidence ?? null;
  const needCompletion = asr == null ? cal.minCompletionNoAsr : cal.minCompletion;
  add('asr_confident', asr == null || asr >= cal.minAsrConfidence, asr ?? 'unavailable (stricter completion bar applies)', `≥ ${cal.minAsrConfidence}`);
  const sung = singing?.vocal;
  add('sung', sung?.sung, sung ? `sustained ${sung.sustainedRatio}, voiced ${sung.voicedSec}s` : 'no singing analysis', 'sustained pitched notes (not speech)');
  const sec = Math.max(0.5, features?.activity?.soundingSec ?? sung?.voicedSec ?? 0);
  const rate = (t?.lexicalWords ?? 0) / sec;
  add('word_rate', rate >= cal.minWordsPerSec && rate <= cal.maxWordsPerSec, r3(rate), `${cal.minWordsPerSec}–${cal.maxWordsPerSec} words per sounding second`);
  add('language_model', lyrics && !lyrics.error, lyrics ? (lyrics.error ? `error: ${lyrics.error}` : 'read') : 'not available', 'a reading of the words');
  add('lexical_meaning', lyrics?.lexical && lyrics?.coherent, lyrics ? `lexical ${Boolean(lyrics.lexical)}, coherent ${Boolean(lyrics.coherent)}` : '—', 'meaningful, coherent words');
  add('phrase_complete', lyrics?.phraseComplete && (lyrics?.completionConfidence ?? 0) >= needCompletion,
    lyrics ? `${Boolean(lyrics.phraseComplete)} (${lyrics.completionConfidence ?? '?'})` : '—', `complete, confidence ≥ ${needCompletion}`);
  add('clean_ending', sung?.ending?.clean, sung?.ending ? `quiet ${sung.ending.trailingQuietSec}s, held ${sung.ending.lastNoteHeldSec ?? 0}s` : '—', 'the voice ends, not cut off');

  const pass = checks.every((c) => c.ok);
  const failed = checks.filter((c) => !c.ok).map((c) => c.id);
  // How sure the pass (or fail) is: the weakest of the uncertain inputs.
  const confidence = pass
    ? r3(Math.min(asr ?? 0.7, lyrics.completionConfidence ?? 0, clamp01((sung.sustainedRatio - 0.3) / 0.4)))
    : r3(failed.some((id) => ['transcribed', 'lexical_words', 'sung', 'mostly_words'].includes(id)) ? 0.9 : 0.6);
  return {
    version: LYRICS_VERSION,
    pass, confidence, failed, checks,
    reason: pass ? 'a sung, coherent and complete lyrical phrase' : `not a complete sung phrase: ${failed.join(', ')}`,
  };
}

// Stage 2 (only after the gate): how well it was sung decides Gathered or
// Resolved. Resolved needs confidently strong singing; anything uncertain
// stays Gathered.
export function decideTier({ gate, quality }) {
  if (!gate?.pass) return { tier: 'loose', stage: 1, reason: gate?.reason ?? 'no lyrics gate result' };
  if (quality?.strong) return { tier: 'resolved', stage: 2, reason: `complete phrase, confidently strong singing (score ${quality.score}, confidence ${quality.confidence})` };
  const why = quality?.score == null ? 'singing quality could not be measured'
    : `singing not confidently strong (score ${quality.score}, confidence ${quality.confidence})`;
  return { tier: 'gathered', stage: 2, reason: `complete phrase; ${why}` };
}

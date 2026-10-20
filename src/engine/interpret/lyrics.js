// Lyrics: from a transcript to the tier decision (pure functions; the
// transcription and language-model calls live in providers/openai-understand.js).
//
//   analyzeTranscript(text, { logprobs }) → lexical vs non-lexical words, ASR confidence
//   completionGate({ transcript, lyrics, singing, features }) → stage 1: is this a
//        sung, lexically meaningful, complete lyrical phrase? (strict)
//   lyricalFloor({ gate, transcript, lyrics, singing, features }) → minimum
//        Gathered for a meaningful sung phrase whose only failed check is
//        phrase_complete (never a route to Resolved)
//   decideTier({ gate, quality, floor }) → stage 2: Loose | Gathered | Resolved
//
// Stage 1 never looks at singing quality and stage 2 never looks at the
// words: a beautiful hum cannot pass the gate, and a complete phrase sung
// unsteadily is Gathered, not Loose. "Complete" means a coherent, finished
// lyrical phrase in the transcript; it is not a claim that a known song was
// sung correctly or completely (nothing here recognises songs).
// Every threshold is provisional and needs calibration on real recordings.

export const LYRICS_VERSION = 6;

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

// Phrase structure as the language model reports it (see the prompt in
// providers/openai-understand.js). Only these two can be complete.
export const STRUCTURES = ['clause', 'image_phrase', 'noun_list', 'fragment', 'multiple_fragments', 'vocables'];
export const COMPLETE_STRUCTURES = ['clause', 'image_phrase'];

// The completeness verdict used by the gate. The model's own phraseComplete
// counts only when its structure analysis agrees: a model that calls a noun
// list or an unfinished fragment "complete" contradicts itself, and the
// stricter reading wins. No meaning is inferred here; this only checks the
// model's answers against each other.
export function phraseVerdict(lyrics) {
  if (!lyrics) return { complete: false, reasons: ['no reading'] };
  const reasons = [];
  if (!lyrics.phraseComplete) reasons.push('model: not complete');
  if (!COMPLETE_STRUCTURES.includes(lyrics.structure)) reasons.push(`structure: ${lyrics.structure ?? 'not reported'}`);
  if (lyrics.unfinished === true) reasons.push('ends unfinished');
  if (lyrics.linked !== true) reasons.push('parts not joined into one statement or image');
  return { complete: reasons.length === 0, reasons, overridden: Boolean(lyrics.phraseComplete) && reasons.length > 0 };
}

// Non-lexical singing syllables (vocables), in English and Chinese, and the
// bracketed tags transcribers emit for music. An English word is a vocable
// only when it is one vocable, held or repeated ("ooh", "lalala", "mmm"):
// mixing syllables used to let real words through as vocables ("a", "am",
// "do", "mama", "mom", "made", "dude").
const VOCABLE = /^(?:a{2,}h*|a+h+|o+h*|u+h+|e+h+|m+|h+m+|(?:la)+|(?:na)+|(?:da)+|(?:doo)+|(?:du)+|(?:ba)+|(?:bum)+|(?:dum)+|(?:di)+|(?:de)+|(?:ya){2,}|yeah|hey|whoa|wo+|woah|uh|um|hmm|mmm|sh+|[啊哦嗯啦呀哼喔噢呜唔哈嘿咿哎嘛呐哒嘟呣]+)$/i;
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
  add('sung', sung?.sung, sung ? (sung.sungChecks ?? []).map((c) => `${c.id} ${c.value} ${c.ok ? 'ok' : 'FAIL'}`).join(', ') || `sustained ${sung.sustainedRatio}, voiced ${sung.voicedSec}s` : 'no singing analysis',
    sung?.sungChecks ? sung.sungChecks.map((c) => c.need).join('; ') : 'sustained pitched notes (not speech)');
  const sec = Math.max(0.5, features?.activity?.soundingSec ?? sung?.voicedSec ?? 0);
  const rate = (t?.lexicalWords ?? 0) / sec;
  add('word_rate', rate >= cal.minWordsPerSec && rate <= cal.maxWordsPerSec, r3(rate), `${cal.minWordsPerSec}–${cal.maxWordsPerSec} words per sounding second`);
  add('language_model', lyrics && !lyrics.error, lyrics ? (lyrics.error ? `error: ${lyrics.error}` : 'read') : 'not available', 'a reading of the words');
  add('lexical_meaning', lyrics?.lexical && lyrics?.coherent, lyrics ? `lexical ${Boolean(lyrics.lexical)}, coherent ${Boolean(lyrics.coherent)}` : '—', 'meaningful, coherent words');
  const verdict = phraseVerdict(lyrics);
  add('phrase_complete', verdict.complete && (lyrics?.completionConfidence ?? 0) >= needCompletion,
    lyrics ? `model ${Boolean(lyrics.phraseComplete)} (${lyrics.completionConfidence ?? '?'}), structure ${lyrics.structure ?? '—'}, unfinished ${Boolean(lyrics.unfinished)}, linked ${Boolean(lyrics.linked)}${verdict.reasons.length ? ` → incomplete: ${verdict.reasons.join('; ')}` : ''}` : '—',
    `a clause or bound image, not unfinished, parts joined; confidence ≥ ${needCompletion}`);
  // How the take ends is not a lyrics question: a user who stops recording
  // right after the last word looks the same as one cut off mid-phrase.
  // Whether the words were finished is judged by phrase_complete; the ending
  // is reported with the singing (stage 2) and decides nothing.

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

// Sustained lyrical singing floor (Han, 19 Oct): a take that is clearly sung
// throughout, with recognisable words, is never Loose just because the
// language model judged the phrase unfinished. A song excerpt sung for 19 s
// ("你能体谅我的雨天吗…") is usually cut mid-line or holds several lines, so
// phrase_complete fails on it while every other check passes. The floor
// lifts such a take to Gathered only; Resolved still needs the full gate.
// Every piece of evidence must be present and measured: when anything is
// missing the existing decision stands. Provisional, like the gate.
// Meaningful lyrics floor (Han, 19 Oct, Gathered grounding): a short but
// recognisable, meaningful sung phrase ("the clouds and the sea") qualifies
// too, so Loose is left to humming, vocables, speech, severe fragments and
// unusable words. The safeguards stay: every other gate check (a real,
// confident transcript, mostly real words, sung not spoken, a singing word
// rate, a coherent reading) must still pass, and a single fragment does not
// count. Singing quality never enters it (stage 2 alone uses it).
export const FLOOR_CALIBRATION = {
  // The only gate check allowed to fail: every other one (a real transcript,
  // real words, sung, a singing word rate, a coherent reading) must pass.
  waivable: ['phrase_complete'],
  minSoundingSec: 3,       // a sung line, not a syllable or two (was 8: sustained singing only)
  minPitchedShare: 0.6,    // pitched voice (YIN) over sounding time: most of the take is sung
  minLexicalWords: 4,      // a meaningful phrase, one more than the gate's minimum (was 8: lines of lyrics)
  // Words across the singing, counted per sung phrase (a stretch of sound
  // between breaths), not per second: a slow line with sustained notes or
  // melisma is still one phrase carrying its words, while one short
  // fragment in a take of several phrases leaves most of them wordless.
  // Was ≥ 0.8 words per sounding second, which slow songs missed (20 Oct).
  minWordsPerPhrase: 1.5,
  // How the reading describes the words: a single cut-off fragment or bare
  // vocables are not a meaningful phrase.
  structures: ['clause', 'image_phrase', 'noun_list', 'multiple_fragments'],
};

export function lyricalFloor({ gate = null, transcript = null, lyrics = null, singing = null, features = null } = {}, cal = FLOOR_CALIBRATION) {
  const no = (reason, evidence = null) => ({ applied: false, tier: null, reason, evidence });
  if (!gate) return no('no lyrics gate result');
  if (gate.pass) return no('not needed: the lyrics gate passed');
  const vocal = singing?.vocal;
  const sounding = features?.activity?.soundingSec;
  const phrases = features?.phrases?.count;
  if (!transcript || !lyrics || lyrics.error || !vocal || !(sounding > 0) || vocal.voicedSec == null || !(phrases > 0)) {
    return no('insufficient evidence: needs a transcript, a reading of the words, the singing analysis, the sounding time and the sung phrases');
  }
  const pitchedShare = r3(Math.min(1, vocal.voicedSec / sounding));
  const rate = r3(transcript.lexicalWords / sounding);
  const perPhrase = r3(transcript.lexicalWords / phrases);
  const checks = [
    { id: 'only_phrase_complete_failed', ok: gate.failed.length > 0 && gate.failed.every((id) => cal.waivable.includes(id)), value: gate.failed.join(', '), need: `only ${cal.waivable.join(', ')} failed` },
    { id: 'sounding_sec', ok: sounding >= cal.minSoundingSec, value: sounding, need: `≥ ${cal.minSoundingSec} s of sound` },
    { id: 'sung_throughout', ok: vocal.sung === true && pitchedShare >= cal.minPitchedShare, value: `sung ${vocal.sung}, pitched ${vocal.voicedSec} s of ${sounding} s (${pitchedShare})`, need: `sung, pitched voice ≥ ${cal.minPitchedShare} of the sounding time` },
    { id: 'lyric_words', ok: lyrics.lexical === true && transcript.lexicalWords >= cal.minLexicalWords && perPhrase >= cal.minWordsPerPhrase, value: `${transcript.lexicalWords} words in ${phrases} sung phrase${phrases === 1 ? '' : 's'} (${perPhrase} per phrase), lexical ${Boolean(lyrics.lexical)}`, need: `≥ ${cal.minLexicalWords} real words, ≥ ${cal.minWordsPerPhrase} per sung phrase` },
    { id: 'meaningful_phrase', ok: lyrics.coherent === true && cal.structures.includes(lyrics.structure), value: `coherent ${Boolean(lyrics.coherent)}, structure ${lyrics.structure ?? '—'}`, need: `coherent; one of ${cal.structures.join(', ')}` },
  ];
  const evidence = { checks, transcript: transcript.text, soundingSec: sounding, pitchedSec: vocal.voicedSec, pitchedShare, sustainedRatio: vocal.sustainedRatio, lexicalWords: transcript.lexicalWords, sungPhrases: phrases, wordsPerPhrase: perPhrase, wordsPerSec: rate };
  if (!checks.every((c) => c.ok)) return no(`not a meaningful sung phrase: ${checks.filter((c) => !c.ok).map((c) => c.id).join(', ')}`, evidence);
  return { applied: true, tier: 'gathered', reason: 'meaningful sung lyrics: sung throughout with recognisable words; only phrase_complete failed', evidence };
}

// Stage 2 (only after the gate): how well it was sung decides Gathered or
// Resolved. Resolved needs confidently strong singing; anything uncertain
// stays Gathered.
// A failed gate is Loose unless the meaningful-lyrics floor applies,
// which gives Gathered and nothing more.
export function decideTier({ gate, quality, floor = null }) {
  if (!gate?.pass) {
    if (floor?.applied) return { tier: 'gathered', stage: 'lyrical_floor', reason: `${floor.reason} (minimum Gathered; ${gate.reason})`, lyricalFloor: floor };
    return { tier: 'loose', stage: 1, reason: gate?.reason ?? 'no lyrics gate result', lyricalFloor: floor };
  }
  if (quality?.strong) return { tier: 'resolved', stage: 2, reason: `complete phrase, confidently strong singing (score ${quality.score}, confidence ${quality.confidence})` };
  const why = quality?.score == null ? 'singing quality could not be measured'
    : `singing not confidently strong (score ${quality.score}, confidence ${quality.confidence}${quality.strongChecks ? `; not met: ${quality.strongChecks.filter((c) => !c.ok).map((c) => c.id).join(', ')}` : ''})`;
  return { tier: 'gathered', stage: 2, reason: `complete phrase; ${why}` };
}

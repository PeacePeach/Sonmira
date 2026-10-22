// Han, 19 Oct (Gathered grounding): a meaningful sung phrase is at least
// Gathered, and a Gathered painting with reliable words shows at least one
// recognisable motif from them. Loose stays for humming, vocables, speech,
// severe fragments and unusable words; Resolved keeps its own rules.
//   reference → how it looks · words → what it depicts · performance → how it is expressed
// The transcript and the reading are GIVEN (no paid call); the audio is the
// synthetic voices in synth.js, run through the real understandTake().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singers, spokenLyrics, sungLyrics, SR } from './synth.js';
import { measurePerformance } from '../../src/engine/analysis/performance-measure.js';
import { createAIEngine } from '../../src/engine/engines/ai.js';
import { analyzeTranscript } from '../../src/engine/interpret/lyrics.js';
import { understandTake } from '../../src/engine/understand.js';
import { cleanReading, SYSTEM } from '../../src/engine/providers/openai-understand.js';
import { direct, checkPrompt, performanceDirection, GATHERED_MOTIF, GATHERED_MOTIF_FORM, RESOLVED_SCENE } from '../../src/engine/direct/index.js';
import { PERFORMANCE_FORM } from '../../src/engine/direct/performance.js';

const confident = (text) => analyzeTranscript(text, { logprobs: text.split(/\s+/).map((token) => ({ token, logprob: Math.log(0.9) })) });
const unsure = (text) => analyzeTranscript(text, { logprobs: text.split(/\s+/).map((token) => ({ token, logprob: Math.log(0.3) })) });
const reading = (o = {}) => cleanReading({
  language: 'en', lexical: true, coherent: true, structure: 'clause', unfinished: false, linked: true, missing: '',
  phraseComplete: true, completionConfidence: 0.9, completionReason: 'a full line',
  theme: ['longing'], imagery: ['clouds', 'sea'], figurative: [], mood: 'tender', motif: 'water',
  scene: { situation: '', relationship: '', tension: '', moment: '', figure: '' },
  concepts: { loose: 'slow, wide marks drifting apart', gathered: 'clouds drifting low over the open sea', resolved: 'clouds gathering over a wide sea at evening' }, ...o,
});
const SEA = 'the clouds drift over the sea and carry me home';
const LOVE = '修炼爱情的辛酸 我们这些故事不难忘';
const ABSTRACT = reading({ language: 'zh', theme: ['love learned through hardship', 'memories that stay'], imagery: [], motif: 'abstract', mood: 'melancholic',
  structure: 'multiple_fragments', unfinished: true, linked: false, phraseComplete: false, completionConfidence: 0.7,
  concepts: { loose: 'marks that hold and slowly let go', gathered: 'a pair of worn gloves left together on a windowsill, one slipping toward the edge', resolved: '' } });
const join = (...xs) => { const out = new Float32Array(xs.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length; } return out; };
const run = (samples, words, forcedTier = null) => understandTake({ samples, sampleRate: SR, words: words ? async () => words : null, forcedTier });
const paint = (u, family, reference) => direct({ completeness: u.tier, family, reference, seed: 7, motif: u.semantics.motif ?? 'abstract', emotion: u.semantics.mood ?? 'tender', energy: { value: 'calm' },
  concept: u.semantics.concept ? { ...u.semantics.concept, source: 'lyrics' } : null, soundOnly: !u.semantics.concept && u.tier === 'loose', performance: u.performance });
const G = ['G2-splash-wash', 'gathered_02'];

const short = singers.weak().slice(0, 6 * SR);
const long = join(singers.strong(), singers.strong());

test('concrete lyrics (clouds and the sea): Gathered, with the motif recognisable', async () => {
  const u = await run(short, { transcript: confident(SEA), lyrics: reading({ structure: 'clause', phraseComplete: false, completionConfidence: 0.6 }) });
  assert.equal(u.tier, 'gathered');
  assert.equal(u.semantics.source, 'lyrics');
  const d = paint(u, ...G);
  assert.equal(d.sections.motif, GATHERED_MOTIF);
  assert.match(d.sections.subject, /with a recognisable motif from the sung words: clouds drifting low over the open sea/);
  assert.match(d.sections.meaning, /imagery: clouds, sea/);
  assert.equal(d.sections.form, GATHERED_MOTIF_FORM);
  assert.match(GATHERED_MOTIF, /Recognisability is mandatory; realism is not/);
  assert.match(GATHERED_MOTIF, /no complete scene or storyline/);
  assert.match(d.sections.staging, /never erases it/);
  assert.deepEqual(d.gatheredMotif, { applied: true, motif: 'clouds drifting low over the open sea', source: 'lyrics' });
  // Gathered takes no Resolved scene, narrative, palette or finish rules.
  for (const k of ['narrative', 'scene', 'finish']) assert.equal(d.sections[k] ?? null, null, k);
  assert.doesNotMatch(d.prompt, /Palette, inherited from the reference|Resolved means a scene/);
  assert.equal(checkPrompt(d).verdict, 'ok', JSON.stringify(checkPrompt(d)));
});

test('abstract lyrics: Gathered, with an imagined symbolic motif, not a storyline', async () => {
  const u = await run(long, { transcript: confident(`${LOVE} ${LOVE}`), lyrics: ABSTRACT });
  assert.equal(u.tier, 'gathered');
  const d = paint(u, ...G);
  assert.match(d.sections.subject, /recognisable motif from the sung words: a pair of worn gloves/);
  assert.equal(d.sections.motif, GATHERED_MOTIF);
  assert.equal(d.sections.narrative ?? null, null);
  // The reading is told to invent one specific motif, never a stock one.
  assert.match(SYSTEM, /- gathered: the one or two strongest visual motifs from the words, named plainly/);
  assert.match(SYSTEM, /invent one emotionally grounded symbolic object or quiet moment that holds this song's feeling, specific to these words and never a stock motif reused from song to song/);
});

test('humming: Loose, sound-led, no motif and no claim to understood words', async () => {
  const vocables = await run(long, { transcript: confident('mm mm la la la mm ah ah la la'), lyrics: reading({ lexical: false, coherent: false, structure: 'vocables', phraseComplete: false }) });
  assert.equal(vocables.tier, 'loose');
  assert.equal(vocables.semantics.source, 'sound');
  const silent = await run(join(singers.hum(), singers.hum()), null);
  assert.equal(silent.tier, 'loose');
  for (const u of [vocables, silent]) {
    const d = paint(u, 'L2-bloom-field', 'loose_02');
    assert.equal(d.subjectSource, 'sound');
    assert.match(d.prompt, /expresses the sound of the voice itself/);
    assert.equal(d.sections.motif ?? null, null);
  }
});

test('poor singing with meaningful words is Gathered, never Loose for quality', async () => {
  const u = await run(join(singers.weak(), singers.weak()), { transcript: confident(SEA), lyrics: reading() });
  assert.equal(u.singing.quality.strong, false);
  assert.equal(u.tier, 'gathered');
  const cut = await run(short, { transcript: confident(SEA), lyrics: reading({ phraseComplete: false, unfinished: true, completionConfidence: 0.5 }) });
  assert.equal(cut.tier, 'gathered', JSON.stringify(cut.lyricalFloor.reason));
  assert.equal(cut.decision.stage, 'lyrical_floor');
});

test('unreliable transcription: no invented subject, even when Gathered', async () => {
  const low = await run(long, { transcript: unsure(SEA), lyrics: reading({ phraseComplete: false }) });
  assert.equal(low.tier, 'loose', 'an uncertain transcript is not a meaningful phrase');
  const hallucinated = await run(long, { transcript: confident('thank you for watching'), lyrics: reading() });
  assert.equal(hallucinated.tier, 'loose');
  assert.equal(hallucinated.semantics.source, 'sound');
  // A take placed in Gathered (here forced) with unreliable words paints the sound-led atmosphere.
  const forced = await run(long, { transcript: unsure(SEA), lyrics: reading() }, 'gathered');
  assert.equal(forced.semantics.concept, null);
  const d = paint(forced, ...G);
  assert.equal(d.subjectSource, 'atmosphere');
  assert.equal(d.sections.motif ?? null, null);
  assert.deepEqual(d.gatheredMotif, { applied: false, reason: 'no reliable words: the sound leads' });
  assert.equal(d.sections.form, PERFORMANCE_FORM.gathered);
});

test('speech stays Loose; a reliable fragment is Gathered (Han, 22 Oct: reliable lyrics = minimum Gathered)', async () => {
  const speech = await run(join(spokenLyrics(), spokenLyrics({ seed: 21 })), { transcript: confident(SEA), lyrics: reading({ phraseComplete: false }) });
  assert.equal(speech.tier, 'loose');
  const frag = await run(short, { transcript: confident('the sea and'), lyrics: reading({ structure: 'fragment', phraseComplete: false, unfinished: true }) });
  assert.equal(frag.tier, 'gathered', frag.decision.reason);
  assert.equal(frag.lyricalFloor.applied, false);
});

test('tier boundaries: the floor never reaches Resolved; Resolved keeps its scene rules', async () => {
  const floor = await run(long, { transcript: confident(`${SEA} ${SEA}`), lyrics: reading({ phraseComplete: false, unfinished: true }) });
  assert.equal(floor.singing.quality.strong, true);
  assert.equal(floor.tier, 'gathered');
  const resolved = await run(long, { transcript: confident(`${SEA} ${SEA}`), lyrics: reading() });
  assert.equal(resolved.tier, 'resolved');
  const d = paint(resolved, 'R3-vivid-wash-focal', 'resolved_02');
  assert.equal(d.sections.motif ?? null, null);
  assert.match(d.sections.scene, new RegExp(RESOLVED_SCENE.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(d.sections.palette, /^Palette, inherited from the reference/);
  assert.deepEqual(d.gatheredMotif, { applied: false, reason: 'tier resolved' });
});

// Han, 19 Oct (approval): typed notes and sung words are each handled as
// themselves, and the performance never erases Gathered's motif.
const NOTE = 'a red kite tugging above the harbour';
const engineRun = async (samples, understood, { note = '', tier = null } = {}) => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith('data:')) return fetch(url);
    sent.push({ url, body: JSON.parse(init.body) });
    if (url === '/api/understand') return { ok: true, status: 200, json: async () => ({ ok: true, ...understood }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, provider: 'openai', model: 'm', family: 'G2-splash-wash', reference: 'gathered_02', referenceSent: true, image: 'data:image/png;base64,iVBORw0KGgo=' }) };
  };
  const engine = createAIEngine({ fetchImpl, decode: async () => ({ samples, sampleRate: SR }) });
  await engine.generate({ analysis: { flags: { silent: false }, wash: [], features: null }, audioBlob: new Blob([new Uint8Array([1])], { type: 'audio/webm' }), note, overrides: tier ? { completeness: tier } : {} });
  return sent.find((s) => s.url === '/api/generate').body.spec;
};
const fromSpec = (spec) => direct({ ...spec, family: 'G2-splash-wash', reference: 'gathered_02' });

test('typed notes and sung words: reliable words lead, a note stands in only when they are not, and each is named as itself', async () => {
  // Reliable sung words win over a typed note.
  const sung = await engineRun(short, { transcript: confident(SEA), lyrics: reading({ phraseComplete: false, completionConfidence: 0.6 }) }, { note: NOTE });
  assert.equal(sung.completeness, 'gathered');
  assert.equal(sung.concept.source, 'lyrics');
  assert.equal(sung.concept.text, 'clouds drifting low over the open sea');
  const s = fromSpec(sung);
  assert.match(s.sections.subject, /recognisable motif from the sung words: clouds drifting/);
  assert.doesNotMatch(s.prompt, /red kite/);
  // Unreliable words with a note: the note is the motif, named as the note.
  const noted = await engineRun(long, { transcript: unsure(SEA), lyrics: reading() }, { note: NOTE, tier: 'gathered' });
  assert.equal(noted.concept.source, 'note');
  const n = fromSpec(noted);
  assert.equal(n.sections.motif, GATHERED_MOTIF);
  assert.match(n.sections.subject, /recognisable motif from the note written for this moment: a red kite/);
  assert.doesNotMatch(n.prompt, /the sung words|clouds drifting/);
  assert.deepEqual(n.gatheredMotif, { applied: true, motif: NOTE, source: 'note' });
  // Unreliable words and no note: nothing is invented, the sound leads.
  const none = await engineRun(long, { transcript: unsure(SEA), lyrics: reading() }, { tier: 'gathered' });
  assert.equal(none.concept, null);
  const a = fromSpec(none);
  assert.equal(a.subjectSource, 'atmosphere');
  assert.equal(a.sections.motif ?? null, null);
  // A note never lifts the tier: the floor is for sung words only.
  const hummed = await engineRun(join(singers.hum(), singers.hum()), { transcript: confident('mm mm la la'), lyrics: reading({ lexical: false, coherent: false, structure: 'vocables' }) }, { note: NOTE });
  assert.equal(hummed.completeness, 'loose');
});

test('the performance shapes how the motif is painted but never erases it', () => {
  const concept = { source: 'lyrics', text: 'clouds drifting low over the open sea', theme: ['longing'], imagery: ['clouds', 'sea'], figurative: [] };
  const takes = { strong: long, weak: short, lyrics: sungLyrics(), shaky: sungLyrics({ vib: 120, gap: 0.3, glide: 0.4, seed: 5 }), spoken: spokenLyrics({ jitter: 0.5 }) };
  const perfs = Object.entries(takes).map(([k, x]) => [k, measurePerformance(x, SR)]).filter(([, p]) => p);
  let disordered = 0;
  for (const [k, performance] of [...perfs, ['none', null]]) {
    const d = direct({ completeness: 'gathered', family: 'G2-splash-wash', reference: 'gathered_02', seed: 7, motif: 'water', emotion: 'melancholic', energy: { value: 'lively' }, concept, performance });
    if (performance && performanceDirection(performance).disorder) disordered++;
    assert.equal(d.sections.motif, GATHERED_MOTIF, k);
    assert.equal(d.sections.form, GATHERED_MOTIF_FORM, k);
    assert.ok(d.prompt.includes(GATHERED_MOTIF) && d.prompt.includes(concept.text), k);
    assert.doesNotMatch(d.prompt, /a broken passage breaks the subject too/, k);
    if (performance) assert.match(d.sections.staging, /never erases it: a broken passage breaks its edges, not its identity/, k);
    assert.equal(checkPrompt(d).verdict, 'ok', `${k}: ${JSON.stringify(checkPrompt(d))}`);
  }
  assert.ok(disordered > 0, 'at least one take is measured as disordered');
});

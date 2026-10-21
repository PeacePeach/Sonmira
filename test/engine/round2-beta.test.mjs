// Round 2 Beta (Han, 21 Oct):
//   1. Concrete Imagery Floor: reliable lyrics naming concrete imagery are at
//      least Gathered, also when slow, unfinished or weakly sung.
//   2. Gathered names at least one motif actually sung.
//   3. References: no reuse from the person's last five paintings while the
//      tier has another; a painting that fails gives its reference back.
//   4. Resolved composition variety (looks.js) still holds as approved.
// The transcript and the reading are GIVEN (no paid call); the audio is the
// synthetic voices in synth.js, run through the real understandTake().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singers, sungLyrics, spokenLyrics, SR } from './synth.js';
import { analyzeTranscript, completionGate, imageryFloor, decideTier, IMAGERY_CALIBRATION } from '../../src/engine/interpret/lyrics.js';
import { concreteImagery } from '../../src/engine/interpret/imagery.js';
import { understandTake, semanticsFor, groundGathered } from '../../src/engine/understand.js';
import { cleanReading } from '../../src/engine/providers/openai-understand.js';
import { direct, GATHERED_MOTIF } from '../../src/engine/direct/index.js';
import { chooseLook, cleanRecent, rolling, isNearDuplicate, signatureOf, RECENT_LOOKS, ROLLING } from '../../src/engine/direct/looks.js';
import { createHandler, eligibleRecentReferences, RECENT_COUNT } from '../../api/generate.js';
import { memoryKV } from '../../server/protect/kv.js';
import { fakeReferenceStore } from '../../server/dev/fake-openai.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';
import { LIBRARY } from '../../src/engine/direct/library.js';

const REGRESSION = '我多么爱那澄蓝的天，那是浸透着阳光的海';
const tokens = (text) => (/[一-鿿]/.test(text) ? [...text.replace(/\s/g, '')] : text.split(/\s+/));
const transcriptOf = (text, p = 0.85) => analyzeTranscript(text, { logprobs: tokens(text).map((token) => ({ token, logprob: Math.log(p) })) });
const reading = (o = {}) => cleanReading({
  language: 'zh', lexical: true, coherent: true, structure: 'fragment', unfinished: true, linked: false, missing: 'the rest of the line',
  phraseComplete: false, completionConfidence: 0.5, completionReason: 'cut mid-line',
  theme: ['love', 'longing'], imagery: ['clear blue sky', 'sunlit sea'], figurative: [], mood: 'tender', motif: 'water',
  concepts: { loose: 'slow marks opening outward', gathered: 'a clear blue sky above a sea soaked in sunlight', resolved: 'a wide sunlit sea under a clear sky' }, ...o,
});
const run = (samples, words) => understandTake({ samples, sampleRate: SR, words: words ? async () => words : null });

// ── 1. classification ─────────────────────────────────────────────────────

test('concrete imagery is found in the words actually sung, in order; feelings and time words are not imagery', () => {
  assert.deepEqual(concreteImagery(REGRESSION).map((f) => f.motif), ['sky', 'sunlight', 'sea']);
  assert.deepEqual(concreteImagery('the clouds drift over the sea').map((f) => f.motif), ['clouds', 'sea']);
  assert.deepEqual(concreteImagery('moonlight on the river, and rain').map((f) => f.motif), ['moon', 'river', 'rain']);
  for (const abstract of ['我爱你 想你 好想你', '思念 和 悲伤', 'I love you, I miss you, I long for you', 'sadness and longing and love',
    '今天天气很好', '天啊我好想你', '五月的我们', '我们一路走来', '她的心很浪漫', 'she leaves me tonight']) {
    assert.deepEqual(concreteImagery(abstract), [], abstract);
  }
});

test('regression: "我多么爱那澄蓝的天，那是浸透着阳光的海", reliably transcribed, is at least Gathered (slow, unfinished, weak)', async () => {
  for (const [name, take] of [['weak', singers.weak()], ['slow', sungLyrics({ syl: [1.2, 1.6] })], ['slow and soft', sungLyrics({ syl: [1.4, 2.0], amp: 0.03 })]]) {
    const u = await run(take, { transcript: transcriptOf(REGRESSION), lyrics: reading() });
    assert.notEqual(u.tier, 'loose', `${name}: ${u.decision.reason}`);
    assert.equal(u.tier, 'gathered', name);
    // A single cut-off fragment is not a meaningful phrase for the lyrical floor; the imagery floor carries it.
    assert.equal(u.lyricalFloor.applied, false, name);
    assert.equal(u.imageryFloor.applied, true, name);
    assert.equal(u.decision.stage, 'imagery_floor');
    assert.deepEqual(u.imageryFloor.evidence.motifs, ['sky', 'sunlight', 'sea']);
  }
});

// The singing analysis of a weak take that misses the full sung bar but
// still holds some notes, and the matching gate.
const weakVocal = { voicedSec: 4.2, sustainedRatio: 0.22, sung: false, sungChecks: [{ id: 'sustained_ratio', ok: false, value: 0.22, need: '≥ 0.3' }] };
const gateFor = (text, lyrics, { vocal = weakVocal, soundingSec = 12, p = 0.85 } = {}) => {
  const transcript = transcriptOf(text, p);
  const singing = { vocal };
  const features = { activity: { soundingSec, voicedSec: vocal.voicedSec }, phrases: { count: 6 } };
  const gate = completionGate({ transcript, lyrics, singing, features });
  return { gate, transcript, lyrics, singing, features };
};

test('weakly sung (misses the sung bar) and very slow (under the word-rate floor): imagery still gives Gathered', () => {
  const x = gateFor(REGRESSION, reading(), { soundingSec: 120 });
  assert.ok(x.gate.failed.includes('sung'));
  assert.ok(x.gate.failed.includes('word_rate'));
  const f = imageryFloor(x);
  assert.equal(f.applied, true, f.reason);
  assert.equal(decideTier({ gate: x.gate, quality: { strong: true }, imagery: f }).tier, 'gathered', 'never Resolved through the floor');
});

test('abstract emotions alone do not trigger the floor', () => {
  const love = '我爱你 我想你 我多么思念你';
  const x = gateFor(love, reading({ imagery: [], theme: ['love', 'longing'] }));
  const f = imageryFloor(x);
  assert.equal(f.applied, false);
  assert.match(f.reason, /concrete_imagery/);
  assert.equal(decideTier({ gate: x.gate, quality: null, imagery: f }).tier, 'loose');
});

test('protection against unreliable words: hallucination, low or missing ASR confidence, incoherent reading, imagery only in the reading', () => {
  const cases = {
    hallucination: () => { const x = gateFor('thank you for watching the sea and the sky', reading()); return x; },
    lowConfidence: () => gateFor(REGRESSION, reading(), { p: 0.4 }),
    noConfidence: () => { const x = gateFor(REGRESSION, reading()); const t = analyzeTranscript(REGRESSION); return { ...x, transcript: t, gate: completionGate({ ...x, transcript: t }) }; },
    incoherent: () => gateFor(REGRESSION, reading({ coherent: false })),
    vocables: () => gateFor('la la la ooh mm', reading({ lexical: false, structure: 'vocables', imagery: [] })),
    readingOnly: () => gateFor('我多么爱那 那是浸透着', reading()), // the reading lists imagery the transcript never names
    transcriptOnly: () => gateFor(REGRESSION, reading({ imagery: [] })), // the reading saw no imagery: not confirmed
  };
  for (const [name, make] of Object.entries(cases)) {
    const x = make();
    assert.equal(x.gate.pass, false, name);
    const f = imageryFloor(x);
    assert.equal(f.applied, false, `${name}: ${f.reason}`);
    assert.equal(decideTier({ gate: x.gate, quality: null, imagery: f }).tier, 'loose', name);
  }
});

test('speech and humming stay Loose: the voice must hold some notes', async () => {
  const speech = await run(spokenLyrics(), { transcript: transcriptOf(REGRESSION), lyrics: reading() });
  assert.equal(speech.singing.vocal.sung, false);
  assert.ok(speech.singing.vocal.sustainedRatio < IMAGERY_CALIBRATION.minSustainedRatio);
  assert.equal(speech.tier, 'loose', speech.decision.reason);
  assert.match(speech.imageryFloor.reason, /some_held_notes/);
  const hum = await run(singers.hum(), { transcript: transcriptOf('mm mm la la'), lyrics: reading({ lexical: false, coherent: false, structure: 'vocables', imagery: [] }) });
  assert.equal(hum.tier, 'loose');
});

test('the existing Lyrical Floor and Resolved requirements are unchanged', async () => {
  // A meaningful multi-line excerpt: still the lyrical floor (the imagery floor is not consulted).
  const lines = await run(sungLyrics(), { transcript: transcriptOf('the clouds drift over the sea and carry me home tonight'), lyrics: reading({ language: 'en', structure: 'multiple_fragments' }) });
  assert.equal(lines.decision.stage, 'lyrical_floor');
  assert.equal(lines.imageryFloor, null);
  // A complete phrase: the gate decides, and Resolved still needs strong singing.
  const complete = await run(singers.strong(), { transcript: transcriptOf('the moon is shining on the quiet sea'), lyrics: reading({ language: 'en', structure: 'clause', unfinished: false, linked: true, phraseComplete: true, completionConfidence: 0.9 }) });
  assert.equal(complete.gate.pass, true);
  assert.equal(complete.decision.stage, 2);
  assert.equal(complete.tier, complete.singing.quality.strong ? 'resolved' : 'gathered');
  // Through the imagery floor a take is never Resolved, however well sung.
  const fragment = await run(singers.strong(), { transcript: transcriptOf(REGRESSION), lyrics: reading() });
  assert.equal(fragment.tier, 'gathered');
});

// ── 2. Gathered grounded in the lyrics ────────────────────────────────────

test('a Gathered concept that already names a sung motif is kept byte for byte', () => {
  const s = semanticsFor('gathered', transcriptOf(REGRESSION), reading());
  assert.equal(s.concept.text, 'a clear blue sky above a sea soaked in sunlight');
  assert.deepEqual(s.grounding, { motifs: ['sky', 'sunlight', 'sea'], added: false });
});

test('a Gathered concept with no sung motif gets the first one or two sung motifs, nothing invented', () => {
  const drifted = reading({ concepts: { loose: 'x', gathered: 'a single paper boat folded from a letter', resolved: 'y' } });
  const s = semanticsFor('gathered', transcriptOf(REGRESSION), drifted);
  assert.equal(s.concept.text, 'the sky and sunlight; a single paper boat folded from a letter');
  assert.deepEqual(s.grounding, { motifs: ['sky', 'sunlight'], added: true });
  // An empty Gathered concept becomes the sung motifs alone, instead of no words at all.
  assert.equal(groundGathered('', 'the moon over the river').text, 'the moon and the river');
  // The painting prompt: the motif rule, and the sung motif in the subject; semi-abstract form unchanged.
  const d = direct({ completeness: 'gathered', seed: 7, motif: 'water', emotion: 'tender', energy: { value: 'calm' }, concept: { ...s.concept, source: 'lyrics' } });
  assert.equal(d.sections.motif, GATHERED_MOTIF);
  assert.match(d.sections.subject, /recognisable motif from the sung words: the sky and sunlight; a single paper boat/);
  assert.equal(d.gatheredMotif.applied, true);
});

test('grounding applies to Gathered only, and only with concrete sung imagery', () => {
  const drifted = reading({ concepts: { loose: 'slow marks', gathered: 'a paper boat', resolved: 'a boat on a quiet harbour' } });
  assert.equal(semanticsFor('loose', transcriptOf(REGRESSION), drifted).concept.text, 'slow marks');
  assert.equal(semanticsFor('resolved', transcriptOf(REGRESSION), drifted).concept.text, 'a boat on a quiet harbour');
  const abstract = semanticsFor('gathered', transcriptOf('我爱你 我想你'), drifted);
  assert.equal(abstract.concept.text, 'a paper boat');
  assert.equal(abstract.grounding, undefined);
  // Unreliable words carry nothing, grounded or not.
  assert.equal(semanticsFor('gathered', transcriptOf(REGRESSION, 0.3), drifted).concept, null);
});

// ── 3. reference history ──────────────────────────────────────────────────

test('reference avoidance covers the last five paintings', () => {
  assert.equal(RECENT_COUNT, 5);
  const pool = LIBRARY.tierPool('resolved');
  const history = pool.slice(0, 6).map((e, i) => ({ id: e.id, key: String(i) }));
  const eligible = eligibleRecentReferences(pool, history).map((e) => e.id);
  for (const e of pool.slice(1, 6)) assert.ok(!eligible.includes(e.id), `${e.id} was used in the last five`);
  assert.ok(eligible.includes(pool[0].id), 'the sixth most recent is allowed again');
  // Other tiers' paintings count toward the five but never block this tier's references.
  const mixed = [...LIBRARY.tierPool('loose').slice(0, 2), ...pool.slice(0, 3)].map((e, i) => ({ id: e.id, key: String(i) }));
  assert.deepEqual(eligibleRecentReferences(pool, mixed).map((e) => e.id), pool.slice(3).map((e) => e.id));
});

test('a pool smaller than five falls back to the least recently used reference', () => {
  const gathered = LIBRARY.tierPool('gathered'); // 5 references
  const [a, b, c, d, e] = gathered.map((x) => x.id);
  const h = (...ids) => ids.map((id, i) => ({ id, key: String(i) }));
  assert.deepEqual(eligibleRecentReferences(gathered, h(c, a, b, d, e)).map((x) => x.id), [c]);
  assert.deepEqual(eligibleRecentReferences(gathered, h(a, b, c, d, a)).map((x) => x.id), [e], 'an unused one first');
  const loose = LIBRARY.tierPool('loose'); // 3 references
  const [x, y, z] = loose.map((r) => r.id);
  assert.deepEqual(eligibleRecentReferences(loose, h(x, y, z, x, y)).map((r) => r.id), [z]);
  assert.deepEqual(eligibleRecentReferences(loose, h(y, z, x, z, y)).map((r) => r.id), [x]);
});

function call(handler, body, key, account = 'install-1') {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, json: j }); } };
    handler({ method: 'POST', body, headers: { 'idempotency-key': key }, sonmiraInstallId: account }, res);
  });
}
const okImage = async () => ({ ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QUJD","usage":{"total_tokens":1}}\n' });
const failImage = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }), text: async () => '{"error":{"message":"boom"}}' });
const spec = (seed, completeness = 'gathered') => ({ spec: { completeness, emotion: 'tender', motif: 'water', seed, energy: { value: 'calm' } } });
const recent = async (kv, account = 'install-1') => JSON.parse((await kv.get(`refs:recent:${account}`)) || '[]');

test('five successful paintings in a row never repeat a reference in a tier with enough of them', async () => {
  const kv = memoryKV();
  const handler = createHandler({ store: fakeReferenceStore(REFERENCE_LIBRARY), env: { OPENAI_API_KEY: 'k' }, fetchImpl: okImage, kv });
  const used = [];
  for (let i = 0; i < 12; i++) {
    const r = await call(handler, spec(1000 + i, 'resolved'), `take-${i}`);
    assert.equal(r.code, 200, JSON.stringify(r.json));
    used.push(r.json.reference);
  }
  for (let i = 5; i < used.length; i++) assert.ok(!used.slice(i - 5, i).includes(used[i]), `painting ${i} reused ${used[i]} from ${used.slice(i - 5, i)}`);
});

test('a failed painting gives its reference back; it never takes a history slot', async () => {
  const kv = memoryKV();
  const store = fakeReferenceStore(REFERENCE_LIBRARY);
  const ok = createHandler({ store, env: { OPENAI_API_KEY: 'k' }, fetchImpl: okImage, kv });
  const failing = createHandler({ store, env: { OPENAI_API_KEY: 'k' }, fetchImpl: failImage, kv });
  await call(ok, spec(1), 'a');
  const before = await recent(kv);
  assert.equal(before.length, 1);
  const r = await call(failing, spec(2), 'b');
  assert.notEqual(r.code, 200);
  assert.deepEqual(await recent(kv), before, 'the provider failure left no entry');
  // Before any provider call: no store (503 no_reference) also gives it back.
  const noStore = createHandler({ store: null, env: { OPENAI_API_KEY: 'k' }, fetchImpl: okImage, kv });
  const n = await call(noStore, spec(3), 'c');
  assert.equal(n.code, 503);
  assert.deepEqual(await recent(kv), before, 'the no-reference response left no entry');
  // A retry of the same take after a failure draws again; after success it keeps its reference.
  await call(ok, spec(2), 'b');
  assert.equal((await recent(kv)).length, 2);
});

// ── 4. Resolved composition variety (looks.js), as approved on 19 Oct ─────

const opt = (o) => ({ direction: 'A', image: 'a wide shore at dusk', distance: 'wide', angle: 'eye_level', figures: 'none', space: 'exterior', lead: 'landscape', figure: '', motifs: [], necessary: false, ...o });

test('recent five: a near-duplicate of any of the last five is not chosen while a comparable option is new', () => {
  const dup = opt({ direction: 'B', image: 'hands holding a cup by a window', distance: 'close', angle: 'eye_level', space: 'interior', lead: 'object', motifs: ['cup'] });
  const fresh = opt({ direction: 'C', image: 'a paper crane drifting on a pond', distance: 'medium', angle: 'high', lead: 'symbol', motifs: ['paper crane'] });
  const old = signatureOf(cleanRecent([dup])[0]);
  const filler = (i) => ({ direction: 'D', distance: 'medium', angle: 'low', figures: 'none', space: 'exterior', lead: 'object', motifs: [`thing${i}`] });
  for (let age = 0; age < RECENT_LOOKS; age++) {
    const hist = [...Array.from({ length: RECENT_LOOKS - 1 - age }, (_, i) => filler(i)), old, ...Array.from({ length: age }, (_, i) => filler(10 + i))];
    assert.equal(cleanRecent(hist).length, RECENT_LOOKS);
    assert.ok(isNearDuplicate(cleanRecent([dup])[0], cleanRecent(hist).at(-1 - age)));
    const look = chooseLook({ options: [dup, fresh], recent: hist, seed: 1 });
    assert.equal(look.direction, 'C', `the duplicate at age ${age} was chosen`);
  }
  // Six back is outside the window: the strongest option wins again.
  const six = [old, ...Array.from({ length: RECENT_LOOKS }, (_, i) => filler(i))];
  assert.equal(chooseLook({ options: [dup, fresh], recent: six, seed: 1 }).direction, 'B');
});

test('rolling three: motifs of the last three are not repeated, and a wide scene is owed after two that were not wide', () => {
  const moon = opt({ direction: 'C', image: 'the moon caught in a puddle', distance: 'close', lead: 'symbol', motifs: ['moon'] });
  const room = opt({ direction: 'E', image: 'an empty room with a chair', distance: 'medium', space: 'interior', lead: 'space', motifs: ['chair'] });
  const wide = opt({ direction: 'A', image: 'a long coastline under rain', motifs: ['coast'] });
  const narrow = (m) => ({ direction: 'B', distance: 'close', angle: 'eye_level', figures: 'none', space: 'interior', lead: 'object', motifs: [m] });
  // The moon was in the last three: the next option is chosen.
  const withMoon = [narrow('celestial'), { ...narrow('cup'), distance: 'wide', space: 'exterior', lead: 'landscape' }];
  assert.equal(chooseLook({ options: [moon, room], recent: withMoon, seed: 1 }).direction, 'E');
  // Two in a row not wide: the wide option is chosen though it ranks last.
  const twoNarrow = [narrow('cup'), narrow('key')];
  assert.equal(rolling(cleanRecent(twoNarrow)).wideNeeded, true);
  const l = chooseLook({ options: [room, moon, wide], recent: twoNarrow, seed: 1 });
  assert.equal(l.direction, 'A');
  assert.equal(l.diversity.wide, 'chosen to meet the rolling-three wide rule');
  assert.equal(ROLLING, 3);
});

test('exceptions: an image the words demand overrides the recent-five and rolling-three rules', () => {
  const demanded = opt({ direction: 'B', image: 'a moon held in cupped hands', distance: 'close', space: 'exterior', lead: 'object', motifs: ['moon'], necessary: true });
  const other = opt({ direction: 'A', image: 'a wide valley at dawn', motifs: ['valley'] });
  const hist = cleanRecent([{ direction: 'B', distance: 'close', angle: 'eye_level', figures: 'none', space: 'exterior', lead: 'object', motifs: ['celestial'] }, { direction: 'B', distance: 'close', angle: 'low', figures: 'none', space: 'interior', lead: 'object', motifs: ['cup'] }]);
  const l = chooseLook({ options: [demanded, other], recent: hist, seed: 1 });
  assert.equal(l.direction, 'B');
  assert.match(l.reason, /the words demand this image/);
  // Not marked necessary: the same option gives way.
  assert.equal(chooseLook({ options: [{ ...demanded, necessary: false }, other], recent: hist, seed: 1 }).direction, 'A');
});

test('the Resolved look history is written only after a successful painting', async () => {
  const kv = memoryKV();
  const store = fakeReferenceStore(REFERENCE_LIBRARY);
  const concept = { source: 'lyrics', text: 'a wide sea at dusk', theme: [], imagery: ['sea'], figurative: [],
    scene: { situation: 'waiting', relationship: '', tension: '', moment: 'a wide sea at dusk, one light far out', figure: '', event: '', core: '', options: [opt({ image: 'a wide sea at dusk, one light far out', motifs: ['sea'] })] } };
  const body = (seed) => ({ spec: { ...spec(seed, 'resolved').spec, concept } });
  await call(createHandler({ store, env: { OPENAI_API_KEY: 'k' }, fetchImpl: failImage, kv }), body(1), 'x');
  assert.equal(await kv.get('looks:resolved:install-1'), null);
  const r = await call(createHandler({ store, env: { OPENAI_API_KEY: 'k' }, fetchImpl: okImage, kv }), body(2), 'y');
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.equal(JSON.parse(await kv.get('looks:resolved:install-1')).length, 1);
});

// Han, 19 Oct: a Resolved painting shows a meaningful moment from the song,
// not an illustration of one lyric keyword. The words are read as a scene
// (situation, relationship, tension, moment) in the same text-model call;
// direct() adds it to the Resolved prompt only.
//   lyrics → the scene · reference → style and finish · performance → composition
// The reading is GIVEN (no paid call); the audio is synth.js through the
// real understandTake().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singers, sungLyrics, SR } from './synth.js';
import { analyzeTranscript } from '../../src/engine/interpret/lyrics.js';
import { understandTake } from '../../src/engine/understand.js';
import { cleanReading, SCENE_KEYS, SYSTEM } from '../../src/engine/providers/openai-understand.js';
import { measurePerformance } from '../../src/engine/analysis/performance-measure.js';
import { direct, RESOLVED_FINISH, NARRATIVE_RULE, NARRATIVE_STAGING, narrativeFor, checkPrompt, CONTENT_RULE, CONTENT_RULE_FIGURE, FIGURE_RULE, AVOID_PEOPLE, AVOID_PEOPLE_FIGURE } from '../../src/engine/direct/index.js';
import { REFERENCE_AUTHORITY_PERFORMANCE_RESOLVED } from '../../src/engine/direct/library.js';
import { cleanConcept } from '../../api/generate.js';

const LINES = 'standing at the intersection unsure which way to go while I cannot turn back';
const SCENE = {
  situation: 'At the place where the road divides, no way is chosen, and the way back is gone.',
  relationship: 'Two directions pull apart; what was shared is behind and cannot be reached again.',
  tension: 'Hesitation and sadness at a choice that will separate, with no turning back.',
  moment: 'Roads diverging at dusk, footprints in the wet ground that stop where they split, the road behind washed out by rain, one lantern set down at the fork, its light reaching a little way down each road.',
  figure: '',
};
// Han's crossroads choice: a small figure looking back at the intersection.
const FIGURE = 'one small, distant figure on the far road, looking back at the fork';
const FIGURE_SCENE = { ...SCENE, moment: `${SCENE.moment.replace(/\.$/, '')}, and far down one road ${FIGURE.replace(/^one /, 'a ')}.`, figure: FIGURE };
const reading = (o = {}) => cleanReading({
  language: 'en', lexical: true, coherent: true, structure: 'clause', unfinished: false, linked: true, missing: '',
  phraseComplete: true, completionConfidence: 0.9, completionReason: 'a full line',
  theme: ['indecision', 'separation'], imagery: ['intersection', 'road'], figurative: [], mood: 'melancholic', motif: 'abstract',
  scene: SCENE,
  concepts: { loose: 'marks that stall and pull apart', gathered: 'paths half-emerging and dividing', resolved: SCENE.moment }, ...o,
});
const confident = (text) => analyzeTranscript(text, { logprobs: text.split(/\s+/).map((token) => ({ token, logprob: Math.log(0.9) })) });
const join = (...xs) => { const out = new Float32Array(xs.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length; } return out; };
const strong = join(singers.strong(), singers.strong());
const weak = join(singers.weak(), singers.weak());

const perf = measurePerformance(sungLyrics(), SR);
const paint = (completeness, family, reference, concept, performance = perf) => direct({ completeness, family, reference, seed: 7, motif: 'abstract', emotion: 'melancholic', energy: { value: 'lively' }, concept, performance });
const R = ['resolved', 'R3-vivid-wash-focal', 'resolved_02'];
const G = ['gathered', 'G2-splash-wash', 'gathered_02'];
const L = ['loose', 'L2-bloom-field', 'loose_02'];
const WITH = { source: 'lyrics', text: SCENE.moment, theme: ['indecision', 'separation'], imagery: ['intersection', 'road'], figurative: [], scene: SCENE };
// Before this change: the same concept with no scene.
const { scene: _s, ...WITHOUT } = WITH; // eslint-disable-line no-unused-vars

test('the reading carries a bounded scene plan', () => {
  const r = reading();
  assert.deepEqual(Object.keys(r.scene), SCENE_KEYS);
  assert.equal(r.scene.moment, SCENE.moment);
  const long = reading({ scene: { ...SCENE, moment: 'x'.repeat(900), tension: 'y'.repeat(900) } });
  assert.ok(long.scene.moment.length <= 320 && long.scene.tension.length <= 160);
  // A reading without a scene (an older model reply) gives empty strings, so no narrative.
  const none = reading({ scene: undefined });
  assert.deepEqual(none.scene, { situation: '', relationship: '', tension: '', moment: '', figure: '' });
  assert.ok(reading({ scene: { ...SCENE, figure: 'z'.repeat(400) } }).scene.figure.length <= 120);
});

test('a Resolved take carries the scene into its concept; Gathered does not', async () => {
  const r = await understandTake({ samples: strong, sampleRate: SR, words: async () => ({ transcript: confident(LINES), lyrics: reading() }) });
  assert.equal(r.tier, 'resolved');
  assert.deepEqual(r.semantics.concept.scene, SCENE);
  const g = await understandTake({ samples: weak, sampleRate: SR, words: async () => ({ transcript: confident(LINES), lyrics: reading() }) });
  assert.equal(g.tier, 'gathered');
  assert.equal(g.semantics.concept.scene, undefined);
  // The server keeps it, bounded.
  const c = cleanConcept({ ...r.semantics.concept, source: 'lyrics' });
  assert.deepEqual(c.scene, SCENE);
  assert.equal(cleanConcept({ ...c, scene: { moment: '' } }).scene, undefined);
});

test('Resolved paints a scene brief, not a keyword: situation, relationship, tension and the moment', () => {
  const before = paint(...R, WITHOUT), after = paint(...R, WITH);
  assert.equal(before.sections.narrative, null);
  assert.equal(before.narrative.applied, false);
  assert.equal(after.narrative.applied, true);
  const n = after.sections.narrative;
  assert.match(n, /^The moment from the sung words: At the place where the road divides/);
  assert.match(n, /Relationship: Two directions pull apart/);
  assert.match(n, /Tension: Hesitation and sadness/);
  assert.match(n, /Paint this scene: Roads diverging at dusk, footprints .* one lantern set down at the fork/);
  assert.ok(n.includes(NARRATIVE_RULE));
  assert.match(NARRATIVE_RULE, /never a decorative symbol, a single keyword object or a generic landscape/);
  // The brief is more than the keyword: the imagery words alone are not the scene.
  assert.notEqual(after.subject, 'intersection');
  assert.ok(n.split(/\s+/).length > 60);
  // It sits right after the words' meaning and before the technique; everything else is unchanged.
  const lines = after.prompt.split('\n');
  assert.equal(lines.indexOf(n), lines.indexOf(after.sections.meaning) + 1);
  assert.equal(lines.filter((l) => l !== n).join('\n'), before.prompt);
  assert.equal(checkPrompt(after).verdict, 'ok', JSON.stringify(checkPrompt(after)));
});

test('Resolved keeps lyric meaning and the reference\'s finish', () => {
  const d = paint(...R, WITH);
  assert.match(d.sections.subject, /Roads diverging at dusk/);
  assert.match(d.sections.meaning, /theme: indecision, separation; imagery: intersection, road/);
  assert.equal(d.sections.finish, RESOLVED_FINISH);
  assert.equal(d.resolvedFinish.applied, true);
  assert.equal(d.referencePrompt, REFERENCE_AUTHORITY_PERFORMANCE_RESOLVED);
  assert.match(d.referencePrompt, /Content never comes from the reference/);
});

test('the narrative is staged inside the performance composition, which it does not change', () => {
  const d = paint(...R, WITH), before = paint(...R, WITHOUT), g = paint(...G, WITH);
  assert.ok(d.sections.narrative.endsWith(NARRATIVE_STAGING));
  for (const s of ['form', 'composition', 'staging', 'passages', 'marks', 'contrast', 'palette', 'disorder']) {
    assert.equal(d.sections[s], before.sections[s], s);
  }
  for (const s of ['composition', 'passages', 'marks', 'contrast', 'disorder']) assert.equal(d.sections[s], g.sections[s], s);
  assert.deepEqual(d.performanceTrace, before.performanceTrace);
  // A different performance still gives a different composition under the same scene.
  const other = paint(...R, WITH, measurePerformance(join(singers.weak(), singers.hum()), SR));
  assert.equal(other.sections.narrative, d.sections.narrative);
  assert.notEqual(other.sections.composition + other.sections.passages, d.sections.composition + d.sections.passages);
});

test('Loose and Gathered are unchanged, even if a scene reaches them', () => {
  for (const t of [L, G]) {
    const a = paint(...t, WITH), b = paint(...t, WITHOUT);
    assert.equal(a.prompt, b.prompt, t[0]);
    assert.equal(a.sections.narrative, null);
    assert.deepEqual(a.narrative, { applied: false, reason: `tier ${t[0]}`, figure: null });
    // A scene figure never reaches Loose or Gathered: the no-people rule holds.
    const f = paint(...t, { ...WITH, scene: FIGURE_SCENE });
    assert.equal(f.sections.content, CONTENT_RULE);
    assert.ok(f.avoid.includes(AVOID_PEOPLE) && !f.avoid.includes(AVOID_PEOPLE_FIGURE));
    assert.ok(!f.prompt.includes(FIGURE));
  }
});

test('without a measured performance the scene is still painted, without the staging line', () => {
  const d = direct({ completeness: 'resolved', family: R[1], reference: R[2], seed: 7, motif: 'abstract', emotion: 'melancholic', energy: { value: 'lively' }, concept: WITH });
  assert.equal(d.narrative.applied, true);
  assert.ok(d.prompt.includes(d.sections.narrative));
  assert.ok(!d.sections.narrative.includes(NARRATIVE_STAGING));
});

test('no people: a scene part naming people is dropped, a moment naming people is not painted', () => {
  const partly = narrativeFor('resolved', { ...WITH, scene: { ...SCENE, relationship: 'A woman and her child are parted.' } });
  assert.equal(partly.applied, true);
  assert.deepEqual(partly.dropped, ['relationship']);
  assert.ok(!/woman|child/.test(partly.line));
  const moment = narrativeFor('resolved', { ...WITH, scene: { ...SCENE, moment: 'A lone figure stands at the fork.' } });
  assert.deepEqual(moment, { applied: false, reason: 'the scene names people', line: null, figure: null });
  const d = paint(...R, { ...WITH, scene: { ...SCENE, relationship: 'Two lovers part at the fork.' } });
  assert.equal(checkPrompt(d).verdict, 'ok');
  assert.ok(d.prompt.includes('No people anywhere'));
});

// ── Small figures (Han, 19 Oct): Resolved only, optional, never prominent ──
test('Resolved without a scene figure keeps the no-people rule: no figure is added because the tier is Resolved', () => {
  for (const c of [WITH, WITHOUT]) {
    const d = paint(...R, c);
    assert.equal(d.narrative.figure, null);
    assert.equal(d.sections.content, CONTENT_RULE);
    assert.match(CONTENT_RULE, /No people anywhere/);
    assert.ok(d.avoid.includes(AVOID_PEOPLE));
    assert.ok(!d.prompt.includes(FIGURE_RULE));
    assert.equal(checkPrompt(d).verdict, 'ok');
  }
});

test('the crossroads: a small figure looking back at the fork, small, distant and faceless', () => {
  const d = paint(...R, { ...WITH, text: FIGURE_SCENE.moment, scene: FIGURE_SCENE }), plain = paint(...R, WITH);
  assert.equal(d.narrative.applied, true);
  assert.equal(d.narrative.figure, FIGURE);
  assert.ok(d.sections.narrative.includes(`Figure: ${FIGURE}. ${FIGURE_RULE}`));
  assert.match(FIGURE_RULE, /Small, distant and faceless/);
  assert.equal(d.sections.content, CONTENT_RULE_FIGURE);
  assert.match(CONTENT_RULE_FIGURE, /never a portrait, a visible face, a large or foreground figure, or any people the scene does not name/);
  assert.ok(d.avoid.includes(AVOID_PEOPLE_FIGURE) && !d.avoid.includes(AVOID_PEOPLE));
  const c = checkPrompt(d);
  assert.equal(c.verdict, 'ok', JSON.stringify(c));
  assert.deepEqual(c.people, []);
  assert.ok(c.figures.length > 0);
  // Finish and performance stay as they were.
  assert.equal(d.sections.finish, RESOLVED_FINISH);
  for (const s of ['form', 'composition', 'staging', 'passages', 'marks', 'contrast', 'palette', 'disorder']) assert.equal(d.sections[s], plain.sections[s], s);
});

test('a prominent figure or a face is never painted', () => {
  for (const figure of ['a large figure in the foreground', 'a portrait of her face', 'a crowd at the fork', 'close-up of his eyes']) {
    const n = narrativeFor('resolved', { ...WITH, scene: { ...FIGURE_SCENE, figure } });
    assert.equal(n.figure, null, figure);
    assert.equal(n.applied, false, figure);
    assert.match(n.reason, /too prominent/);
    // Without a figure in the moment, the scene is still painted, with no people.
    const traces = narrativeFor('resolved', { ...WITH, scene: { ...SCENE, figure } });
    assert.equal(traces.applied, true);
    assert.equal(traces.figure, null);
    assert.deepEqual(traces.dropped, ['figure']);
  }
  const face = narrativeFor('resolved', { ...WITH, scene: { ...FIGURE_SCENE, moment: 'A small figure at the fork, her face turned back.' } });
  assert.equal(face.applied, false);
  // A face named in the subject is caught by the prompt check even with a figure.
  const d = paint(...R, { ...WITH, text: 'a small figure at the fork, her face turned back', scene: FIGURE_SCENE });
  assert.equal(checkPrompt(d).verdict, 'leak');
});

test('the scene instructions teach the reasoning, not a reusable scene template', () => {
  const plan = SYSTEM.slice(SYSTEM.indexOf('- scene:'), SYSTEM.indexOf('- concepts,'));
  // Han, 19 Oct: no concrete stock imagery that could anchor unrelated songs.
  for (const stock of ['lantern', 'footprint', 'rain', 'dusk', 'crossroads', 'intersection', 'fork', 'road', 'path']) assert.ok(!new RegExp(`\\b${stock}`, 'i').test(plan), stock);
  assert.match(plan, /Reason from this song's own words: what is happening, between what, with what tension/);
  assert.match(plan, /never from a stock or reusable scene/);
  assert.match(plan, /Invent no story unrelated to the words/);
});

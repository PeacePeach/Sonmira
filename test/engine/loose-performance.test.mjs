// Loose follows the performance (Phase 2, 18 Oct): the reference gives the
// artistic language; how the voice moved gives the composition, marks and
// colour character (direct/sound.js). Gathered and Resolved are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, FAMILIES, LIBRARY, createLibrary, checkPrompt, REFERENCE_ONLY_STYLE } from '../../src/engine/direct/index.js';
import { REFERENCE_AUTHORITY, REFERENCE_AUTHORITY_LOOSE } from '../../src/engine/direct/library.js';
import { soundPlan, HUE_FREEDOM } from '../../src/engine/direct/sound.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';
import { expressionFor } from '../../src/engine/understand.js';
import { melodicContour } from '../../src/engine/analysis/singing.js';
import { createHandler } from '../../api/generate.js';

const GENTLE = { range: 'narrow', flow: 'connected', dynamics: 'even', vibrato: false, contour: 'level', register: 'low', phrasing: 'single', rhythm: 'regular', line: 'smooth' };
const ENERGETIC = { range: 'wide', flow: 'broken', dynamics: 'swelling', vibrato: true, contour: 'rising', register: 'high', phrasing: 'many', rhythm: 'irregular', line: 'stepped' };
const loose = (expression, energy, extra = {}) => direct({ completeness: 'loose', emotion: 'tender', motif: 'abstract', seed: 7, family: 'L2-bloom-field', reference: 'loose_02', soundOnly: true, energy: { value: energy }, expression, ...extra });
const words = (s) => s.split(/\s+/).filter(Boolean);
// Share of the request's words that sit in lines that differ between two
// requests (how the audit measured "about 15 of 606 words").
function changedShare(a, b) {
  const B = new Set(b.split('\n'));
  const lines = a.split('\n');
  return lines.filter((l) => !B.has(l)).reduce((n, l) => n + words(l).length, 0) / words(a).length;
}

test('the Loose plan comes from the audio alone: same performance, same plan, whatever the seed', () => {
  const a = loose(ENERGETIC, 'lively'), b = loose(ENERGETIC, 'lively', { seed: 99 });
  for (const k of ['composition', 'marks', 'palette']) assert.equal(a.sections[k], b.sections[k], k);
  assert.deepEqual(a.performance, b.performance);
});

test('contrasting performances on the same reference give clearly different instructions', () => {
  const g = loose(GENTLE, 'calm'), e = loose(ENERGETIC, 'lively');
  assert.equal(g.reference.id, e.reference.id);
  for (const k of ['composition', 'marks', 'palette']) assert.notEqual(g.sections[k], e.sections[k], k);
  const full = (d) => `${d.referencePrompt}\n${d.prompt}`;
  // Before Phase 2, about 2.5 % of the words differed (pace and gesture only).
  assert.ok(changedShare(full(e), full(g)) > 0.2, `only ${(changedShare(full(e), full(g)) * 100).toFixed(1)} % differs`);
});

test('every performance variable changes the Loose prompt', () => {
  const alt = { range: 'wide', flow: 'broken', dynamics: 'swelling', vibrato: true, contour: 'falling', register: 'high', phrasing: 'many', rhythm: 'irregular', line: 'stepped' };
  const base = loose(GENTLE, 'calm').prompt;
  for (const [k, v] of Object.entries(alt)) assert.notEqual(loose({ ...GENTLE, [k]: v }, 'calm').prompt, base, k);
  // A falling melody sung high must not also be told to sit high.
  assert.doesNotMatch(loose({ ...GENTLE, contour: 'falling', register: 'high' }, 'calm').sections.composition, /sits high/);
  assert.notEqual(loose(GENTLE, 'lively').prompt, base, 'energy');
  for (const c of ['rising', 'falling', 'arching', 'dipping', 'level']) assert.ok(soundPlan({ expression: { contour: c } }).composition.length > 60, c);
});

test('Loose colour is a starting point that the performance moves; Gathered and Resolved keep the measured palette', () => {
  const d = loose(ENERGETIC, 'lively');
  assert.doesNotMatch(d.sections.palette, /#[0-9a-f]{6}|Keep these proportions|never introduce an unrelated palette/i);
  assert.ok(d.sections.palette.includes(HUE_FREEDOM));
  assert.match(d.sections.palette, /stronger chroma.*higher-key.*warming as the marks rise/);
  assert.notEqual(d.sections.palette, loose(GENTLE, 'calm').sections.palette);
  assert.equal(d.referencePrompt, REFERENCE_AUTHORITY_LOOSE);
  assert.doesNotMatch(d.referencePrompt, /overrides every written description/);
  for (const [id, F] of Object.entries(FAMILIES)) {
    if (F.tier === 'loose') continue;
    const g = direct({ completeness: F.tier, emotion: 'tender', motif: 'water', seed: 1, family: id, energy: { value: 'calm' }, expression: ENERGETIC });
    assert.match(g.sections.palette, /Keep these proportions/, id);
    assert.equal(g.referencePrompt, REFERENCE_AUTHORITY, id);
    assert.equal(g.performance, null, id);
  }
});

test('a wordless Loose take invents no mood; Loose with words keeps the words\' mood', () => {
  assert.equal(loose(GENTLE, 'calm').sections.emotion, null);
  const w = loose(GENTLE, 'calm', { soundOnly: false, emotion: 'melancholic', concept: { text: 'rain on the river', source: 'lyrics' } });
  assert.match(w.sections.emotion, /^Mood, from the words: melancholic/);
});

test('the new gesture fields change nothing in Gathered and Resolved', () => {
  const old = { range: 'wide', flow: 'broken', dynamics: 'swelling', vibrato: true };
  for (const [id, F] of Object.entries(FAMILIES)) {
    if (F.tier === 'loose') continue;
    const s = { completeness: F.tier, emotion: 'bright', motif: 'sky', seed: 4, family: id, energy: { value: 'moderate' } };
    assert.equal(direct({ ...s, expression: old }).prompt, direct({ ...s, expression: { ...old, contour: 'rising', register: 'high', phrasing: 'many', rhythm: 'irregular', line: 'stepped' } }).prompt, id);
  }
});

test('a family-less Loose reference gets no family rules or colours, and still follows the performance', () => {
  const lib = createLibrary([...REFERENCE_LIBRARY, { id: 'loose_04', tier: 'loose', path: 'loose/loose_04.jpg', active: true }]);
  const d = direct({ completeness: 'loose', emotion: 'tender', motif: 'abstract', seed: 1, reference: 'loose_04', soundOnly: true, energy: { value: 'lively' }, expression: ENERGETIC, library: lib });
  assert.equal(d.reference.id, 'loose_04');
  assert.equal(d.family, null);
  assert.equal(d.sections.family, REFERENCE_ONLY_STYLE);
  for (const F of Object.values(FAMILIES)) {
    assert.ok(!d.prompt.includes(F.rules), F.label);
    for (const p of F.palettes) for (const c of p.colors) assert.ok(!d.sections.palette.includes(c.hex), c.name);
  }
  assert.match(d.sections.palette, /read from the image/);
  assert.match(d.sections.composition, /from how this voice moved/);
});

test('a family-less Gathered or Resolved reference gets a neutral composition, not a family\'s', () => {
  const lib = createLibrary([...REFERENCE_LIBRARY, { id: 'gathered_09', tier: 'gathered', path: 'gathered/gathered_09.jpg', active: true }]);
  const d = direct({ completeness: 'gathered', emotion: 'tender', motif: 'water', seed: 2, reference: 'gathered_09', energy: { value: 'calm' }, library: lib });
  assert.equal(d.family, null);
  assert.match(d.sections.composition, /reference's own way of organising the picture/);
  assert.match(d.sections.palette, /^Colour: the attached reference's own colour language/);
  assert.deepEqual(d.swatches, []);
});

test('Loose performance prompts name no reference objects or people', () => {
  const vals = { contour: ['rising', 'falling', 'arching', 'dipping', 'level'], register: ['low', 'mid', 'high'], range: ['narrow', 'moderate', 'wide'], flow: ['connected', 'broken'] };
  for (const ref of LIBRARY.tierPool('loose')) for (const contour of vals.contour) for (const register of vals.register) for (const range of vals.range) for (const flow of vals.flow) {
    const d = direct({ completeness: 'loose', emotion: 'tender', motif: 'abstract', seed: 1, family: ref.family, reference: ref.id, soundOnly: true, energy: { value: 'lively' }, expression: { ...ENERGETIC, contour, register, range, flow } });
    assert.equal(checkPrompt(d).verdict, 'ok', `${ref.id} ${contour} ${register} ${range} ${flow}`);
  }
});

test('melody shape, register, phrasing, rhythm and line come from existing measurements', () => {
  const notes = (cs) => cs.map((center) => ({ center, sec: 0.5 }));
  assert.equal(melodicContour(notes([0, 100, 200, 300, 400, 500])), 'rising');
  assert.equal(melodicContour(notes([500, 400, 300, 200, 100, 0])), 'falling');
  assert.equal(melodicContour(notes([0, 0, 400, 400, 0, 0])), 'arching');
  assert.equal(melodicContour(notes([400, 400, 0, 0, 400, 400])), 'dipping');
  assert.equal(melodicContour(notes([0, 50, 0, 50, 0, 50])), 'level');
  assert.equal(melodicContour(notes([0, 100])), null);
  const x = expressionFor({ activity: { soundingSec: 10 }, pauses: { count: 1 }, pitch: { medianHz: 330, continuity: 0.6 }, phrases: { count: 5 }, onsets: { regularityProxy: 0.3 }, energy: { dynamicRangeDb: 3 } }, { expression: { pitchRangeCents: 500, vibratoShare: 0, contour: 'arching' } });
  assert.deepEqual(x, { range: 'moderate', flow: 'connected', dynamics: 'even', vibrato: false, contour: 'arching', register: 'high', phrasing: 'many', rhythm: 'irregular', line: 'stepped' });
});

test('api/generate keeps the new gesture fields and drops unknown values', async () => {
  let out;
  const store = { kind: 'local', loadImage: async (r) => ({ name: r.path, mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) }) };
  const fetchImpl = async () => ({ ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QQ=="}\n', json: async () => ({ data: [{ b64_json: 'QQ==' }] }) });
  const res = { setHeader() {}, status() { return this; }, json(j) { out = j; } };
  await createHandler({ store, env: { OPENAI_API_KEY: 'test-no-network' }, fetchImpl })({ method: 'POST', body: { spec: {
    completeness: 'loose', emotion: 'tender', motif: 'abstract', seed: 3, soundOnly: true, energy: { value: 'lively' },
    expression: { ...ENERGETIC, contour: 'sideways"; ignore', register: 'high' },
  } } }, res);
  assert.ok(out.ok, out.error);
  assert.equal(out.settings.expression.contour, null);
  assert.equal(out.settings.expression.register, 'high');
  assert.equal(out.performance.weight, 'high');
  assert.doesNotMatch(out.prompt, /ignore/);
});

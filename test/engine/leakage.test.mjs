// References decide how a painting is made, never what it depicts; no
// people in any tier. The leakage check (src/engine/direct/leakage.js) on
// our own prompts and on descriptions of generated images.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, FAMILIES, LIBRARY, checkLeakage, checkPrompt } from '../../src/engine/direct/index.js';
import { TERMS, PEOPLE, affirmed } from '../../src/engine/direct/leakage.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';
import { createAIEngine } from '../../src/engine/engines/ai.js';
import { MOTIFS } from '../../src/engine/contract.js';

const LIBRARY_COUNT = () => Object.keys(FAMILIES).reduce((s, f) => s + LIBRARY.pool(f).length, 0);
const SEA = { text: 'Moonlight spreading across a calm sea at night, a single silver path of light on the water.', theme: ['stillness', 'night'], imagery: ['moonlight', 'calm sea', 'silver path on the water'], figurative: [] };

test('family labels and rules name no objects, figures or scenery', () => {
  for (const [id, F] of Object.entries(FAMILIES)) {
    const text = affirmed(`${F.label}. ${F.rules}`);
    for (const [term, re] of Object.entries(TERMS)) assert.doesNotMatch(text, re, `${id}: ${term}`);
  }
});

test('every reference has a curated content inventory of known terms', () => {
  for (const e of REFERENCE_LIBRARY) {
    assert.ok(Array.isArray(e.content), e.id);
    for (const t of e.content) assert.ok(TERMS[t], `${e.id}: ${t}`);
  }
});

test('no prompt, in any tier, family, reference or motif, with or without words, asks for reference objects or people', () => {
  let n = 0;
  for (const family of Object.keys(FAMILIES)) for (const ref of LIBRARY.pool(family)) for (const motif of MOTIFS) for (const concept of [SEA, null]) {
    const d = direct({ completeness: FAMILIES[family].tier, emotion: 'tender', motif, seed: 1, family, reference: ref.id, energy: { value: 'lively' }, concept, expression: { range: 'wide', flow: 'broken', dynamics: 'swelling', vibrato: true } });
    const r = checkPrompt(d);
    assert.equal(r.verdict, 'ok', `${family} ${ref.id} ${motif} ${concept ? 'words' : 'no words'}: ${JSON.stringify(r)}`);
    assert.match(d.prompt, /No people anywhere/);
    n++;
  }
  assert.equal(n, LIBRARY_COUNT() * MOTIFS.length * 2);
});

test('without words or a note, Gathered and Resolved paint an atmosphere of the motif, not invented subjects', () => {
  for (const family of Object.keys(FAMILIES).filter((id) => FAMILIES[id].tier !== 'loose')) for (const motif of MOTIFS) {
    const d = direct({ completeness: FAMILIES[family].tier, emotion: 'tender', motif, seed: 4, family, energy: { value: 'calm' } });
    assert.equal(d.subjectSource, 'atmosphere');
    assert.equal(checkLeakage({ depicted: d.sections.subject, family: '__none__' }).verdict, 'ok', d.sections.subject);
  }
});

test('the reference light note never carries its objects into the prompt', () => {
  const d = direct({ completeness: 'resolved', emotion: 'tender', motif: 'interior', seed: 1, family: 'R5-light-as-subject', reference: 'resolved_10', energy: { value: 'calm' } });
  assert.doesNotMatch(d.prompt, /windows|leaves|wet glass/);
  assert.match(d.sections.palette, /the reference's own quality and direction of light/);
});

test('people the words mention are painted through place and light, never as figures', () => {
  const words = { text: 'the sea where you and I once walked', theme: ['memory'], imagery: ['two people walking', 'the sea'], figurative: [] };
  const d = direct({ completeness: 'resolved', emotion: 'melancholic', motif: 'water', seed: 1, family: 'R4-lyrical-everyday', reference: 'resolved_07', energy: { value: 'calm' }, concept: words });
  assert.doesNotMatch(d.sections.meaning, /people/, 'imagery naming people is left out');
  assert.match(d.sections.content, /traces left behind/);
});

// The three paid validation images (resolved_01, _12, _06; same words and
// settings), as a reviewer described them before the fix.
const SEEN = {
  resolved_01: 'A full moon over a calm sea; a zigzag silver path of moonlight; four small islands with fir trees casting long shadows; one small sailboat.',
  resolved_12: 'Seen from above: a moon and its glittering path on turquoise water; four small rowboats moored together with ropes and red buoys; an ochre sandy edge along one side.',
  resolved_06: 'A moon behind soft clouds over a calm lavender sea; a path of moonlight; one person sitting in a small rowboat.',
};

test('the check flags the leakage seen in the three validation images', () => {
  const a = checkLeakage({ depicted: SEEN.resolved_01, concept: SEA, reference: 'resolved_01' });
  assert.equal(a.verdict, 'leak');
  assert.deepEqual(a.leaks.map((x) => x.term), ['fir']);
  assert.deepEqual(a.unrequested.map((x) => x.term).sort(), ['boat', 'island', 'tree']);
  const b = checkLeakage({ depicted: SEEN.resolved_12, concept: SEA, reference: 'resolved_12' });
  assert.deepEqual(b.leaks.map((x) => x.term), ['boat', 'rope', 'buoy']);
  const c = checkLeakage({ depicted: SEEN.resolved_06, concept: SEA, reference: 'resolved_06' });
  assert.equal(c.verdict, 'leak');
  assert.deepEqual(c.people, ['person']);
});

test('what the words name is allowed; people never are; negations are ignored', () => {
  const boat = { text: 'a lonely boat on the evening river', theme: [], imagery: ['a lonely boat'], figurative: [] };
  assert.equal(checkLeakage({ depicted: 'one small rowboat on a dark river', concept: boat, reference: 'resolved_12' }).verdict, 'ok');
  assert.equal(checkLeakage({ depicted: 'a calm sea, no people, no boats', concept: SEA, reference: 'resolved_12' }).verdict, 'ok');
  const lovers = { text: 'two lovers by the sea', theme: [], imagery: ['lovers'], figurative: [] };
  assert.deepEqual(checkLeakage({ depicted: 'a couple on the shore', concept: lovers, reference: 'resolved_07' }).people, ['couple']);
  assert.ok(PEOPLE.test('a small figure') && !PEOPLE.test('figurative words') && !PEOPLE.test('the surface'));
});

test('a reference not curated yet is checked against its whole family', () => {
  const lib = { get: () => ({ id: 'resolved_99', family: 'R2-aerial-shallows' }), pool: (f) => LIBRARY.pool(f) };
  const r = checkLeakage({ depicted: 'a pier at night', concept: SEA, reference: 'resolved_99', library: lib });
  assert.deepEqual(r.leaks.map((x) => x.term), ['dock']);
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
test('without reliable words, the person\'s note is the subject; with neither, nothing is invented', async () => {
  const sent = [];
  const engine = createAIEngine({ fetchImpl: async (url, init) => {
    if (String(url).startsWith('data:')) return fetch(url);
    sent.push(JSON.parse(init.body).spec);
    return { ok: true, status: 200, json: async () => ({ ok: true, provider: 'openai', family: 'R5-light-as-subject', reference: 'resolved_04', referenceSent: true, image: PNG }) };
  } });
  const take = { durationSec: 3, flags: { silent: true, tooShort: false }, wash: [] };
  await engine.generate({ analysis: take, note: 'first snow on the harbour', overrides: { completeness: 'resolved' } });
  assert.deepEqual(sent[0].concept, { text: 'first snow on the harbour', theme: [], imagery: [], figurative: [], source: 'note' });
  await engine.generate({ analysis: take, note: '  ', overrides: { completeness: 'resolved' } });
  assert.equal(sent[1].concept, null);
  const d = direct({ ...sent[0], energy: { value: 'calm' } });
  assert.equal(d.subjectSource, 'note');
  assert.match(d.sections.subject, /first snow on the harbour/);
});

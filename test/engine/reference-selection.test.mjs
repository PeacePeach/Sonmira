// Random style selection: tier first, then one reference image from every
// active reference of that tier, each equally likely, whatever its family
// (Han, 18 Oct); the style family follows the reference. A fresh draw for
// every generation unless a seed is given explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, familiesFor, createLibrary, FAMILIES, LIBRARY } from '../../src/engine/direct/index.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';
import { createAIEngine } from '../../src/engine/engines/ai.js';
import { sampleReferences } from '../../tools/sample-references.mjs';
import { MOTIFS } from '../../src/engine/contract.js';

const TIERS = ['loose', 'gathered', 'resolved'];
const ofTier = (t) => Object.keys(FAMILIES).filter((id) => FAMILIES[id].tier === t);
const words = { text: 'a lantern by the river at night', theme: [], imagery: [], figurative: [] };
// A deterministic stream of seeds standing in for randomSeed().
const seeds = (start = 1) => { let s = start; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0); };

test('with words, every family of the tier is eligible for every motif, all with equal weight', () => {
  for (const t of TIERS) for (const motif of MOTIFS) {
    const pool = familiesFor(t, motif, LIBRARY, { concept: true });
    assert.deepEqual(pool.map(([id]) => id).sort(), ofTier(t).sort(), `${t}/${motif}`);
    assert.ok(pool.every(([, w]) => w === 1));
  }
});

test('every reference of the tier is equally likely, whatever its family', () => {
  const n = 12000;
  for (const t of TIERS) {
    const r = sampleReferences({ tier: t, n, seed: seeds(7) });
    const active = LIBRARY.tierPool(t).map((e) => e.id).sort();
    assert.deepEqual(Object.keys(r.references).sort(), active, `${t}: every reference is reachable`);
    for (const id of active) {
      const share = r.references[id] / n;
      assert.ok(Math.abs(share - 1 / active.length) < 0.02, `${t} ${id}: ${share.toFixed(3)} ${JSON.stringify(r.references)}`);
    }
  }
  assert.deepEqual(TIERS.map((t) => LIBRARY.tierPool(t).length), [3, 5, 14]);
});

test('the style family follows the drawn reference, so the written style matches the image', () => {
  const next = seeds(9);
  for (const t of TIERS) for (let i = 0; i < 200; i++) {
    const d = direct({ completeness: t, emotion: 'tender', motif: 'water', seed: next(), energy: { value: 'calm' }, concept: words });
    assert.equal(d.reference.family, d.family);
    assert.equal(FAMILIES[d.family].tier, t);
  }
});

test('a reference uploaded straight into a tier folder joins that tier, with no family\'s rules or colours', () => {
  const lib = createLibrary([...REFERENCE_LIBRARY, { id: 'resolved_15', tier: 'resolved', path: 'resolved/resolved_15.jpg', active: true }]);
  assert.equal(lib.tierPool('resolved').length, 15);
  assert.equal(lib.pool('R4-lyrical-everyday').length, LIBRARY.pool('R4-lyrical-everyday').length);
  const next = seeds(13);
  let hits = 0;
  for (let i = 0; i < 1500; i++) {
    const d = direct({ completeness: 'resolved', emotion: 'tender', motif: 'water', seed: next(), energy: { value: 'calm' }, concept: words, library: lib });
    assert.equal(d.level, 'resolved');
    if (d.reference.id === 'resolved_15') {
      hits++;
      assert.equal(d.family, null);
      assert.deepEqual(d.swatches, []);
      for (const F of Object.values(FAMILIES)) assert.ok(!d.prompt.includes(F.rules), 'no family rules for a family-less reference');
    } else assert.equal(FAMILIES[d.family].tier, 'resolved');
  }
  assert.ok(Math.abs(hits / 1500 - 1 / 15) < 0.025, `resolved_15 drawn ${hits} times`);
});

test('without words, every family of the tier is still drawn, painting an atmosphere rather than its own subjects', () => {
  for (const t of TIERS) for (const motif of MOTIFS) {
    const pool = familiesFor(t, motif, LIBRARY);
    assert.deepEqual(pool.map(([id]) => id).sort(), ofTier(t).sort(), `${t}/${motif}`);
    assert.ok(pool.every(([, w]) => w === 1));
  }
  const d = direct({ completeness: 'resolved', emotion: 'tender', motif: 'abstract', seed: 3, family: 'R4-lyrical-everyday', energy: { value: 'calm' } });
  assert.equal(d.subjectSource, 'atmosphere');
});

test('a family with no active reference is not drawn, so a generation never lacks its reference', () => {
  const lib = createLibrary(REFERENCE_LIBRARY.filter((e) => e.family !== 'R2-aerial-shallows'));
  const next = seeds(5);
  for (let i = 0; i < 300; i++) {
    const d = direct({ completeness: 'resolved', emotion: 'tender', motif: 'water', seed: next(), energy: { value: 'calm' }, concept: words, library: lib });
    assert.notEqual(d.family, 'R2-aerial-shallows');
    assert.ok(d.reference);
  }
});

test('the 100-sample diagnostic reports family and reference counts without generating', () => {
  const r = sampleReferences({ tier: 'resolved', n: 100 });
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(sum(r.families), 100);
  assert.equal(sum(r.references), 100);
  assert.ok(Object.keys(r.families).every((id) => FAMILIES[id].tier === 'resolved'));
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function recordingEngine() {
  const sent = [];
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith('data:')) return fetch(url);
    const body = JSON.parse(init.body);
    sent.push(body.spec.seed);
    return { ok: true, status: 200, json: async () => ({ ok: true, provider: 'openai', family: 'R5-light-as-subject', reference: 'resolved_04', referenceSent: true, seed: body.spec.seed, image: PNG }) };
  };
  return { engine: createAIEngine({ fetchImpl }), sent };
}
const take = { durationSec: 3, flags: { silent: true, tooShort: false }, wash: [] };

test('each generation of the same take draws a new seed; an explicit seed is kept', async () => {
  const { engine, sent } = recordingEngine();
  for (let i = 0; i < 5; i++) await engine.generate({ analysis: take, note: 'same take' });
  assert.equal(new Set(sent).size, 5, `seeds repeated: ${sent}`);
  sent.length = 0;
  await engine.generate({ analysis: take, overrides: { seed: 1234 } });
  await engine.generate({ analysis: take, overrides: { seed: 1234 } });
  assert.deepEqual(sent, [1234, 1234]);
});

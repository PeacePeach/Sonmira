// Whole-performance singing control (PROTOTYPE in tools/performance-profile.mjs,
// not yet used by the tier decision). Ordering tests only: no threshold is
// fixed until labelled real recordings exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixedTakes } from './mixed-takes.js';
import { singers, sungLyrics, SR } from './synth.js';
import { pitchTrack } from '../../src/engine/analysis/pitchtrack.js';
import { singingAnalysis } from '../../src/engine/analysis/singing.js';
import { analyzeSamples } from '../../src/engine/analysis/index.js';
import { performanceProfile } from '../../tools/performance-profile.mjs';

const run = (x) => { const track = pitchTrack(x, SR); return { p: performanceProfile(track), q: singingAnalysis(track, analyzeSamples(x, SR)).quality }; };
const R = Object.fromEntries(Object.entries({ ...mixedTakes, synthStrong: singers.strong, sungLyrics: () => sungLyrics() }).map(([k, f]) => [k, run(f())]));
const CONSISTENT = ['strong', 'improvised', 'transposed', 'breathy', 'synthStrong', 'sungLyrics'];
const MIXED = ['weakThenGood', 'goodThenUnstable'];

test('mixed-quality takes show a weak stretch that consistent takes do not, in either order', () => {
  for (const m of MIXED) {
    assert.ok(R[m].p.weakWindowShare > 0, `${m} has a weak window`);
    for (const c of CONSISTENT) {
      assert.equal(R[c].p.weakWindowShare, 0, `${c} has no weak window`);
      assert.ok(R[m].p.windowP25 < R[c].p.windowP25, `${m} p25 ${R[m].p.windowP25} < ${c} ${R[c].p.windowP25}`);
    }
  }
});

test('improvisation, transposition, bends, vibrato and breaths are not counted as instability', () => {
  for (const c of ['improvised', 'transposed', 'breathy', 'strong']) assert.ok(R[c].p.controlledShare > 0.9, `${c}: ${R[c].p.controlledShare}`);
  assert.ok(R.transposed.p.tuning.driftCents < 20, 'a constant offset is not drift');
});

test('tuning that keeps sinking is reported as drift; a steady key is not', () => {
  assert.ok(R.sinking.p.tuning.driftCents > 50);
  assert.ok(R.strong.p.tuning.driftCents < 20 && R.improvised.p.tuning.driftCents < 20);
});

test('known gap: the current decision calls both mixed takes Strong', () => {
  // Documents today's behaviour; flips when the proposed rule is adopted.
  for (const m of MIXED) assert.equal(R[m].q.strong, true, m);
});

test('mixed takes are not Strong (Resolved) under the decision', { todo: 'adopt the whole-performance rule after calibration on labelled recordings' }, () => {
  for (const m of MIXED) assert.equal(R[m].q.strong, false, m);
});

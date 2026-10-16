// Whole-performance singing control (src/engine/analysis/performance.js) and
// the Strong decision that uses it. Thresholds are provisional (synthetic
// takes only) until labelled real recordings exist.
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

test('mixed-quality takes are not Strong (Resolved); consistent, expressive and transposed takes stay Strong', () => {
  for (const m of MIXED) {
    assert.equal(R[m].q.strong, false, m);
    const failed = R[m].q.strongChecks.filter((c) => !c.ok).map((c) => c.id);
    assert.ok(failed.includes('weakest_windows') && failed.includes('weak_windows'), `${m}: ${failed}`);
  }
  for (const c of CONSISTENT) assert.equal(R[c].q.strong, true, `${c}: ${JSON.stringify(R[c].q.strongChecks.filter((x) => !x.ok))}`);
  assert.equal(R.sinking.q.strong, false, 'sinking tuning is not Strong');
});

test('confidence is evidence × consistency: high for consistent takes, low when weak windows remain', () => {
  for (const c of CONSISTENT) assert.ok(R[c].q.confidence >= 0.6, `${c} ${R[c].q.confidence}`);
  for (const m of MIXED) { assert.ok(R[m].q.evidence >= 0.9, m); assert.ok(R[m].q.confidence < 0.6, `${m} ${R[m].q.confidence}`); }
});

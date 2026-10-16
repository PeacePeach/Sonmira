// Controlled vibrato vs genuine pitch problems, synthetic and deterministic.
// Under review (Han, 16 Oct, take 9): note centres read from the
// vibrato-free smoothed line ('smooth') instead of the raw pitch ('raw').
// Vibrato must stop reading as poor tuning, and must never hide detuned
// notes, wavering pitch or a sinking key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { melodyCurve, sing, SR, rng, singers } from './synth.js';
import { pitchTrack } from '../../src/engine/analysis/pitchtrack.js';
import { singingAnalysis, SINGING_CALIBRATION } from '../../src/engine/analysis/singing.js';
import { analyzeSamples } from '../../src/engine/analysis/features.js';

const TUNE = [0, 2, 4, 5, 4, 2, 0, null, 4, 5, 7, 9, 7, 5, 4, null, 2, 4, 2, 0, null, 4, 5, 7, 5, 4, 2, 0];
const notes = (sec) => TUNE.map((st) => ({ st, sec: st == null ? 0.35 : sec }));
const off = (seed, cents, from = 0) => { const r = rng(seed); const o = TUNE.map((_, i) => (i >= from ? (r() - 0.5) * 2 * cents : 0)); return (i) => o[i]; };
const waver = (a) => (t) => a * 0.6 * Math.sin(2 * Math.PI * 1.3 * t) + a * 0.4 * Math.sin(2 * Math.PI * 2.1 * t + 1);

function measure(samples, noteCentre = 'smooth') {
  const q = singingAnalysis(pitchTrack(samples, SR), analyzeSamples(samples, SR), { ...SINGING_CALIBRATION, noteCentre }).quality;
  const failed = q.strongChecks.filter((c) => !c.ok).map((c) => c.id);
  return { strong: q.strong, failed, intonation: q.components.intonation };
}
const take = (curve) => sing(curve.at, curve.sec);

const CASES = {
  controlledVib40: take(melodyCurve(notes(0.5), { vibrato: { hz: 5.5, cents: 40, delay: 0.1 } })),
  controlledVib70: take(melodyCurve(notes(0.5), { vibrato: { hz: 5, cents: 70, delay: 0.1 } })),
  detuned: take(melodyCurve(notes(0.5), { detune: off(5, 40) })),
  detunedVib: take(melodyCurve(notes(0.5), { detune: off(5, 40), vibrato: { hz: 5, cents: 70, delay: 0.1 } })),
  sinkingKeyVib: take(melodyCurve(notes(0.5), { detune: (i) => (-150 * i) / TUNE.length, vibrato: { hz: 5, cents: 70, delay: 0.1 } })),
  mixedVib: take(melodyCurve(notes(0.5), { detune: off(9, 45, 14), vibrato: { hz: 5, cents: 60, delay: 0.1 } })),
  waverShort: take(melodyCurve(notes(0.5), { wobble: waver(70) })),
  waverLong: take(melodyCurve(notes(1.0), { wobble: waver(70) })),
};
const R = Object.fromEntries(Object.entries(CASES).map(([k, s]) => [k, { raw: measure(s, 'raw'), smooth: measure(s, 'smooth') }]));

test('controlled vibrato in tune is Strong, and its tuning reads cleaner without the vibrato', () => {
  for (const k of ['controlledVib40', 'controlledVib70']) {
    const { raw, smooth } = R[k];
    assert.ok(smooth.strong, `${k}: ${smooth.failed}`);
    assert.ok(smooth.intonation.deviationCents < raw.intonation.deviationCents, `${k}: smooth ${smooth.intonation.deviationCents} vs raw ${raw.intonation.deviationCents}`);
    assert.ok(smooth.intonation.deviationCents <= 6, `${k}: ${smooth.intonation.deviationCents}`);
  }
});

test('detuned notes fail tuning, with or without vibrato, and vibrato never hides them', () => {
  for (const k of ['detuned', 'detunedVib']) {
    assert.equal(R[k].smooth.strong, false, k);
    assert.ok(R[k].smooth.failed.includes('intonation'), `${k}: ${R[k].smooth.failed}`);
    assert.ok(R[k].smooth.intonation.deviationCents >= R[k].raw.intonation.deviationCents - 2, k);
  }
});

test('a sinking key fails key drift even with vibrato', () => {
  assert.equal(R.sinkingKeyVib.smooth.strong, false);
  assert.ok(R.sinkingKeyVib.smooth.failed.includes('key_drift'), String(R.sinkingKeyVib.smooth.failed));
});

test('a mixed performance (steady with vibrato, then detuned) is not Strong', () => {
  assert.equal(R.mixedVib.smooth.strong, false, String(R.mixedVib.smooth.failed));
});

test('slow wavering pitch (±70 cents at 1–2 Hz) is not Strong', () => {
  for (const k of ['waverShort', 'waverLong']) assert.equal(R[k].smooth.strong, false, k);
});

test('the reference singers keep their decisions', () => {
  for (const [k, strong] of [['strong', true], ['weak', false]]) assert.equal(measure(singers[k]()).strong, strong, k);
});

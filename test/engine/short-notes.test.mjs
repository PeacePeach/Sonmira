// Short sung notes (findShortNotes in src/engine/analysis/singing.js): the
// syllables of ~0.15–0.4 s that the smoothed-line note finder cannot see, and
// the speech / wandering cases that must not become notes. Synthetic voices
// only; the real-recording check (three Mandarin takes against Basic Pitch)
// lives outside the repo because the recordings are personal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voice, sing, singers, sungLyrics, spokenLyrics, SR } from './synth.js';
import { mixedTakes } from './mixed-takes.js';
import { pitchTrack } from '../../src/engine/analysis/pitchtrack.js';
import { decodeWav } from '../../src/engine/analysis/wav.js';
import { analyzeSamples } from '../../src/engine/analysis/index.js';
import { findNotes, findSteadyNotes, singingAnalysis, SINGING_CALIBRATION as CAL } from '../../src/engine/analysis/singing.js';

const steps = (sec, vibratoSt) => {
  const notes = [];
  for (let i = 0; i < Math.round(6 / sec); i++) notes.push({ hz: 220 * 2 ** ([0, 2, 4, 2][i % 4] / 12), sec });
  return { x: voice(notes, { vibratoSt }), sung: notes.length };
};
const held = (r) => r.notes.reduce((a, n) => a + n.sec, 0) / Math.max(1e-9, r.voicedSec);
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

test('in-tune syllables of 0.15–0.3 s are notes, with or without vibrato', () => {
  for (const sec of [0.15, 0.2, 0.3]) for (const vib of [0, 0.3]) {
    const { x, sung } = steps(sec, vib), tr = pitchTrack(x, SR);
    assert.ok(findSteadyNotes(tr).notes.length <= 2, `the smoothed line alone misses ${sec} s notes`);
    if (sec < 0.3 && vib) continue; // see the next test
    assert.equal(findNotes(tr).notes.length, sung, `${sec} s, vibrato ±${vib * 100} c`);
  }
});

// The cost of the glide rule: within 0.15–0.2 s a ±30 c vibrato moves as fast
// as a spoken glide, so those notes are not added (today's behaviour, no harm).
// Accepting them would also accept slow speech with ordinary pitch jitter.
test('very short notes with vibrato are left out rather than risk speech', () => {
  for (const sec of [0.15, 0.2]) {
    const tr = pitchTrack(steps(sec, 0.3).x, SR);
    assert.ok(findNotes(tr).notes.length <= findSteadyNotes(tr).notes.length + 2, `${sec} s with vibrato`);
  }
});

test('notes of 0.4 s and longer are found as before, with nothing added', () => {
  for (const vib of [0, 0.3, 0.6]) {
    const tr = pitchTrack(steps(0.4, vib).x, SR);
    assert.equal(findNotes(tr).notes.length, findSteadyNotes(tr).notes.length);
    assert.equal(findNotes(tr).shortNotes, 0);
  }
});

test('no short notes where nothing is held: glides, a slow swing, speech, a wandering voice', () => {
  const cases = {
    'glide 600 c/s': sing((t) => -900 + 600 * (t % 3), 3),
    'glide 1200 c/s': sing((t) => -900 + 1200 * (t % 3), 3),
    'slow ±300 c swing at 1.5 Hz': sing((t) => -900 + 300 * Math.sin(2 * Math.PI * 1.5 * t), 6),
    speech: singers.speech(),
    'weak, then good (wandering half)': mixedTakes.weakThenGood(),
    'good, then unstable (wandering half)': mixedTakes.goodThenUnstable(),
  };
  for (const [name, x] of Object.entries(cases)) assert.equal(findNotes(pitchTrack(x, SR)).shortNotes, 0, name);
});

// The speech/singing boundary. The "sung" bar (cal.sung.sustainedRatio) is
// unchanged; short notes may add held time only where a syllable holds its
// pitch, so speech, whose syllables glide, gains almost nothing.
test('spoken syllables gain almost no held time, at normal and slow speed', () => {
  let flips = 0, added = 0, n = 0;
  for (const slow of [false, true]) for (const seed of SEEDS) {
    const tr = pitchTrack(spokenLyrics({ slow, seed }), SR);
    const before = held(findSteadyNotes(tr)), after = held(findNotes(tr));
    assert.ok(after - before <= 0.1, `spoken${slow ? ' slowly' : ''}, seed ${seed}: +${(after - before).toFixed(3)}`);
    if (before < CAL.sung.sustainedRatio && after >= CAL.sung.sustainedRatio) flips++;
    added += after - before; n++;
  }
  assert.ok(added / n <= 0.02, `mean held time added to speech ${(added / n).toFixed(3)}`);
  assert.ok(flips <= 2, `${flips} of ${n} spoken takes newly over the sung bar`);
});

// Real speech is not a clean glide: its pitch wobbles. Up to ±15 c of jitter,
// spoken takes still gain little held time and stay on the same side of the
// sung bar, normal and slow.
test('spoken syllables with pitch jitter gain almost no held time', () => {
  for (const jitter of [10, 15]) for (const slow of [false, true]) {
    let flips = 0, added = 0;
    for (const seed of SEEDS) {
      const tr = pitchTrack(spokenLyrics({ slow, seed, jitter }), SR);
      const before = held(findSteadyNotes(tr)), after = held(findNotes(tr));
      if (before < CAL.sung.sustainedRatio && after >= CAL.sung.sustainedRatio) flips++;
      added += after - before;
    }
    const label = `±${jitter} c, ${slow ? 'slow' : 'normal'}`;
    assert.ok(added / SEEDS.length <= 0.02, `${label}: mean held time added ${(added / SEEDS.length).toFixed(3)}`);
    assert.ok(flips <= 2, `${label}: ${flips} of ${SEEDS.length} newly over the sung bar`);
  }
});

test('sung lyrics with short syllables are singing, including fast syllables and wide vibrato', () => {
  for (const seed of SEEDS) {
    for (const opts of [{ syl: [0.15, 0.25] }, { syl: [0.2, 0.35] }, { syl: [0.18, 0.32], vib: 60 }]) {
      const x = sungLyrics({ seed, ...opts });
      const s = singingAnalysis(pitchTrack(x, SR), analyzeSamples(x, SR));
      assert.equal(s.vocal.sung, true, `seed ${seed} ${JSON.stringify(opts)}: sustained ${s.vocal.sustainedRatio}`);
    }
  }
});

test('real recording (tests/e2e/hum.wav): a held hum gains no short notes', () => {
  const w = decodeWav(readFileSync(new URL('../../tests/e2e/hum.wav', import.meta.url)));
  assert.equal(findNotes(pitchTrack(w.samples, w.sampleRate)).shortNotes, 0);
});

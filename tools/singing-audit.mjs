// Development probe, no app change: synthetic takes that a listener would call
// poorly sung (random chromatic notes with no key, improvised durations; a
// take whose second half wanders off pitch) through the current singing
// analysis, to show which components notice. Run: node tools/singing-audit.mjs
import { voice, rng, SR } from '../test/engine/synth.js';
import { pitchTrack } from '../src/engine/analysis/pitchtrack.js';
import { singingAnalysis } from '../src/engine/analysis/singing.js';
import { analyzeSamples } from '../src/engine/analysis/index.js';
const hz = (cents) => 440 * 2 ** (cents / 1200);
function take(kind, seed = 4) {
  const r = rng(seed), notes = [];
  let t = 0;
  while (t < 10) {
    const sec = 0.25 + r() * 0.9;  // irregular, improvised durations
    let c = -900 + Math.floor(r() * 16) * 100 - 9; // chromatic, no key; grid offset -9 (=91)
    if (kind === 'offgrid') c += (r() - 0.5) * 100;      // anywhere between semitones
    notes.push({ hz: hz(c), sec });
    if (r() < 0.25) notes.push({ hz: 0, sec: 0.1 + r() * 0.4 }); // random breaths
    t += sec;
  }
  return voice(notes, { sr: SR, vibratoSt: 0.15, seed });
}
for (const kind of ['chromatic-steady', 'offgrid']) for (const seed of [4, 9]) {
  const x = take(kind, seed);
  const f = analyzeSamples(x, SR);
  const s = singingAnalysis(pitchTrack(x, SR), f);
  const q = s.quality, C = q.components;
  console.log(kind, seed, 'score', q.score, 'conf', q.confidence, 'strong', q.strong, '| stab', C.stability?.score, 'inton', C.intonation?.score, 'dev', C.intonation?.deviationCents, 'off', C.intonation?.tuningOffsetCents, 'trans', C.transitions?.score, 'ctrl', C.control?.score, 'rhythm', C.rhythm?.score, 'coh', C.coherence?.score, '| sustained', s.vocal.sustainedRatio, 'notes', s.vocal.noteCount);
}
import { sing } from '../test/engine/synth.js';
// 5 s of steady, in-tune notes, then 5 s of wandering pitch (poorly sung).
const steps = [0, 200, 400, 500, 700, 500, 400, 200];
const half = (t) => t < 5 ? steps[Math.floor(t / 0.62) % steps.length] - 9
  : 300 + 250 * Math.sin(2 * Math.PI * 0.7 * t) + 90 * Math.sin(2 * Math.PI * 2.3 * t);
for (const [name, fn] of [['steady 10 s', (t) => steps[Math.floor(t / 0.62) % steps.length] - 9], ['steady 5 s + wandering 5 s', half]]) {
  const x = sing(fn, 10);
  const f = analyzeSamples(x, SR);
  const s = singingAnalysis(pitchTrack(x, SR), f);
  const q = s.quality, C = q.components;
  console.log(name, '| score', q.score, 'conf', q.confidence, 'strong', q.strong, '| stab', C.stability?.score, 'inton', C.intonation?.score, 'ctrl', C.control?.score, 'rhythm', C.rhythm?.score, '| sustained', s.vocal.sustainedRatio, 'noteSec', s.vocal.noteSec, 'voiced', s.vocal.voicedSec);
}

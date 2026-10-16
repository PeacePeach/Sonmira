// Development view of whole-performance singing control (the measure the
// Strong / Resolved decision uses; see src/engine/analysis/performance.js).
//
//   performanceProfile(track) → {
//     voicedSec, controlledShare, unstableSec, labels,
//     windows: [{ t0, t1, controlled }], windowP25, weakWindowShare,
//     tuning: { localOffsets, driftCents }
//   }
//
// Every voiced frame (pauses and breaths are not counted at all) is labelled:
//   note     inside a settled note (vibrato included: notes are found on the
//            vibrato-smoothed line, as in singing.js)
//   bend     a purposeful move between two settled notes of one phrase: the
//            pitch travels mostly one way (a slide, scoop or portamento) or
//            stays between the two notes (re-articulating a repeated note),
//            up to bendMaxSec
//   edge     a short onset scoop before a phrase's first note or a fall-off
//            after its last
//   unstable anything else: wandering, hunting, pitch that never settles
// The share of controlled voiced time is measured over the whole take and per
// window of voiced time, so one good stretch cannot hide a poor one.
// Tuning is tracked per window against the singer's own grid: a constant
// offset (transposition, a singer's own key) costs nothing; a grid that keeps
// moving (sinking or wandering tuning) is reported as drift.
//
//   node tools/performance-profile.mjs     runs the synthetic mixed takes

import { findNotes, singingAnalysis, SINGING_CALIBRATION } from '../src/engine/analysis/singing.js';
import { pitchTrack } from '../src/engine/analysis/pitchtrack.js';
import { performanceProfile as profile } from '../src/engine/analysis/performance.js';

// The measure now lives in the engine (src/engine/analysis/performance.js);
// this tool runs it, with the current calibration, on the synthetic takes.
export const PROFILE_PROTOTYPE = SINGING_CALIBRATION.performance;
export const performanceProfile = (track, P = SINGING_CALIBRATION.performance, cal = SINGING_CALIBRATION) => profile(track, findNotes(track, cal).notes, P, cal.smoothSec);

if (import.meta.url === `file://${process.argv[1]}`) {
  const { mixedTakes } = await import('../test/engine/mixed-takes.js');
  const { singers, sungLyrics, spokenLyrics, SR } = await import('../test/engine/synth.js');
  const { analyzeSamples } = await import('../src/engine/analysis/index.js');
  const cases = { ...mixedTakes, 'synth.strong': singers.strong, 'synth.weak': singers.weak, sungLyrics: () => sungLyrics(), spokenLyrics: () => spokenLyrics() };
  console.log('take'.padEnd(18), 'current: score strong | proposed: controlled  p25-window  weak-windows  tuning-drift  | labels (s)');
  for (const [name, make] of Object.entries(cases)) {
    const x = make();
    const track = pitchTrack(x, SR);
    const cur = singingAnalysis(track, analyzeSamples(x, SR)).quality;
    const p = performanceProfile(track);
    console.log(name.padEnd(18), String(cur.score).padEnd(6), String(cur.strong).padEnd(6), '|', String(p.controlledShare).padEnd(10), String(p.windowP25).padEnd(11), String(p.weakWindowShare).padEnd(13), String(p.tuning.driftCents).padEnd(13), '|', JSON.stringify(p.labels), p.windows.map((w) => w.controlled).join(' '));
  }
}

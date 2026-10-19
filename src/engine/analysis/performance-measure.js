// How this take was sung, measured over time, for the art direction
// (direct/performance.js). Runs in the browser next to the singing analysis;
// it never changes the tier decision, which stays with singing.js.
//
//   measurePerformance(samples, sampleRate) → summary | null
//
// The summary is numbers only (no words, no audio), small enough to send
// with the visual spec:
//   passages  the take cut into stretches of singing: one per phrase, split
//             again where the pitch did not settle (an unstable episode) or
//             leapt; each with its pitch path, loudness, stroke character
//             and landings
//   episodes  where the pitch did not settle on a note for ≥ 150 ms, and
//             what the line did there
//   global    whole-take measures, each anchored to the singing calibration
//             in direct/performance.js
//
// Level: a take recorded quieter must not paint differently. The pitch
// tracker's absolute voicing floor drops quiet phrase tails, so the take is
// first scaled to a common loud level, and every frame quieter than
// LEVEL.gateDb below that level counts as silence, whatever the gain.
//
// Voice drops: a quiet note far below both its neighbours (often a creak or
// fry, typically at a phrase end) is real sound, but it is
// not a melodic leap. It counts as a voice break and is left out of the
// pitch range, leaps and tuning of the passage around it.

import { pitchTrack } from './pitchtrack.js';
import { findNotes, singingAnalysis, arrivalOvershoot, SINGING_CALIBRATION } from './singing.js';
import { performanceProfile, frameLabels } from './performance.js';

export const MEASURE_VERSION = 2;
export const LEVEL = {
  targetRms: 0.1,   // loud voiced level (p95 frame RMS) after scaling
  gateDb: -24,      // quieter frames are silence; above the tracker's own floor at the target level
  dropDb: -12,      // a voice drop is at least this far below the loud level
};
export const PASSAGE = {
  leapCutSt: 7,     // a leap of a fifth or more inside a phrase starts a passage
  episodeMinSec: 0.25, // an unstable episode this long starts a passage
  minSec: 1,        // shorter pieces join the previous passage
  max: 12,
};

export const RUN = {
  stopSec: 0.06,    // a stop: at least this long within stopCents
  stopCents: 30,
  passCents: 40,    // passed through: the line is this far below on one side and above on the other
  minStops: 3,
  minPassed: 2,
  movingStops: 2,   // a stretch that stops on this many pitches moved between pitches it reached
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const std = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const med = (xs) => q(xs, 0.5);
// Robust spread: 1.4826 × median absolute deviation.
const mad = (xs) => { if (xs.length < 2) return 0; const m = med(xs); return 1.4826 * med(xs.map((x) => Math.abs(x - m))); };
const r = (x, d = 2) => (x == null || !isFinite(x) ? null : +x.toFixed(d));

// How far the singer's pitch grid moves between windows: the circular
// spread (cents) of the per-window grid offsets, which wrap at 100 c. Unlike
// the accumulated drift it does not jump when an offset crosses the wrap.
function circularSpread(offsets) {
  const o = (offsets ?? []).filter((x) => x != null);
  if (o.length < 2) return 0;
  const c = mean(o.map((x) => Math.cos((2 * Math.PI * x) / 100))), s = mean(o.map((x) => Math.sin((2 * Math.PI * x) / 100)));
  const R = Math.min(1, Math.hypot(c, s));
  return R <= 1e-6 ? 50 : (100 / (2 * Math.PI)) * Math.sqrt(-2 * Math.log(R));
}
// Where the pitch line stops inside frames [i0, i1): stretches of at least
// RUN.stopSec within RUN.stopCents on a 3-frame median line. A stop is
// passed through when the line, RUN.stopSec before and after it, sits
// RUN.passCents or more below on one side and above on the other.
export function pitchStops(fr, i0, i1, hop) {
  const c = []; for (let i = i0; i < i1; i++) { const w = [fr[i - 1], fr[i], fr[i + 1]].filter((f) => f?.cents != null).map((f) => f.cents); c.push(fr[i].cents == null ? null : med(w)); }
  const W = Math.max(2, Math.round(RUN.stopSec / hop)), on = new Array(c.length).fill(false);
  for (let k = 0; k + W <= c.length; k++) {
    const seg = c.slice(k, k + W);
    if (seg.every((x) => x != null) && Math.max(...seg) - Math.min(...seg) <= RUN.stopCents) for (let j = k; j < k + W; j++) on[j] = true;
  }
  const near = (i) => mean([fr[i - 1], fr[i], fr[i + 1]].filter((f) => f?.cents != null).map((f) => f.cents));
  const stops = [];
  for (let k = 0; k < c.length; k++) {
    if (!on[k]) continue;
    let j = k; while (j + 1 < c.length && on[j + 1]) j++;
    const at = mean(c.slice(k, j + 1)), before = near(i0 + k - W), after = near(i0 + j + W);
    stops.push({ t: fr[i0 + k].t, sec: (j - k + 1) * hop, cents: at, passed: before != null && after != null && Math.abs(before - at) >= RUN.passCents && Math.abs(after - at) >= RUN.passCents && Math.sign(at - before) === Math.sign(after - at) });
    k = j;
  }
  return stops;
}
// The shape of the line over frames i0..i1, as frameLabels measures a bend:
//   directness  net movement / path length on the vibrato-smoothed line, from
//               0 (it comes back on itself) to 1 (one way throughout)
//   beyond      how far the line goes past the span from its start to its
//               end (cents): a dip or a spike it comes back from
//   back        the most it moves back against its own direction (cents): a
//               swing the smoothing hides
// beyond and back are read on a 3-frame median line, so one tracker frame
// does not count.
export function pathShape(fr, i0, i1, hop, smoothSec) {
  const half = Math.round(smoothSec / 2 / hop), path = [];
  for (let i = i0; i < i1; i++) {
    if (fr[i].cents == null) continue;
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(fr.length - 1, i + half); j++) if (fr[j].cents != null) { sum += fr[j].cents; cnt++; }
    path.push(sum / cnt);
  }
  if (!path.length) return { directness: 0, beyond: 0 };
  let len = 0;
  for (let k = 1; k < path.length; k++) len += Math.abs(path[k] - path[k - 1]);
  const lo = Math.min(path[0], path.at(-1)), hi = Math.max(path[0], path.at(-1)), dir = Math.sign(path.at(-1) - path[0]) || 1;
  let beyond = 0, back = 0, ahead = -Infinity;
  for (let i = i0; i < i1; i++) {
    if (fr[i].cents == null) continue;
    const c = med([fr[i - 1], fr[i], fr[i + 1]].filter((f) => f?.cents != null).map((f) => f.cents));
    beyond = Math.max(beyond, lo - c, c - hi);
    ahead = Math.max(ahead, dir * c); back = Math.max(back, ahead - dir * c);
  }
  return { directness: len > 0 ? Math.abs(path.at(-1) - path[0]) / len : 1, beyond, back };
}
const unvoice = (f) => ({ ...f, hz: null, cents: null });
const loudOf = (frames) => q(frames.filter((f) => f.cents != null).map((f) => f.rms), 0.95);

// Scale to the common loud level, then gate relative to it.
// The take's loud level before scaling: p95 of 10 ms frame RMS. It scales
// exactly with the gain, so the scaled take is the same at any input level,
// and it costs one pass over the samples instead of a pitch track.
function loudRms(samples, sampleRate) {
  const n = Math.max(1, Math.round(0.01 * sampleRate)), xs = [];
  for (let i = 0; i + n <= samples.length; i += n) {
    let s = 0;
    for (let k = i; k < i + n; k++) s += samples[k] * samples[k];
    xs.push(Math.sqrt(s / n));
  }
  return q(xs, 0.95);
}

function levelledTrack(samples, sampleRate) {
  const loud0 = loudRms(samples, sampleRate);
  if (!loud0) return null;
  const gain = Math.min(100, Math.max(0.01, LEVEL.targetRms / loud0));
  const x = new Float32Array(samples.length);
  for (let i = 0; i < x.length; i++) x[i] = samples[i] * gain;
  const tr = pitchTrack(x, sampleRate);
  const loud = loudOf(tr.frames);
  if (!loud) return null;
  const floor = loud * 10 ** (LEVEL.gateDb / 20);
  const frames = tr.frames.map((f) => (f.cents != null && f.rms < floor ? unvoice(f) : f));
  // A voiced run shorter than one analysis window (30 ms) is a click or a
  // breath, not sung sound: it must not bridge a breath gap.
  for (let i = 0; i < frames.length;) {
    if (frames[i].cents == null) { i++; continue; }
    let j = i; while (j < frames.length && frames[j].cents != null) j++;
    if (j - i < 3) for (let k = i; k < j; k++) frames[k] = unvoice(frames[k]);
    i = j;
  }
  return { track: { ...tr, frames }, loud, gainDb: r(20 * Math.log10(gain), 1) };
}

// The analysis grid starts a fixed time before the first loud sound, so the
// same singing is cut into the same 10 ms frames however much silence was
// recorded before it (durations near a threshold would otherwise flip).
// Returns the first sample of the grid; negative means silence is added.
function contentStart(samples, sampleRate) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  if (!peak) return 0;
  let i = 0;
  while (i < samples.length && Math.abs(samples[i]) < peak * 0.1) i++;
  return i - Math.round(0.2 * sampleRate);
}

export function measurePerformance(samples, sampleRate, cal = SINGING_CALIBRATION) {
  if (!samples?.length || !sampleRate) return null;
  const start = contentStart(samples, sampleRate);
  let x = samples.subarray(Math.max(0, start));
  if (start < 0) { x = new Float32Array(samples.length - start); x.set(samples, -start); }
  const m = measureFrom(x, sampleRate, cal);
  if (!m || !start) return m;
  // Back on the recording's own clock.
  const off = start / sampleRate, at = (t) => r(t + off);
  return {
    ...m, durationSec: at(m.durationSec), span: m.span.map(at),
    passages: m.passages.map((p) => ({ ...p, t0: at(p.t0), t1: at(p.t1) })),
    episodes: m.episodes.map((e) => ({ ...e, t0: at(e.t0) })),
  };
}

function measureFrom(samples, sampleRate, cal) {
  const lev = levelledTrack(samples, sampleRate);
  if (!lev) return null;
  const { track, loud } = lev, fr = track.frames, hop = track.hopSec ?? 0.01, P = cal.performance;
  // Stray sounds: a short pitched burst an octave or more away from the
  // voiced sound right around it, and not quiet enough to be a voice drop (a
  // start beep, a whistle, a click the tracker reads as a high note), is not
  // part of the singing; its frames are treated as silence.
  const runs = [];
  for (let i = 0; i < fr.length;) {
    if (fr[i].cents == null) { i++; continue; }
    let j = i; while (j < fr.length && fr[j].cents != null) j++;
    const idx = Array.from({ length: j - i }, (_, k) => i + k);
    runs.push({ i, j, cents: med(idx.map((k) => fr[k].cents)), db: mean(idx.map((k) => 20 * Math.log10(Math.max(1e-6, fr[k].rms) / loud))) });
    i = j;
  }
  const near = Math.round(0.5 / hop), stray = [];
  runs.forEach((u, k) => {
    if ((u.j - u.i) * hop >= 0.25) return;
    const nb = runs.filter((o, m) => m !== k && (o.i - u.j <= near && u.i - o.j <= near));
    if (!nb.length || !nb.every((o) => Math.abs(o.cents - u.cents) >= 1200)) return;
    const isDrop = u.db <= LEVEL.dropDb && nb.every((o) => o.cents - u.cents >= PASSAGE.leapCutSt * 100);
    if (!isDrop) stray.push(u);
  });
  for (const u of stray) for (let k = u.i; k < u.j; k++) fr[k] = unvoice(fr[k]);
  const voicedIdx = fr.map((_, i) => i).filter((i) => fr[i].cents != null);
  if (voicedIdx.length * hop < 0.5) return null;
  const notes = findNotes(track, cal).notes;
  const quality = singingAnalysis(track, null, cal).quality;
  const profile = performanceProfile(track, notes, P, cal.smoothSec);
  const { label, phraseOf } = frameLabels(track, notes, P, cal.smoothSec);
  const dB = (x) => 20 * Math.log10(Math.max(1e-6, x) / loud);
  const refPitch = med(voicedIdx.map((i) => fr[i].cents));
  const idxOf = (t) => Math.round(t / hop);
  const framesOf = (n) => { const out = []; for (let i = idxOf(n.start); i < Math.min(fr.length, idxOf(n.end)); i++) if (fr[i].cents != null) out.push(i); return out; };

  // Voice drops (see above): label their frames 'drop'.
  const noteLevel = notes.map((n) => mean(framesOf(n).map((i) => dB(fr[i].rms))) ?? 0);
  const drop = notes.map((n, k) => {
    const nb = [notes[k - 1], notes[k + 1]].filter(Boolean);
    return noteLevel[k] <= LEVEL.dropDb && nb.length > 0 && nb.every((o) => o.center - n.center >= PASSAGE.leapCutSt * 100);
  });
  notes.forEach((n, k) => { if (drop[k]) for (const i of framesOf(n)) label[i] = 'drop'; });
  const sung = notes.filter((_, k) => !drop[k]);
  const dropTimes = notes.filter((_, k) => drop[k]).map((n) => r(n.start));

  // Residual pitch movement around a 150 ms line (vibrato, wobble, scatter).
  const W = Math.round(0.075 / hop), resid = new Array(fr.length).fill(null);
  for (const i of voicedIdx) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(fr.length - 1, i + W); j++) if (fr[j].cents != null) { s += fr[j].cents; c++; }
    resid[i] = fr[i].cents - s / c;
  }
  const offset = quality.components?.intonation?.tuningOffsetCents ?? 0;
  const offGrid = (c) => { const d = (((c - offset) % 100) + 100) % 100; return Math.min(d, 100 - d); };

  // Sung notes (drops left out): leap from the previous sung note and landing overshoot (singing.js arrivalOvershoot).
  const N = sung.map((n, k) => {
    const a = sung[k - 1], j = notes.indexOf(n);
    let overshoot = null;
    // A landing straight out of a voice drop is not an arrival from the melody.
    if (a && !(j > 0 && drop[j - 1]) && a.run === n.run && Math.abs(n.center - a.center) >= 60) {
      overshoot = arrivalOvershoot(track, a, n, hop);
    }
    return { start: n.start, offGridCents: offGrid(n.center), leapSt: a ? (n.center - a.center) / 100 : null, overshootCents: overshoot };
  });

  // Phrases (breath-separated, as performance.js defines them).
  const nPh = Math.max(-1, ...phraseOf) + 1, phrases = [];
  for (let p = 0; p < nPh; p++) {
    const idx = fr.map((_, i) => i).filter((i) => phraseOf[i] === p);
    const v = idx.filter((i) => fr[i].cents != null);
    if (v.length * hop < 0.1) continue;
    const sungV = v.filter((i) => label[i] !== 'drop'), c = (sungV.length ? sungV : v).map((i) => (fr[i].cents - refPitch) / 100);
    phrases.push({ index: phrases.length, t0: fr[idx[0]].t, t1: fr[idx.at(-1)].t + hop, voicedSec: v.length * hop, peakSt: q(c, 0.95), lowSt: q(c, 0.05) });
  }
  if (!phrases.length) return null;

  // Unstable episodes: runs of unstable frames ≥ 150 ms. What the pitch line
  // did in each, measured, not judged:
  //   run       it stops on at least RUN.minStops pitches and passes straight
  //             through at least RUN.minPassed of them (a fast legato figure
  //             looks like this, and so does a voice searching in steps)
  //   moving    it stops on at least RUN.movingStops pitches, without that pattern
  //   slide     it holds no pitch but travels one way, by the singing
  //             analysis's own bend test: as directly as P.bendDirectness,
  //             never more than P.bendMarginCents past where it starts and
  //             ends, nor back against its direction. A slide longer than P.bendMaxSec, which the singing
  //             analysis counts as unstable, looks like this, and so does a
  //             voice drifting off its note
  //   unsteady  it holds no pitch, or only one, for RUN.stopSec, and swings
  //             back on itself or dips past where it ends
  // The kind only chooses how the stretch is described. It never changes the
  // labels, the passage cuts or the shares, because the pitch line cannot
  // tell a legato figure from searching (step 14 benchmark, 24 seeds per
  // kind: 11 of 24 fast legato melismas read as runs, and so did 8 of 26
  // stretches that hunt in steps or slide in stages). So a run or a moving
  // stretch is never painted as controlled, and never as torn; nor is a
  // slide (step 16). Only a stretch that held no pitch and swung back on
  // itself is.
  const episodes = []; let s0 = null;
  label.forEach((l, i) => {
    if (l === 'unstable') { if (s0 == null) s0 = i; return; }
    if (s0 != null && (i - s0) * hop >= 0.15) episodes.push({ i0: s0, i1: i, t0: r(fr[s0].t), sec: r((i - s0) * hop) });
    s0 = null;
  });
  const moving = new Array(fr.length).fill(false);
  for (const e of episodes) {
    const stops = pitchStops(fr, e.i0, e.i1, hop);
    e.stops = stops.length; e.passed = stops.filter((x) => x.passed).length;
    const shape = pathShape(fr, e.i0, e.i1, hop, cal.smoothSec);
    e.directness = r(shape.directness); e.beyondCents = r(Math.max(shape.beyond, shape.back), 0);
    e.kind = e.stops >= RUN.minStops && e.passed >= RUN.minPassed ? 'run' : e.stops >= RUN.movingStops ? 'moving'
      : shape.directness >= P.bendDirectness && Math.max(shape.beyond, shape.back) <= P.bendMarginCents ? 'slide' : 'unsteady';
    // A passage's moving share counts the stretches long enough to be drawn
    // as their own event (PASSAGE.episodeMinSec), as everything else does.
    if (e.kind !== 'unsteady' && e.sec >= PASSAGE.episodeMinSec) for (let i = e.i0; i < e.i1; i++) moving[i] = true;
    delete e.i0; delete e.i1;
  }

  // Passages: phrases split at long unstable episodes and big leaps.
  const segs = [];
  for (const p of phrases) {
    const cuts = new Map();
    for (const n of N) if (Math.abs(n.leapSt ?? 0) >= PASSAGE.leapCutSt && n.start > p.t0 + PASSAGE.minSec && n.start < p.t1 - PASSAGE.minSec) cuts.set(r(n.start), 'leap');
    for (const e of episodes) if (e.sec >= PASSAGE.episodeMinSec && e.t0 > p.t0 + PASSAGE.minSec && e.t0 < p.t1 - PASSAGE.minSec) cuts.set(r(e.t0), e.kind === 'unsteady' ? 'unstable' : 'moving');
    const bounds = [p.t0, ...[...cuts.keys()].sort((a, b) => a - b), p.t1], own = [];
    for (let k = 0; k < bounds.length - 1; k++) {
      const [a, b] = [bounds[k], bounds[k + 1]];
      if (own.length && b - a < PASSAGE.minSec) own.at(-1)[1] = b; else own.push([a, b]);
    }
    if (own.length > 1 && own.at(-1)[1] - own.at(-1)[0] < PASSAGE.minSec) { const last = own.pop(); own.at(-1)[1] = last[1]; }
    own.forEach(([a, b], k) => segs.push({ phrase: p.index, t0: a, t1: b, joinedBy: k > 0 ? cuts.get(r(a)) ?? 'leap' : null }));
  }
  const passages = segs.slice(0, PASSAGE.max).map((s) => {
    const F = [];
    for (let i = idxOf(s.t0); i < Math.min(fr.length, idxOf(s.t1)); i++) if (fr[i].cents != null) F.push(i);
    const S = F.filter((i) => label[i] !== 'drop'), use = S.length ? S : F;
    const PN = N.filter((n) => n.start >= s.t0 && n.start < s.t1);
    const share = (l) => use.filter((i) => label[i] === l).length / Math.max(1, use.length);
    const k = Math.min(20, Math.max(1, Math.floor(use.length / 4)));
    const pitch = use.map((i) => (fr[i].cents - refPitch) / 100), lv = F.map((i) => dB(fr[i].rms));
    let dips = 0, inDip = false; const lm = med(lv);
    for (const x of lv) { if (x < lm - 8) { if (!inDip) dips++; inDip = true; } else inDip = false; }
    const ov = PN.filter((n) => n.overshootCents != null).map((n) => n.overshootCents);
    return {
      t0: r(s.t0), t1: r(s.t1), phrase: s.phrase, joinedBy: s.joinedBy,
      pitch: { start: r(med(pitch.slice(0, k)), 1), end: r(med(pitch.slice(-k)), 1), median: r(med(pitch), 1), high: r(Math.max(...pitch), 1), low: r(Math.min(...pitch), 1) },
      level: { mean: r(mean(lv), 1), start: r(med(lv.slice(0, k)), 1), end: r(med(lv.slice(-k)), 1) },
      unstable: r(share('unstable')), bend: r(share('bend')), moving: r(use.filter((i) => moving[i]).length / Math.max(1, use.length)),
      articulationPerSec: r(dips / Math.max(0.1, F.length * hop)),
      offGridCents: PN.length ? r(mean(PN.map((n) => n.offGridCents)), 0) : null,
      maxLeapSt: PN.length ? r(Math.max(0, ...PN.map((n) => (n.start > s.t0 + 0.02 ? Math.abs(n.leapSt ?? 0) : 0))), 1) : 0,
      overshootCents: ov.length ? r(Math.max(...ov), 0) : null,
      entryLeapSt: s.joinedBy === 'leap' ? r(PN.find((n) => Math.abs(n.start - s.t0) < 0.02)?.leapSt ?? null, 1) : null,
      drops: dropTimes.filter((t) => t >= s.t0 && t < s.t1).length,
    };
  });

  const sungIdx = voicedIdx.filter((i) => label[i] !== 'drop');
  const allC = sungIdx.map((i) => (fr[i].cents - refPitch) / 100), allLv = voicedIdx.map((i) => dB(fr[i].rms));
  const onsets = N.map((n) => n.start), ioi = onsets.slice(1).map((t, i) => t - onsets[i]).filter((x) => x < 1.5);
  // Pitch breaks: octave-size jumps between consecutive frames, except into and out of a drop (counted once as the drop).
  let slips = 0;
  for (let k = 1; k < voicedIdx.length; k++) {
    const a = voicedIdx[k - 1], b = voicedIdx[k];
    if (b - a === 1 && label[a] !== 'drop' && label[b] !== 'drop' && Math.abs(fr[b].cents - fr[a].cents) > 900) slips++;
  }
  const dips = passages.reduce((a, p) => a + p.articulationPerSec * (p.t1 - p.t0), 0);
  const C = quality.components ?? {};
  return {
    version: MEASURE_VERSION,
    durationSec: r(fr.at(-1).t), voicedSec: r(voicedIdx.length * hop), gainDb: lev.gainDb,
    span: [r(phrases[0].t0), r(phrases.at(-1).t1)],
    pitchSpan: [r(Math.min(...phrases.map((p) => p.lowSt)), 1), r(Math.max(...phrases.map((p) => p.peakSt)), 1)],
    phraseCount: phrases.length,
    firstPhraseVoicedSec: r(phrases[0].voicedSec),
    gapsSec: phrases.slice(1).map((p, i) => r(p.t0 - phrases[i].t1)).slice(0, PASSAGE.max),
    passages,
    episodes: episodes.slice(0, PASSAGE.max),
    global: {
      pitchRangeSt: r(q(allC, 0.95) - q(allC, 0.05), 1),
      levelRangeDb: r(q(allLv, 0.95) - q(allLv, 0.1), 1),
      notesPerSec: r(N.length / (voicedIdx.length * hop)),
      ioiCv: ioi.length >= 3 ? r(std(ioi) / mean(ioi)) : null,
      controlledShare: profile.controlledShare,
      ornamentCents: r(mad(voicedIdx.filter((i) => label[i] === 'note').map((i) => resid[i])), 0),
      pitchBreaks: slips,
      drops: dropTimes.length,
      intonationDevCents: r(C.intonation?.deviationCents ?? null, 1),
      meanOvershootCents: r(C.transitions?.meanOvershootCents ?? null, 0),
      keyDriftCents: r(profile.tuning.driftCents, 0),
      tuningWanderCents: r(circularSpread(profile.tuning.localOffsets), 1),
      windowOffsets: profile.tuning.localOffsets.slice(0, 30),
      dipsPerSec: r(dips / Math.max(0.1, voicedIdx.length * hop)),
    },
  };
}

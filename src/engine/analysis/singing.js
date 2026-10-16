// Singing analysis from the fine pitch track (pitchtrack.js).
//
//   singingAnalysis(track, features?) → {
//     vocal:   is this sung (sustained pitched notes) rather than speech/noise?
//     notes:   the steady notes found
//     quality: component signals, a combined score, a confidence, and whether
//              the take is confidently strong
//     expression: dynamics and pitch movement (NOT part of quality)
//   }
//
// What this can and cannot measure (no target melody is known):
//   + pitch stability inside held notes (drift, slow wandering, jitter), with
//     regular vibrato recognised and not penalised;
//   + relative intonation: whether note centres sit on one consistent
//     semitone grid at the singer's own tuning (not whether they are the
//     song's notes);
//   + how notes are reached (clean arrival or hunting around the target;
//     a smooth slide is fine);
//   + steadiness of the voiced sound and continuity within phrases;
//   + onset regularity as a rough proxy for timing (no beat is known).
//   - It cannot say whether the notes or rhythm are the right ones.
// Every threshold lives in SINGING_CALIBRATION and is provisional: it was set
// on synthetic voices and needs calibration on real recordings.

import { TRACK_HOP_SEC } from './pitchtrack.js';

export const SINGING_VERSION = 1;

export const SINGING_CALIBRATION = {
  smoothSec: 0.15,          // removes vibrato (4–8 Hz) to see the note's slow line
  movingCentsPerSec: 350,   // faster than this on the smoothed line = between notes
  minNoteSec: 0.12,
  bridgeSec: 0.03,          // unvoiced gaps this short stay inside a run
  stability: { wobbleOk: 8, wobbleBad: 38, driftOk: 30, driftBad: 150, jitterOk: 12, jitterBad: 40 },
  intonation: { devGood: 12, devRandom: 28, minNotes: 4 },
  transitions: { overshoot: 50, minCount: 2 },
  weights: { stability: 0.3, intonation: 0.25, transitions: 0.15, control: 0.15, rhythm: 0.1, coherence: 0.05 },
  strong: { score: 0.8, confidence: 0.6, stability: 0.7, intonation: 0.6, transitions: 0.6 },
  sung: { sustainedRatio: 0.4, voicedSec: 1.5 },
  // A take "ends cleanly" when the voice stops before the recording does, or
  // the last sound is a held note; a voice still moving at the very end was
  // most likely cut off mid-phrase.
  ending: { quietSec: 0.2, heldSec: 0.3 },
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const r3 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);
const goodBad = (v, ok, bad) => clamp01(1 - (v - ok) / (bad - ok)); // 1 at ok, 0 at bad

function movingAverage(xs, w) {
  const out = new Array(xs.length), h = w >> 1;
  for (let i = 0; i < xs.length; i++) {
    const a = Math.max(0, i - h), b = Math.min(xs.length - 1, i + h);
    let s = 0;
    for (let k = a; k <= b; k++) s += xs[k];
    out[i] = s / (b - a + 1);
  }
  return out;
}

function linearFit(ys, dt) {
  const n = ys.length, xs = ys.map((_, i) => i * dt), mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den ? num / den : 0;
  return { slope, at: (i) => my + slope * (xs[i] - mx) };
}

// Normalised autocorrelation peak for lags in [lo, hi] (frames).
function periodicity(xs, lo, hi) {
  const m = mean(xs), d = xs.map((x) => x - m), e = d.reduce((a, b) => a + b * b, 0);
  if (!e) return 0;
  let best = 0;
  for (let lag = lo; lag <= Math.min(hi, xs.length - 4); lag++) {
    let s = 0;
    for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
    best = Math.max(best, s / e * (d.length / (d.length - lag)));
  }
  return best;
}

// Voiced runs (short gaps bridged) → steady notes on the smoothed line.
export function findNotes(track, cal = SINGING_CALIBRATION) {
  const fr = track.frames, hop = track.hopSec ?? TRACK_HOP_SEC;
  const bridge = Math.round(cal.bridgeSec / hop), w = Math.max(3, Math.round(cal.smoothSec / hop));
  const runs = [];
  let cur = null, gap = 0;
  fr.forEach((f, i) => {
    if (f.cents != null) {
      if (!cur) cur = { idx: [] };
      cur.idx.push(i); gap = 0;
    } else if (cur && ++gap > bridge) { runs.push(cur); cur = null; gap = 0; }
  });
  if (cur) runs.push(cur);

  const notes = [];
  runs.forEach((run, runIndex) => {
    if (run.idx.length < 3) return;
    const raw = run.idx.map((i) => fr[i].cents);
    const sm = movingAverage(raw, w);
    const moving = sm.map((_, k) => {
      const a = sm[Math.max(0, k - 2)], b = sm[Math.min(sm.length - 1, k + 2)];
      const span = (Math.min(sm.length - 1, k + 2) - Math.max(0, k - 2)) * hop;
      return Math.abs(b - a) / Math.max(hop, span) > cal.movingCentsPerSec;
    });
    let start = -1;
    for (let k = 0; k <= sm.length; k++) {
      const steady = k < sm.length && !moving[k];
      if (steady && start < 0) start = k;
      if (!steady && start >= 0) {
        if ((k - start) * hop >= cal.minNoteSec) {
          const ks = Array.from({ length: k - start }, (_, j) => start + j);
          notes.push({
            run: runIndex, start: fr[run.idx[start]].t, end: fr[run.idx[k - 1]].t + hop, sec: (k - start) * hop,
            raw: ks.map((j) => raw[j]), smooth: ks.map((j) => sm[j]),
            rms: ks.map((j) => fr[run.idx[j]].rms), clarity: ks.map((j) => fr[run.idx[j]].clarity),
            // the moving stretch just before this note (how it was reached)
            approach: start > 0 ? raw.slice(Math.max(0, start - Math.round(0.25 / hop)), start) : [],
          });
        }
        start = -1;
      }
    }
  });
  notes.forEach((n) => { n.center = median(n.raw); });
  return { notes, runs, voicedSec: fr.filter((f) => f.cents != null).length * hop };
}

function noteStability(n, hop, cal) {
  const trim = Math.min(3, Math.floor(n.smooth.length / 6));
  const sm = n.smooth.slice(trim, n.smooth.length - trim), raw = n.raw.slice(trim, n.raw.length - trim);
  if (sm.length < 8) return null;
  const fit = linearFit(sm, hop);
  const wobble = std(sm.map((v, i) => v - fit.at(i)));
  const detail = raw.map((v, i) => v - sm[i]);
  const jitter = std(detail);
  const vib = periodicity(detail, Math.round(0.11 / hop), Math.round(0.26 / hop));
  const vibrato = sm.length * hop >= 0.4 && vib >= 0.4 && jitter >= 6;
  const s = cal.stability;
  const drift = sm.length * hop >= 0.25 ? Math.abs(fit.slope) : 0;
  const score = 1 - 0.5 * (1 - goodBad(wobble, s.wobbleOk, s.wobbleBad)) - 0.3 * (1 - goodBad(drift, s.driftOk, s.driftBad))
    - (vibrato ? 0 : 0.2 * (1 - goodBad(jitter, s.jitterOk, s.jitterBad)));
  return { sec: n.sec, wobble, drift, jitter, vibrato, score: clamp01(score) };
}

// Mean distance of note centres from the nearest semitone at the best
// global tuning offset (duration-weighted). ~25–29 cents for random pitches.
function intonationDeviation(notes) {
  let best = Infinity, bestOffset = 0;
  const tot = notes.reduce((a, n) => a + n.sec, 0);
  for (let o = 0; o < 100; o++) {
    let s = 0;
    for (const n of notes) { const d = ((n.center - o) % 100 + 100) % 100; s += Math.min(d, 100 - d) * n.sec; }
    if (s / tot < best) { best = s / tot; bestOffset = o; }
  }
  return { deviation: best, offset: bestOffset };
}

function endingOf(track, notes, cal) {
  const fr = track.frames, hop = track.hopSec ?? TRACK_HOP_SEC;
  if (!fr.length) return { trailingQuietSec: 0, lastNoteHeldSec: null, clean: false };
  const loud = [...fr.map((f) => f.rms)].sort((a, b) => a - b)[Math.floor(fr.length * 0.95)] || 0;
  const floor = Math.max(0.008, 0.15 * loud);
  let last = -1;
  for (let i = fr.length - 1; i >= 0; i--) if (fr[i].rms >= floor) { last = i; break; }
  const end = fr[fr.length - 1].t + hop;
  const trailingQuietSec = last < 0 ? end : end - (fr[last].t + hop);
  const lastVoiced = [...fr].reverse().find((f) => f.cents != null);
  const lastNote = notes[notes.length - 1];
  const held = lastNote && lastVoiced && lastVoiced.t - lastNote.end < 0.12 ? lastNote.sec : null;
  return { trailingQuietSec: r3(trailingQuietSec), lastNoteHeldSec: r3(held), clean: trailingQuietSec >= cal.ending.quietSec || (held ?? 0) >= cal.ending.heldSec };
}

export function singingAnalysis(track, features = null, cal = SINGING_CALIBRATION) {
  const hop = track.hopSec ?? TRACK_HOP_SEC;
  const { notes, voicedSec } = findNotes(track, cal);
  const noteSec = notes.reduce((a, n) => a + n.sec, 0);
  const sustainedRatio = voicedSec ? noteSec / voicedSec : 0;
  const vocal = {
    voicedSec: r3(voicedSec), noteCount: notes.length, noteSec: r3(noteSec), sustainedRatio: r3(sustainedRatio),
    sung: voicedSec >= cal.sung.voicedSec && sustainedRatio >= cal.sung.sustainedRatio,
    ending: endingOf(track, notes, cal),
  };

  const C = {}, unavailable = [];
  // 1. Pitch stability inside held notes.
  const st = notes.map((n) => noteStability(n, hop, cal)).filter(Boolean);
  if (st.length) {
    const w = st.reduce((a, s) => a + s.sec, 0);
    C.stability = { score: r3(st.reduce((a, s) => a + s.score * s.sec, 0) / w), notes: st.length,
      wobbleCents: r3(mean(st.map((s) => s.wobble))), driftCentsPerSec: r3(mean(st.map((s) => s.drift))),
      jitterCents: r3(mean(st.map((s) => s.jitter))), vibratoShare: r3(st.filter((s) => s.vibrato).length / st.length) };
  } else unavailable.push('stability: no held notes long enough');

  // 2. Relative intonation (consistency of note centres, not correctness).
  const inNotes = notes.filter((n) => n.sec >= 0.15);
  if (inNotes.length >= cal.intonation.minNotes) {
    const { deviation, offset } = intonationDeviation(inNotes);
    C.intonation = { score: r3(goodBad(deviation, cal.intonation.devGood, cal.intonation.devRandom)), deviationCents: r3(deviation), tuningOffsetCents: offset, notes: inNotes.length };
  } else unavailable.push(`intonation: fewer than ${cal.intonation.minNotes} notes`);

  // 3. Transitions: does the voice arrive cleanly, or hunt around the target?
  const tr = [];
  for (let i = 1; i < notes.length; i++) {
    const a = notes[i - 1], b = notes[i];
    if (a.run !== b.run || Math.abs(b.center - a.center) < 60) continue;
    const dir = Math.sign(b.center - a.center);
    const path = [...b.approach, ...b.raw.slice(0, Math.round(0.08 / hop))];
    const overshoot = Math.max(0, ...path.map((c) => dir * (c - b.center)));
    tr.push({ interval: b.center - a.center, overshoot, clean: overshoot <= cal.transitions.overshoot });
  }
  if (tr.length >= cal.transitions.minCount) C.transitions = { score: r3(tr.filter((t) => t.clean).length / tr.length), count: tr.length, meanOvershootCents: r3(mean(tr.map((t) => t.overshoot))) };
  else unavailable.push('transitions: too few note changes');

  // 4. Vocal control: steady voiced sound inside notes, continuity in phrases.
  if (notes.length) {
    const cv = mean(notes.map((n) => std(n.rms) / Math.max(1e-4, mean(n.rms))));
    const clar = mean(notes.flatMap((n) => n.clarity));
    const vr = features?.activity?.voicedRatio ?? null;
    const parts = [goodBad(cv, 0.12, 0.45), goodBad(1 - clar, 0.08, 0.3)];
    if (vr != null) parts.push(clamp01((vr - 0.4) / 0.4));
    C.control = { score: r3(mean(parts)), levelVariation: r3(cv), clarity: r3(clar), voicedRatio: vr };
  }

  // 5. Rhythm and phrasing (proxies: no beat or score is known).
  if (features?.activity) {
    const sounding = Math.max(0.5, features.activity.soundingSec ?? 0);
    const flow = clamp01(1 - (features.pauses?.count ?? 0) / sounding / 0.8);
    const reg = features.onsets?.regularityProxy;
    C.rhythm = { score: r3(reg == null ? flow : 0.5 * reg + 0.5 * flow), onsetRegularityProxy: reg ?? null, flow: r3(flow) };
  } else unavailable.push('rhythm: no frame features');

  // 6. Melodic coherence: mostly steps and modest leaps (heuristic).
  if (notes.length >= 3) {
    const ints = notes.slice(1).map((n, i) => Math.abs(n.center - notes[i].center));
    C.coherence = { score: r3(ints.filter((d) => d <= 700).length / ints.length), largestLeapCents: r3(Math.max(...ints)) };
  }

  // Combined score over the available components; confidence from evidence.
  const W = cal.weights;
  const keys = Object.keys(W).filter((k) => C[k]);
  const wsum = keys.reduce((a, k) => a + W[k], 0);
  const score = wsum ? keys.reduce((a, k) => a + W[k] * C[k].score, 0) / wsum : null;
  const clarity = notes.length ? mean(notes.flatMap((n) => n.clarity)) : 0;
  const confidence = clamp01(noteSec / 4) * clamp01(notes.length / 6) * clamp01((clarity - 0.6) / 0.3) * (C.intonation ? 1 : 0.6);
  const S = cal.strong;
  const strong = score != null && score >= S.score && confidence >= S.confidence
    && (C.stability?.score ?? 0) >= S.stability && (C.intonation?.score ?? 0) >= S.intonation
    && (!C.transitions || C.transitions.score >= S.transitions);

  const cents = notes.map((n) => n.center);
  const expression = {
    dynamicRangeDb: features?.energy?.dynamicRangeDb ?? null,
    pitchRangeCents: cents.length ? r3(Math.max(...cents) - Math.min(...cents)) : null,
    vibratoShare: C.stability?.vibratoShare ?? null,
  };

  return {
    version: SINGING_VERSION,
    vocal,
    quality: { score: r3(score), confidence: r3(confidence), strong, components: C, unavailable },
    expression,
  };
}

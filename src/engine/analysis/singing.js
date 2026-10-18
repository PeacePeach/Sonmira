// Singing analysis from the fine pitch track (pitchtrack.js).
//
//   singingAnalysis(track, features?) → {
//     vocal:   is this sung (sustained pitched notes) rather than speech/noise?
//     notes:   the steady notes found (held notes on the smoothed line, plus
//              short sung syllables the smoothed line cannot see)
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
import { performanceProfile } from './performance.js';

export const SINGING_VERSION = 4;

export const SINGING_CALIBRATION = {
  smoothSec: 0.15,          // removes vibrato (4–8 Hz) to see the note's slow line
  movingCentsPerSec: 350,   // faster than this on the smoothed line = between notes
  // The slope is measured across this span. It must cover about one vibrato
  // cycle: over a shorter span the vibrato the smoother leaves behind (about
  // 20 % of its depth at 5–6 Hz) reads as movement, and wide expressive
  // vibrato (±70–100 cents) made whole held notes "moving".
  moveSpanSec: 0.2,
  minNoteSec: 0.12,
  bridgeSec: 0.03,          // unvoiced gaps this short stay inside a run
  stability: { wobbleOk: 8, wobbleBad: 38, driftOk: 30, driftBad: 150, jitterOk: 12, jitterBad: 40 },
  intonation: { devGood: 12, devRandom: 28, minNotes: 4 },
  transitions: { overshoot: 50, minCount: 2 },
  weights: { stability: 0.3, intonation: 0.25, transitions: 0.15, control: 0.15, rhythm: 0.1, coherence: 0.05 },
  // intonation 0.8 (was 0.6): on the first real takes (Han, 16 Oct) a casual
  // and a careful take of the same song differed most in tuning consistency
  // (0.755 vs 1.0); the singer heard the casual one as Gathered.
  strong: { score: 0.8, confidence: 0.6, stability: 0.7, intonation: 0.8, transitions: 0.6 },
  // Whole-performance control (performance.js). PROVISIONAL: set on
  // synthetic takes only (mixed-quality takes measure window p25 0.43–0.45
  // and 40 % weak windows; consistently controlled takes, including
  // improvised, transposed, breathy and fast syllabic singing, ≥ 0.70 and
  // none), to be recalibrated on labelled real recordings. They only decide
  // Strong (Resolved) eligibility; they never move a take below Gathered.
  performance: {
    bendMaxSec: 0.6,        // a slide between notes up to this long is expressive, not unstable
    bendDirectness: 0.7,    // net movement / path length for a bend (1 = one-way)
    bendMarginCents: 100,   // or, between notes < 150 cents apart, never leaving their span by more than this
    edgeSec: 0.25,          // onset scoop / release fall-off allowed per phrase
    phraseGapSec: 0.35,     // silence longer than this ends a phrase (a breath)
    windowSec: 2,           // windows of voiced time
    weakWindow: 0.5,        // a window less controlled than this is weak
  },
  strongPerformance: {
    controlledShare: 0.6,   // of all voiced time: notes, bends and phrase edges
    windowP25: 0.6,         // the weaker windows must be controlled too
    maxWeakWindowShare: 0.15, // at most about 1 weak window in 7 …
    minWeakWindowsAllowed: 1, // … but always one: a short take has only 4–5 windows, and
                              // the singer heard a 4-window take with one weak
                              // stretch as Resolved (16 Oct)
    maxTuningDriftCents: 50, // the singer's own key may not keep sliding
    minRhythm: 0.25,        // only extremely weak rhythm blocks Strong (timing is expressive)
    minCoherence: 0.25,     // only extremely erratic leaps block Strong
  },
  // Sung vs spoken: share of voiced time spent on held notes. Synthetic
  // speech measures 0.13–0.19; syllabic sung lyrics 0.36–0.66 (very fast
  // syllables, ~0.15–0.28 s, about 0.28). Provisional until real recordings.
  sung: { sustainedRatio: 0.3, voicedSec: 1.5 },
  // A take "ends cleanly" when the voice stops before the recording does, or
  // the last sound is a held note. Diagnostic only (see C.ending): an abrupt
  // end usually just means the user stopped recording straight away.
  ending: { quietSec: 0.2, heldSec: 0.3 },
  // Short notes (findShortNotes). The smoothed line needs a note to last about
  // 0.4 s before any of it reads as steady, so sung syllables of ~0.2 s (most
  // sung lyrics) were never notes and their held pitch counted as unstable.
  // These describe the detector, not a quality bar; checked against Basic
  // Pitch on three real Mandarin takes and against synthetic speech (18 Oct).
  shortNotes: {
    medianSec: 0.05,   // jitter and single-frame slips, much shorter than a syllable
    leaveCents: 60,    // further than this from the note's centre is "away" (wider than ±45 c vibrato)
    stayAwaySec: 0.06, // away this long ends the note; a vibrato crest lasts less
    edgeSec: 0.04,     // articulation is looked for this close to the note's start or end …
    dipDb: 3,          // … a level dip (a consonant, a re-attack) …
    stepCents: 100,    // … or a pitch step this large within edgeSec
  },
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

// Voiced runs (short gaps bridged): frame indices per run.
function voicedRuns(fr, bridge) {
  const runs = [];
  let cur = null, gap = 0;
  fr.forEach((f, i) => {
    if (f.cents != null) {
      if (!cur) cur = { idx: [] };
      cur.idx.push(i); gap = 0;
    } else if (cur && ++gap > bridge) { runs.push(cur); cur = null; gap = 0; }
  });
  if (cur) runs.push(cur);
  return runs;
}

// All notes: the steady notes on the smoothed line, plus the short sung notes
// it cannot see, found only in the time it left uncovered.
export function findNotes(track, cal = SINGING_CALIBRATION) {
  const steady = findSteadyNotes(track, cal);
  const short = findShortNotes(track, cal, steady.notes);
  return { ...steady, notes: [...steady.notes, ...short].sort((a, b) => a.start - b.start), shortNotes: short.length };
}

// Steady notes on the smoothed line.
export function findSteadyNotes(track, cal = SINGING_CALIBRATION) {
  const fr = track.frames, hop = track.hopSec ?? TRACK_HOP_SEC;
  const bridge = Math.round(cal.bridgeSec / hop), w = Math.max(3, Math.round(cal.smoothSec / hop));
  const span = Math.max(1, Math.round(cal.moveSpanSec / 2 / hop));
  const runs = voicedRuns(fr, bridge);

  const notes = [];
  runs.forEach((run, runIndex) => {
    if (run.idx.length < 3) return;
    const raw = run.idx.map((i) => fr[i].cents);
    const sm = movingAverage(raw, w);
    const moving = sm.map((_, k) => {
      const a = sm[Math.max(0, k - span)], b = sm[Math.min(sm.length - 1, k + span)];
      const sec = (Math.min(sm.length - 1, k + span) - Math.max(0, k - span)) * hop;
      return Math.abs(b - a) / Math.max(hop, sec) > cal.movingCentsPerSec;
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

// Short sung notes (syllables of ~0.12–0.4 s) in the voiced time the steady
// notes leave uncovered. Inside each run, on a 50 ms median of the raw pitch,
// a note grows while the pitch stays near its own running centre and ends
// only when the pitch stays away (a vibrato swing returns; a new note or a
// glide does not). A candidate counts when it
//   lasts minNoteSec, does not glide (its slow line moves slower than
//   movingCentsPerSec across it: a spoken syllable glides, a sung one holds;
//   on notes under ~0.25 s a ±30 c vibrato looks like a glide and is left out),
//   and is articulated at its start or end by a voice gap, a level dip or a
//   pitch step (the top of a slow, wandering swing also stays in the band
//   for a moment, but nothing articulates it).
// A candidate touching a steady note at the same pitch is that note's own
// head or tail, not a new note.
export function findShortNotes(track, cal = SINGING_CALIBRATION, steady = []) {
  const P = cal.shortNotes, fr = track.frames, hop = track.hopSec ?? TRACK_HOP_SEC;
  if (!P || !fr.length) return [];
  const w = Math.max(3, Math.round(cal.smoothSec / hop));
  const mh = Math.max(1, Math.round(P.medianSec / hop / 2)), stay = Math.max(1, Math.round(P.stayAwaySec / hop));
  const E = Math.max(1, Math.round(P.edgeSec / hop)), minLen = Math.round(cal.minNoteSec / hop);
  const t0 = fr[0].t, frameOf = (t) => Math.round((t - t0) / hop);
  const taken = new Set();
  for (const n of steady) for (let i = frameOf(n.start); i < frameOf(n.end); i++) taken.add(i);

  const notes = [];
  voicedRuns(fr, Math.round(cal.bridgeSec / hop)).forEach((run, runIndex) => {
    if (run.idx.length < 3) return;
    const raw = run.idx.map((i) => fr[i].cents);
    const sm = movingAverage(raw, w);
    const med = raw.map((_, k) => median(raw.slice(Math.max(0, k - mh), k + mh + 1)));
    // Grow candidates along the run.
    const segs = [];
    for (let s = 0; s < med.length;) {
      let e = s, centre = med[s], away = 0;
      const vals = [med[s]];
      for (let k = s + 1; k < med.length; k++) {
        if (Math.abs(med[k] - centre) > P.leaveCents) { if (++away >= stay) break; continue; }
        away = 0; e = k; vals.push(med[k]);
        if (vals.length % 3 === 0) centre = median(vals);
      }
      // Only the time the steady notes left uncovered.
      for (let a = s, k = s; k <= e + 1; k++) {
        if (k > e || taken.has(run.idx[k])) { if (k - 1 >= a) segs.push([a, k - 1]); a = k + 1; }
      }
      s = e + 1;
    }
    for (const [a, b] of segs) {
      const len = b - a + 1;
      if (len < minLen) continue;
      const third = Math.max(1, Math.floor(len / 3));
      const head = median(med.slice(a, a + third)), tail = median(med.slice(b + 1 - third, b + 1));
      if (Math.abs(tail - head) > P.leaveCents || Math.abs(tail - head) / ((len - third) * hop) >= cal.movingCentsPerSec) continue;
      if (!articulated(fr, run, raw, a, b, E, P)) continue;
      const ks = Array.from({ length: len }, (_, j) => a + j), rawSeg = raw.slice(a, b + 1);
      const n = {
        run: runIndex, start: fr[run.idx[a]].t, end: fr[run.idx[b]].t + hop, sec: len * hop,
        raw: rawSeg, smooth: ks.map((j) => sm[j]),
        rms: ks.map((j) => fr[run.idx[j]].rms), clarity: ks.map((j) => fr[run.idx[j]].clarity),
        approach: a > 0 ? raw.slice(Math.max(0, a - Math.round(0.25 / hop)), a) : [],
        center: median(rawSeg), short: true,
      };
      const ownHeadOrTail = steady.some((m) => Math.abs(m.center - n.center) <= P.leaveCents
        && (Math.abs(m.start - n.end) <= cal.bridgeSec + hop || Math.abs(n.start - m.end) <= cal.bridgeSec + hop));
      if (!ownHeadOrTail) notes.push(n);
    }
  });
  return notes;
}

// A note starts or ends with a voice gap, a level dip below the note's own
// level, or a pitch step (run frames a..b; E frames either side).
function articulated(fr, run, raw, a, b, E, P) {
  if (a - E < 0 || b + E >= raw.length) return true;
  const own = median(run.idx.slice(a, b + 1).map((i) => fr[i].rms));
  const dip = (i0, i1) => {
    let m = Infinity;
    for (let i = i0; i <= i1; i++) { if (fr[i].cents == null) return Infinity; m = Math.min(m, fr[i].rms); }
    return 20 * Math.log10(own / Math.max(1e-5, m));
  };
  if (dip(run.idx[a] - E, run.idx[a] + E) >= P.dipDb || dip(run.idx[b] - E, run.idx[b] + E) >= P.dipDb) return true;
  return Math.abs(raw[a] - raw[a - E]) >= P.stepCents || Math.abs(raw[b + E] - raw[b]) >= P.stepCents;
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
  const vibrato = sm.length * hop >= 0.25 && vib >= 0.4 && jitter >= 6;
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

// The overall shape of the melody, from the settled notes in time order:
// the duration-weighted pitch of the first, middle and last third of the
// sung time. Descriptive only (gesture, never quality): rising, falling,
// arching (up then down), dipping (down then up) or level. Null with fewer
// than 3 notes.
export const CONTOUR_CENTS = 150;
export function melodicContour(notes, cents = CONTOUR_CENTS) {
  if (notes.length < 3) return null;
  const total = notes.reduce((a, n) => a + n.sec, 0);
  const thirds = [[0, 0], [0, 0], [0, 0]];
  let t = 0;
  for (const n of notes) {
    const k = Math.min(2, Math.floor(((t + n.sec / 2) / total) * 3));
    thirds[k][0] += n.center * n.sec; thirds[k][1] += n.sec; t += n.sec;
  }
  if (thirds.some(([, w]) => !w)) return null;
  const [a, m, b] = thirds.map(([s, w]) => s / w);
  if (m - Math.max(a, b) > cents) return 'arching';
  if (Math.min(a, b) - m > cents) return 'dipping';
  if (b - a > cents) return 'rising';
  if (a - b > cents) return 'falling';
  return 'level';
}

export function singingAnalysis(track, features = null, cal = SINGING_CALIBRATION) {
  const hop = track.hopSec ?? TRACK_HOP_SEC;
  const { notes, voicedSec } = findNotes(track, cal);
  const noteSec = notes.reduce((a, n) => a + n.sec, 0);
  const sustainedRatio = voicedSec ? noteSec / voicedSec : 0;
  // Each condition of "sung", with its value and threshold, for diagnostics.
  const sungChecks = [
    { id: 'voiced_sec', ok: voicedSec >= cal.sung.voicedSec, value: r3(voicedSec), need: `≥ ${cal.sung.voicedSec} s of pitched voice` },
    { id: 'sustained_ratio', ok: sustainedRatio >= cal.sung.sustainedRatio, value: r3(sustainedRatio), need: `≥ ${cal.sung.sustainedRatio} of voiced time on held notes (${r3(noteSec)} s in ${notes.length} notes)` },
  ];
  const vocal = {
    voicedSec: r3(voicedSec), noteCount: notes.length, noteSec: r3(noteSec), sustainedRatio: r3(sustainedRatio),
    sung: sungChecks.every((c) => c.ok),
    sungChecks,
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
    C.intonation = { measures: 'relative tuning consistency: notes on one semitone grid at the singer\'s own tuning, not the song\'s notes',
      score: r3(goodBad(deviation, cal.intonation.devGood, cal.intonation.devRandom)), deviationCents: r3(deviation), tuningOffsetCents: offset, notes: inNotes.length };
  } else unavailable.push(`intonation: fewer than ${cal.intonation.minNotes} notes`);

  // 3. Transitions: does the voice arrive cleanly, or hunt around the target?
  const tr = [];
  for (let i = 1; i < notes.length; i++) {
    const a = notes[i - 1], b = notes[i];
    if (a.run !== b.run || Math.abs(b.center - a.center) < 60) continue;
    const dir = Math.sign(b.center - a.center);
    const path = [...b.approach, ...b.raw.slice(0, Math.round(0.08 / hop))];
    // Beyond what the note itself does once settled: its own vibrato swing
    // is not overshoot.
    const settled = b.raw.slice(Math.round(0.08 / hop));
    const swing = settled.length ? Math.max(0, ...settled.map((c) => dir * (c - b.center))) : 0;
    const overshoot = Math.max(0, Math.max(...path.map((c) => dir * (c - b.center))) - swing);
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

  // 7. The whole performance: how much of the voiced singing, and of its
  // weakest stretches, is controlled (not scored; it decides eligibility).
  const perf = performanceProfile(track, notes, cal.performance, cal.smoothSec);
  C.performance = { scored: false, ...perf };

  // Combined score over the available components (settled notes only).
  const W = cal.weights;
  const keys = Object.keys(W).filter((k) => C[k]);
  const wsum = keys.reduce((a, k) => a + W[k], 0);
  const score = wsum ? keys.reduce((a, k) => a + W[k] * C[k].score, 0) / wsum : null;
  const clarity = notes.length ? mean(notes.flatMap((n) => n.clarity)) : 0;
  // Evidence: how much clean material there was to judge (this used to be
  // reported as confidence). Confidence also asks whether the judgement
  // holds for the whole take: it falls when the weaker windows are not
  // controlled, so a few good notes cannot carry it.
  const evidence = clamp01(noteSec / 4) * clamp01(notes.length / 6) * clamp01((clarity - 0.6) / 0.3) * (C.intonation ? 1 : 0.6);
  const consistency = perf.windowP25 == null ? 0 : clamp01((perf.windowP25 - 0.3) / 0.4);
  const confidence = evidence * consistency;
  // Ending: reported for stage 2, not scored. Stopping the recording right
  // after singing is a recording action, not a singing fault, so it never
  // lowers the score or the tier.
  C.ending = { scored: false, ...vocal.ending };

  // Strong needs a high score from the settled notes AND control across the
  // whole performance. Each condition is reported for the dev panel.
  const S = cal.strong, SP = cal.strongPerformance;
  const strongChecks = [
    { id: 'score', ok: score != null && score >= S.score, value: r3(score), need: `≥ ${S.score}` },
    { id: 'confidence', ok: confidence >= S.confidence, value: r3(confidence), need: `≥ ${S.confidence} (evidence × consistency)` },
    { id: 'stability', ok: (C.stability?.score ?? 0) >= S.stability, value: C.stability?.score ?? null, need: `≥ ${S.stability}` },
    { id: 'intonation', ok: (C.intonation?.score ?? 0) >= S.intonation, value: C.intonation?.score ?? null, need: `≥ ${S.intonation} (relative tuning consistency)` },
    { id: 'transitions', ok: !C.transitions || C.transitions.score >= S.transitions, value: C.transitions?.score ?? 'not measured', need: `≥ ${S.transitions} when measured` },
    { id: 'controlled_share', ok: (perf.controlledShare ?? 0) >= SP.controlledShare, value: perf.controlledShare, need: `≥ ${SP.controlledShare} of voiced time controlled` },
    { id: 'weakest_windows', ok: (perf.windowP25 ?? 0) >= SP.windowP25, value: perf.windowP25, need: `p25 of ${cal.performance.windowSec} s windows ≥ ${SP.windowP25}` },
    { id: 'weak_windows', ok: perf.windows.length > 0 && Math.round(perf.weakWindowShare * perf.windows.length) <= Math.max(SP.minWeakWindowsAllowed ?? 0, Math.floor(SP.maxWeakWindowShare * perf.windows.length)), value: perf.weakWindowShare, need: `≤ ${SP.maxWeakWindowShare} of windows under ${cal.performance.weakWindow}, at least ${SP.minWeakWindowsAllowed ?? 0} allowed` },
    { id: 'key_drift', ok: perf.tuning.driftCents <= SP.maxTuningDriftCents, value: perf.tuning.driftCents, need: `≤ ${SP.maxTuningDriftCents} cents` },
    { id: 'rhythm', ok: !C.rhythm || C.rhythm.score >= SP.minRhythm, value: C.rhythm?.score ?? 'not measured', need: `≥ ${SP.minRhythm} (only extreme cases)` },
    { id: 'coherence', ok: !C.coherence || C.coherence.score >= SP.minCoherence, value: C.coherence?.score ?? 'not measured', need: `≥ ${SP.minCoherence} (only extreme cases)` },
  ];
  const strong = strongChecks.every((c) => c.ok);

  const cents = notes.map((n) => n.center);
  const expression = {
    dynamicRangeDb: features?.energy?.dynamicRangeDb ?? null,
    pitchRangeCents: cents.length ? r3(Math.max(...cents) - Math.min(...cents)) : null,
    vibratoShare: C.stability?.vibratoShare ?? null,
    contour: melodicContour(notes),
  };

  return {
    version: SINGING_VERSION,
    vocal,
    quality: { score: r3(score), confidence: r3(confidence), evidence: r3(evidence), consistency: r3(consistency), strong, strongChecks, components: C, unavailable },
    expression,
  };
}

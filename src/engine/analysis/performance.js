// Whole-performance singing control (stage 2, Strong eligibility only).
//
//   performanceProfile(track, notes, P) → {
//     voicedSec, controlledShare, unstableSec, labels,
//     windows: [{ t0, t1, controlled }], windowP25, weakWindowShare,
//     tuning: { localOffsets, driftCents }
//   }
//
// The note-based components in singing.js only see notes that settled, so a
// take that wanders for half its length could still score as strong. Here
// every voiced frame counts (pauses and breaths are not counted at all) and
// is labelled:
//   note     inside a settled note (vibrato included: notes are found on the
//            vibrato-smoothed line)
//   bend     a purposeful move between two settled notes of one phrase: the
//            pitch travels mostly one way (a slide, scoop or portamento) or
//            stays between two neighbouring notes (re-articulation), up to
//            bendMaxSec
//   edge     a short onset scoop before a phrase's first note or a fall-off
//            after its last
//   unstable anything else: wandering, hunting, pitch that never settles
// The controlled share is measured over the whole take and per window of
// voiced time, so one good stretch cannot hide a poor one. Tuning is tracked
// per window against the singer's own grid: a constant offset (transposition,
// the singer's own key) costs nothing; a grid that keeps moving (sinking or
// wandering tuning) is reported as drift. Nothing here knows the song: an
// unfamiliar or improvised melody that settles is fully controlled.

import { TRACK_HOP_SEC } from './pitchtrack.js';

const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r3 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);

function gridOffset(centres) {
  let best = Infinity, off = 0;
  for (let o = 0; o < 100; o++) {
    let s = 0;
    for (const c of centres) { const d = ((c - o) % 100 + 100) % 100; s += Math.min(d, 100 - d); }
    if (s < best) { best = s; off = o; }
  }
  return off;
}
// Smallest signed difference between two grid offsets (cents, -50..50).
const offDiff = (a, b) => ((a - b + 150) % 100) - 50;

// Every voiced frame's label (note | bend | edge | unstable; null when
// unvoiced) and its phrase index (-1 outside phrases).
export function frameLabels(track, notes, P, smoothSec = 0.15) {
  const fr = track.frames, hop = track.hopSec ?? TRACK_HOP_SEC;
  const label = fr.map((f) => (f.cents == null ? null : 'unstable'));
  const idxOf = (t) => Math.round(t / hop);
  for (const n of notes) for (let i = idxOf(n.start); i < Math.min(fr.length, idxOf(n.end)); i++) if (label[i]) label[i] = 'note';

  // Phrases: voiced stretches separated by more than phraseGapSec of silence.
  const gap = Math.round(P.phraseGapSec / hop);
  const phraseOf = new Array(fr.length).fill(-1);
  let ph = -1, quiet = gap + 1;
  fr.forEach((f, i) => { if (f.cents != null) { if (quiet > gap) ph++; phraseOf[i] = ph; quiet = 0; } else quiet++; });

  // Stretches between settled notes: bends when short and mostly one-way.
  const noteSpans = notes.map((n) => [idxOf(n.start), idxOf(n.end)]);
  for (let k = 1; k < noteSpans.length; k++) {
    const a = noteSpans[k - 1][1], b = noteSpans[k][0];
    if (b <= a || phraseOf[a - 1] !== phraseOf[b] || (b - a) * hop > P.bendMaxSec) continue;
    // On the vibrato-smoothed line, so a note's vibrato does not count as travel.
    const half = Math.round(smoothSec / 2 / hop), path = [];
    for (let i = a; i < b; i++) {
      if (fr[i].cents == null) continue;
      let sum = 0, cnt = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(fr.length - 1, i + half); j++) if (fr[j].cents != null) { sum += fr[j].cents; cnt++; }
      path.push(sum / cnt);
    }
    const from = notes[k - 1].center, to = notes[k].center;
    let len = 0, prev = from;
    for (const c of path) { len += Math.abs(c - prev); prev = c; }
    len += Math.abs(to - prev);
    const lo = Math.min(from, to) - P.bendMarginCents, hi = Math.max(from, to) + P.bendMarginCents;
    const bounded = Math.abs(to - from) < 150 && path.every((c) => c >= lo && c <= hi);
    if (len === 0 || bounded || Math.abs(to - from) / len >= P.bendDirectness) for (let i = a; i < b; i++) if (label[i] === 'unstable') label[i] = 'bend';
  }
  // Onset scoop and release at each phrase's edges.
  const edge = Math.round(P.edgeSec / hop);
  for (let i = 0; i < fr.length; i++) {
    if (label[i] !== 'unstable') continue;
    const p = phraseOf[i];
    let toNote = 0, fromNote = 0;
    for (let j = i; j < Math.min(fr.length, i + edge + 1) && phraseOf[j] === p; j++) { if (label[j] === 'note') { toNote = 1; break; } }
    for (let j = i; j >= Math.max(0, i - edge) && phraseOf[j] === p; j--) { if (label[j] === 'note') { fromNote = 1; break; } }
    const firstOfPhrase = !fr.slice(Math.max(0, i - 3 * edge), i).some((f, j) => phraseOf[i - 3 * edge + j] === p && label[i - 3 * edge + j] === 'note');
    const lastOfPhrase = !fr.slice(i + 1, i + 1 + 3 * edge).some((f, j) => phraseOf[i + 1 + j] === p && label[i + 1 + j] === 'note');
    if ((toNote && firstOfPhrase) || (fromNote && lastOfPhrase)) label[i] = 'edge';
  }

  return { label, phraseOf };
}

export function performanceProfile(track, notes, P, smoothSec = 0.15) {
  const fr = track.frames, hop = track.hopSec ?? TRACK_HOP_SEC;
  const { label } = frameLabels(track, notes, P, smoothSec);

  const voiced = label.map((l, i) => [l, i]).filter(([l]) => l);
  const controlled = (ls) => (ls.length ? ls.filter(([l]) => l !== 'unstable').length / ls.length : null);
  const per = Math.round(P.windowSec / hop), windows = [];
  for (let s = 0; s < voiced.length; s += per) {
    const w = voiced.slice(s, s + per);
    if (w.length < per / 2 && windows.length) { // fold a short tail into the last window
      const last = windows[windows.length - 1]; last.frames.push(...w); last.controlled = controlled(last.frames); last.t1 = fr[w[w.length - 1][1]].t; continue;
    }
    windows.push({ frames: w, t0: fr[w[0][1]].t, t1: fr[w[w.length - 1][1]].t, controlled: controlled(w) });
  }
  // Tuning per window (its notes' own grid), relative to the first window.
  const localOffsets = windows.map((w) => {
    const cs = notes.filter((n) => n.start >= w.t0 - 0.05 && n.start < w.t1).map((n) => n.center);
    return cs.length >= 2 ? gridOffset(cs) : null;
  });
  const known = localOffsets.filter((o) => o != null);
  let driftCents = 0;
  if (known.length >= 2) { let acc = 0, maxAbs = 0; for (let k = 1; k < known.length; k++) { acc += offDiff(known[k], known[k - 1]); maxAbs = Math.max(maxAbs, Math.abs(acc)); } driftCents = maxAbs; }

  const counts = { note: 0, bend: 0, edge: 0, unstable: 0 };
  for (const [l] of voiced) counts[l]++;
  return {
    voicedSec: r3(voiced.length * hop),
    controlledShare: r3(controlled(voiced)),
    unstableSec: r3(counts.unstable * hop),
    labels: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, r3(v * hop)])),
    windows: windows.map((w) => ({ t0: r3(w.t0), t1: r3(w.t1), controlled: r3(w.controlled) })),
    windowP25: r3(q(windows.map((w) => w.controlled), 0.25)),
    weakWindowShare: r3(windows.filter((w) => w.controlled < (P.weakWindow ?? 0.5)).length / Math.max(1, windows.length)),
    tuning: { localOffsets, driftCents: r3(driftCents) },
  };
}

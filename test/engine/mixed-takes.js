// Synthetic takes of mixed and consistent quality, for the whole-performance
// singing assessment (see tools/performance-profile.mjs). Each is a pitch
// curve in cents from A4 (null = silence), sung through synth.js. About 10 s.
// They stand in for real recordings only until labelled takes exist.
import { sing, rng } from './synth.js';

// Phrase helper: notes [{ c, sec }] (c = cents, null = rest) joined by
// glides of glideSec, with vibrato of ±vib cents at 5.5 Hz on held notes.
function phrase(notes, { glideSec = 0.07, vib = 25, offset = 0, driftPerSec = 0, t0 = 0 } = {}) {
  const segs = [];
  let t = t0;
  for (const n of notes) { segs.push({ ...n, t0: t, t1: t + n.sec }); t += n.sec; }
  const at = (time) => {
    const k = segs.findIndex((s) => time >= s.t0 && time < s.t1);
    if (k < 0) return undefined;
    const s = segs[k], u = time - s.t0;
    if (s.c == null) return null;
    let c = s.c;
    const prev = segs[k - 1];
    if (prev?.c != null && u < glideSec) c = prev.c + (s.c - prev.c) * (u / glideSec);
    else if (u > 0.15) c += vib * Math.sin(2 * Math.PI * 5.5 * u);
    return c + offset + driftPerSec * time;
  };
  return { at, end: t };
}

// Concatenate curve pieces in time.
function chain(...pieces) {
  return (time) => { for (const p of pieces) { const v = p.at(time); if (v !== undefined) return v; } return null; };
}

const SCALE = [0, 200, 400, 500, 700, 900, 1100, 1200].map((c) => c - 900);
const melody = (seed, n, sec = [0.45, 0.8], restEvery = 5) => {
  const r = rng(seed), out = [];
  let i = 3;
  for (let k = 0; k < n; k++) {
    i = Math.max(0, Math.min(SCALE.length - 1, i + Math.round((r() - 0.5) * 3)));
    out.push({ c: SCALE[i], sec: sec[0] + r() * (sec[1] - sec[0]) });
    if (restEvery && (k + 1) % restEvery === 0) out.push({ c: null, sec: 0.3 + r() * 0.2 }); // a breath
  }
  return out;
};

// Unstructured, wandering vocalisation: pitch keeps moving slowly with no
// settled notes (what "improvised poorly" sounds like to the analysis).
const wander = (t0, t1, seed = 3) => {
  const r = rng(seed), a = 150 + r() * 100, f1 = 0.6 + r() * 0.5, f2 = 1.9 + r() * 0.8;
  return { at: (time) => (time >= t0 && time < t1 ? -500 + a * Math.sin(2 * Math.PI * f1 * time) + 80 * Math.sin(2 * Math.PI * f2 * time + 1) : undefined), end: t1 };
};

const take = (fn, sec = 10) => sing(fn, sec);

export const mixedTakes = {
  // Consistently strong: a scale melody, clean glides, vibrato, breaths.
  strong: () => { const p = phrase(melody(1, 14)); return take(chain(p), p.end); },
  // The real case's shape: weak improvisation, then the good lyrics part.
  weakThenGood: () => { const w = wander(0, 5); const p = phrase(melody(2, 7), { t0: 5 }); return take(chain(w, p), p.end); },
  // Good singing that falls apart in the second half.
  goodThenUnstable: () => { const p = phrase(melody(4, 7)); const w = wander(p.end, p.end + 5, 8); return take(chain(p, w), w.end); },
  // Legitimate improvisation: an unfamiliar, chromatic melody with wide
  // leaps, expressive slow bends between notes and wide vibrato, all settled.
  improvised: () => {
    const r = rng(6), notes = [];
    for (let k = 0; k < 13; k++) { notes.push({ c: -900 + Math.floor(r() * 18) * 100, sec: 0.5 + r() * 0.5 }); if (k % 4 === 3) notes.push({ c: null, sec: 0.35 }); }
    const p = phrase(notes, { glideSec: 0.22, vib: 45 }); return take(chain(p), p.end);
  },
  // Strong singing transposed off concert pitch by 45 cents throughout.
  transposed: () => { const p = phrase(melody(1, 14), { offset: 45 }); return take(chain(p), p.end); },
  // Steady notes whose tuning sinks 20 cents per second (150+ cents flat by the end).
  sinking: () => { const p = phrase(melody(1, 14), { driftPerSec: -20 }); return take(chain(p), p.end); },
  // Strong with many breaths and pauses (natural phrasing, not instability).
  breathy: () => { const p = phrase(melody(9, 12, [0.45, 0.8], 2)); return take(chain(p), p.end); },
};

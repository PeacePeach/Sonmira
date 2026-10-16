// Synthetic voices for engine tests. Deterministic (seeded noise).
export const SR = 16000;

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// A voice-like tone: fundamental plus a few harmonics, optional vibrato.
// notes: [{ hz, sec, amp = 0.25 }] with hz = 0 meaning silence.
export function voice(notes, { sr = SR, vibratoHz = 5, vibratoSt = 0.3, noise = 0.003, seed = 1 } = {}) {
  const total = Math.round(notes.reduce((a, n) => a + n.sec, 0) * sr);
  const out = new Float32Array(total);
  const r = rng(seed);
  let i = 0, phase = 0;
  for (const n of notes) {
    const len = Math.round(n.sec * sr), amp = n.amp ?? 0.25;
    for (let k = 0; k < len; k++, i++) {
      const env = Math.min(1, k / (0.03 * sr), (len - k) / (0.03 * sr));
      let s = 0;
      if (n.hz > 0) {
        const hz = n.hz * 2 ** ((vibratoSt * Math.sin((2 * Math.PI * vibratoHz * i) / sr)) / 12);
        phase += (2 * Math.PI * hz) / sr;
        s = amp * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase)) / 1.75;
      }
      out[i] = s + (r() - 0.5) * 2 * noise;
    }
  }
  return out;
}

export const silence = (sec) => ({ hz: 0, sec });

export function noiseBursts(sec, { sr = SR, seed = 3 } = {}) {
  const out = new Float32Array(Math.round(sec * sr));
  const r = rng(seed);
  for (let i = 0; i < out.length; i++) {
    const on = Math.floor(i / (0.25 * sr)) % 3 === 0;
    out[i] = on ? (r() - 0.5) * 0.6 : (r() - 0.5) * 0.004;
  }
  return out;
}

// Scenarios used across tests.
export const scenes = {
  // One sustained, connected phrase: a slow stepwise melody.
  steadyPhrase: () => voice([196, 220, 247, 220, 196, 175, 196, 220].map((hz) => ({ hz, sec: 0.8 }))),
  // Same register, broken by long gaps.
  brokenPhrase: () => voice([{ hz: 220, sec: 0.7 }, silence(0.9), { hz: 247, sec: 0.5 }, silence(1.1),
    { hz: 196, sec: 0.6 }, silence(0.8), { hz: 262, sec: 0.5 }, silence(1.0), { hz: 220, sec: 0.6 }]),
  // Pitch leaping widely every 120 ms.
  leaping: () => { const r = rng(9); return voice(Array.from({ length: 50 }, () => ({ hz: 110 * 2 ** (r() * 3), sec: 0.12 }))); },
  silence: () => voice([silence(5)]),
  noise: () => noiseBursts(5),
};

// A voice whose pitch follows centsAt(t) (cents relative to A440; null =
// silence). Used to synthesise singing of known quality for the singing
// analysis: the curve, not a note list, is what the analysis measures.
export function sing(centsAt, sec, { sr = SR, amp = 0.25, ampAt = null, noise = 0.003, seed = 1 } = {}) {
  const out = new Float32Array(Math.round(sec * sr));
  const r = rng(seed);
  let phase = 0, env = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr, c = centsAt(t);
    env += ((c == null ? 0 : 1) - env) * (1 / (0.015 * sr)); // ~15 ms attack/release
    if (c != null) phase += (2 * Math.PI * 440 * 2 ** (c / 1200)) / sr;
    const a = amp * env * (ampAt ? ampAt(t) : 1);
    out[i] = a * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase)) / 1.75 + (r() - 0.5) * 2 * noise;
  }
  return out;
}

// Melody as semitone steps from A3 (−1200 cents); each note { st, sec }, st = null rest.
function melodyCurve(notes, { detune = () => 0, drift = 0, wobble = null, vibrato = null, glideSec = 0.06, overshoot = 0 } = {}) {
  const segs = [];
  let t = 0;
  notes.forEach((n, i) => { segs.push({ ...n, t0: t, t1: t + n.sec, off: n.st == null ? 0 : detune(i) }); t += n.sec; });
  return {
    sec: t,
    at(time) {
      const k = segs.findIndex((s) => time < s.t1);
      const s = segs[k < 0 ? segs.length - 1 : k];
      if (s.st == null) return null;
      const target = -1200 + 100 * s.st + s.off, u = time - s.t0;
      let c = target;
      const prev = segs[k - 1];
      if (prev && prev.st != null && u < glideSec) {
        const from = -1200 + 100 * prev.st + prev.off, x = u / glideSec;
        c = from + (target - from) * x + overshoot * Math.sign(target - from) * Math.sin(Math.PI * x);
      } else if (prev && prev.st != null && overshoot && u < glideSec + 0.12) {
        c = target + overshoot * 0.6 * Math.sign(target - (-1200 + 100 * prev.st + prev.off)) * Math.cos(Math.PI * (u - glideSec) / 0.24);
      }
      c += drift * (u - s.sec / 2);
      if (wobble) c += wobble(time);
      if (vibrato && u > vibrato.delay) c += vibrato.cents * Math.sin(2 * Math.PI * vibrato.hz * u);
      return c;
    },
  };
}

const TUNE = [0, 2, 4, 5, 4, 2, 0, null, 4, 5, 7, 9, 7, 5, 4, null, 2, 4, 2, 0];
const tune = (sec = 0.55) => TUNE.map((st) => ({ st, sec: st == null ? 0.35 : sec }));

export const singers = {
  // In tune with itself, held notes steady, regular ~5.5 Hz vibrato, clean arrivals.
  strong: () => { const m = melodyCurve(tune(), { vibrato: { hz: 5.5, cents: 30, delay: 0.18 } }); return sing(m.at, m.sec); },
  // Same tune, notes ±40 cents off, sagging inside notes, slow irregular wobble, overshooting arrivals.
  weak: () => {
    const r = rng(5), off = TUNE.map(() => (r() - 0.5) * 80);
    const m = melodyCurve(tune(), { detune: (i) => off[i], drift: -110, overshoot: 90,
      wobble: (t) => 22 * Math.sin(2 * Math.PI * 1.3 * t) + 14 * Math.sin(2 * Math.PI * 2.1 * t + 1) });
    return sing(m.at, m.sec, { ampAt: (t) => 0.6 + 0.4 * Math.abs(Math.sin(2 * Math.PI * 0.9 * t)) });
  },
  // A smooth hum: one or two very stable long notes, no words.
  hum: () => { const m = melodyCurve([{ st: 3, sec: 2.6 }, { st: 5, sec: 2.6 }], {}); return sing(m.at, m.sec); },
  // Speech-like: short syllables with continuously falling/rising pitch and gaps.
  speech: () => {
    const r = rng(11), syl = [];
    let t = 0;
    for (let i = 0; i < 22; i++) { const d = 0.12 + r() * 0.12; syl.push({ t0: t, t1: t + d, c0: -1500 + r() * 400, slope: (r() < 0.7 ? -1 : 1) * (800 + r() * 900) }); t += d + (r() < 0.3 ? 0.18 : 0.04); }
    return sing((time) => { const s = syl.find((x) => time >= x.t0 && time < x.t1); return s ? s.c0 + s.slope * (time - s.t0) : null; }, t);
  },
};

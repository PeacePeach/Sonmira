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

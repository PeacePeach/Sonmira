// Mock engine — the app's default until Track B's real engine lands.
//
// Deliberately small and self-contained: crude loudness + pitch estimates,
// a three-signal completeness rule, keyword heuristics for emotion / motif,
// and a pick from the bundled watercolor set. None of these numbers are
// singing-quality measures; they only steer which stand-in painting appears.

import { CONTRACT_VERSION } from '../contract.js';
import { CATALOG } from './mock-catalog.js';

const FRAME_SEC = 0.1;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const organic = (r) => { const v = () => Math.round(36 + r() * 28) + '%'; return `${v()} ${v()} ${v()} ${v()} / ${v()} ${v()} ${v()} ${v()}`; };

// Same pitch→hue curve as the design prototype: low → blue/violet, high → warm.
export const pitchToHue = (hz) => 255 - clamp((Math.log2(Math.max(1, hz)) - Math.log2(110)) / 3) * 235;

function rms(buf) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }

// Coarse normalised autocorrelation on every other sample, 80–1100 Hz.
function roughPitch(buf, sampleRate) {
  const step = 2, sr = sampleRate / step, n = buf.length >> 1;
  const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = buf[i * step];
  const minLag = Math.floor(sr / 1100), maxLag = Math.min(Math.ceil(sr / 80), n >> 1);
  let best = 0, bestLag = 0; const W = n - maxLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < W; i++) { const a = x[i], b = x[i + lag]; ac += a * b; e1 += a * a; e2 += b * b; }
    const v = (2 * ac) / (e1 + e2 + 1e-12);
    if (v > best * 1.08 || (v > best && lag < bestLag * 1.5)) { best = v; bestLag = lag; }
  }
  return best > 0.6 && bestLag ? sr / bestLag : null;
}

function createLiveSession({ sampleRate }) {
  const r = rng((Math.random() * 1e9) | 0);
  const frames = [], wash = [];
  let hue = 240, t = 0;
  const walk = { x: 30 + r() * 40, y: 35 + r() * 30 };
  return {
    push(samples) {
      t++;
      const level = clamp(rms(samples) * 7);
      const hz = level > 0.06 ? roughPitch(samples, sampleRate) : null;
      if (hz) hue = hue * 0.8 + pitchToHue(hz) * 0.2;
      frames.push({ level, hz });
      let stroke = null;
      if (t === 3) stroke = { x: 50, y: 50, w: 115, h: 115, hue, l: 0.93, c: 0.025, a: 0.75, rot: 0, br: '50%' };
      else if (t % 4 === 0 && level > 0.12) {
        walk.x = clamp(walk.x + (r() - 0.5) * 26, 10, 90); walk.y = clamp(walk.y + (r() - 0.5) * 24, 12, 88);
        const w = 22 + level * 42;
        stroke = { x: walk.x, y: walk.y, w, h: w * (0.6 + r() * 0.5), hue: hue + (r() - 0.5) * 20, l: 0.84 - level * 0.2, c: 0.06 + level * 0.09, a: 0.28 + level * 0.3, rot: r() * 360, br: organic(r) };
      }
      if (stroke) wash.push(stroke);
      return { level, hue, stroke };
    },
    finish() {
      const durationSec = frames.length * FRAME_SEC;
      const levels = frames.map((f) => f.level);
      const voiced = frames.filter((f) => f.hz);
      const semis = voiced.map((f) => 12 * Math.log2(f.hz / 110));
      const m = mean(semis);
      const pitchSpread = Math.sqrt(mean(semis.map((s) => (s - m) ** 2)));
      let pauses = 0, quiet = 0, started = false;
      for (const f of frames) {
        if (f.level > 0.08) { if (started && quiet >= 3) pauses++; started = true; quiet = 0; } else quiet++;
      }
      const features = {
        meanLevel: mean(levels),
        voicedRatio: frames.length ? voiced.length / frames.length : 0,
        voicedSec: voiced.length * FRAME_SEC,
        medianHz: median(voiced.map((f) => f.hz)),
        pitchSpreadSemitones: pitchSpread,
        pauses,
        meanHue: hue,
      };
      const silent = features.meanLevel < 0.04 || (features.voicedRatio < 0.05 && Math.max(0, ...levels) < 0.12);
      return { durationSec, flags: { silent, tooShort: durationSec < 1.5 }, wash: wash.slice(), features };
    },
  };
}

// ── interpretation (heuristic stand-ins) ───────────────────────────────────

function completenessOf(a) {
  const f = a.features || {};
  if (a.flags.silent) return 'loose';
  const score = (f.voicedSec >= 3 ? 1 : f.voicedSec / 3)
    + clamp((f.meanLevel - 0.1) / 0.2)
    + (f.pitchSpreadSemitones < 4 ? 1 : f.pitchSpreadSemitones < 8 ? 0.5 : 0);
  return score >= 2.3 ? 'resolved' : score >= 1.4 ? 'gathered' : 'loose';
}

const EMOTION_WORDS = {
  tender: ['love', 'lullaby', 'soft', 'gentle', 'baby', 'mom', 'mother', 'home', 'warm', 'hug', 'quiet', 'sleep', '爱', '温柔', '妈', '家', '睡'],
  bright: ['happy', 'birthday', 'sun', 'joy', 'dance', 'morning', 'laugh', 'fun', 'car', 'summer', '开心', '生日', '阳光', '快乐'],
  melancholic: ['sad', 'miss', 'alone', 'rain', 'tired', 'goodbye', 'lost', 'grey', 'gray', 'cry', 'night', '难过', '想念', '雨', '孤独', '累'],
  intense: ['angry', 'loud', 'storm', 'fire', 'shout', 'wild', 'power', 'scream', 'rush', '生气', '风暴', '火', '激动'],
};
const MOTIF_WORDS = {
  water: ['rain', 'sea', 'ocean', 'river', 'lake', 'wave', 'shore', 'beach', 'swim', 'window', 'bath', '雨', '海', '河', '湖', '水'],
  sky: ['sky', 'cloud', 'sun', 'moon', 'star', 'bird', 'wind', 'dawn', 'sunset', 'night', '天', '云', '月', '星', '风'],
  garden: ['flower', 'garden', 'tree', 'leaf', 'rose', 'bloom', 'grass', 'spring', 'park', '花', '园', '树', '叶'],
  landscape: ['mountain', 'hill', 'road', 'walk', 'city', 'street', 'field', 'car', 'town', 'travel', 'home', 'café', 'cafe', '山', '路', '城', '街'],
};
function fromWords(note, table) {
  const s = (note || '').toLowerCase();
  if (!s.trim()) return null;
  let best = null, bestN = 0;
  for (const [label, words] of Object.entries(table)) {
    const n = words.filter((w) => s.includes(w)).length;
    if (n > bestN) { best = label; bestN = n; }
  }
  return best;
}

function emotionOf(a, note) {
  const w = fromWords(note, EMOTION_WORDS);
  if (w) return { label: w, source: 'note' };
  const f = a.features || {};
  if (a.flags.silent || !f.medianHz) return { label: 'tender', source: 'default' };
  const loud = f.meanLevel > 0.4, high = f.medianHz > 300, low = f.medianHz < 180;
  const label = loud && f.pitchSpreadSemitones > 7 ? 'intense' : loud || high ? 'bright' : low ? 'melancholic' : 'tender';
  return { label, source: 'voice' };
}

function motifOf(note) {
  const w = fromWords(note, MOTIF_WORDS);
  return w ? { label: w, source: 'note' } : { label: 'abstract', source: 'default' };
}

function pick(completeness, emotion, motif, hue, seed) {
  const r = rng(seed);
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d) / 180; };
  let best = null, bestS = -Infinity;
  for (const item of CATALOG.filter((c) => c.completeness === completeness)) {
    const s = (item.emotions.includes(emotion) ? 2 : 0)
      + (motif !== 'abstract' && item.motifs.includes(motif) ? 3 : 0)
      + (1 - hueDist(item.hue, hue)) + r() * 0.6;
    if (s > bestS) { bestS = s; best = item; }
  }
  return best;
}

const SUMMARY = { resolved: 'it became a place', gathered: 'a place in the mist', loose: 'colour, still moving' };
const DRYING = { resolved: 'Something is appearing…', gathered: 'A place is half-showing…', loose: 'Letting it dry…' };
const MOVEMENT = { resolved: 'steady', gathered: 'drifting', loose: 'wandering' };

function voiceLabel(a, completeness) {
  const f = a.features || {};
  const hz = f.medianHz || 0;
  const register = !hz ? 'Quiet' : hz < 196 ? 'Low' : hz < 397 ? 'Middle' : 'High';
  return `${register}, ${f.meanLevel > 0.5 ? 'bright' : 'soft'}, ${MOVEMENT[completeness]}`;
}

export function createMockEngine() {
  return {
    id: 'mock-v1',
    createLiveSession,
    async generate({ analysis, note = '', overrides = {} }) {
      const completeness = overrides.completeness || completenessOf(analysis);
      const emotion = emotionOf(analysis, note);
      const motif = motifOf(note);
      const hue = analysis.features?.meanHue ?? 240;
      const seed = Math.round(analysis.durationSec * 1000 + hue * 7 + (note || '').length * 131);
      const item = pick(completeness, emotion.label, motif.label, hue, seed);
      return {
        engineId: 'mock-v1',
        contractVersion: CONTRACT_VERSION,
        completeness, emotion, motif,
        artwork: item ? { kind: 'asset', src: item.src, focus: item.focus } : null,
        wash: analysis.wash,
        interpretation: {
          voiceLabel: voiceLabel(analysis, completeness),
          summary: `${emotion.label} — ${SUMMARY[completeness]}`,
          dryingLine: DRYING[completeness],
        },
      };
    },
  };
}

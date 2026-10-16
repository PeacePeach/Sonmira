// The pigment wash: soft OKLCH blobs laid down while the person sings, then
// tinted toward the painting's emotion when the take is finished.
// Stroke shape is defined in ../contract.js.

import { rng } from './rng.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const organic = (r) => { const v = () => Math.round(36 + r() * 28) + '%'; return `${v()} ${v()} ${v()} ${v()} / ${v()} ${v()} ${v()} ${v()}`; };

// Live builder, following the design prototype: a pale ground at the third
// frame, then every 400 ms a mark at a random-walk position whose size,
// strength and colour follow the voice.
export function createWashBuilder(seed) {
  const r = rng(seed);
  const walk = { x: 30 + r() * 40, y: 35 + r() * 30 };
  let t = 0;
  return function next(level, hue) {
    t++;
    if (t === 3) return { x: 50, y: 50, w: 115, h: 115, hue, l: 0.93, c: 0.025, a: 0.75, rot: 0, br: '50%' };
    if (t % 4 !== 0 || level <= 0.12) return null;
    walk.x = clamp(walk.x + (r() - 0.5) * 26, 10, 90);
    walk.y = clamp(walk.y + (r() - 0.5) * 24, 12, 88);
    const w = 22 + level * 42;
    return { x: walk.x, y: walk.y, w, h: w * (0.6 + r() * 0.5), hue: hue + (r() - 0.5) * 20,
      l: 0.84 - level * 0.2, c: 0.06 + level * 0.09, a: 0.28 + level * 0.3, rot: r() * 360, br: organic(r) };
  };
}

// Emotion → colour. Hue the wash leans toward, and how saturated it gets.
export const EMOTION_TINT = {
  tender: { hue: 350, chroma: 0.95 },      // rose, lilac
  bright: { hue: 80, chroma: 1.1 },        // warm yellow, sunlit
  melancholic: { hue: 250, chroma: 0.8 },  // grey-blue
  intense: { hue: 25, chroma: 1.25 },      // crimson
};

function mixHue(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

// Returns a new wash leaning `amount` of the way toward the emotion's hue.
export function tintWash(wash, emotion, amount = 0.3) {
  const tint = EMOTION_TINT[emotion];
  if (!tint) return wash.slice();
  return wash.map((s, i) => i === 0 && s.w > 100
    ? { ...s, hue: mixHue(s.hue, tint.hue, amount) }
    : { ...s, hue: Math.round(mixHue(s.hue, tint.hue, amount) * 10) / 10, c: Math.round(s.c * tint.chroma * 1000) / 1000 });
}

// A quiet ground for takes too short to leave any marks.
export function groundWash(emotion, seed = 1) {
  const r = rng(seed);
  const hue = EMOTION_TINT[emotion]?.hue ?? 240;
  const out = [{ x: 50, y: 50, w: 115, h: 115, hue, l: 0.93, c: 0.025, a: 0.75, rot: 0, br: '50%' }];
  for (let i = 0; i < 3; i++) {
    const w = 30 + r() * 30;
    out.push({ x: 25 + r() * 50, y: 25 + r() * 50, w, h: w * (0.6 + r() * 0.5), hue: hue + (r() - 0.5) * 30,
      l: 0.82, c: 0.05, a: 0.25, rot: r() * 360, br: organic(r) });
  }
  return out;
}

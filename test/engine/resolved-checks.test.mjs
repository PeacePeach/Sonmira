// The two Resolved corrections (18–19 Oct): intonation on held notes, and
// no missed landing. Validated on synthetic takes of known behaviour:
// fast but controlled singing, intentional slides and genuine missed
// landings, several seeds each.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SR, rng, sing } from './synth.js';
import { pitchTrack } from '../../src/engine/analysis/pitchtrack.js';
import { singingAnalysis, SINGING_CALIBRATION } from '../../src/engine/analysis/singing.js';
import { analyzeSamples } from '../../src/engine/analysis/features.js';

// A phrase plan: held notes and runs of short syllables, each note
// { st, sec, off (cents from its semitone), glide (s), over (cents past the
// target on the way in), ease (an eased, portamento-shaped glide), gap (s of
// silence before) }.
function take(plan, { vib = 30, vibHz = 5.5, seed = 1 } = {}) {
  const segs = [];
  let t = 0.3;
  for (const n of plan) { t += n.gap ?? 0; segs.push({ ...n, t0: t, t1: t + n.sec }); t += n.sec; }
  const at = (time) => {
    const k = segs.findIndex((s) => time >= s.t0 && time < s.t1);
    if (k < 0) return null;
    const s = segs[k], u = time - s.t0, target = -900 + 100 * s.st + (s.off ?? 0), prev = segs[k - 1];
    const g = s.glide ?? 0.04;
    let c = target;
    if (prev && prev.t1 >= s.t0 - 0.001 && u < g) {
      const from = -900 + 100 * prev.st + (prev.off ?? 0), x = u / g, dir = Math.sign(target - from);
      // Out past the target and back: a sine bump that peaks at the end of the glide.
      const shape = s.ease ? 0.5 - 0.5 * Math.cos(Math.PI * x) : x;
      c = from + (target - from) * shape + (s.over ?? 0) * dir * Math.sin((Math.PI / 2) * x);
    } else if (prev && s.over && u < g + 0.1) {
      const from = -900 + 100 * prev.st, dir = Math.sign(target - from);
      c = target + s.over * dir * Math.cos((Math.PI / 2) * (u - g) / 0.1);
    }
    const vibFrom = Math.max(0.15, (s.glide ?? 0.04) + 0.1);
    return c + (s.sec >= 0.4 && u > vibFrom ? vib * Math.sin(2 * Math.PI * vibHz * (u - vibFrom)) : 0);
  };
  return sing(at, t + 0.3, { seed });
}

// Lines alternating a held note with a run of short syllables, like a fast
// syllabic pop line; runOff(i, r) gives each run note's offset in cents.
function fastLine(seed, { runOff = () => 0, heldOff = () => 0 } = {}) {
  const r = rng(seed), plan = [];
  const steps = [0, 2, 4, 2, 0, -1, 0, 2, 4, 5, 4, 2];
  for (let line = 0; line < 4; line++) {
    plan.push({ st: steps[(line * 3) % 12], sec: 0.55 + r() * 0.3, off: heldOff(r), gap: line ? 0.4 : 0 });
    for (let i = 0; i < 5; i++) plan.push({ st: steps[(line * 3 + i + 1) % 12], sec: 0.15 + r() * 0.09, off: runOff(r), glide: 0.03, gap: r() < 0.4 ? 0.04 : 0 });
    plan.push({ st: steps[(line * 3 + 6) % 12], sec: 0.5 + r() * 0.3, off: heldOff(r) });
  }
  return take(plan, { seed });
}

const analyse = (x) => singingAnalysis(pitchTrack(x, SR), analyzeSamples(x, SR)).quality;
const check = (q, id) => q.strongChecks.find((c) => c.id === id);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

test('fast but controlled singing (in tune, short syllables) is Strong', () => {
  for (const seed of SEEDS) {
    const q = analyse(fastLine(seed, { runOff: (r) => (r() - 0.5) * 10, heldOff: (r) => (r() - 0.5) * 10 }));
    assert.ok(q.strong, `seed ${seed}: ${q.strongChecks.filter((c) => !c.ok).map((c) => `${c.id}=${c.value}`).join(', ')}`);
    assert.match(q.components.intonation.basis, /held notes/);
  }
});

test('fast run sung ~25 c off the held notes\' tuning (the well-sung take) no longer blocks Strong', () => {
  for (const seed of SEEDS) {
    const q = analyse(fastLine(seed, { runOff: (r) => 22 + r() * 8, heldOff: (r) => (r() - 0.5) * 10 }));
    assert.ok(check(q, 'intonation').ok, `seed ${seed}: intonation ${q.components.intonation.score}`);
  }
});

test('held notes out of tune still fail intonation', () => {
  for (const seed of SEEDS) {
    let k = 0; // every other held note 40–50 c sharp, so no single grid fits
    const q = analyse(fastLine(seed, { heldOff: (r) => (k++ % 2 ? 40 + r() * 10 : (r() - 0.5) * 6) }));
    assert.ok(!check(q, 'intonation').ok, `seed ${seed}: intonation ${q.components.intonation.score}`);
  }
});

test('with fewer than 4 held notes, intonation is judged on every note as before', () => {
  const plan = [{ st: 0, sec: 0.6 }, ...[2, 4, 5, 4, 2, 0, 2, 4].map((st) => ({ st, sec: 0.18, off: 30, glide: 0.03 })), { st: 0, sec: 0.6 }];
  const q = analyse(take(plan));
  assert.match(q.components.intonation.basis, /all notes/);
});

test('intentional slides (portamento across 3–10 semitones, landing on the note) are not missed landings', () => {
  // Slides of 0.1–0.3 s into notes of 0.6–0.9 s, and slow 0.25–0.5 s slides
  // into longer notes. (When a slide takes up most of a short note, the note
  // finder can miss that note, and the way past it then reads as a miss:
  // 3 of 12 seeds with 0.25–0.5 s slides into 0.6–0.9 s notes.)
  const SHAPES = [{ g: [0.1, 0.3], n: [0.6, 0.9] }, { g: [0.25, 0.5], n: [0.9, 1.2] }];
  for (const { g, n } of SHAPES) for (const seed of SEEDS) {
    const r = rng(seed), plan = [];
    for (let i = 0; i < 10; i++) plan.push({ st: [0, 5, 2, 7, -3, 4, 0, 9, 2, 5][i], sec: n[0] + r() * (n[1] - n[0]), glide: g[0] + r() * (g[1] - g[0]), ease: true });
    const c = check(analyse(take(plan, { seed })), 'no_missed_landing');
    assert.ok(c.ok, `slides ${g}, seed ${seed}: worst landing ${c.value} c`);
  }
});

test('a low note of the melody right before a note is not read as a missed landing', () => {
  // The well-sung and casual takes both drop ~5 semitones for one held note
  // and jump back up; the old approach window read that neighbour as a
  // 437 c overshoot on the following note.
  for (const seed of SEEDS) {
    const r = rng(seed), plan = [];
    for (const st of [0, 2, 0, -5, 2, 0, 2, -2, 0, 2]) plan.push({ st, sec: st === -5 ? 0.35 : 0.2 + r() * 0.3, glide: 0.04 });
    const c = check(analyse(take(plan, { seed })), 'no_missed_landing');
    assert.ok(c.ok, `seed ${seed}: worst landing ${c.value} c`);
  }
});

test('expressive overshoots (up to ~100 c past the note) are not missed landings', () => {
  for (const seed of SEEDS) {
    const r = rng(seed), plan = [];
    for (let i = 0; i < 10; i++) plan.push({ st: [0, 4, 2, 7, 4, 9, 5, 2, 4, 0][i], sec: 0.6 + r() * 0.3, glide: 0.08, over: 40 + r() * 60 });
    const c = check(analyse(take(plan, { seed })), 'no_missed_landing');
    assert.ok(c.ok, `seed ${seed}: worst landing ${c.value} c`);
  }
});

test('a genuine missed landing (one approach 350–500 c past the note, then corrected) blocks Strong, and only that', () => {
  for (const seed of SEEDS) {
    const r = rng(seed), plan = [];
    for (let i = 0; i < 10; i++) plan.push({ st: [0, 2, 4, 2, 0, 4, 5, 7, 5, 4][i], sec: 0.6 + r() * 0.3, glide: 0.06 });
    plan[5] = { ...plan[5], glide: 0.12, over: 350 + r() * 150 };
    const q = analyse(take(plan, { seed }));
    const c = check(q, 'no_missed_landing');
    assert.ok(!c.ok, `seed ${seed}: worst landing ${c.value} c`);
    assert.ok(!q.strong);
    assert.deepEqual(q.strongChecks.filter((x) => !x.ok).map((x) => x.id), ['no_missed_landing'], `seed ${seed}`);
  }
});

test('the same take without the miss is Strong', () => {
  for (const seed of SEEDS) {
    const r = rng(seed), plan = [];
    for (let i = 0; i < 10; i++) plan.push({ st: [0, 2, 4, 2, 0, 4, 5, 7, 5, 4][i], sec: 0.6 + r() * 0.3, glide: 0.06 });
    const q = analyse(take(plan, { seed }));
    assert.ok(q.strong, `seed ${seed}: ${q.strongChecks.filter((c) => !c.ok).map((c) => `${c.id}=${c.value}`).join(', ')}`);
  }
});

test('calibration: held-note bar and missed-landing limit', () => {
  assert.equal(SINGING_CALIBRATION.intonation.minNoteSec, 0.25);
  assert.equal(SINGING_CALIBRATION.strongPerformance.missedLandingCents, 300);
  assert.equal(SINGING_CALIBRATION.strong.intonation, 0.8); // unchanged
});

// The performance evidence only says what the recording shows (Han, 19 Oct).
//   1. One arrival-overshoot measure for the transitions score and the art
//      direction: a neighbouring note before the arrival, or a voice break
//      into creak on the way, is not an overshoot (the old 0.25 s window read
//      the casual take's low note as a 461 c "missed landing"), while real
//      expressive overshoots still count.
//   2. A fast legato figure whose notes are too brief for the note finder is
//      a run: painted as the stepping movement it is, never torn and never as
//      a missed landing. Swinging, hunting and wide vibrato stay unsteady.
//   3. The pitch line cannot tell a legato figure from a voice searching in
//      steps, so the run / unsteady reading only chooses words: the passages,
//      shares and indices are the same either way, a run or a stretch moving
//      between brief pitches is never painted as controlled, and only a
//      stretch where the voice held no pitch is painted torn (step 15).
//   4. An overshoot is described as movement past the note, never as a
//      missed landing.
//   5. A slide longer than the singing analysis's bend limit is painted as
//      one continuous gesture, not torn (step 16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SR, rng, sing, singers } from './synth.js';
import { pitchTrack } from '../../src/engine/analysis/pitchtrack.js';
import { singingAnalysis, findNotes, arrivalOvershoot, SINGING_CALIBRATION } from '../../src/engine/analysis/singing.js';
import { measurePerformance, pathShape, RUN } from '../../src/engine/analysis/performance-measure.js';
import { performanceDirection } from '../../src/engine/direct/performance.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
// A line of held notes (cents from A440 via semitones st; 30 c / 5.5 Hz
// vibrato) where note k may be led into by `lead(u, from, to)` over `leadSec`.
function line(sts, { seed = 1, held = [0.6, 0.9], at = -1, leadSec = 0, lead = null, vib = () => ({ c: 30, hz: 5.5 }) } = {}) {
  const r = rng(seed), segs = []; let t = 0.3;
  sts.forEach((st, k) => { const l = k === at ? leadSec : 0.06, sec = held[0] + r() * (held[1] - held[0]); segs.push({ c: -900 + 100 * st, t0: t, l, t1: t + l + sec, v: vib(r) }); t += l + sec; });
  const curve = (time) => {
    const k = segs.findIndex((s) => time >= s.t0 && time < s.t1);
    if (k < 0) return null;
    const s = segs[k], u = time - s.t0, from = k ? segs[k - 1].c : s.c;
    if (u < s.l && k) return k === at && lead ? lead(u, from, s.c) : from + (s.c - from) * (u / s.l);
    const v = u - s.l;
    return s.c + (v > 0.15 ? s.v.c * Math.sin(2 * Math.PI * s.v.hz * (v - 0.15)) : 0);
  };
  return sing(curve, t + 0.3, { seed });
}
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
// Legato figure: k scale notes of `dur` s each, 40 ms eased glides between.
const figure = (notes, dur) => (u, from, to) => {
  const all = [...notes, to], j = Math.min(all.length - 1, Math.floor(u / dur)), v = u - j * dur, prev = j ? all[j - 1] : from;
  return prev + (all[j] - prev) * ease(v / 0.04);
};
const words = (m) => performanceDirection(m).decisions.map((d) => d.decision).join(' ');
const FAULT = /missed landing|backrun|torn|lost (control|hold)|scrubbed|Fragmentation is local|uncontrolled|out of control/i;
// Claims of control a stretch that did not settle cannot support.
const CONTROL = /Edges are soft and planned|Water is controlled\.|No fragmented areas|blooms are planned/;

test('arrival overshoot: a low neighbouring note just before the arrival is not an overshoot', () => {
  for (const seed of SEEDS) {
    const plan = [0, 2, 0, -5, 2, 0, 2, -2, 0, 2];
    const x = line(plan, { seed, held: [0.2, 0.5] });
    const tr = pitchTrack(x, SR), { notes } = findNotes(tr, SINGING_CALIBRATION);
    for (let i = 1; i < notes.length; i++) if (notes[i - 1].run === notes[i].run && Math.abs(notes[i].center - notes[i - 1].center) >= 60) {
      const o = arrivalOvershoot(tr, notes[i - 1], notes[i]);
      assert.ok(o <= SINGING_CALIBRATION.transitions.overshoot, `seed ${seed} at ${notes[i].start}: ${Math.round(o)} c`);
    }
  }
});

test('arrival overshoot: expressive overshoots of 40–100 c are still counted', () => {
  // Each arrival glides 80 ms out past its note and comes back over 100 ms.
  for (const seed of SEEDS) {
    const r = rng(seed), segs = []; let t = 0.3;
    for (const st of [0, 4, 2, 7, 4, 9, 5, 2, 4, 0]) { const sec = 0.6 + r() * 0.3; segs.push({ c: -900 + 100 * st, t0: t, t1: t + sec, over: 40 + r() * 60 }); t += sec; }
    const x = sing((time) => {
      const k = segs.findIndex((s) => time >= s.t0 && time < s.t1);
      if (k < 0) return null;
      const s = segs[k], u = time - s.t0, from = k ? segs[k - 1].c : s.c, dir = Math.sign(s.c - from);
      if (k && u < 0.08) return from + (s.c - from) * (u / 0.08) + s.over * dir * Math.sin((Math.PI / 2) * (u / 0.08));
      if (k && u < 0.18) return s.c + s.over * dir * Math.cos((Math.PI / 2) * ((u - 0.08) / 0.1));
      return s.c + (u > 0.18 ? 30 * Math.sin(2 * Math.PI * 5.5 * (u - 0.18)) : 0);
    }, t + 0.3, { seed });
    const T = singingAnalysis(pitchTrack(x, SR)).quality.components.transitions;
    assert.ok(T.meanOvershootCents >= 25 && T.score < 1, `seed ${seed}: mean ${T.meanOvershootCents} c, score ${T.score}`);
  }
});

test('arrival overshoot: a voice break into creak on the way down is not an overshoot', () => {
  // Between two notes the voice drops an octave for 30–50 ms (a creak or a
  // tracker octave error) before landing: a break, counted as such elsewhere.
  for (const seed of SEEDS) {
    const r = rng(seed), blip = 0.03 + r() * 0.02;
    const x = line([0, 4, 2, 7, 2, 4, 0, 2], { seed, at: 4, leadSec: 0.12, lead: (u, from, to) => (u < 0.04 ? from + (to - from) * (u / 0.12) : u < 0.04 + blip ? to - 1200 : from + (to - from) * Math.min(1, u / 0.12)) });
    const tr = pitchTrack(x, SR), { notes } = findNotes(tr, SINGING_CALIBRATION);
    for (let i = 1; i < notes.length; i++) if (notes[i - 1].run === notes[i].run && Math.abs(notes[i].center - notes[i - 1].center) >= 60) {
      const o = arrivalOvershoot(tr, notes[i - 1], notes[i]);
      assert.ok(o <= SINGING_CALIBRATION.transitions.overshoot, `seed ${seed} at ${notes[i].start}: ${Math.round(o)} c`);
    }
  }
});

test('arrival overshoot: the synthetic weak singer\'s overshooting arrivals still count', () => {
  const q = singingAnalysis(pitchTrack(singers.weak(), SR)).quality;
  assert.ok(q.components.transitions.score < 0.8, `score ${q.components.transitions.score}`);
  assert.ok(q.components.transitions.meanOvershootCents > 15, `mean ${q.components.transitions.meanOvershootCents} c`);
  const m = measurePerformance(singers.weak(), SR);
  assert.ok(m.global.meanOvershootCents > 15);
});

test('a fast legato figure too brief for the note finder is a run, not a fault (the casual take)', () => {
  for (const seed of SEEDS) {
    const r = rng(seed);
    // Up a step and a third, back, down: 5 notes of 90–120 ms, sung legato,
    // into a low held note. (From about 120 ms a note the finder sees some of
    // the figure's notes, and what is left between them is too short to tell.)
    const dur = 0.09 + r() * 0.03, base = -900, fig = [base + 100, base + 400, base + 200, base + 100, base - 100];
    const x = line([2, 0, 2, 0, -5, 0, 2, 0], { seed, at: 4, leadSec: fig.length * dur, lead: figure(fig, dur) });
    const m = measurePerformance(x, SR);
    const runs = m.episodes.filter((e) => e.kind === 'run');
    assert.equal(runs.length, 1, `seed ${seed}: ${JSON.stringify(m.episodes)}`);
    assert.ok(runs[0].stops >= RUN.minStops && runs[0].passed >= RUN.minPassed);
    const w = words(m);
    assert.match(w, /steps through \d brief pitches without settling on any/);
    assert.doesNotMatch(w, FAULT, `seed ${seed}`);
    assert.doesNotMatch(w, CONTROL, `seed ${seed}`);
  }
});

test('fast swinging and wide slow vibrato are never read as runs; slow hunting rarely', () => {
  // Slow hunting can stop on pitches and pass through them like a run: the
  // pitch line alone cannot tell the two apart (step 14 benchmark: 1 of 18
  // swinging or hunting episodes, 8 of 26 that hunt in steps or slide in
  // stages). A run is therefore only described as movement, never as control.
  let slow = 0;
  for (const seed of [...SEEDS, 9, 10, 11, 12]) {
    const r = rng(seed * 31);
    const a = 100 + r() * 200, f = 2 + r() * 3, p = r() * 6.28, L = 0.5 + r() * 0.4;
    const hunt = line([0, 4, 2, 7, 0, 4, 2, 0], { seed, at: 4, leadSec: L, lead: (u, from, to) => to + (from - to) * (1 - u / L) ** 2 + a * (1 - u / L) * Math.sin(2 * Math.PI * f * u + p) });
    const parts = Array.from({ length: 3 }, () => ({ a: (80 + r() * 170) * (r() < 0.5 ? -1 : 1), f: 1.5 + r() * 2.5, p: r() * 6.28 }));
    const wander = line([0, 4, 2, 7, 0, 4, 2, 0], { seed, at: 4, leadSec: L, lead: (u, from, to) => from + (to - from) * (u / L) + Math.sin(Math.PI * u / L) * parts.reduce((s, q) => s + q.a * Math.sin(2 * Math.PI * q.f * u + q.p), 0) / 1.6 });
    const sa = 150 + r() * 150, sf = 5 + r() * 2;
    const swing = line([0, 4, 2, 7, 0, 4, 2, 0], { seed, at: 4, leadSec: 0.7, lead: (u, from, to) => to + (from - to) * (1 - u / 0.7) ** 2 + sa * Math.sin(Math.PI * u / 0.7) * Math.sin(2 * Math.PI * sf * u) });
    const vib = line([0, 4, 2, 7, 0, 4, 2, 0], { seed, held: [1.1, 1.4], vib: (rr) => ({ c: 60 + rr() * 60, hz: 3 + rr() * 2 }) });
    const runs = (x) => measurePerformance(x, SR).episodes.filter((e) => e.kind === 'run').length;
    assert.equal(runs(swing), 0, `swing seed ${seed}`);
    assert.equal(runs(vib), 0, `vibrato seed ${seed}`);
    slow += runs(hunt) + runs(wander);
  }
  assert.ok(slow <= 2, `${slow} of 24 slow hunting or wandering lead-ins read as runs`);
});

test('a voice that swings without settling is still painted torn (unstable takes keep their instability)', () => {
  for (const seed of SEEDS) {
    const r = rng(seed * 7), a = 150 + r() * 150, f = 5 + r() * 2;
    const x = line([0, 4, 2, 7, 0, 4, 2, 0], { seed, at: 4, leadSec: 0.7, lead: (u, from, to) => to + (from - to) * (1 - u / 0.7) ** 2 + a * Math.sin(Math.PI * u / 0.7) * Math.sin(2 * Math.PI * f * u) });
    const m = measurePerformance(x, SR);
    assert.ok(m.episodes.some((e) => e.kind === 'unsteady' && e.sec >= 0.25), `seed ${seed}: ${JSON.stringify(m.episodes)}`);
    assert.match(words(m), /torn/, `seed ${seed}`);
  }
});

test('the run reading changes only words: passages, shares and indices are the same either way, with no control claimed', () => {
  // The step 14 benchmark's two errors: legato figures not read as runs, and
  // voices hunting in steps read as runs. Either way the painting may differ
  // only in the verb for the stretch.
  const takes = [];
  for (const seed of SEEDS) {
    const r = rng(seed), dur = 0.09 + r() * 0.06, base = -900, fig = [base + 100, base + 400, base + 200, base + 100, base - 100];
    takes.push(line([2, 0, 2, 0, -5, 0, 2, 0], { seed, at: 4, leadSec: fig.length * dur, lead: figure(fig, dur) }));
    const steps = [0, 1, 2, 3].map(() => base + 700 + Math.round((r() - 0.5) * 300)), L = 0.12 + r() * 0.05;
    takes.push(line([0, 4, 2, 7, 0, 4, 2, 0], { seed, at: 4, leadSec: steps.length * L, lead: figure(steps, L) }));
  }
  let both = 0;
  for (const x of takes) {
    const m = measurePerformance(x, SR), saved = RUN.minStops;
    RUN.minStops = 99;
    let off; try { off = measurePerformance(x, SR); } finally { RUN.minStops = saved; }
    const d = performanceDirection(m), o = performanceDirection(off);
    assert.deepEqual(d.indices, o.indices);
    assert.deepEqual(d.passages.map((p) => [p.t0, p.joinedBy, p.unstable, p.moving]), o.passages.map((p) => [p.t0, p.joinedBy, p.unstable, p.moving]));
    assert.deepEqual(d.decisions.map((x) => x.aspect), o.decisions.map((x) => x.aspect));
    if (m.episodes.some((e) => e.kind === 'run' && e.sec >= 0.25)) both++;
    if (m.episodes.some((e) => e.sec >= 0.25) && m.episodes.filter((e) => e.sec >= 0.25).every((e) => e.kind !== 'unsteady')) {
      assert.doesNotMatch(words(m), CONTROL); assert.doesNotMatch(words(m), FAULT);
    }
  }
  assert.ok(both > 0, 'some stretches are read as runs');
});

test('an overshoot of more than 150 c is movement past the note, not a missed landing', () => {
  const m = measurePerformance(singers.weak(), SR);
  m.passages[0].overshootCents = 220;
  const w = words(m);
  assert.match(w, /carries well past its mark before it turns back and settles/);
  assert.doesNotMatch(w, /missed|misses|backrun|failure|mistake/i);
});

test('a slide longer than 0.6 s is one continuous gesture, not torn; a swing or a plunge it comes back from is not a slide', () => {
  // The singing analysis counts a slide longer than bendMaxSec as unstable.
  // The pitch line cannot tell a deliberate slide from drifting, so it is
  // painted as neutral continuous movement (step 16); a stretch that
  // plunges past where it ends and comes back is not one-way travel.
  let slides = 0;
  for (const seed of SEEDS) {
    const r = rng(seed * 13), L = 0.65 + r() * 0.25, st = 3 + Math.round(r() * 9), down = r() < 0.5;
    const sts = [0, 4, 2, down ? st : 0, down ? 0 : st, 4, 2, 0];
    const slide = line(sts, { seed, at: 4, leadSec: L, lead: (u, from, to) => from + (to - from) * ease(u / L) });
    const m = measurePerformance(slide, SR);
    const eps = m.episodes.filter((e) => e.sec >= 0.25);
    assert.ok(eps.every((e) => e.kind !== 'unsteady'), `seed ${seed}: ${JSON.stringify(m.episodes)}`);
    slides += eps.filter((e) => e.kind === 'slide').length;
    const w = words(m);
    assert.doesNotMatch(w, FAULT, `seed ${seed}`);
    if (eps.length) { assert.match(w, /without settling/, `seed ${seed}`); assert.doesNotMatch(w, CONTROL, `seed ${seed}`); }

  }
  assert.ok(slides >= SEEDS.length / 2, `${slides} slides`);
  // The shape test on the pitch line itself (10 ms frames): one-way travel,
  // with or without vibrato on it, is a slide; a swing, or a plunge past the
  // end that comes back (the chaotic take at 6.88 s), is not.
  const P = SINGING_CALIBRATION.performance, n = 70;
  const frames = (f) => Array.from({ length: n + 2 }, (_, i) => ({ t: i * 0.01, cents: f(Math.min(1, Math.max(0, (i - 1) / (n - 1))), i * 0.01) }));
  const isSlide = (f) => { const x = pathShape(frames(f), 1, n + 1, 0.01, SINGING_CALIBRATION.smoothSec); return x.directness >= P.bendDirectness && Math.max(x.beyond, x.back) <= P.bendMarginCents; };
  assert.ok(isSlide((u) => -900 + 700 * ease(u)), 'eased slide');
  assert.ok(isSlide((u, t) => -900 + 700 * u + 40 * Math.sin(2 * Math.PI * 5.5 * t)), 'slide with vibrato');
  assert.ok(!isSlide((u, t) => -900 + 300 * u + 200 * Math.sin(Math.PI * u) * Math.sin(2 * Math.PI * 6 * t)), 'swing');
  assert.ok(!isSlide((u) => (u < 0.6 ? -600 - 750 * ease(u / 0.6) : -1350 + 250 * ease((u - 0.6) / 0.4))), 'plunge past the end and back');
});

test('every decision carries its evidence when torn and continuous stretches share a take', () => {
  const m = measurePerformance(singers.weak(), SR), t = m.passages[0].t0;
  m.episodes = [{ t0: t + 0.2, sec: 0.3, kind: 'unsteady', stops: 0, passed: 0 }, { t0: t + 0.8, sec: 0.3, kind: 'moving', stops: 2, passed: 1 }];
  const d = performanceDirection(m);
  assert.ok(d.decisions.some((x) => /Unsettled but continuous/.test(x.decision)) && d.decisions.some((x) => /Fragmentation is local/.test(x.decision)));
  for (const x of d.decisions) assert.ok(x.evidence.length > 0, `${x.aspect}: ${x.decision.slice(0, 60)}`);
});

test('run rule calibration', () => {
  assert.deepEqual(RUN, { stopSec: 0.06, stopCents: 30, passCents: 40, minStops: 3, minPassed: 2, movingStops: 2 });
});

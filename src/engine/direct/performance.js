// Performance → art direction, for every tier (Han, 18 Oct).
//
//   performanceDirection(summary) → { passages, focus, indices, decisions }
//   performanceSections(direction, tier) → prompt sections
//
// The summary is measured in the browser (analysis/performance-measure.js).
// Three sources, three jobs, never mixed:
//   words (concept)  → WHAT is painted: subject and meaning
//   performance      → HOW it is painted: structure, strokes, density,
//                      contrast, colour relations, fragmentation, tension
//   reference        → the technique and visual language only: medium, paint
//                      behaviour, kinds of marks, texture, palette family;
//                      never its composition or its imagery
// The performance sections are the same for every tier; the tier only decides
// how recognisable the subject is.
//
// Rules, not taste: each decision carries the measurements that made it and
// the anchor they were scaled against. Anchors come from the singing
// calibration (SINGING_CALIBRATION) where one exists, otherwise from a stated
// physical meaning. Time runs left to right across the sheet and pitch sets
// height: the one fixed convention, so the painting can be read against the
// recording. Deterministic: the same summary always gives the same direction.

export const PERFORMANCE_DIRECTION_VERSION = 1;

const clamp = (x) => Math.max(0, Math.min(1, x));
const ramp = (x, lo, hi) => (x == null || !isFinite(x) ? 0 : clamp((x - lo) / (hi - lo)));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r = (x, d = 2) => (x == null || !isFinite(x) ? null : +x.toFixed(d));
const pct = (x) => `${Math.round(x * 100)}%`;
const ev = (measure, value, unit, rule) => ({ measure, value, unit, rule });
const ids = (ps) => ps.map((p) => `${p.id} (${p.t0} s)`).join(', ');

// Anchors (lo → 0, hi → 1) and where they come from.
export const ANCHORS = {
  unstableShare: [0.05, 0.4, 'Strong bar: controlled share ≥ 0.6 (cal.strongPerformance), so 0.4 unstable is the edge of control'],
  intonationDev: [12, 28, 'cal.intonation devGood 12 c … devRandom 28 c (random pitches)'],
  tuningWander: [12, 28, 'spread of the singer\'s grid between windows, on the intonation scale: 12 c steady … 28 c as random'],
  overshoot: [25, 150, 'cal.transitions.overshoot 50 c is a clean arrival; 150 c is a missed note (1.5 semitones)'],
  timingIrregularity: [0.2, 0.8, 'coefficient of variation of note onsets: 0.2 near-metric … 0.8 close to random (1.0)'],
  pitchRange: [5, 20, 'semitones, p5–p95: a narrow tune … beyond an octave and a half'],
  levelRange: [6, 18, 'dB, p10–p95 of voiced level: even … strongly dynamic'],
  breath: [0.35, 1.5, 'seconds of silence between phrases: cal.performance.phraseGapSec … a long pause'],
  leap: [5, 12, 'semitones between consecutive notes: a fourth … an octave'],
  ornament: [10, 40, 'cents of residual movement inside settled notes (vibrato, ornaments): cal.stability jitterOk 12 … jitterBad 40'],
  voiceBreaks: [0, 6, 'octave-size jumps between consecutive 10 ms frames, plus drops into a quiet creak far below the melody'],
};
const scale = (key, x) => ramp(x, ANCHORS[key][0], ANCHORS[key][1]);
export const EPISODE_MIN = 0.25; // s: an unstable episode this long tears the paint
const ARTICULATION_LINE = 1.5;   // level dips per second: one per syllable at a moderate pace
const BREATHLESS_SEC = 8;        // one phrase sung this long without a breath

const where = (x0, x1) => { const c = (x0 + x1) / 2; return c < 0.34 ? 'left' : c < 0.66 ? 'centre' : 'right'; };
const heightWord = (y) => (y > 0.66 ? 'upper' : y < 0.34 ? 'lower' : 'middle');
function contourWord(p) {
  const d = p.pitch.end - p.pitch.start, peak = p.pitch.high - Math.max(p.pitch.start, p.pitch.end);
  if (peak > 3 && Math.abs(d) < 3) return 'arching';
  if (d > 1.5) return 'rising'; if (d < -1.5) return 'falling'; return 'level';
}

export function performanceDirection(s) {
  if (!s?.passages?.length) return null;
  const G = s.global ?? {};
  const pair = (xs) => (Array.isArray(xs) && xs.length === 2 && xs.every((x) => Number.isFinite(x)) ? xs : null);
  const [span0, span1] = pair(s.span) ?? [s.passages[0].t0, s.passages.at(-1).t1], span = Math.max(0.1, span1 - span0);
  const [lo, hi] = pair(s.pitchSpan) ?? [Math.min(...s.passages.map((p) => p.pitch.low)), Math.max(...s.passages.map((p) => p.pitch.high))];
  const yOf = (st) => clamp((st - lo) / Math.max(1, hi - lo));
  const passages = s.passages.map((p, i) => ({
    id: `P${i + 1}`, ...p, x0: r(clamp((p.t0 - span0) / span)), x1: r(clamp((p.t1 - span0) / span)), y: r(yOf(p.pitch.median)), contour: contourWord(p),
  }));
  // The focal passage: loudest relative to the take, with height as tie-break.
  const focus = [...passages].sort((a, b) => (b.level.mean + b.pitch.high / 4) - (a.level.mean + a.pitch.high / 4))[0];
  const breaks = (G.pitchBreaks ?? 0) + (G.drops ?? 0);
  const gaps = s.gapsSec ?? [];

  // ---- Scaled measures (0–1) ----------------------------------------------------
  const S = {
    instability: scale('unstableShare', 1 - (G.controlledShare ?? 1)),
    intonation: scale('intonationDev', G.intonationDevCents),
    wander: scale('tuningWander', G.tuningWanderCents),
    overshoot: scale('overshoot', G.meanOvershootCents ?? 0),
    timing: scale('timingIrregularity', G.ioiCv),
    range: scale('pitchRange', G.pitchRangeSt),
    dynamics: scale('levelRange', G.levelRangeDb),
    breath: gaps.length ? scale('breath', mean(gaps)) : 0,
    leaps: scale('leap', Math.max(0, ...passages.map((p) => Math.max(p.maxLeapSt ?? 0, Math.abs(p.entryLeapSt ?? 0))))),
    ornament: scale('ornament', G.ornamentCents),
    breaks: scale('voiceBreaks', breaks),
  };
  const breathless = s.phraseCount === 1 && (s.firstPhraseVoicedSec ?? 0) > BREATHLESS_SEC;
  const indices = {
    control: r(1 - mean([S.instability, S.overshoot, S.breaks])),
    tension: r(mean([S.intonation, S.wander, S.overshoot, S.leaps])),
    fragmentation: r(mean([S.instability, S.breaks, breathless ? 1 : 0, scale('unstableShare', Math.max(0, ...passages.map((p) => p.unstable ?? 0)))])),
    harmony: r(mean([S.intonation, S.wander])),
  };

  const D = [];
  const add = (aspect, decision, evidence) => D.push({ aspect, decision, evidence });

  // ---- Composition: structure from phrasing -------------------------------------
  const breathWord = S.breath > 0.5 ? 'wide' : S.breath > 0.2 ? 'medium' : 'narrow';
  add('composition', `Time reads left to right across the sheet, pitch sets height. ${gaps.length
    ? `${gaps.length + 1} masses separated by ${breathWord} bands of dry white paper, each band as wide as the breath it stands for (${gaps.map((g) => `${g} s`).join(', ')})`
    : `One unbroken mass with no white paper inside it: the voice ${breathless ? `never stopped for breath in ${s.firstPhraseVoicedSec} s` : 'sang it in one breath'}`}.`, [
    ev('phrases (silence > 0.35 s)', s.phraseCount, 'count', 'one mass per phrase'),
    ev('breath gaps', gaps.join(', ') || 'none', 's', `gap width ∝ gap length; ${ANCHORS.breath[2]}`),
  ]);
  const torn = passages.filter((p) => p.joinedBy === 'unstable'), turns = passages.filter((p) => p.joinedBy === 'leap');
  if (torn.length) add('composition', `Within the singing, ${ids(torn)} ${torn.length > 1 ? 'collide' : 'collides'} with the passage before it without paper between them, where the voice lost hold; at those joins the edges are hard, overlapping and torn.`, [
    ev(`unstable episodes ≥ ${EPISODE_MIN} s inside a phrase`, torn.map((p) => p.t0).join(', '), 's', 'an unstable episode starts a colliding passage'),
  ]);
  const steady = indices.control >= 0.6;
  const entry = (p) => Math.abs(p.entryLeapSt ?? p.maxLeapSt ?? 0);
  if (turns.length) add('composition', steady
    ? `${ids(turns)} ${turns.length > 1 ? 'turn' : 'turns'} sharply off the passage before it in one continuous movement, where the melody leaps; the join stays wet and soft.`
    : `${ids(turns)} ${turns.length > 1 ? 'jolt' : 'jolts'} away from the passage before it, where the voice jumps ${r(Math.max(...turns.map(entry)), 1)} st; the join is abrupt, with a hard dry edge.`, [
    ev('leaps that start a passage', turns.map((p) => `${p.t0} s: ${r(entry(p), 1)} st`).join(', '), 'st', 'a leap of ≥ 7 st inside a phrase starts a passage'),
    ev('control index', indices.control, '0–1', '≥ 0.6: a controlled leap is a change of direction; below: a jolt'),
  ]);
  add('composition', S.range > 0.6 ? `The masses spread over almost the full height of the sheet (pitch range ${G.pitchRangeSt} st): marks are flung from near the top edge to near the bottom.`
    : S.range > 0.25 ? `The masses travel through the middle two thirds of the sheet's height (pitch range ${G.pitchRangeSt} st).`
      : `The masses stay in a narrow horizontal band (pitch range ${G.pitchRangeSt} st).`, [ev('pitch range p5–p95, voice drops left out', G.pitchRangeSt, 'st', ANCHORS.pitchRange[2])]);
  add('composition', `Focal point: ${focus.id} (${focus.t0}–${focus.t1} s), the ${where(focus.x0, focus.x1)} ${heightWord(focus.y)} part of the sheet, the loudest passage; the strongest value contrast and the most saturated pigment are concentrated there and nowhere else. Never on the centre line.`, [
    ev(`${focus.id} mean level`, focus.level.mean, 'dB re loud voiced level', 'loudest passage = focal accent'), ev(`${focus.id} highest pitch`, focus.pitch.high, 'st', 'tie-break by height'),
  ]);

  // ---- Passage by passage ---------------------------------------------------------
  // One dip more or less over a passage is the resolution of its articulation
  // rate, so a rate within that of the line reads as mixed, not a flip.
  const tol = (p) => 1 / Math.max(0.5, p.t1 - p.t0);
  for (const p of passages) {
    const a = p.articulationPerSec ?? 0;
    const stroke = p.unstable >= 0.2 ? 'broken, scrubbed strokes that stop, restart and change direction; pigment lifted and re-laid'
      : p.bend >= 0.25 ? 'long slurred strokes that bend from one colour into the next without lifting the brush'
        : a >= ARTICULATION_LINE + tol(p) ? 'a row of short, separate touches, each set down on its own and allowed to dry apart'
          : a > ARTICULATION_LINE - tol(p) ? 'short touches mixed with fuller loaded strokes'
            : 'measured, fully loaded strokes, each placed once';
    const dir = { rising: 'climbing', falling: 'descending', arching: 'rising then falling back', level: 'travelling sideways' }[p.contour];
    const weight = p.level.mean > -4 ? 'heavy, saturated' : p.level.mean > -8 ? 'medium' : 'thin, pale';
    const fade = p.level.end - p.level.start <= -6 ? '; the pigment runs dry toward its right end, the last marks are dry-brush' : p.level.end - p.level.start >= 6 ? '; it gathers weight toward its right end' : '';
    const arrival = (p.overshootCents ?? 0) > ANCHORS.overshoot[1] ? `; one stroke overshoots its landing and is pulled back, leaving a backrun bloom (missed landing by ${r(p.overshootCents / 100, 1)} st)`
      : (p.overshootCents ?? 0) > 50 ? '; one landing overshoots slightly, with a small bloom where it stops' : '';
    const drop = p.drops ? `; ${p.drops > 1 ? `${p.drops} times` : 'once'} the line sinks into a pale, dragged mark far below it, where the voice gave way` : '';
    add(`passage ${p.id}`, `${p.id}, ${p.t0}–${p.t1} s, ${pct(p.x0)}–${pct(p.x1)} across, ${heightWord(p.y)} band, ${dir}: ${stroke}; ${weight} pigment${fade}${arrival}${drop}.`, [
      ev('pitch start → end', `${p.pitch.start} → ${p.pitch.end}`, 'st', 'direction of travel'),
      ev('unstable / bend share', `${p.unstable} / ${p.bend}`, 'share of voiced frames', 'unstable ≥ 0.2 → broken strokes; bend ≥ 0.25 → slurred'),
      ev('articulations', a, 'dips ≥ 8 dB per s', `≥ ${ARTICULATION_LINE} → separate touches; within ±${r(tol(p), 2)} (one dip over the passage) → mixed`),
      ev('mean level, start → end', `${p.level.mean} (${p.level.start} → ${p.level.end})`, 'dB', 'loudness → pigment load; a fade of ≥ 6 dB dries the stroke'),
      ...(p.overshootCents != null ? [ev('largest landing overshoot', p.overshootCents, 'c', '> 50 c bloom; > 150 c missed landing')] : []),
      ...(p.drops ? [ev('voice drops', p.drops, 'count', 'a quiet note ≥ 7 st below both neighbours, ≥ 12 dB below the loud level')] : []),
    ]);
  }

  // ---- Marks: rhythm and edges ----------------------------------------------------------
  add('rhythm', S.timing > 0.6 ? `Marks are spaced unevenly: clusters, then stretches of nothing (note timing CV ${G.ioiCv}).`
    : S.timing > 0.3 ? `Marks keep a loose pulse with some bunching (note timing CV ${G.ioiCv}).` : `Marks repeat at an even interval (note timing CV ${G.ioiCv}).`,
  [ev('note onset timing CV', G.ioiCv, '', ANCHORS.timingIrregularity[2])]);
  add('edges', S.ornament <= 0.5 ? `Held strokes have clean, quiet edges (residual movement inside settled notes ${G.ornamentCents} c).`
    : steady ? `Held strokes have a fine, regular tremor along their edges, ornament rather than damage (residual movement inside settled notes ${G.ornamentCents} c, in a controlled voice).`
      : `Even the held strokes tremble irregularly along their edges (residual movement inside settled notes ${G.ornamentCents} c, in a voice that is not in control).`,
  [ev('residual inside settled notes', G.ornamentCents, 'c', ANCHORS.ornament[2]), ev('control index', indices.control, '0–1', 'ornament when control ≥ 0.6, otherwise unsteadiness')]);

  // ---- Contrast -----------------------------------------------------------------------------
  add('contrast', S.dynamics > 0.6 ? `Strong value contrast: near-white paper against the darkest values of the palette (voiced level range ${G.levelRangeDb} dB).`
    : S.dynamics > 0.3 ? `Moderate value contrast, darkest only at the focal passage (voiced level range ${G.levelRangeDb} dB).` : `Close values throughout (voiced level range ${G.levelRangeDb} dB).`,
  [ev('voiced level range p10–p95', G.levelRangeDb, 'dB', ANCHORS.levelRange[2])]);
  // Where the voice lost hold for a moment in an otherwise controlled take,
  // that place is painted as it was sung, not smoothed into the rest.
  const eps = (s.episodes ?? []).filter((e) => e.sec >= EPISODE_MIN), local = eps.length > 0 || torn.length > 0;
  const hard = indices.control < 0.6 ? 'Most edges where colours meet are hard and collide' : indices.control < 0.85 || local ? 'Soft edges, with hard edges only where the singing lost control' : 'Edges are soft and planned';
  add('contrast', `${hard} (control index ${indices.control}).`, [ev('control index', indices.control, '0–1', '1 − mean(unstable share, landing overshoot, voice breaks), each scaled to its anchor'), ev('torn joins and unsteady episodes', torn.length + eps.length, 'count', 'any → hard edges there')]);

  // ---- Colour relations (inside the reference's palette family) ------------------------------
  const offWorst = [...passages].filter((p) => p.offGridCents != null).sort((a, b) => b.offGridCents - a.offGridCents)[0] ?? focus;
  add('harmony', indices.harmony > 0.5 ? `Colour relations are discordant: neighbouring hues that sit uneasily against each other and are left unresolved; the clash is strongest in ${offWorst.id} (notes ${offWorst.offGridCents} c off the singer's own pitch grid).`
    : indices.harmony > 0.15 ? `Mostly related hues, with one slightly off-key accent in ${offWorst.id}, where the notes sit furthest from the singer's own pitch grid (${offWorst.offGridCents} c).`
      : 'Closely related hues that sit together without friction.',
  [ev('intonation deviation (singer\'s own grid)', G.intonationDevCents, 'c', ANCHORS.intonationDev[2]), ev('tuning wander between windows', G.tuningWanderCents, 'c', ANCHORS.tuningWander[2]),
    ev('harmony tension', indices.harmony, '0–1', 'mean of intonation and tuning wander, scaled: > 0.5 discordant, > 0.15 one off-key accent'), ev(`${offWorst.id} off-grid`, offWorst.offGridCents, 'c', 'passage furthest off the grid carries the accent or the strongest clash')]);
  add('temperature', S.wander >= 0.5 ? `Temperature does not hold: it jumps between warm and cool more than once across the sheet, following the tuning shifts (grid wander ${G.tuningWanderCents} c).`
    : `One temperature held across the sheet (grid wander ${G.tuningWanderCents} c).`,
  [ev('tuning wander between windows', G.tuningWanderCents, 'c', `${ANCHORS.tuningWander[2]}; ≥ 20 c (half way) → jumps`), ev('key drift (singing analysis)', G.keyDriftCents, 'c', 'reported, not used: it jumps when a window offset crosses the 100 c wrap')]);

  // ---- Fragmentation, tension, water ----------------------------------------------------------
  add('fragmentation', eps.length ? `Fragmentation is local, not all-over: torn, dry-brush fragments with gaps in the pigment at ${eps.map((e) => `${pct(clamp((e.t0 - span0) / span))} across (${e.t0} s, ${e.sec} s unsteady)`).join('; ')}. Elsewhere the marks stay whole.`
    : 'No fragmented areas: every passage is painted whole.',
  [ev(`unstable episodes ≥ ${EPISODE_MIN} s`, eps.length, 'count', 'each episode → one fragmented area at its time position'), ev('fragmentation index', indices.fragmentation, '0–1', `mean(unstable share, voice breaks, breathless > ${BREATHLESS_SEC} s, worst passage)`)]);
  // Drops are already drawn in their passages; here the pitch snaps.
  const snaps = G.pitchBreaks ?? 0;
  if (snaps > 0) add('fragmentation', `${snaps} abrupt breaks in the voice's pitch: ${snaps > 2 ? 'sharp splits where a stroke snaps and continues far above or below' : 'one stroke snaps and resumes elsewhere'}.`,
    [ev('octave-size pitch jumps', snaps, 'count', ANCHORS.voiceBreaks[2])]);
  // How tense, from the index; whether the path holds together, from the joins.
  const broken = torn.length > 0 || (!steady && turns.length > 0);
  const path = broken ? 'the path of the masses breaks at the torn and jolting joins' : 'one coherent path';
  add('tension', indices.tension > 0.6 ? `High visual tension: ${broken ? path : 'the path of the masses reverses'}, the masses tilt against each other, and nothing settles (tension index ${indices.tension}).`
    : indices.tension > 0.3 ? `Moderate tension: ${path}, with a few points of friction (tension index ${indices.tension}).` : `Low tension: ${broken ? `${path}, but nothing else pulls against it` : 'one coherent, settled path'} (tension index ${indices.tension}).`,
  [ev('tension index', indices.tension, '0–1', 'mean(intonation, tuning wander, landing overshoot, largest sung leap), each scaled to its anchor'),
    ev('torn or jolting joins', torn.length + (steady ? 0 : turns.length), 'count', 'any → the path breaks')]);
  add('water', indices.control > 0.85 && !local ? 'Wet-in-wet only where strokes are slurred; blooms are planned and small. Water is controlled.'
    : indices.control > 0.6 ? 'Water mostly controlled; uncontrolled backruns appear only in the fragmented areas.'
      : 'Water is visibly out of control in the fragmented areas: cauliflower backruns, puddled pigment that dried with hard rims.',
  [ev('control index', indices.control, '0–1', '> 0.85 controlled; < 0.6 uncontrolled'), ev(`unstable episodes ≥ ${EPISODE_MIN} s`, eps.length, 'count', 'any → backruns left where the voice lost hold')]);

  const disorder = torn.length > 0 || (!steady && turns.length > 0) || eps.length > 0 || breaks > 0 || indices.harmony > 0.5;
  return { version: PERFORMANCE_DIRECTION_VERSION, passages, focus: focus.id, indices, disorder, decisions: D };
}

// The evidence stays in the trace; the image model gets visual language only.
export const visual = (t) => t
  .replace(/ \([^()]*\d[^()]*\)/g, '')
  .replace(/, \d+(\.\d+)?–\d+(\.\d+)? s,/g, ',')
  .replace(/ (in|by|jumps) \d+(\.\d+)? (s|st)\b/g, (m, w) => (w === 'jumps' ? ' jumps' : ''))
  .replace(/(^|\. )([a-z])/g, (m, a, b) => a + b.toUpperCase());

export const PERFORMANCE_FORM = {
  loose: 'Abstract: nothing is depicted and there is no picture space to step into. The performance structure below is the whole painting.',
  gathered: 'Semi-abstract: the subject only emerges, ambiguous and unfinished in places; no complete silhouettes or fully formed scenery, never a blurred illustration.',
  resolved: 'Finished and fully considered: the subject is clear and recognisable, carried through with full intent; never a realistic image.',
};

export function performanceSections(d, tier, colourLanguage) {
  const lines = d.decisions.map((x) => ({ aspect: x.aspect, text: visual(x.decision) }));
  const by = (...as) => lines.filter((x) => as.includes(x.aspect)).map((x) => x.text).join(' ');
  return {
    form: PERFORMANCE_FORM[tier] ?? PERFORMANCE_FORM.gathered,
    structure: `Performance structure (decides the composition of this painting): ${by('composition')}`,
    staging: tier === 'loose' ? null
      : tier === 'gathered' ? `Let the subject emerge out of this structure: its forms half-appear inside the masses, most legible at the focal passage (${d.focus}), dissolving elsewhere.`
        : `Stage the subject along this structure: its main form sits at the focal passage (${d.focus}); everything else follows the path, density and breaks of the passages below. The subject is drawn in the performance's own marks, so a broken passage breaks the subject too.`,
    passages: `Passages, left to right: ${lines.filter((x) => x.aspect.startsWith('passage')).map((x) => x.text).join(' ')}`,
    marks: `Marks: ${by('rhythm', 'edges', 'water')}`,
    contrast: `Contrast: ${by('contrast')}`,
    colour: `Colour, inside the reference's palette family (${colourLanguage}): ${by('harmony', 'temperature')}`,
    disorder: `Fragmentation and tension: ${by('fragmentation', 'tension')}`,
  };
}

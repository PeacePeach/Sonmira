// Resolved visual directions (Han, 19 Oct): a Resolved painting is not one
// default kind of image. The lyric reading (openai-understand.js, scene
// `options`) proposes a few ways to show this song's emotional event, each a
// different kind of image, strongest first; one is chosen here, the
// strongest that is not too close to the person's last five Resolved
// paintings. The options are possibilities, not templates: nothing cycles
// and no direction is owed a turn.
//
//   A scenic     expansive scenic narrative (a lone figure in a vast
//                landscape is one case of it, never the default)
//   B intimate   close or near view: posture, gesture, hands, an object held
//   C symbolic   a symbolic image that embodies the emotional event
//   D aftermath  what the event leaves behind: traces, evidence
//   E spatial    a room, corridor, window, doorway or street corner that
//                carries the tension
//   F invented   another direction, still specific and tied to the words
//
// Where the masses sit (left, right, centred) is the performance's to decide
// (performance.js), so it is not part of a look.

export const DIRECTIONS = {
  A: 'an expansive scenic narrative',
  B: 'an intimate near view',
  C: 'a symbolic image',
  D: 'a trace or aftermath',
  E: 'an interior or spatial scene',
  F: 'a freely invented direction',
};
export const DIRECTION_KEYS = Object.keys(DIRECTIONS);
export const DISTANCES = ['wide', 'medium', 'close'];
export const ANGLES = ['eye_level', 'low', 'high', 'birds_eye'];
export const FIGURES = ['none', 'one', 'several', 'many'];
export const SPACES = ['interior', 'exterior'];
export const LEADS = ['person', 'object', 'landscape', 'symbol', 'space'];
export const LOOK_KEYS = ['direction', 'distance', 'angle', 'figures', 'space', 'lead'];
export const RECENT_LOOKS = 5;
export const MAX_OPTIONS = 4;

const ANGLE_TEXT = { eye_level: 'at eye level', low: 'from a low angle', high: 'from a high angle', birds_eye: 'from directly above' };
const FIGURE_TEXT = { none: 'no figure', one: 'one figure', several: 'several figures', many: 'many people' };
const LEAD_TEXT = { person: 'person-led', object: 'object-led', landscape: 'landscape-led', symbol: 'symbol-led', space: 'led by the space itself' };

const short = (s, n) => String(s ?? '').replace(/[\u0000-\u001f"`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const pick = (v, list, d) => (list.includes(v) ? v : d);

// The image model draws "close-up" as a portrait; a near view is asked for
// in words that do not.
const nearView = (s) => s.replace(/\bclose-?ups? (?:of|on)\b/gi, 'near view of').replace(/\bclose-?ups?\b/gi, 'near view');

// Bounds an option from the reading (or a client) before it can reach a prompt.
export function cleanOption(o) {
  if (!o || typeof o !== 'object') return null;
  const image = nearView(short(o.image, 320));
  if (!image || !DIRECTION_KEYS.includes(o.direction)) return null;
  return {
    direction: o.direction, image,
    distance: pick(o.distance, DISTANCES, 'medium'), angle: pick(o.angle, ANGLES, 'eye_level'),
    figures: pick(o.figures, FIGURES, 'none'), space: pick(o.space, SPACES, 'exterior'), lead: pick(o.lead, LEADS, 'object'),
    figure: o.figures && o.figures !== 'none' ? nearView(short(o.figure, 120)) : '',
    // The words genuinely demand this image, even if a recent painting was like it.
    necessary: o.necessary === true,
  };
}
export const cleanOptions = (xs) => (Array.isArray(xs) ? xs : []).map(cleanOption).filter(Boolean).slice(0, MAX_OPTIONS);

export const signatureOf = (look) => Object.fromEntries(LOOK_KEYS.map((k) => [k, look?.[k] ?? null]));
// The stored history: signatures only, never the words.
export const cleanRecent = (xs) => (Array.isArray(xs) ? xs : []).filter((x) => x && typeof x === 'object')
  .map((x) => ({ direction: pick(x.direction, DIRECTION_KEYS, null), distance: pick(x.distance, DISTANCES, null), angle: pick(x.angle, ANGLES, null), figures: pick(x.figures, FIGURES, null), space: pick(x.space, SPACES, null), lead: pick(x.lead, LEADS, null) }))
  .slice(-RECENT_LOOKS);

// The image Han named as too frequent: one figure in a wide outdoor scene,
// in the middle distance, facing into scenery.
export const isLoneFigureLandscape = (l) => l?.figures === 'one' && l?.space === 'exterior' && l?.distance !== 'close' && (l?.lead === 'landscape' || l?.lead === 'person' || l?.direction === 'A');

// How much of a look the recent paintings already used: 0 (nothing in
// common) up to about 3.5 (the same look five times running). The latest
// painting counts most.
const WEIGHTS = { direction: 3, distance: 2, angle: 2, figures: 2, space: 1, lead: 2 };
const TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
export function repetition(look, recent) {
  const r = recent.slice(-RECENT_LOOKS).reverse();
  let sum = 0;
  r.forEach((e, age) => {
    const same = LOOK_KEYS.reduce((s, k) => s + (look[k] && look[k] === e[k] ? WEIGHTS[k] : 0), 0);
    sum += (1 - age * 0.15) * (same / TOTAL);
  });
  if (isLoneFigureLandscape(look) && r.some(isLoneFigureLandscape)) sum += 1.5;
  return sum;
}

// A near-duplicate of a recent painting: the same kind of image seen the
// same way (at least 80% of the weighted look in common: the same
// direction, with at most one other part of the look different). Han's review (19 Oct): when a
// comparably strong option exists, a near-duplicate of any of the last five
// is not chosen at all; a soft cost alone could still let it win.
export const NEAR_DUPLICATE = 0.8;
export const isNearDuplicate = (look, e) => LOOK_KEYS.reduce((s, k) => s + (look[k] && look[k] === e[k] ? WEIGHTS[k] : 0), 0) / TOTAL >= NEAR_DUPLICATE;
// Comparably strong: within the reading's top three for this song.
export const COMPARABLE_RANKS = 3;

// Strength first: each step down the reading's ranking costs as much as
// sharing two thirds of a look with the last painting, so the strongest
// option wins unless the recent paintings already made it.
const RANK_COST = 1;
const REPEAT_COST = 1.5;

// Without options (no words, a note, or an older reading): no story is
// invented, only the viewpoint varies, so a place is not always seen the
// same way.
export const VIEWPOINTS = [
  { distance: 'wide', angle: 'eye_level', text: 'a wide view at eye level, with real depth from near to far' },
  { distance: 'medium', angle: 'low', text: 'a middle-distance view from a low angle, the near ground rising into the picture' },
  { distance: 'close', angle: 'eye_level', text: 'a near view of one particular part of the place, the rest only glimpsed beyond it' },
  { distance: 'wide', angle: 'high', text: 'a view from high above, looking down across the place' },
  { distance: 'medium', angle: 'birds_eye', text: 'a view from directly above, the place laid out like a map' },
];

// exclude: ranks that cannot be painted (direct: they would show a face or
// unnamed people); the rest keep their place in the reading's order.
export function chooseLook({ options = [], recent = [], seed = 0, exclude = [] } = {}) {
  const hist = cleanRecent(recent);
  const pool = cleanOptions(options);
  if (pool.some((_, i) => !exclude.includes(i))) {
    const scored = pool.map((o, rank) => ({ o, rank, repeat: repetition(o, hist), duplicate: hist.some((e) => isNearDuplicate(o, e)) })).filter((x) => !exclude.includes(x.rank))
      .map((x) => ({ ...x, cost: x.rank * RANK_COST + x.repeat * REPEAT_COST }));
    // The rule first: no near-duplicate of the last five while a comparably
    // strong option is new (unless the words demand that very image); then
    // the softer cost among what is left.
    const allowed = scored.filter((x) => !x.duplicate || (x.o.necessary && x.rank === 0));
    const fresh = allowed.filter((x) => x.rank < COMPARABLE_RANKS);
    const among = fresh.length ? fresh : scored;
    const best = among.reduce((a, b) => (b.cost < a.cost - 1e-9 ? b : a));
    const stronger = scored.filter((x) => x.rank < best.rank);
    return {
      source: 'words', ...best.o, rank: best.rank, recent: hist.length,
      reason: !fresh.length ? 'every comparable option repeats a recent Resolved painting: the least repetitive one'
        : best.duplicate ? 'the words demand this image, though a recent painting was like it'
          : best.rank === 0 ? 'the strongest option for the words'
            : stronger.length && stronger.every((x) => x.duplicate) ? `option ${best.rank + 1}: the stronger ones nearly duplicate recent Resolved paintings`
              : !stronger.length ? `option ${best.rank + 1}: the stronger ones cannot be painted`
                : `option ${best.rank + 1}: the stronger ones repeat recent Resolved paintings`,
      considered: scored.map((x) => ({ direction: x.o.direction, rank: x.rank, repeat: Math.round(x.repeat * 100) / 100, duplicate: x.duplicate })),
    };
  }
  const start = (seed >>> 0) % VIEWPOINTS.length;
  const order = VIEWPOINTS.map((_, i) => VIEWPOINTS[(start + i) % VIEWPOINTS.length]);
  const best = order.reduce((a, b) => (repetition({ ...b, direction: null, figures: 'none', space: null, lead: null }, hist) < repetition({ ...a, direction: null, figures: 'none', space: null, lead: null }, hist) - 1e-9 ? b : a));
  return { source: 'viewpoint', direction: null, distance: best.distance, angle: best.angle, figures: 'none', space: null, lead: null, figure: '', image: '', viewpoint: best.text, rank: null, recent: hist.length, reason: 'no direction options from the words: only the viewpoint varies' };
}

// One recent painting, in a few words, for the prompt.
export function describeLook(l) {
  return [l.direction ? DIRECTIONS[l.direction] : null, l.distance ? `${l.distance} view` : null, l.angle ? ANGLE_TEXT[l.angle] : null,
    l.figures ? FIGURE_TEXT[l.figures] : null, l.space, l.lead ? LEAD_TEXT[l.lead] : null].filter(Boolean).join(', ');
}

export const RESOLVED_VARIETY = 'A lone person standing in a wide landscape, one small figure in the middle distance, a horizon-led composition or a figure facing away into scenery is only one possible kind of Resolved image, never the default: paint one only when the direction above is that.';

export function lookLine(look) {
  if (!look) return null;
  const recent = look.recentLooks?.length ? ` Recent Resolved paintings for this person were ${look.recentLooks.map(describeLook).join('; ')}: this one must read clearly different from them in composition, viewpoint and how it translates the words.` : '';
  if (look.source === 'viewpoint') return `Viewpoint: ${look.viewpoint}.${recent} ${RESOLVED_VARIETY}`;
  return [
    `Visual direction, chosen for this song from several possible ones: ${DIRECTIONS[look.direction]}.`,
    `View: a ${look.distance} view ${ANGLE_TEXT[look.angle]}; ${FIGURE_TEXT[look.figures]}; ${look.space}; ${LEAD_TEXT[look.lead]}.`,
    recent.trim() || null,
    RESOLVED_VARIETY,
  ].filter(Boolean).join(' ');
}

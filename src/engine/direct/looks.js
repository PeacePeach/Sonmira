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
//
// Rolling three (Han, 19 Oct, the last engine pass): each look also carries
// its composition scale and its motif tags. Among any three Resolved
// paintings in a row at least one is a grand, wide scenic composition, and
// a motif family of the last three is not repeated unless the words demand
// it. Both bias the choice among the reading's options; neither invents an
// image the words did not give.

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
export const SCALES = ['wide_scenic', 'medium_scene', 'close_detail', 'portrait', 'interior'];
// The rolling window: the new painting and the two before it need one wide
// scene; a motif of the last three is not repeated.
export const ROLLING = 3;
export const MAX_MOTIFS = 6;

const ANGLE_TEXT = { eye_level: 'at eye level', low: 'from a low angle', high: 'from a high angle', birds_eye: 'from directly above' };
const FIGURE_TEXT = { none: 'no figure', one: 'one figure', several: 'several figures', many: 'many people' };
const LEAD_TEXT = { person: 'person-led', object: 'object-led', landscape: 'landscape-led', symbol: 'symbol-led', space: 'led by the space itself' };

const short = (s, n) => String(s ?? '').replace(/[\u0000-\u001f"`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const pick = (v, list, d) => (list.includes(v) ? v : d);

// The image model draws "close-up" as a portrait; a near view is asked for
// in words that do not.
const nearView = (s) => s.replace(/\bclose-?ups? (?:of|on)\b/gi, 'near view of').replace(/\bclose-?ups?\b/gi, 'near view');

// The composition scale of a look, from its view alone (so a stored
// signature from before scales were kept still has one). Wide scenic: a
// long view (outdoors, or a hall or large room), or an outdoor
// middle-distance one led by the landscape or the space itself, so the
// setting is a major subject, with or without people.
export function scaleOf(l) {
  if (!l) return null;
  if (l.figures && l.figures !== 'none' && (l.distance === 'close' || (l.distance === 'medium' && l.lead === 'person'))) return 'portrait';
  if (l.distance === 'wide' || (l.distance === 'medium' && l.space !== 'interior' && (l.lead === 'landscape' || l.lead === 'space'))) return 'wide_scenic';
  if (l.distance === 'close') return 'close_detail';
  if (l.space === 'interior') return 'interior';
  return l.distance ? 'medium_scene' : null;
}
export const isWide = (l) => (l?.scale ?? scaleOf(l)) === 'wide_scenic';

// Motif families: words that name the same kind of image count as one motif
// (the moon and the stars are one celestial motif).
const MOTIF_FAMILIES = [
  ['celestial', /\b(moon\w*|stars?|starlight|starry|constellations?|comets?|planets?|galax\w*)\b/],
  ['window', /\b(windows?|windowsills?|window-?panes?)\b/],
  ['heart', /\bhearts?\b/],
  ['crossroads', /\b(crossroads?|intersections?|junctions?|forks? in the (road|path)|forked (road|path)s?|(diverging|parting) (paths|roads|ways))\b/],
  ['wound', /\b(bullets?|wounds?|wounded|blood\w*|bleed\w*|scars?|guns?|gunshot)\b/],
  ['silhouette', /\bsilhouett\w*\b/],
  ['road', /\b(roads?|highways?|paths?|lanes?)\b/],
  ['rain', /\b(rain\w*|downpour|umbrellas?)\b/],
  ['sea', /\b(seas?|ocean\w*|shores?|coast\w*|waves?|tides?|beach\w*|harbou?rs?)\b/],
  ['river', /\b(rivers?|streams?|creeks?)\b/],
  ['door', /\b(doors?|doorways?|gates?)\b/],
  ['letter', /\b(letters?|envelopes?|pages?)\b/],
  ['thread', /\b(threads?|strings?|ropes?|ribbons?)\b/],
  ['boat', /\b(boats?|ships?|sails?)\b/],
  ['bird', /\b(birds?|wings?|feathers?)\b/],
  ['flower', /\b(flowers?|petals?|blossoms?|roses?)\b/],
  ['lamp', /\b(candles?|lamps?|lanterns?|streetlights?)\b/],
  ['clock', /\b(clocks?|hourglass\w*)\b/],
  ['mirror', /\bmirrors?\b/],
  ['station', /\b(stations?|platforms?|trains?|railway\w*)\b/],
  ['snow', /\b(snow\w*|frost\w*)\b/],
  ['fire', /\b(fires?|flames?|embers?|smoke|burn\w*|ash(es)?)\b/],
  ['mountain', /\b(mountains?|peaks?|cliffs?)\b/],
  ['tree', /\b(trees?|forests?)\b/],
  ['footprints', /\bfootprints?\b/],
  ['bridge', /\bbridges?\b/],
];
const PERSON_WORD = /\b(figures?|persons?|people|man|men|woman|women|girl|boy|someone|lovers?|couple|crowd)\b/;
// The motif tags of an option: the families its words name, the reading's
// own motif nouns (any it names outside those families kept as they are, so
// a repeated symbolic object of any kind is caught), and two that come from
// the view: one standing figure, and a crowd.
export function motifsOf(o) {
  const tags = new Set();
  const text = `${o.image ?? ''} ${o.figure ?? ''}`.toLowerCase();
  for (const [family, re] of MOTIF_FAMILIES) if (re.test(text)) tags.add(family);
  for (const m of Array.isArray(o.motifs) ? o.motifs : []) {
    const w = short(m, 40).toLowerCase().replace(/^(a|an|the|one|two)\s+/, '');
    if (!w) continue;
    const family = MOTIF_FAMILIES.find(([f, re]) => f === w || re.test(w));
    if (family) tags.add(family[0]);
    else if (!PERSON_WORD.test(w)) tags.add(w.slice(0, 24));
  }
  if (o.figures === 'one' && scaleOf(o) !== 'portrait') tags.add('lone_figure');
  if (o.figures === 'many') tags.add('crowd');
  return [...tags].slice(0, MAX_MOTIFS);
}

// Bounds an option from the reading (or a client) before it can reach a prompt.
export function cleanOption(o) {
  if (!o || typeof o !== 'object') return null;
  const image = nearView(short(o.image, 320));
  if (!image || !DIRECTION_KEYS.includes(o.direction)) return null;
  const c = {
    direction: o.direction, image,
    distance: pick(o.distance, DISTANCES, 'medium'), angle: pick(o.angle, ANGLES, 'eye_level'),
    figures: pick(o.figures, FIGURES, 'none'), space: pick(o.space, SPACES, 'exterior'), lead: pick(o.lead, LEADS, 'object'),
    figure: o.figures && o.figures !== 'none' ? nearView(short(o.figure, 120)) : '',
    // The words genuinely demand this image, even if a recent painting was like it.
    necessary: o.necessary === true,
  };
  return { ...c, scale: scaleOf(c), motifs: motifsOf({ ...c, motifs: o.motifs }) };
}
export const cleanOptions = (xs) => (Array.isArray(xs) ? xs : []).map(cleanOption).filter(Boolean).slice(0, MAX_OPTIONS);

const cleanTags = (xs) => (Array.isArray(xs) ? xs : []).map((t) => short(t, 24).toLowerCase()).filter(Boolean).slice(0, MAX_MOTIFS);
// A look's signature: its view, its composition scale and its motif tags,
// never its words.
export const signatureOf = (look) => ({ ...Object.fromEntries(LOOK_KEYS.map((k) => [k, look?.[k] ?? null])), scale: look?.scale ?? scaleOf(look), motifs: cleanTags(look?.motifs) });
// The stored history: signatures only, never the words. An entry stored
// before scales and motifs were kept gets its scale from its view and no
// motifs.
export const cleanRecent = (xs) => (Array.isArray(xs) ? xs : []).filter((x) => x && typeof x === 'object')
  .map((x) => {
    const e = { direction: pick(x.direction, DIRECTION_KEYS, null), distance: pick(x.distance, DISTANCES, null), angle: pick(x.angle, ANGLES, null), figures: pick(x.figures, FIGURES, null), space: pick(x.space, SPACES, null), lead: pick(x.lead, LEADS, null) };
    return { ...e, scale: pick(x.scale, SCALES, null) ?? scaleOf(e), motifs: cleanTags(x.motifs) };
  })
  .slice(-RECENT_LOOKS);

// The rolling-three state before a new painting: is a wide scene owed (the
// last two were both not wide), and which motifs the last three used.
export function rolling(hist) {
  const last = hist.slice(-(ROLLING - 1));
  return {
    wideNeeded: last.length === ROLLING - 1 && last.every((e) => !isWide(e)),
    recentMotifs: [...new Set(hist.slice(-ROLLING).flatMap((e) => e.motifs ?? []))],
  };
}

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
// Among options that all repeat a motif, fewer repeats cost less.
const MOTIF_COST = 1;

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
//
// The order of what decides (Han, 19 Oct): the words first (only the
// reading's own options, the strongest unless a rule below sets it aside);
// then no near-duplicate of the last five; then no motif of the last three;
// then a wide scene when the last two were not wide. A lower rule never
// overrides a higher one, and an option the words demand (the reading marks
// it necessary, strongest first) overrides all three.
export function chooseLook({ options = [], recent = [], seed = 0, exclude = [] } = {}) {
  const hist = cleanRecent(recent);
  const pool = cleanOptions(options);
  const { wideNeeded, recentMotifs } = rolling(hist);
  if (pool.some((_, i) => !exclude.includes(i))) {
    const scored = pool.map((o, rank) => {
      const repeated = o.motifs.filter((m) => recentMotifs.includes(m));
      return { o, rank, repeat: repetition(o, hist), duplicate: hist.some((e) => isNearDuplicate(o, e)), repeated, wide: isWide(o), demanded: o.necessary && rank === 0 };
    }).filter((x) => !exclude.includes(x.rank))
      .map((x) => ({ ...x, cost: x.rank * RANK_COST + x.repeat * REPEAT_COST + x.repeated.length * MOTIF_COST }));
    // No near-duplicate of the last five while a comparably strong option is
    // new; then no motif of the last three, among what is left.
    const allowed = scored.filter((x) => !x.duplicate || x.demanded);
    const fresh = allowed.filter((x) => x.rank < COMPARABLE_RANKS);
    const motifFree = fresh.filter((x) => !x.repeated.length || x.demanded);
    let among = motifFree.length ? motifFree : fresh.length ? fresh : scored;
    // A wide scene is owed: the strongest wide option that passed the rules
    // above, at any rank (every option is the reading's own, from these
    // words), unless the words demand another image.
    const motifOk = allowed.filter((x) => !x.repeated.length || x.demanded);
    const wideOk = wideNeeded ? (motifOk.length ? motifOk : allowed).filter((x) => x.wide) : [];
    // The words come first: an image they demand is painted.
    const demanded = among.find((x) => x.demanded);
    if (demanded) among = [demanded];
    else if (wideNeeded && wideOk.length) among = wideOk;
    const best = among.reduce((a, b) => (b.cost < a.cost - 1e-9 ? b : a));
    const stronger = scored.filter((x) => x.rank < best.rank);
    const override = best.demanded && (best.duplicate || best.repeated.length)
      ? `the words demand this image${best.repeated.length ? `, though the recent paintings already used ${best.repeated.join(', ')}` : ', though a recent painting was like it'}` : null;
    const diversity = {
      scale: best.o.scale, motifs: best.o.motifs, recentMotifs, repeatedMotifs: best.repeated, wideNeeded,
      wide: best.wide ? (wideNeeded ? 'chosen to meet the rolling-three wide rule' : 'yes') : (wideNeeded ? (demanded ? 'not met: the words demand another image' : 'not met: no option the rules allow is a wide scene') : 'not needed'),
      ...(override ? { override } : {}),
    };
    return {
      source: 'words', ...best.o, rank: best.rank, recent: hist.length,
      reason: !fresh.length ? 'every comparable option repeats a recent Resolved painting: the least repetitive one'
        : override ? override
          : best.rank === 0 ? 'the strongest option for the words'
            : wideNeeded && best.wide && stronger.some((x) => !x.wide && !x.duplicate && !x.repeated.length) ? `option ${best.rank + 1}: a wide scene, as the last two Resolved paintings were not wide`
              : stronger.length && stronger.every((x) => x.duplicate) ? `option ${best.rank + 1}: the stronger ones nearly duplicate recent Resolved paintings`
                : stronger.length && stronger.every((x) => x.duplicate || x.repeated.length) ? `option ${best.rank + 1}: the stronger ones repeat a recent painting or its motifs`
                  : !stronger.length ? `option ${best.rank + 1}: the stronger ones cannot be painted`
                    : `option ${best.rank + 1}: the stronger ones repeat recent Resolved paintings`,
      considered: scored.map((x) => ({ direction: x.o.direction, rank: x.rank, repeat: Math.round(x.repeat * 100) / 100, duplicate: x.duplicate, scale: x.o.scale, repeatedMotifs: x.repeated })),
      diversity,
    };
  }
  const start = (seed >>> 0) % VIEWPOINTS.length;
  const order = VIEWPOINTS.map((_, i) => VIEWPOINTS[(start + i) % VIEWPOINTS.length]);
  const candidates = wideNeeded ? order.filter((v) => v.distance === 'wide') : order;
  const asLook = (v) => ({ ...v, direction: null, figures: 'none', space: null, lead: null });
  const best = candidates.reduce((a, b) => (repetition(asLook(b), hist) < repetition(asLook(a), hist) - 1e-9 ? b : a));
  const scale = scaleOf(asLook(best));
  return { source: 'viewpoint', direction: null, distance: best.distance, angle: best.angle, figures: 'none', space: null, lead: null, figure: '', image: '', viewpoint: best.text, scale, motifs: [], rank: null, recent: hist.length,
    reason: wideNeeded ? 'no direction options from the words: a wide viewpoint, as the last two Resolved paintings were not wide' : 'no direction options from the words: only the viewpoint varies',
    diversity: { scale, motifs: [], recentMotifs, repeatedMotifs: [], wideNeeded, wide: wideNeeded ? 'chosen to meet the rolling-three wide rule' : scale === 'wide_scenic' ? 'yes' : 'not needed' } };
}

// One recent painting, in a few words, for the prompt.
export function describeLook(l) {
  return [l.direction ? DIRECTIONS[l.direction] : null, l.distance ? `${l.distance} view` : null, l.angle ? ANGLE_TEXT[l.angle] : null,
    l.figures ? FIGURE_TEXT[l.figures] : null, l.space, l.lead ? LEAD_TEXT[l.lead] : null].filter(Boolean).join(', ');
}

export const RESOLVED_VARIETY = 'A lone person standing in a wide landscape, one small figure in the middle distance, a horizon-led composition or a figure facing away into scenery is only one possible kind of Resolved image, never the default: paint one only when the direction above is that.';

export const WIDE_SCENE = 'A grand, wide scenic composition: a broad spatial view in which the setting itself is a major subject.';

export function lookLine(look) {
  if (!look) return null;
  const used = look.diversity?.recentMotifs?.filter((m) => !look.diversity.repeatedMotifs?.includes(m)) ?? [];
  const motifs = used.length ? ` Motifs of the last few Resolved paintings (${used.join(', ').replace(/_/g, ' ')}) are not repeated here.` : '';
  const recent = look.recentLooks?.length ? ` Recent Resolved paintings for this person were ${look.recentLooks.map(describeLook).join('; ')}: this one must read clearly different from them in composition, viewpoint and how it translates the words.${motifs}` : '';
  const wide = look.scale === 'wide_scenic' ? ` ${WIDE_SCENE}` : '';
  if (look.source === 'viewpoint') return `Viewpoint: ${look.viewpoint}.${wide}${recent} ${RESOLVED_VARIETY}`;
  return [
    `Visual direction, chosen for this song from several possible ones: ${DIRECTIONS[look.direction]}.`,
    `View: a ${look.distance} view ${ANGLE_TEXT[look.angle]}; ${FIGURE_TEXT[look.figures]}; ${look.space}; ${LEAD_TEXT[look.lead]}.`,
    wide.trim() || null,
    recent.trim() || null,
    RESOLVED_VARIETY,
  ].filter(Boolean).join(' ');
}

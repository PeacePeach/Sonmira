// Han, 19 Oct: Resolved inherits the reference's variety of colour and is a
// scene, not a mood; abstract words are imagined into a concrete scene;
// Gathered stays mood-forward. Loose is unchanged.
//   reference → style, finish, palette richness, marks · words → subject, scene
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sungLyrics, SR } from './synth.js';
import { measurePerformance } from '../../src/engine/analysis/performance-measure.js';
import { direct, createLibrary, checkPrompt, RESOLVED_SCENE, RESOLVED_IMAGINE, RESOLVED_PLACES, GLOBAL_STYLE_RESOLVED } from '../../src/engine/direct/index.js';
import { LIBRARY, referenceColourRange, RESOLVED_PALETTE_AUTHORITY, REFERENCE_AUTHORITY_RESOLVED, REFERENCE_AUTHORITY_PERFORMANCE_RESOLVED } from '../../src/engine/direct/library.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';
import { SYSTEM } from '../../src/engine/providers/openai-understand.js';

const perf = measurePerformance(sungLyrics(), SR);
const WORDS = { source: 'lyrics', text: 'the bitterness of learning to love, and stories that stay', theme: ['love learned through hardship'], imagery: [], figurative: [] };
const paint = (completeness, family, reference, o = {}) => direct({ completeness, family, reference, seed: 7, motif: 'abstract', emotion: 'melancholic', energy: { value: 'lively' }, performance: perf, ...o });

test('every reference carries its distinct colour families, tonal steps merged', () => {
  for (const e of REFERENCE_LIBRARY.filter((x) => x.active)) {
    const f = e.palette.families;
    assert.ok(Array.isArray(f) && f.length >= 1 && f.length <= 6, e.id);
    for (const c of f) assert.match(c.hex, /^#[0-9a-f]{6}$/, e.id);
  }
  // resolved_10 shows five colour families although `colors` keeps three blues.
  assert.equal(referenceColourRange(LIBRARY.get('resolved_10')).count, 5);
});

test('Resolved inherits at least three distinct colours, four to five when the reference has them', () => {
  const rich = paint('resolved', 'R5-light-as-subject', 'resolved_10');
  assert.match(rich.sections.palette, /^Palette, inherited from the reference: carry its variety of colour, not only its dominant hue\./);
  assert.match(rich.sections.palette, /Use at least 3 clearly distinct colours from them, aiming for 4 to 5 colour families/);
  assert.match(rich.sections.palette, /Never reduce it to a single hue/);
  assert.match(rich.sections.palette, /Colour relations, from how it was sung: /);
  assert.deepEqual(rich.resolvedPalette, { applied: true, families: referenceColourRange(LIBRARY.get('resolved_10')).names, count: 5, mono: false });
  // Near-monochrome (Han, 19 Oct): no third hue is forced; its own identity
  // varies through tone, saturation and temperature.
  for (const id of ['resolved_04', 'resolved_03', 'resolved_01']) {
    const mono = paint('resolved', LIBRARY.get(id).family, id);
    assert.ok(referenceColourRange(LIBRARY.get(id)).mono, id);
    assert.match(mono.sections.palette, /keep its own colour identity.*Add no hue it does not contain.*tonal, saturation and temperature variation/, id);
    assert.doesNotMatch(mono.sections.palette, /at least 3|4 to 5|single hue/, id);
    assert.equal(mono.resolvedPalette.mono, true, id);
  }
  // Exactly three families: at least three, no four-to-five aim.
  const three = paint('resolved', 'R3-vivid-wash-focal', 'resolved_02');
  assert.match(three.sections.palette, /Use at least 3 clearly distinct colours from them, each/);
  assert.equal(three.resolvedPalette.mono, false);
  assert.equal(rich.referencePrompt, REFERENCE_AUTHORITY_PERFORMANCE_RESOLVED);
  assert.ok(rich.referencePrompt.endsWith(RESOLVED_PALETTE_AUTHORITY));
  // Without a measured performance: the measured hierarchy, no "keep these proportions".
  const plain = paint('resolved', 'R5-light-as-subject', 'resolved_10', { performance: null });
  assert.match(plain.sections.palette, /measured from the reference: dominant.*Palette, inherited from the reference/);
  assert.doesNotMatch(plain.sections.palette, /Keep these proportions/);
  assert.equal(plain.referencePrompt, REFERENCE_AUTHORITY_RESOLVED);
  // Text-only: the family's whole scheme and the richer universal layer.
  const text = paint('resolved', 'R5-light-as-subject', null, { performance: null, library: createLibrary([]) });
  assert.ok(text.prompt.includes(GLOBAL_STYLE_RESOLVED));
  assert.ok(text.resolvedPalette.count >= 3);
});

test('Resolved is a scene: words without a scene are imagined into one; no words still make a place', () => {
  const words = paint('resolved', 'R3-vivid-wash-focal', 'resolved_02', { concept: WORDS });
  assert.equal(words.narrative.applied, false);
  assert.ok(words.sections.scene.startsWith(`${RESOLVED_SCENE} ${RESOLVED_IMAGINE} Viewpoint: `));
  assert.match(RESOLVED_IMAGINE, /waiting, lingering, separation, a long journey, quiet endurance, traces of memory, distance, a parting of ways/);
  assert.match(RESOLVED_IMAGINE, /conditions to reason from, not pictures to reuse: invent an original, emotionally grounded situation/);
  assert.match(RESOLVED_SCENE, /never only an atmospheric wash, a pattern or a generic landscape/);
  const none = paint('resolved', 'R3-vivid-wash-focal', 'resolved_02', { motif: 'water' });
  assert.ok(none.sections.scene.startsWith(`${RESOLVED_SCENE} Viewpoint: `));
  assert.ok(none.sections.subject.includes(RESOLVED_PLACES.water));
  assert.doesNotMatch(none.sections.subject, /as atmosphere/);
  for (const d of [words, none]) assert.equal(checkPrompt(d).verdict, 'ok', JSON.stringify(checkPrompt(d)));
});

test('the reading is told to turn abstract words into a concrete poetic scene, without stock imagery', () => {
  assert.match(SYSTEM, /emotionally rich but name few or no visible things .* never fall back to an abstract wash or a mood/);
  assert.match(SYSTEM, /a concrete poetic scene, symbolic event or emotionally readable moment with a focal point: not a literal illustration, not an empty abstraction/);
  // Han, 19 Oct: the conditions are not templates; each song gets its own scene.
  assert.match(SYSTEM, /never pictures to reuse: do not default to a familiar or stock setting, and do not let one kind of scene recur from song to song/);
  assert.match(SYSTEM, /Invent an original, emotionally grounded situation for this song.*nothing disconnected or generic/);
});

test('Gathered stays mood-forward with its own palette line; Loose is untouched', () => {
  const g = paint('gathered', 'G2-splash-wash', 'gathered_02', { concept: WORDS });
  assert.match(g.sections.form, /Mood-forward: the feeling leads/);
  assert.match(paint('gathered', 'G2-splash-wash', 'gathered_02').sections.form, /Mood-forward: the feeling leads, the story stays light/);
  assert.equal(g.sections.scene, null);
  assert.match(g.sections.palette, /^Colour, inside the reference's palette family/);
  assert.deepEqual(g.resolvedPalette, { applied: false, reason: 'tier gathered' });
  const l = paint('loose', 'L2-bloom-field', 'loose_02', { concept: WORDS });
  assert.doesNotMatch(l.prompt, /Palette, inherited|Resolved means a scene|Mood-forward/);
});

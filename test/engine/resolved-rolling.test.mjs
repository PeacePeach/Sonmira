// Rolling three (Han, 19 Oct): among any three Resolved paintings in a row,
// at least one grand, wide scenic composition; no motif family of the last
// three repeated unless the words demand it. Both only bias the choice among
// the reading's own options, after lyric fit and the near-duplicate rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { direct } from '../../src/engine/direct/index.js';
import { SYSTEM, cleanReading } from '../../src/engine/providers/openai-understand.js';
import { chooseLook, cleanOption, cleanRecent, motifsOf, rolling, scaleOf, signatureOf, WIDE_SCENE, RECENT_LOOKS } from '../../src/engine/direct/looks.js';
import { recentLooks, rememberLook } from '../../api/generate.js';
import { memoryKV } from '../../server/protect/kv.js';

const opt = (direction, image, o = {}) => cleanOption({ direction, image, distance: 'medium', angle: 'eye_level', figures: 'none', space: 'exterior', lead: 'object', figure: '', ...o });
const sig = (direction, image, o) => signatureOf(opt(direction, image, o));
const NEAR = (image, o = {}) => sig('B', image, { distance: 'close', space: 'interior', lead: 'object', ...o });

test('composition scale: wide scenic, portrait, close detail, interior, medium scene', () => {
  assert.equal(scaleOf({ distance: 'wide', figures: 'one', lead: 'landscape' }), 'wide_scenic');
  assert.equal(scaleOf({ distance: 'wide', figures: 'none', space: 'interior', lead: 'space' }), 'wide_scenic'); // a hall, a large room
  assert.equal(scaleOf({ distance: 'medium', lead: 'landscape' }), 'wide_scenic'); // medium-long, the setting leads
  assert.equal(scaleOf({ distance: 'close', figures: 'one', lead: 'person' }), 'portrait');
  assert.equal(scaleOf({ distance: 'medium', figures: 'one', lead: 'person' }), 'portrait');
  assert.equal(scaleOf({ distance: 'close', figures: 'none', lead: 'symbol' }), 'close_detail');
  assert.equal(scaleOf({ distance: 'medium', space: 'interior', lead: 'object' }), 'interior');
  assert.equal(scaleOf({ distance: 'medium', space: 'exterior', lead: 'object' }), 'medium_scene');
  // A signature stored before scales were kept gets one from its view.
  const [old] = cleanRecent([{ direction: 'A', distance: 'wide', angle: 'high', figures: 'none', space: 'exterior', lead: 'landscape' }]);
  assert.equal(old.scale, 'wide_scenic');
  assert.deepEqual(old.motifs, []);
});

test('motif tags: families from the words and the reading, plus a lone figure or a crowd', () => {
  assert.deepEqual(motifsOf({ image: 'The moon and a few stars over a dark field.', figures: 'none' }), ['celestial']);
  assert.deepEqual(opt('E', 'A window left open on a stair landing.', { space: 'interior' }).motifs, ['window']);
  // The reading's own nouns: in a family, or kept as they are.
  assert.deepEqual(opt('C', 'A small folded shape on a sill.', { motifs: ['the moon', 'a paper crane'] }).motifs, ['celestial', 'paper crane']);
  // People are tagged by the view, not by words.
  assert.deepEqual(opt('A', 'A figure on a ridge.', { distance: 'wide', figures: 'one', lead: 'landscape', figure: 'one small figure', motifs: ['a lone figure'] }).motifs, ['lone_figure']);
  assert.ok(opt('A', 'A square full of people.', { distance: 'wide', figures: 'many', figure: 'a crowd' }).motifs.includes('crowd'));
  assert.ok(!opt('B', 'A face in tears.', { distance: 'close', figures: 'one', lead: 'person', figure: 'a woman crying' }).motifs.includes('lone_figure'));
  // Cleaning twice changes nothing (the server cleans a reading, then direct() again).
  const o = opt('C', 'A heart-shaped stone split by a crack, under the moon.', { motifs: ['heart', 'paper crane'] });
  assert.deepEqual(cleanOption(o).motifs, o.motifs);
});

test('after two paintings that were not wide, a wide option is chosen, even further down the ranking', () => {
  const recent = [NEAR('Two cups on a table.'), NEAR('A ring on a sill.', { direction: 'D', angle: 'high' })];
  assert.equal(rolling(cleanRecent(recent)).wideNeeded, true);
  const options = [
    opt('C', 'A cracked mirror holding a broken reflection of a lamp.', { distance: 'close', lead: 'symbol' }),
    opt('E', 'A narrow stairwell, a coat left on the banister.', { space: 'interior', lead: 'object' }),
    opt('A', 'A long valley road at dusk, one lit house at its far end.', { distance: 'wide', angle: 'high', lead: 'landscape' }),
  ];
  const l = chooseLook({ options, recent });
  assert.equal(l.direction, 'A');
  assert.equal(l.scale, 'wide_scenic');
  assert.match(l.reason, /a wide scene, as the last two Resolved paintings were not wide/);
  assert.equal(l.diversity.wide, 'chosen to meet the rolling-three wide rule');
  // One of the last two was wide: the strongest option, as before.
  const relaxed = chooseLook({ options, recent: [recent[0], sig('A', 'x', { distance: 'wide', lead: 'landscape' })] });
  assert.equal(relaxed.direction, 'C');
  assert.equal(relaxed.diversity.wide, 'not needed');
});

test('the wide rule never invents a scene and never outranks the words or the stronger rules', () => {
  const recent = [NEAR('Two cups on a table.'), NEAR('A ring on a sill.', { direction: 'D', angle: 'high' })];
  // No wide option from the words: nothing is forced; it is reported.
  const narrow = [opt('C', 'A cracked mirror.', { distance: 'close', lead: 'symbol' }), opt('E', 'A stairwell, a coat on the banister.', { space: 'interior' })];
  const a = chooseLook({ options: narrow, recent });
  assert.equal(a.direction, 'C');
  assert.match(a.diversity.wide, /not met: no option the rules allow is a wide scene/);
  // The words demand the near image: it stays.
  const b = chooseLook({ options: [{ ...narrow[0], necessary: true }, opt('A', 'A long valley road at dusk.', { distance: 'wide', lead: 'landscape' })], recent });
  assert.equal(b.direction, 'C');
  assert.match(b.diversity.wide, /not met: the words demand another image/);
  // A wide option that nearly duplicates a recent painting is still not chosen.
  const wideDup = opt('A', 'A long road under clouds.', { distance: 'wide', lead: 'landscape' });
  const hist = [signatureOf(wideDup), ...recent];
  assert.equal(chooseLook({ options: [narrow[0], wideDup], recent: hist }).direction, 'C');
  // A wide option that repeats a recent motif loses to a new-motif option.
  const roadHist = [sig('A', 'A road through fields.', { distance: 'wide', angle: 'high', lead: 'landscape' }), ...recent];
  // (the last two are still not wide)
  const c = chooseLook({ options: [narrow[0], opt('A', 'An empty road into the hills.', { distance: 'wide', angle: 'low', figures: 'several', lead: 'landscape', figure: 'two walkers' })], recent: roadHist });
  assert.equal(c.direction, 'C');
});

test('a motif of the last three is not repeated while a comparable option has a new one', () => {
  const recent = [sig('C', 'A full moon over still water.', { distance: 'wide', lead: 'symbol' }), sig('D', 'A coat on a chair.', { distance: 'close', space: 'interior' })];
  const options = [
    opt('C', 'A thin crescent moon caught between two leafless branches.', { distance: 'medium', angle: 'low', lead: 'symbol' }),
    opt('E', 'A doorway at night, light spilling across the step.', { distance: 'medium', space: 'interior', lead: 'space' }),
  ];
  const l = chooseLook({ options, recent });
  assert.equal(l.direction, 'E');
  assert.match(l.reason, /repeat a recent painting or its motifs/);
  assert.deepEqual(l.considered[0].repeatedMotifs, ['celestial']);
  assert.match(direct({ completeness: 'resolved', family: 'R3-vivid-wash-focal', reference: 'resolved_02', seed: 7, motif: 'abstract', emotion: 'melancholic', energy: { value: 'lively' }, concept: { source: 'lyrics', text: options[0].image, theme: [], imagery: [], figurative: [], scene: { situation: 's', relationship: 'r', tension: 't', moment: options[0].image, figure: '', event: 'e', core: 'c', options } }, recentLooks: recent }).sections.scene,
    /Motifs of the last few Resolved paintings \(celestial\) are not repeated here\./);
  // Older than the last three: the moon is free again.
  const later = chooseLook({ options, recent: [recent[0], ...['x', 'y', 'z'].map((t) => NEAR(t, { angle: 'high' }))] });
  assert.equal(later.direction, 'C');
});

test('when the words demand a repeated motif it is painted, and the override is reported', () => {
  const recent = [sig('C', 'A full moon over still water.', { distance: 'wide', lead: 'symbol' })];
  const moon = opt('C', 'The moon itself splitting in two over the sea.', { distance: 'wide', angle: 'low', lead: 'symbol', necessary: true });
  const l = chooseLook({ options: [moon, opt('E', 'A doorway at night.', { space: 'interior', lead: 'space' })], recent });
  assert.equal(l.direction, 'C');
  assert.match(l.reason, /the words demand this image, though the recent paintings already used celestial/);
  assert.deepEqual(l.diversity.repeatedMotifs, ['celestial']);
  assert.match(l.diversity.override, /words demand/);
});

test('a run of songs: a wide scene in every three, no motif repeated in three, and still a balanced mix', () => {
  // Each song's reading, strongest first, as the new reading would give it:
  // often a near or symbolic image first, always one wide option somewhere.
  const songs = [
    [opt('B', 'Hands letting go across a table.', { distance: 'close', figures: 'one', space: 'interior', lead: 'person', figure: 'two hands' }), opt('A', 'A pier at dusk, two figures at its ends.', { distance: 'wide', figures: 'several', lead: 'landscape', figure: 'two figures' }), opt('D', 'A ring left on a windowsill.', { distance: 'close', space: 'interior' })],
    [opt('C', 'A moon cracked like porcelain.', { distance: 'close', lead: 'symbol' }), opt('E', 'An empty station hall, one bench lit.', { distance: 'wide', space: 'interior', lead: 'space' }), opt('D', 'A bus ticket in a puddle.', { distance: 'close', angle: 'high' })],
    [opt('D', 'An umbrella left open on a doorstep in the rain.', { distance: 'close', angle: 'low' }), opt('A', 'A coast road in rain, headlights fading into the hills.', { distance: 'wide', angle: 'high', lead: 'landscape' }), opt('B', 'A face pressed to a fogged window, eyes closed.', { distance: 'close', figures: 'one', space: 'interior', lead: 'person', figure: 'a woman' })],
    [opt('C', 'A paper boat drifting toward a lit house.', { distance: 'medium', angle: 'high', lead: 'symbol' }), opt('A', 'A river valley seen from above, two banks apart.', { distance: 'wide', angle: 'birds_eye', lead: 'landscape' }), opt('E', 'A corridor of closed doors.', { space: 'interior', lead: 'space', angle: 'low' })],
    [opt('B', 'A man on a bench, head bowed, a letter folded in his hands.', { distance: 'medium', figures: 'one', lead: 'person', figure: 'a man' }), opt('C', 'A clock stopped at midnight on a cracked wall.', { distance: 'close', lead: 'symbol', space: 'interior' }), opt('A', 'A snowfield with one line of footprints to a far tree.', { distance: 'wide', lead: 'landscape' })],
    [opt('C', 'A heart-shaped kite caught in a tree.', { distance: 'medium', lead: 'symbol', angle: 'low' }), opt('D', 'Two chairs facing apart in an empty room.', { space: 'interior', angle: 'high' }), opt('A', 'A crowd parting in a square, one gap left open.', { distance: 'wide', angle: 'high', figures: 'many', lead: 'space', figure: 'a crowd' })],
    [opt('E', 'A window over a night street, curtain lifted.', { space: 'interior', lead: 'space' }), opt('B', 'A girl holding a cracked cup close.', { distance: 'close', figures: 'one', space: 'interior', lead: 'person', figure: 'a girl' }), opt('A', 'A mountain road switchbacking into cloud.', { distance: 'wide', angle: 'low', lead: 'landscape' })],
    [opt('D', 'Burnt candles on a sill at dawn.', { distance: 'close', space: 'interior' }), opt('C', 'A bird cage open on a balcony.', { distance: 'medium', lead: 'symbol' }), opt('A', 'A field of reeds to the sea, a path cut through them.', { distance: 'wide', lead: 'landscape' })],
    [opt('B', 'Two shadows touching on a wall.', { distance: 'close', lead: 'symbol', space: 'interior' }), opt('E', 'A great empty theatre hall, one seat folded down.', { distance: 'wide', space: 'interior', lead: 'space', angle: 'high' }), opt('D', 'A torn ribbon on a gate.', { distance: 'close' })],
  ];
  let recent = [];
  const picks = [];
  for (const [i, options] of songs.entries()) {
    const l = chooseLook({ options, recent, seed: i });
    assert.ok(options.some((o) => o.image === l.image), 'only the reading\'s own options');
    picks.push(l);
    recent = [...recent, signatureOf(l)].slice(-RECENT_LOOKS);
  }
  for (let i = 2; i < picks.length; i++) {
    const w = picks.slice(i - 2, i + 1);
    assert.ok(w.some((p) => p.scale === 'wide_scenic'), `paintings ${i - 1}–${i + 1}: ${w.map((p) => p.scale)}`);
    const tags = w.flatMap((p) => p.motifs);
    assert.equal(new Set(tags).size, tags.length, `paintings ${i - 1}–${i + 1} repeat a motif: ${tags}`);
  }
  // Not one default replaced by another: wide is not every painting, and the
  // directions and scales vary.
  const wide = picks.filter((p) => p.scale === 'wide_scenic').length;
  assert.ok(wide >= 3 && wide < picks.length - 2, `${wide} of ${picks.length} wide`);
  assert.ok(new Set(picks.map((p) => p.direction)).size >= 4, picks.map((p) => p.direction).join(''));
  assert.ok(new Set(picks.map((p) => p.scale)).size >= 3, picks.map((p) => p.scale).join(', '));
  assert.ok(picks.filter((p) => p.rank === 0).length >= 3, 'the strongest option still wins often');
});

test('the prompt names a wide scenic composition only when the chosen look is one', () => {
  const options = [opt('A', 'A long valley road at dusk, one lit house at its far end.', { distance: 'wide', angle: 'high', lead: 'landscape' }), opt('C', 'A cracked mirror.', { distance: 'close', lead: 'symbol' })];
  const concept = { source: 'lyrics', text: options[0].image, theme: [], imagery: [], figurative: [], scene: { situation: 's', relationship: 'r', tension: 't', moment: options[0].image, figure: '', event: 'e', core: 'c', options } };
  const paint = (o) => direct({ completeness: 'resolved', family: 'R3-vivid-wash-focal', reference: 'resolved_02', seed: 7, motif: 'abstract', emotion: 'melancholic', energy: { value: 'lively' }, concept, ...o });
  const wide = paint({});
  assert.ok(wide.sections.scene.includes(WIDE_SCENE));
  assert.equal(wide.resolvedLook.diversity.scale, 'wide_scenic');
  const near = paint({ concept: { ...concept, scene: { ...concept.scene, options: [options[1]] } } });
  assert.ok(!near.sections.scene.includes(WIDE_SCENE));
  for (const completeness of ['loose', 'gathered']) {
    const d = paint({ completeness, family: undefined, reference: undefined });
    assert.equal(d.level, completeness);
    assert.ok(!d.prompt.includes(WIDE_SCENE), completeness);
    assert.equal(d.resolvedLook.applied, false);
  }
  // Without options, a wide viewpoint when one is owed.
  const owed = paint({ concept: null, recentLooks: [NEAR('a'), NEAR('b', { angle: 'high' })] });
  assert.equal(owed.resolvedLook.signature.distance, 'wide');
  assert.match(owed.resolvedLook.reason, /a wide viewpoint/);
});

test('the reading asks for motifs and one wide option; the server stores scale and motifs, never words', async () => {
  assert.match(SYSTEM, /Include at least one grand, wide scenic composition/);
  assert.match(SYSTEM, /not necessarily a lone figure/);
  assert.match(SYSTEM, /- motifs: one to three short nouns naming the image's key motifs/);
  const r = cleanReading({ scene: { options: [{ direction: 'C', image: 'A moon in a well.', distance: 'close', angle: 'high', figures: 'none', space: 'exterior', lead: 'symbol', figure: '', motifs: ['moon', 'well'], necessary: false }] } });
  assert.deepEqual(r.scene.options[0].motifs, ['celestial', 'well']);
  const kv = memoryKV();
  await rememberLook(kv, 'install-1', { ...signatureOf(r.scene.options[0]), image: 'never stored' });
  const [h] = await recentLooks(kv, 'install-1');
  assert.equal(h.scale, 'close_detail');
  assert.deepEqual(h.motifs, ['celestial', 'well']);
  assert.ok(!JSON.stringify(h).includes('never stored'));
});

// Han, 19 Oct: Resolved does not default to one kind of image (a lone person
// in a wide landscape). The reading proposes several visual directions for
// the song's emotional event, strongest first (A scenic, B intimate,
// C symbolic, D aftermath, E spatial, F invented); the strongest one that
// the person's last five Resolved paintings did not already use is painted.
// No paid call: readings are GIVEN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sungLyrics, SR } from './synth.js';
import { measurePerformance } from '../../src/engine/analysis/performance-measure.js';
import { cleanReading, SYSTEM } from '../../src/engine/providers/openai-understand.js';
import { direct, checkPrompt, CONTENT_RULE_FIGURE_NEAR, AVOID_PEOPLE_FIGURE_NEAR, FIGURE_RULE_NEAR, FIGURE_RULE_MANY, CONTENT_RULE } from '../../src/engine/direct/index.js';
import { chooseLook, cleanOptions, isLoneFigureLandscape, isNearDuplicate, repetition, RESOLVED_VARIETY, VIEWPOINTS, RECENT_LOOKS, signatureOf } from '../../src/engine/direct/looks.js';
import { cleanConcept, recentLooks, rememberLook } from '../../api/generate.js';
import { memoryKV } from '../../server/protect/kv.js';

const opt = (direction, image, o = {}) => ({ direction, image, distance: 'medium', angle: 'eye_level', figures: 'none', space: 'exterior', lead: 'object', figure: '', ...o });
const LONE = (image = 'A lone figure stands on a wide shore at dusk, facing the sea.') => opt('A', image, { distance: 'wide', figures: 'one', lead: 'landscape', figure: 'one small, distant figure facing the sea' });
// 修炼爱情的辛酸 / 我们这些故事不难忘: the habit was the lone figure first.
const OPTIONS = [
  LONE(),
  opt('D', 'Two coffee cups left on a café table by the window, one still full and cold, a chair pushed back.', { distance: 'close', angle: 'high', space: 'interior', lead: 'object' }),
  opt('C', 'A red thread stretched between two folded letters, fraying thin at its middle where the light falls.', { distance: 'close', lead: 'symbol' }),
  opt('B', 'Two hands about to let go across a small table, fingertips still touching, a ring set down beside them.', { distance: 'close', figures: 'one', space: 'interior', lead: 'person', figure: 'the hands of two people, seen near, letting go' }),
];
const SCENE = { situation: 'Love learned through hardship, a story that cannot be forgotten.', relationship: 'Two people bound by memories they cannot leave.', tension: 'Holding on to what has already ended.', moment: OPTIONS[0].image, figure: '', event: 'A bond that has ended keeps holding.', core: 'something shared that frays but does not break', options: OPTIONS };
const CONCEPT = { source: 'lyrics', text: OPTIONS[0].image, theme: ['love learned through hardship'], imagery: [], figurative: [], scene: SCENE };
const perf = measurePerformance(sungLyrics(), SR);
const paint = (o = {}) => direct({ completeness: 'resolved', family: 'R3-vivid-wash-focal', reference: 'resolved_02', seed: 7, motif: 'abstract', emotion: 'melancholic', energy: { value: 'lively' }, concept: CONCEPT, performance: perf, ...o });

test('the reading asks for the emotional event and several directions, the lone figure never the default', () => {
  assert.match(SYSTEM, /- event: the emotional event in these words/);
  assert.match(SYSTEM, /- core: the symbolic core/);
  assert.match(SYSTEM, /what is the emotional event here, what is the strongest image for it, and if I do not draw the most literal scene, what image would best embody the feeling\?/);
  for (const d of ['A, expansive scenic narrative', 'B, intimate near view', 'C, symbolic image', 'D, trace or aftermath', 'E, interior or spatial scene', 'F, free invention']) assert.ok(SYSTEM.includes(`- ${d}`), d);
  assert.match(SYSTEM, /Nothing readable: no words, letters, writing, numbers or signs in the picture, even as a symbol/); // PR #29 review: creative options keep the no-text rule
  assert.match(SYSTEM, /A lone figure standing in a vast landscape, one small figure in the middle distance, a horizon-led view or a figure facing away into scenery is one case of A, never the default/);
  assert.match(SYSTEM, /options, never templates; use at least three different directions/);
  assert.match(SYSTEM, /Vary these between options/);
  // Han's review: an expressive portrait and any number of people are possible, never the default.
  assert.match(SYSTEM, /In a Resolved near view the face may be shown, with its eyes, tears and expression, when the words call for an expressive close or medium portrait/);
  assert.match(SYSTEM, /a portrait is never the default, and never a person the words do not justify/);
  assert.match(SYSTEM, /figures: none, one, several or many\./);
  assert.match(SYSTEM, /one, several or many \(a crowd only when the words call for one\)/);
  assert.match(SYSTEM, /- necessary: true only when the words genuinely demand this exact image/);
  assert.doesNotMatch(SYSTEM, /at most a few/);
  const r = cleanReading({ lexical: true, coherent: true, scene: { ...SCENE, options: [...OPTIONS, opt('Z', 'bad'), opt('C', 'A close-up of a cracked mirror.'), { direction: 'E' }] } });
  assert.equal(r.scene.event, SCENE.event);
  assert.equal(r.scene.core, SCENE.core);
  assert.equal(r.scene.options.length, 4, 'invalid options dropped, at most four kept');
  assert.equal(cleanOptions([opt('C', 'A close-up of a cracked mirror on the floor.')])[0].image, 'A near view of a cracked mirror on the floor.');
  // The concept keeps the options on the way to /api/generate.
  assert.equal(cleanConcept(CONCEPT).scene.options.length, 4);
});

test('the strongest direction wins with no history; a repeat of recent paintings gives way', () => {
  const first = chooseLook({ options: OPTIONS });
  assert.equal(first.direction, 'A');
  assert.equal(first.rank, 0);
  // The lone figure was just painted: the next strongest is chosen instead.
  const after = chooseLook({ options: OPTIONS, recent: [signatureOf(LONE())] });
  assert.equal(after.direction, 'D');
  assert.match(after.reason, /nearly duplicate recent Resolved paintings/);
  // A strong option that only shares a little with the last painting still wins: no cycling.
  const partly = chooseLook({ options: OPTIONS, recent: [signatureOf(opt('E', 'x', { distance: 'wide', lead: 'landscape' }))] });
  assert.equal(partly.direction, 'A');
  // Any lone figure in a landscape among the last five makes another one costly.
  const old = [signatureOf(LONE()), ...['C', 'D', 'B', 'E'].map((d) => signatureOf(opt(d, 'x', { distance: 'close' })))];
  assert.ok(isLoneFigureLandscape(LONE()));
  assert.ok(repetition(LONE(), old) >= 1.5);
  assert.notEqual(chooseLook({ options: [LONE(), opt('E', 'A doorway left ajar onto a dark corridor.', { space: 'interior', lead: 'space', angle: 'low' })], recent: old }).direction, 'A');
});

test('five songs in a row: no single default, varied distance, view and translation', () => {
  // Every reading puts a lone figure in a landscape first, as the old prompts did.
  const songs = [
    [LONE(), opt('C', 'A paper boat folding in on itself in a basin of rain.', { distance: 'close', angle: 'high', lead: 'symbol' }), opt('E', 'A window at night, its curtain caught in the door.', { space: 'interior', lead: 'space', angle: 'low' })],
    [LONE('One figure walks a long beach road into fog.'), opt('D', 'Footprints in snow that stop at a bench.', { distance: 'close', angle: 'high', lead: 'object' }), opt('B', 'A coat held close against a chest, buttons undone.', { distance: 'close', figures: 'one', lead: 'person', figure: 'a person seen near, turned away' })],
    [LONE('A small figure on a hill watching a train leave.'), opt('E', 'An empty station corridor, one door still swinging.', { space: 'interior', lead: 'space', angle: 'low', distance: 'wide' }), opt('C', 'A lamp whose flame splits in two.', { distance: 'close', lead: 'symbol' })],
    [LONE('One person at the edge of a field under storm clouds.'), opt('A', 'Three small figures crossing a bridge in different directions.', { distance: 'wide', angle: 'birds_eye', figures: 'several', lead: 'landscape', figure: 'three small, distant figures walking apart' }), opt('D', 'A torn letter on a stair.', { distance: 'close', lead: 'object', space: 'interior' })],
    [LONE('A figure on a pier, back turned, looking at the horizon.'), opt('B', 'Hands holding a cracked cup.', { distance: 'close', figures: 'one', lead: 'person', space: 'interior', figure: 'a person\'s hands, seen near' }), opt('F', 'A kite string tied to an empty chair on a roof.', { angle: 'low', lead: 'object' })],
  ];
  let recent = [];
  const chosen = songs.map((options, i) => {
    const l = chooseLook({ options, recent, seed: i });
    recent = [...recent, signatureOf(l)].slice(-RECENT_LOOKS);
    return l;
  });
  assert.ok(chosen.filter(isLoneFigureLandscape).length <= 1, chosen.map((l) => l.direction).join());
  assert.ok(new Set(chosen.map((l) => l.direction)).size >= 3);
  assert.ok(new Set(chosen.map((l) => l.distance)).size >= 2);
  assert.ok(new Set(chosen.map((l) => `${l.space}/${l.lead}`)).size >= 3);
});

test('the Resolved prompt paints the chosen direction, says it is one of several, and stays tied to the words', () => {
  const d = paint();
  assert.equal(d.resolvedLook.applied, true);
  assert.equal(d.resolvedLook.signature.direction, 'A');
  assert.match(d.sections.scene, /Visual direction, chosen for this song from several possible ones: an expansive scenic narrative\./);
  assert.ok(d.sections.scene.includes(RESOLVED_VARIETY));
  assert.match(d.sections.scene, /symbolic event or emotionally readable moment/);
  assert.match(d.sections.scene, /more narratively or symbolically meaningful than a semi-abstract study, not only more finished/);
  assert.equal(checkPrompt(d).verdict, 'ok', JSON.stringify(checkPrompt(d)));
  // After a lone figure, the same song is painted another way, and the prompt says so.
  const next = paint({ recentLooks: [signatureOf(LONE())] });
  assert.equal(next.resolvedLook.signature.direction, 'D');
  assert.match(next.sections.subject, /of: Two coffee cups left on a café table/);
  assert.match(next.sections.narrative, /Paint this scene: Two coffee cups left on a café table/);
  assert.match(next.sections.scene, /View: a close view from a high angle; no figure; interior; object-led\./);
  assert.match(next.sections.scene, /Recent Resolved paintings for this person were an expansive scenic narrative, wide view, at eye level, one figure, exterior, landscape-led: this one must read clearly different/);
  assert.equal(next.sections.content, CONTENT_RULE);
  assert.equal(checkPrompt(next).verdict, 'ok', JSON.stringify(checkPrompt(next)));
  // Without a measured performance too.
  const plain = paint({ performance: null, recentLooks: [signatureOf(LONE())] });
  assert.equal(plain.resolvedLook.signature.direction, 'D');
  assert.match(plain.prompt, /Visual direction, chosen for this song/);
});

test('Resolved near view: an expressive portrait with face, eyes and tears when the words warrant it', () => {
  const d = paint({ concept: { ...CONCEPT, scene: { ...SCENE, options: [OPTIONS[3], OPTIONS[2]] } } });
  assert.equal(d.resolvedLook.signature.direction, 'B');
  assert.equal(d.narrative.figure, 'the hands of two people, seen near, letting go');
  assert.equal(d.narrative.near, true);
  assert.ok(d.sections.narrative.includes(FIGURE_RULE_NEAR));
  assert.equal(d.sections.content, CONTENT_RULE_FIGURE_NEAR);
  assert.ok(d.avoid.includes(AVOID_PEOPLE_FIGURE_NEAR));
  assert.equal(checkPrompt(d).verdict, 'ok', JSON.stringify(checkPrompt(d)));
  // A crying person, close (Han's review): painted, face and tears included.
  const crying = opt('B', 'A close portrait of a young woman crying at a rain-dark window, tears on her face, her eyes on a phone that does not ring.', { distance: 'close', figures: 'one', lead: 'person', space: 'interior', figure: 'a young woman crying, her face and tears seen near' });
  const c = paint({ concept: { ...CONCEPT, scene: { ...SCENE, options: [crying, OPTIONS[2]] } } });
  assert.equal(c.resolvedLook.signature.direction, 'B');
  assert.match(c.sections.narrative, /Paint this scene: A close portrait of a young woman crying/);
  assert.match(c.sections.narrative, /Figure: a young woman crying, her face and tears seen near\./);
  assert.match(FIGURE_RULE_NEAR, /the face, eyes, tears and expression may show/);
  assert.equal(checkPrompt(c).verdict, 'ok', JSON.stringify(checkPrompt(c)));
  // A middle-distance, person-led portrait is a near view too.
  const medium = paint({ concept: { ...CONCEPT, scene: { ...SCENE, options: [{ ...crying, distance: 'medium' }] } } });
  assert.equal(medium.narrative.near, true);
  // Far figures stay small and faceless: a face in a wide scene is not painted, the next option is.
  const far = opt('A', 'A wide shore where her face turns back toward the town.', { distance: 'wide', figures: 'one', lead: 'landscape', figure: 'her face, turned back' });
  const f = paint({ concept: { ...CONCEPT, scene: { ...SCENE, options: [far, OPTIONS[2]] } } });
  assert.equal(f.resolvedLook.signature.direction, 'C');
  assert.equal(f.resolvedLook.unusable[0].direction, 'A');
  // People the option does not name are never painted.
  const unnamed = paint({ concept: { ...CONCEPT, scene: { ...SCENE, options: [opt('D', 'A woman\'s coat left on a chair.', { distance: 'close', lead: 'object' }), OPTIONS[2]] } } });
  assert.equal(unnamed.resolvedLook.unusable[0].direction, 'D');
  // Loose and Gathered keep no people at all (checked below).
});

test('Resolved may paint many people when the words call for a crowd', () => {
  const crowd = opt('A', 'A crowded station concourse seen from above, everyone hurrying one way and one umbrella still against the flow.', { distance: 'wide', angle: 'birds_eye', figures: 'many', lead: 'landscape', space: 'interior', figure: 'a crowd of commuters hurrying one way, one person standing still' });
  const d = paint({ concept: { ...CONCEPT, scene: { ...SCENE, options: [crowd, OPTIONS[2]] } } });
  assert.equal(d.resolvedLook.signature.figures, 'many');
  assert.match(d.sections.narrative, /Figure: a crowd of commuters hurrying one way, one person standing still\./);
  assert.ok(d.sections.narrative.includes(FIGURE_RULE_MANY));
  assert.match(d.sections.scene, /many people/);
  assert.equal(checkPrompt(d).verdict, 'ok', JSON.stringify(checkPrompt(d)));
});

test('a near-duplicate of the last five is not chosen while a comparable option is new', () => {
  // The rank-1 option repeats the oldest of the last five exactly; with only a
  // soft cost it would still win against a distinct but partly overlapping
  // rank-2 option (0 + 0.4 × 1.5 = 0.6 < 1 + its own small overlap).
  const top = opt('A', 'A long empty road under rain clouds.', { distance: 'wide', lead: 'landscape' });
  const second = opt('E', 'A hallway with one door ajar.', { distance: 'wide', lead: 'space', space: 'interior' });
  const recent = [signatureOf(top), ...['B', 'C', 'D', 'F'].map((d) => signatureOf(opt(d, 'x', { distance: 'close', angle: 'high', figures: 'one', space: 'interior', lead: 'person', figure: 'f' })))];
  assert.ok(isNearDuplicate(top, recent[0]));
  assert.ok(!isNearDuplicate(second, recent[0]));
  const soft = repetition(top, recent) * 1.5;
  assert.ok(soft < 1, 'the soft cost alone would keep the duplicate');
  const l = chooseLook({ options: [top, second], recent });
  assert.equal(l.direction, 'E');
  assert.match(l.reason, /nearly duplicate recent Resolved paintings/);
  assert.equal(l.considered[0].duplicate, true);
  // Nearly the same counts too: only the angle differs.
  assert.ok(isNearDuplicate({ ...top, angle: 'low' }, recent[0]));
  // The words may genuinely demand that image.
  assert.equal(chooseLook({ options: [{ ...top, necessary: true }, second], recent }).direction, 'A');
  // With no comparable new option, the least repetitive one is still painted.
  const only = chooseLook({ options: [top], recent });
  assert.equal(only.direction, 'A');
  assert.match(only.reason, /every comparable option repeats a recent Resolved painting/);
  // An option far down the ranking is not comparable: rank 4 does not displace a near-duplicate rank 1.
  // (One of the last two is wide here, so the rolling-three wide rule, which
  // may reach further down, does not apply: resolved-rolling.test.mjs.)
  const wideLast = [...recent.slice(0, 3), signatureOf(opt('F', 'x', { distance: 'wide', angle: 'low', figures: 'several', space: 'interior', lead: 'space', figure: 'f' }))];
  const far = chooseLook({ options: [top, { ...top, image: 'b' }, { ...top, image: 'c' }, second], recent: wideLast });
  assert.equal(far.direction, 'A');
});

test('without direction options (no words, or an older reading) only the viewpoint varies', () => {
  const none = paint({ concept: null, motif: 'water' });
  assert.equal(none.resolvedLook.source, 'viewpoint');
  assert.match(none.sections.scene, /Viewpoint: /);
  const after = paint({ concept: null, motif: 'water', recentLooks: [signatureOf(none.resolvedLook.signature)] });
  assert.notDeepEqual([after.resolvedLook.signature.distance, after.resolvedLook.signature.angle], [none.resolvedLook.signature.distance, none.resolvedLook.signature.angle]);
  assert.equal(VIEWPOINTS.length, 5);
  const older = paint({ concept: { ...CONCEPT, scene: { ...SCENE, moment: OPTIONS[1].image, options: [] } } });
  assert.equal(older.resolvedLook.source, 'viewpoint');
  assert.match(older.sections.narrative, /Paint this scene: Two coffee cups left on a café table/);
});

test('Loose and Gathered take no visual direction', () => {
  for (const [completeness, family, reference] of [['gathered', 'G2-splash-wash', 'gathered_02'], ['loose', 'L2-bloom-field', 'loose_02']]) {
    const d = direct({ completeness, family, reference, seed: 7, motif: 'abstract', emotion: 'melancholic', energy: { value: 'lively' }, concept: CONCEPT, performance: perf, recentLooks: [signatureOf(LONE())] });
    assert.deepEqual(d.resolvedLook, { applied: false, reason: `tier ${completeness}` });
    assert.doesNotMatch(d.prompt, /Visual direction|Viewpoint:/);
  }
});

test('the server remembers only the last five looks, as signatures', async () => {
  const kv = memoryKV();
  for (let i = 0; i < 7; i++) await rememberLook(kv, 'install-1', { ...signatureOf(OPTIONS[i % 4]), image: 'never stored' });
  const h = await recentLooks(kv, 'install-1');
  assert.equal(h.length, RECENT_LOOKS);
  assert.ok(h.every((x) => !('image' in x)));
  assert.deepEqual(await recentLooks(kv, 'install-2'), []);
  assert.deepEqual(await recentLooks(null, 'install-1'), []);
});

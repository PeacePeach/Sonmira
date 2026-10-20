// Before/after Resolved prompts for one song, and a five-song sequence.
// No paid call: the readings are written by hand as the new reading would return them.
// Usage: node compare.mjs <before-repo> <after-repo>
import { pathToFileURL } from 'node:url';
const [beforeRoot, afterRoot] = process.argv.slice(2);
const load = async (root, p) => import(pathToFileURL(`${root}/${p}`).href);
const B = await load(beforeRoot, 'src/engine/direct/index.js');
const A = await load(afterRoot, 'src/engine/direct/index.js');
const L = await load(afterRoot, 'src/engine/direct/looks.js');
const opt = (direction, image, o = {}) => ({ direction, image, distance: 'medium', angle: 'eye_level', figures: 'none', space: 'exterior', lead: 'object', figure: '', ...o });
const lone = (image) => opt('A', image, { distance: 'wide', figures: 'one', lead: 'landscape', figure: 'one small, distant figure' });
const songs = [
  { name: '修炼爱情的辛酸 / 我们这些故事不难忘', event: 'A bond that has ended keeps holding.', options: [
    lone('A lone figure stands on a wide shore at dusk, facing the sea where two sets of tracks once ran together.'),
    opt('D', 'Two coffee cups left on a café table by the rain-streaked window, one still full and cold, a chair pushed back.', { distance: 'close', angle: 'high', space: 'interior', lead: 'object' }),
    opt('C', 'A red thread stretched between two folded letters, fraying thin at its middle where the light falls.', { distance: 'close', lead: 'symbol' }),
    opt('B', 'Two hands about to let go across a small table, fingertips still touching, a ring set down beside them.', { distance: 'close', figures: 'one', space: 'interior', lead: 'person', figure: 'the hands of two people, seen near, letting go' })] },
  { name: 'Clouds drift over the sea and carry me home', event: 'Longing to return.', options: [
    lone('One small figure on a cliff path watching clouds sail out over the sea toward a distant coast.'),
    opt('E', 'A window left open on a stair landing, its curtain lifted toward a sea of clouds outside.', { space: 'interior', lead: 'space', angle: 'low' }),
    opt('C', 'A paper boat riding a stream of clouds that bends toward one lit house.', { distance: 'medium', angle: 'high', lead: 'symbol' })] },
  { name: 'I waited at the station, you never came', event: 'Waiting that is not answered.', options: [
    lone('A small figure on an empty platform under a long roof, the track running off to the horizon.'),
    opt('D', 'A bench on a platform, one umbrella leaning on it, a dry rectangle on the rain-wet seat.', { distance: 'close', angle: 'low', lead: 'object' }),
    opt('E', 'A station corridor seen from above, one door half open, its light falling across the empty floor.', { space: 'interior', lead: 'space', angle: 'birds_eye', distance: 'wide' })] },
  { name: 'Your letter burned but the words remain', event: 'Something destroyed that still speaks.', options: [
    lone('A figure in a field watching smoke drift from a small fire.'),
    opt('C', 'Sparks lifting from a charred page and hanging in the dark like embers, the page itself still glowing at its edges.', { distance: 'close', lead: 'symbol', angle: 'low' }),
    opt('D', 'A burnt envelope in a stone sink, its edges curling, a corner of the paper left unburnt.', { distance: 'close', angle: 'high', space: 'interior', lead: 'object' })] },
  { name: 'We walked our separate ways at the river', event: 'A parting that both accept.', options: [
    lone('One figure on a riverbank watching another walk away across a bridge.'),
    opt('A', 'Two small figures seen from high above, walking away from each other on opposite banks of a winding river.', { distance: 'wide', angle: 'birds_eye', figures: 'several', lead: 'landscape', figure: 'two small, distant figures walking apart' }),
    opt('D', 'Two pairs of footprints on a muddy bank that turn away from each other at the water.', { distance: 'close', angle: 'high', lead: 'object' })] },
];
const perf = null;
const base = { completeness: 'resolved', family: 'R3-vivid-wash-focal', reference: 'resolved_02', seed: 7, motif: 'abstract', emotion: 'melancholic', energy: { value: 'calm' }, performance: perf };
const concept = (s) => ({ source: 'lyrics', text: s.options[0].image, theme: [], imagery: [], figurative: [],
  scene: { situation: '', relationship: '', tension: '', moment: s.options[0].image, figure: s.options[0].figure, event: s.event, core: '', options: s.options } });
const out = [];
const one = songs[0];
out.push('# 修炼爱情的辛酸: Resolved prompt, before and after', '', '## Before (the reading\'s single scene)', '```', B.direct({ ...base, concept: concept(one) }).prompt, '```', '');
out.push('## After: first Resolved painting for this person (no history)', '```', A.direct({ ...base, concept: concept(one) }).prompt, '```', '');
const lonePrev = L.signatureOf(lone('x'));
out.push('## After: the previous Resolved painting was a lone figure in a landscape', '```', A.direct({ ...base, concept: concept(one), recentLooks: [lonePrev] }).prompt, '```', '');
out.push('# Five songs in a row (each reading puts a lone figure first, as before)', '', '| Song | Before | After: chosen direction | View | Why |', '|---|---|---|---|---|');
let recent = [];
for (const s of songs) {
  const d = A.direct({ ...base, concept: concept(s), recentLooks: recent });
  const sig = d.resolvedLook.signature;
  out.push(`| ${s.name} | A, lone figure in a wide landscape | ${sig.direction}: ${L.DIRECTIONS[sig.direction]} | ${sig.distance}, ${sig.angle}, ${sig.figures} figure(s), ${sig.space}, ${sig.lead}-led | ${d.resolvedLook.reason} |`);
  recent = [...recent, sig].slice(-5);
}
const crying = { name: 'I keep my tears until you are gone', event: 'Grief held back until it can no longer be.', options: [
  opt('B', 'A close portrait of a young woman at a rain-dark window, tears finally running, her hand pressed to her mouth.', { distance: 'close', figures: 'one', lead: 'person', space: 'interior', figure: 'a young woman crying, her face and tears seen near' }),
  opt('D', 'A door just closed, a wet coat hook still swinging beside it.', { distance: 'close', lead: 'object', space: 'interior' }),
  opt('E', 'A narrow hallway seen from its far end, one light left on.', { space: 'interior', lead: 'space', angle: 'low' })] };
out.push('', '# Expressive portrait (Resolved near view, review of PR #29)', '```', A.direct({ ...base, concept: concept(crying) }).prompt, '```');
const crowd = { name: 'Everyone is leaving and I stay', event: 'Standing still while the world moves on.', options: [
  opt('A', 'A crowded station concourse seen from above, everyone hurrying one way and one umbrella still against the flow.', { distance: 'wide', angle: 'birds_eye', figures: 'many', lead: 'landscape', space: 'interior', figure: 'a crowd of commuters hurrying one way, one person standing still' }),
  opt('C', 'A single stopped clock among many turning ones.', { distance: 'medium', lead: 'symbol' })] };
out.push('', '# Many people (review of PR #29)', '```', A.direct({ ...base, concept: concept(crowd) }).prompt, '```');
console.log(out.join('\n'));

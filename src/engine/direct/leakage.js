// Reference-object leakage check: does a painting (or the prompt that asks
// for it) depict things that came from the style reference rather than from
// the words?
//
//   checkLeakage({ depicted, concept, note, reference, family, library })
//     → { verdict: 'ok' | 'review' | 'leak', people, leaks, unrequested,
//         inventory, from }
//
// `depicted` is a description of what is in the picture: a caption or list
// written by a reviewer or a vision model, or a prompt (to check our own
// text). Negated mentions ("no people", "never a figure", the Avoid line)
// are ignored. Each term below is a kind of thing references show; a
// reference's `content` (references.js, curated) lists the terms it depicts.
//
//   people       any person, figure or face: never allowed, whatever the
//                words say (Sonmira paints no people)
//   leaks        a term the reference depicts that is in the picture but not
//                in the lyrics, their imagery or the note
//   unrequested  any other term in the picture that the words do not name
//                (invented narrative, not traced to this reference)
//
// Matching is by word, so it catches obvious leakage, not every paraphrase.

import { LIBRARY } from './library.js';

const w = (s) => new RegExp(`\\b(?:${s})\\b`, 'i');

export const PEOPLE = w('people|persons?|humans?|human figures?|figures?|silhouettes? of (?:a )?(?:person|man|woman|child)|man|men|woman|women|girls?|boys?|child|children|kids?|bab(?:y|ies)|couples?|lovers?|walkers?|swimmers?|bathers?|surfers?|skiers?|skaters?|fisherm[ae]n|rowers?|sailors?|dancers?|brides?|crowds?|faces?|someone|mother|father|friends?|pedestrians?|cyclists?|strollers?|passers-by');

export const TERMS = {
  person: PEOPLE,
  animal: w('animals?|dogs?|cats?|birds?|gulls?|herons?|sharks?|fish|koi|horses?|deer|fox(?:es)?|rabbits?|whales?|dolphins?'),
  boat: w('boats?|rowboats?|row-boats?|sailboats?|sailing boats?|sails?|canoes?|kayaks?|ships?|yachts?|dinghy|dinghies|vessels?|gondolas?|ferry|ferries'),
  rope: w('ropes?|moorings?|mooring lines?|tethers?'),
  buoy: w('buoys?|floats?'),
  dock: w('piers?|jetty|jetties|docks?|boardwalks?|wharf|wharves|landing stage'),
  fir: w('firs?|fir trees?|pines?|pine trees?|conifers?|spruces?|evergreens?'),
  tree: w('trees?|forests?|woods|branches'),
  house: w('houses?|cottages?|cabins?|huts?|barns?|villages?|roofs?|chalets?'),
  building: w('buildings?|towers?|skyscrapers?|church(?:es)?|domes?|temples?|gates?|city|cities|skyline|streets?'),
  car: w('cars?|vehicles?|windscreens?|windshields?|traffic|trucks?|bus(?:es)?'),
  lamp: w('lamps?|lampposts?|street ?lights?|lanterns?'),
  cafe: w('caf[eé]s?|tables?|chairs?|awnings?|bunting'),
  waterfall: w('waterfalls?|cascades?'),
  island: w('islands?|islets?|isles?|headlands?'),
  snow: w('snow|snowy|ski|skiing|ski slopes?'),
  wave: w('waves?|surf|breakers?'),
  beach: w('beach(?:es)?|shoreline|tide ?line|sandy shore'),
  dress: w('dress(?:es)?|gowns?|skirts?'),
};

// Drop negated mentions: an Avoid line, and any clause from no / not /
// without / never / nor to the end of its clause (. ; : or ", and/but…").
export function affirmed(text) {
  return String(text ?? '')
    .split('\n').filter((l) => !/^\s*avoid\s*:/i.test(l)).join('\n')
    .replace(/\b(?:no|not|without|never|nor|avoid|instead of|rather than)\b.*?(?=[.;:\n]|,\s*(?:and|but|with|while|then)\b|$)/gi, ' ');
}

const conceptText = (concept, note) => [concept?.text, ...(concept?.theme ?? []), ...(concept?.imagery ?? []),
  ...(concept?.figurative ?? []).flatMap((f) => [f.phrase, f.meaning]), note].filter(Boolean).join(' . ');

// What the reference depicts: its curated `content` (from the given
// library, else the bundled registry, since a Blob registry may not carry
// it), else, for a reference not curated yet, everything its family's
// references depict.
const contentOf = (e, library) => e?.content ?? library.get(e?.id)?.content ?? LIBRARY.get(e?.id)?.content ?? null;
export function inventoryOf({ reference, family, library = LIBRARY }) {
  const ref = typeof reference === 'string' ? (library.get(reference) ?? LIBRARY.get(reference) ?? { id: reference }) : reference;
  const own = contentOf(ref, library);
  if (own) return { terms: [...own], from: ref.id };
  const fam = family ?? ref?.family;
  const pool = fam ? [...library.pool(fam), ...LIBRARY.pool(fam)] : [];
  return { terms: [...new Set(pool.flatMap((e) => contentOf(e, library) ?? []))], from: fam ?? null };
}

export function checkLeakage({ depicted, concept = null, note = '', reference = null, family = null, library = LIBRARY } = {}) {
  const seen = affirmed(Array.isArray(depicted) ? depicted.join('. ') : depicted);
  const asked = conceptText(concept, note);
  const { terms: inventory, from } = inventoryOf({ reference, family, library });
  const hit = (re, text) => text.match(re)?.[0] ?? null;
  const people = [], leaks = [], unrequested = [];
  for (const [term, re] of Object.entries(TERMS)) {
    const word = hit(re, seen);
    if (!word) continue;
    if (term === 'person') { people.push(word); continue; }
    if (hit(re, asked)) continue;
    (inventory.includes(term) ? leaks : unrequested).push({ term, word });
  }
  const verdict = people.length || leaks.length ? 'leak' : unrequested.length ? 'review' : 'ok';
  return { verdict, people, leaks, unrequested, inventory, from };
}

// The prompt-level check: the text we send must not name anything the
// reference depicts unless the words do, and must not ask for people.
// The concept's own lines are the words themselves, so they are checked
// only for people.
export function checkPrompt(direction, { library = LIBRARY } = {}) {
  const s = direction.sections ?? {};
  const own = [s.family, s.content, s.form, s.composition, s.staging, s.passages, s.marks, s.contrast, s.palette, s.emotion, s.energy, s.gesture, s.disorder, s.style].filter(Boolean).join('\n');
  const concept = direction.concept ?? null;
  const r = checkLeakage({ depicted: own, concept, reference: direction.reference?.id, family: direction.family, library });
  const words = checkLeakage({ depicted: [s.subject, s.meaning].filter(Boolean).join('\n'), concept: null, reference: null, family: '__none__', library });
  return { ...r, people: [...r.people, ...words.people], verdict: r.verdict === 'ok' && words.people.length ? 'leak' : r.verdict };
}

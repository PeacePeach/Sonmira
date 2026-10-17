// Development diagnostic: how often each style family and reference image is
// chosen. Runs only the selection (direct()) with fresh random seeds, the way
// the app does for each new generation; no image is generated and nothing is
// sent anywhere.
//
//   node tools/sample-references.mjs [--tier resolved] [--n 100] [--motif water] [--no-words] [--json]
//
// --no-words samples takes without a concept from lyrics (the family's own
// subject table then decides which families can be painted for the motif).

import { direct, FAMILIES, LIBRARY } from '../src/engine/direct/index.js';
import { randomSeed } from '../src/engine/engines/ai.js';

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const has = (name) => process.argv.includes(`--${name}`);

export function sampleReferences({ tier = 'resolved', n = 100, motif = 'water', words = true, seed = randomSeed, library = LIBRARY } = {}) {
  const families = {}, references = {};
  const concept = words ? { text: 'a quiet scene from the sung words', theme: [], imagery: [], figurative: [] } : null;
  for (let i = 0; i < n; i++) {
    const d = direct({ completeness: tier, emotion: 'tender', motif, seed: seed(), energy: { value: 'calm' }, concept, library });
    families[d.family] = (families[d.family] ?? 0) + 1;
    const id = d.reference?.id ?? '(none)';
    references[id] = (references[id] ?? 0) + 1;
  }
  return { tier, n, motif, words, families, references };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = sampleReferences({ tier: arg('tier', 'resolved'), n: Number(arg('n', 100)), motif: arg('motif', 'water'), words: !has('no-words') });
  if (has('json')) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  const bar = (c) => '█'.repeat(Math.round((c / r.n) * 60));
  console.log(`${r.n} selections · ${r.tier} · motif ${r.motif} · ${r.words ? 'with' : 'without'} words · library ${LIBRARY.version}\n`);
  console.log('families');
  for (const id of Object.keys(FAMILIES).filter((k) => FAMILIES[k].tier === r.tier)) {
    const c = r.families[id] ?? 0;
    console.log(`  ${id.padEnd(24)} ${String(c).padStart(4)}  ${bar(c)}`);
  }
  console.log('\nreferences');
  for (const id of Object.keys(r.references).sort()) {
    const c = r.references[id];
    console.log(`  ${id.padEnd(24)} ${String(c).padStart(4)}  ${bar(c)}`);
  }
}

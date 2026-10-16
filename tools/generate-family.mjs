// Reference-guided generation of style-family examples with the OpenAI
// Image API (edits endpoint). Runs locally or on a server; never in a client.
//
//   OPENAI_API_KEY=... node tools/generate-family.mjs G2 R4 R5 \
//     [--refs DIR] [--out DIR] [--seed N] [--motif M] [--emotion E] [--dry-run] [--no-stream]
//
// --refs  the reference root; image paths come from the registry
//         (src/engine/direct/references.js, kept by tools/index_references.py)
//         (default $SONMIRA_REFS_DIR). The reference images are not stored
//         in this repository.
// --out   default qa/out/families; each run writes
//         <out>/<family>/<stamp>-s<seed>.jpg and a .json with the prompt,
//         the references sent, the model settings and the API usage.
// --dry-run prints the prompt and references without calling the API.
// --no-stream waits for one JSON response instead of a stream. Requests are
//         streamed by default because some proxies drop requests that
//         return nothing for ~30 s. An API or proxy error stops the run.
// Behind a proxy that injects the key, set OPENAI_API_KEY to a placeholder
// and NODE_USE_ENV_PROXY=1 so Node's fetch goes through the proxy.
// Model settings come from OPENAI_IMAGE_MODEL / _QUALITY / _SIZE /
// _INPUT_FIDELITY (see src/engine/providers/openai.js).
//
// One family per argument, so a single family can be regenerated alone.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { direct, LIBRARY, FAMILIES } from '../src/engine/direct/index.js';
import { AFFINITY, SUBJECTS } from '../src/engine/direct/families.js';
import { generateFromDirection, openaiConfig } from '../src/engine/providers/openai.js';
import { fileReferenceLoader } from '../src/engine/providers/reference-files.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const dry = args.includes('--dry-run') && args.splice(args.indexOf('--dry-run'), 1);
const noStream = args.includes('--no-stream') && args.splice(args.indexOf('--no-stream'), 1);
const refsDir = opt('refs', process.env.SONMIRA_REFS_DIR);
const outDir = opt('out', 'qa/out/families');
const seedArg = opt('seed');
const motifArg = opt('motif');
const emotion = opt('emotion', 'tender');

const resolveFamily = (a) => FAMILIES[a] ? a : Object.keys(FAMILIES).find((id) => id.toUpperCase().startsWith(`${a.toUpperCase()}-`));
// Gathered stays unnamed; other tiers take the motif hint of the primary
// reference when the registry has one, else the family's first matching motif.
const motifFor = (id, ref) => motifArg || (FAMILIES[id].tier === 'gathered' ? 'abstract' : [ref?.motif, ...(AFFINITY[id] || [])].find((m) => m && SUBJECTS[id]?.[m]) || 'landscape');

if (!args.length || !refsDir) {
  console.error('usage: node tools/generate-family.mjs <family…> --refs <dir> [--seed N] [--dry-run]');
  process.exit(2);
}
if (!dry && !openaiConfig().configured) {
  console.error('OPENAI_API_KEY is not set. Export it in this shell (never commit it), or use --dry-run.');
  process.exit(2);
}

for (const a of args) {
  const family = resolveFamily(a);
  if (!family) { console.error(`unknown family ${a}`); process.exitCode = 1; continue; }
  const tier = FAMILIES[family].tier;
  const seed = seedArg != null ? Number(seedArg) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  // The family's primary reference, drawn by seed from the registry pool.
  const ref = LIBRARY.select(family, seed);
  const motif = motifFor(family, ref);
  const d = direct({ completeness: tier, motif, emotion, seed, family, reference: ref?.id, energy: { value: 'calm' } });
  if (!d.reference) { console.error(`  ✗ ${family}: no active reference in the registry`); process.exitCode = 1; continue; }
  const prompt = `${d.referencePrompt}\n${d.prompt}`;
  if (dry) { console.log(`--- ${family} (seed ${seed}, reference ${d.reference.id}, library ${d.libraryVersion})\n${prompt}\n`); continue; }

  console.log(`${family}: generating with reference ${d.reference.id}…`);
  // Streamed, so the ~30 s proxy limit does not cut long requests. Any API or
  // proxy error stops the run: no retries, since a failed request may still
  // be billed.
  const g = await generateFromDirection(d, { loadReference: fileReferenceLoader(refsDir), stream: !noStream }).catch((e) => {
    console.error(`  ✗ ${family}: ${e.message}${e.status ? ` (HTTP ${e.status})` : ''}. Stopping; nothing was retried.`);
    process.exit(1);
  });
  const dir = join(outDir, family);
  await mkdir(dir, { recursive: true });
  const base = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-s${seed}`);
  await writeFile(`${base}.jpg`, Buffer.from(g.b64, 'base64'));
  await writeFile(`${base}.json`, JSON.stringify({
    family, tier, label: d.familyLabel, seed, motif, emotion, subject: d.subject,
    referenceId: d.reference.id, referencePath: d.reference.path, libraryVersion: d.libraryVersion,
    references: [d.reference.path.split('/').pop()], primaryReference: d.reference.path.split('/').pop(), palette: d.swatches,
    model: g.model, quality: g.quality, size: g.size, endpoint: 'images/edits', stream: !noStream, ms: g.ms, usage: g.usage,
    prompt, createdAt: new Date().toISOString(),
  }, null, 2));
  console.log(`  → ${base}.jpg (${g.ms} ms)`);
}

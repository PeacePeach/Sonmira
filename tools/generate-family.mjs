// Reference-guided generation of style-family examples with the OpenAI
// Image API (edits endpoint). Runs locally or on a server; never in a client.
//
//   OPENAI_API_KEY=... node tools/generate-family.mjs G2 R4 R5 \
//     [--refs DIR] [--out DIR] [--seed N] [--motif M] [--emotion E] [--dry-run]
//
// --refs  the reference folder with loose/, gathered/ and resolved/ inside
//         (default $SONMIRA_REFS_DIR). The reference images are not stored
//         in this repository.
// --out   default qa/out/families; each run writes
//         <out>/<family>/<stamp>-s<seed>.jpg and a .json with the prompt,
//         the references sent, the model settings and the API usage.
// --dry-run prints the prompt and references without calling the API.
// Model settings come from OPENAI_IMAGE_MODEL / _QUALITY / _SIZE /
// _INPUT_FIDELITY (see src/engine/providers/openai.js).
//
// One family per argument, so a single family can be regenerated alone.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { direct, referenceGuide, FAMILIES } from '../src/engine/direct/index.js';
import { AFFINITY, SUBJECTS } from '../src/engine/direct/families.js';
import { editOpenAI, openaiConfig } from '../src/engine/providers/openai.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const dry = args.includes('--dry-run') && args.splice(args.indexOf('--dry-run'), 1);
const refsDir = opt('refs', process.env.SONMIRA_REFS_DIR);
const outDir = opt('out', 'qa/out/families');
const seedArg = opt('seed');
const motifArg = opt('motif');
const emotion = opt('emotion', 'tender');

const resolveFamily = (a) => FAMILIES[a] ? a : Object.keys(FAMILIES).find((id) => id.toUpperCase().startsWith(`${a.toUpperCase()}-`));
// Gathered stays unnamed; other tiers take the family's first matching motif.
const motifFor = (id) => motifArg || (FAMILIES[id].tier === 'gathered' ? 'abstract' : (AFFINITY[id] || []).find((m) => SUBJECTS[id]?.[m]) || 'landscape');

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
  const motif = motifFor(family);
  const d = direct({ completeness: tier, motif, emotion, seed, family, energy: { value: 'calm' } });
  const guide = referenceGuide(family, seed);
  const prompt = `${guide.text}\n${d.prompt}`;
  if (dry) { console.log(`--- ${family} (seed ${seed}, refs ${guide.refs.join(', ')})\n${prompt}\n`); continue; }

  const images = await Promise.all(guide.refs.map(async (name) => ({
    name, mime: extname(name) === '.png' ? 'image/png' : 'image/jpeg', bytes: await readFile(join(refsDir, tier, name)),
  })));
  console.log(`${family}: generating with ${guide.refs.length} reference(s)…`);
  const g = await editOpenAI(prompt, images);
  const dir = join(outDir, family);
  await mkdir(dir, { recursive: true });
  const base = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-s${seed}`);
  await writeFile(`${base}.jpg`, Buffer.from(g.b64, 'base64'));
  await writeFile(`${base}.json`, JSON.stringify({
    family, tier, label: d.familyLabel, seed, motif, emotion, subject: d.subject,
    references: guide.refs, primaryReference: guide.primary,
    model: g.model, quality: g.quality, size: g.size, endpoint: 'images/edits', ms: g.ms, usage: g.usage,
    prompt, createdAt: new Date().toISOString(),
  }, null, 2));
  console.log(`  → ${base}.jpg (${g.ms} ms)`);
}

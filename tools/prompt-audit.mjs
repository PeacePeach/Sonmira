// Development audit of the reference-to-image request, with NO image
// generation: the request the server would send to OpenAI is built through
// the same code (direct() → generateFromDirection → editOpenAI) and captured
// by a fake fetch that never leaves this process.
//
//   node tools/prompt-audit.mjs [--tier resolved] [--lyrics "…"] [--emotion tender] [--motif water] [--json] [--prompts]
//
// Reference files: read from private Blob storage when BLOB_READ_WRITE_TOKEN
// is set (`node --env-file=.env.local tools/prompt-audit.mjs`), from a local
// folder with SONMIRA_REFS_DIR, otherwise reported as "not checked" (a stub
// image stands in, so the request shape can still be inspected).
//
// For one reference of every family in the tier it prints: the reference id
// and family, whether its file was found and how many bytes reached the
// request (and under which file name), the complete effective prompt
// (--prompts), and which written instructions may conflict with that
// family's own observed style. Then it measures how much of the prompt is
// word-for-word identical across the families.

import { direct, FAMILIES, LIBRARY, REFERENCE_AVOID as AVOID, REFERENCE_STYLE as GLOBAL_STYLE, createLibrary } from '../src/engine/direct/index.js';
import { generateFromDirection } from '../src/engine/providers/openai.js';
import { localStore, blobStore } from '../src/engine/providers/reference-store.js';

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const has = (name) => process.argv.includes(`--${name}`);

// Written instructions that can pull against a family's own references.
// Each entry: the instruction (as it appears in the prompt), and the words in
// a family's observed style that it contradicts. Heuristic, for review.
export const CONFLICTS = [
  { says: 'transparent layered washes, wet-on-wet diffusion', against: /\bflat\b|gouache|print|silhouette/i, why: 'universal wet-on-wet transparency vs a flat, graphic family' },
  { says: 'blooms and backruns', against: /\bflat\b|clean edges|smooth gradients|very smooth/i, why: 'universal blooms vs a clean or smooth family' },
  { says: 'smooth artificial gradients', against: /smooth gradients|very smooth gradations/i, why: 'avoid list forbids gradients this family is built on' },
  { says: 'cinematic photography', against: /cinematic/i, why: 'avoid list forbids a quality the family is described with' },
  { says: 'generic pastel sunsets', against: /pastel/i, why: 'avoid list leans against a pastel family' },
  { says: 'only a small part of the picture is resolved', against: /all-over|wild texture|energetic texture/i, why: 'universal restraint vs an all-over, energetic family' },
  { says: 'intentional negative space of reserved white paper', against: /deep values|dramatic value|deeper values|strong value contrast/i, why: 'universal white paper vs a deep-valued family (also: the measured paper share)' },
  { says: 'one clear colour idea: a dominant colour family with at most one accent', against: /cluster of small, crisply painted coloured|bright orange and red|several/i, why: 'universal one-accent rule vs a multi-accent family' },
  { says: 'Fine detail and the sharpest edges only at the focus', against: /\bflat\b|silhouette|two-colour/i, why: 'Resolved form rule vs a family of flat, evenly crisp shapes' },
  { says: 'a complete sense of space', against: /.^/, why: 'Resolved form rule contradicts the global "only a small part is resolved"' },
];

// Technique, composition and colour prescriptions that must come from the
// reference (or the family's own rules), never from the shared layer. Any of
// these in the prompt outside the reference-authority paragraph, the family's
// style line, its composition principles and the reference's measured
// palette is reported.
export const UNIVERSAL_TECHNIQUE = [
  /wet-on-wet|wet-in-wet/i, /\bblooms?\b/i, /backruns?/i, /granulation/i, /white paper|bare paper|reserved white/i, /negative space/i,
  /smooth (artificial )?gradients?/i, /cinematic/i, /pastel/i, /splash|spatter|flicks?\b/i, /transparent layered/i, /one clear colour idea|at most one accent/i,
  /sharpest edges/i, /only a small part of the picture/i, /more paper showing|overcast light|open sunlit light/i, /cold-press/i,
];

export function sharedLayer(prompt, direction) {
  return prompt.replace(direction.referencePrompt ?? '', '').replace(direction.sections.family, '').replace(direction.composition?.principles ?? '', '').replace(direction.sections.palette ?? '', '').replace(direction.sections.subject, '').replace(direction.sections.meaning ?? '', '');
}

async function storeFor(env) {
  if (env.BLOB_READ_WRITE_TOKEN) return { kind: 'blob', store: blobStore({ token: env.BLOB_READ_WRITE_TOKEN }) };
  if (env.SONMIRA_REFS_DIR) return { kind: 'local', store: localStore(env.SONMIRA_REFS_DIR) };
  return { kind: 'none', store: null };
}

// The request the server would send for this direction, captured, not sent.
export async function captureRequest(direction, loadReference) {
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, form: init.body };
    return { ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QQ=="}\n', json: async () => ({ data: [{ b64_json: 'QQ==' }] }) };
  };
  await generateFromDirection(direction, { env: { OPENAI_API_KEY: 'audit-no-network' }, fetchImpl, stream: true, loadReference });
  const images = captured.form instanceof FormData ? captured.form.getAll('image[]') : [];
  return {
    endpoint: captured.url,
    prompt: captured.form instanceof FormData ? captured.form.get('prompt') : JSON.parse(captured.form).prompt,
    images: images.map((b) => ({ name: b.name, bytes: b.size, type: b.type })),
    inputFidelity: captured.form instanceof FormData ? captured.form.get('input_fidelity') : null,
  };
}

export async function auditTier({ tier = 'resolved', lyrics = 'a lantern floating on a dark river at night', emotion = 'tender', motif = 'water', env = process.env, library = LIBRARY } = {}) {
  const { kind, store } = await storeFor(env);
  // With a store, audit the registry the server actually selects from.
  if (store && library === LIBRARY) library = createLibrary(await store.loadRegistry());
  const concept = { text: lyrics, theme: [], imagery: [], figurative: [] };
  const rows = [];
  for (const family of Object.keys(FAMILIES).filter((id) => FAMILIES[id].tier === tier)) {
    for (const ref of library.pool(family)) {
      const d = direct({ completeness: tier, emotion, motif, seed: 1, family, reference: ref.id, energy: { value: 'calm' }, concept, library });
      let found = null, error = null;
      const load = async (r) => {
        if (!store) { found = null; return { name: r.path.split('/').pop(), mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) }; }
        try { const im = await store.loadImage(r); found = im.bytes.length > 0; return im; } catch (e) { found = false; error = e.code || e.message; throw e; }
      };
      let req = null;
      try { req = await captureRequest(d, load); } catch { /* missing file: reported below */ }
      const F = FAMILIES[family], own = `${F.observed} ${F.rules}`;
      rows.push({
        reference: ref.id, family, selected: d.reference?.id, matches: d.reference?.id === ref.id,
        file: kind === 'none' ? 'not checked (no store configured)' : found ? 'found' : `missing${error ? ` (${error})` : ''}`,
        imagesInRequest: req?.images ?? [], correctImage: req ? req.images.length === 1 && req.images[0].name === ref.path.split('/').pop() : false,
        inputFidelity: req?.inputFidelity ?? 'not set (API default)',
        prompt: req?.prompt ?? null, promptChars: req?.prompt?.length ?? 0,
        universal: req?.prompt ? UNIVERSAL_TECHNIQUE.filter((re) => re.test(sharedLayer(req.prompt, d))).map((re) => re.source) : [],
        conflicts: CONFLICTS.filter((c) => req?.prompt?.includes(c.says) && (c.against.test(own) || c.against.source === '.^')).map((c) => `${c.says} → ${c.why}`),
      });
    }
  }
  // How much of the prompt is identical for every family (sentence level).
  const sentences = (p) => p.split(/(?<=[.:])\s+|\n/).map((s) => s.trim()).filter(Boolean);
  const perFamily = Object.values(Object.groupBy(rows.filter((r) => r.prompt), (r) => r.family)).map((rs) => new Set(sentences(rs[0].prompt)));
  const shared = [...perFamily[0]].filter((s) => perFamily.every((set) => set.has(s)));
  const sharedChars = shared.join(' ').length, avg = rows.reduce((a, r) => a + r.promptChars, 0) / Math.max(1, rows.length);
  return { tier, lyrics, emotion, store: kind, rows, identical: { share: Math.round((sharedChars / avg) * 100) / 100, sentences: shared.length, globalStyleChars: GLOBAL_STYLE.length, avoidItems: AVOID.length } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await auditTier({ tier: arg('tier', 'resolved'), lyrics: arg('lyrics', undefined), emotion: arg('emotion', 'tender'), motif: arg('motif', 'water') });
  if (has('json')) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  console.log(`prompt audit · ${r.tier} · emotion ${r.emotion} · reference files and registry: ${r.store === 'none' ? 'bundled registry, files not checked' : r.store}\nlyrics: "${r.lyrics}"\n`);
  for (const x of r.rows) {
    console.log(`${x.reference.padEnd(12)} ${x.family.padEnd(22)} file ${x.file} · image[] ${x.imagesInRequest.map((i) => `${i.name} ${i.bytes} B`).join(', ') || 'none'} · correct ${x.correctImage} · ${x.promptChars} chars`);
    for (const c of x.conflicts) console.log(`    ⚠ ${c}`);
    if (x.universal.length) console.log(`    ⚠ shared layer prescribes: ${x.universal.join(', ')}`);
    if (has('prompts')) console.log(`\n${x.prompt}\n`);
  }
  console.log(`\nidentical across every family: ${Math.round(r.identical.share * 100)}% of the prompt (${r.identical.sentences} sentences); input_fidelity ${r.rows[0]?.inputFidelity}`);
}

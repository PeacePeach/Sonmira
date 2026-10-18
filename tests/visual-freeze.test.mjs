// The V1 visual rules are frozen (Han approved Validation 4 on 16 Oct as the
// three-tier quality for V1). These checks fail when anything that shapes the
// image request changes: the prompt text for a family and reference, the
// reference library, and the image settings. (Which reference a seed draws
// is covered by test/engine/reference-selection.test.mjs.)
//
// 1. The 10 approved Validation 4 runs are rebuilt through the real
//    /api/generate handler (fake OpenAI, no network) and must produce exactly
//    the request that made the approved images.
// 2. Every active reference, at its own tier, with one fixed subject, must
//    give the prompt recorded in fixtures/visual-freeze-v1.json, so the
//    families Validation 4 did not paint are frozen too.
//
// A failure here means a frozen rule changed. Change the rules (and refresh
// with FREEZE_WRITE=1) only after Han approves new visual work.
//
// Loose is the exception, pending review (Phase 2, 18 Oct): its prompts now
// follow the performance (direct/sound.js), so the 3 approved Loose runs
// (S1, S3, S6) no longer rebuild to their approved prompts. They are checked
// against the proposed prompts recorded in the fixture (`looseProposed`)
// instead, and the Gathered and Resolved runs must still match exactly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHandler } from '../api/generate.js';
import { direct, FAMILIES, LIBRARY } from '../src/engine/direct/index.js';
import { REFERENCE_LIBRARY } from '../src/engine/direct/references.js';
import { openaiConfig } from '../src/engine/providers/openai.js';

const here = (p) => new URL(p, import.meta.url);
const approved = JSON.parse(readFileSync(here('../playground/validation/validation-4.json'), 'utf8'));
const FIXTURE = here('./fixtures/visual-freeze-v1.json');
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const store = {
  kind: 'local',
  loadRegistry: async () => REFERENCE_LIBRARY,
  loadImage: async (ref) => ({ name: ref.path.split('/').pop(), mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) }),
};

async function paint(spec) {
  let form = null;
  const fetchImpl = async (url, init) => {
    form = init.body;
    return { ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QQ=="}\n', json: async () => ({ data: [{ b64_json: 'QQ==' }] }) };
  };
  let out;
  const res = { setHeader() {}, status() { return this; }, json(j) { out = j; } };
  await createHandler({ store, env: { OPENAI_API_KEY: 'freeze-test-no-network' }, fetchImpl })({ method: 'POST', body: { spec } }, res);
  assert.ok(out?.ok, `generate refused: ${out?.error}`);
  return { out, sent: form.get('prompt'), model: form.get('model'), quality: form.get('quality'), size: form.get('size'), fidelity: form.get('input_fidelity') };
}

const proposed = {};

test('the 10 approved Validation 4 requests are rebuilt exactly (Loose: as proposed)', async () => {
  assert.equal(approved.runs.length, 10);
  for (const run of approved.runs) {
    const o = run.overrides, r = run.result;
    const note = String(run.note ?? '').trim();
    // The approved family and reference are pinned: since 18 Oct a seed
    // draws its reference from the whole tier (Han), so the same seed may now
    // pick another one; the request for the approved pair must not change.
    const spec = {
      completeness: o.tier, emotion: o.emotion, motif: o.motif, seed: o.seed, family: r.family, reference: r.reference, energy: { value: r.energy ?? 'calm' }, expression: r.settings.expression,
      ...(note ? { concept: { text: note, theme: [], imagery: [], figurative: [], source: 'note' } } : { soundOnly: true }),
    };
    const g = await paint(spec);
    assert.equal(g.out.family, r.family, `${run.id}: family`);
    assert.equal(g.out.reference, r.reference, `${run.id}: reference`);
    if (o.tier === 'loose') {
      assert.notEqual(g.sent, r.prompt, `${run.id}: Loose now follows the performance`);
      proposed[run.id] = sha(g.sent);
    } else assert.equal(g.sent, r.prompt, `${run.id}: the prompt differs from the approved one`);
    assert.deepEqual([g.model, g.quality, g.size], [r.model, r.quality, r.size], `${run.id}: image settings`);
  }
  assert.equal(Object.keys(proposed).length, 3);
  if (process.env.FREEZE_WRITE) {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    writeFileSync(FIXTURE, `${JSON.stringify({ ...f, looseProposed: proposed }, null, 1)}\n`);
  }
  assert.deepEqual(proposed, JSON.parse(readFileSync(FIXTURE, 'utf8')).looseProposed, 'the proposed Loose prompts changed');
});

function currentSnapshot() {
  const concept = { text: 'a quiet harbour at first light', theme: [], imagery: [], figurative: [], source: 'note' };
  const prompts = {};
  for (const [family, F] of Object.entries(FAMILIES)) {
    for (const ref of LIBRARY.pool(family)) {
      const d = direct({ completeness: F.tier, emotion: 'tender', motif: 'water', seed: 1, family, reference: ref.id, energy: { value: 'calm' }, concept, library: LIBRARY });
      prompts[`${F.tier}/${family}/${ref.id}`] = sha(`${d.referencePrompt}\n${d.prompt}`);
    }
  }
  const c = openaiConfig({ OPENAI_API_KEY: 'x' });
  return {
    approved: 'Han, 16 Oct 2026: Validation 4 approved as the V1 three-tier artwork quality',
    library: sha(JSON.stringify(REFERENCE_LIBRARY)),
    image: { model: c.model, quality: c.quality, size: c.size },
    prompts,
  };
}

test('every reference at its tier gives the frozen V1 prompt', () => {
  const now = currentSnapshot();
  if (process.env.FREEZE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify({ ...now, looseProposed: JSON.parse(readFileSync(FIXTURE, 'utf8')).looseProposed }, null, 1)}\n`);
  const frozen = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.equal(now.library, frozen.library, 'the reference library changed');
  assert.deepEqual(now.image, frozen.image, 'the image settings changed');
  assert.deepEqual(Object.keys(now.prompts).sort(), Object.keys(frozen.prompts).sort(), 'families or active references changed');
  const changed = Object.keys(frozen.prompts).filter((k) => now.prompts[k] !== frozen.prompts[k]);
  assert.deepEqual(changed, [], 'prompts changed');
});

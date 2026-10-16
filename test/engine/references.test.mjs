// The reference library: discovery, independent pools, reproducible
// selection, reference-driven colour and one image per API call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { direct, createLibrary, colourName, FAMILIES } from '../../src/engine/direct/index.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';
import { generateFromDirection } from '../../src/engine/providers/openai.js';

const R4 = 'R4-lyrical-everyday', R5 = 'R5-light-as-subject';
const NEW = { id: 'resolved_99', family: R4, path: 'resolved/R4/resolved_99.jpg', active: true,
  palette: { colors: [{ hex: '#c0392b', share: 0.5 }, { hex: '#f5e6c8', share: 0.3 }], accent: null, paper: 0.2, dark: 0, lightness: 0.6, saturation: 0.4, temperature: 'warm' } };
const seeds = Array.from({ length: 300 }, (_, i) => i);
const spec = (family, seed, library) => ({ completeness: 'resolved', emotion: 'tender', motif: 'water', seed, family, energy: { value: 'calm' }, library });

test('a newly added reference becomes selectable, with no code change', () => {
  const before = createLibrary(REFERENCE_LIBRARY);
  const after = createLibrary([...REFERENCE_LIBRARY, NEW]);
  assert.equal(after.pool(R4).length, before.pool(R4).length + 1);
  assert.ok(seeds.some((s) => after.select(R4, s).id === 'resolved_99'));
  assert.notEqual(after.version, before.version);
  // Inactive or unassigned references never enter a pool.
  const off = createLibrary([...REFERENCE_LIBRARY, { ...NEW, active: false }, { ...NEW, id: 'x', family: null }]);
  assert.deepEqual(off.pool(R4).map((e) => e.id), before.pool(R4).map((e) => e.id));
});

test('families keep independent pools', () => {
  const before = createLibrary(REFERENCE_LIBRARY);
  const after = createLibrary([...REFERENCE_LIBRARY, NEW]);
  for (const id of Object.keys(FAMILIES)) {
    for (const e of after.pool(id)) assert.equal(e.family, id);
    if (id !== R4) for (const s of seeds.slice(0, 50)) assert.equal(after.select(id, s)?.id, before.select(id, s)?.id, id);
  }
  assert.ok(!after.pool(R5).some((e) => e.id === 'resolved_99'));
});

test('same seed and library version give the same selection; references are equally likely', () => {
  const a = createLibrary(REFERENCE_LIBRARY), b = createLibrary(REFERENCE_LIBRARY.slice().reverse());
  assert.equal(a.version, b.version);
  for (const s of seeds) assert.equal(a.select(R4, s).id, b.select(R4, s).id);
  for (const s of seeds.slice(0, 20)) assert.deepEqual(direct(spec(R4, s)).reference, direct(spec(R4, s)).reference);
  const counts = {};
  for (let s = 0; s < 4000; s++) counts[a.select(R4, s).id] = (counts[a.select(R4, s).id] || 0) + 1;
  for (const n of Object.values(counts)) assert.ok(n > 800 && n < 1200, JSON.stringify(counts));
});

test("the selected reference's dominant palette is in the generation instructions", () => {
  const lib = createLibrary([...REFERENCE_LIBRARY.filter((e) => e.family !== R4), NEW]);
  const d = direct(spec(R4, 7, lib));
  assert.equal(d.reference.id, 'resolved_99');
  assert.match(d.sections.palette, /dominant [a-z -]*red \(#c0392b, about 50%/);
  assert.match(d.prompt, /#c0392b/);
  assert.equal(d.swatches[0].hex, '#c0392b');
  // Real references: always the selected one's own dominant colour, never another's.
  for (const s of seeds.slice(0, 40)) {
    const r = direct(spec(R5, s));
    const own = REFERENCE_LIBRARY.find((e) => e.id === r.reference.id).palette.colors[0].hex;
    assert.ok(r.prompt.includes(own));
    for (const other of REFERENCE_LIBRARY.filter((e) => e.family === R5 && e.id !== r.reference.id)) assert.ok(!r.prompt.includes(other.palette.colors[0].hex));
  }
  assert.equal(colourName('#769e75'), 'muted green');
});

test('only the selected reference is passed to the image API', async () => {
  const d = direct(spec(R5, 3));
  const loaded = [];
  let form;
  const fetchImpl = async (url, init) => { form = init.body; return { ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QQ=="}\n' }; };
  const g = await generateFromDirection(d, {
    env: { OPENAI_API_KEY: 'k' }, fetchImpl, stream: true,
    loadReference: async (ref) => { loaded.push(ref.id); return { name: ref.path.split('/').pop(), mime: 'image/jpeg', bytes: new Uint8Array([1]) }; },
  });
  assert.deepEqual(loaded, [d.reference.id]);
  const images = form.getAll('image[]');
  assert.equal(images.length, 1);
  assert.equal(images[0].name, d.reference.path.split('/').pop());
  assert.equal(g.reference, d.reference.id);
  assert.match(form.get('prompt'), /^The attached image is the primary style reference/);
});

const hasPIL = spawnSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }).status === 0;
test('the indexer discovers a new image in a family folder and measures its palette', { skip: !hasPIL && 'python3 with Pillow not available' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sonmira-refs-'));
  const root = join(dir, 'refs');
  mkdirSync(join(root, 'resolved', 'R4'), { recursive: true });
  mkdirSync(join(root, 'loose'), { recursive: true });
  spawnSync('python3', ['-c', `from PIL import Image
im = Image.new('RGB', (64, 64), (250, 250, 247)); im.paste((40, 140, 60), (0, 0, 40, 64)); im.save(r'${join(root, 'resolved', 'R4', 'fresh.png')}')
Image.new('RGB', (32, 32), (200, 120, 60)).save(r'${join(root, 'loose', 'stray.jpg')}')`]);
  const registry = join(dir, 'references.js');
  writeFileSync(registry, 'export const REFERENCE_LIBRARY = /*BEGIN*/[]/*END*/;\n');
  const run = spawnSync('python3', ['tools/index_references.py', root, '--registry', registry], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const { REFERENCE_LIBRARY: L } = await import(pathToFileURL(registry).href);
  const fresh = L.find((e) => e.id === 'fresh');
  assert.equal(fresh.family, R4);
  assert.equal(fresh.active, true);
  assert.equal(colourName(fresh.palette.colors[0].hex).endsWith('green'), true, fresh.palette.colors[0].hex);
  assert.equal(L.find((e) => e.id === 'stray').active, false); // no family folder: unassigned
  const lib = createLibrary(L);
  assert.equal(lib.select(R4, 123).id, 'fresh');
});

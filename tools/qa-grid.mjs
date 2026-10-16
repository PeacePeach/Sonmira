// Visual QA: renders the shared scenarios at loose / gathered / resolved
// with the same motif, mood and seed, plus several seeds per tier.
// Usage: node tools/qa-grid.mjs [outDir] [width]
// Writes one PNG per painting and a grid per scenario (columns: loose,
// gathered, resolved). Review against qa/CRITERIA.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { generatePainting } from '../src/engine/generate.js';
import { encodePNG } from '../src/engine/paint/png.js';

const out = process.argv[2] || 'qa/out';
const W = Number(process.argv[3] || 540), H = Math.round(W * 1.25);
mkdirSync(out, { recursive: true });

export const SCENARIOS = [
  { id: 'A-water-tender', motif: 'water', emotion: 'tender', seed: 101, note: 'evening by the sea' },
  { id: 'B-sky-bright', motif: 'sky', emotion: 'bright', seed: 202, note: 'morning clouds' },
  { id: 'C-garden-melancholic', motif: 'garden', emotion: 'melancholic', seed: 303, note: 'the garden after rain' },
  { id: 'D-landscape-intense', motif: 'landscape', emotion: 'intense', seed: 404, note: 'mountain road' },
  { id: 'E-interior-tender', motif: 'interior', emotion: 'tender', seed: 505, note: 'tea by the window' },
  { id: 'F-abstract-melancholic', motif: 'abstract', emotion: 'melancholic', seed: 606, note: '' },
];
const TIERS = ['loose', 'gathered', 'resolved'];

function grid(images, cols, gap = 16) {
  const rows = Math.ceil(images.length / cols), w = images[0].width, h = images[0].height;
  const GW = cols * w + (cols + 1) * gap, GH = rows * h + (rows + 1) * gap;
  const rgba = new Uint8ClampedArray(GW * GH * 4);
  for (let i = 0; i < GW * GH; i++) { rgba[i * 4] = 248; rgba[i * 4 + 1] = 245; rgba[i * 4 + 2] = 239; rgba[i * 4 + 3] = 255; }
  images.forEach((im, n) => {
    const ox = gap + (n % cols) * (w + gap), oy = gap + Math.floor(n / cols) * (h + gap);
    for (let y = 0; y < h; y++) rgba.set(im.rgba.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * GW + ox) * 4);
  });
  return { width: GW, height: GH, rgba };
}

const manifest = [];
let count = 0;
for (const s of SCENARIOS) {
  const row = [];
  for (const tier of TIERS) {
    const g = await generatePainting({ noteText: s.note, emotionOverride: s.emotion, motifOverride: s.motif, vocalControlOverride: tier, seed: s.seed, width: W, height: H });
    writeFileSync(`${out}/${s.id}-${tier}.png`, await encodePNG(g.image)); count++;
    manifest.push({ file: `${s.id}-${tier}.png`, scenario: s.id, tier: g.tier, motif: g.motif, emotion: g.emotion, seed: g.seed, pigments: g.pigments, stylePosition: g.stylePosition });
    row.push(g.image);
  }
  writeFileSync(`${out}/grid-${s.id}.png`, await encodePNG(grid(row, 3)));
}
// Variation inside each tier: four seeds, same motif and mood.
for (const [motif, emotion] of [['water', 'tender'], ['landscape', 'melancholic']]) {
  const imgs = [];
  for (const tier of TIERS) for (const seed of [1, 2, 3, 4]) {
    const g = await generatePainting({ emotionOverride: emotion, motifOverride: motif, vocalControlOverride: tier, seed, width: Math.round(W * 0.6), height: Math.round(H * 0.6) });
    imgs.push(g.image); count++;
  }
  writeFileSync(`${out}/seeds-${motif}-${emotion}.png`, await encodePNG(grid(imgs, 4)));
}
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log(`rendered ${count} paintings into ${out}`);

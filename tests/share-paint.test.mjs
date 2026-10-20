// The share video's painting animation (src/app/share/paint.js planStrokes):
// strokes come from the painting itself, are the same every time, cover all
// of its paint, go wash → body → details, light paint before dark, and are
// all down before the settle, so the painting is finished by half time.
// tests/e2e/save-photos.mjs checks the real MP4. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { planStrokes, PAINT_UNTIL, paintSeconds } from '../src/app/share/paint.js';

const W = 760, H = 950, DAB = 6;

// A small painting: white paper, a pale wash at the top, a dark detailed shape low down.
function painting({ paper = [250, 248, 244], full = false } = {}) {
  const w = 160, h = 200, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = full ? [40, 120, 140] : paper;
    if (!full && y < 70 && x > 20 && x < 140) c = [200, 225, 235]; // pale sky wash
    if (y > 120 && y < 170 && x > 50 && x < 110) c = (x + y) % 6 < 3 ? [40, 50, 60] : [120, 90, 70]; // dark, busy
    data.set([...c, 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
}
const dabsOf = (plan, layer) => {
  const out = [];
  for (let i = layer.start; i < layer.end; i++) out.push(Array.from(plan.dabs.slice(i * DAB, i * DAB + DAB)));
  return out;
};

test('paint: the same painting always paints the same way', () => {
  const a = planStrokes(painting(), W, H), b = planStrokes(painting(), W, H);
  assert.deepEqual(a.dabs, b.dabs);
  assert.deepEqual(a.layers, b.layers);
});

test('paint: wash, then body, then details, all down before the painting is finished', () => {
  const plan = planStrokes(painting(), W, H);
  assert.deepEqual(plan.layers.map((l) => l.plate), ['wash', 'body', 'sharp']);
  let first = [];
  for (const layer of plan.layers) {
    const d = dabsOf(plan, layer);
    assert.ok(d.length > 20, `${layer.plate}: has strokes (${d.length} dabs)`);
    for (let i = 1; i < d.length; i++) assert.ok(d[i][5] >= d[i - 1][5], `${layer.plate}: dabs in time order`);
    assert.ok(d[0][5] >= 0 && d.at(-1)[5] < 0.95, `${layer.plate}: within the painting time`);
    first.push(d[0][5]);
  }
  assert.ok(first[0] < first[1] && first[1] < first[2], 'each layer starts after the one before');
  assert.equal(PAINT_UNTIL, 0.5, 'finished at half the recording');
  assert.equal(paintSeconds(20), 10, 'a 20 s song: painted in 10 s');
  assert.equal(paintSeconds(7.2), 5, 'a short song: still 5 s, so the strokes can be seen');
  assert.equal(paintSeconds(4), 3.4, 'shorter than 5 s: nearly all of it, then the finished painting');
});

test('paint: the first wash covers all of the painting’s paint, and leaves its white paper', () => {
  const plan = planStrokes(painting(), W, H);
  const [wash, body] = plan.layers.map((l) => dabsOf(plan, l));
  const covered = (dabs, x, y) => dabs.some(([dx, dy, r]) => (dx - x) ** 2 + (dy - y) ** 2 < (r * 0.6) ** 2);
  for (const [x, y] of [[380, 150], [200, 250], [600, 300], [400, 700], [300, 800]]) {
    assert.ok(covered(wash, x, y) || covered(body, x, y), `paint at ${x},${y} is painted`);
  }
  // no wash stroke starts on the bare paper bottom-left (9 dabs a stroke)
  assert.ok(!wash.some(([x, y], i) => i % 9 === 0 && x < 120 && y > 880), 'blank paper is not washed');
});

test('paint: pale paint first, dark paint later', () => {
  const plan = planStrokes(painting(), W, H);
  const wash = dabsOf(plan, plan.layers[0]);
  const when = (y0, y1) => { const d = wash.filter(([, y]) => y > y0 && y < y1); return d.reduce((s, x) => s + x[5], 0) / d.length; };
  assert.ok(when(0, 300) < when(620, 820), 'the pale sky is washed in before the dark shape');
});

test('paint: details where the painting is busy', () => {
  const plan = planStrokes(painting(), W, H);
  const det = dabsOf(plan, plan.layers[2]);
  const inBusy = det.filter(([x, y]) => x > 240 && x < 520 && y > 580 && y < 800).length / det.length;
  const busyShare = (280 * 220) / (W * H);
  assert.ok(inBusy > busyShare * 1.5, `detail strokes gather on the busy shape (${(inBusy * 100).toFixed(0)}% vs ${(busyShare * 100).toFixed(0)}% of the area)`);
});

test('paint: starts on the painting’s own white paper, or plain white paper', () => {
  assert.deepEqual(planStrokes(painting(), W, H).paper, [250, 248, 244]);
  const full = planStrokes(painting({ full: true }), W, H).paper;
  assert.ok(Math.min(...full) > 235, `a painting with no paper of its own starts on white (${full})`);
});

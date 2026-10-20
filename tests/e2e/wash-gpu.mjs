// The GPU wash (src/app/ui/wash.js) against the design's SVG filters: the
// same strokes drawn both ways, at three sizes, must give the same picture
// (the same noise, displacement, granulation and paper grain), and a
// recording on the GPU path must keep moving.
//
//   node server.js &  then  node tests/e2e/wash-gpu.mjs   (SHOTS=dir saves both)

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS;
const launch = (gl) => chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: gl ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--disable-webgl'] });

async function draw(gl, washes) {
  const browser = await launch(gl);
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '?ux-preview');
  await page.waitForSelector('[data-screen=diary]');
  const out = await page.evaluate(async (given) => {
    const app = window.sonmira;
    let ws = given;
    if (!ws) { await (await import('/src/app/dev.js')).seed(app); ws = app.sortedEntries().slice(0, 3).map((e) => e.painting.wash); }
    const { createPainting } = await import('/src/app/ui/painting.js');
    document.getElementById('stage').remove();
    document.querySelector('.ux-preview-badge')?.remove();
    document.body.style.cssText = 'margin:0;background:#F8F5EF';
    [[345, '32'], [345, '45'], [112, '32']].forEach(([w, r], i) => {
      const box = document.createElement('div');
      box.style.cssText = `width:${w}px;margin:24px`;
      box.append(createPainting({ ratio: r, strokes: ws[i] }).el);
      document.body.append(box);
    });
    return { ws, gpu: document.querySelectorAll('.wash.gl').length };
  }, washes);
  await page.waitForTimeout(1500);
  const png = await page.screenshot({ fullPage: true });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/wash-${gl ? 'gpu' : 'svg'}.png`, fullPage: true });
  // the same three paintings' pixels, for comparison
  const pixels = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, c.width, c.height).data);
  }, png.toString('base64'));
  await browser.close();
  return { ...out, pixels, errors };
}

const svg = await draw(false);
assert.equal(svg.gpu, 0, 'WebGL off: the SVG filter');
const gpu = await draw(true, svg.ws);
assert.equal(gpu.gpu, 3, 'WebGL on: the GPU wash');
assert.deepEqual([...svg.errors, ...gpu.errors], [], 'no page errors');
assert.equal(svg.pixels.length, gpu.pixels.length);
let sum = 0, big = 0;
for (let i = 0; i < svg.pixels.length; i += 4) {
  const d = (Math.abs(svg.pixels[i] - gpu.pixels[i]) + Math.abs(svg.pixels[i + 1] - gpu.pixels[i + 1]) + Math.abs(svg.pixels[i + 2] - gpu.pixels[i + 2])) / 3;
  sum += d; if (d > 32) big++;
}
const n = svg.pixels.length / 4, mean = sum / n;
console.log(`GPU vs SVG filter: mean difference ${mean.toFixed(2)} / 255, ${(100 * big / n).toFixed(2)}% of pixels off by more than 32`);
assert.ok(mean < 6, 'the GPU wash looks like the SVG filter');
assert.ok(big / n < 0.01, 'no region differs');

// A recording on the GPU path: the card keeps changing.
{
  const browser = await launch(true);
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  await page.goto(BASE + '?ux-preview');
  await page.waitForSelector('[data-screen=diary]');
  await page.click('.fab');
  await page.click('[aria-label="Start recording"]');
  await page.waitForTimeout(2500);
  const card = await page.$('.sing .painting');
  const a = await card.screenshot(), b = await (await page.waitForTimeout(1500), card.screenshot());
  assert.ok(await page.$('.sing .wash.gl canvas'), 'the GPU wash is drawing');
  assert.ok(Number(await page.$eval('.sing .wash', (w) => w.dataset.strokes)) > 3, 'strokes follow the voice');
  assert.notDeepEqual(a, b, 'the wash moves while singing');
  await browser.close();
}
console.log('wash gpu: ok');

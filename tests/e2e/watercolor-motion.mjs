// Visual check of the recording/processing watercolor (mocked, slow
// services; no paid calls). Measures real frame-to-frame change of the card
// during processing, not just the presence of a class, and saves frames.
//
//   node server.js &  then  node tests/e2e/watercolor-motion.mjs [outDir]
//   REDUCED=1 → reduced motion (expects no movement)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const OUT = process.argv[2] || null;
const REDUCED = Boolean(process.env.REDUCED);
const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (OUT) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: REDUCED ? 'reduce' : 'no-preference' });
await ctx.route('**/api/understand', async (route) => { await sleep(60000); route.abort(); });
const page = await ctx.newPage();
await page.goto(BASE);
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('sonmira'); q.onsuccess = q.onerror = q.onblocked = r; }));
await page.reload();
await page.waitForSelector('[data-screen=diary]');
await page.click('.fab');
await page.click('[aria-label="Start recording"]');
await page.waitForSelector('[data-phase=singing]');
await sleep(4500);
const card = await page.$('.sing .painting');
if (OUT) await card.screenshot({ path: `${OUT}/1-recording.png` });
await page.click('[aria-label="Stop recording"]');
await page.waitForSelector('[data-phase=preview]');
await sleep(800);
if (OUT) await card.screenshot({ path: `${OUT}/2-preview.png` });
await page.click('text=Create painting');
await page.waitForSelector('[data-phase=generating]');

// Frames of the card while processing; mean absolute pixel change between them.
const frames = [];
for (let i = 0; i < 6; i++) {
  await sleep(1000);
  frames.push(await card.screenshot({ path: OUT ? `${OUT}/3-processing-${i}s.png` : undefined }));
}
const diffs = await page.evaluate(async (pngs) => {
  const load = async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = new OffscreenCanvas(im.width, im.height); const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height).data; };
  const px = await Promise.all(pngs.map(load));
  return px.slice(1).map((b, i) => { const a = px[i]; let s = 0; for (let k = 0; k < a.length; k += 4) s += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]); return s / (a.length / 4) / 3; });
}, frames.map((f) => f.toString('base64')));
// Smoothness: frame times of the page during processing.
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else r(n / 2); }; requestAnimationFrame(tick); }));
console.log('mean |Δ| per second (0–255):', diffs.map((d) => d.toFixed(2)).join(', '), '· fps', fps);
if (REDUCED) assert.ok(Math.max(...diffs) < 0.3, 'still under reduced motion');
else assert.ok(Math.min(...diffs) > 1.0, 'the watercolor visibly moves every second while processing');
await browser.close();
console.log('watercolor motion: ok');

// The processing state with slow, mocked services (no paid calls): the same
// recording wash continues and develops, real stage messages appear in
// order, a hairline (no percentage) shows activity, the page stays
// responsive, the artwork is revealed only once decoded, a timeout recovers
// with Try again, analyze-only never claims a painting, and reduced motion
// stops the movement.
//
//   node server.js &  then  node tests/e2e/loading.mjs   (SHOTS=dir saves screenshots)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS;
const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const jpg = readFileSync(fileURLToPath(new URL('../../assets/art/impression-1.png', import.meta.url))).toString('base64');
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });

async function session({ reducedMotion = 'no-preference', dev = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion });
  const calls = { understand: 0, generate: 0 };
  const mode = { generate: 'ok' };
  await ctx.route('**/api/understand', async (route) => {
    calls.understand++;
    await sleep(1800);
    route.fulfill({ json: { ok: true, transcript: { text: 'I will wait for you by the sea tonight', wordCount: 9, lexicalWords: 9, distinctLexicalWords: 9, nonLexicalWords: 0, lexicalRatio: 1, musicTags: 0, hallucination: false, asrConfidence: 0.95 },
      lyrics: { language: 'en', lexical: true, coherent: true, structure: 'clause', unfinished: false, linked: true, missing: '', phraseComplete: true, completionConfidence: 0.9, completionReason: 'a full clause', theme: ['longing'], imagery: ['the sea at night'], figurative: [], mood: 'melancholic', motif: 'water', concepts: { loose: 'slow swells', gathered: 'a dark horizon', resolved: 'a small boat on a night sea' } } } });
  });
  await ctx.route('**/api/generate', async (route) => {
    calls.generate++;
    if (mode.generate === 'hang') return; // never answers: the engine's timeout must end it
    await sleep(3500);
    route.fulfill({ json: { ok: true, provider: 'openai', model: 'gpt-image-2', family: 'R5-light-as-subject', reference: 'resolved_09', referenceSent: true, seed: 1, image: `data:image/png;base64,${jpg}` } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Short engine timeouts for the hang case are injected through the dev hook below.
  await page.goto(BASE + (dev ? '?dev' : ''));
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('sonmira'); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.reload();
  await page.waitForSelector('[data-screen=diary]');
  // Record ~4 s, stop.
  await page.click('.fab');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await sleep(1500);
  const scaleWhileSinging = await page.$eval('.sing .painting .wash', (w) => w.style.scale);
  await sleep(2500);
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
  return { ctx, page, calls, mode, errors, scaleWhileSinging };
}

// Records every text the status line shows, with timestamps.
const watchLine = (page) => page.evaluate(() => {
  window.__lines = [];
  const t0 = performance.now();
  const seen = () => { const l = document.querySelector('[data-phase=generating] .line'); if (l && l.style.opacity !== '0' && window.__lines.at(-1)?.text !== l.textContent) window.__lines.push({ text: l.textContent, t: Math.round(performance.now() - t0) }); };
  window.__lineObs = setInterval(seen, 50);
});

// 1. Full run: stages, continuity, responsiveness, reveal.
{
  const s = await session();
  assert.ok(s.scaleWhileSinging && Number(s.scaleWhileSinging) >= 1, `the wash follows the voice while singing (scale ${s.scaleWhileSinging})`);
  const strokesBefore = await s.page.$$eval('.sing .painting .stroke', (x) => x.length);
  assert.ok(strokesBefore > 3, 'the recording wash is on the card');
  const t0 = Date.now();
  await s.page.click('text=Create painting');
  await s.page.waitForSelector('[data-phase=generating]');
  assert.ok(Date.now() - t0 < 500, 'processing feedback appears at once');
  await watchLine(s.page);
  // Same card, same strokes, now developing; hairline present; no percentage anywhere.
  assert.equal(await s.page.$$eval('.sing .painting .stroke', (x) => x.length), strokesBefore, 'no reset of the watercolour');
  assert.ok(await s.page.$('.sing .painting.developing'));
  assert.ok(await s.page.$('[data-phase=generating] .develop-track .develop-run'));
  assert.doesNotMatch(await s.page.textContent('[data-phase=generating]'), /\d+\s*%/);
  assert.equal(await s.page.getAttribute('[data-phase=generating] .line', 'role'), 'status');
  await sleep(700);
  await shot(s.page, 'loading-1-listening');
  // Responsive: the main thread answers quickly during processing.
  const lag = await s.page.evaluate(() => new Promise((r) => { const a = performance.now(); setTimeout(() => r(performance.now() - a), 0); }));
  assert.ok(lag < 100, `main thread lag ${lag} ms`);
  const anim = await s.page.$eval('.sing .painting .wash', (w) => getComputedStyle(w).animationName);
  assert.equal(anim, 'washDevelop');
  // Double submission is impossible: the Create button is gone.
  assert.equal(await s.page.$('text=Create painting'), null);
  await s.page.waitForSelector('[data-phase=result]', { timeout: 15000 });
  const lines = await s.page.evaluate(() => window.__lines.map((l) => l.text));
  const order = ['Listening to your words…', 'Finding the feeling…', 'Letting colours take shape…'];
  assert.deepEqual(lines.filter((l) => order.includes(l)), order, 'real stages in order: ' + JSON.stringify(lines));
  assert.equal(s.calls.generate, 1, 'one image request; the animation makes none');
  await sleep(1600);
  assert.doesNotMatch(await s.page.$eval('[data-screen=sing]', (e) => e.innerText), /\b(loose|gathered|resolved)\b|_complete|_words/i);
  const art = await s.page.$eval('.painting img.art', (i) => ({ hidden: i.classList.contains('hidden'), loaded: i.complete && i.naturalWidth > 0 }));
  assert.deepEqual(art, { hidden: false, loaded: true });
  await shot(s.page, 'loading-2-revealed');
  assert.deepEqual(s.errors, []);
  await s.ctx.close();
  console.log('full run: ok', JSON.stringify(lines));
}

// 2. Generation failure, then retry; analysis timeout handled by the engine's timeout.
{
  const s = await session();
  await s.ctx.unroute('**/api/generate');
  let n = 0;
  await s.ctx.route('**/api/generate', async (route) => { n++; await sleep(800); if (n === 1) return route.fulfill({ status: 504, json: { ok: false, code: 'timeout', error: 'upstream timeout' } }); route.fulfill({ json: { ok: true, image: `data:image/png;base64,${jpg}` } }); });
  await s.page.click('text=Create painting');
  await s.page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 15000 });
  assert.ok(await s.page.$('.sing .painting.developing.resting'), 'the wash holds still, no jump');
  assert.equal(await s.page.$('.develop-track'), null, 'not stuck in loading');
  await shot(s.page, 'loading-3-error');
  await sleep(600);
  await s.page.click('[data-kind=generation] .pill');
  await s.page.waitForSelector('[data-phase=generating]');
  assert.equal(await s.page.$('.sing .painting.resting'), null, 'moving again on retry');
  await s.page.waitForSelector('[data-phase=result]', { timeout: 15000 });
  await s.ctx.close();
  console.log('error + retry: ok');
}

// 3. Analyze only (dev): analysis stages, never "colours take shape", no image request.
{
  const s = await session({ dev: true });
  await s.page.click('.devpanel summary');
  await s.page.check('text=analyze only (no image call) >> input');
  await s.page.click('.devpanel summary');
  await s.page.click('text=Create painting');
  await s.page.waitForSelector('[data-phase=generating]');
  await watchLine(s.page);
  await s.page.waitForSelector('[data-phase=analyzed]', { timeout: 15000 });
  const lines = await s.page.evaluate(() => window.__lines.map((l) => l.text));
  assert.ok(!lines.includes('Letting colours take shape…'), JSON.stringify(lines));
  assert.equal(s.calls.generate, 0);
  const shown = await s.page.textContent('[data-phase=analyzed]');
  assert.match(shown, /Analysis complete/);
  // Internal states stay in the dev panel, never in the product UI.
  const mainText = await s.page.$eval('[data-screen=sing]', (e) => e.innerText);
  assert.doesNotMatch(mainText, /\b(loose|gathered|resolved)\b|lexical_words|asr_confident|phrase_complete|no painting was made/i);
  await shot(s.page, 'loading-4-analyzed');
  await s.ctx.close();
  console.log('analyze only: ok', JSON.stringify(lines));
}

// 4. Reduced motion: the wash does not move; the hairline only fades.
{
  const s = await session({ reducedMotion: 'reduce' });
  await s.page.click('text=Create painting');
  await s.page.waitForSelector('[data-phase=generating]');
  const m = await s.page.evaluate(() => ({ wash: getComputedStyle(document.querySelector('.sing .painting .wash')).animationName, scale: getComputedStyle(document.querySelector('.sing .painting .wash')).scale, run: getComputedStyle(document.querySelector('.develop-run')).animationName }));
  assert.deepEqual(m, { wash: 'none', scale: 'none', run: 'developBreathe' });
  await s.page.waitForSelector('[data-phase=result]', { timeout: 15000 });
  await s.ctx.close();
  console.log('reduced motion: ok');
}

await browser.close();
console.log('loading e2e: all checks passed');

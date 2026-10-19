// The token-free UX Preview (?ux-preview, src/app/ux-preview.js): the whole
// post-recording flow with no invitation code, no AI or other paid request
// and no painting counted, labelled Mock · UX Preview; and without the
// switch, the app as before (the AI engine, the microphone, no label).
//
//   node server.js &  then  node tests/e2e/ux-preview.mjs

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] });

// A fresh browser: no install token, no invitation accepted, no microphone.
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [], requests = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => { if (r.url().startsWith('blob:')) return; const u = new URL(r.url()); if (u.pathname.startsWith('/api/') || !['localhost', '127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname)) requests.push(r.method() + ' ' + u.host + u.pathname); });

await page.goto(BASE + '?ux-preview');
await page.waitForSelector('[data-screen=diary]');
assert.match(await page.textContent('[data-ux-preview]'), /Mock · UX Preview/);
assert.equal(await page.evaluate(() => window.sonmira.engine.id), 'mock-v1', 'the mock engine');
const wallet = () => page.evaluate(() => [localStorage.getItem('sonmira.wallet'), localStorage.getItem('sonmira.sim.ledger')]);
const before = await wallet();

for (const round of [1, 2]) { // repeatable: each round is a fresh sample painting, nothing used up
  await page.click('.fab');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await page.waitForTimeout(2500);
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
  await page.click('[data-phase=preview] .play-btn'); // the sample recording plays
  await page.waitForFunction(() => document.querySelector('[data-phase=preview] .times span').textContent !== '0:00');
  await page.click('text=Create painting');
  await page.waitForSelector('[data-step=expanded]', { timeout: 15000 });
  assert.equal(await page.$('[data-sheet]'), null, 'no invitation sheet');
  assert.ok(await page.isVisible('[data-ux-preview]'), 'labelled over the painting');
  await page.click('text=Next');
  await page.fill('[data-step=journal] .caption-input', `Preview ${round}`);
  await page.fill('[data-step=journal] .journal-input', 'Sample journal.\n\nSecond paragraph.');
  await page.click('[data-step=journal] .pill');
  await page.waitForSelector(`.entry .cap:text("Preview ${round}")`);
}
await page.click(`.entry:has-text("Preview 1")`);
await page.waitForSelector('[data-screen=detail] .journal-text');
assert.equal(await page.textContent('[data-screen=detail] .journal-text'), 'Sample journal.\n\nSecond paragraph.');
assert.deepEqual(await wallet(), before, 'no painting counted');
assert.deepEqual(requests.filter((r) => /\/api\/(generate|understand|reference)|openai|googleapis\.com\/v/.test(r)), [], 'no AI requests: ' + requests.join(', '));
assert.deepEqual(errors, [], 'no page errors');

// Without the switch: the app as before.
const plain = await browser.newPage();
await plain.goto(BASE);
await plain.waitForSelector('[data-screen=diary]');
assert.equal(await plain.$('[data-ux-preview]'), null, 'no label');
assert.deepEqual(await plain.evaluate(() => [window.sonmira.engine.id === 'mock-v1', window.sonmira.dev.simulate, window.sonmira.dev.uxPreview]), [false, false, false], 'the AI engine and the microphone');

await browser.close();
console.log('ux preview: ok', requests.length ? `(other requests: ${[...new Set(requests)].join(', ')})` : '(no other requests)');

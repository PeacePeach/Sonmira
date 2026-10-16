// End-to-end check in Chromium at iPhone size with a fake microphone that
// "sings" tests/e2e/hum.wav. Covers the 11 prototype requirements plus the
// mic-denied and too-short edge cases.
//
//   npm i -D playwright && npx playwright install chromium   (once)
//   node server.js &  then  npm run e2e        (SHOTS=dir saves screenshots)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const ENGINE = process.env.ENGINE_ID ? `engine=${process.env.ENGINE_ID}` : '';
const SHOTS = process.env.SHOTS;
const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const exe = process.env.CHROMIUM_PATH;

const viewport = { width: 393, height: 852 }; // iPhone 15
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const advanced = (page, sel) => page.waitForFunction((s) => document.querySelector(s)?.textContent !== '0:00', sel, { timeout: 5000 });
const url = (q = '') => BASE + '?' + [ENGINE, q].filter(Boolean).join('&');

async function run() {
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // fresh diary
  await page.goto(url());
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('sonmira'); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-screen=diary] .empty');
  await page.waitForTimeout(400);
  await shot(page, '01-diary-empty');

  // 1. start recording
  await page.click('.fab');
  await page.waitForSelector('[data-phase=ready]');
  await page.waitForTimeout(500);
  await shot(page, '02-sing-ready');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await page.waitForTimeout(4200);
  await shot(page, '03-singing');
  // 2. stop
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
  await page.waitForTimeout(300);
  await shot(page, '04-preview');
  // 3. play back
  await page.click('[data-phase=preview] .play-btn');
  await advanced(page, '[data-phase=preview] .times span'); // preview playback advances
  // 4. retry, then record again to the time limit (15 s)
  await page.click('text=Sing again');
  await page.waitForSelector('[data-phase=ready]');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=preview]', { timeout: 20000 });
  const recorded = await page.textContent('[data-phase=preview] .caps');
  assert.match(recorded, /0:1[45]/, 'auto-stop at 15 s, got ' + recorded);
  // 5. note
  await page.fill('.caption-input', 'Rain on the window');
  // 6. generate
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=generating]');
  await page.waitForTimeout(400);
  await shot(page, '05-generating');
  await page.waitForSelector('[data-phase=result]', { timeout: 8000 });
  await page.waitForTimeout(1600);
  await shot(page, '06-result');
  // 7. result contents
  assert.equal(await page.inputValue('.caption-input'), 'Rain on the window');
  assert.ok(await page.$('.painting img.art'), 'result shows artwork');
  await page.fill('.caption-input', 'Rain on the window, again');
  // 8. save
  await page.click('text=Keep it');
  await page.waitForSelector('[data-screen=diary] .entry');
  await page.waitForTimeout(600);
  await shot(page, '07-diary-one');
  assert.equal(await page.textContent('.entry .cap'), 'Rain on the window, again');
  // 9. open entry, 10. replay
  await page.click('.entry');
  await page.waitForSelector('[data-screen=detail]');
  await page.waitForTimeout(500);
  await page.click('[data-screen=detail] .play-btn');
  await advanced(page, '[data-screen=detail] .times span'); // detail playback advances
  await shot(page, '08-detail');
  // 11. reload keeps it
  await page.reload();
  await page.waitForSelector('[data-screen=diary] .entry');
  await page.click('.entry');
  await page.waitForSelector('[data-screen=detail]');
  await page.click('[data-screen=detail] .play-btn');
  await advanced(page, '[data-screen=detail] .times span'); // audio survives reload
  await page.click('[aria-label="Back to diary"]');

  // calendar + settings
  await page.click('[aria-label="Show calendar"]');
  await page.waitForTimeout(300);
  await shot(page, '09-calendar');
  await page.click('[aria-label="Show list"]');
  await page.click('[aria-label="Settings"]');
  await page.waitForSelector('[data-screen=settings]');
  await page.click('text=Recording length');
  assert.match(await page.textContent('[data-screen=settings]'), /30 seconds/);
  await page.click('text=Recording length');
  await page.waitForTimeout(300);
  await shot(page, '10-settings');
  await page.click('text=Privacy policy');
  await page.waitForSelector('[data-screen=legal]');
  await shot(page, '11-privacy');
  await page.click('[aria-label="Back to settings"]');
  await page.click('[aria-label="Back to diary"]');

  // too-short take goes back to ready with a hint
  await page.click('.fab');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await page.waitForTimeout(500);
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=ready] .soft-warning');
  await shot(page, '12-too-short');

  // delete with confirm
  await page.click('[aria-label="Close"]');
  await page.click('.entry');
  await page.click('text=Delete');
  await page.click('text=Delete this painting?');
  await page.waitForSelector('[data-screen=diary] .empty');
  await ctx.close();

  // mic denied
  const denied = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await denied.newPage();
  await p2.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await p2.goto(url());
  await p2.click('.fab');
  await p2.click('[aria-label="Start recording"]');
  await p2.waitForSelector('[data-phase=error][data-kind=denied]');
  await p2.waitForTimeout(400);
  await shot(p2, '13-mic-denied');
  await denied.close();

  await browser.close();
  assert.deepEqual(errors, [], 'no page errors');
  console.log('e2e: all checks passed');
}

run().catch((e) => { console.error(e); process.exit(1); });

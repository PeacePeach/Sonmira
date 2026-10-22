// Launch screen (index.html #launch, src/app/ui/launch.js): the official
// Sonmira mark and slogan on the paper colour from the first paint, faded out once the diary is
// in, then gone; no white frame on the way; reduced motion drops the pulse.
//
//   node server.js &  then  node tests/e2e/launch.mjs

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE || 'http://localhost:5173/';
const OUT = process.env.OUT;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

async function run({ reducedMotion = 'no-preference', delayMs = 1200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A slow network for the app code, so the launch screen is on screen a while.
  await page.route('**/src/app/main.js', async (r) => { await new Promise((ok) => setTimeout(ok, delayMs)); r.continue(); });
  await page.goto(BASE + '?ux-preview', { waitUntil: 'commit' });
  await page.waitForSelector('#launch img');

  const img = await page.$eval('#launch img', (i) => ({ src: new URL(i.src).pathname, w: i.naturalWidth, anim: getComputedStyle(i).animationName, slogan: i.nextElementSibling?.textContent }));
  if (OUT) await page.waitForSelector('#launch.font').catch(() => {});
  const frames = [];
  // Sample the screen through startup and the fade: every frame must be paper or app, never white.
  const t0 = Date.now();
  while (Date.now() - t0 < delayMs + 2500) {
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 393, height: 852 }, scale: 'css', type: 'png' });
    const state = await page.evaluate(() => ({ launch: !!document.getElementById('launch'), done: !!document.querySelector('#launch.done'), diary: !!document.querySelector('[data-screen=diary]'), launches: document.querySelectorAll('#launch').length, bg: getComputedStyle(document.getElementById('launch') || document.body).backgroundColor }));
    frames.push({ t: Date.now() - t0, shot, ...state });
    if (!state.launch && state.diary && frames.filter((f) => !f.launch).length > 2) break;
  }
  await page.waitForSelector('[data-screen=diary]');
  await page.waitForFunction(() => !document.getElementById('launch'), null, { timeout: 3000 });
  // Navigation never brings it back.
  await page.click('.fab');
  await page.waitForSelector('[data-screen=sing]');
  const after = await page.evaluate(() => document.querySelectorAll('#launch').length);
  await ctx.close();
  return { img, frames, after, errors };
}

const normal = await run();
assert.equal(normal.img.src, '/assets/brand/sonmira-mark.svg', 'the official mark file');
assert.ok(normal.img.w > 0, 'mark loaded');
assert.equal(normal.img.slogan, 'Sing your moments into paintings.');
assert.ok(normal.frames.every((f) => f.launches <= 1), 'one launch screen at most');
assert.ok(normal.frames.filter((f) => f.launch).every((f) => f.bg === 'rgb(248, 245, 239)'), 'paper colour, as the native launch screen');
assert.ok(normal.frames.some((f) => f.launch && !f.done), 'shown while starting');
assert.ok(normal.frames.some((f) => !f.launch), 'removed once the diary is in');
assert.equal(normal.after, 0);
assert.deepEqual(normal.errors, []);

const reduced = await run({ reducedMotion: 'reduce' });
assert.doesNotMatch(reduced.img.anim, /launch-breathe/, 'no pulse with Reduce Motion');
assert.deepEqual(reduced.errors, []);

if (OUT) {
  await mkdir(OUT, { recursive: true });
  for (const [name, r] of [['normal', normal], ['reduced', reduced]]) {
    for (const [i, f] of r.frames.entries()) await writeFile(`${OUT}/${name}-${String(i).padStart(3, '0')}-${f.t}ms${f.done ? '-fading' : ''}${f.launch ? '' : '-gone'}.png`, f.shot);
  }
}
console.log('launch screen ok:', normal.frames.length, 'frames,', reduced.frames.length, 'with reduced motion');
await browser.close();

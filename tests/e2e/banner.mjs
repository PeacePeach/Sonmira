// In-app banners (src/app/ui/banner.js, Han 21 Oct): one look for success,
// info, warning and error; below the top bar, clear of the screen's actions;
// one at a time; timed by length; a tap dismisses; Reduce Motion only fades.
//
//   node server.js &  then  node tests/e2e/banner.mjs

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--disable-webgl'] });

async function open(reducedMotion = 'no-preference') {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '?ux-preview');
  await page.waitForSelector('[data-screen=diary]');
  return { page, errors };
}
const show = (page, msg, opts) => page.evaluate(([msg, opts]) => window.sonmira.toast(msg, opts), [msg, opts]);
const box = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }, sel);

const { page, errors } = await open();
assert.ok(await page.evaluate(() => typeof window.sonmira?.toast === 'function'), 'the app exposes toast for tests');

// Every kind: the same component, its own icon, role by urgency.
for (const [kind, iconName, role] of [['success', 'check', 'status'], ['info', 'info', 'status'], ['warning', 'warning', 'status'], ['error', 'error', 'alert']]) {
  await show(page, `A ${kind} message.`, { kind });
  const b = await page.evaluate(() => { const el = document.querySelector('.banner'); return { n: document.querySelectorAll('.banner').length, kind: el.dataset.kind, icon: el.querySelector('svg')?.dataset.icon, role: el.getAttribute('role'), cls: el.className }; });
  assert.deepEqual([b.n, b.kind, b.icon, b.role], [1, kind, iconName, role], `${kind}: one banner at a time`);
  assert.match(b.cls, /\btoast\b/);
}
await show(page, 'Legacy call with a duration.', 3000);
assert.equal(await page.evaluate(() => document.querySelector('.banner').dataset.kind), 'info');

// Placement: below the top bar, clear of the + button, inside the screen.
const top = await box(page, '.diary-top');
const fab = await box(page, '.fab');
await show(page, 'Signed in. Your paintings and purchases now stay with your Apple ID.', { kind: 'success' });
const b = await box(page, '.banner');
assert.ok(b.top >= top.bottom - 1, `below the top bar (${b.top} vs ${top.bottom})`);
assert.ok(b.bottom < fab.top, 'clear of the + button');
assert.ok(b.left >= 16 && b.right <= 393 - 16, 'inside the side margins');

// A tap dismisses it; it is gone after its fade.
await page.click('.banner');
await page.waitForSelector('.banner', { state: 'detached', timeout: 1000 });

// Timed by length: a short success goes in about 2 s.
await show(page, 'Saved.', { kind: 'success' });
await page.waitForTimeout(1500);
assert.ok(await page.$('.banner'), 'still readable at 1.5 s');
await page.waitForSelector('.banner', { state: 'detached', timeout: 2000 });

// Reduce Motion: a fade only, no movement.
const rm = await open('reduce');
await show(rm.page, 'Couldn’t save just now. Please try again.', { kind: 'error' });
assert.equal(await rm.page.evaluate(() => getComputedStyle(document.querySelector('.banner')).animationName), 'fadeIn');

assert.deepEqual([...errors, ...rm.errors], []);
await browser.close();
console.log('banner: all checks passed');

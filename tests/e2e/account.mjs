// End-to-end check of the account screens with the development Sign in with
// Apple simulator, in Chromium at iPhone size.
//
//   SONMIRA_PROTECT=off SONMIRA_FAKE_PROVIDER=1 SONMIRA_FAKE_DELAY_MS=1000 PORT=5173 node tests/e2e/guarded-server.mjs &
//   then  node tests/e2e/account.mjs      (SHOTS=dir saves screenshots)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS;
const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const signedIn = (page) => page.evaluate(() => window.sonmira.account.status().signedIn);
const accountId = (page) => page.evaluate(() => window.sonmira.account.id);

async function apple(page, outcome) {
  await page.waitForSelector(`[data-sim-apple=${outcome}]`);
  await settle(page, 350);
  await page.click(`[data-sim-apple=${outcome}]`);
}
async function toast(page, re) {
  await page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 5000 });
}
async function openAccount(page) {
  if (!(await page.$('[data-screen=settings]'))) {
    await page.click('[data-screen=diary] [aria-label=Settings]');
    await page.waitForSelector('[data-screen=settings]');
  }
  await page.click('[data-account-row]');
  await page.waitForSelector('[data-screen=account]');
}

async function run() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // Past the beta invitation: a stand-in token for this device's id (protect/client.js).
  await ctx.addInitScript(() => { let a = null; try { a = JSON.parse(localStorage.getItem('sonmira.account')); } catch {} if (!a?.id) { a = { id: 'e2e-device-00000001', token: null, user: null, since: null }; localStorage.setItem('sonmira.account', JSON.stringify(a)); } localStorage.setItem('sonmira.access', `v1.${btoa(JSON.stringify({ i: a.id }))}.mock`); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE);
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('sonmira'); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-screen=diary] .empty');

  // A. guest-first: a painting is made and kept with no sign-in anywhere
  await page.click('.fab');
  await page.waitForSelector('[data-phase=ready]');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await page.waitForTimeout(2600);
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
  await page.fill('.caption-input', 'Morning hum');
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=result]', { timeout: 8000 });
  assert.equal(await page.$('[data-apple-sign-in]'), null);
  await page.click('text=Keep it');
  await page.waitForSelector('[data-screen=diary] .entry');
  assert.equal(await signedIn(page), false);
  const guestId = await accountId(page);
  assert.match(guestId, /^[A-Za-z0-9_-]{16,64}$/);

  // B. Settings → Account, guest
  await page.click('[data-screen=diary] [aria-label=Settings]');
  await page.waitForSelector('[data-screen=settings]');
  assert.match(await page.textContent('[data-account-row]'), /Account.*On this iPhone/);
  await page.$eval('[data-account-row]', (el) => el.scrollIntoView({ block: 'center' }));
  await settle(page);
  await shot(page, 'a01-settings-account-row');
  await page.click('[data-account-row]');
  await page.waitForSelector('[data-screen=account]');
  await settle(page);
  await shot(page, 'a02-account-guest');
  const guestText = await page.textContent('[data-screen=account]');
  assert.match(guestText, /Sonmira works without an account\./);
  assert.match(guestText, /Diary.*This iPhone.*Original recordings.*This iPhone.*Paintings.*This iPhone/s);
  assert.match(guestText, /doesn’t back these up or bring them to another device/);
  assert.match(guestText, /name or email/);

  // C. Apple's sheet: cancel, offline, no Apple ID, server failure
  await page.click('[data-apple-sign-in]');
  await page.waitForSelector('[data-sim-apple]');
  await settle(page, 500);
  await shot(page, 'a03-apple-simulator');
  await apple(page, 'cancel');
  await page.waitForSelector('[data-apple-sign-in]:not([disabled])');
  assert.equal((await page.textContent('.pw-message')).trim(), '', 'a cancel says nothing');
  await page.click('[data-apple-sign-in]');
  await apple(page, 'network');
  await page.waitForSelector('.pw-message:has-text("offline")');
  await settle(page);
  await shot(page, 'a04-error-offline');
  await page.click('[data-apple-sign-in]');
  await apple(page, 'notAvailable');
  await page.waitForSelector('.pw-message:has-text("needs an Apple ID")');
  await page.click('[data-apple-sign-in]');
  await apple(page, 'serverDown');
  await page.waitForSelector('[data-apple-sign-in]:has-text("Signing in…")');
  await page.waitForSelector('.sim-panel', { state: 'detached' });
  await shot(page, 'a05-signing-in');
  await page.waitForSelector('.pw-message:has-text("couldn’t finish here")');
  assert.equal(await signedIn(page), false);
  assert.equal(await accountId(page), guestId);

  // D. signed in (new Apple ID): same id, linked
  await page.click('[data-apple-sign-in]');
  await apple(page, 'new');
  await page.waitForSelector('[data-signed-in]');
  await toast(page, /Signed in\. Your paintings and purchases now stay with your Apple ID\./);
  assert.equal(await accountId(page), guestId, 'linking keeps the guest id');
  await page.waitForSelector('.toast', { state: 'detached', timeout: 6000 });
  await shot(page, 'a06-account-signed-in');
  assert.match(await page.textContent('[data-signed-in]'), /Signed in with Apple.*Since/);

  // E. sign out: sheet, then a fresh guest; diary untouched
  await page.click('[data-sign-out]');
  await page.waitForSelector('[data-sign-out-sheet]');
  await settle(page, 500);
  await shot(page, 'a07-sign-out-sheet');
  await page.click('[data-confirm-sign-out]');
  await page.waitForSelector('[data-apple-sign-in]');
  await toast(page, /Signed out\. Your diary is still here\./);
  assert.notEqual(await accountId(page), guestId);

  // F. sign in again: welcome back, the account id comes back
  await page.click('[data-apple-sign-in]');
  await apple(page, 'new'); // a different new Apple ID would be a new account; use returning instead
  await page.waitForSelector('[data-signed-in]');
  await page.click('[data-sign-out]');
  await page.click('[data-confirm-sign-out]');
  await page.waitForSelector('[data-apple-sign-in]');
  await page.click('[data-apple-sign-in]');
  await apple(page, 'returning');
  await page.waitForSelector('[data-signed-in]');
  await toast(page, /Welcome back\. Your paintings and purchases are with you again\./);
  await settle(page, 300);
  await shot(page, 'a08-welcome-back');

  // G. delete account with an active Daily Ritual: the note, the erase choice, two taps, Apple confirms
  const buy = page.evaluate(() => window.sonmira.billing.purchase('app.sonmira.daily_ritual.monthly'));
  await page.waitForSelector('[data-sim=success]');
  await settle(page, 300);
  await page.click('[data-sim=success]');
  await buy;
  await page.click('[data-delete-account]');
  await page.waitForSelector('[data-screen=account-delete]');
  await page.waitForSelector('.toast', { state: 'detached', timeout: 6000 });
  await shot(page, 'a09-delete-account');
  assert.match(await page.textContent('[data-screen=account-delete]'), /doesn’t cancel Daily Ritual/);
  assert.equal(await page.getAttribute('[data-erase-diary]', 'aria-checked'), 'false', 'erasing the diary is off by default');
  await page.click('[data-delete-confirm]');
  assert.match(await page.textContent('[data-delete-confirm]'), /Tap again to delete/);
  await settle(page);
  await shot(page, 'a10-delete-tap-again');
  await page.click('[data-delete-confirm]');
  await apple(page, 'other');
  await page.waitForSelector('.pw-message:has-text("isn’t the one")');
  assert.equal(await signedIn(page), true, 'another Apple ID deletes nothing');
  await page.click('[data-delete-confirm]');
  await page.click('[data-delete-confirm]');
  await apple(page, 'same');
  await page.waitForSelector('[data-screen=settings]');
  await toast(page, /Your account has been deleted\. Your diary is still here\./);
  assert.equal(await signedIn(page), false);
  assert.equal(await page.evaluate(() => window.sonmira.entries.length), 1, 'the diary stays');

  // H. removed at Apple while away: next launch signs out quietly
  await openAccount(page);
  await page.click('[data-apple-sign-in]');
  await apple(page, 'new');
  await page.waitForSelector('[data-dev-revoke]');
  await page.click('[data-dev-revoke]');
  await page.reload();
  await page.waitForSelector('[data-screen=diary] .entry');
  await toast(page, /no longer signed in with Apple\. Your diary is still here\./);
  await settle(page, 300);
  await shot(page, 'a11-revoked-on-launch');
  assert.equal(await signedIn(page), false);

  // I. delete and erase the diary too
  await openAccount(page);
  await page.click('[data-apple-sign-in]');
  await apple(page, 'new');
  await page.click('[data-delete-account]');
  await page.waitForSelector('[data-screen=account-delete]');
  await page.click('[data-erase-diary]');
  await page.waitForSelector('.toast', { state: 'detached', timeout: 6000 });
  await shot(page, 'a12-delete-with-diary');
  await page.click('[data-delete-confirm]');
  assert.match(await page.textContent('[data-delete-confirm]'), /delete account and diary/);
  await page.click('[data-delete-confirm]');
  await apple(page, 'same');
  await page.waitForSelector('[data-screen=settings]');
  await toast(page, /account and this iPhone’s diary have been deleted/);
  await page.click('[aria-label="Back to diary"]');
  await page.waitForSelector('[data-screen=diary] .empty');
  await page.reload();
  await page.waitForSelector('[data-screen=diary] .empty');

  assert.deepEqual(errors, []);
  await browser.close();
  console.log('account e2e: all checks passed');
}

run().catch((e) => { console.error(e); process.exit(1); });

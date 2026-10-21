// End-to-end check of the paywall with the development purchase simulator,
// in Chromium at iPhone size with the fake microphone from flow.mjs.
//
//   SONMIRA_PROTECT=off SONMIRA_FAKE_PROVIDER=1 SONMIRA_FAKE_DELAY_MS=1000 PORT=5173 node tests/e2e/guarded-server.mjs &
//   then  node tests/e2e/paywall.mjs      (SHOTS=dir saves screenshots)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// After the painting: Next on the expanded artwork, the title (optional) in the journal step, then Save.
const keepIt = async (page, title) => {
  await page.click('[data-step=expanded] .pill');
  await page.waitForSelector('[data-step=journal] .caption-input');
  if (title) await page.fill('[data-step=journal] .caption-input', title);
  await page.click('[data-step=journal] .pill');
};

const BASE = process.env.BASE || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS;
const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const viewport = { width: 393, height: 852 };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const status = (page) => page.evaluate(() => window.sonmira.billing.status());
const settle = (page, ms = 450) => page.waitForTimeout(ms);

async function record(page, seconds = 2.6) {
  await page.waitForSelector('[data-phase=ready]');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await page.waitForTimeout(seconds * 1000);
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
}
async function paintAndKeep(page, note) {
  await record(page);
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=result]', { timeout: 8000 });
  await keepIt(page, note);
  await page.waitForSelector('[data-screen=diary] .entry');
}
async function simulate(page, outcome) {
  await page.waitForSelector(`[data-sim=${outcome}]`);
  await settle(page, 350);
  await page.click(`[data-sim=${outcome}]`);
}
const paywall = '[data-paywall]';

async function run() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // Past the beta invitation (run against tests/e2e/guarded-server.mjs with SONMIRA_PROTECT=off).
  await ctx.addInitScript(() => { /* the API is mocked: a stand-in token for this device's id (protect/client.js) */ let a = null; try { a = JSON.parse(localStorage.getItem('sonmira.account')); } catch {} if (!a?.id) { a = { id: 'e2e-device-00000001', token: null, user: null, since: null }; localStorage.setItem('sonmira.account', JSON.stringify(a)); } localStorage.setItem('sonmira.access', `v1.${btoa(JSON.stringify({ i: a.id }))}.mock`); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE);
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('sonmira'); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-screen=diary] .empty');

  // A. three free paintings, each saying what it uses
  const uses = [];
  for (const note of ['Morning hum', 'Walking home', 'A song for Mia']) {
    await page.click('.fab');
    await record(page);
    uses.push(await page.textContent('[data-uses]'));
    if (note === 'Morning hum') { await settle(page); await shot(page, 'p01-sing-uses-free'); }
    await page.click('text=Create painting');
    await page.waitForSelector('[data-phase=result]', { timeout: 8000 });
    await keepIt(page, note);
    await page.waitForSelector(`.entry .cap:text("${note}")`);
  }
  assert.deepEqual(uses, ['Uses 1 of your 3 paintings', 'Uses 1 of your 2 paintings', 'Uses your last painting']);
  assert.equal((await status(page)).canCreate, false);

  // the fourth tap on + opens the paywall over the diary
  await page.click('.fab');
  await page.waitForSelector(paywall);
  await settle(page, 600);
  await shot(page, 'p02-paywall');
  const text = await page.textContent(paywall);
  assert.match(text, /More moments to keep\./);
  assert.match(text, /Your first three paintings are on us/);
  assert.match(text, /Daily Ritual.*\$5\.99.*month/s);
  assert.match(text, /Little Moments.*\$2\.99/s);
  assert.match(text, /Restore purchases.*More information/s);
  assert.doesNotMatch(text, /Why we charge|Terms|Privacy/, 'the footer stays short; the rest is in More information');
  assert.match(await page.textContent(`${paywall} .pill`), /Add 10 paintings · \$2\.99/);
  assert.ok(await page.$(`${paywall} .pw-dev`), 'simulation is labeled');
  // close: the diary is untouched
  await page.click(`${paywall} [aria-label=Close]`);
  await page.waitForSelector(paywall, { state: 'detached' });
  assert.equal(await page.locator('.entry').count(), 3);
  await page.click('.entry');
  await page.waitForSelector('[data-screen=detail]');
  await page.click('[aria-label="Back to diary"]');

  // the subscription option, and More information
  await page.click('.fab');
  await page.waitForSelector(paywall);
  await page.click('[data-plan="app.sonmira.daily_ritual.monthly"]');
  assert.match(await page.textContent(`${paywall} .pill`), /Start Daily Ritual · \$5\.99 \/ month/);
  assert.match(await page.textContent(`${paywall} .pw-fine`), /renewing automatically until you cancel.*Unused credits roll over, up to 30, and never expire\./s);
  assert.match(await page.textContent(`${paywall} [data-plan="app.sonmira.daily_ritual.monthly"]`), /One painting credit every day\. Save up to 30\./);
  await settle(page);
  await shot(page, 'p03-paywall-daily-selected');
  await page.click('text=More information');
  await page.waitForSelector('.pw-info');
  await settle(page, 700);
  await shot(page, 'p04-more-information');
  const info = await page.textContent('.pw-info');
  assert.match(info, /Why we charge.*costs something to run/s);
  assert.match(info, /Daily Ritual: \$5\.99 a month, renewing automatically until you cancel/);
  assert.match(info, /Little Moments: \$2\.99, a one-time purchase/);
  await page.click('.pw-info >> text=Terms');
  await page.waitForSelector('.legal-sheet');
  const terms = await page.textContent('.legal-sheet');
  assert.match(terms, /auto-renewing monthly subscription.*one painting credit per day.*up to a balance of 30.*credits you have already received never expire.*never expire, are not part of the 30-credit limit/s);
  assert.doesNotMatch(terms, /30 days|used first/, 'no old retention rule, no spending order');
  assert.doesNotMatch(terms, /\$\d/, 'no fixed price in the Terms');
  await settle(page);
  await shot(page, 'p04b-terms-sheet');
  await page.click('.legal-sheet [aria-label=Close]');
  await page.waitForSelector('.legal-sheet', { state: 'detached' });
  await page.click('.pw-info [aria-label=Close]');
  await page.waitForSelector('.pw-info', { state: 'detached' });

  // C. Little Moments: cancelled, failed, offline, pending, approved
  await page.click('[data-plan="app.sonmira.little_moments.10"]');
  await page.click(`${paywall} .pill`);
  await page.waitForSelector('.sim-panel');
  await settle(page, 500);
  await shot(page, 'p05-simulator');
  await simulate(page, 'cancel');
  await page.waitForSelector(`${paywall} .pill:not([disabled])`);
  assert.equal((await page.textContent('.pw-message')).trim(), '', 'a cancel says nothing');
  await page.click(`${paywall} .pill`);
  await simulate(page, 'failed');
  await page.waitForSelector('.pw-message[data-tone=error]');
  assert.match(await page.textContent('.pw-message'), /nothing was charged/);
  await settle(page);
  await shot(page, 'p06-failed');
  await page.click(`${paywall} .pill`);
  await simulate(page, 'network');
  await page.waitForSelector('.pw-message:has-text("couldn’t reach the App Store")');
  await page.click(`${paywall} .pill`);
  await simulate(page, 'pending');
  await page.waitForSelector('.pw-message:has-text("Waiting for approval")');
  await settle(page);
  await shot(page, 'p07-pending');
  assert.equal((await status(page)).credits, 0, 'nothing added while pending');
  await page.click('.pw-sim-approve');
  await page.waitForSelector('[data-paywall-done]');
  await settle(page, 1500);
  await shot(page, 'p08-success-pack');
  assert.match(await page.textContent('[data-paywall-done]'), /Ten more moments\..*10 paintings added.*Simulated purchase · nothing was charged/s);
  assert.equal((await status(page)).credits, 10);
  await page.click('[data-paywall-done] .pill'); // Sing a moment

  // F. a failed generation uses nothing (with the engine work merged, the app
  // shows its "didn't come through" screen instead of a wash-only fallback)
  await record(page);
  assert.equal(await page.textContent('[data-uses]'), 'Uses 1 of your 10 paintings');
  await page.evaluate(() => {
    const eng = window.sonmira.engine, real = eng.generate;
    eng.generate = async () => { eng.generate = real; throw new Error('simulated engine failure'); };
  });
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 8000 });
  await settle(page);
  await shot(page, 'p09-generation-failed');
  assert.equal((await status(page)).credits, 10, 'failure uses nothing');
  await page.click('text=Sing again');
  await record(page);
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=result]', { timeout: 8000 });
  assert.equal((await status(page)).credits, 9, 'a made painting uses one');
  await keepIt(page);
  await page.waitForSelector('[data-screen=diary]');

  // restart while painting: the held painting comes back
  await page.click('.fab');
  await record(page);
  await page.evaluate(() => { const eng = window.sonmira.engine, real = eng.generate; eng.generate = (a) => new Promise((r) => setTimeout(() => r(real(a)), 4000)); });
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=generating]');
  assert.equal((await status(page)).credits, 8, 'held while painting');
  await page.reload();
  await page.waitForSelector('[data-screen=diary]');
  assert.equal((await status(page)).credits, 9, 'restart gives it back');

  // B + D. Daily Ritual from Settings, then a same-day extra from the pack
  await page.click('[aria-label="Settings"]');
  await page.waitForSelector('[data-paintings]');
  await page.click('text=More paintings');
  await page.waitForSelector(paywall);
  await page.click('[data-plan="app.sonmira.daily_ritual.monthly"]');
  await page.click(`${paywall} .pill`);
  await simulate(page, 'success');
  await page.waitForSelector('[data-paywall-done]');
  await settle(page, 1500);
  await shot(page, 'p10-success-daily');
  assert.match(await page.textContent('[data-paywall-done]'), /Your Daily Ritual begins\./);
  await page.click('[data-paywall-done] .quiet-btn');
  await settle(page);
  await shot(page, 'p11-settings-paintings');
  assert.match(await page.textContent('[data-available]'), /^Available10 paintings\+1 Daily Ritual credit tomorrow\sat\s/);
  assert.equal(await page.textContent('[data-sub-state]'), 'Active');
  assert.equal(await page.locator('[data-ritual-credits]').count(), 0, 'no separate Daily Ritual credits row');
  assert.equal(await page.locator('[data-pack-credits]').count(), 0, 'no separate Little Moments row');
  assert.doesNotMatch(await page.textContent('[data-paintings]'), /Little Moments|never expire|of 30|Renews/, 'one balance, no pools, no renewal date');
  await page.click('[aria-label="Back to diary"]');
  await page.click('.fab');
  await record(page);
  assert.equal(await page.textContent('[data-uses]'), 'Uses 1 of your 10 paintings');
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=result]', { timeout: 8000 });
  await keepIt(page);
  await page.waitForSelector('[data-screen=diary]');
  let s = await status(page);
  assert.deepEqual([s.ritual, s.credits, s.source], [0, 9, 'credits'], 'tomorrow’s credit is not lent today');

  // Two days later: two credits saved up, both usable the same day
  await page.click('[aria-label="Settings"]');
  await page.click('text=Start a new day');
  await page.click('text=Start a new day');
  assert.equal((await status(page)).ritual, 2);
  assert.match(await page.textContent('[data-available]'), /^Available11 paintings/);
  await page.click('[aria-label="Back to diary"]');

  // E. the subscription ends: diary, pack credits and Daily Ritual credits all stay
  await page.click('[aria-label="Settings"]');
  await page.click('text=Cancel Daily Ritual (stops renewing)');
  assert.match(await page.textContent('[data-sub-state]'), /^Ends /, 'cancelled: still active until it ends');
  await page.click('text=End Daily Ritual now');
  s = await status(page);
  assert.deepEqual([s.subscribed, s.credits, s.ritual], [false, 9, 2]);
  assert.match(await page.textContent('[data-sub-state]'), /^Ended /);
  assert.equal(await page.locator('[data-next-credit]').count(), 0, 'ended: no next credit');
  for (let i = 0; i < 30; i++) await page.evaluate(() => window.sonmira.billing.dev.nextDay());
  assert.equal((await status(page)).ritual, 2, 'still there 30 days after the end');
  assert.match(await page.textContent('[data-available]'), /^Available11 paintings$/);
  // reinstall: credits come back from the account ledger
  await page.click('text=Delete and reinstall the app');
  await page.waitForSelector('[data-screen=diary]');
  assert.equal((await status(page)).credits, 9);
  assert.equal(await page.locator('.entry').count(), 5, 'existing memories stay');

  // a subscriber who has used today's painting sees the pack only
  await page.evaluate(async () => {
    const b = window.sonmira.billing;
    // spend the pack, then subscribe again
    for (let i = 0; i < 11; i++) { b.reserve('spend' + i); b.commit('spend' + i); }
  });
  await page.click('.fab');
  await page.waitForSelector(paywall);
  assert.match(await page.textContent(paywall), /Your diary is just as you left it/);
  await page.click('[data-plan="app.sonmira.daily_ritual.monthly"]');
  await page.click(`${paywall} .pill`);
  await simulate(page, 'success');
  await page.waitForSelector('[data-paywall-done]');
  await page.click('[data-paywall-done] .quiet-btn');
  await page.evaluate(() => { const b = window.sonmira.billing; b.reserve('today'); b.commit('today'); });
  await page.click('.fab');
  await page.waitForSelector(paywall);
  await settle(page, 600);
  await shot(page, 'p12-paywall-extra-today');
  assert.match(await page.textContent(paywall), /Your credits are used for now\..*next credit tomorrow/s);
  assert.equal(await page.locator('[data-plan]').count(), 1, 'only the pack today');
  await page.click(`${paywall} [aria-label=Close]`);

  // restore with nothing new, and offline
  await page.click('[aria-label="Settings"]');
  await page.click('text=Restore purchases');
  await simulate(page, 'network');
  await page.waitForSelector('.toast:has-text("couldn’t reach the App Store")');
  await ctx.close();

  // the paywall at Create painting keeps the take and goes on after buying
  const c2 = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await c2.addInitScript(() => { /* the API is mocked: a stand-in token for this device's id (protect/client.js) */ let a = null; try { a = JSON.parse(localStorage.getItem('sonmira.account')); } catch {} if (!a?.id) { a = { id: 'e2e-device-00000001', token: null, user: null, since: null }; localStorage.setItem('sonmira.account', JSON.stringify(a)); } localStorage.setItem('sonmira.access', `v1.${btoa(JSON.stringify({ i: a.id }))}.mock`); });
  const p2 = await c2.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(BASE);
  await p2.evaluate(() => localStorage.clear());
  await p2.reload();
  await p2.waitForSelector('[data-screen=diary]');
  await p2.evaluate(() => { window.sonmira.billing.dev.useUpFree(); window.sonmira.navigate('sing'); });
  await record(p2);
  await p2.click('text=Create painting');
  await p2.waitForSelector(paywall);
  await p2.click(`${paywall} .pill`);
  await simulate(p2, 'success');
  await p2.waitForSelector('[data-paywall-done]');
  assert.equal(await p2.textContent('[data-paywall-done] .pill'), 'Create painting');
  await p2.click('[data-paywall-done] .pill');
  await p2.waitForSelector('[data-phase=result]', { timeout: 8000 });
  assert.ok(await p2.$('[data-step=expanded] .painting img.art, .painting img.art'), 'the take was painted after buying');
  assert.equal((await status(p2)).credits, 9);
  await c2.close();

  await browser.close();
  assert.deepEqual(errors, [], 'no page errors');
  console.log('paywall e2e: all checks passed');
}

run().catch((e) => { console.error(e); process.exit(1); });

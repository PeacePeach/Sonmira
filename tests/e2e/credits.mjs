// The final free painting, end to end, with the server counting paintings
// (SONMIRA_BILLING=on) and no paid calls (server/dev/fake-openai.js): the
// painting made with the last free painting stays fully usable at zero.
//
//   node tests/e2e/credits.mjs          (starts its own server)
//
// Covers, on the third (last) free painting: Save straight away (tapped
// twice); closed before Save, then opened from the drafts and saved; the app
// reopened after the painting arrived; the app reopened after the server
// finished a painting the app never saw; the answer lost on the way back,
// then Try again, or the app reopened and the draft painted again; and a
// failed painting that counts nothing.
//
// IOS=1 runs it as the iOS app does (a stand-in StoreKit plugin): the wallet
// then follows the server's ledger (/api/billing/status), which is where a
// take's key and the server's key for it must agree.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const CODE = 'BETA-TEST-01';

function startServer(port, env) {
  const proc = spawn(process.execPath, [fileURLToPath(new URL('./guarded-server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(port), QUIET: '1', SONMIRA_FAKE_PROVIDER: '1', SONMIRA_TOKEN_SECRET: 'e2e-secret-0123456789abcdefghij', SONMIRA_INVITE_CODES: CODE, SONMIRA_LIMIT_INSTALLS_PER_INVITE: '100', SONMIRA_LIMIT_IP_HOUR: '1000', SONMIRA_LIMIT_SESSION_IP_HOUR: '1000', SONMIRA_LIMIT_GENERATE_HOUR: '100', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve) => proc.stdout.on('data', (d) => { if (String(d).includes('guarded server')) resolve({ base: `http://localhost:${port}/`, stop: () => proc.kill() }); }));
}

const S = await startServer(5194, { SONMIRA_FAKE_DELAY_MS: '1200', SONMIRA_BILLING: 'on', SONMIRA_DAILY_CAP_USD: '50' });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required', '--disable-webgl'] });

const guardLog = async () => (await fetch(`${S.base}__test/guard-log`)).json();
const generations = async (me) => (await guardLog()).filter((e) => e.endpoint === 'generate' && e.install === me);
const charged = async (me) => (await generations(me)).filter((e) => e.outcome === 'ok').map((e) => e.charged);
const status = (page) => page.evaluate(() => window.sonmira.billing.status());
const drafts = (page) => page.evaluate(async () => (await window.sonmira.drafts.list()).map((d) => ({ key: d.key, status: d.status, hasPainting: !!d.painting?.artwork })));
const entries = (page) => page.evaluate(() => window.sonmira.entries.map((e) => e.id));

const IOS = !!process.env.IOS;
function fakeIOS() {
  const id = (globalThis.__acct ??= localStorage.getItem('e2e.acct') || crypto.randomUUID());
  localStorage.setItem('e2e.acct', id);
  const store = {
    accountId: async () => ({ id: localStorage.getItem('e2e.acct') }), deviceId: async () => ({ id: null }),
    setAccountId: async ({ id: v }) => { localStorage.setItem('e2e.acct', v); return { id: v }; }, resetAccountId: async () => ({ id: localStorage.getItem('e2e.acct') }),
    products: async () => ({ products: [] }), purchase: async () => ({ status: 'userCancelled' }), finish: async () => {}, sync: async () => {},
    history: async () => ({ transactions: [] }), currentSubscription: async () => ({}), addListener: () => ({ remove() {} }), manageSubscriptions: async () => {},
  };
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { SonmiraStore: store }, registerPlugin: (n) => (n === 'SonmiraStore' ? store : null) };
}

async function fresh({ ios = IOS } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  if (ios) await ctx.addInitScript(fakeIOS);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  if (process.env.DEBUG) { page.on('console', (m) => page.errors.push('console: ' + m.text().slice(0, 200))); page.on('requestfinished', async (r) => { if (r.url().includes('/api/')) page.errors.push(`${r.method()} ${r.url().split('/api/')[1]} ${(await r.response())?.status()}`); }); page.on('requestfailed', (r) => page.errors.push('failed ' + r.url())); }
  await page.goto(S.base);
  await page.waitForSelector('[data-screen=diary]');
  debug = async () => JSON.stringify({ errors: page.errors, toast: await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent)), phase: await page.evaluate(() => [...document.querySelectorAll('[data-phase]')].map((n) => n.dataset.phase + ':' + (n.dataset.code || '') + ':' + n.textContent.slice(0, 120))), status: await status(page).catch(() => null), log: (await guardLog()).slice(-4) });
  page.install = async () => (await page.evaluate(() => window.sonmira.account.id))?.slice(0, 8);
  return { ctx, page };
}
async function record(page) {
  await page.click('.fab');
  await page.waitForSelector('[data-phase=ready]');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await page.waitForTimeout(2600);
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
}
async function create(page) {
  await page.click('text=Create painting');
  if (!page.invited) {
    await page.waitForSelector('[aria-label="Invitation code"]');
    await page.fill('[aria-label="Invitation code"]', CODE);
    await page.click('[data-sheet] .pill');
    page.invited = true;
  }
}
async function save(page, { twice = false } = {}) {
  await page.click('[data-step=expanded] .pill');
  await page.waitForSelector('[data-step=journal] .caption-input');
  if (twice) await page.dblclick('[data-step=journal] .pill');
  else await page.click('[data-step=journal] .pill');
  await page.waitForSelector('[data-screen=diary] .entry');
}
// Two free paintings made and saved: the next one is the last.
async function twoMade(o) {
  const s = await fresh(o);
  for (let i = 0; i < 2; i++) {
    await record(s.page); await create(s.page);
    await s.page.waitForSelector('[data-phase=result]', { timeout: 30000 });
    await save(s.page);
  }
  assert.equal((await status(s.page)).free, 1, 'one free painting left');
  return s;
}
// The last painting is made, and kept in the diary.
async function lastOneKept(page, me) {
  await page.waitForSelector('[data-screen=diary] .entry');
  assert.equal((await entries(page)).length, 3, 'all three paintings are in the diary');
  assert.equal((await drafts(page)).length, 0);
  assert.deepEqual(await charged(me), ['free', 'free', 'free'], 'three paintings, each counted once');
  const s = await status(page);
  assert.equal(s.free, 0); assert.equal(s.canCreate, false);
  assert.equal(await page.isVisible('[data-paywall]'), false, 'no paywall on the way');
  assert.deepEqual(page.errors, []);
}

const results = [];
let debug = null;
async function step(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (e) { results.push(false); console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 6).join('\n     ')}`); if (process.env.DEBUG) console.log(await debug?.()); }
}

await step('last free painting: Save straight away', async () => {
  const { ctx, page } = await twoMade();
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await save(page, { twice: true });
  await lastOneKept(page, await page.install());
  await ctx.close();
});

await step('last free painting: closed before Save, opened from the drafts and saved', async () => {
  const { ctx, page } = await twoMade();
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await page.click('[aria-label=Close]');
  await page.waitForSelector('.drafts-row');
  await page.click('.drafts-row');
  await page.click('[data-draft] .draft-open');
  await page.waitForSelector('[data-phase=result]', { timeout: 10000 });
  await save(page);
  await lastOneKept(page, await page.install());
  await ctx.close();
});

await step('last free painting: reloaded after it arrived, opened from the drafts and saved', async () => {
  const { ctx, page } = await twoMade();
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await page.reload();
  await page.waitForSelector('.drafts-row');
  await page.click('.drafts-row');
  await page.click('[data-draft] .draft-open');
  await page.waitForSelector('[data-phase=result]', { timeout: 10000 });
  await save(page);
  await lastOneKept(page, await page.install());
  await ctx.close();
});

await step('last free painting: reloaded while painting, opened from the drafts and saved', async () => {
  const { ctx, page } = await twoMade();
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=generating]');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(2500); // the server finishes (and counts) the painting meanwhile
  await page.reload(); // the app opens again with the server's count
  await page.waitForSelector('.drafts-row');
  await page.click('.drafts-row');
  await page.click('[data-draft] .draft-open');
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await save(page);
  await lastOneKept(page, await page.install());
  await ctx.close();
});

await step('last free painting: the answer is lost on the way back, Try again gets it at no charge', async () => {
  const { ctx, page } = await twoMade();
  let drop = true;
  await page.route('**/api/generate', async (route) => {
    if (route.request().method() !== 'POST' || !drop) return route.continue();
    drop = false;
    await route.fetch().catch(() => {});
    return route.abort('connectionreset');
  });
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  await page.click('[data-kind=generation] .pill');
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  const me = await page.install();
  assert.ok((await generations(me)).some((e) => e.outcome === 'replay'), 'Try again got the painting already made');
  await save(page);
  await lastOneKept(page, me);
  await ctx.close();
});

await step('last free painting: the answer is lost, the app opens again, the draft gets it at no charge', async () => {
  const { ctx, page } = await twoMade();
  let drop = true;
  await page.route('**/api/generate', async (route) => {
    if (route.request().method() !== 'POST' || !drop) return route.continue();
    drop = false;
    await route.fetch().catch(() => {});
    return route.abort('connectionreset');
  });
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  await page.reload();
  await page.waitForSelector('.drafts-row');
  await page.click('.drafts-row');
  await page.click('[data-draft] .draft-open');
  await page.waitForSelector('[data-phase=preview]');
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  const me = await page.install();
  assert.ok((await generations(me)).some((e) => e.outcome === 'replay'), 'the painting already made, not a new one');
  await save(page);
  await lastOneKept(page, me);
  await ctx.close();
});

await step('last free painting: a failed painting counts nothing, and the retry is the last one', async () => {
  const { ctx, page } = await twoMade();
  let fail = true;
  await page.route('**/api/generate', async (route) => {
    if (route.request().method() !== 'POST' || !fail) return route.continue();
    fail = false;
    return route.fulfill({ status: 502, json: { ok: false, code: 'error', error: 'The painting service failed.' } });
  });
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  assert.equal((await status(page)).free, 1, 'nothing counted for the failure');
  await page.click('[data-kind=generation] .pill');
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await save(page);
  await lastOneKept(page, await page.install());
  await ctx.close();
});

// Saved recordings from before this fix, opened at zero in the iOS app,
// with the app's own copy of the wallet out of date: what the server knows
// about the take decides.
const legacyWallet = (page, patch) => page.evaluate((patch) => {
  const w = JSON.parse(localStorage.getItem('sonmira.wallet'));
  localStorage.setItem('sonmira.wallet', JSON.stringify({ ...w, ...patch, holds: {} }));
}, patch);
const offline = (page) => page.route('**/api/billing/status*', (r) => r.fulfill({ status: 503, json: { ok: false, code: 'unavailable' } }));
async function openDraft(page) {
  await page.reload();
  await page.waitForSelector('.drafts-row');
  await page.click('.drafts-row');
  await page.click('[data-draft] .draft-open');
  await page.waitForSelector('[data-phase=preview], [data-phase=generating], [data-phase=result]');
  if (await page.isVisible('[data-phase=preview]')) await page.click('text=Create painting');
}

await step('saved recording, counted on the server, the app\'s wallet at zero and unaware: the painting is recovered at no charge', async () => {
  const { ctx, page } = await twoMade({ ios: true });
  let drop = true;
  await page.route('**/api/generate', async (route) => {
    if (route.request().method() !== 'POST' || !drop) return route.continue();
    drop = false;
    await route.fetch().catch(() => {});
    return route.abort('connectionreset');
  });
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  const me = await page.install();
  assert.deepEqual(await charged(me), ['free', 'free', 'free'], 'the server made and counted it');
  await legacyWallet(page, { free: 0, spent: {} });
  await offline(page);
  await openDraft(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  assert.ok((await generations(me)).some((e) => e.outcome === 'replay'), 'the painting already made');
  await save(page);
  await lastOneKept(page, me);
  await ctx.close();
});

await step('saved recording, never sent, the app\'s wallet out of date at zero: the server still has one, so it paints, counted once', async () => {
  const { ctx, page } = await twoMade({ ios: true });
  let block = true;
  await page.route('**/api/generate', (route) => (route.request().method() === 'POST' && block ? (block = false, route.abort('internetdisconnected')) : route.continue()));
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  const me = await page.install();
  assert.deepEqual(await charged(me), ['free', 'free'], 'nothing was counted for it');
  await legacyWallet(page, { free: 0 });
  await offline(page);
  await openDraft(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await save(page);
  await lastOneKept(page, me);
  await ctx.close();
});

await step('saved recording, never counted, and nothing left: the usual offer, nothing made or counted', async () => {
  const { ctx, page } = await twoMade({ ios: true });
  let block = true;
  await page.route('**/api/generate', (route) => (route.request().method() === 'POST' && block ? (block = false, route.abort('internetdisconnected')) : route.continue()));
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  assert.equal((await status(page)).free, 1, 'its painting went back');
  await page.click('[aria-label=Close]');
  // the last free painting goes to another song
  await record(page); await create(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await save(page);
  const me = await page.install();
  await openDraft(page);
  await page.waitForSelector('[data-paywall]', { timeout: 30000 });
  assert.deepEqual(await charged(me), ['free', 'free', 'free']);
  assert.equal((await drafts(page)).length, 1, 'the recording is still kept');
  await ctx.close();
});

await browser.close();
S.stop();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

// The App Store release, end to end, as App Review meets it: the iOS app
// (a stand-in Capacitor + StoreKit plugin) opening https://sonmira.vercel.app
// (served from this checkout), with the server's open access, the paintings
// ledger on (SONMIRA_BILLING=on) and no paid calls (server/dev/fake-openai.js).
//
//   node tests/e2e/app-store-release.mjs        (starts its own server)
//
// Covers: no invitation prompt; three free paintings, then the paywall with
// both products; a returning install paints again; no developer, preview,
// simulation, beta or "Coming soon" text anywhere a person can reach, even
// with ?dev / ?engine=mock / ?ux-preview / #dev in the URL; the same on the
// released website; iPhone-in-iPad (compatibility mode) window sizes.
// Screenshots go to $SHOTS (default: the scratch folder below).

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const SHOTS = process.env.SHOTS || fileURLToPath(new URL('../../.e2e-shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const RELEASE = 'https://sonmira.vercel.app/';
// Anything that would read as a beta, a test or an unfinished feature.
const FORBIDDEN = /invitation|private beta|\bbeta\b|simulat|development|developer|testflight|coming soon|ux preview|mock|sandbox|dev ·/i;

function startServer(port, env) {
  const proc = spawn(process.execPath, [fileURLToPath(new URL('./guarded-server.mjs', import.meta.url))], {
    // No invitation codes are set; open access is what lets people in.
    env: { ...process.env, PORT: String(port), QUIET: '1', SONMIRA_FAKE_PROVIDER: '1', SONMIRA_OPEN_ACCESS: '1', SONMIRA_BILLING: 'on', SONMIRA_TOKEN_SECRET: 'e2e-secret-0123456789abcdefghij', SONMIRA_DAILY_CAP_USD: '50', SONMIRA_LIMIT_IP_HOUR: '1000', SONMIRA_LIMIT_SESSION_IP_HOUR: '1000', SONMIRA_LIMIT_GENERATE_HOUR: '100', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve) => proc.stdout.on('data', (d) => { if (String(d).includes('guarded server')) resolve({ base: `http://localhost:${port}/`, stop: () => proc.kill() }); }));
}

const S = await startServer(5197, { SONMIRA_FAKE_DELAY_MS: '600' });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required', '--disable-webgl'] });
const guardLog = async () => (await fetch(`${S.base}__test/guard-log`)).json();

// The iOS app's shell: Capacitor + the StoreKit plugin, nothing else (builds
// up to 5 have no Sign in with Apple plugin). Purchases are cancelled on
// "Apple's sheet"; every call is recorded so the test can see StoreKit used.
function fakeIOS() {
  const id = (globalThis.__acct ??= localStorage.getItem('e2e.acct') || crypto.randomUUID());
  localStorage.setItem('e2e.acct', id);
  const calls = (globalThis.__storeCalls = []);
  const rec = (name, v) => async (...a) => { calls.push(name); return typeof v === 'function' ? v(...a) : v; };
  const store = {
    accountId: rec('accountId', () => ({ id: localStorage.getItem('e2e.acct') })), deviceId: rec('deviceId', { id: null }),
    setAccountId: rec('setAccountId', ({ id: v }) => { localStorage.setItem('e2e.acct', v); return { id: v }; }), resetAccountId: rec('resetAccountId', () => ({ id: localStorage.getItem('e2e.acct') })),
    products: rec('products', { products: [] }), purchase: rec('purchase', { status: 'userCancelled' }), finish: rec('finish'), sync: rec('sync'),
    history: rec('history', { transactions: [] }), currentSubscription: rec('currentSubscription', {}), addListener: () => ({ remove() {} }), manageSubscriptions: rec('manageSubscriptions'),
  };
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { SonmiraStore: store }, registerPlugin: (n) => (n === 'SonmiraStore' ? store : null) };
}

async function open({ ios = true, viewport = { width: 375, height: 667 }, query = '', storage = null } = {}) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, ...(storage ? { storageState: storage } : {}) });
  // https://sonmira.vercel.app, answered by the local server.
  await ctx.route('https://sonmira.vercel.app/**', async (route) => {
    const u = new URL(route.request().url());
    const res = await fetch(new URL(u.pathname + u.search, S.base), { method: route.request().method(), headers: route.request().headers(), body: route.request().postDataBuffer() ?? undefined });
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  if (ios) await ctx.addInitScript(fakeIOS);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(RELEASE + query);
  await page.waitForSelector('[data-screen=diary]');
  return { ctx, page };
}
const visibleText = (page) => page.evaluate(() => document.body.innerText);
async function noBetaText(page, where) {
  const t = await visibleText(page);
  const m = t.match(FORBIDDEN);
  assert.equal(m, null, `${where}: "${m?.[0]}" is visible: …${m ? t.slice(Math.max(0, m.index - 60), m.index + 60) : ''}…`);
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
async function paintAndSave(page) {
  await record(page);
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  assert.equal(await page.isVisible('[aria-label="Invitation code"]'), false, 'no invitation prompt');
  await page.click('[data-step=expanded] .pill');
  await page.waitForSelector('[data-step=journal] .caption-input');
  await page.click('[data-step=journal] .pill');
  await page.waitForSelector('[data-screen=diary] .entry');
}
const status = (page) => page.evaluate(() => window.sonmira.billing.status());

const results = [];
async function step(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (e) { results.push(false); console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 6).join('\n     ')}`); }
}

await step('iOS app, fresh install: three paintings without a code, then the paywall with both products', async () => {
  const { ctx, page } = await open();
  await page.screenshot({ path: `${SHOTS}01-diary-fresh.png` });
  for (let i = 1; i <= 3; i++) await paintAndSave(page);
  const log = (await guardLog()).filter((e) => e.endpoint === 'generate' && e.outcome === 'ok');
  assert.ok(log.length >= 3 && log.slice(-3).every((e) => e.charged === 'free'), 'three paintings, each counted as free');
  assert.equal((await guardLog()).some((e) => e.endpoint === 'session' && e.outcome === 'ok_open'), true, 'admitted by open access');
  const st = await status(page);
  assert.equal(st.free, 0); assert.equal(st.canCreate, false);
  // A fourth: the paywall, offering both products, with the App Store (no simulation).
  await page.click('.fab');
  await page.waitForSelector('[data-paywall]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}02-paywall.png` });
  assert.equal(await page.locator('[data-plan]').count(), 2);
  const text = await visibleText(page);
  assert.match(text, /Daily Ritual/); assert.match(text, /Little Moments/);
  await noBetaText(page, 'paywall');
  await page.click('.pw-cta .pill');
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => globalThis.__storeCalls)).includes('purchase'), 'the purchase goes to StoreKit');
  await page.click('[data-more-info]');
  await page.waitForSelector('.pw-info');
  await noBetaText(page, 'More information');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

await step('iOS app, returning install: paints again after a relaunch, without asking', async () => {
  const first = await open();
  await paintAndSave(first.page);
  const storage = await first.ctx.storageState();
  await first.ctx.close();
  const again = await open({ storage });
  assert.equal((await status(again.page)).free, 2);
  await paintAndSave(again.page);
  assert.equal((await status(again.page)).free, 1);
  assert.deepEqual(again.page.errors, []);
  await again.ctx.close();
});

await step('iOS app: no developer tools, previews, simulations or "Coming soon", whatever the URL says', async () => {
  const { ctx, page } = await open({ query: '?dev&engine=mock&ux-preview#dev' });
  assert.match(await page.evaluate(() => window.sonmira.engine.id), /^ai/);
  assert.equal(await page.locator('.devpanel').count(), 0);
  assert.equal(await page.locator('[data-ux-preview]').count(), 0);
  assert.equal(await page.evaluate(() => window.sonmira.dev.enabled), false);
  await noBetaText(page, 'diary');
  await page.click('[aria-label="Settings"]');
  await page.waitForSelector('[data-screen=settings]');
  await page.screenshot({ path: `${SHOTS}03-settings.png`, fullPage: true });
  await noBetaText(page, 'Settings');
  assert.equal(await page.locator('[data-account-row]').count(), 0, 'no simulated Sign in with Apple');
  assert.equal(await page.locator('[data-dev]').count(), 0);
  for (const doc of ['Privacy policy', 'Terms']) {
    await page.click(`text=${doc}`);
    await page.waitForSelector('[data-screen=legal]');
    await page.waitForTimeout(300);
    await noBetaText(page, doc);
    await page.click('[data-screen=legal] .icon-btn');
    await page.waitForSelector('[data-screen=settings]');
  }
  // Restore goes to StoreKit.
  await page.click('text=Restore purchases');
  await page.waitForTimeout(400);
  assert.ok((await page.evaluate(() => globalThis.__storeCalls)).some((c) => c === 'history' || c === 'sync'), 'restore asks StoreKit');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

await step('released website: no developer tools or simulations either', async () => {
  const { ctx, page } = await open({ ios: false, viewport: { width: 393, height: 852 }, query: '?dev&engine=mock&ux-preview' });
  assert.match(await page.evaluate(() => window.sonmira.engine.id), /^ai/);
  assert.equal(await page.locator('.devpanel').count(), 0);
  assert.equal(await page.evaluate(() => window.sonmira.billing.simulated), false);
  await page.click('[aria-label="Settings"]');
  await page.waitForSelector('[data-screen=settings]');
  await noBetaText(page, 'website Settings');
  assert.equal(await page.locator('[data-account-row]').count(), 0);
  await ctx.close();
});

// iPhone apps on iPad run in a compatibility window, phone-sized.
for (const viewport of [{ width: 375, height: 667 }, { width: 414, height: 896 }]) {
  await step(`iPad compatibility window ${viewport.width}×${viewport.height}: every screen fits and responds`, async () => {
    const { ctx, page } = await open({ viewport });
    const tag = `${viewport.width}x${viewport.height}`;
    // scroll: the step may scroll to reach it (a short window), as a person would.
    const fits = async (sel, where, { scroll = false } = {}) => {
      await page.waitForTimeout(900); // let the step's transition settle
      if (scroll) { await page.locator(sel).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(200); }
      const box = await page.locator(sel).first().boundingBox();
      if (!(box && box.y + box.height <= viewport.height + 1)) await page.screenshot({ path: `${SHOTS}fail-${where}-${tag}.png` });
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${where}: ${sel} is on screen (${JSON.stringify(box)})`);
    };
    await fits('.fab', 'diary');
    await page.click('.fab');
    await page.waitForSelector('[data-phase=ready]');
    await fits('[aria-label="Start recording"]', 'sing');
    await page.screenshot({ path: `${SHOTS}04-sing-${tag}.png` });
    await page.click('[aria-label="Start recording"]');
    await page.waitForSelector('[data-phase=singing]');
    await page.waitForTimeout(1500);
    await fits('[aria-label="Stop recording"]', 'recording');
    await page.click('[aria-label="Stop recording"]');
    await page.waitForSelector('[data-phase=preview]');
    await fits('text=Create painting', 'preview');
    await page.click('text=Create painting');
    await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
    await fits('[data-step=expanded] .pill', 'result', { scroll: true });
    await page.screenshot({ path: `${SHOTS}05-result-${tag}.png` });
    await page.click('[data-step=expanded] .pill');
    await page.waitForSelector('[data-step=journal] .caption-input');
    await fits('[data-step=journal] .pill', 'journal');
    await page.click('[data-step=journal] .pill');
    await page.waitForSelector('[data-screen=diary] .entry');
    await page.click('[data-screen=diary] .entry');
    await page.waitForSelector('[data-screen=detail]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}06-detail-${tag}.png` });
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });
}

await browser.close();
S.stop();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${SHOTS}`);
process.exit(failed ? 1 : 0);

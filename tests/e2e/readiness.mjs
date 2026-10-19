// Production readiness, end to end, with no paid calls: the real app and the
// real guarded API functions (tests/e2e/guarded-server.mjs), the provider
// replaced by server/dev/fake-openai.js, a fake microphone singing hum.wav.
//
//   node tests/e2e/readiness.mjs          (starts its own servers)
//   SHOTS=./shots node tests/e2e/readiness.mjs
//
// Covers: invitation, painting, Keep it, a painting closed before Keep it
// (draft, reopened without a new generation), reload while painting
// (recording recovered, no second paid call), discard, failure and retry,
// double tap, per-install rate limit, the daily spend cap, direct API abuse;
// and across interruptions: reload with a painting not yet kept, a closed
// tab, a lost connection, a reload with the invitation sheet open, and the
// rate limit and cap surviving a reload or a new install.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// After the painting: Next on the expanded artwork, the title (optional) in the journal step, then Save.
const keepIt = async (page, title) => {
  await page.click('[data-step=expanded] .pill');
  await page.waitForSelector('[data-step=journal] .caption-input');
  if (title) await page.fill('[data-step=journal] .caption-input', title);
  await page.click('[data-step=journal] .pill');
};

const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const SHOTS = process.env.SHOTS;
const CODE = 'BETA-TEST-01';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(port, env) {
  const proc = spawn(process.execPath, [fileURLToPath(new URL('./guarded-server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(port), QUIET: '1', SONMIRA_FAKE_PROVIDER: '1', SONMIRA_TOKEN_SECRET: 'e2e-secret-0123456789abcdefghij', SONMIRA_INVITE_CODES: CODE, SONMIRA_LIMIT_INSTALLS_PER_INVITE: '100', SONMIRA_LIMIT_IP_HOUR: '1000', SONMIRA_LIMIT_SESSION_IP_HOUR: '1000', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve) => proc.stdout.on('data', (d) => { if (String(d).includes('guarded server')) resolve({ base: `http://localhost:${port}/`, stop: () => proc.kill() }); }));
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const results = [];
let shotN = 0;

async function guardLog(base) { return (await (await fetch(`${base}__test/guard-log`)).json()); }
const paidCalls = (log, endpoint, install) => log.filter((e) => e.endpoint === endpoint && (!install || e.install === install) && (e.outcome === 'ok' || e.outcome === 'failed')).length;

const open = new Set();
async function fresh(base) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  open.add(ctx);
  ctx.on('close', () => open.delete(ctx));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector('[data-screen=diary]');
  page.errors = errors;
  page.shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++shotN).padStart(2, '0')}-${name}.png` }); };
  // The device's one id: the account id (main.js deviceIdentity).
  page.install = async () => (await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('sonmira.account')).id; } catch { return localStorage.getItem('sonmira.install'); } }))?.slice(0, 8);
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
async function invite(page, code = CODE) {
  await page.waitForSelector('[aria-label="Invitation code"]');
  await page.fill('[aria-label="Invitation code"]', code);
  await page.click('[data-sheet] .pill');
}
const drafts = (page) => page.evaluate(async () => (await window.sonmira.drafts.list()).map((d) => ({ key: d.key, status: d.status, hasAudio: !!d.audio, hasPainting: !!d.painting?.artwork, error: d.error })));
const entries = (page) => page.evaluate(() => window.sonmira.entries.map((e) => ({ id: e.id, note: e.note })));

async function step(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`ok   ${name}`); }
  catch (e) { if (process.env.DEBUG && typeof A !== 'undefined') console.log(JSON.stringify((await guardLog(A.base)).slice(-6).map((x) => [x.endpoint, x.outcome, x.status, x.reason ?? x.limit ?? '']))); await Promise.all([...open].map((c) => c.close().catch(() => {}))); results.push({ name, ok: false, error: e.message }); console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, process.env.DEBUG ? 12 : 1).join('\n     ')}`); }
}

// Every test device comes from 127.0.0.1, so the per-address limits are raised in startServer;
// more paintings than $3 buys run here, so this server's cap is raised too (the cap has its own server below).
const A = await startServer(5191, { SONMIRA_FAKE_DELAY_MS: '2500', SONMIRA_LIMIT_GENERATE_HOUR: '2', SONMIRA_DAILY_CAP_USD: '50' });

await step('invitation: a wrong code is refused, the right one paints; one paid image', async () => {
  const { ctx, page } = await fresh(A.base);
  await record(page);
  await page.click('text=Create painting');
  await invite(page, 'WRONG-CODE-9');
  await page.waitForSelector('[data-sheet] .share-message');
  await page.waitForFunction(() => document.querySelectorAll('[data-sheet]').length === 1); // the first sheet has finished closing
  await page.shot('invite-wrong-code');
  await page.fill('[aria-label="Invitation code"]', CODE);
  await page.click('[data-sheet] .pill');
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await page.shot('result');
  const d = await drafts(page);
  assert.equal(d.length, 1);
  assert.equal(d[0].status, 'ready', 'the painting is a draft until Keep it');
  assert.equal((await entries(page)).length, 0, 'not in the diary before Keep it');
  await keepIt(page);
  await page.waitForSelector('[data-screen=diary] .entry');
  const e = await entries(page);
  assert.equal(e.length, 1);
  assert.equal(e[0].id, `e-${d[0].key}`);
  assert.equal((await drafts(page)).length, 0);
  assert.equal(paidCalls(await guardLog(A.base), 'generate', await page.install()), 1);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

await step('closed before Keep it: kept as a draft, reopened with no new generation, then kept', async () => {
  const { ctx, page } = await fresh(A.base);
  await record(page);
  await page.click('text=Create painting');
  await invite(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  const before = paidCalls(await guardLog(A.base), 'generate', await page.install());
  await page.click('[aria-label=Close]');
  await page.waitForSelector('.drafts-row');
  await page.shot('diary-waiting-line');
  assert.equal((await entries(page)).length, 0);
  await page.click('.drafts-row');
  await page.waitForSelector('[data-draft]');
  await page.shot('drafts-sheet');
  await page.click('[data-draft] .draft-open');
  await page.waitForSelector('[data-phase=result]');
  await page.shot('draft-reopened');
  assert.equal(paidCalls(await guardLog(A.base), 'generate', await page.install()), before, 'no second generation');
  assert.equal(await page.evaluate(() => window.sonmira.billing.status().free), 2, 'counted once');
  await keepIt(page);
  await page.waitForSelector('[data-screen=diary] .entry');
  assert.equal(await page.$('.drafts-row'), null);
  await ctx.close();
});

await step('reload while painting: the recording is recovered and finished with no second paid call', async () => {
  const { ctx, page } = await fresh(A.base);
  await record(page);
  await page.click('text=Create painting');
  await invite(page);
  await page.waitForSelector('[data-phase=generating]');
  await page.waitForTimeout(1500); // the image request is in flight on the server
  await page.reload();
  await page.waitForSelector('.drafts-row');
  const d = await drafts(page);
  assert.equal(d.length, 1);
  assert.equal(d[0].status, 'painting');
  assert.ok(d[0].hasAudio, 'the recording survived the reload');
  await page.click('.drafts-row');
  await page.click('[data-draft] .draft-open');
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  const log = await guardLog(A.base), me = await page.install();
  const mine = log.filter((e) => e.install === me);
  assert.equal(paidCalls(log, 'generate', me), 1, `one image, log: ${JSON.stringify(mine.map((e) => e.endpoint + ':' + e.outcome))}`);
  assert.equal(paidCalls(log, 'understand', me), 1);
  assert.ok(mine.some((e) => e.outcome === 'replay'), 'the resumed request got the stored result');
  await ctx.close();
});

await step('reload after the painting arrived, before Keep it: reopened with no new generation, counted once', async () => {
  const { ctx, page } = await fresh(A.base);
  await record(page);
  await page.click('text=Create painting');
  await invite(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  // written after the painting, kept with the draft as it is typed
  await page.click('[data-step=expanded] .pill');
  await page.fill('[data-step=journal] .caption-input', 'Kitchen song');
  await page.fill('[data-step=journal] .journal-input', 'Steam on the glass.');
  await page.waitForTimeout(900);
  const free = await page.evaluate(() => window.sonmira.billing.status().free);
  await page.reload();
  await page.waitForSelector('.drafts-row');
  const d = await drafts(page);
  assert.equal(d.length, 1);
  assert.equal(d[0].status, 'ready');
  assert.ok(d[0].hasAudio && d[0].hasPainting, 'recording and painting both survived');
  assert.equal((await entries(page)).length, 0);
  assert.equal(await page.evaluate(async () => (await window.sonmira.drafts.list())[0].note), 'Kitchen song', 'the title too');
  assert.equal(await page.evaluate(async () => (await window.sonmira.drafts.list())[0].journal), 'Steam on the glass.', 'and the journal');
  await page.click('.drafts-row');
  await page.click('[data-draft] .draft-open');
  await page.waitForSelector('[data-phase=result]');
  assert.equal(await page.evaluate(() => window.sonmira.billing.status().free), free, 'not counted a second time');
  await keepIt(page);
  await page.waitForSelector('[data-screen=diary] .entry');
  assert.equal(paidCalls(await guardLog(A.base), 'generate', await page.install()), 1);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

await step('tab closed while painting, app opened again in a new tab: recovered, one paid image', async () => {
  const { ctx, page } = await fresh(A.base);
  await record(page);
  await page.click('text=Create painting');
  await invite(page);
  await page.waitForSelector('[data-phase=generating]');
  await page.waitForTimeout(1000);
  const me = await page.install();
  await page.close();
  const again = await ctx.newPage();
  await again.goto(A.base);
  await again.waitForSelector('.drafts-row');
  assert.equal((await drafts(again))[0].status, 'painting');
  await again.click('.drafts-row');
  await again.click('[data-draft] .draft-open');
  await again.waitForSelector('[data-phase=result]', { timeout: 30000 });
  assert.equal(paidCalls(await guardLog(A.base), 'generate', me), 1);
  await ctx.close();
});

await step('connection lost while painting: the take is kept, Try again gets the painting already made', async () => {
  const { ctx, page } = await fresh(A.base);
  // The request reaches the server and the painting is made, but the answer
  // never arrives (the phone lost its connection on the way back).
  let drop = true;
  await page.route('**/api/generate', async (route) => {
    if (route.request().method() !== 'POST' || !drop) return route.continue();
    drop = false;
    await route.fetch().catch(() => {});
    return route.abort('connectionreset');
  });
  await record(page);
  await page.click('text=Create painting');
  await invite(page);
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  const d = await drafts(page);
  assert.equal(d[0].status, 'failed');
  assert.ok(d[0].hasAudio);
  await page.click('[data-kind=generation] .pill');
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  const log = await guardLog(A.base), me = await page.install();
  assert.equal(paidCalls(log, 'generate', me), 1, 'Try again was answered with the painting already made');
  assert.ok(log.some((e) => e.install === me && e.endpoint === 'generate' && e.outcome === 'replay'));
  await ctx.close();
});

await step('invitation sheet left open and the app reloaded: the take waits as a draft and paints after the code', async () => {
  const { ctx, page } = await fresh(A.base);
  await record(page);
  await page.click('text=Create painting');
  await page.waitForSelector('[aria-label="Invitation code"]');
  await page.reload();
  await page.waitForSelector('.drafts-row');
  assert.ok((await drafts(page))[0].hasAudio);
  await page.click('.drafts-row');
  await page.click('[data-draft] .draft-open');
  await invite(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await ctx.close();
});

await step('discard removes a draft for good, also after a reload', async () => {
  const { ctx, page } = await fresh(A.base);
  await record(page);
  await page.click('text=Create painting');
  await invite(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await page.click('[aria-label=Close]');
  await page.click('.drafts-row');
  await page.click('[data-draft] .text-btn');
  await page.waitForSelector('[data-draft] .text-btn.armed');
  await page.shot('discard-armed');
  await page.click('[data-draft] .text-btn');
  await page.waitForSelector('[data-draft]', { state: 'detached' });
  await page.reload();
  await page.waitForSelector('[data-screen=diary]');
  await page.waitForTimeout(300);
  assert.equal(await page.$('.drafts-row'), null);
  assert.deepEqual(await drafts(page), []);
  await ctx.close();
});

await step('a failed painting keeps the take; Try again succeeds; nothing is counted for the failure', async () => {
  const { ctx, page } = await fresh(A.base);
  let failNext = true;
  await page.route('**/api/generate', async (route) => {
    if (route.request().method() === 'POST' && failNext) { failNext = false; return route.fulfill({ status: 502, json: { ok: false, code: 'provider_error', error: 'mock outage' } }); }
    return route.continue();
  });
  await record(page);
  await page.click('text=Create painting');
  await invite(page);
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  await page.shot('failed');
  const d = await drafts(page);
  assert.equal(d[0].status, 'failed');
  assert.ok(d[0].hasAudio);
  assert.equal(await page.evaluate(() => window.sonmira.billing.status().free), 3, 'the hold went back');
  await page.click('[data-kind=generation] .pill');
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.sonmira.billing.status().free), 2);
  await ctx.close();
});

await step('double tap on Create painting makes one request', async () => {
  const { ctx, page } = await fresh(A.base);
  await record(page);
  await page.click('text=Create painting');
  await invite(page);
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await page.click('text=Sing again');
  await page.waitForSelector('[data-phase=ready]');
  await page.click('[aria-label="Start recording"]');
  await page.waitForTimeout(2600);
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
  await page.dblclick('text=Create painting');
  await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  assert.equal(paidCalls(await guardLog(A.base), 'generate', await page.install()), 2);
  await ctx.close();
});

await step('rate limit: the third painting in an hour is refused calmly and the take is kept', async () => {
  const { ctx, page } = await fresh(A.base);
  for (let i = 0; i < 2; i++) {
    await record(page);
    await page.click('text=Create painting');
    if (i === 0) await invite(page);
    await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
    await keepIt(page);
    await page.waitForSelector('[data-screen=diary] .entry');
  }
  await record(page);
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 }).catch(async (e) => { await page.shot('rate-debug'); throw new Error(`${e.message.split('\n')[0]} at ${await page.getAttribute('[data-phase]', 'data-phase')}`); });
  assert.equal(await page.getAttribute('[data-kind=generation]', 'data-code'), 'rate_limited', await page.textContent('[data-kind=generation] .lede'));
  await page.shot('rate-limited');
  assert.match(await page.textContent('[data-kind=generation] .lede'), /Your song is kept/);
  const d = await drafts(page);
  assert.equal(d.length, 1);
  assert.equal(d[0].error, 'rate_limited');
  assert.equal(await page.evaluate(() => window.sonmira.billing.status().free), 1, 'not counted');
  // The limit is the server's: a reload (fresh page state) changes nothing.
  const paid = paidCalls(await guardLog(A.base), 'generate', await page.install());
  await page.reload();
  await page.click('.drafts-row');
  await page.click('[data-draft] .draft-open');
  await page.waitForSelector('[data-phase=preview]'); // a failed take reopens on its recording
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  assert.equal(await page.getAttribute('[data-kind=generation]', 'data-code'), 'rate_limited');
  assert.equal(paidCalls(await guardLog(A.base), 'generate', await page.install()), paid);
  assert.ok((await drafts(page))[0].hasAudio);
  await ctx.close();
});

await step('API abuse: no token, a forged token, no key, and oversized audio are refused before any paid call', async () => {
  const post = (path, body, headers = {}) => fetch(`${A.base}api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const before = paidCalls(await guardLog(A.base), 'generate');
  assert.equal((await post('generate', { spec: {} })).status, 401);
  assert.equal((await post('generate', { spec: {} }, { authorization: 'Bearer v1.e30.forged' })).status, 401);
  const s = await (await post('session', { invite: CODE, installId: 'install-e2eabuse00001' })).json();
  assert.equal((await post('generate', { spec: {} }, { authorization: `Bearer ${s.token}` })).status, 400);
  assert.equal((await post('understand', { audio: 'A'.repeat(1_400_001), mime: 'audio/mp4' }, { authorization: `Bearer ${s.token}`, 'idempotency-key': 'abuse-0001.understand' })).status, 413);
  assert.equal(paidCalls(await guardLog(A.base), 'generate'), before);
});

A.stop();

// $0.15 per image + $0.015 per understanding: a $0.20 cap allows one painting.
const B = await startServer(5192, { SONMIRA_FAKE_DELAY_MS: '500', SONMIRA_DAILY_CAP_USD: '0.20' });
await step('daily spend cap: once reached, painting is refused for everyone and the take is kept', async () => {
  const one = await fresh(B.base);
  await record(one.page);
  await one.page.click('text=Create painting');
  await invite(one.page);
  await one.page.waitForSelector('[data-phase=result]', { timeout: 30000 });
  await one.ctx.close();
  const two = await fresh(B.base);
  await record(two.page);
  await two.page.click('text=Create painting');
  await invite(two.page);
  await two.page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  await two.page.shot('spend-cap');
  const code = await two.page.getAttribute('[data-kind=generation]', 'data-code');
  assert.equal(code, 'spend_cap', `${code}: ${await two.page.textContent('[data-kind=generation] .lede')} ${JSON.stringify((await guardLog(B.base)).map((e) => `${e.endpoint}:${e.outcome}:${e.dayUsd ?? ''}`))}`);
  assert.match(await two.page.textContent('[data-kind=generation] .lede'), /all it can for today/);
  assert.equal((await drafts(two.page))[0].hasAudio, true);
  const log = await guardLog(B.base);
  assert.ok(log.some((e) => e.outcome === 'spend_cap'));
  assert.equal(paidCalls(log, 'generate'), 1);
  // Clearing the app's storage (a new install) doesn't get around the cap either.
  const three = await fresh(B.base);
  await record(three.page);
  await three.page.click('text=Create painting');
  await invite(three.page);
  await three.page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  assert.equal(await three.page.getAttribute('[data-kind=generation]', 'data-code'), 'spend_cap');
  assert.equal(paidCalls(await guardLog(B.base), 'generate'), 1);
  await three.ctx.close();
  await two.ctx.close();
});
B.stop();

// The server counts paintings (SONMIRA_BILLING=on, as in Production): the
// device's own wallet is only a copy, so resetting it gets nothing more.
const C = await startServer(5193, { SONMIRA_FAKE_DELAY_MS: '300', SONMIRA_BILLING: 'on', SONMIRA_DAILY_CAP_USD: '50' });
await step('quota: three free paintings are counted by the server; a reset wallet gets no fourth', async () => {
  const { ctx, page } = await fresh(C.base);
  for (let i = 0; i < 3; i++) {
    await record(page);
    await page.click('text=Create painting');
    if (i === 0) await invite(page);
    await page.waitForSelector('[data-phase=result]', { timeout: 30000 });
    await keepIt(page);
    await page.waitForSelector('[data-screen=diary] .entry');
  }
  const me = await page.install();
  const charged = (await guardLog(C.base)).filter((e) => e.endpoint === 'generate' && e.install === me && e.outcome === 'ok').map((e) => e.charged);
  assert.deepEqual(charged, ['free', 'free', 'free']);
  // Someone clears the app's wallet: it shows three free paintings again.
  await page.evaluate(() => { localStorage.removeItem('sonmira.wallet'); localStorage.removeItem('sonmira.sim.ledger'); });
  await page.reload();
  await page.waitForSelector('[data-screen=diary]');
  await record(page);
  await page.click('text=Create painting');
  await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 30000 });
  await page.shot('no-paintings');
  assert.equal(await page.getAttribute('[data-kind=generation]', 'data-code'), 'no_paintings');
  assert.match(await page.textContent('[data-kind=generation] .lede'), /Your song is kept/);
  assert.equal((await drafts(page))[0].hasAudio, true);
  assert.equal(paidCalls(await guardLog(C.base), 'generate', me), 3);
  await ctx.close();
});
C.stop();

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

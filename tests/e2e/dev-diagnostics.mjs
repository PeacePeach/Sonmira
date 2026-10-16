// The ?dev panel's Generation diagnostics follow the artwork that is open:
// two saved paintings made with different references show their own
// reference, seed and time; an older entry with no saved metadata says
// "Diagnostics unavailable"; the latest take comes back when the artwork
// closes; and none of it exists without ?dev. Mocked services, no paid calls.
//
//   node server.js &  then  node tests/e2e/dev-diagnostics.mjs

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const png = readFileSync(fileURLToPath(new URL('../../assets/art/impression-1.png', import.meta.url))).toString('base64');

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// The API is mocked below, so any install token will do (no invitation sheet).
await ctx.addInitScript(() => localStorage.setItem('sonmira.access', 'e2e-mocked-api'));
// Each generation answers with the next reference, seed and time.
const RUNS = [{ reference: 'resolved_04', seed: 111, ms: 4200 }, { reference: 'gathered_07', seed: 222, ms: 9900 }];
let n = 0;
await ctx.route('**/api/generate', (route) => {
  const r = RUNS[n++ % RUNS.length];
  route.fulfill({ json: { ok: true, provider: 'openai', model: 'gpt-image-2', quality: 'medium', size: '1024x1536', family: 'R5-light-as-subject', referenceSent: true, libraryVersion: 'test', image: `data:image/png;base64,${png}`, ...r } });
});
await ctx.route('**/api/understand', (route) => route.fulfill({ json: { ok: true, transcript: { text: '', wordCount: 0, lexicalWords: 0, distinctLexicalWords: 0, nonLexicalWords: 0, lexicalRatio: 0, musicTags: 0, hallucination: false, asrConfidence: null }, lyrics: null } }));

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const diag = () => page.textContent('.devdiag');

await page.goto(BASE + '?dev&engine=ai');
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('sonmira'); q.onsuccess = q.onerror = q.onblocked = r; }));
await page.reload();
await page.waitForSelector('[data-screen=diary]');

async function make(note) {
  await page.click('.fab');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await page.waitForTimeout(2500);
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
  await page.fill('.caption-input', note);
  await page.click('text=Create painting');
  await page.click('text=Keep it', { timeout: 20000 });
  await page.waitForSelector('[data-screen=diary] .entry');
}
await make('first');
await make('second');
// The latest take is what the panel shows after the second one.
assert.match(await diag(), /last generation[\s\S]*gathered_07/);

// An older entry saved before generation metadata existed.
await page.evaluate(() => new Promise((res, rej) => {
  const o = indexedDB.open('sonmira');
  o.onsuccess = () => {
    const st = o.result.transaction('entries', 'readwrite').objectStore('entries');
    const all = st.getAll();
    all.onsuccess = () => {
      const old = structuredClone(all.result[0]);
      old.id = 'legacy'; old.note = 'legacy'; old.createdAt -= 86400000;
      delete old.painting.generation;
      st.put(old).onsuccess = () => res();
    };
    all.onerror = rej;
  };
}));
await page.reload();
await page.waitForSelector('[data-screen=diary] .entry');

async function open(note) {
  await page.click(`.entry:has(.cap:text-is("${note}"))`);
  await page.waitForSelector('[data-screen=detail]');
  return diag();
}
// The dev panel overlays the corner of the screen; click through it.
const back = async () => { await page.$eval('[aria-label="Back to diary"]', (b) => b.click()); await page.waitForSelector('[data-screen=diary]'); await page.waitForTimeout(300); };

// Switching between saved artworks, in both orders.
for (const order of [['first', 'second'], ['second', 'first']]) {
  for (const note of order) {
    const d = await open(note);
    const mine = note === 'first' ? RUNS[0] : RUNS[1], other = note === 'first' ? RUNS[1] : RUNS[0];
    assert.match(d, /opened artwork/, `${note}: titled as the opened artwork`);
    assert.ok(d.includes(`reference: ${mine.reference}`) && d.includes(`seed: ${mine.seed}`) && d.includes(`time: ${(mine.ms / 1000).toFixed(1)} s`), `${note}: its own reference, seed and time\n${d}`);
    assert.ok(!d.includes(other.reference) && !d.includes(`seed: ${other.seed}`), `${note}: nothing from the other artwork`);
    assert.match(d, /engine: ai-openai-v2/, `${note}: the engine that made it`);
    await back();
  }
}

// The older entry: no borrowed values.
let d = await open('legacy');
assert.match(d, /Diagnostics unavailable/);
assert.ok(!/reference:|seed:|resolved_04|gathered_07/.test(d), 'legacy shows no unrelated values\n' + d);
await back();
// Closing an artwork leaves no artwork's values in the panel (none made on this load).
assert.match(await diag(), /last generation: none yet/);

// A take made after viewing artworks is shown as the latest generation again.
await open('first');
await back();
await make('third');
assert.match(await diag(), /last generation[\s\S]*resolved_04[\s\S]*seed: 111/);
d = await open('second');
assert.ok(d.includes('gathered_07') && !d.includes('resolved_04'), 'opening an artwork replaces the latest take\n' + d);
await back();

// Consumer interface: no panel, no diagnostics anywhere.
await page.goto(BASE + '?engine=ai');
await page.waitForSelector('[data-screen=diary] .entry');
await page.click('.entry:has(.cap:text-is("first"))');
await page.waitForSelector('[data-screen=detail]');
assert.equal(await page.$('.devpanel'), null, 'no dev panel without ?dev');
const body = await page.textContent('body');
assert.ok(!/resolved_04|gathered_07|Diagnostics|seed|reference/i.test(body), 'no diagnostics in the consumer interface');

assert.deepEqual(errors, []);
await browser.close();
console.log('dev diagnostics: ok');

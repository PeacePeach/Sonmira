// Browser check of the Playground's Singing test, with NO paid call:
// /api/understand is answered in the browser by a stub (a confident, complete
// line for sung takes; nothing for the hum), the fake microphone plays a
// synthetic steady singer, and everything else is the real page and engine.
// Checks: record → tier, reason and measurements; labels; persistence and
// free re-analysis after reload (no second transcription); copyable results.
//
//   npm run playground -- --no-open &   then   node tests/e2e/singing-test.mjs
//   (SHOTS=dir keeps the screenshots)

import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { singers, SR } from '../../test/engine/synth.js';
import { analyzeTranscript } from '../../src/engine/interpret/lyrics.js';
import { cleanReading } from '../../src/engine/providers/openai-understand.js';

const S = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'sonmira-sing-'));
mkdirSync(S, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:5180/playground/';

function wav(samples, sr) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return b;
}
const mic = join(S, 'singer.wav');
writeFileSync(mic, wav(singers.strong(), SR));

const line = 'the moon lies quiet on the sea';
const transcript = analyzeTranscript(line, { logprobs: line.split(' ').map((token) => ({ token, logprob: Math.log(0.92) })) });
const lyrics = cleanReading({ language: 'en', lexical: true, coherent: true, structure: 'clause', unfinished: false, linked: true, missing: '', phraseComplete: true, completionConfidence: 0.9, completionReason: 'a full line', theme: [], imagery: [], figurative: [], mood: 'tender', motif: 'water', concepts: { loose: 'x', gathered: 'y', resolved: 'z' } });
const empty = analyzeTranscript('', { logprobs: [] });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${mic}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.grantPermissions(['microphone', 'clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/status of 502/.test(m.text()) && errors.push(m.text()));
let posts = 0, nextWords = 'line';
await page.route('**/api/understand', async (route) => {
  if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, transcribeModel: 'stub-transcribe', textModel: 'stub-text' } });
  posts++;
  const body = route.request().postDataJSON();
  assert.ok(body.audio.length > 1000 && body.mime === 'audio/wav', 'audio is sent as WAV');
  if (nextWords === 'fail') return route.fulfill({ status: 502, json: { ok: false, code: 'error', error: 'Invalid file format.' } });
  return route.fulfill({ json: nextWords === 'line' ? { ok: true, transcript, lyrics } : { ok: true, transcript: empty, lyrics: null } });
});

await page.goto(`${BASE}?view=singing`);
await page.waitForFunction(() => document.querySelectorAll('#stTakes .take').length === 9);
assert.match(await page.textContent('#stServer'), /stub-transcribe/);

async function record(slot, sec) {
  const card = `#take-${slot}`;
  await page.click(`${card} .recbtn`);
  await page.waitForTimeout(sec * 1000);
  await page.click(`${card} .recbtn`);
  await page.waitForFunction((c) => document.querySelector(`${c} .verdict, ${c} .err`), card, { timeout: 60000 });
  return page.innerText(`${card} .out`);
}

// Take 7: a steady sung line with a complete phrase.
const t7 = await record(7, 9);
console.log('take 7 →', t7.split('\n').slice(0, 4).join(' | '));
assert.match(t7, /Resolved|Gathered/, 'a complete sung phrase passes the words gate');
assert.match(t7, /moon lies quiet/);
assert.equal(posts, 1);

// Take 1: the stub hears no words → Loose at the words gate.
nextWords = 'none';
const t1 = await record(1, 4);
console.log('take 1 →', t1.split('\n').slice(0, 4).join(' | '));
assert.match(t1, /Loose/);
assert.match(t1, /Words were heard/);
assert.equal(posts, 2);

// Take 2: transcription fails → singing-only result, marked; Re-analyse tries the words again.
nextWords = 'fail';
const t2 = await record(2, 3);
assert.match(t2, /transcription failed: .*Invalid file format/);
assert.match(t2, /singing only, words not checked/);
assert.equal(await page.evaluate(() => window.__singingTest.view.get(2).u.wordsChecked), false);
const failedJson = JSON.parse(await page.evaluate(() => window.__singingTest.resultsJson())).takes.find((t) => t.slot === 2);
assert.equal(failedJson.wordsChecked, false);
nextWords = 'line';
await page.click('#take-2 .rerun');
await page.waitForFunction(() => window.__singingTest.view.get(2)?.u?.wordsChecked !== false && !window.__singingTest.view.get(2)?.busy);
assert.equal(posts, 4, 'the failed words are fetched again');
posts = 2; // the counts below are about take 7 and 1 again

// Labels: judge take 7 one tier off and see the disagreement explained.
const engine7 = await page.evaluate(() => window.__singingTest.view.get(7).u.tier);
const other = engine7 === 'resolved' ? 'gathered' : 'resolved';
await page.selectOption('#take-7 .judged', other);
assert.match(await page.innerText('#take-7 .out'), /than your judgement/);
assert.match(await page.innerText('#stSummary'), /3 of 9 recorded/);
assert.ok(await page.$('#stCalib table.calib'), 'calibration table');
await page.screenshot({ path: `${S}/1-singing.png`, fullPage: true });

// Reload: takes, labels and audio come back and are re-measured for free.
await page.reload();
await page.waitForFunction(() => [1, 2, 7].every((n) => window.__singingTest?.view.get(n)?.u), null, { timeout: 60000 });
assert.equal(posts, 2, 'no transcription on reload');
assert.equal(await page.$eval('#take-7 .judged', (s) => s.value), other);
assert.equal(await page.evaluate(() => window.__singingTest.view.get(7).u.tier), engine7, 'same decision from the saved reading');

// Re-analyse button: free.
await page.click('#take-7 .rerun');
await page.waitForFunction(() => document.querySelector('#take-7 .verdict'));
assert.equal(posts, 2);

// Results for the thread.
await page.click('#stCopy');
const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
assert.equal(copied.kind, 'sonmira-singing-test');
const c7 = copied.takes.find((t) => t.slot === 7);
assert.equal(c7.engine, engine7); assert.equal(c7.judged, other);
assert.ok(c7.performance.windows.length >= 1 && c7.strong.length > 5 && c7.gate.length > 5);
console.log('copied', JSON.stringify(copied).length, 'chars; take 7 strong checks:', c7.strong.map(([id, ok]) => `${id}${ok ? '✓' : '✗'}`).join(' '));

// Phone width: no horizontal page scroll.
await page.setViewportSize({ width: 390, height: 844 });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await page.screenshot({ path: `${S}/2-phone.png`, fullPage: false });
const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.scroll')).slice(0, 8).map((e) => `${e.tagName}.${e.className}`));
assert.ok(overflow <= 1, `page overflows by ${overflow}px at phone width: ${wide.join(', ')}`);

// A deployment without a transcription key: the tier comes from the singing
// alone, and nothing is sent.
const page2 = await ctx.newPage();
page2.on('pageerror', (e) => errors.push(String(e)));
let posts2 = 0;
await page2.route('**/api/understand', (route) => {
  if (route.request().method() === 'GET') return route.fulfill({ json: { configured: false } });
  posts2++; return route.fulfill({ status: 503, json: { ok: false, code: 'not_configured' } });
});
await page2.goto(`${BASE}?view=singing`);
await page2.waitForFunction(() => [1, 2, 7].every((n) => window.__singingTest?.view.get(n)?.u), null, { timeout: 60000 });
const only = await page2.evaluate(() => [7, 1].map((n) => ({ tier: window.__singingTest.view.get(n).u.tier, checked: window.__singingTest.view.get(n).u.wordsChecked })));
console.log('no key, saved takes →', JSON.stringify(only));
const t7b = await page2.innerText('#take-7 .out');
assert.ok(only[0].checked === false || /moon lies quiet/.test(t7b), 'saved words are reused; otherwise singing only');
await page2.click('#take-9 .recbtn'); await page2.waitForTimeout(6000); await page2.click('#take-9 .recbtn');
await page2.waitForFunction(() => document.querySelector('#take-9 .verdict'), null, { timeout: 60000 });
const t9 = await page2.innerText('#take-9 .out');
console.log('no key, new take 9 →', t9.split('\n').slice(0, 3).join(' | '));
assert.match(t9, /singing only, words not checked/);
assert.match(t9, /Resolved|Gathered/);
assert.equal(posts2, 0, 'no transcription call without a key');
assert.match(await page2.textContent('#stServer'), /singing alone/);

assert.deepEqual(errors, []);
console.log('singing test ok; screenshots in', S);
await browser.close();

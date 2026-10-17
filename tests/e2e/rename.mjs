// Renaming a kept painting from its detail view, on paintings made before the
// feature existed: a diary seeded by the mock engine through the app, plus a
// record written straight to IndexedDB the way older builds stored an AI
// painting (image bytes, no note field). Covers the pencil, keeping the old
// title while editing, Done / Save / Cancel / Escape, cleared titles, the
// saving state, a failed save, and the title surviving a reload.
//
//   node server.js &  then  node tests/e2e/rename.mjs   (SHOTS=dir saves screenshots)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS;
const png = [...readFileSync(fileURLToPath(new URL('../../assets/art/impression-1.png', import.meta.url)))];
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const url = BASE + '?engine=mock';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { /* stand-in install token (protect/client.js), no invitation sheet */ let a = null; try { a = JSON.parse(localStorage.getItem('sonmira.account')); } catch {} if (!a?.id) { a = { id: 'e2e-device-00000001', token: null, user: null, since: null }; localStorage.setItem('sonmira.account', JSON.stringify(a)); } localStorage.setItem('sonmira.access', `v1.${btoa(JSON.stringify({ i: a.id }))}.mock`); localStorage.setItem('sonmira.previewSeeded', '1'); });
const page = await ctx.newPage();
page.on('pageerror', (e) => { throw e; });

// Read a stored record as it is on disk (not through the app's memory).
const stored = (id) => page.evaluate((id) => new Promise((res, rej) => {
  const r = indexedDB.open('sonmira', 1);
  r.onsuccess = () => { const g = r.result.transaction('entries').objectStore('entries').get(id); g.onsuccess = () => { res(g.result); r.result.close(); }; g.onerror = () => rej(g.error); };
}), id);
const titleText = () => page.textContent('[data-screen=detail] .detail-title .caption');
const open = async (id) => {
  await page.evaluate((id) => window.sonmira.navigate('detail', { id }), id);
  await page.waitForFunction(() => document.querySelectorAll('[data-screen]').length === 1 && document.querySelector('[data-screen=detail] .title-btn'));
};

// ── previously generated paintings ───────────────────────────────────────
await page.goto(url);
await page.waitForSelector('[data-screen=diary]');
await page.evaluate(async () => (await import('/src/app/dev.js')).seed(window.sonmira));
await page.evaluate((bytes) => new Promise((res, rej) => {
  const r = indexedDB.open('sonmira', 1);
  r.onsuccess = () => {
    const t = r.result.transaction('entries', 'readwrite');
    t.objectStore('entries').put({
      id: 'legacy-ai-1', createdAt: Date.now() - 864e5 * 20, date: '2026-09-27', durationSec: 11, audio: null, audioType: null,
      analysis: { durationSec: 11, flags: { silent: false, tooShort: false }, wash: [], features: {} },
      painting: { completeness: 'resolved', emotion: 'tender', motif: 'water', wash: [], interpretation: { voiceLabel: 'Soft', summary: '', dryingLine: '' },
        artwork: { kind: 'image', focus: null, bytes: new Uint8Array(bytes).buffer, type: 'image/png' } },
    });
    t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error);
  };
}), png);
await page.reload();
await page.waitForSelector('[data-entry=legacy-ai-1]');
const seeded = await page.evaluate(() => window.sonmira.sortedEntries().filter((e) => e.id.startsWith('sample-')).map((e) => ({ id: e.id, note: e.note })));
assert.ok(seeded.length >= 5, 'the mock diary was seeded');

// ── a titled painting: the pencil, old title kept, Done saves ────────────
const a = seeded.find((e) => e.note === 'Rain on the window');
await open(a.id);
assert.equal(await titleText(), 'Rain on the window');
assert.equal(await page.getAttribute('[data-screen=detail] .title-btn svg', 'data-icon'), 'rename', 'a pencil sits by the title');
await shot(page, 'r1-detail');
await page.click('[data-screen=detail] .detail-title .caption'); // tapping the title itself edits
assert.equal(await page.inputValue('.detail-title .caption-input'), 'Rain on the window', 'editing starts from the existing title');
assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('caption-input')), true, 'the field is focused');
assert.equal(await page.getAttribute('.detail-title .caption-input', 'enterkeyhint'), 'done');
await shot(page, 'r2-editing');
await page.fill('.detail-title .caption-input', 'Rain on the bus window');
await page.press('.detail-title .caption-input', 'Enter');
await page.waitForSelector('[data-screen=detail] .title-btn');
assert.equal(await titleText(), 'Rain on the bus window', 'Done saves');
assert.equal((await stored(a.id)).note, 'Rain on the bus window', 'written to IndexedDB');
assert.ok((await stored(a.id)).painting, 'the painting itself is untouched');

// ── Cancel and Escape keep the title ─────────────────────────────────────
await page.click('[data-screen=detail] .title-btn svg'); // the pencil
await page.fill('.detail-title .caption-input', 'something else');
await page.click('.detail-title .title-actions >> text=Cancel');
assert.equal(await titleText(), 'Rain on the bus window', 'Cancel keeps the title');
await page.click('[data-screen=detail] .title-btn');
await page.fill('.detail-title .caption-input', 'something else');
await page.press('.detail-title .caption-input', 'Escape');
assert.equal(await titleText(), 'Rain on the bus window', 'Escape keeps the title');
assert.equal((await stored(a.id)).note, 'Rain on the bus window');

// ── the diary and a reload show the new title ────────────────────────────
await page.click('[aria-label="Back to diary"]');
await page.waitForSelector(`[data-screen=diary]:not(.leave) [data-entry="${a.id}"]`);
assert.equal(await page.textContent(`[data-screen=diary]:not(.leave) [data-entry="${a.id}"] .cap`), 'Rain on the bus window', 'the diary card follows');
await page.reload();
await page.waitForSelector('[data-screen=diary]');
await open(a.id);
assert.equal(await titleText(), 'Rain on the bus window', 'survives a reload');

// ── a cleared title reads Untitled; pasted line breaks become spaces ─────
await page.click('[data-screen=detail] .title-btn');
await page.fill('.detail-title .caption-input', '   ');
await page.click('.detail-title .title-actions >> text=Save');
await page.waitForSelector('[data-screen=detail] .caption.untitled');
assert.equal(await titleText(), 'Untitled');
assert.equal((await stored(a.id)).note, '');
await page.click('[data-screen=detail] .title-btn');
assert.equal(await page.inputValue('.detail-title .caption-input'), '', 'an untitled painting edits from empty, not from the word Untitled');
await page.fill('.detail-title .caption-input', 'Rain\non the window');
assert.equal(await page.inputValue('.detail-title .caption-input'), 'Rain on the window');
await page.press('.detail-title .caption-input', 'Enter');
await page.waitForSelector('[data-screen=detail] .title-btn');
assert.equal(await titleText(), 'Rain on the window');

// ── an older AI painting with no note field at all ───────────────────────
await open('legacy-ai-1');
assert.equal(await titleText(), 'Untitled');
assert.equal('note' in (await stored('legacy-ai-1')), false, 'stored before notes were kept');
await page.click('[data-screen=detail] .title-btn');
await page.click('.detail-title .title-actions >> text=Save'); // nothing changed
await page.waitForSelector('[data-screen=detail] .title-btn');
assert.equal('note' in (await stored('legacy-ai-1')), false, 'saving an unchanged title writes nothing');
await page.click('[data-screen=detail] .title-btn');
await page.fill('.detail-title .caption-input', 'By the lake, September');

// ── saving: a slow write shows Saving…, a failed write keeps the edit ────
await page.evaluate(() => {
  window.__idb = { put: IDBObjectStore.prototype.put };
  IDBObjectStore.prototype.put = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
});
await page.click('.detail-title .title-actions >> text=Save');
await page.waitForSelector('.toast');
assert.match(await page.textContent('.toast'), /Couldn’t save the title/);
assert.equal(await page.inputValue('.detail-title .caption-input'), 'By the lake, September', 'the edit stays on screen');
assert.equal(await page.isDisabled('.detail-title .title-actions >> text=Save'), false, 'Save can be tried again');
assert.equal('note' in (await stored('legacy-ai-1')), false);
await shot(page, 'r3-save-failed');

// Hold the transaction open so the saving state is visible, then let it land.
await page.evaluate(() => {
  const { put } = window.__idb;
  IDBObjectStore.prototype.put = function (...args) {
    const store = this, req = put.apply(store, args);
    // keep the transaction busy for a moment with harmless reads
    const until = Date.now() + 700; const spin = () => { if (Date.now() < until) store.get('__none__').onsuccess = spin; }; spin();
    return req;
  };
});
await page.click('.detail-title .title-actions >> text=Save');
assert.equal(await page.textContent('.detail-title .title-actions .save'), 'Saving…');
assert.equal(await page.isDisabled('.detail-title .title-actions .save'), true);
assert.equal(await page.isDisabled('.detail-title .title-actions >> text=Cancel'), true);
assert.equal(await page.getAttribute('.detail-title .caption-input', 'readonly'), '');
await shot(page, 'r4-saving');
await page.waitForSelector('[data-screen=detail] .title-btn');
await page.evaluate(() => { IDBObjectStore.prototype.put = window.__idb.put; });
assert.equal(await titleText(), 'By the lake, September');
assert.equal((await stored('legacy-ai-1')).note, 'By the lake, September');
assert.equal((await stored('legacy-ai-1')).painting.artwork.kind, 'image', 'the image is kept');
await page.reload();
await page.waitForSelector('[data-screen=diary]');
await open('legacy-ai-1');
assert.equal(await titleText(), 'By the lake, September', 'the older painting keeps its new title after a reload');
assert.equal(await page.evaluate(() => !!document.querySelector('[data-screen=detail] .painting img, [data-screen=detail] .painting canvas')), true, 'its image still shows');
await shot(page, 'r5-legacy-renamed');

await browser.close();
console.log('rename: all checks passed');

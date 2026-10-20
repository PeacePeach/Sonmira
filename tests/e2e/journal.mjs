// The post-recording flow: Record → small preview → expanded artwork →
// title and journal → Save, with the mock engine (no network, no paid calls).
// Covers the preview's unchanged size, the expansion to the detail page's
// artwork size, no writing fields before the painting, audio carrying on
// across steps, the 45-character title (typed, pasted, Chinese IME), the
// journal saved, reloaded and edited later, entries from before the journal,
// Reduce Motion, and a small screen.
//
//   node server.js &  then  node tests/e2e/journal.mjs   (SHOTS=dir saves screenshots)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS;
const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const png = [...readFileSync(fileURLToPath(new URL('../../assets/art/impression-1.png', import.meta.url)))];
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const url = BASE + '?engine=mock';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
});
const token = () => { /* stand-in install token (protect/client.js), no invitation sheet */ let a = null; try { a = JSON.parse(localStorage.getItem('sonmira.account')); } catch {} if (!a?.id) { a = { id: 'e2e-device-00000001', token: null, user: null, since: null }; localStorage.setItem('sonmira.account', JSON.stringify(a)); } localStorage.setItem('sonmira.access', `v1.${btoa(JSON.stringify({ i: a.id }))}.mock`); localStorage.setItem('sonmira.previewSeeded', '1'); };
async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...opts });
  await ctx.addInitScript(token);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('[data-screen=diary]');
  return { ctx, page, errors };
}
const box = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
const card = '[data-screen=sing] .painting';
async function paint(page) {
  await page.click('.fab');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await page.waitForTimeout(3000);
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
}
const settled = (page) => page.waitForFunction((s) => !document.querySelector(s).getAnimations().some((a) => a.playState === 'running' && a.effect?.getKeyframes?.().some((k) => k.width)), card);

// ── the flow at iPhone size ──────────────────────────────────────────────
{
  const { ctx, page, errors } = await open({ width: 393, height: 852 });
  await paint(page);
  // Step 1: the small preview, as before: 3:2 inside 24 pt margins, a player, no writing fields
  const small = await box(page, card);
  assert.deepEqual([small.x, small.w, small.h], [24, 345, 230], 'the preview card keeps its size: ' + JSON.stringify(small));
  assert.ok(await page.$('[data-phase=preview] .play-btn'), 'listen back is there');
  assert.equal(await page.$$eval('[data-screen=sing] textarea', (x) => x.length), 0, 'no title or journal before the painting');
  const generate = await page.evaluate(() => { const g = window.sonmira.engine.generate; let n = 0; window.sonmira.engine.generate = (...a) => { n++; window.__gens = n; return g.apply(window.sonmira.engine, a); }; return true; });
  assert.ok(generate);
  await page.click('text=Create painting');
  await page.waitForSelector('.painting img.art:not(.hidden)', { timeout: 15000 });
  assert.deepEqual(await box(page, card), small, 'the artwork arrives in the same small card');
  await shot(page, 'j1-small');

  // Step 2: it grows (mostly taller) into the detail page's artwork size
  await page.waitForSelector('[data-step=expanded]', { timeout: 8000 });
  await settled(page);
  const big = await box(page, card);
  assert.deepEqual([big.x, big.w, big.h], [18, 357, 446], 'the detail page artwork size: ' + JSON.stringify(big));
  assert.ok(big.h - small.h > 4 * (big.w - small.w), 'it grows mostly vertically');
  const fit = await page.$eval(`${card} img.art`, (i) => getComputedStyle(i).objectFit);
  assert.equal(fit, 'cover', 'proportions kept, never stretched');
  assert.equal(await page.$$eval('[data-screen=sing] textarea', (x) => x.length), 0, 'still no writing fields');
  assert.equal(await page.$$eval('[data-screen=sing] .painting', (x) => x.length), 1, 'one artwork, no second full preview');
  await shot(page, 'j2-expanded');
  // the recording plays, and keeps playing through Next
  await page.click('[data-step=expanded] .play-btn');
  await page.waitForFunction(() => document.querySelector('[data-step=expanded] .player .times span').textContent !== '0:00');
  await page.click('text=Next');
  await page.waitForSelector('[data-step=journal]');
  assert.equal(await page.getAttribute('.sing-canvas .play-btn', 'aria-label'), 'Pause recording', 'audio not restarted or stopped by Next');
  await settled(page);
  const thumb = await box(page, card);
  assert.ok(thumb.w < 140 && Math.abs(thumb.w / thumb.h - 1.5) < 0.05, 'a compact landscape thumbnail: ' + JSON.stringify(thumb));
  const playerBox = await box(page, '.sing-canvas .player');
  assert.ok(Math.abs((playerBox.y + playerBox.h / 2) - (thumb.y + thumb.h / 2)) < 12, 'the player sits beside the thumbnail');
  assert.equal(await page.evaluate(() => window.__gens), 1, 'one generation, none from moving between steps');

  // Step 3: the title, 45 characters, typed and pasted
  await page.click('[data-step=journal] .caption-input');
  await page.keyboard.type('Rain on the window and the long road home through the evening');
  assert.equal(await page.inputValue('.caption-input'), 'Rain on the window and the long road home thr');
  assert.equal(await page.textContent('[data-step=journal] .char-count'), '45/45');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-step=journal] .char-count')).opacity === '1'); // the counter shows while editing
  const titleStyle = await page.$eval('.caption-input', (i) => { const s = getComputedStyle(i); return [s.borderTopWidth, s.borderBottomWidth, s.borderRadius, s.backgroundColor]; });
  assert.deepEqual(titleStyle, ['0px', '1px', '0px', 'rgba(0, 0, 0, 0)'], 'underline only');
  await page.fill('.caption-input', '');
  await page.keyboard.insertText('x'.repeat(60));
  assert.equal(await page.inputValue('.caption-input'), 'x'.repeat(45), 'a paste stops at 45');
  // Chinese IME: composing isn't cut; the committed text is held to 45
  await page.fill('.caption-input', '');
  await page.keyboard.type('雨落在窗上的声音');
  const cdp = await ctx.newCDPSession(page);
  await page.keyboard.type('一'.repeat(35));
  await cdp.send('Input.imeSetComposition', { text: 'chuang', selectionStart: 6, selectionEnd: 6 });
  await cdp.send('Input.imeSetComposition', { text: '窗外的雨', selectionStart: 4, selectionEnd: 4 });
  await cdp.send('Input.insertText', { text: '窗外的雨' });
  const zh = await page.inputValue('.caption-input');
  assert.equal(Array.from(zh).length, 45, 'committed IME text held to 45: ' + zh);
  assert.ok(zh.startsWith('雨落在窗上的声音' + '一'.repeat(35)) && zh.endsWith('窗外'), 'what fits of the phrase goes in: ' + zh);
  await page.fill('.caption-input', '');
  await cdp.send('Input.imeSetComposition', { text: 'yu', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.insertText', { text: '雨天' });
  await page.keyboard.type(' Rain');
  assert.equal(await page.inputValue('.caption-input'), '雨天 Rain');
  // the journal: several paragraphs, underline only
  await page.press('.caption-input', 'Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('journal-input')), true, 'Enter on the title moves to the journal');
  assert.equal(await page.getAttribute('.journal-input', 'placeholder'), 'Write about this moment...');
  await page.keyboard.type('First line.\n\nA second paragraph.');
  await shot(page, 'j3-journal');
  // back to the artwork and forward again: what was written stays
  await page.click(card);
  await page.waitForSelector('[data-step=expanded]');
  await page.click('text=Next');
  await page.waitForSelector('[data-step=journal]');
  assert.equal(await page.inputValue('.caption-input'), '雨天 Rain');
  assert.equal(await page.inputValue('.journal-input'), 'First line.\n\nA second paragraph.');
  await page.click('[data-step=journal] .pill'); // Save
  await page.waitForSelector('[data-screen=diary] .entry');
  assert.equal(await page.textContent('.entry .cap'), '雨天 Rain');

  // detail: the journal is there, survives a reload, and can be edited
  await page.reload();
  await page.click('.entry');
  await page.waitForSelector('[data-screen=detail] .journal-text');
  assert.equal(await page.textContent('[data-screen=detail] .journal-text'), 'First line.\n\nA second paragraph.');
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').getAnimations().every((a) => a.playState !== 'running')); // the push-in has finished
  assert.deepEqual(await box(page, '[data-screen=detail] .painting'), big, 'the expanded artwork was exactly the detail artwork');
  await shot(page, 'j4-detail');
  await page.click('[data-screen=detail] .journal-btn');
  await page.fill('[data-screen=detail] .journal-input', 'Edited later.\nTwo lines.');
  await page.click('[data-screen=detail] .edit-btn'); // Save
  await page.waitForSelector('[data-screen=detail] .journal-text');
  // the detail title holds 45 characters too
  await page.click('[data-screen=detail] .title-btn');
  await page.fill('.detail-title .caption-input', '');
  await page.keyboard.insertText('y'.repeat(60));
  assert.equal(await page.inputValue('.detail-title .caption-input'), 'y'.repeat(45));
  await page.press('.detail-title .caption-input', 'Escape');
  await page.reload();
  await page.click('.entry');
  await page.waitForSelector('[data-screen=detail] .journal-text');
  assert.equal(await page.textContent('[data-screen=detail] .journal-text'), 'Edited later.\nTwo lines.');
  assert.equal(await page.textContent('[data-screen=detail] .caption'), '雨天 Rain', 'Escape (Cancel) kept the title');
  assert.deepEqual(errors, [], 'no page errors');
  await ctx.close();
}

// ── entries from before the journal (and long titles) ─────────────────────
{
  const { ctx, page, errors } = await open({ width: 393, height: 852 });
  const long = 'A very long title written before the thirty character limit';
  await page.evaluate(({ bytes, long }) => new Promise((res, rej) => {
    const r = indexedDB.open('sonmira', 1);
    r.onsuccess = () => {
      const t = r.result.transaction('entries', 'readwrite');
      t.objectStore('entries').put({
        id: 'legacy-1', createdAt: Date.now() - 864e5, date: '2026-09-27', note: long, durationSec: 11, audio: null, audioType: null,
        analysis: { durationSec: 11, flags: { silent: false, tooShort: false }, wash: [], features: {} },
        painting: { completeness: 'resolved', emotion: 'tender', motif: 'water', wash: [], interpretation: { voiceLabel: 'Soft', summary: '', dryingLine: '' },
          artwork: { kind: 'image', focus: null, bytes: new Uint8Array(bytes).buffer, type: 'image/png' } },
      });
      t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error);
    };
  }), { bytes: png, long });
  await page.reload();
  await page.click('[data-entry=legacy-1]');
  await page.waitForSelector('[data-screen=detail] .journal-empty');
  assert.equal(await page.textContent('[data-screen=detail] .journal-empty'), 'Write about this moment...', 'no journal: an invitation to write one');
  await page.click('[data-screen=detail] .title-btn');
  assert.equal(await page.inputValue('.detail-title .caption-input'), long, 'a long old title is kept whole while editing');
  await page.press('.detail-title .caption-input', 'End');
  await page.keyboard.type('!');
  assert.equal(await page.inputValue('.detail-title .caption-input'), long, 'but it can’t grow');
  await page.press('.detail-title .caption-input', 'Escape');
  await page.click('[data-screen=detail] .journal-empty');
  await page.fill('[data-screen=detail] .journal-input', 'Added to an old painting.');
  await page.click('[data-screen=detail] .edit-btn'); // Save
  await page.waitForSelector('[data-screen=detail] .journal-text');
  const rec = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('sonmira', 1); r.onsuccess = () => { const g = r.result.transaction('entries').objectStore('entries').get('legacy-1'); g.onsuccess = () => { res({ journal: g.result.journal, note: g.result.note, art: !!g.result.painting.artwork.bytes }); r.result.close(); }; }; }));
  assert.deepEqual(rec, { journal: 'Added to an old painting.', note: long, art: true }, 'only the journal was added');
  assert.deepEqual(errors, [], 'no page errors');
  await ctx.close();
}

// ── Reduce Motion, on a small screen ─────────────────────────────────────
{
  const { ctx, page, errors } = await open({ width: 320, height: 568 }, { reducedMotion: 'reduce' });
  await paint(page);
  await page.click('text=Create painting');
  await page.waitForSelector('[data-step=expanded]', { timeout: 15000 });
  assert.equal(await page.$eval(card, (c) => c.getAnimations().filter((a) => a.effect?.getKeyframes?.().some((k) => k.width)).length), 0, 'no size animation with Reduce Motion');
  await page.click('text=Next');
  await page.waitForSelector('[data-step=journal]');
  await page.click('.journal-input');
  await page.keyboard.type(Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of a longer entry.`).join('\n'));
  await page.waitForTimeout(500);
  const view = await page.evaluate(() => {
    const j = document.querySelector('.journal-input').getBoundingClientRect(), s = document.querySelector('[data-screen=sing]');
    return { bottom: Math.round(j.bottom), screen: innerHeight, scrolled: s.scrollTop };
  });
  assert.ok(view.scrolled > 0 && view.bottom <= view.screen, 'the journal scrolls into view as it grows: ' + JSON.stringify(view));
  await page.$eval('[data-screen=sing]', (s) => { s.scrollTop = s.scrollHeight; });
  const save = await box(page, '[data-step=journal] .pill');
  assert.ok(save.y + save.h <= 568, 'Save is reachable by scrolling');
  await shot(page, 'j5-small-screen');
  assert.deepEqual(errors, [], 'no page errors');
  await ctx.close();
}

await browser.close();
console.log('journal flow: ok');

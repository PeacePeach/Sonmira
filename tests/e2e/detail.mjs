// The detail page's three states, with the mock engine (no network, no paid
// calls): expanded → compact by scrolling into the journal and back by
// pulling down at its top (wheel and touch), the artwork never stretched, the
// artwork / date / title / player fixed while a long journal scrolls clear of
// the player, Edit → Save of both fields together (kept across a reload;
// Cancel and Escape let an edit go), the recording playing on through every
// change, short / empty / very long journals, Reduce Motion and a small screen.
//
//   node server.js &  then  node tests/e2e/detail.mjs   (SHOTS=dir saves screenshots)

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS;
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const url = BASE + '?engine=mock';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] });
const token = () => { /* stand-in install token (protect/client.js), no invitation sheet */ let a = null; try { a = JSON.parse(localStorage.getItem('sonmira.account')); } catch {} if (!a?.id) { a = { id: 'e2e-device-00000001', token: null, user: null, since: null }; localStorage.setItem('sonmira.account', JSON.stringify(a)); } localStorage.setItem('sonmira.access', `v1.${btoa(JSON.stringify({ i: a.id }))}.mock`); localStorage.setItem('sonmira.previewSeeded', '1'); };

const LONG = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}: the rain kept on through the evening, and the song stayed with it.`).join('\n\n');
const D = '[data-screen=detail]';

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, ...opts });
  await ctx.addInitScript(token);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('[data-screen=diary]');
  await page.evaluate(async () => (await import('/src/app/dev.js')).seed(window.sonmira));
  // three paintings: a very long journal, a short one, none
  const ids = await page.evaluate(async (LONG) => {
    const app = window.sonmira, list = app.sortedEntries();
    await app.updateEntry({ ...list[0], journal: LONG });
    await app.updateEntry({ ...list[1], journal: 'A short line.' });
    await app.updateEntry({ ...list[2], journal: '' });
    return list.slice(0, 3).map((e) => e.id);
  }, LONG);
  return { ctx, page, errors, ids };
}
async function detail(page, id) {
  await page.evaluate((id) => window.sonmira.navigate('detail', { id }), id);
  await page.waitForFunction(() => document.querySelectorAll('[data-screen]').length === 1 && document.querySelector('[data-screen=detail]'));
  await settled(page);
}
const settled = (page) => page.waitForFunction(() => document.querySelector('[data-screen=detail]').getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.effect?.getTiming?.().iterations === Infinity));
const box = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; }, sel);
const mode = (page) => page.getAttribute(D, 'data-mode');
const ratio = (b) => b.w / b.h;
async function wheel(page, dy, at = '.detail-scroll') {
  const b = await box(page, `${D} ${at}`);
  await page.mouse.move(b.x + b.w / 2, b.y + Math.min(b.h / 2, 40));
  await page.mouse.wheel(0, dy);
}
const sizeAnimations = (page) => page.$eval(`${D} .painting`, (c) => c.getAnimations().filter((a) => a.effect?.getKeyframes?.().some((k) => k.width)).length);
const playing = (page) => page.getAttribute(`${D} .play-btn`, 'aria-label').then((l) => l === 'Pause recording');

// Every edge on the page, left and right: all must sit on the large artwork's edges.
const edges = (page) => page.evaluate(() => {
  const D = document.querySelector('[data-screen=detail]'), W = D.getBoundingClientRect().width;
  const text = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
  const bar = [...D.querySelectorAll('.navrow button:not([hidden])')];
  const first = bar[0].querySelector('svg path') ?? bar[0]; // the chevron's point, not its box
  const rect = (sel) => D.querySelector(sel).getBoundingClientRect();
  const lr = [
    ['bar', (first.tagName === 'path' ? first.getBoundingClientRect() : text(first)).left, W - text(bar[bar.length - 1]).right],
    ['artwork', rect('.painting').left, W - rect('.painting').right],
    ['date', text(D.querySelector('.caps')).left, null],
    ['title', rect('.title-btn, .caption-input').left, W - rect('.title-btn, .caption-input').right],
    ['journal', rect('.journal-btn, .journal-input').left, W - rect('.journal-btn, .journal-input').right],
    ['player', rect('.play-btn').left, W - rect('.player .track').right],
  ];
  return lr.map(([k, l, r]) => [k, Math.round(l), r == null ? null : Math.round(r)]);
});
const aligned = async (page, label) => {
  const e = await edges(page);
  const off = e.filter(([, l, r]) => l !== 18 || (r != null && r !== 18));
  assert.deepEqual(off, [], `${label}: everything lines up with the large artwork's edges: ` + JSON.stringify(e));
};

// ── iPhone size: the three states ────────────────────────────────────────
{
  const { ctx, page, errors, ids } = await open({ width: 393, height: 852 });
  await detail(page, ids[0]);
  assert.equal(await mode(page), 'expanded');
  const big = await box(page, `${D} .painting`);
  assert.deepEqual([big.x, big.w, big.h], [18, 357, 446], 'the expanded artwork is as large as before: ' + JSON.stringify(big));
  const nav = await page.$$eval(`${D} .navrow button:not([hidden])`, (b) => b.map((x) => x.getAttribute('aria-label') || x.textContent));
  assert.deepEqual(nav, ['Back to diary', 'Share', 'Delete', 'Edit'], 'Back and Share icons, Delete and Edit labels');
  const dateTop = (await box(page, `${D} .detail-meta .caps`)).y;
  assert.ok(dateTop - big.bottom >= 30, 'more room between the artwork and the date');
  const dock = await box(page, `${D} .detail-dock`);
  assert.equal(dock.bottom, 852, 'the player is docked at the bottom');
  assert.equal(await page.$eval(`${D} .detail-dock`, (d) => getComputedStyle(d, '::after').backgroundImage.startsWith('linear-gradient')), true, 'over a fade');
  await aligned(page, 'expanded');
  await shot(page, 'd1-expanded');

  // the recording plays on through every change below
  await page.click(`${D} .play-btn`);
  assert.ok(await playing(page));

  // scroll toward the journal: expanded → compact, one continuous morph
  await wheel(page, 120);
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'compact');
  if (!(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))) assert.equal(await sizeAnimations(page), 1, 'the artwork morphs in size');
  await settled(page);
  const small = await box(page, `${D} .painting`);
  assert.ok(small.h < big.h / 1.5 && Math.abs(ratio(small) - 1.5) < 0.02, 'a smaller landscape artwork: ' + JSON.stringify(small));
  assert.deepEqual([small.x, small.w], [big.x, big.w], 'the same side margins as the portrait');
  assert.equal(await page.$eval(`${D} .painting img.art`, (i) => getComputedStyle(i).objectFit), 'cover', 'proportions kept, never stretched');
  await aligned(page, 'compact');
  await shot(page, 'd2-compact');

  // only the journal scrolls; the rest stays put, and the last line clears the player
  const fixed = async () => Promise.all(['.painting', '.detail-meta', '.detail-dock', '.navrow'].map((s) => box(page, `${D} ${s}`)));
  const before = await fixed();
  await wheel(page, 600);
  await page.waitForTimeout(300);
  assert.ok(await page.$eval(`${D} .detail-scroll`, (s) => s.scrollTop) > 300, 'the journal scrolls');
  assert.deepEqual(await fixed(), before, 'artwork, date, title, player and nav stay fixed');
  assert.equal(await mode(page), 'compact', 'still compact while reading');
  await shot(page, 'd3-compact-scrolled');
  await page.$eval(`${D} .detail-scroll`, (s) => { s.scrollTop = s.scrollHeight; });
  const lastLine = await page.evaluate(() => { const r = document.createRange(); const p = document.querySelector('[data-screen=detail] .journal-text'); r.selectNodeContents(p); const rs = r.getClientRects(); return Math.round(rs[rs.length - 1].bottom); });
  assert.ok(lastLine <= (await box(page, `${D} .detail-dock .player`)).y, 'the end of a long journal is readable above the player');
  await shot(page, 'd4-compact-end');

  // a fling back to the top doesn't expand it; a fresh pull at the top does
  await wheel(page, -100000);
  await page.waitForTimeout(100);
  assert.equal(await page.$eval(`${D} .detail-scroll`, (s) => s.scrollTop), 0);
  assert.equal(await mode(page), 'compact', 'the gesture that reached the top leaves it compact');
  await page.waitForTimeout(300);
  await wheel(page, -120);
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'expanded');
  await settled(page);
  assert.deepEqual(await box(page, `${D} .painting`), big, 'back to the portrait artwork, exactly');
  assert.ok(await playing(page), 'audio kept playing through the transitions');

  // a scroll that starts on the fixed artwork works too, and tapping the
  // landscape card opens the portrait again
  await wheel(page, 120, '.art-pad');
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'compact');
  await settled(page);
  await page.click(`${D} .painting`);
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'expanded');
  await settled(page);

  // Edit from expanded → compact edit; both fields, the creation flow's own
  await page.click(`${D} .edit-btn`);
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'edit');
  await settled(page);
  assert.ok(Math.abs(ratio(await box(page, `${D} .painting`)) - 1.5) < 0.02, 'editing uses the compact artwork');
  assert.equal(await page.textContent(`${D} .edit-btn`), 'Save', 'Edit became Save');
  const bar = await page.$$eval(`${D} .navrow button:not([hidden])`, (b) => b.map((x) => x.getAttribute('aria-label') || x.textContent));
  assert.deepEqual(bar, ['Cancel', 'Delete', 'Save'], 'editing: Cancel, Delete, Save; no Share');
  const editBox = await box(page, `${D} .edit-btn`);
  assert.ok(await page.$(`${D} .detail-title .title-field .caption-input`) && await page.$(`${D} .detail-journal textarea.journal-input`), 'title and journal both editable');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('caption-input')), true, 'the title is focused');
  const titleStyle = await page.$eval(`${D} .caption-input`, (i) => { const s = getComputedStyle(i); return [s.borderTopWidth, s.borderBottomWidth]; });
  assert.deepEqual(titleStyle, ['0px', '1px'], 'title: underline');
  assert.equal(await page.$eval(`${D} .journal-input`, (i) => getComputedStyle(i).borderBottomWidth), '0px', 'journal: no underline');
  await page.fill(`${D} .caption-input`, '');
  await page.keyboard.insertText('Evening rain over the long road home, under a quiet sky');
  assert.equal(await page.inputValue(`${D} .caption-input`), 'Evening rain over the long road home, under a', 'held to 45');
  assert.equal(await page.textContent(`${D} .char-count`), '45/45', 'with its counter');
  await page.press(`${D} .caption-input`, 'Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('journal-input')), true, 'Enter moves to the journal');
  await page.fill(`${D} .journal-input`, 'Rewritten.\n\nTwo paragraphs.');
  await aligned(page, 'editing');
  await shot(page, 'd5-edit');
  // the keyboard closing keeps what was typed; Cancel lets it go
  await page.evaluate(() => document.activeElement.blur());
  assert.equal(await mode(page), 'edit', 'still editing with the keyboard down');
  assert.equal(await page.inputValue(`${D} .journal-input`), 'Rewritten.\n\nTwo paragraphs.');
  await page.click(`${D} .cancel-btn`);
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'compact');
  assert.equal(await page.textContent(`${D} .edit-btn`), 'Edit');
  const viewBar = await page.$$eval(`${D} .navrow button:not([hidden])`, (b) => b.map((x) => x.getAttribute('aria-label') || x.textContent));
  assert.deepEqual(viewBar, ['Back to diary', 'Share', 'Delete', 'Edit'], 'Back and Share return');
  assert.ok((await page.textContent(`${D} .journal-text`)).startsWith('Paragraph 1'), 'Cancel saved nothing');
  await page.click(`${D} .journal-btn`); // tapping the journal edits too
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'edit');
  assert.ok((await page.inputValue(`${D} .journal-input`)).startsWith('Paragraph 1'), 'editing starts again from what is saved');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('journal-input')), true, 'the journal is focused');
  await page.fill(`${D} .caption-input`, 'Evening rain over the long road home, under a');
  await page.fill(`${D} .journal-input`, 'Rewritten.\n\nTwo paragraphs.');
  const saveBox = await box(page, `${D} .edit-btn`);
  await page.click(`${D} .edit-btn`); // Save
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'compact');
  const right = (b) => [b.x + b.w, b.y, b.h];
  assert.deepEqual(right(saveBox), right(editBox), 'Save sits where Edit is, at the top right');
  assert.equal(await page.textContent(`${D} .caption`), 'Evening rain over the long road home, under a');
  assert.equal(await page.textContent(`${D} .journal-text`), 'Rewritten.\n\nTwo paragraphs.');
  assert.ok(await playing(page), 'audio kept playing through editing');
  await aligned(page, 'saved');
  await shot(page, 'd6-saved');

  // both kept after a reload
  await page.reload();
  await page.waitForSelector('[data-screen=diary]');
  await detail(page, ids[0]);
  assert.equal(await page.textContent(`${D} .caption`), 'Evening rain over the long road home, under a');
  assert.equal(await page.textContent(`${D} .journal-text`), 'Rewritten.\n\nTwo paragraphs.');

  // a short journal and an empty one
  await detail(page, ids[1]);
  assert.equal(await page.textContent(`${D} .journal-text`), 'A short line.');
  await shot(page, 'd7-short');
  await detail(page, ids[2]);
  assert.equal(await page.textContent(`${D} .journal-empty`), 'Write about this moment...');
  await page.click(`${D} .journal-empty`);
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'edit');
  await page.keyboard.type('Added later.');
  await page.click(`${D} .edit-btn`);
  await page.waitForSelector(`${D} .journal-text`);
  assert.equal(await page.textContent(`${D} .journal-text`), 'Added later.');
  assert.deepEqual(errors, [], 'no page errors');
  await ctx.close();
}

// ── touch: swipe up collapses, a pull at the journal's top expands ───────
{
  const { ctx, page, errors, ids } = await open({ width: 393, height: 852 }, { isMobile: true, hasTouch: true });
  await detail(page, ids[0]);
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (y0, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + ((y1 - y0) * i) / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe(600, 400);
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'compact');
  await settled(page);
  await swipe(500, 700);
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'expanded');
  assert.deepEqual(errors, [], 'no page errors');
  await ctx.close();
}

// ── Reduce Motion, on a small screen ─────────────────────────────────────
{
  const { ctx, page, errors, ids } = await open({ width: 320, height: 568 }, { reducedMotion: 'reduce' });
  await detail(page, ids[0]);
  await shot(page, 'd8-small-expanded');
  await wheel(page, 120, '.art-pad'); // the journal is below the fold here
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'compact');
  assert.equal(await sizeAnimations(page), 0, 'no size animation with Reduce Motion');
  const art = await box(page, `${D} .painting`);
  assert.ok(art.x === 18 && art.w === 284 && Math.abs(ratio(art) - 1.5) < 0.02, 'the landscape card keeps the portrait margins on a small screen too: ' + JSON.stringify(art));
  const room = await box(page, `${D} .detail-scroll`);
  assert.ok(room.h > 120, 'room left for the journal: ' + JSON.stringify(room));
  await shot(page, 'd9-small-compact');
  await page.click(`${D} .edit-btn`);
  await page.waitForFunction(() => document.querySelector('[data-screen=detail]').dataset.mode === 'edit');
  await page.click(`${D} .journal-input`, { position: { x: 20, y: 12 } }); // its top: the rest runs under the player here
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nOne more line at the end.');
  await page.waitForTimeout(500);
  const caretRoom = await page.evaluate(() => {
    const j = document.querySelector('[data-screen=detail] .journal-input').getBoundingClientRect();
    const dock = document.querySelector('[data-screen=detail] .detail-dock .player').getBoundingClientRect();
    return { bottom: Math.round(j.bottom), player: Math.round(dock.top) };
  });
  assert.ok(caretRoom.bottom <= caretRoom.player + 2, 'the journal being written scrolls clear of the player: ' + JSON.stringify(caretRoom));
  const save = await box(page, `${D} .edit-btn`);
  assert.ok(save.y >= 0 && save.bottom <= 568, 'Save is on screen');
  await shot(page, 'd10-small-edit');
  assert.deepEqual(errors, [], 'no page errors');
  await ctx.close();
}

await browser.close();
console.log('detail page: ok');

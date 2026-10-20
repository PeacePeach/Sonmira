// The title's 30-character limit (counted in characters, so Chinese and
// emoji count once), titles from before the limit, and the journal kept with
// a draft. No browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitEdit, charCount, TITLE_MAX, JOURNAL_PLACEHOLDER } from '../src/app/ui/text-field.js';
import { createDrafts } from '../src/app/drafts/index.js';
import { memoryDraftStore } from '../src/app/drafts/store.js';

const typed = (prev, insert, at = prev.length) => {
  const value = prev.slice(0, at) + insert + prev.slice(at);
  return limitEdit({ value, caret: at + insert.length, prev, max: TITLE_MAX });
};

test('the title holds 30 characters', () => {
  assert.equal(TITLE_MAX, 30);
  const full = 'a'.repeat(30);
  assert.deepEqual(typed('a'.repeat(29), 'b'), { value: 'a'.repeat(29) + 'b', caret: 30 });
  assert.deepEqual(typed(full, 'b'), { value: full, caret: 30 }, 'nothing more goes in');
  assert.deepEqual(typed(full, 'b', 10), { value: full, caret: 10 }, 'not in the middle either; the caret stays');
});

test('a paste keeps what fits', () => {
  const r = typed('Rain on the window', ' and the long road home');
  assert.equal(r.value, 'Rain on the window and the lon');
  assert.equal(charCount(r.value), 30);
  assert.equal(r.caret, r.value.length);
  const mid = typed('ab', 'X'.repeat(40), 1);
  assert.equal(mid.value, 'a' + 'X'.repeat(28) + 'b', 'pasted in the middle: the text after the caret stays');
});

test('Chinese and emoji count as one character each', () => {
  assert.equal(charCount('雨落在窗上'), 5);
  assert.equal(charCount('海边🌊'), 3);
  const zh = '一'.repeat(29);
  assert.equal(typed(zh, '二三').value, zh + '二', 'a committed IME phrase is cut to what fits');
  const emoji = typed('a'.repeat(29), '🌊🌊');
  assert.equal(emoji.value, 'a'.repeat(29) + '🌊', 'an emoji is never split in half');
  assert.equal(emoji.caret, 31, 'caret in UTF-16 units, after the emoji');
});

test('a title from before the limit is kept and can only get shorter', () => {
  const old = 'A very long title written before the thirty character limit';
  assert.deepEqual(limitEdit({ value: old, prev: old, max: TITLE_MAX }), { value: old, caret: old.length }, 'shown as it was');
  assert.equal(typed(old, '!').value, old, 'no longer');
  const shorter = old.slice(0, -1);
  assert.equal(limitEdit({ value: shorter, caret: shorter.length, prev: old, max: TITLE_MAX }).value, shorter, 'shorter is fine');
});

test('the journal placeholder', () => {
  assert.equal(JOURNAL_PLACEHOLDER, 'Write about this moment...');
});

test('the title and journal are kept with a draft until Save', async () => {
  let t = 1;
  const d = createDrafts({ store: memoryDraftStore(), now: () => t++ });
  await d.init();
  const take = { key: 'k1', audio: new Blob([new Uint8Array([1])]), durationSec: 3, analysis: { wash: [] } };
  await d.begin(take, { note: '' });
  await d.ready('k1', { artwork: null, wash: [] }, '');
  await d.setNote('k1', 'Kitchen song', 'Steam on the glass.\n\nThe kettle again.');
  let got = await d.get('k1');
  assert.equal(got.note, 'Kitchen song');
  assert.equal(got.journal, 'Steam on the glass.\n\nThe kettle again.');
  await d.setNote('k1', 'Kitchen');
  got = await d.get('k1');
  assert.equal(got.journal, 'Steam on the glass.\n\nThe kettle again.', 'a title-only update keeps the journal');
  await d.begin(take, { note: '' });
  assert.equal((await d.get('k1')).journal, 'Steam on the glass.\n\nThe kettle again.', 'a retried painting keeps it too');
  const entry = await d.keep('k1', { note: got.note, journal: got.journal }, async () => {});
  assert.equal(entry.journal, 'Steam on the glass.\n\nThe kettle again.');
});

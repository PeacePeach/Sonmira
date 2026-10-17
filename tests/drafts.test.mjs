// Recoverable drafts: the recording is kept before painting, a painting
// that wasn't kept stays recoverable, Keep it moves it to the diary once,
// and Discard removes it for good. No browser, no paid calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrafts, entryIdFor, takeOf, newTakeKey } from '../src/app/drafts/index.js';
import { memoryDraftStore, toRecord, fromRecord } from '../src/app/drafts/store.js';

const take = (key = 'take-1') => ({ key, audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }), durationSec: 12.4, analysis: { durationSec: 12.4, flags: { silent: false }, wash: [] } });
const painting = () => ({ engineId: 'test', completeness: 'resolved', artwork: { kind: 'image', blob: new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }) }, wash: [], interpretation: { dryingLine: '…' } });

async function setup() {
  let t = 1000;
  const drafts = createDrafts({ store: memoryDraftStore(), now: () => t++ });
  await drafts.init();
  return drafts;
}

test('the recording is kept from the moment painting starts', async () => {
  const d = await setup();
  assert.equal(await d.begin(take(), { note: 'by the sea', date: '2026-10-16' }), true);
  const [only] = await d.list();
  assert.equal(only.status, 'painting');
  assert.equal(only.note, 'by the sea');
  assert.deepEqual(new Uint8Array(await only.audio.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.deepEqual(takeOf(only).key, 'take-1');
});

test('a finished painting that was not kept stays recoverable, with its recording', async () => {
  const d = await setup();
  await d.begin(take());
  await d.ready('take-1', painting(), 'note after');
  const got = await d.get('take-1');
  assert.equal(got.status, 'ready');
  assert.equal(got.note, 'note after');
  assert.ok(got.painting.artwork.blob);
  assert.ok(got.audio);
});

test('a failure keeps the take; trying again keeps the same key and first time', async () => {
  const d = await setup();
  await d.begin(take());
  const created = (await d.get('take-1')).createdAt;
  await d.failed('take-1', 'spend_cap');
  assert.equal((await d.get('take-1')).error, 'spend_cap');
  await d.begin(take());
  const again = await d.get('take-1');
  assert.equal(again.status, 'painting');
  assert.equal(again.createdAt, created);
  assert.equal((await d.list()).length, 1);
});

test('Keep it writes the diary entry once, then removes the draft', async () => {
  const d = await setup();
  const diary = new Map();
  const addEntry = async (e) => { diary.set(e.id, e); };
  await d.begin(take());
  await d.ready('take-1', painting());
  const entry = await d.keep('take-1', { note: '', audio: take().audio }, addEntry);
  assert.equal(entry.id, entryIdFor('take-1'));
  assert.equal(diary.size, 1);
  assert.equal((await d.list()).length, 0);
  // Keeping again (a double tap, a retried save) does not make a second entry.
  await d.keep('take-1', { note: '' }, addEntry);
  assert.equal(diary.size, 1);
});

test('if the diary write fails, the draft is not lost', async () => {
  const d = await setup();
  await d.begin(take());
  await d.ready('take-1', painting());
  await assert.rejects(d.keep('take-1', {}, async () => { throw new Error('QuotaExceededError'); }));
  assert.equal((await d.get('take-1')).status, 'ready');
});

test('discard removes a draft for good', async () => {
  const d = await setup();
  await d.begin(take('a'));
  await d.begin(take('b'));
  await d.discard('a');
  assert.deepEqual((await d.list()).map((x) => x.key), ['b']);
  assert.equal(await d.get('a'), null);
});

test('on launch, a draft whose entry already exists is cleaned up', async () => {
  const d = await setup();
  await d.begin(take('a'));
  await d.begin(take('b'));
  await d.reconcile([entryIdFor('a'), 'e-other']);
  assert.deepEqual((await d.list()).map((x) => x.key), ['b']);
});

test('newest drafts first, and listeners hear every change', async () => {
  const d = await setup();
  let n = 0;
  d.onChange(() => { n += 1; });
  await d.begin(take('old'));
  await d.begin(take('new'));
  assert.deepEqual((await d.list()).map((x) => x.key), ['new', 'old']);
  assert.equal(n, 2);
});

test('a storage failure never blocks painting: begin() reports false', async () => {
  const broken = { kind: 'indexeddb', ready: async () => true, all: async () => [], get: async () => null, put: async () => { throw new Error('full'); }, remove: async () => {} };
  const d = createDrafts({ store: broken });
  await d.init();
  assert.equal(await d.begin(take()), false);
});

test('stored records keep the recording and the painting bytes', async () => {
  const d = { key: 'k', createdAt: 1, audio: take().audio, painting: painting() };
  const back = fromRecord(await toRecord(d));
  assert.equal(back.audio.type, 'audio/mp4');
  assert.deepEqual(new Uint8Array(await back.painting.artwork.blob.arrayBuffer()), new Uint8Array([9, 9]));
  assert.equal(back.painting.artwork.blob.type, 'image/jpeg');
});

test('take keys are unique and safe as idempotency keys', () => {
  const a = newTakeKey(), b = newTakeKey();
  assert.notEqual(a, b);
  assert.match(`${a}.generate`, /^[A-Za-z0-9_.:-]{8,100}$/);
});

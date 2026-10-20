// When a scroll gesture changes the detail page's layout. No browser
// (tests/e2e/detail.mjs drives the page).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollIntent, COLLAPSE_AT, EXPAND_AT } from '../src/app/screens/detail-scroll.js';

test('scrolling toward the journal collapses the expanded artwork', () => {
  assert.equal(scrollIntent({ mode: 'expanded', travel: COLLAPSE_AT, startedAtTop: true, atTop: true }), 'collapse');
  assert.equal(scrollIntent({ mode: 'expanded', travel: COLLAPSE_AT - 1, startedAtTop: true, atTop: true }), null, 'a nudge does nothing');
  assert.equal(scrollIntent({ mode: 'expanded', travel: -200, startedAtTop: true, atTop: true }), null, 'pulling down on the expanded page does nothing');
});

test('only a fresh pull at the journal’s top expands it again', () => {
  assert.equal(scrollIntent({ mode: 'compact', travel: -EXPAND_AT, startedAtTop: true, atTop: true }), 'expand');
  assert.equal(scrollIntent({ mode: 'compact', travel: -500, startedAtTop: false, atTop: true }), null, 'a fling that reached the top stays compact');
  assert.equal(scrollIntent({ mode: 'compact', travel: -500, startedAtTop: true, atTop: false }), null, 'not while the journal is scrolled');
  assert.equal(scrollIntent({ mode: 'compact', travel: 500, startedAtTop: true, atTop: true }), null, 'reading on stays compact');
});

test('editing never changes the layout', () => {
  for (const travel of [-1000, 1000]) assert.equal(scrollIntent({ mode: 'edit', travel, startedAtTop: true, atTop: true }), null);
});

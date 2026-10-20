// The UX Preview switch: only on localhost or a Vercel preview, only when the
// URL asks, never on the released site or in the iOS app; paintings made in
// it are never counted. No browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uxPreviewAllowed, wantsUxPreview, previewBilling } from '../src/app/ux-preview.js';

test('never on the released site, in the iOS app or on other hosts', () => {
  for (const hostname of ['sonmira.vercel.app', 'example.com', 'sonmira.app', 'evil-sonmira-x.vercel.app.example.com', 'other-git-x.vercel.app', '']) {
    assert.equal(uxPreviewAllowed({ hostname }), false, hostname);
    assert.equal(wantsUxPreview({ search: '?ux-preview', hostname }), false, hostname);
  }
  assert.equal(wantsUxPreview({ search: '?ux-preview', hostname: 'localhost', native: true }), false, 'not in the iOS app');
});

test('on localhost and Vercel previews, only when the URL asks', () => {
  for (const hostname of ['localhost', '127.0.0.1', 'sonmira-git-feat-post-recording-ux-13geq7-zizibittergourd-9441.vercel.app', 'sonmira-abc123-zizibittergourd-9441.vercel.app']) {
    assert.equal(wantsUxPreview({ search: '?ux-preview', hostname }), true, hostname);
    assert.equal(wantsUxPreview({ search: '?ux-preview=1&dev', hostname }), true, hostname);
    assert.equal(wantsUxPreview({ search: '', hostname }), false, 'not without asking: ' + hostname);
    assert.equal(wantsUxPreview({ search: '?engine=mock', hostname }), false);
  }
});

test('paintings in the preview are never reserved, spent or released', () => {
  const calls = [];
  const real = {
    status: () => ({ canCreate: false, free: 0, credits: 0 }),
    reserve: (k) => { calls.push(['reserve', k]); return false; },
    commit: (k) => calls.push(['commit', k]),
    release: (k) => calls.push(['release', k]),
    newKey: () => 'k1',
  };
  const b = previewBilling(real);
  assert.equal(b.status().canCreate, true);
  assert.equal(b.status().credits, 0, 'the real balance is shown as it is');
  assert.equal(b.reserve('k1'), true);
  b.commit('k1'); b.release('k1');
  assert.deepEqual(calls, [], 'the ledger is untouched');
  assert.equal(b.newKey(), 'k1');
});

// The development prompt audit builds the real OpenAI request without
// sending it: one image per request, the selected reference's own file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditTier } from '../../tools/prompt-audit.mjs';
import { LIBRARY, FAMILIES } from '../../src/engine/direct/index.js';

test('every resolved reference is audited with its own image in the request and no network', async () => {
  const r = await auditTier({ tier: 'resolved', env: {} });
  const ids = Object.keys(FAMILIES).filter((f) => FAMILIES[f].tier === 'resolved').flatMap((f) => LIBRARY.pool(f).map((e) => e.id));
  assert.deepEqual(r.rows.map((x) => x.reference).sort(), ids.sort());
  for (const x of r.rows) {
    assert.ok(x.matches && x.correctImage, x.reference);
    assert.equal(x.imagesInRequest.length, 1);
    assert.match(x.prompt, /^The attached image is the primary style reference/);
  }
  assert.ok(r.identical.share > 0 && r.identical.share < 1);
});

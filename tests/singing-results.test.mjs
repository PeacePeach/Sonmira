import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, pathFor } from '../api/singing-results.js';

const env = { RESULTS_GITHUB_TOKEN: 'tok', RESULTS_REPO: 'me/private-results', VERCEL_ENV: 'preview' };
const take = { kind: 'sonmira-singing-take', slot: 7, recordedAt: '2026-10-16T17:00:00.000Z', engine: 'gathered', audio: { durationSec: 9 } };
function call(handler, req) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler(req, res);
  });
}

test('path is per recording and slot', () => {
  assert.equal(pathFor(take), 'singing-test/2026-10-16T170000000Z-take7.json');
  assert.equal(pathFor({ slot: 7 }), null);
});

test('not configured, or in Production: nothing is written', async () => {
  for (const e of [{}, { ...env, VERCEL_ENV: 'production' }]) {
    let called = false;
    const h = createHandler({ env: e, fetchImpl: async () => { called = true; } });
    assert.deepEqual((await call(h, { method: 'GET' })).body, { configured: false });
    assert.equal((await call(h, { method: 'POST', body: { take } })).code, 503);
    assert.equal(called, false);
  }
});

test('saves the take to the private repo, updating an existing file', async () => {
  const calls = [];
  const fetchImpl = async (url, o = {}) => { calls.push({ url, ...o }); return o.method === 'PUT' ? { ok: true, json: async () => ({}) } : { ok: true, json: async () => ({ sha: 'abc' }) }; };
  const h = createHandler({ env, fetchImpl });
  const r = await call(h, { method: 'POST', body: { take } });
  assert.equal(r.code, 200);
  assert.equal(calls[1].method, 'PUT');
  assert.match(calls[1].url, /repos\/me\/private-results\/contents\/singing-test\//);
  assert.equal(calls[1].headers.authorization, 'Bearer tok');
  const put = JSON.parse(calls[1].body);
  assert.equal(put.sha, 'abc');
  assert.equal(JSON.parse(Buffer.from(put.content, 'base64').toString()).engine, 'gathered');
  assert.ok(!JSON.stringify(r.body).includes('tok'));
});

test('rejects anything that is not a take, or carries audio', async () => {
  const h = createHandler({ env, fetchImpl: async () => { throw new Error('should not be called'); } });
  assert.equal((await call(h, { method: 'POST', body: { take: { ...take, kind: 'x' } } })).code, 400);
  assert.equal((await call(h, { method: 'POST', body: { take: { ...take, audio: 'A'.repeat(5000) } } })).code, 400);
});

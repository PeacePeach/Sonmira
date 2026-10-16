// The deployed functions themselves (api/*.js default exports) are guarded,
// and with SONMIRA_FAKE_PROVIDER=1 the whole server pipeline runs with no
// paid call: art direction, reference selection, the provider request.

import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SONMIRA_FAKE_PROVIDER: '1', SONMIRA_FAKE_DELAY_MS: '0',
  SONMIRA_TOKEN_SECRET: 'api-test-secret-0123456789abcdef', SONMIRA_INVITE_CODES: 'API-TEST-01',
});
delete process.env.OPENAI_API_KEY;
delete process.env.VERCEL;
const { default: generate } = await import('../api/generate.js');
const { default: understand } = await import('../api/understand.js');
const { default: session } = await import('../api/session.js');

function res() {
  const r = { statusCode: 200, body: undefined, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.end = () => r;
  return r;
}
const call = async (h, req) => { const r = res(); await h({ headers: {}, ...req }, r); return r; };
const SPEC = { completeness: 'resolved', emotion: 'tender', motif: 'water', seed: 7, energy: { value: 'calm' } };

test('deployed functions refuse paid work without an invitation', async () => {
  assert.equal((await call(generate, { method: 'POST', body: { spec: SPEC } })).body.code, 'invite_required');
  assert.equal((await call(understand, { method: 'POST', body: { audio: 'QUJD', mime: 'audio/mp4' } })).body.code, 'invite_required');
  // Configuration reads stay open.
  assert.equal((await call(generate, { method: 'GET' })).statusCode, 200);
});

test('with an invitation, a whole painting runs on the fake provider and replays by key', async () => {
  const s = await call(session, { method: 'POST', body: { invite: 'api-test-01', installId: 'install-apitest000001' } });
  assert.equal(s.body.ok, true);
  const headers = (key) => ({ authorization: `Bearer ${s.body.token}`, 'idempotency-key': key, 'x-forwarded-for': '7.7.7.7' });
  const u = await call(understand, { method: 'POST', headers: headers('take-api-1.understand'), body: { audio: 'QUJD', mime: 'audio/mp4' } });
  assert.equal(u.statusCode, 200, JSON.stringify(u.body));
  assert.equal(u.body.lyrics, null); // a hum: the text model is skipped
  const g = await call(generate, { method: 'POST', headers: headers('take-api-1.generate'), body: { spec: SPEC } });
  assert.equal(g.statusCode, 200, JSON.stringify(g.body));
  assert.match(g.body.image, /^data:image\/jpeg;base64,iVBOR/); // the offline renderer's PNG
  assert.ok(g.body.family && g.body.reference, 'art direction and reference selection ran');
  const again = await call(generate, { method: 'POST', headers: headers('take-api-1.generate'), body: { spec: SPEC } });
  assert.equal(again.headers['x-sonmira-replay'], '1');
  assert.equal(again.body.image, g.body.image);
});

test('the fake provider is refused in Production', async () => {
  const { fakeProviderOn } = await import('../server/dev/fake-openai.js');
  assert.equal(fakeProviderOn({ SONMIRA_FAKE_PROVIDER: '1', VERCEL_ENV: 'production' }), false);
  assert.equal(fakeProviderOn({ SONMIRA_FAKE_PROVIDER: '1', VERCEL_ENV: 'preview' }), true);
});

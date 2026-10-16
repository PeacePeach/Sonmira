// The deployed functions, loaded as Vercel loads them, under the environments
// a deployment of this repository can have. A real-looking OPENAI_API_KEY is
// set every time and any request to api.openai.com is counted (and refused),
// so a paid call would show up as a non-zero count.
//
// Each case runs in its own process because api/*.js decide fake or real
// once, at load, as they do on Vercel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const PROBE = `
const openai = [];
const real = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.openai.com')) { openai.push(String(url)); throw new Error('paid call blocked by test'); }
  return real(url, init);
};
const { default: generate } = await import('./api/generate.js');
const { default: understand } = await import('./api/understand.js');
const { default: session } = await import('./api/session.js');
const res = () => { const r = { statusCode: 200, headers: {} }; r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; }; r.status = (n) => { r.statusCode = n; return r; }; r.json = (o) => { r.body = o; return r; }; r.end = () => r; return r; };
const call = async (h, req) => { const r = res(); await h({ headers: { 'x-forwarded-for': '9.9.9.9' }, ...req, headers: { 'x-forwarded-for': '9.9.9.9', ...(req.headers || {}) } }, r); return r; };
const SPEC = { completeness: 'resolved', emotion: 'tender', motif: 'water', seed: 7, energy: { value: 'calm' } };
const s = await call(session, { method: 'POST', body: { invite: process.env.TRY_INVITE, installId: 'install-nopaid00000001' } });
const auth = s.body?.token ? { authorization: 'Bearer ' + s.body.token } : {};
const u = await call(understand, { method: 'POST', headers: { ...auth, 'idempotency-key': 'take-np-1.understand' }, body: { audio: 'QUJD', mime: 'audio/mp4' } });
const g = await call(generate, { method: 'POST', headers: { ...auth, 'idempotency-key': 'take-np-1.generate' }, body: { spec: SPEC } });
const forged = await call(generate, { method: 'POST', headers: { authorization: 'Bearer v1.eyJpIjoiaW5zdGFsbC1ub3BhaWQwMDAwMDAwMSIsImMiOiJTT05NSVJBUFJFVklFVyIsInQiOjF9.AAAA', 'idempotency-key': 'take-np-2.generate' }, body: { spec: SPEC } });
console.log(JSON.stringify({ session: [s.statusCode, s.body?.code ?? null], understand: [u.statusCode, u.body?.code ?? null], generate: [g.statusCode, g.body?.code ?? null, String(g.body?.image ?? '').slice(0, 30)], forged: [forged.statusCode, forged.body?.code ?? null], openai }));
`;

function run(env) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SONMIRA_|KV_|UPSTASH_|VERCEL|OPENAI_)/.test(k)));
  const p = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000,
    env: { ...clean, VERCEL: '1', OPENAI_API_KEY: 'sk-proj-looks-real-0000000000000000', SONMIRA_FAKE_DELAY_MS: '0', TRY_INVITE: 'SONMIRA-PREVIEW', ...env },
  });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop());
}

test('Preview of this branch: the whole flow works on the fake provider, no OpenAI request', () => {
  const r = run({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'claude/production-readiness-integration' });
  assert.deepEqual(r.openai, []);
  assert.equal(r.session[0], 200);
  assert.equal(r.understand[0], 200);
  assert.equal(r.generate[0], 200);
  assert.match(r.generate[2], /^data:image\/jpeg;base64,iVBOR/); // the offline renderer's PNG
  assert.deepEqual(r.forged, [401, 'invite_required']);
});

test('Preview of another branch, nothing configured: refused before any provider call', () => {
  const r = run({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'engine/procedural-watercolor' });
  assert.deepEqual(r.openai, []);
  assert.equal(r.understand[1], 'not_configured');
  assert.equal(r.generate[1], 'not_configured');
});

test('Preview where Vercel does not expose the branch name: refused, not paid', () => {
  const r = run({ VERCEL_ENV: 'preview' });
  assert.deepEqual(r.openai, []);
  assert.equal(r.generate[1], 'not_configured');
});

test('Production ignores the fake switch and the branch name, and without its own setup refuses', () => {
  const r = run({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'claude/production-readiness-integration', SONMIRA_FAKE_PROVIDER: '1' });
  assert.deepEqual(r.openai, []);
  assert.equal(r.session[1], 'not_configured');
  assert.equal(r.generate[1], 'not_configured');
});

test('Production with secret and codes but no shared store: refused, the in-memory store is never used there', () => {
  const r = run({ VERCEL_ENV: 'production', SONMIRA_TOKEN_SECRET: 'prod-like-secret-0123456789abcdef', SONMIRA_INVITE_CODES: 'BETA-CODE-1', TRY_INVITE: 'BETA-CODE-1' });
  assert.deepEqual(r.openai, []);
  assert.equal(r.generate[1], 'not_configured');
});

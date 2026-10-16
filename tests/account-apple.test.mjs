import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyIdentityToken, createAppleKeys, createRevoker, clientSecret, verifyAppleNotification } from '../src/account/apple.js';
import { parseB64urlJson, fromB64url, utf8 } from '../src/account/encoding.js';
import { fakeApple } from './account-helpers.mjs';

const apple = await fakeApple();
const verify = (t, o = {}) => verifyIdentityToken(t, { audience: 'app.sonmira', getKey: apple.getKey, ...o });
const rejects = (p, reason) => assert.rejects(p, (e) => e.reason === reason);

test('accepts a valid token and returns the Apple user id', async () => {
  const r = await verify(await apple.token({ sub: 'u-1', rawNonce: 'n-1' }), { rawNonce: 'n-1' });
  assert.equal(r.sub, 'u-1');
});

test('rejects wrong audience, issuer, expiry and nonce', async () => {
  await rejects(verify(await apple.token({ aud: 'com.someone.else' })), 'audience');
  await rejects(verify(await apple.token({ iss: 'https://evil.example' })), 'issuer');
  await rejects(verify(await apple.token({ exp: Math.floor(Date.now() / 1000) - 3600 })), 'expired');
  await rejects(verify(await apple.token({ rawNonce: 'a' }), { rawNonce: 'b' }), 'nonce');
  await rejects(verify(await apple.token({}), { rawNonce: 'b' }), 'nonce');
});

test('rejects a tampered token, an unknown key and the wrong algorithm', async () => {
  const t = await apple.token({ sub: 'u-1' });
  const [h, , s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...parseB64urlJson(t.split('.')[1]), sub: 'u-2' })).toString('base64url');
  await rejects(verify(`${h}.${forged}.${s}`), 'signature');
  await rejects(verify(await apple.sign({ sub: 'x' }, { kid: 'other' })), 'unknown key');
  await rejects(verify(await apple.sign({ sub: 'x' }, { alg: 'HS256' })), 'alg');
  await rejects(verify('not-a-token'), 'format');
});

test('a token signed by another key with the same kid is rejected', async () => {
  const other = await fakeApple();
  await rejects(verify(await other.token({})), 'signature');
});

test('Apple keys are cached and refetched for an unknown kid', async () => {
  let calls = 0;
  const getKey = createAppleKeys({ fetchImpl: async () => { calls++; return { ok: true, json: async () => apple.keysResponse }; } });
  assert.ok(await getKey('test-kid'));
  assert.ok(await getKey('test-kid'));
  assert.equal(calls, 1);
  assert.equal(await getKey('rotated'), null);
  assert.equal(calls, 2);
});

test('client secret is a verifiable ES256 JWT for Apple', async () => {
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
  const jwt = await clientSecret({ teamId: 'TEAM123', keyId: 'KEY123', privateKey: pem, clientId: 'app.sonmira' });
  const [h, b, s] = jwt.split('.');
  assert.deepEqual(parseB64urlJson(h), { alg: 'ES256', kid: 'KEY123' });
  const c = parseB64urlJson(b);
  assert.equal(c.iss, 'TEAM123'); assert.equal(c.sub, 'app.sonmira'); assert.equal(c.aud, 'https://appleid.apple.com');
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromB64url(s), utf8(`${h}.${b}`)));

  const calls = [];
  const revoke = createRevoker({ clientId: 'app.sonmira', teamId: 'TEAM123', keyId: 'KEY123', privateKey: pem, fetchImpl: async (url, init) => {
    calls.push({ url, body: new URLSearchParams(init.body) });
    return { ok: true, json: async () => ({ refresh_token: 'r-1', access_token: 'a-1' }) };
  } });
  assert.deepEqual(await revoke('code-1'), { revoked: true });
  assert.equal(calls[0].url, 'https://appleid.apple.com/auth/token');
  assert.equal(calls[0].body.get('code'), 'code-1');
  assert.equal(calls[1].url, 'https://appleid.apple.com/auth/revoke');
  assert.equal(calls[1].body.get('token'), 'r-1');
  assert.equal(calls[1].body.get('token_type_hint'), 'refresh_token');
});

test('revoker without a key skips, and a failed revoke throws', async () => {
  assert.deepEqual(await createRevoker({ clientId: 'app.sonmira' })('code'), { revoked: false, skipped: 'not_configured' });
  const { privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const pem = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  const revoke = createRevoker({ clientId: 'app.sonmira', teamId: 'T', keyId: 'K', privateKey: pem, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }) });
  await assert.rejects(revoke('code'));
});

test('server-to-server notifications are verified and parsed', async () => {
  const payload = await apple.sign({ iss: 'https://appleid.apple.com', aud: 'app.sonmira', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, events: JSON.stringify({ type: 'consent-revoked', sub: 'u-9' }) });
  assert.deepEqual(await verifyAppleNotification(payload, { audience: 'app.sonmira', getKey: apple.getKey }), { type: 'consent-revoked', sub: 'u-9' });
  const other = await fakeApple();
  const forged = await other.sign({ iss: 'https://appleid.apple.com', aud: 'app.sonmira', exp: Math.floor(Date.now() / 1000) + 600, events: JSON.stringify({ type: 'account-delete', sub: 'u-9' }) });
  await assert.rejects(verifyAppleNotification(forged, { audience: 'app.sonmira', getKey: apple.getKey }));
});

// Test-signed Apple identity tokens: a local RSA key stands in for Apple's,
// so nothing here ever calls Apple.

import { jsonB64url, b64url, utf8, sha256Hex } from '../src/account/encoding.js';

export async function fakeApple({ kid = 'test-kid' } = {}) {
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid, alg: 'RS256', use: 'sig' };
  async function sign(claims, header = {}) {
    const head = jsonB64url({ alg: 'RS256', kid, ...header });
    const body = jsonB64url(claims);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, utf8(`${head}.${body}`));
    return `${head}.${body}.${b64url(sig)}`;
  }
  const now = () => Math.floor(Date.now() / 1000);
  async function token({ sub = 'apple-user-1', aud = 'app.sonmira', iss = 'https://appleid.apple.com', rawNonce, exp = now() + 600, iat = now(), extra = {} } = {}) {
    return sign({ iss, aud, sub, iat, exp, ...(rawNonce ? { nonce: await sha256Hex(rawNonce), nonce_supported: true } : {}), ...extra });
  }
  return { jwk, sign, token, getKey: async (k) => (k === kid ? jwk : null), keysResponse: { keys: [jwk] } };
}

export const SECRET = 'test-secret-test-secret-test-secret-0123';

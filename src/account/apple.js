// Sign in with Apple, server side: verifying Apple's identity token and
// revoking Apple's tokens when an account is deleted. Plain Web Crypto and
// fetch against Apple's public endpoints; no SDK, no paid service.
//
//   verifyIdentityToken  RS256 signature against https://appleid.apple.com/auth/keys,
//                        then issuer, audience (bundle id), expiry and the nonce
//   createRevoker        ES256 client secret from the Sign in with Apple key, then
//                        /auth/token (exchange the authorization code) and /auth/revoke

import { b64url, fromB64url, jsonB64url, parseB64urlJson, sha256Hex, utf8 } from './encoding.js';

export const APPLE_ISSUER = 'https://appleid.apple.com';
const KEYS_URL = 'https://appleid.apple.com/auth/keys';
const SKEW_S = 60;

export class AppleTokenError extends Error {
  constructor(reason) { super(`invalid identity token: ${reason}`); this.reason = reason; }
}

/**
 * Apple's signing keys, fetched once and cached; refetched when a token names
 * a key id we haven't seen (Apple rotates keys).
 * @param {{ fetchImpl?: typeof fetch, ttlMs?: number, now?: () => number }} [opts]
 */
export function createAppleKeys({ fetchImpl = fetch, ttlMs = 60 * 60 * 1000, now = Date.now } = {}) {
  let cache = null, at = 0;
  async function load() {
    const r = await fetchImpl(KEYS_URL);
    if (!r.ok) throw new Error(`apple keys ${r.status}`);
    const { keys } = await r.json();
    cache = new Map((keys || []).map((k) => [k.kid, k]));
    at = now();
  }
  return async function getKey(kid) {
    if (!cache || now() - at > ttlMs) await load();
    if (!cache.has(kid)) await load();
    return cache.get(kid) || null;
  };
}

/**
 * Verifies an identity token from Sign in with Apple.
 * The app sets the request's nonce to sha256(rawNonce) and sends us rawNonce,
 * so a token captured elsewhere can't be replayed into this sign-in.
 * @param {string} token
 * @param {{ audience: string, rawNonce?: string, getKey: (kid: string) => Promise<JsonWebKey|null>, now?: () => number }} opts
 * @returns {Promise<{ sub: string, claims: any }>}
 */
export async function verifyIdentityToken(token, { audience, rawNonce, getKey, now = Date.now }) {
  if (typeof token !== 'string') throw new AppleTokenError('missing');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppleTokenError('format');
  let header, claims;
  try { header = parseB64urlJson(parts[0]); claims = parseB64urlJson(parts[1]); } catch { throw new AppleTokenError('format'); }
  if (header.alg !== 'RS256' || !header.kid) throw new AppleTokenError('alg');
  const jwk = await getKey(header.kid);
  if (!jwk) throw new AppleTokenError('unknown key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  let sig;
  try { sig = fromB64url(parts[2]); } catch { throw new AppleTokenError('format'); }
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, utf8(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new AppleTokenError('signature');

  const t = Math.floor(now() / 1000);
  if (claims.iss !== APPLE_ISSUER) throw new AppleTokenError('issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) throw new AppleTokenError('audience');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < t) throw new AppleTokenError('expired');
  if (typeof claims.iat === 'number' && claims.iat - SKEW_S > t) throw new AppleTokenError('issued in the future');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new AppleTokenError('subject');
  if (rawNonce !== undefined) {
    if (typeof rawNonce !== 'string' || !rawNonce || claims.nonce !== await sha256Hex(rawNonce)) throw new AppleTokenError('nonce');
  }
  return { sub: claims.sub, claims };
}

/** PEM (PKCS#8, the .p8 file Apple gives you) → CryptoKey for ES256. */
async function importP8(pem) {
  const body = String(pem).replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** The short-lived client secret Apple's REST endpoints ask for (an ES256 JWT). */
export async function clientSecret({ teamId, keyId, privateKey, clientId, now = Date.now }) {
  const iat = Math.floor(now() / 1000);
  const head = jsonB64url({ alg: 'ES256', kid: keyId });
  const body = jsonB64url({ iss: teamId, iat, exp: iat + 300, aud: APPLE_ISSUER, sub: clientId });
  const key = await importP8(privateKey);
  // Web Crypto's ECDSA signature is already the raw r||s form JWS expects.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

/**
 * Revokes the person's Apple tokens for Sonmira, as App Review expects when an
 * account is deleted. Needs a fresh authorization code from the app.
 * @param {{ clientId: string, teamId?: string, keyId?: string, privateKey?: string, fetchImpl?: typeof fetch, now?: () => number }} cfg
 * @returns {(authorizationCode: string) => Promise<{ revoked: boolean, skipped?: string }>}
 */
export function createRevoker({ clientId, teamId, keyId, privateKey, fetchImpl = fetch, now = Date.now }) {
  const configured = !!(teamId && keyId && privateKey);
  return async function revoke(authorizationCode) {
    if (!configured) return { revoked: false, skipped: 'not_configured' };
    if (!authorizationCode) throw new Error('authorization code required');
    const secret = await clientSecret({ teamId, keyId, privateKey, clientId, now });
    const form = (o) => new URLSearchParams(o).toString();
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    const tr = await fetchImpl(`${APPLE_ISSUER}/auth/token`, { method: 'POST', headers, body: form({ client_id: clientId, client_secret: secret, code: authorizationCode, grant_type: 'authorization_code' }) });
    if (!tr.ok) throw new Error(`apple token exchange ${tr.status}`);
    const t = await tr.json();
    const token = t.refresh_token || t.access_token;
    const hint = t.refresh_token ? 'refresh_token' : 'access_token';
    const rr = await fetchImpl(`${APPLE_ISSUER}/auth/revoke`, { method: 'POST', headers, body: form({ client_id: clientId, client_secret: secret, token, token_type_hint: hint }) });
    if (!rr.ok) throw new Error(`apple revoke ${rr.status}`);
    return { revoked: true };
  };
}

/**
 * Apple's server-to-server notifications for Sign in with Apple arrive as a
 * signed JWT whose `events` claim is a JSON string: { type, sub, ... }.
 * type: 'consent-revoked' | 'account-delete' | 'email-disabled' | 'email-enabled'
 */
export async function verifyAppleNotification(payload, { audience, getKey, now }) {
  const { claims } = await verifyIdentityToken(payload, { audience, getKey, now }).catch((e) => {
    // Notifications carry `sub` inside `events`, not at the top level.
    if (e.reason !== 'subject') throw e;
    return { claims: parseB64urlJson(payload.split('.')[1]) };
  });
  const ev = typeof claims.events === 'string' ? JSON.parse(claims.events) : claims.events;
  if (!ev || typeof ev.type !== 'string' || typeof ev.sub !== 'string') throw new AppleTokenError('events');
  return { type: ev.type, sub: ev.sub };
}

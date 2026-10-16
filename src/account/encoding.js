// Small Web Crypto helpers shared by the account server code and the
// development simulation in the browser. No Node-only modules, so the same
// file runs in a Vercel function, in `node --test` and in Safari.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (b) => dec.decode(b);

export function b64url(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const jsonB64url = (v) => b64url(utf8(JSON.stringify(v)));
export const parseB64urlJson = (s) => JSON.parse(fromUtf8(fromB64url(s)));

export async function sha256Hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(s)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const hmacKeys = new Map();
async function hmacKey(secret) {
  let k = hmacKeys.get(secret);
  if (!k) { k = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); hmacKeys.set(secret, k); }
  return k;
}

/** HMAC-SHA256 of `data` under `secret`, as base64url. */
export async function hmac(secret, data) {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(data)));
}

/** Constant-time string comparison (both strings are ours, so length may leak). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** A random id in the guard's install-id alphabet (/^[A-Za-z0-9_-]{16,64}$/): 22 chars, 128 bits. */
export function randomId() {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

export const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

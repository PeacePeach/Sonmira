// Install tokens: an install id bound to the invitation code that admitted
// it, signed with SONMIRA_TOKEN_SECRET. Removing a code from
// SONMIRA_INVITE_CODES revokes every token issued under it.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const INSTALL_ID = /^[A-Za-z0-9_-]{16,64}$/;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const mac = (secret, data) => createHmac('sha256', secret).update(data).digest();

// A short id for a code, so logs and KV keys never hold the code itself.
export const inviteId = (code) => createHash('sha256').update(`sonmira-invite:${code}`).digest('hex').slice(0, 16);

export function signToken(secret, { installId, invite, now = Date.now() }) {
  const body = b64(JSON.stringify({ i: installId, c: invite, t: now }));
  return `v1.${body}.${b64(mac(secret, body))}`;
}

// → { installId, invite, issuedAt } or null
export function verifyToken(secret, token) {
  if (!secret || typeof token !== 'string') return null;
  const [v, body, sig] = token.split('.');
  if (v !== 'v1' || !body || !sig) return null;
  const want = mac(secret, body), got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!INSTALL_ID.test(p.i) || typeof p.c !== 'string') return null;
    return { installId: p.i, invite: p.c, issuedAt: p.t };
  } catch { return null; }
}

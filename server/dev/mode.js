// No-cost mode: the provider is replaced by server/dev/fake-openai.js.
//
// On only when SONMIRA_FAKE_PROVIDER=1 is set explicitly, and never in
// Production (VERCEL_ENV=production ignores it). Nothing else turns it on:
// a deployment without it uses the real provider behind the full guard, and
// without its own guard configuration that guard refuses paid work
// (503 not_configured).
//
// In this mode only, the guard has working defaults so a test deployment
// needs no other setup: an invitation code (PREVIEW_INVITE), a fixed token
// secret, and an in-memory store per function instance when no KV is
// configured. Nothing paid is behind them; a real deployment sets its own.

export const PREVIEW_INVITE = 'SONMIRA-PREVIEW';
export const PREVIEW_SECRET = 'no-cost-preview-only-not-a-secret';

export function fakeProviderOn(env = process.env) {
  return env.VERCEL_ENV !== 'production' && env.SONMIRA_FAKE_PROVIDER === '1';
}

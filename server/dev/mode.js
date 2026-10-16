// No-cost mode: the provider is replaced by server/dev/fake-openai.js.
//
// On with SONMIRA_FAKE_PROVIDER=1, and on its own for Vercel Previews of the
// production-readiness branches (VERCEL_GIT_COMMIT_REF is set by Vercel), so
// those Previews can never spend money. Never in Production.
//
// In this mode only, the guard has working defaults so a Preview needs no
// setup: an invitation code (PREVIEW_INVITE), a fixed token secret, and an
// in-memory store per function instance when no KV is configured. Nothing
// paid is behind them; a real deployment must set its own values.

export const PREVIEW_INVITE = 'SONMIRA-PREVIEW';
export const PREVIEW_SECRET = 'no-cost-preview-only-not-a-secret';

export function fakeProviderOn(env = process.env) {
  if (env.VERCEL_ENV === 'production') return false;
  if (env.SONMIRA_FAKE_PROVIDER === '1') return true;
  return env.VERCEL_ENV === 'preview' && String(env.VERCEL_GIT_COMMIT_REF || '').startsWith('claude/production-readiness');
}

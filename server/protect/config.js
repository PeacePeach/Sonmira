// Guard settings, all from the environment so they change without a deploy
// of new code. Money is counted in micro-dollars (1 USD = 1,000,000).
//
//   SONMIRA_TOKEN_SECRET     required: signs install tokens (32+ random chars)
//   SONMIRA_INVITE_CODES     required: comma-separated beta invitation codes
//   SONMIRA_DAILY_CAP_USD    hard daily spend cap, UTC day (default 3)
//   SONMIRA_COST_IMAGE_USD   reserved per image generation (default 0.15)
//   SONMIRA_COST_TRANSCRIBE_USD / SONMIRA_COST_TEXT_USD / SONMIRA_COST_EVAL_USD
//   SONMIRA_LIMIT_<NAME>     any number in LIMITS below, e.g. SONMIRA_LIMIT_GENERATE_DAY
//   SONMIRA_PROTECT=off      local development only; ignored on every Vercel deployment
//   KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*)

import { fakeProviderOn, PREVIEW_INVITE, PREVIEW_SECRET } from '../dev/mode.js';

export const MICRO = 1_000_000;

const LIMITS = {
  // paid calls per install
  GENERATE_HOUR: 6, GENERATE_DAY: 15,
  UNDERSTAND_HOUR: 12, UNDERSTAND_DAY: 30,
  // paid image calls per invitation code (all its installs together)
  INVITE_GENERATE_DAY: 60,
  // installs one invitation code can register
  INSTALLS_PER_INVITE: 5,
  // any guarded request per network address
  IP_HOUR: 60,
  // invitation attempts per network address
  SESSION_IP_HOUR: 10,
};

const usd = (v, d) => { const n = Number(v); return Math.round((Number.isFinite(n) && n >= 0 ? n : d) * MICRO); };
const int = (v, d) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : d; };
export const normalizeInvite = (c) => String(c ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');

export function protectConfig(env = process.env) {
  const limits = Object.fromEntries(Object.entries(LIMITS).map(([k, d]) => [k, int(env[`SONMIRA_LIMIT_${k}`], d)]));
  return {
    // Never on a deployment (Vercel sets VERCEL), so no Preview can fall
    // through to unguarded paid calls.
    off: env.SONMIRA_PROTECT === 'off' && !env.VERCEL && !env.VERCEL_ENV,
    secret: env.SONMIRA_TOKEN_SECRET || (fakeProviderOn(env) ? PREVIEW_SECRET : ''),
    invites: String(env.SONMIRA_INVITE_CODES || (fakeProviderOn(env) ? PREVIEW_INVITE : '')).split(',').map(normalizeInvite).filter((c) => c.length >= 6),
    capMicros: usd(env.SONMIRA_DAILY_CAP_USD, 3),
    cost: {
      image: usd(env.SONMIRA_COST_IMAGE_USD, 0.15),
      transcribe: usd(env.SONMIRA_COST_TRANSCRIBE_USD, 0.01),
      text: usd(env.SONMIRA_COST_TEXT_USD, 0.005),
      eval: usd(env.SONMIRA_COST_EVAL_USD, 0.10),
    },
    limits,
    // A pending claim outlives the longest function (maxDuration 120 s).
    pendingTtlSec: 180,
    resultTtlSec: 24 * 3600,
    maxBody: { generate: 32_000, understand: 1_500_000, session: 2_000 },
    // ~60 s of 128 kbps audio as base64; a take is at most 30 s.
    maxAudioBase64: 1_400_000,
  };
}

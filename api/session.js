// Vercel Serverless Function: exchange a beta invitation code for an install
// token that /api/generate and /api/understand require.
//
//   POST /api/session { invite, installId } → { ok, token } | { ok:false, code, error }
//
// See server/protect/ for the limits, the daily spend cap and idempotency.

import { createSessionHandler } from '../server/protect/index.js';

export default createSessionHandler();

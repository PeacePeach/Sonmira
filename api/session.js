// Vercel Serverless Function: exchange a beta invitation code for an install
// token that /api/generate and /api/understand require.
//
//   POST /api/session { invite, installId } → { ok, token } | { ok:false, code, error }
//   POST /api/session { accountToken, installId }   (a signed-in account, its own id)
//
// See server/protect/ for the limits, the daily spend cap and idempotency.

import { createSessionHandler } from '../server/protect/index.js';
import { wiring } from '../server/wire.js';

export default createSessionHandler(wiring().session());

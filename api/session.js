// Vercel Serverless Function: exchange a beta invitation code for an install
// token that /api/generate and /api/understand require.
//
//   POST /api/session { invite, installId } → { ok, token } | { ok:false, code, error }
//   POST /api/session { accountToken, installId }   (a signed-in account, its own id)
//
// See server/protect/ for the limits, the daily spend cap and idempotency.
//
// It also answers POST /api/feedback (vercel.json rewrites it here with
// ?route=feedback; see server/feedback.js). The Hobby plan allows 12
// functions, so feedback shares this one rather than adding a 13th.

import { createSessionHandler } from '../server/protect/index.js';
import { createFeedbackHandler, feedbackFromEnv } from '../server/feedback.js';
import { wiring } from '../server/wire.js';

const w = wiring();
const session = createSessionHandler(w.session());
const feedback = createFeedbackHandler({ kv: w.kv, send: feedbackFromEnv(w.env), env: w.env });

export default function handler(req, res) {
  return req.query?.route === 'feedback' ? feedback(req, res) : session(req, res);
}

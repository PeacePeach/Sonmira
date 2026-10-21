// POST /api/feedback: Settings → Contact & Feedback. See server/feedback.js.
import { createFeedbackHandler, feedbackFromEnv } from '../server/feedback.js';
import { wiring } from '../server/wire.js';

const { kv, env } = wiring();
export default createFeedbackHandler({ kv, send: feedbackFromEnv(env), env });

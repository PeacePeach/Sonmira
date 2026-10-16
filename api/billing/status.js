// GET /api/billing/status: what this account can paint. See server/billing/http.js.
import { createStatusHandler } from '../../server/billing/http.js';

export default createStatusHandler();

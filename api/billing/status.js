// GET /api/billing/status: what this account can paint. See server/billing/http.js.
import { createStatusHandler } from '../../server/billing/http.js';
import { wiring } from '../../server/wire.js';

// The caller must hold the install token of the account it names (server/wire.js).
export default createStatusHandler(wiring().billing());

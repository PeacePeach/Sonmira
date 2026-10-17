// POST /api/billing/apple-notifications: App Store Server Notifications V2. See server/billing/http.js.
import { createNotificationsHandler } from '../../server/billing/http.js';
import { wiring } from '../../server/wire.js';

// Same store and ledger as the guard (server/wire.js); Apple signs these, so no install token.
export default createNotificationsHandler(wiring().billing());

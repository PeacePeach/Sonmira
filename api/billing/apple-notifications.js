// POST /api/billing/apple-notifications: App Store Server Notifications V2. See server/billing/http.js.
import { createNotificationsHandler } from '../../server/billing/http.js';

export default createNotificationsHandler();

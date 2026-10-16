// POST /api/billing/transactions: the app's signed StoreKit transactions. See server/billing/http.js.
import { createTransactionsHandler } from '../../server/billing/http.js';
import { wiring } from '../../server/wire.js';

// The caller must hold the install token of the account it names (server/wire.js).
export default createTransactionsHandler(wiring().billing());

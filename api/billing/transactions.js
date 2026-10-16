// POST /api/billing/transactions: the app's signed StoreKit transactions. See server/billing/http.js.
import { createTransactionsHandler } from '../../server/billing/http.js';

export default createTransactionsHandler();

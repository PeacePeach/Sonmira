// The generation guard's charge step (server/protect on the Production
// Readiness branch calls it; see docs/billing-iap.md):
//
//   protect('generate', handler, { charge: createCharge({ ledger }) })
//
// reserve runs after the idempotency check and the rate limits, before the
// spend cap; a replay never reaches it. settle is 'commit' only when the
// painting was made, 'release' on anything else, so only successful
// paintings are ever counted, and one take key is counted at most once.
//
// SONMIRA_BILLING decides whose paintings are counted:
//   native (default)  app accounts only (UUIDs from the iOS app); web
//                     previews keep their local, simulated wallet
//   all               every install, web included
//   off               nobody

import { clientDay, isAppAccount } from './ledger.js';

export function createCharge({ ledger, mode = process.env.SONMIRA_BILLING || 'native', now = Date.now }) {
  const applies = (installId) => mode === 'all' || (mode === 'native' && isAppAccount(installId));
  const header = (req, name) => { const v = req?.headers?.[name]; return Array.isArray(v) ? v[0] : v; };
  return {
    async reserve({ installId, key, endpoint, req }) {
      if (endpoint !== 'generate' || !applies(installId)) return { ok: true, counted: false };
      const source = await ledger.reserve(installId, key, clientDay(header(req, 'x-sonmira-day'), now()));
      return source ? { ok: true, counted: true, source } : { ok: false, status: 402, code: 'no_paintings' };
    },
    async settle({ installId, key, endpoint = 'generate', outcome }) {
      if (endpoint !== 'generate' || !applies(installId)) return null;
      return outcome === 'commit' ? ledger.commit(key, installId) : ledger.release(key, installId);
    },
  };
}

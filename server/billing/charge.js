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
// SONMIRA_BILLING decides, per deployment, whether paintings are counted.
// The client never chooses: any install id it registers is counted alike.
//   on   every install (the default in Production, which TestFlight and
//        App Review use too)
//   off  nobody (the default elsewhere: web previews keep their local,
//        simulated wallet)

import { clientDay } from './ledger.js';

export const billingMode = (env = process.env) => env.SONMIRA_BILLING || (env.VERCEL_ENV === 'production' ? 'on' : 'off');

export function createCharge({ ledger, mode = billingMode(), now = Date.now }) {
  const applies = () => mode === 'on';
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

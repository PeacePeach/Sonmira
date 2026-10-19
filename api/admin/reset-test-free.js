// Owner-only test quota replenishment. Never exposes a reset option without
// SONMIRA_TEST_RESET_KEY, and always verifies ownership of the target account.
import { timingSafeEqual } from 'node:crypto';
import { wiring } from '../../server/wire.js';
import { normalizeAccount } from '../../server/billing/ledger.js';

const reject = (res, status, code) => res.status(status).json({ ok: false, code });
const equal = (given, expected) => {
  if (typeof given !== 'string' || !given || typeof expected !== 'string' || expected.length < 32) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export default async function resetTestFree(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return reject(res, 405, 'method');
  const secret = process.env.SONMIRA_TEST_RESET_KEY;
  if (!secret) return reject(res, 404, 'not_enabled');
  if (!equal(req.headers?.['x-sonmira-test-reset-key'], secret)) return reject(res, 403, 'forbidden');
  const account = normalizeAccount(req.body?.account);
  if (!account) return reject(res, 400, 'bad_account');
  const { ledger, authorize } = wiring();
  if (!ledger || !authorize) return reject(res, 503, 'not_configured');
  if (!(await authorize(req, account))) return reject(res, 401, 'unauthorized_account');
  try {
    const status = await ledger.replenishTestFree(account);
    return res.status(200).json({ ok: true, account, free: status.free, credits: status.credits });
  } catch {
    return reject(res, 503, 'unavailable');
  }
}

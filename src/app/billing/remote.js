// The server's paintings ledger (api/billing/*): signed transactions in,
// the account's wallet out. Used by the iOS app only.

const json = async (res) => {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw Object.assign(new Error(body?.code || `http ${res.status}`), { code: body?.code || 'network' });
  return body;
};

export function createBillingServer({ fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  return {
    /** → { results, status } */
    send: ({ account, transactions = [], renewals = [], restore = false, day, device = null }) => fetchImpl('/api/billing/transactions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account, transactions, renewals, restore, day, device }),
    }).then(json),
    /** → status, with .wallet to adopt */
    status: (account, day) => fetchImpl(`/api/billing/status?account=${encodeURIComponent(account)}&day=${encodeURIComponent(day)}`).then(json).then((b) => b.status),
  };
}

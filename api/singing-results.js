// Vercel Serverless Function: saves Singing test results (measurements and
// the singer's labels, never audio) as JSON files in a PRIVATE GitHub
// repository, so they can be read without copying them by hand.
//
//   GET  /api/singing-results → { configured }
//   POST /api/singing-results { take } → { ok, path } | { ok:false, code }
//
// Configure in the Vercel project's Preview environment:
//   RESULTS_GITHUB_TOKEN  fine-grained token, Contents read/write on that repo only
//   RESULTS_REPO          owner/name of the private repository
// Not available in Production. The token never reaches the browser.

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_BYTES = 200_000;

export const resultsConfig = (env) => ({
  configured: Boolean(env.RESULTS_GITHUB_TOKEN && REPO.test(env.RESULTS_REPO ?? '')) && env.VERCEL_ENV !== 'production',
  repo: env.RESULTS_REPO,
});

// One file per recording: singing-test/<recordedAt>-take<slot>.json.
// Re-saving the same recording (a new label or note) updates that file.
export function pathFor(take) {
  const at = String(take?.recordedAt ?? '').replace(/[^0-9TZ-]/g, '').slice(0, 24);
  const slot = Number(take?.slot);
  if (!at || !Number.isInteger(slot) || slot < 1 || slot > 99) return null;
  return `singing-test/${at}-take${slot}.json`;
}

export const createHandler = ({ env = process.env, fetchImpl = fetch } = {}) => async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const cfg = resultsConfig(env);
  if (req.method === 'GET') { res.status(200).json({ configured: cfg.configured }); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method' }); return; }
  if (!cfg.configured) { res.status(503).json({ ok: false, code: 'not_configured' }); return; }
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { body = {}; }
  const take = body.take;
  const path = pathFor(take);
  const text = JSON.stringify(take ?? null, null, 1);
  if (!path || take.kind !== 'sonmira-singing-take' || text.length > MAX_BYTES || 'audio' in take && typeof take.audio === 'string' && take.audio.length > 1000) {
    res.status(400).json({ ok: false, code: 'bad_take' });
    return;
  }
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${path}`;
  const headers = { authorization: `Bearer ${env.RESULTS_GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'sonmira-playground' };
  try {
    const prev = await fetchImpl(url, { headers });
    const sha = prev.ok ? (await prev.json()).sha : undefined;
    const put = await fetchImpl(url, {
      method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ message: `Singing test: take ${take.slot}`, content: Buffer.from(text).toString('base64'), ...(sha ? { sha } : {}) }),
    });
    if (!put.ok) { res.status(502).json({ ok: false, code: `github_${put.status}` }); return; }
    res.status(200).json({ ok: true, path });
  } catch {
    res.status(502).json({ ok: false, code: 'github_unreachable' });
  }
};

export default createHandler();

// Small additions to fetch for the API:
//   - in the bundled iOS build, /api/... goes to the hosted API (API_ORIGIN);
//   - /api/generate carries the person's local day (x-sonmira-day), so
//     Daily Ritual's one painting a day follows their calendar, not UTC.
// Installed once at launch, before anything else wraps fetch.

import { API_ORIGIN } from './config.js';
import { dayKey } from '../format.js';

export function installApiFetch({ origin = API_ORIGIN, today = () => dayKey(new Date()) } = {}) {
  const base = globalThis.fetch;
  if (!base || base.sonmiraApi) return;
  const here = globalThis.location?.origin;
  const wrapped = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    let path = null;
    try { const u = new URL(url, globalThis.location?.href); if (u.origin === here && u.pathname.startsWith('/api/')) path = u.pathname + u.search; } catch {}
    if (path == null) return base(input, init);
    const headers = new Headers(init.headers ?? (typeof input === 'string' ? undefined : input.headers));
    if (path.startsWith('/api/generate')) headers.set('x-sonmira-day', today());
    const target = origin ? origin.replace(/\/+$/, '') + path : (typeof input === 'string' ? input : input.url);
    return base(typeof input === 'string' ? target : new Request(target, input), { ...init, headers });
  };
  wrapped.sonmiraApi = true;
  globalThis.fetch = wrapped;
}

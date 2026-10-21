// Contact & Feedback, the app side: what is sent with a message, and sending
// it to /api/feedback (server/feedback.js), which emails the team. The person
// writes the message; nothing else about them goes in except the email they
// choose to give for the reply. The device line is the platform and iOS
// version, never the diary, recordings, lyrics, Apple ID or purchases.

import { isNativeIOS } from '../native/platform.js';

export const MESSAGE_MAX = 4000;
export const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** "iOS 18.1" from a user agent, or '' when it doesn't say. */
export function iosVersion(ua = globalThis.navigator?.userAgent ?? '') {
  const m = /\bOS (\d+)[._](\d+)(?:[._](\d+))? like Mac OS X/.exec(ua);
  return m ? `iOS ${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}` : '';
}

/** "Sonmira for iPhone · iOS 18.1", "Sonmira on the web". */
export function deviceLine({ native = isNativeIOS(), ua } = {}) {
  return [native ? 'Sonmira for iPhone' : 'Sonmira on the web', iosVersion(ua)].filter(Boolean).join(' · ');
}

/**
 * Send a message. Resolves when the team has it; rejects with
 * { kind: 'network' | 'rateLimited' | 'server' }.
 */
export async function sendFeedback({ message, email = '' }, { fetchImpl = (...a) => globalThis.fetch(...a), device = deviceLine() } = {}) {
  let res;
  try {
    res = await fetchImpl('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: message.trim(), email: email.trim(), device }) });
  } catch { throw { kind: 'network' }; }
  if (res.ok) return;
  throw { kind: res.status === 429 ? 'rateLimited' : 'server' };
}

// Contact & Feedback: a message from Settings → Contact & Feedback, emailed to
// the Sonmira team. Nothing here touches paintings, purchases or generation.
//
//   POST /api/feedback { message, email?, device? } → { ok } | { ok:false, code }
//
// - The email goes out through Resend (RESEND_API_KEY) to FEEDBACK_TO_EMAIL.
//   Both are server env vars, so the team's address is never in the app.
//   Without a verified domain, Resend sends from onboarding@resend.dev, and
//   only to the address the Resend account was opened with.
// - Each message is also kept in the shared store for 180 days, so none is
//   lost if the email fails. It counts as sent if either step worked.
// - The sender's email is optional (for the reply) and becomes Reply-To.
//   Nothing else about the person is sent: the device line is the platform and
//   iOS version only, and the server adds which deployment it came from.
// - At most 5 messages an hour from one network address.

import { clientIp } from './protect/index.js';

export const MESSAGE_MAX = 4000;
export const RATE = { max: 5, windowSec: 3600 };
const KEEP_SEC = 180 * 24 * 3600;
const DEFAULT_FROM = 'Sonmira Feedback <onboarding@resend.dev>';
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

const clean = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const oneLine = (s, max) => clean(s, max).replace(/\s+/g, ' ');

/** The request body, checked: { message, email, device } or { error }. */
export function readFeedback(body) {
  const message = clean(body?.message, MESSAGE_MAX + 1);
  if (!message) return { error: 'empty' };
  if (message.length > MESSAGE_MAX) return { error: 'too_long' };
  const email = oneLine(body?.email, 254);
  if (email && !EMAIL.test(email)) return { error: 'bad_email' };
  return { message, email, device: oneLine(body?.device, 120) };
}

/** The email the team receives. */
export function feedbackEmail({ message, email, device, deployment, at }) {
  const lines = [message, '', '—', `Reply to: ${email || 'not given'}`, device ? `Device: ${device}` : null, deployment ? `Sonmira: ${deployment}` : null, `Sent: ${at}`];
  return {
    subject: `Sonmira — Feedback${email ? ` from ${email}` : ''}`,
    text: lines.filter((l) => l != null).join('\n'),
  };
}

// "production · 1a2b3c4" from Vercel's own variables, when there.
const deploymentOf = (env) => [env.VERCEL_ENV, env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7)].filter(Boolean).join(' · ');

export function sendViaResend({ apiKey, to, from = DEFAULT_FROM, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  return async ({ subject, text, replyTo }) => {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!res.ok) throw Object.assign(new Error('resend failed'), { status: res.status, detail: await res.text().catch(() => '') });
  };
}

/** deps: { kv, send, env, now, id } — send and kv may each be missing. */
export function createFeedbackHandler({ kv = null, send = null, env = process.env, now = () => Date.now(), id = () => globalThis.crypto.randomUUID() } = {}) {
  return async function feedback(req, res) {
    res.setHeader?.('cache-control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, code: 'method' });
    if (!send && !kv) return res.status(503).json({ ok: false, code: 'not_configured' });
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {}); } catch { body = {}; }
    const fb = readFeedback(body);
    if (fb.error) return res.status(400).json({ ok: false, code: fb.error });

    if (kv) {
      try {
        if (await kv.hit(`feedback:ip:${clientIp(req)}`, RATE.windowSec) > RATE.max) return res.status(429).json({ ok: false, code: 'rate_limited' });
      } catch {}
    }
    const at = new Date(now()).toISOString();
    const mail = feedbackEmail({ ...fb, deployment: deploymentOf(env), at });
    let kept = false, sent = false;
    if (kv) {
      try { await kv.set(`feedback:${at}:${id()}`, JSON.stringify({ ...fb, at }), KEEP_SEC); kept = true; }
      catch (e) { console.error('feedback: store failed', e?.code ?? e?.message); }
    }
    if (send) {
      try { await send({ ...mail, replyTo: fb.email || null }); sent = true; }
      catch (e) { console.error('feedback: email failed', e?.status ?? e?.message); }
    }
    if (!kept && !sent) return res.status(502).json({ ok: false, code: 'not_sent' });
    return res.status(200).json({ ok: true });
  };
}

/** From the env: Resend when RESEND_API_KEY and FEEDBACK_TO_EMAIL are set. */
export function feedbackFromEnv(env = process.env) {
  const apiKey = env.RESEND_API_KEY, to = env.FEEDBACK_TO_EMAIL;
  return apiKey && to ? sendViaResend({ apiKey, to, from: env.FEEDBACK_FROM_EMAIL || DEFAULT_FROM }) : null;
}

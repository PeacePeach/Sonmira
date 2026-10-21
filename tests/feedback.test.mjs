// Contact & Feedback: the Feedback page (Settings → About), what it sends,
// and /api/feedback, which emails the team. No browser: a small DOM stand-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { memoryKV } from '../server/protect/kv.js';
import { createFeedbackHandler, readFeedback, feedbackEmail, sendViaResend, feedbackFromEnv, RATE, MESSAGE_MAX } from '../server/feedback.js';

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.className = ''; this.style = {}; this.value = ''; this.disabled = false; this.classList = { add() {}, toggle() {} }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  append(...k) { this.children.push(...k); }
  set textContent(v) { this.children = v ? [String(v)] : []; }
  get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent ?? '')).join(''); }
}
globalThis.Node = El;
globalThis.document = { createElement: (t) => new El(t), createElementNS: (_, t) => new El(t), createTextNode: (s) => s };

const { iosVersion, deviceLine, sendFeedback } = await import('../src/app/support/feedback.js');
const { mountFeedback, FEEDBACK_COPY } = await import('../src/app/screens/feedback.js');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const find = (el, pred) => (pred(el) ? el : (el.children ?? []).map((c) => (typeof c === 'object' ? find(c, pred) : null)).find(Boolean) ?? null);
const byData = (el, key) => find(el, (e) => e.attrs?.[key] !== undefined);
const type = (input, v) => { input.value = v; input.listeners.input?.forEach((f) => f()); };

function fakeRes() {
  return { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const post = (body, ip = '1.2.3.4') => ({ method: 'POST', body, headers: { 'x-forwarded-for': ip } });

// ── The page ────────────────────────────────────────────────────────────────

function fakeApp() {
  return { went: [], toasts: [], navigate(n) { this.went.push(n); }, toast(msg, o) { this.toasts.push({ msg, ...o }); } };
}

test('the page: a Feedback title, the 1–3 business days promise, a message box and an optional email', () => {
  const { el } = mountFeedback(fakeApp(), { send: async () => {} });
  assert.equal(el.attrs['data-screen'], 'feedback');
  assert.equal(find(el, (e) => e.tag === 'h1').textContent, 'Feedback');
  assert.match(el.textContent, /reply within 1–3 business days/);
  assert.equal(byData(el, 'data-feedback-message').tag, 'textarea');
  const email = byData(el, 'data-feedback-email');
  assert.equal(email.attrs.type, 'email');
  assert.match(el.textContent, /\(optional\)/);
});

test('Send waits for a message, then sends it with the email and goes back to Settings', async () => {
  const app = fakeApp(), sent = [];
  const { el } = mountFeedback(app, { send: async (m) => { sent.push(m); } });
  const btn = byData(el, 'data-feedback-send');
  assert.equal(btn.disabled, true, 'nothing to send yet');
  type(byData(el, 'data-feedback-message'), '   ');
  assert.equal(btn.disabled, true, 'spaces are not a message');
  type(byData(el, 'data-feedback-message'), '  The painting never finished.  ');
  type(byData(el, 'data-feedback-email'), ' me@example.com ');
  assert.equal(btn.disabled, false);
  await btn.listeners.click[0]();
  assert.deepEqual(sent, [{ message: 'The painting never finished.', email: 'me@example.com' }]);
  assert.equal(app.toasts.at(-1).msg, FEEDBACK_COPY.sentWithEmail);
  assert.equal(app.toasts.at(-1).kind, 'success');
  assert.deepEqual(app.went, ['settings']);
});

test('without an email it still sends, and doesn’t promise a reply', async () => {
  const app = fakeApp();
  const { el } = mountFeedback(app, { send: async () => {} });
  type(byData(el, 'data-feedback-message'), 'Love it');
  await byData(el, 'data-feedback-send').listeners.click[0]();
  assert.equal(app.toasts.at(-1).msg, FEEDBACK_COPY.sent);
});

test('a mistyped email is caught before sending', async () => {
  const app = fakeApp(); let calls = 0;
  const { el } = mountFeedback(app, { send: async () => { calls++; } });
  type(byData(el, 'data-feedback-message'), 'Hi');
  type(byData(el, 'data-feedback-email'), 'me@example');
  await byData(el, 'data-feedback-send').listeners.click[0]();
  assert.equal(calls, 0);
  assert.match(el.textContent, /doesn’t look quite right/);
});

test('when sending fails, the message stays and the page says why', async () => {
  const app = fakeApp();
  const { el } = mountFeedback(app, { send: async () => { throw { kind: 'network' }; } });
  const box = byData(el, 'data-feedback-message');
  type(box, 'Crash on save');
  await byData(el, 'data-feedback-send').listeners.click[0]();
  assert.equal(box.value, 'Crash on save');
  assert.equal(box.disabled, false);
  assert.match(el.textContent, /offline/);
  assert.deepEqual(app.went, []);
  assert.equal(byData(el, 'data-feedback-send').disabled, false, 'can try again');
});

// ── What the app sends ─────────────────────────────────────────────────────

test('the device line is the platform and iOS version only', () => {
  assert.equal(iosVersion(IPHONE_UA), 'iOS 18.1.1');
  assert.equal(iosVersion('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), '');
  assert.equal(deviceLine({ native: true, ua: IPHONE_UA }), 'Sonmira for iPhone · iOS 18.1.1');
  assert.equal(deviceLine({ native: false, ua: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'Sonmira on the web');
});

test('sendFeedback posts the message, the email and the device line, and nothing else', async () => {
  let req;
  await sendFeedback({ message: ' hi ', email: '' }, { device: 'Sonmira for iPhone · iOS 18.1', fetchImpl: async (url, init) => { req = { url, ...init }; return { ok: true, status: 200 }; } });
  assert.equal(req.url, '/api/feedback');
  assert.equal(req.method, 'POST');
  assert.deepEqual(JSON.parse(req.body), { message: 'hi', email: '', device: 'Sonmira for iPhone · iOS 18.1' });
});

test('sendFeedback names the failure', async () => {
  const fail = (f) => sendFeedback({ message: 'x' }, { device: 'd', fetchImpl: f }).then(() => null, (e) => e.kind);
  assert.equal(await fail(async () => { throw new TypeError('offline'); }), 'network');
  assert.equal(await fail(async () => ({ ok: false, status: 429 })), 'rateLimited');
  assert.equal(await fail(async () => ({ ok: false, status: 502 })), 'server');
});

// ── /api/feedback ──────────────────────────────────────────────────────────

test('the request is checked: a message is needed, the email must look like one', () => {
  assert.equal(readFeedback({}).error, 'empty');
  assert.equal(readFeedback({ message: '  \n ' }).error, 'empty');
  assert.equal(readFeedback({ message: 'x'.repeat(MESSAGE_MAX + 1) }).error, 'too_long');
  assert.equal(readFeedback({ message: 'hi', email: 'nope' }).error, 'bad_email');
  assert.equal(readFeedback({ message: 'hi', email: 'a@b.co\nBcc: x@y.z' }).error, 'bad_email', 'no header injection');
  assert.deepEqual(readFeedback({ message: ' hi\r\nthere ', email: ' a@b.co ', device: 'Sonmira for iPhone\n· iOS 18' }), { message: 'hi\nthere', email: 'a@b.co', device: 'Sonmira for iPhone · iOS 18' });
});

test('the team’s email: the message, who to reply to, the device and the deployment', () => {
  const m = feedbackEmail({ message: 'It froze', email: 'a@b.co', device: 'Sonmira for iPhone · iOS 18.1', deployment: 'production · 1a2b3c4', at: '2026-10-21T21:00:00.000Z' });
  assert.equal(m.subject, 'Sonmira — Feedback from a@b.co');
  assert.equal(m.text, 'It froze\n\n—\nReply to: a@b.co\nDevice: Sonmira for iPhone · iOS 18.1\nSonmira: production · 1a2b3c4\nSent: 2026-10-21T21:00:00.000Z');
  assert.equal(feedbackEmail({ message: 'x', email: '', at: 't' }).subject, 'Sonmira — Feedback');
});

test('a message is emailed (Reply-To the sender) and kept', async () => {
  const kv = memoryKV(), mails = [];
  const handler = createFeedbackHandler({ kv, send: async (m) => { mails.push(m); }, env: { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'abcdef123456' }, now: () => Date.UTC(2026, 9, 21), id: () => 'id1' });
  const res = fakeRes();
  await handler(post({ message: 'Hello', email: 'a@b.co', device: 'Sonmira on the web' }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].replyTo, 'a@b.co');
  assert.match(mails[0].text, /Sonmira: production · abcdef1/);
  assert.deepEqual(JSON.parse(await kv.get('feedback:2026-10-21T00:00:00.000Z:id1')), { message: 'Hello', email: 'a@b.co', device: 'Sonmira on the web', at: '2026-10-21T00:00:00.000Z' });
});

test('if the email fails, the kept copy still counts; if both fail, the app is told', async () => {
  const kv = memoryKV();
  const failing = async () => { throw new Error('down'); };
  const res = fakeRes();
  await createFeedbackHandler({ kv, send: failing })(post({ message: 'x' }), res);
  assert.equal(res.code, 200);
  const brokenKv = { ...memoryKV(), set: async () => { throw new Error('kv'); } };
  const res2 = fakeRes();
  await createFeedbackHandler({ kv: brokenKv, send: failing })(post({ message: 'x' }), res2);
  assert.equal(res2.code, 502);
});

test('bad requests, other methods and no setup are refused', async () => {
  const h = createFeedbackHandler({ kv: memoryKV(), send: async () => {} });
  let res = fakeRes(); await h(post({ message: '' }), res); assert.deepEqual([res.code, res.body.code], [400, 'empty']);
  res = fakeRes(); await h({ method: 'GET', headers: {} }, res); assert.equal(res.code, 405);
  res = fakeRes(); await createFeedbackHandler({ kv: null, send: null })(post({ message: 'x' }), res); assert.deepEqual([res.code, res.body.code], [503, 'not_configured']);
});

test('at most 5 messages an hour from one network address', async () => {
  let sent = 0;
  const h = createFeedbackHandler({ kv: memoryKV(), send: async () => { sent++; } });
  const codes = [];
  for (let i = 0; i < RATE.max + 1; i++) { const r = fakeRes(); await h(post({ message: `m${i}` }), r); codes.push(r.code); }
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
  assert.equal(sent, RATE.max);
  const other = fakeRes(); await h(post({ message: 'x' }, '5.6.7.8'), other);
  assert.equal(other.code, 200, 'another address is unaffected');
});

test('Resend: the team’s address and the key stay on the server', async () => {
  let call;
  const send = sendViaResend({ apiKey: 'k', to: 'team@example.com', fetchImpl: async (url, init) => { call = { url, ...init }; return { ok: true }; } });
  await send({ subject: 's', text: 't', replyTo: 'a@b.co' });
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.headers.authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(call.body), { from: 'Sonmira Feedback <onboarding@resend.dev>', to: ['team@example.com'], subject: 's', text: 't', reply_to: 'a@b.co' });
  assert.equal(feedbackFromEnv({}), null);
  assert.equal(feedbackFromEnv({ RESEND_API_KEY: 'k' }), null, 'needs both');
  assert.equal(typeof feedbackFromEnv({ RESEND_API_KEY: 'k', FEEDBACK_TO_EMAIL: 'team@example.com' }), 'function');
  const app = await readFile(new URL('../src/app/support/feedback.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /@[a-z0-9-]+\.[a-z]/i, 'no address in the app bundle');
});

// ── Placement ──────────────────────────────────────────────────────────────

test('Settings → About lists Contact & Feedback first, opening the Feedback page', async () => {
  const src = await readFile(new URL('../src/app/screens/settings.js', import.meta.url), 'utf8');
  const about = src.slice(src.indexOf("'About'"));
  assert.match(about, /^'About'\),\s*h\('div', \{ class: 'group' \},\s*link\('Contact & Feedback', \(\) => app\.navigate\('feedback'\), 'contact'\)/);
  const main = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
  assert.match(main, /feedback: mountFeedback/);
});

test('it stays apart from payments and painting', async () => {
  for (const f of ['../src/app/support/feedback.js', '../src/app/screens/feedback.js', '../server/feedback.js']) {
    const src = await readFile(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /billing|paywall|ledger|engine|generate/i, f);
  }
});

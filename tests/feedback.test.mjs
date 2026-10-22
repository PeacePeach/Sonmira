// Contact & Feedback (Settings → About): the mailto: link, what the email
// says about the device (and nothing personal), and the fallback when no
// email app opens. No browser: a small DOM stand-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.className = ''; this.style = {}; this.classList = { add() {} }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  append(...k) { this.children.push(...k); }
  remove() { this.removed = true; }
  get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent ?? '')).join(''); }
}
globalThis.Node = El;
globalThis.document = { createElement: (t) => new El(t), createElementNS: (_, t) => new El(t), createTextNode: (s) => s };

const { SUPPORT_EMAIL, FEEDBACK_SUBJECT, iosVersion, deviceLine, feedbackBody, feedbackMailto, openFeedback } = await import('../src/app/support/feedback.js');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const find = (el, pred) => (pred(el) ? el : (el.children ?? []).map((c) => (typeof c === 'object' ? find(c, pred) : null)).find(Boolean) ?? null);

function fakeDoc() {
  const listeners = new Set();
  return {
    visibilityState: 'visible',
    addEventListener: (_, f) => listeners.add(f),
    removeEventListener: (_, f) => listeners.delete(f),
    hide() { this.visibilityState = 'hidden'; for (const f of listeners) f(); },
    get listening() { return listeners.size; },
  };
}
function fakeApp() {
  const root = new El('div');
  return { root, toasts: [], toast(msg, opts) { this.toasts.push({ msg, ...opts }); } };
}
function manualTimer() {
  let fn = null;
  return { setTimeout: (f) => { fn = f; return 1; }, clearTimeout: () => { fn = null; }, fire: () => fn?.() };
}

test('the subject is exactly "Sonmira — Feedback"', () => {
  assert.equal(FEEDBACK_SUBJECT, 'Sonmira — Feedback');
});

test('the email goes to Sonmira support', () => {
  assert.equal(SUPPORT_EMAIL, 'sonmirasupport@gmail.com');
  assert.ok(feedbackMailto({ device: 'd' }).startsWith('mailto:sonmirasupport@gmail.com?subject=Sonmira%20%E2%80%94%20Feedback&body='));
});

test('the iOS version comes from the user agent, when it says', () => {
  assert.equal(iosVersion(IPHONE_UA), 'iOS 18.1.1');
  assert.equal(iosVersion(IPHONE_UA.replace('18_1_1', '17_4')), 'iOS 17.4');
  assert.equal(iosVersion('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'), '');
  assert.equal(iosVersion(''), '');
});

test('the device line names the platform and iOS version only', () => {
  assert.equal(deviceLine({ native: true, ua: IPHONE_UA }), 'Sonmira for iPhone · iOS 18.1.1');
  assert.equal(deviceLine({ native: false, ua: IPHONE_UA }), 'Sonmira on the web · iOS 18.1.1');
  assert.equal(deviceLine({ native: false, ua: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'Sonmira on the web');
});

test('the message is friendly, editable text with the device line and nothing personal', () => {
  const body = feedbackBody('Sonmira for iPhone · iOS 18.1.1');
  assert.match(body, /^Hi Sonmira,/);
  assert.match(body, /what happened/);
  assert.ok(body.endsWith('Sonmira for iPhone · iOS 18.1.1'));
  // Built from fixed text and the device line alone: no app state goes in.
  assert.doesNotMatch(body, /apple id|lyric|recording|purchase|credit|subscription|@/i);
});

test('the mailto: link carries the address, subject and body, encoded', () => {
  const url = feedbackMailto({ email: 'hello@example.com', device: 'Sonmira for iPhone · iOS 18.1' });
  assert.ok(url.startsWith('mailto:hello@example.com?subject='));
  assert.ok(!url.includes(' ') && !url.includes('+'), 'spaces as %20, never +');
  const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  assert.equal(q.get('subject'), 'Sonmira — Feedback');
  assert.equal(q.get('body'), feedbackBody('Sonmira for iPhone · iOS 18.1'));
});

test('tapping opens the email app through a top-level mailto: navigation', () => {
  const doc = fakeDoc(), t = manualTimer(), app = fakeApp();
  const went = [];
  openFeedback(app, { doc, ...t, go: (u) => went.push(u), email: 'hello@example.com', device: 'd' });
  assert.equal(went.length, 1);
  assert.equal(went[0], feedbackMailto({ email: 'hello@example.com', device: 'd' }));
});

test('when the email app opens (Sonmira goes to the background), nothing else shows', () => {
  const doc = fakeDoc(), t = manualTimer(), app = fakeApp();
  openFeedback(app, { doc, ...t, go: () => doc.hide(), email: 'hello@example.com', device: 'd' });
  t.fire();
  assert.equal(app.root.children.length, 0);
  assert.equal(app.toasts.length, 0);
  assert.equal(doc.listening, 0, 'the listener is removed');
});

test('when no email app opens, a sheet offers the address to copy', async () => {
  const doc = fakeDoc(), t = manualTimer(), app = fakeApp();
  let copied = null;
  const clip = globalThis.navigator?.clipboard;
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (s) => { copied = s; } } }, configurable: true });
  try {
    openFeedback(app, { doc, ...t, go: () => {}, email: 'hello@example.com', device: 'd' });
    assert.equal(app.root.children.length, 0, 'not before the moment has passed');
    t.fire();
    const sheet = app.root.children[0];
    assert.ok(sheet, 'the sheet opened');
    assert.match(sheet.textContent, /hello@example\.com/);
    const copy = find(sheet, (e) => e.attrs?.['data-copy-email'] !== undefined);
    await copy.listeners.click[0]();
    assert.equal(copied, 'hello@example.com');
    assert.equal(app.toasts.at(-1).kind, 'success');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: clip ? { clipboard: clip } : undefined, configurable: true });
  }
});

test('without an address yet, the fallback is a quiet banner, not an empty sheet', () => {
  const doc = fakeDoc(), t = manualTimer(), app = fakeApp();
  openFeedback(app, { doc, ...t, go: () => {}, email: '', device: 'd' });
  t.fire();
  assert.equal(app.root.children.length, 0);
  assert.equal(app.toasts.length, 1);
});

test('Settings → About lists Contact & Feedback first, as a regular row', async () => {
  const src = await readFile(new URL('../src/app/screens/settings.js', import.meta.url), 'utf8');
  const about = src.slice(src.indexOf("'About'"));
  assert.match(about, /^'About'\),\s*h\('div', \{ class: 'group' \},\s*link\('Contact & Feedback', \(\) => openFeedback\(app\), 'contact'\)/);
});

test('it stays apart from payments and painting', async () => {
  const src = await readFile(new URL('../src/app/support/feedback.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['../native/platform.js', '../paywall/layer.js', '../ui/dom.js']);
});

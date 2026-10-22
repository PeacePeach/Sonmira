// Contact & Feedback (Settings → About): opens the person's own email app on
// a short, editable message to Sonmira. No form, no backend; what is sent is
// what they choose to send. The message names only the platform and iOS
// version, never the diary, recordings, lyrics, Apple ID or purchases.
//
// In the iOS app, Capacitor hands a top-level mailto: navigation to iOS
// (WebViewDelegationHandler → UIApplication.open), so Mail, or the default
// email app, opens over Sonmira. When no email app answers, the page stays
// in front; after a moment the sheet below offers the address to copy.

import { h } from '../ui/dom.js';
import { openLayer } from '../paywall/layer.js';
import { isNativeIOS } from '../native/platform.js';

// Sonmira's official support address (Han, 21 Oct). The one place it is set.
export const SUPPORT_EMAIL = 'sonmirasupport@gmail.com';
export const FEEDBACK_SUBJECT = 'Sonmira — Feedback';
const FALLBACK_MS = 1500;

/** "iOS 18.1" from a user agent, or '' when it doesn't say. */
export function iosVersion(ua = globalThis.navigator?.userAgent ?? '') {
  const m = /\bOS (\d+)[._](\d+)(?:[._](\d+))? like Mac OS X/.exec(ua);
  return m ? `iOS ${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}` : '';
}

/** "Sonmira for iPhone · iOS 18.1", "Sonmira on the web". */
export function deviceLine({ native = isNativeIOS(), ua } = {}) {
  return [native ? 'Sonmira for iPhone' : 'Sonmira on the web', iosVersion(ua)].filter(Boolean).join(' · ');
}

export function feedbackBody(device) {
  return [
    'Hi Sonmira,',
    '',
    'Tell us what happened, or what you’d like to share:',
    '',
    '',
    '',
    'If something went wrong, it helps to know what you were doing and what you expected. A screenshot is welcome too.',
    '',
    '—',
    device,
  ].join('\n');
}

/** The mailto: link, subject and body encoded (spaces as %20, which every mail app reads). */
export function feedbackMailto({ email = SUPPORT_EMAIL, device = deviceLine() } = {}) {
  const q = `subject=${encodeURIComponent(FEEDBACK_SUBJECT)}&body=${encodeURIComponent(feedbackBody(device))}`;
  return `mailto:${email}?${q}`;
}

/**
 * Open the email app; if the page is still in front a moment later (no email
 * app, or a desktop browser without one), show the address to copy.
 * io is for tests: { go(url), doc, setTimeout, clearTimeout }.
 */
export function openFeedback(app, io = {}) {
  const doc = io.doc ?? document;
  const go = io.go ?? ((url) => { globalThis.location.href = url; });
  const wait = io.setTimeout ?? setTimeout;
  const stop = io.clearTimeout ?? clearTimeout;
  let left = false;
  const onHide = () => { if (doc.visibilityState === 'hidden') left = true; };
  doc.addEventListener('visibilitychange', onHide);
  go(feedbackMailto({ email: io.email ?? SUPPORT_EMAIL, device: io.device ?? deviceLine() }));
  const timer = wait(() => {
    doc.removeEventListener('visibilitychange', onHide);
    if (!left) showFallback(app, io.email ?? SUPPORT_EMAIL);
  }, FALLBACK_MS);
  return { cancel: () => { stop(timer); doc.removeEventListener('visibilitychange', onHide); } };
}

function showFallback(app, email) {
  if (!email) { app.toast('We couldn’t open your email app.', { kind: 'warning' }); return; }
  const layer = openLayer(app, { label: 'Contact & Feedback', cls: 'acct-sheet' });
  layer.panel.dataset.feedbackSheet = '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(email); app.toast('Email address copied.', { kind: 'success' }); layer.close(); }
    catch { app.toast(`You can write to us at ${email}.`); }
  };
  layer.body.append(
    h('h2', { class: 'serif pw-title' }, 'Write to us'),
    h('p', { class: 'pw-lede' }, `If your email app didn’t open, you can write to us at ${email}. We read every message.`),
    h('div', { class: 'actions' },
      h('button', { class: 'pill', 'data-copy-email': '', onClick: copy }, 'Copy email address'),
      h('button', { class: 'quiet-btn', onClick: () => layer.close() }, 'Done')));
}

// Contact & Feedback (Settings → About): a page with one box for the message
// and an optional email for the reply. Send hands it to the server, which
// emails the team, so the person never chooses an address.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { sendFeedback, EMAIL, MESSAGE_MAX } from '../support/feedback.js';

export const FEEDBACK_COPY = {
  title: 'Feedback',
  lede: 'Tell us what happened, or anything you’d like to share. We read every message and reply within 1–3 business days.',
  placeholder: 'What happened? What did you expect?',
  emailLabel: 'Your email, so we can reply',
  emailPlaceholder: 'you@example.com',
  sent: 'Thank you. Your message is on its way to us.',
  sentWithEmail: 'Thank you. We’ll reply within 1–3 business days.',
};

const ERRORS = {
  network: 'You seem to be offline. Your message is still here. Try again when you’re connected.',
  rateLimited: 'You’ve sent a few messages just now. Please try again in a little while.',
  server: 'We couldn’t send your message just now. It’s still here. Please try again in a moment.',
  email: 'That email doesn’t look quite right.',
};

// UX Preview: nothing leaves the browser; it only looks sent.
const previewSend = () => new Promise((r) => setTimeout(r, 600));

export function mountFeedback(app, { send = app.dev?.uxPreview ? previewSend : sendFeedback } = {}) {
  let busy = false;
  const back = () => !busy && app.navigate('settings');
  const message = h('textarea', { class: 'feedback-input', 'data-feedback-message': '', rows: '7', maxlength: String(MESSAGE_MAX), placeholder: FEEDBACK_COPY.placeholder, 'aria-label': 'Your message', onInput: () => paint() });
  const email = h('input', { class: 'feedback-email', 'data-feedback-email': '', type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false', placeholder: FEEDBACK_COPY.emailPlaceholder, 'aria-label': FEEDBACK_COPY.emailLabel, onInput: () => { status.textContent = ''; paint(); } });
  const status = h('div', { class: 'share-message pw-message', role: 'status' });
  const btn = h('button', { class: 'pill', 'data-feedback-send': '', onClick: submit }, 'Send');

  function paint() {
    btn.disabled = busy || !message.value.trim();
    message.disabled = busy;
    email.disabled = busy;
    btn.textContent = busy ? 'Sending…' : 'Send';
  }

  async function submit() {
    const text = message.value.trim();
    const addr = email.value.trim();
    if (busy || !text) return;
    if (addr && !EMAIL.test(addr)) { status.textContent = ERRORS.email; status.dataset.tone = 'error'; return; }
    busy = true; status.textContent = ''; paint();
    try {
      await send({ message: text, email: addr });
      app.toast(addr ? FEEDBACK_COPY.sentWithEmail : FEEDBACK_COPY.sent, { kind: 'success' });
      busy = false;
      app.navigate('settings');
    } catch (e) {
      busy = false; paint();
      status.textContent = ERRORS[e?.kind] || ERRORS.server;
      status.dataset.tone = 'error';
    }
  }

  const el = h('div', { class: 'settings feedback', 'data-screen': 'feedback' },
    h('div', { class: 'navrow' }, h('button', { class: 'icon-btn', 'aria-label': 'Back to settings', onClick: back }, icon('back', { size: 'lg' })), h('div')),
    h('h1', {}, FEEDBACK_COPY.title),
    h('p', { class: 'feedback-lede' }, FEEDBACK_COPY.lede),
    h('div', { class: 'feedback-form' },
      message,
      h('label', { class: 'feedback-label' }, FEEDBACK_COPY.emailLabel, h('span', { class: 'feedback-optional' }, ' (optional)')),
      email,
      h('div', { class: 'actions' }, status, btn)));
  paint();
  return { el };
}

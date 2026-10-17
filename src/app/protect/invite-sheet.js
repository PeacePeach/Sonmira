// Asks for a beta invitation code, once, when the painting service needs
// one. Resolves with the code, or null for "Not now" (the take stays kept).

import { h } from '../ui/dom.js';
import { openQuietSheet } from '../ui/quiet-sheet.js';

const ERRORS = {
  invalid_invite: 'That code didn’t work. Check it and try again.',
  invite_full: 'This code is already in use on its maximum number of devices.',
  rate_limited: 'Too many tries. Please wait a while, then try again.',
  network: 'Couldn’t reach Sonmira. Check your connection and try again.',
};

/** @returns {Promise<string|null>} */
export function askInviteCode(app, { error } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); sheet.close(); };
    const input = h('input', {
      class: 'caption-input', placeholder: 'Invitation code', 'aria-label': 'Invitation code',
      autocapitalize: 'characters', autocomplete: 'off', spellcheck: false, enterkeyhint: 'go', maxlength: '40',
      onKeydown: (e) => { if (e.key === 'Enter') submit(); },
    });
    const submit = () => { const v = input.value.trim(); if (v) finish(v); else input.focus(); };
    const sheet = openQuietSheet(app, { title: 'Your invitation', onClose: () => { if (!done) { done = true; resolve(null); } } },
      h('p', { class: 'invite-lede' }, 'Sonmira is in a small private beta. Enter the invitation code you were given to start painting.'),
      error ? h('div', { class: 'share-message', role: 'status' }, ERRORS[error] || 'That didn’t work. Please try again.') : null,
      input,
      h('div', { class: 'actions' },
        h('button', { class: 'pill', onClick: submit }, 'Continue'),
        h('button', { class: 'quiet-btn', onClick: () => finish(null) }, 'Not now')));
    injectStyle();
    setTimeout(() => input.focus(), 350);
  });
}

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  document.head.append(h('style', {}, '.invite-lede { font-size: 14px; color: var(--secondary); line-height: 1.55; margin: 6px 0 4px; text-wrap: pretty; }'));
}

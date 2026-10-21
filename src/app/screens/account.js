// Account (Settings → Account): sign in with Apple, or see what signing in
// means, sign out and delete. Built from the Settings layout; confirmations
// use the paywall's sheet. Sign-in is never asked for anywhere else.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openLayer } from '../paywall/layer.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const sinceLabel = (t) => { const d = new Date(t); return `Since ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

// Apple's logo on the Sign in with Apple button is Apple's mark, required by its
// button guidelines, so it is a brand asset rather than an icon from the registry.
export const appleLogo = () => h('img', { class: 'apple-mark', src: 'assets/apple-logo.svg', alt: '', 'aria-hidden': 'true', width: 15, height: 18 });

export const ERRORS = {
  network: 'You seem to be offline. Nothing has changed, and your diary is safe. Try again when you’re connected.',
  notAvailable: 'Sign in with Apple needs an Apple ID on this iPhone. You can add one in the Settings app.',
  failed: 'Apple couldn’t sign you in just now. Nothing has changed. Please try again.',
  server: 'Apple said yes, but we couldn’t finish here. Nothing has changed. Please try again in a moment.',
  sessionEnded: 'You’re no longer signed in. Your diary is still here.',
};

/** What signing in does and doesn't cover, said the same way in both states. */
export function staysHere() {
  const row = (label) => h('div', { class: 'row' }, h('span', {}, label), h('span', { class: 'val acct-here' }, 'This iPhone'));
  return [
    h('div', { class: 'section' }, 'Kept on this iPhone'),
    h('div', { class: 'group', 'data-stays': '' }, row('Diary'), row('Original recordings'), row('Paintings')),
    h('p', { class: 'acct-note' }, 'Signing in doesn’t back these up or bring them to another device.'),
  ];
}

export function mountAccount(app) {
  const acc = app.account;
  const el = h('div', { class: 'settings account', 'data-screen': 'account' });
  let busy = false;

  const back = h('div', { class: 'navrow' }, h('button', { class: 'icon-btn', 'aria-label': 'Back to settings', onClick: () => !busy && app.navigate('settings') }, icon('back', { size: 'lg' })), h('div'));

  function guest() {
    const message = h('div', { class: 'share-message pw-message', role: 'status' });
    const label = h('span', {}, 'Sign in with Apple');
    const btn = h('button', { class: 'pill apple-btn', 'data-apple-sign-in': '', onClick: signIn }, appleLogo(), label);
    async function signIn() {
      if (busy) return;
      busy = true; btn.disabled = true; label.textContent = 'Signing in…'; message.textContent = '';
      try {
        const r = await acc.signIn();
        if (r.status === 'linked') app.toast('Signed in. Your paintings and purchases now stay with your Apple ID.', { kind: 'success' });
        if (r.status === 'returning') app.toast('Welcome back. Your paintings and purchases are with you again.', { kind: 'success' });
        busy = false;
        if (r.status !== 'cancelled') return paint();
        // Cancelled: back as it was, without a word.
      } catch (e) {
        message.textContent = ERRORS[e?.kind] || ERRORS.failed;
        message.dataset.tone = 'error';
      }
      busy = false; btn.disabled = false; label.textContent = 'Sign in with Apple';
    }
    return [
      back,
      h('h1', {}, 'Account'),
      h('p', { class: 'acct-lede' }, 'Sonmira works without an account.'),
      h('p', { class: 'acct-text' }, 'If you sign in with Apple, your paintings left, Little Moments and Daily Ritual stay with you when you reset or change your iPhone.'),
      ...staysHere(),
      h('div', { class: 'acct-actions' },
        btn, message,
        h('button', { class: 'quiet-btn', onClick: () => !busy && app.navigate('settings') }, 'Not now'),
        h('p', { class: 'pw-fine' }, 'We don’t ask Apple for your name or email.'),
        acc.simulated ? h('div', { class: 'pw-dev' }, 'Development build · sign-in is simulated') : null),
    ];
  }

  function signedIn() {
    const st = acc.status();
    const action = (label, onClick, attrs = {}) => h('button', { class: 'row action', onClick, ...attrs }, h('span', {}, label));
    return [
      back,
      h('h1', {}, 'Account'),
      h('div', { class: 'acct-first group' },
        h('div', { class: 'row', 'data-signed-in': '' }, h('span', {}, 'Signed in with Apple'), h('span', { class: 'val' }, st.since ? sinceLabel(st.since) : ''))),
      ...staysHere(),
      h('div', { class: 'section' }, 'Your account'),
      h('div', { class: 'group' },
        action('Sign out', confirmSignOut, { 'data-sign-out': '' }),
        h('button', { class: 'row action', 'data-delete-account': '', onClick: () => app.navigate('accountDelete') }, h('span', {}, 'Delete account'), icon('forward', { size: 'sm', tone: 'subtle' }))),
      h('div', { class: 'foot' }, 'Your paintings and purchases are linked to your Apple ID. We never see your name or email.'),
      acc.simulated ? h('div', { class: 'section' }, 'Development · sign-in simulation') : null,
      acc.simulated ? h('div', { class: 'group' }, action('Remove Sonmira from my Apple ID', () => { acc.dev.revokeAtApple(); app.toast('Removed at Apple (simulated). Reopen the app to see what happens.'); }, { 'data-dev-revoke': '' })) : null,
    ];
  }

  function confirmSignOut() {
    const layer = openLayer(app, { label: 'Sign out', cls: 'acct-sheet' });
    layer.panel.dataset.signOutSheet = '';
    layer.body.append(
      h('h2', { class: 'serif pw-title' }, 'Sign out?'),
      h('p', { class: 'pw-lede' }, 'Your diary stays on this iPhone. Your paintings and purchases stay with your Apple ID, ready when you sign in again.'),
      h('div', { class: 'actions' },
        h('button', { class: 'pill', 'data-confirm-sign-out': '', onClick: () => { layer.close(); acc.signOut(); app.toast('Signed out. Your diary is still here.', { kind: 'success' }); paint(); } }, 'Sign out'),
        h('button', { class: 'quiet-btn', onClick: () => layer.close() }, 'Stay signed in')));
  }

  function paint() { el.replaceChildren(...(acc.status().signedIn ? signedIn() : guest()).filter(Boolean)); }
  paint();
  return { el };
}

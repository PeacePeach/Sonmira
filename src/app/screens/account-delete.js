// Delete account. What goes (the account on our server) and what stays (the
// diary on this iPhone) are said plainly; erasing the diary too is a separate,
// unticked choice. Two taps, then Apple confirms it's the same person.

import { h, icons } from '../ui/dom.js';
import { clearEntries } from '../storage.js';

const ERRORS = {
  network: 'You seem to be offline. Nothing was deleted. Try again when you’re connected.',
  notAvailable: 'Apple couldn’t confirm it’s you on this iPhone. Nothing was deleted.',
  failed: 'Apple couldn’t confirm it’s you just now. Nothing was deleted. Please try again.',
  notThisAccount: 'That Apple ID isn’t the one this account belongs to. Nothing was deleted.',
  server: 'We couldn’t delete your account just now. Nothing was removed. Please try again in a moment.',
};

export function mountAccountDelete(app) {
  const acc = app.account;
  if (!acc.status().signedIn) { queueMicrotask(() => app.navigate('account')); return { el: h('div') }; }
  let eraseDiary = false, armed = false, busy = false, armT = null;

  const mark = h('span', { class: 'pw-mark', 'aria-hidden': 'true' });
  const erase = h('button', { class: 'pw-plan acct-erase', role: 'checkbox', 'aria-checked': 'false', 'data-erase-diary': '', onClick: () => { if (busy) return; eraseDiary = !eraseDiary; disarm(); paint(); } },
    mark,
    h('span', { class: 'pw-plan-text' },
      h('span', { class: 'serif pw-plan-name' }, 'Also erase the diary on this iPhone'),
      h('span', { class: 'pw-plan-blurb' }, 'Every painting, recording and note here, permanently.')));

  const message = h('div', { class: 'share-message pw-message', role: 'status' });
  const btn = h('button', { class: 'pill', 'data-delete-confirm': '', onClick: onDelete });
  const keep = h('button', { class: 'quiet-btn', onClick: () => !busy && app.navigate('account') }, 'Keep my account');

  const st = app.billing?.status();
  const subscribed = !!(st?.subscribed && st.sub?.willRenew);
  const manage = () => app.toast(app.billing?.simulated
    ? 'In the app, this opens Apple’s subscription settings. In this simulation, use Settings → Development.'
    : 'Opening subscription settings…');

  function paint() {
    erase.classList.toggle('on', eraseDiary);
    erase.setAttribute('aria-checked', String(eraseDiary));
    erase.disabled = busy;
    btn.disabled = busy;
    keep.disabled = busy;
    if (busy) return;
    btn.textContent = armed ? (eraseDiary ? 'Tap again to delete account and diary' : 'Tap again to delete') : 'Delete account';
  }
  function disarm() { armed = false; clearTimeout(armT); }

  async function onDelete() {
    if (busy) return;
    if (!armed) { armed = true; message.textContent = ''; paint(); armT = setTimeout(() => { armed = false; paint(); }, 3500); return; }
    disarm();
    busy = true; btn.textContent = 'One moment…'; paint();
    try {
      const r = await acc.remove();
      if (r.status === 'cancelled') { busy = false; paint(); return; }
      if (eraseDiary) {
        try { await clearEntries(); app.entries = []; }
        catch { app.toast('Your account was deleted, but the diary couldn’t be erased. You can delete paintings one by one.'); app.navigate('settings'); return; }
      }
      app.toast(eraseDiary ? 'Your account and this iPhone’s diary have been deleted.' : 'Your account has been deleted. Your diary is still here.');
      app.navigate('settings');
    } catch (e) {
      busy = false; paint();
      if (e?.kind === 'sessionEnded') { app.toast('You’re no longer signed in. Your diary is still here.'); app.navigate('settings'); return; }
      message.textContent = ERRORS[e?.kind] || ERRORS.server;
      message.dataset.tone = 'error';
    }
  }

  const el = h('div', { class: 'settings legal account', 'data-screen': 'account-delete' },
    h('div', { class: 'navrow' }, h('button', { class: 'icon-btn', 'aria-label': 'Back to account', onClick: () => !busy && app.navigate('account') }, icons.back()), h('div')),
    h('h1', {}, 'Delete account'),
    h('div', { class: 'prose' },
      h('p', {}, 'This removes your account from Sonmira: the link to your Apple ID, the paintings you have left, your Little Moments credits and your beta access. It can’t be undone.'),
      h('p', {}, 'Your diary, recordings and paintings on this iPhone aren’t part of your account. They stay here unless you choose otherwise below.'),
      subscribed ? h('p', { 'data-sub-note': '' }, 'Deleting your account doesn’t cancel Daily Ritual. To stop it renewing, cancel it in your Apple ID settings. ', h('button', { class: 'acct-link', onClick: manage }, 'Manage Daily Ritual')) : null),
    h('div', { class: 'acct-erase-wrap' }, erase),
    h('div', { class: 'acct-actions' },
      btn, message, keep,
      acc.simulated ? h('div', { class: 'pw-dev' }, 'Development build · sign-in is simulated') : null));

  paint();
  return { el, destroy: () => clearTimeout(armT) };
}

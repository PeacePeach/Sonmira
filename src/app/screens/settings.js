// Settings — functioning rows show a value and respond to taps; rows for
// features that don't exist yet say "Coming soon" and do nothing.

import { h, icons } from '../ui/dom.js';
import { LENGTHS } from '../settings.js';
import { openPaywall } from '../paywall/paywall.js';
import { balanceLabel, renewalLabel } from '../paywall/copy.js';

export function mountSettings(app) {
  const b = app.billing;
  const lengthVal = h('span', { class: 'val' });
  const paintings = h('div', { class: 'group', 'data-paintings': '' });
  const devGroup = h('div', { class: 'group', 'data-dev-group': '' });
  const weekVal = h('span', { class: 'val' });
  const accountVal = h('span', { class: 'val acct-row-val' });
  const paint = () => {
    lengthVal.textContent = `${app.settings.maxSeconds} seconds`;
    weekVal.textContent = app.settings.weekStart === 1 ? 'Mon' : 'Sun';
    accountVal.textContent = app.account?.status().signedIn ? 'Signed in with Apple' : 'On this iPhone';
    const st = b.status();
    paintings.replaceChildren(...[
      h('div', { class: 'row' }, h('span', {}, 'Available'), h('span', { class: 'val' }, balanceLabel(st))),
      st.sub ? action('Daily Ritual', h('span', { class: 'val' }, renewalLabel(st.sub)), manage) : null,
      link('More paintings', () => openPaywall(app, { from: 'settings', onContinue: () => app.navigate('sing') })),
      action('Restore purchases', null, restore),
    ].filter(Boolean));
    if (b.simulated) devGroup.replaceChildren(...devRows());
  };

  // In the app this opens Apple's subscription settings (AppStore.showManageSubscriptions).
  const manage = () => app.toast(b.simulated
    ? 'In the app, this opens Apple’s subscription settings. In this simulation, use Development below.'
    : 'Opening subscription settings…');

  async function restore() {
    try {
      const r = await b.restore();
      app.toast(r.subscription || r.credits ? `Restored. ${balanceLabel(b.status())}.` : 'There’s nothing to restore for this Apple ID.');
    } catch (e) {
      if (e?.kind !== 'userCancelled') app.toast('We couldn’t reach the App Store to restore. Check your connection and try again.');
    }
    paint();
  }

  // Development only: shown while purchases are simulated, never with the App Store.
  function devRows() {
    const dev = (label, fn) => h('button', { class: 'row action', 'data-dev': label, onClick: async () => { await fn(); paint(); } }, h('span', {}, label));
    const st = b.status();
    return [
      dev('Use up the free paintings', () => b.dev.useUpFree()),
      dev('Start a new day', () => b.dev.nextDay()),
      b.dev.store.hasPending() ? dev('Approve the pending purchase', () => b.dev.approvePending()) : null,
      st.sub?.willRenew ? dev('Cancel Daily Ritual (stops renewing)', () => b.dev.cancelSubscription()) : null,
      st.subscribed ? dev('End Daily Ritual now', () => b.dev.expireSubscription()) : null,
      dev('Delete and reinstall the app', () => b.dev.reinstall()),
      dev('Start over as a new person', () => b.dev.reset()),
    ].filter(Boolean);
  }

  const action = (label, val, onClick) => h('button', { class: 'row action', onClick }, h('span', {}, label), val);
  const link = (label, onClick) => h('button', { class: 'row action', onClick }, h('span', {}, label), icons.chevron());
  const soon = (label) => h('div', { class: 'row soon', 'aria-disabled': 'true' }, h('span', {}, label), h('span', { class: 'val' }, 'Coming soon'));

  const el = h('div', { class: 'settings', 'data-screen': 'settings' },
    h('div', { class: 'navrow' }, h('button', { class: 'icon-btn', 'aria-label': 'Back to diary', onClick: () => app.navigate('diary') }, icons.back()), h('div')),
    h('h1', {}, 'Settings'),
    h('div', { class: 'section' }, 'Diary'),
    h('div', { class: 'group' },
      action('Recording length', lengthVal, () => {
        const i = LENGTHS.indexOf(app.settings.maxSeconds);
        app.setSettings({ maxSeconds: LENGTHS[(i + 1) % LENGTHS.length] }); paint();
      }),
      action('Start day of week', weekVal, () => { app.setSettings({ weekStart: app.settings.weekStart ? 0 : 1 }); paint(); }),
      soon('Daily reminder'),
      soon('Diary lock'),
      soon('Backup / restore')),
    h('div', { class: 'section' }, 'Paintings'),
    paintings,
    h('div', { class: 'section' }, 'Account'),
    h('div', { class: 'group' },
      h('button', { class: 'row action', 'data-account-row': '', onClick: () => app.navigate('account') }, h('span', {}, 'Account'), h('span', { class: 'row-end' }, accountVal, icons.chevron()))),
    h('div', { class: 'section' }, 'About'),
    h('div', { class: 'group' },
      soon('Rate Sonmira'),
      link('Privacy policy', () => app.navigate('legal', { doc: 'privacy' })),
      link('Terms', () => app.navigate('legal', { doc: 'terms' }))),
    b.simulated ? h('div', { class: 'section' }, 'Development · purchase simulation') : null,
    b.simulated ? devGroup : null,
    h('div', { class: 'foot' }, 'Recordings stay on this device.'));

  paint();
  const off = b.onChange(paint);
  return { el, destroy: off };
}

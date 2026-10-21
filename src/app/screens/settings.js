// Settings — functioning rows show a value and respond to taps; rows for
// features that don't exist yet say "Coming soon" and do nothing.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openPaywall } from '../paywall/paywall.js';
import { openLayer } from '../paywall/layer.js';
import { balanceLabel, availableLabel, creditsLede, nextCreditLabel, subscriptionLabel } from '../paywall/copy.js';

export function mountSettings(app) {
  const b = app.billing;
  const paintings = h('div', { class: 'group', 'data-paintings': '' });
  const devGroup = h('div', { class: 'group', 'data-dev-group': '' });
  const weekVal = h('span', { class: 'val' });
  const accountVal = h('span', { class: 'val acct-row-val' });
  const paint = () => {
    weekVal.textContent = app.settings.weekStart === 1 ? 'Mon' : 'Sun';
    accountVal.textContent = app.account?.status().signedIn ? 'Signed in with Apple' : 'On this iPhone';
    const st = b.status();
    paintings.replaceChildren(...[
      available(st),
      st.sub ? action('Daily Ritual', h('span', { class: 'val', 'data-sub-state': '' }, subscriptionLabel(st.sub, st.now)), manage, 'dailyRitual') : null,
      link('More paintings', () => openPaywall(app, { from: 'settings', onContinue: () => app.navigate('sing') }), 'morePaintings'),
      action('Restore purchases', null, restore, 'restore'),
    ].filter(Boolean));
    if (b.simulated) devGroup.replaceChildren(...devRows());
  };

  // In the app this opens Apple's subscription settings (AppStore.showManageSubscriptions).
  const manage = () => (b.manageSubscriptions
    ? b.manageSubscriptions().then(() => b.refresh()).then(paint).catch(() => app.toast('We couldn’t open your subscription settings. You’ll also find them in Settings, under your name.'))
    : app.toast('In the app, this opens Apple’s subscription settings. In this simulation, use Development below.'));

  async function restore() {
    try {
      const r = await b.restore();
      app.toast(r.subscription || r.credits ? `Restored. ${balanceLabel(b.status())}.` : 'There’s nothing to restore for this Apple ID.');
    } catch (e) {
      if (e?.kind === 'appOnly') app.toast('Purchases are made and restored in the Sonmira app for iPhone.');
      else if (e?.kind !== 'userCancelled') app.toast('We couldn’t reach the App Store to restore. Check your connection and try again.');
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

  // Available: the total, and when Daily Ritual's next painting comes, if one is on its way.
  // Available: just the total; the next Daily Ritual credit is one tap away, in a sheet.
  const available = (st) => h('button', { class: 'row action', 'data-available': '', onClick: () => openAvailable() },
    lead('Available', 'paintings'), h('span', { class: 'row-end' }, h('span', { class: 'val' }, availableLabel(st)), icon('forward', { size: 'sm', tone: 'subtle' })));
  const openAvailable = () => {
    const st = b.status();
    const next = nextCreditLabel(st);
    const layer = openLayer(app, { label: 'Available credits', cls: 'credits-sheet' });
    layer.panel.dataset.availableSheet = '';
    const card = (ic, title, text) => h('div', { class: 'credits-card', ...(ic === 'nextCredit' ? { 'data-next-credit': '' } : {}) },
      icon(ic, { size: 'lg' }), h('div', {}, h('div', { class: 'serif credits-card-title' }, title), h('p', { class: 'credits-card-text' }, text)));
    layer.body.append(
      h('h2', { class: 'serif pw-title' }, 'Available credits'),
      h('p', { class: 'pw-lede' }, creditsLede(st)),
      next ? card('nextCredit', 'Next credit', `${next} Daily Ritual adds 1 credit every day, up to 30.`) : null,
      card('aboutCredits', 'Credits never expire', 'All your credits, including daily credits and purchased credits, stay in your account until you use them.'));
  };

  // A row's label, with its leading icon (muted, or faint while the row is Coming soon).
  const lead = (label, name, tone = 'muted') => h('span', { class: 'row-label' }, name ? icon(name, { tone }) : null, label);
  const action = (label, val, onClick, ic) => h('button', { class: 'row action', onClick }, lead(label, ic), val);
  const link = (label, onClick, ic) => h('button', { class: 'row action', onClick }, lead(label, ic), icon('forward', { size: 'sm', tone: 'subtle' }));
  const soon = (label, ic) => h('div', { class: 'row soon', 'aria-disabled': 'true' }, lead(label, ic, 'disabled'), h('span', { class: 'val' }, 'Coming soon'));

  const el = h('div', { class: 'settings', 'data-screen': 'settings' },
    h('div', { class: 'navrow' }, h('button', { class: 'icon-btn', 'aria-label': 'Back to diary', onClick: () => app.navigate('diary') }, icon('back', { size: 'lg' })), h('div')),
    h('h1', {}, 'Settings'),
    h('div', { class: 'section' }, 'Diary'),
    h('div', { class: 'group' },
      action('Start day of week', weekVal, () => { app.setSettings({ weekStart: app.settings.weekStart ? 0 : 1 }); paint(); }, 'weekStart'),
      soon('Daily reminder', 'reminder'),
      soon('Diary lock', 'lock'),
      soon('Backup / restore', 'backup')),
    h('div', { class: 'section' }, 'Paintings'),
    paintings,
    h('div', { class: 'section' }, 'Account'),
    h('div', { class: 'group' },
      h('button', { class: 'row action', 'data-account-row': '', onClick: () => app.navigate('account') }, lead('Account', 'account'), h('span', { class: 'row-end' }, accountVal, icon('forward', { size: 'sm', tone: 'subtle' })))),
    h('div', { class: 'section' }, 'About'),
    h('div', { class: 'group' },
      soon('Rate Sonmira', 'rate'),
      link('Privacy policy', () => app.navigate('legal', { doc: 'privacy' }), 'privacy'),
      link('Terms', () => app.navigate('legal', { doc: 'terms' }), 'terms')),
    b.simulated ? h('div', { class: 'section' }, 'Development · purchase simulation') : null,
    b.simulated ? devGroup : null,
    h('div', { class: 'foot' }, 'Recordings stay on this device.'));

  paint();
  const off = b.onChange(paint);
  return { el, destroy: off };
}

// The paywall: a quiet sheet that rises over the diary (or over a take that
// is waiting to be painted) when there is nothing left to paint with.
// The diary stays where it is underneath; closing the sheet changes nothing.

import { h } from '../ui/dom.js';
import { illustration } from '../ui/illustration.js';
import { DEFAULT_PRODUCT } from '../billing/products.js';
import { openLayer } from './layer.js';
import { openLegalSheet } from './legal-sheet.js';
import { balanceLabel, renewalLabel } from './copy.js';

const WHY = [
  'Each painting is made just for you, using AI that costs something to run. Your support helps us cover creation costs, care for Sonmira, and keep making it better.',
  'We only charge for new paintings. Everything you’ve already made stays yours to revisit, listen to and share, whatever you choose.',
];

const ERRORS = {
  network: 'We couldn’t reach the App Store. Check your connection and try again. Nothing was charged.',
  failed: 'The purchase didn’t go through, and nothing was charged. You can try again.',
  notAllowed: 'Purchases are turned off on this device. You can change this in Screen Time settings.',
  appOnly: 'Purchases are made in the Sonmira app for iPhone. Nothing was charged.',
  restoreNetwork: 'We couldn’t reach the App Store to restore. Check your connection and try again.',
};

/**
 * @param {any} app
 * @param {{ from?: 'diary' | 'sing' | 'settings', onContinue?: () => void }} opts
 *   onContinue runs when the person chooses to go on creating after a purchase.
 */
export function openPaywall(app, { from = 'diary', onContinue } = {}) {
  const b = app.billing;
  const start = b.status();
  // A subscriber who has used today's painting can only add a pack today.
  const extraToday = start.subscribed && start.dailyUsedToday;
  const plans = b.products.filter((p) => !extraToday || p.kind === 'consumable');
  let selected = plans.some((p) => p.id === DEFAULT_PRODUCT) ? DEFAULT_PRODUCT : plans[0].id;
  let busy = false, done = false, waiting = false;

  const layer = openLayer(app, {
    label: 'More paintings', cls: 'paywall', dismissable: () => !busy,
    onClose: () => { off(); app.paywallOpen = null; },
  });
  layer.panel.dataset.paywall = '';
  app.paywallOpen = layer;

  // ── choose ───────────────────────────────────────────────────────────────
  const message = h('div', { class: 'share-message pw-message', role: 'status' });
  const cta = h('button', { class: 'pill', onClick: () => (waiting ? layer.close() : buy()) });
  const fine = h('p', { class: 'pw-fine' });
  const planEls = plans.map((p) => {
    const mark = h('span', { class: 'pw-mark', 'aria-hidden': 'true' });
    const el = h('button', { class: 'pw-plan', role: 'radio', 'data-plan': p.id, onClick: () => { if (!busy) { selected = p.id; say(''); paint(); } } },
      mark,
      h('span', { class: 'pw-plan-text' }, h('span', { class: 'serif pw-plan-name' }, p.name), h('span', { class: 'pw-plan-blurb' }, p.blurb)),
      h('span', { class: 'serif pw-price' }, b.price(p.id), p.period ? h('span', { class: 'pw-per' }, ` / ${p.period}`) : null));
    return { p, el };
  });

  const lede = extraToday
    ? 'Daily Ritual brings a new one tomorrow. If today asks for more, you can add a few paintings.'
    : start.purchased
      ? 'Your diary is just as you left it. Choose how you’d like to keep creating.'
      : 'Your first three paintings are on us. Choose how you’d like to keep creating.';

  const choose = h('div', { class: 'pw-choose' },
    h('h2', { class: 'serif pw-title' }, extraToday ? 'Today’s painting is made.' : 'More moments to keep.'),
    h('p', { class: 'pw-lede' }, lede),
    h('div', { class: 'pw-plans', role: 'radiogroup', 'aria-label': 'Ways to keep creating' }, planEls.map((x) => x.el)),
    extraToday ? h('p', { class: 'pw-plan-note' }, `Your Daily Ritual · ${renewalLabel(start.sub)}`) : null,
    h('div', { class: 'pw-cta' }, cta, message),
    fine,
    h('div', { class: 'pw-links' },
      h('button', { class: 'pw-link', onClick: restore }, 'Restore purchases'),
      h('span', { 'aria-hidden': 'true' }, '·'),
      h('button', { class: 'pw-link', 'data-more-info': '', onClick: () => openMoreInfo(app, b) }, 'More information')),
    b.simulated ? h('div', { class: 'pw-dev' }, 'Development build · purchases are simulated') : null);
  layer.body.append(choose);

  function paint() {
    for (const { p, el } of planEls) {
      el.setAttribute('aria-checked', String(p.id === selected));
      el.classList.toggle('on', p.id === selected);
      el.disabled = busy;
    }
    const p = plans.find((x) => x.id === selected);
    const price = b.price(p.id);
    cta.disabled = busy;
    if (!busy && !waiting) cta.textContent = p.kind === 'subscription' ? `Start Daily Ritual · ${price} / month` : `Add 10 paintings · ${price}`;
    // The recurring-charge terms stay here, next to the button; the rest is in More information.
    fine.textContent = p.kind === 'subscription'
      ? `${price} a month, renewing automatically until you cancel. Cancel anytime in your Apple ID settings, at least 24 hours before it renews.`
      : `A one-time purchase. Your ${p.credits} paintings never expire.`;
  }
  const say = (t, tone = '') => { message.textContent = t || ''; message.dataset.tone = tone; };
  const working = (label) => { busy = true; paint(); cta.textContent = label; say(''); };
  const idle = () => { busy = false; paint(); };

  async function buy() {
    if (busy || done) return;
    const id = selected;
    working('Opening the App Store…');
    try {
      const r = await b.purchase(id);
      if (layer.closed) return;
      idle();
      if (r.status === 'success') return success(r.product, r.simulated);
      if (r.status === 'pending') return pending(r.product);
      // Cancelled: back to the choice as it was, without a word.
    } catch (e) {
      if (layer.closed) return;
      idle();
      say(ERRORS[e?.kind] || ERRORS.failed, 'error');
    }
  }

  async function restore() {
    if (busy || done) return;
    working('Restoring…');
    try {
      const r = await b.restore();
      if (layer.closed) return;
      idle();
      const s = b.status();
      if (s.canCreate) {
        done = true;
        return showDone({
          title: r.subscription ? 'Your Daily Ritual is back.' : 'Your paintings are back.',
          lede: `${balanceLabel(s)}. Your diary is just as you left it.`,
          simulated: b.simulated,
        });
      }
      say(r.subscription ? 'Daily Ritual is restored. Today’s painting is already made; a new one comes tomorrow.' : 'There’s nothing to restore for this Apple ID.');
    } catch (e) {
      if (layer.closed) return;
      idle();
      if (e?.kind !== 'userCancelled') say(e?.kind === 'appOnly' ? ERRORS.appOnly : ERRORS.restoreNetwork, 'error');
    }
  }

  function pending(product) {
    say(`Waiting for approval. ${product.kind === 'subscription' ? 'Daily Ritual starts' : 'Your paintings are added'} as soon as it’s approved, and nothing is charged until then.`);
    waiting = true;
    cta.textContent = 'Done';
    if (b.simulated) {
      message.append(' ', h('button', { class: 'pw-link pw-sim-approve', onClick: () => b.dev.approvePending() }, 'Approve as the parent (simulation)'));
    }
  }

  // An approval (Ask to Buy) or other transaction arriving while open.
  const off = b.onChange((ev) => {
    if (ev.type === 'transaction' && ev.product && !layer.closed && !done) success(ev.product, ev.simulated);
  });

  // ── success ──────────────────────────────────────────────────────────────
  function success(product, simulated) {
    done = true;
    const sub = product.kind === 'subscription';
    showDone({
      title: sub ? 'Your Daily Ritual begins.' : 'Ten more moments.',
      lede: sub
        ? 'One painting each day, starting today. It renews monthly until you cancel.'
        : `${product.credits} paintings added. They’re yours whenever you like.`,
      simulated,
    });
  }

  function showDone({ title, lede: text, simulated }) {
    const go = h('button', { class: 'pill', onClick: () => { layer.close(); onContinue?.(); } }, from === 'sing' ? 'Create painting' : 'Sing a moment');
    layer.body.replaceChildren(h('div', { class: 'pw-done', 'data-paywall-done': '' },
      illustration('drops'),
      h('h2', { class: 'serif pw-title' }, title),
      h('p', { class: 'pw-lede' }, text),
      simulated ? h('div', { class: 'pw-dev' }, 'Simulated purchase · nothing was charged') : null,
      h('div', { class: 'actions' }, go, h('button', { class: 'quiet-btn', onClick: () => layer.close() }, from === 'diary' ? 'Back to diary' : 'Not now'))));
  }

  paint();
  return layer;
}

// More information: why Sonmira charges, the purchase details in full, and
// Terms and Privacy, in a sheet over the paywall (the legal sheets open over it).
function openMoreInfo(app, b) {
  const sub = b.products.find((p) => p.kind === 'subscription');
  const pack = b.products.find((p) => p.kind === 'consumable');
  const layer = openLayer(app, { label: 'More information', title: 'More information', cls: 'pw-info' });
  const section = (title, ...paras) => h('section', { class: 'pw-info-section' }, h('h3', { class: 'caps' }, title), paras.filter(Boolean).map((t) => h('p', {}, t)));
  layer.body.append(
    section('Why we charge', ...WHY),
    section('About purchases',
      sub ? `${sub.name}: ${b.price(sub.id)} a month, renewing automatically until you cancel. Payment is charged to your Apple ID when you confirm. Cancel anytime in your Apple ID settings, at least 24 hours before it renews. One painting a day; unused days don’t carry over. Cancelling never touches your diary.` : null,
      pack ? `${pack.name}: ${b.price(pack.id)}, a one-time purchase. Your ${pack.credits} paintings never expire, and one is used only when a painting is made.` : null,
      'Restore purchases brings back what you’ve bought with this Apple ID.'),
    h('div', { class: 'pw-links pw-info-links' },
      h('button', { class: 'pw-link', onClick: () => openLegalSheet(app, 'terms') }, 'Terms'),
      h('span', { 'aria-hidden': 'true' }, '·'),
      h('button', { class: 'pw-link', onClick: () => openLegalSheet(app, 'privacy') }, 'Privacy')));
  return layer;
}

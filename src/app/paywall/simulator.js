// Development-only purchase simulator. It stands where Apple's purchase sheet
// will be and lets a tester pick what the App Store answers. It never takes
// money, and it looks like a developer tool on purpose so nobody mistakes it
// for a real payment.

import { h } from '../ui/dom.js';
import { openLayer } from './layer.js';

const PURCHASE = [
  ['success', 'Purchase succeeds'],
  ['cancel', 'Cancelled by the buyer'],
  ['pending', 'Waiting for approval (Ask to Buy)'],
  ['failed', 'Payment fails'],
  ['network', 'No connection'],
];
const RESTORE = [
  ['success', 'Restore succeeds'],
  ['cancel', 'Cancelled at Apple ID sign-in'],
  ['network', 'No connection'],
];

/** @returns {Promise<string>} the outcome the tester picked ('cancel' if dismissed) */
export function askSimulator(app, { kind, product }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => { if (answered) return; answered = true; resolve(v); layer.close(); };
    const layer = openLayer(app, { label: 'Purchase simulation', cls: 'sim-panel', onClose: () => answer('cancel') });
    const price = product ? app.billing.price(product.id) : '';
    layer.body.append(
      h('div', { class: 'sim-tag' }, 'Development only · no real payment'),
      h('div', { class: 'serif sim-title' }, kind === 'restore' ? 'Restore purchases' : product.name),
      h('p', { class: 'sim-lede' }, kind === 'restore'
        ? 'In the app, this is where the App Store checks your Apple ID. Pick what it answers.'
        : `${price}${product.period ? ` / ${product.period}` : ''} · ${product.kind === 'subscription' ? 'auto-renewable subscription' : `${product.credits} paintings, one-time`}. In the app, Apple’s purchase sheet appears here. Nothing is charged in this simulation.`),
      h('div', { class: 'group sim-group' },
        (kind === 'restore' ? RESTORE : PURCHASE).map(([v, label]) =>
          h('button', { class: 'row action', 'data-sim': v, onClick: () => answer(v) }, h('span', {}, label)))));
  });
}

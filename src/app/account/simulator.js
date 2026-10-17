// Development-only Sign in with Apple simulator. It stands where Apple's
// sheet will be and lets a tester pick what Apple (and our server) answer.
// It looks like a developer tool on purpose, like the purchase simulator.

import { h } from '../ui/dom.js';
import { openLayer } from '../paywall/layer.js';

const SIGN_IN = [
  ['new', 'Continue · Apple ID new to Sonmira'],
  ['returning', 'Continue · Apple ID that already has an account'],
  ['cancel', 'Cancelled on Apple’s sheet'],
  ['network', 'No connection'],
  ['notAvailable', 'No Apple ID on this iPhone'],
  ['failed', 'Apple returns an error'],
  ['serverDown', 'Apple says yes, Sonmira’s server fails'],
];
const CONFIRM = [
  ['same', 'Continue · the signed-in Apple ID'],
  ['other', 'Continue · a different Apple ID'],
  ['cancel', 'Cancelled on Apple’s sheet'],
  ['network', 'No connection'],
];

/** @returns {Promise<string>} the outcome picked ('cancel' if dismissed) */
export function askAppleSimulator(app, { purpose }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => { if (answered) return; answered = true; resolve(v); layer.close(); };
    const layer = openLayer(app, { label: 'Sign in with Apple simulation', cls: 'sim-panel', onClose: () => answer('cancel') });
    const confirm = purpose === 'confirm';
    layer.body.append(
      h('div', { class: 'sim-tag' }, 'Development only · not Apple'),
      h('div', { class: 'serif sim-title' }, confirm ? 'Confirm with Apple' : 'Sign in with Apple'),
      h('p', { class: 'sim-lede' }, confirm
        ? 'In the app, Apple’s sheet asks for Face ID before the account is deleted. Pick what it answers.'
        : 'In the app, Apple’s sheet appears here, asking for no name and no email. Pick what it answers.'),
      h('div', { class: 'group sim-group' },
        (confirm ? CONFIRM : SIGN_IN).map(([v, label]) =>
          h('button', { class: 'row action', 'data-sim-apple': v, onClick: () => answer(v) }, h('span', {}, label)))));
  });
}

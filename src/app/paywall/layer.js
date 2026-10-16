// A bottom sheet in the Share sheet's style (scrim, paper panel, slide up).
// Used by the paywall, the purchase simulator and the legal sheet.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/**
 * @param {any} app
 * @param {{ label: string, title?: any, cls?: string, onClose?: () => void, dismissable?: () => boolean }} opts
 */
export function openLayer(app, { label, title = null, cls = '', onClose, dismissable = () => true }) {
  let closed = false;
  const body = h('div', { class: 'layer-body' });
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => dismissable() && close() }, icon('close'));
  const panel = h('div', { class: `share-panel ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
    h('div', { class: 'share-head' }, title ? h('span', { class: 'serif share-title' }, title) : h('span'), closeBtn),
    body);
  const el = h('div', { class: 'share-layer' }, h('div', { class: 'share-scrim', onClick: () => dismissable() && close() }), panel);
  app.root.append(el);

  function close() {
    if (closed) return;
    closed = true;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
    onClose?.();
  }
  return { el, panel, body, closeBtn, close, get closed() { return closed; } };
}

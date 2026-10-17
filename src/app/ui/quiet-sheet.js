// A small bottom sheet in the Share sheet's look (same classes and motion):
// a title, any content, and a close button. The title row stays fixed while
// the content scrolls. Used by the invitation prompt
// and the unfinished-paintings list.

import { h } from './dom.js';
import { icon } from './icons.js';

/** @returns {{ panel: HTMLElement, close: () => void }} */
export function openQuietSheet(app, { title, label = title, onClose = () => {} }, ...content) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
    onClose();
  };
  // The title and Close stay put; only the content under them scrolls.
  const panel = h('div', { class: 'share-panel quiet-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
    h('div', { class: 'share-head' }, h('span', { class: 'serif share-title' }, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: close }, icon('close'))),
    h('div', { class: 'sheet-scroll' }, ...content));
  const el = h('div', { class: 'share-layer', 'data-sheet': '' }, h('div', { class: 'share-scrim', onClick: close }), panel);
  app.root.append(el);
  return { panel, close };
}

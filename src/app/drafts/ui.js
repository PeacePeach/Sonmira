// Draft recovery, kept quiet: one line at the top of the diary when
// paintings are waiting, and a sheet listing them with Open and Discard.
// Drafts are never shown among diary entries.

import { h } from '../ui/dom.js';
import { createPainting } from '../ui/painting.js';
import { openQuietSheet } from '../ui/quiet-sheet.js';
import { clock, monthDay } from '../format.js';

const STATUS = {
  ready: 'Painted · not kept yet',
  painting: 'Waiting for its painting',
  failed: 'Waiting for its painting',
};

/** The diary line. Updates itself when drafts change; el is empty when there are none. */
export function mountDraftsRow(app) {
  const el = h('div', { 'data-drafts': '' });
  let n = 0;
  async function refresh() {
    try { n = (await app.drafts.list()).length; } catch { n = 0; }
    el.replaceChildren(...(n ? [h('button', { class: 'drafts-row', onClick: () => openDraftsSheet(app) },
      h('span', {}, n === 1 ? 'One painting is waiting for you.' : `${n} paintings are waiting for you.`),
      h('span', { class: 'drafts-open' }, 'Open'))] : []));
  }
  injectStyle();
  const off = app.drafts.onChange(refresh);
  refresh();
  return { el, refresh, destroy: off };
}

export async function openDraftsSheet(app) {
  const items = await app.drafts.list();
  const paintings = [];
  const list = h('div', { class: 'drafts-list' });
  const sheet = openQuietSheet(app, { title: 'Not kept yet', label: 'Unfinished paintings', onClose: () => paintings.forEach((p) => p.destroy()) },
    h('p', { class: 'drafts-lede' }, 'These stay only on this device until you keep them in your diary or discard them.'),
    list);

  for (const d of items) {
    const p = createPainting({ ratio: '32', strokes: d.painting?.wash ?? d.analysis?.wash ?? [], artwork: d.painting?.artwork ?? null, lazy: true });
    paintings.push(p);
    let armed = false;
    const discard = h('button', { class: 'text-btn', onClick: async () => {
      if (!armed) { armed = true; discard.textContent = 'Discard for good'; discard.classList.add('armed'); return; }
      await app.drafts.discard(d.key);
      item.remove();
      if (!list.children.length) sheet.close();
    } }, 'Discard');
    const item = h('div', { class: 'draft-item', 'data-draft': d.key },
      h('button', { class: 'draft-open', 'aria-label': 'Open this painting', onClick: () => { sheet.close(); app.navigate('sing', { draft: d.key }); } },
        p.el,
        h('div', { class: 'entry-meta' },
          h('span', { class: 'cap' + (d.note ? '' : ' untitled') }, d.note || (d.date ? monthDay(d.date) : 'Untitled')),
          h('span', { class: 'dur tabular' }, clock(d.durationSec || 0)))),
      h('div', { class: 'draft-foot' },
        h('span', { class: 'caps' }, STATUS[d.status] ?? STATUS.painting),
        discard));
    list.append(item);
  }
  return sheet;
}

let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  document.head.append(h('style', {}, `
.drafts-row { display: flex; justify-content: center; gap: 8px; align-items: baseline; width: calc(100% - 56px); margin: 18px 28px 0; font-size: 13px; color: var(--secondary); line-height: 1.5; text-align: center; }
.drafts-row .drafts-open { color: var(--ink); text-decoration: underline; text-decoration-color: var(--underline); text-underline-offset: 3px; }
.drafts-lede { font-size: 14px; color: var(--secondary); line-height: 1.55; margin: 6px 0 14px; text-wrap: pretty; }
.drafts-list { display: flex; flex-direction: column; gap: 22px; padding-bottom: 8px; }
.draft-open { display: block; width: 100%; text-align: left; }
.draft-foot { display: flex; justify-content: space-between; align-items: center; padding: 2px 4px 0; }
.draft-foot .text-btn { padding: 0; margin-right: -4px; }
.draft-foot .text-btn.armed { color: var(--ink); }
`));
}

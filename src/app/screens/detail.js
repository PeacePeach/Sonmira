// Painting (detail): the saved watercolor, its note and the original audio.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createPainting } from '../ui/painting.js';
import { createPlayer } from '../ui/player.js';
import { clock, longDate } from '../format.js';
import { openShareSheet } from '../share/sheet.js';

export function mountDetail(app, { id }) {
  const e = app.entries.find((x) => x.id === id);
  if (!e) { queueMicrotask(() => app.navigate('diary')); return { el: h('div') }; }

  const painting = createPainting({ ratio: '45', strokes: e.painting?.wash, artwork: e.painting?.artwork, useFocus: false });
  const voice = e.painting?.interpretation?.voiceLabel;
  const player = createPlayer({ blob: e.audio, durationSec: e.durationSec, right: e.audio ? (voice ? `${clock(e.durationSec)} · ${voice}` : clock(e.durationSec)) : 'No recording saved' });

  let confirmT = null, sheet = null;
  const del = h('button', { class: 'text-btn', onClick: onDelete }, 'Delete');
  async function onDelete() {
    if (!del.classList.contains('confirm')) {
      del.classList.add('confirm'); del.textContent = 'Delete this painting?';
      confirmT = setTimeout(() => { del.classList.remove('confirm'); del.textContent = 'Delete'; }, 3500);
      return;
    }
    clearTimeout(confirmT);
    try { await app.deleteEntry(e.id); app.navigate('diary'); }
    catch { app.toast('Couldn’t delete it just now. Please try again.'); }
  }

  const el = h('div', { class: 'detail', 'data-screen': 'detail' },
    h('div', { class: 'navrow' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to diary', onClick: () => app.navigate('diary') }, icon('back', { size: 'lg' })),
      h('div', { class: 'nav-actions' },
        h('button', { class: 'icon-btn', 'aria-label': 'Share', onClick: () => { player.stop(); sheet = openShareSheet(app, { painting: e.painting, note: e.note, date: e.date, audio: e.audio, durationSec: e.durationSec }); } }, icon('share')),
        del)),
    h('div', { class: 'art-pad' }, painting.el),
    h('div', { class: 'body' },
      h('div', { class: 'caps' }, longDate(e.date)),
      h('div', { class: 'caption serif' + (e.note ? '' : ' untitled') }, e.note || 'Untitled'),
      player.el));

  app.dev.onArtworkOpen?.(e); // ?dev panel only
  return { el, destroy() { app.dev.onArtworkClose?.(e); sheet?.close(); clearTimeout(confirmT); player.destroy(); painting.destroy(); } };
}

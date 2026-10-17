// Painting (detail): the saved watercolor, its note and the original audio.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createPainting } from '../ui/painting.js';
import { createPlayer } from '../ui/player.js';
import { clock, longDate } from '../format.js';
import { openShareSheet } from '../share/sheet.js';

export function mountDetail(app, { id }) {
  let e = app.entries.find((x) => x.id === id);
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

  // The title is the entry's note. Tapping it (or its pencil) edits it in place:
  // Done or Save keeps it, Cancel or Escape leaves it as it was. A cleared title
  // reads Untitled, as it does for a painting kept without a note.
  const title = h('div', { class: 'detail-title' });
  function showTitle() {
    const shown = e.note || 'Untitled';
    title.replaceChildren(h('button', { class: 'title-btn', 'aria-label': `${shown}. Rename`, onClick: editTitle },
      h('span', { class: 'caption serif' + (e.note ? '' : ' untitled') }, shown),
      icon('rename', { size: 'sm', tone: 'muted' })));
  }
  function editTitle() {
    let saving = false;
    const fit = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`; };
    const input = h('textarea', {
      class: 'caption-input', placeholder: 'What was this moment?', maxlength: '140', rows: '1',
      'aria-label': 'Title of this painting', enterkeyhint: 'done',
      onInput: () => { if (/[\r\n]/.test(input.value)) input.value = input.value.replace(/\s*[\r\n]+\s*/g, ' '); fit(); },
      onKeydown: (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); save(); }
        else if (ev.key === 'Escape' && !saving) { ev.preventDefault(); showTitle(); }
      },
    });
    input.value = e.note || '';
    const cancelBtn = h('button', { class: 'text-btn', onClick: () => { if (!saving) showTitle(); } }, 'Cancel');
    const saveBtn = h('button', { class: 'text-btn save', onClick: save }, 'Save');
    const busy = (on) => { saving = on; input.readOnly = on; cancelBtn.disabled = saveBtn.disabled = on; saveBtn.textContent = on ? 'Saving…' : 'Save'; };
    title.replaceChildren(input, h('div', { class: 'title-actions' }, cancelBtn, saveBtn));
    requestAnimationFrame(fit);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    async function save() {
      if (saving) return;
      const note = input.value.trim();
      if (note === (e.note || '')) { showTitle(); return; }
      busy(true);
      try {
        const next = { ...e, note };
        await app.updateEntry(next);
        e = next;
        showTitle();
      } catch {
        busy(false);
        app.toast('Couldn’t save the title just now. Please try again.');
        input.focus();
      }
    }
  }
  showTitle();

  const el = h('div', { class: 'detail', 'data-screen': 'detail' },
    h('div', { class: 'navrow' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to diary', onClick: () => app.navigate('diary') }, icon('back', { size: 'lg' })),
      h('div', { class: 'nav-actions' },
        h('button', { class: 'icon-btn', 'aria-label': 'Share', onClick: () => { player.stop(); sheet = openShareSheet(app, { painting: e.painting, note: e.note, date: e.date, audio: e.audio, durationSec: e.durationSec }); } }, icon('share')),
        del)),
    h('div', { class: 'art-pad' }, painting.el),
    h('div', { class: 'body' },
      h('div', { class: 'caps' }, longDate(e.date)),
      title,
      player.el));

  app.dev.onArtworkOpen?.(e); // ?dev panel only
  return { el, destroy() { app.dev.onArtworkClose?.(e); sheet?.close(); clearTimeout(confirmT); player.destroy(); painting.destroy(); } };
}

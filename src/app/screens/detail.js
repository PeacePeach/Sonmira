// Painting (detail): the saved watercolor, its title, its optional journal
// and the original audio. The title and the journal are each edited in place.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createPainting } from '../ui/painting.js';
import { createPlayer } from '../ui/player.js';
import { clock, longDate } from '../format.js';
import { openShareSheet } from '../share/sheet.js';
import { titleField, journalField, JOURNAL_PLACEHOLDER } from '../ui/text-field.js';

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
  // Saves one field of the entry; false (and a toast) if it couldn't be written.
  async function saveField(patch, failMsg) {
    try {
      const next = { ...e, ...patch };
      await app.updateEntry(next);
      e = next;
      return true;
    } catch {
      app.toast(failMsg);
      return false;
    }
  }

  // Cancel / Save under a field being edited, with the saving state.
  function editActions(field, { cancel, save }) {
    const cancelBtn = h('button', { class: 'text-btn', onClick: () => { if (!field.readOnly) cancel(); } }, 'Cancel');
    const saveBtn = h('button', { class: 'text-btn save', onClick: save }, 'Save');
    const busy = (on) => { field.readOnly = on; cancelBtn.disabled = saveBtn.disabled = on; saveBtn.textContent = on ? 'Saving…' : 'Save'; };
    return { el: h('div', { class: 'title-actions' }, cancelBtn, saveBtn), busy };
  }

  function editTitle() {
    let saving = false;
    const f = titleField({ value: e.note || '', onEnter: () => save(), onEscape: () => { if (!saving) showTitle(); } });
    const input = f.input;
    const acts = editActions(input, { cancel: showTitle, save: () => save() });
    title.replaceChildren(f.el, acts.el);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    async function save() {
      if (saving) return;
      const note = input.value.trim();
      if (note === (e.note || '')) { showTitle(); return; }
      saving = true; acts.busy(true);
      if (await saveField({ note }, 'Couldn’t save the title just now. Please try again.')) { showTitle(); return; }
      saving = false; acts.busy(false);
      input.focus();
    }
  }

  showTitle();

  // The journal: its paragraphs as written, or a quiet invitation to write
  // one (entries kept before the journal existed have none). Tapping edits it.
  const journal = h('div', { class: 'detail-journal' });
  function showJournal() {
    const text = e.journal || '';
    journal.replaceChildren(text
      ? h('button', { class: 'journal-btn', 'aria-label': 'Edit journal', onClick: editJournal }, h('p', { class: 'journal-text' }, text))
      : h('button', { class: 'journal-btn journal-empty', onClick: editJournal }, JOURNAL_PLACEHOLDER));
  }
  function editJournal() {
    let saving = false;
    const f = journalField({ value: e.journal || '', onEscape: () => { if (!saving) showJournal(); } });
    const input = f.input;
    const acts = editActions(input, { cancel: showJournal, save });
    journal.replaceChildren(input, acts.el);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    async function save() {
      if (saving) return;
      const text = input.value.trim();
      if (text === (e.journal || '')) { showJournal(); return; }
      saving = true; acts.busy(true);
      if (await saveField({ journal: text }, 'Couldn’t save the journal just now. Please try again.')) { showJournal(); return; }
      saving = false; acts.busy(false);
      input.focus();
    }
  }
  showJournal();

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
      journal,
      player.el));

  app.dev.onArtworkOpen?.(e); // ?dev panel only
  return { el, destroy() { app.dev.onArtworkClose?.(e); sheet?.close(); clearTimeout(confirmT); player.destroy(); painting.destroy(); } };
}

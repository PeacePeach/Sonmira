// Painting (detail): the saved watercolor, its date, title, optional journal
// and the original audio, in three states:
//
//   expanded  the artwork large, as it was made (the default)
//   compact   scrolling into the journal turns the artwork into a landscape
//             card; the artwork, date and title stay put and only the journal
//             scrolls. Pulling down at the journal's top brings it back.
//   edit      Edit (or tapping the title or journal) opens both fields at
//             once, in the compact layout, with the creation flow's own title
//             and journal fields; Save keeps them together.
//
// The player is docked at the bottom throughout and is never re-created, so
// the recording plays on through every change of state. The artwork moves
// between its sizes with the creation flow's morph (ui/morph.js).

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createPainting } from '../ui/painting.js';
import { createPlayer } from '../ui/player.js';
import { morph, MORPH_MS } from '../ui/morph.js';
import { clock, longDate } from '../format.js';
import { openShareSheet } from '../share/sheet.js';
import { titleField, journalField, JOURNAL_PLACEHOLDER } from '../ui/text-field.js';
import { scrollIntent } from './detail-scroll.js';

export function mountDetail(app, { id }) {
  let e = app.entries.find((x) => x.id === id);
  if (!e) { queueMicrotask(() => app.navigate('diary')); return { el: h('div') }; }

  const painting = createPainting({ ratio: '45', strokes: e.painting?.wash, artwork: e.painting?.artwork, useFocus: false });
  const voice = e.painting?.interpretation?.voiceLabel;
  const player = createPlayer({ blob: e.audio, durationSec: e.durationSec, right: e.audio ? (voice ? `${clock(e.durationSec)} · ${voice}` : clock(e.durationSec)) : 'No recording saved' });

  let mode = 'expanded';
  let fields = null; // { title, journal } while editing
  let saving = false;

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
  // While editing the top bar reads Cancel · Delete · Save: Cancel takes
  // Back's place, Share steps aside, and Edit becomes Save in the same place.
  const editBtn = h('button', { class: 'text-btn edit-btn', onClick: () => (mode === 'edit' ? save() : edit('title')) }, 'Edit');

  // The title (Untitled when there is none) and the journal (its paragraphs
  // as written, or a quiet invitation to write one). Tapping either edits.
  const title = h('div', { class: 'detail-title' });
  function showTitle() {
    const shown = e.note || 'Untitled';
    title.replaceChildren(h('button', { class: 'title-btn', 'aria-label': `${shown}. Edit`, onClick: () => edit('title') },
      h('span', { class: 'caption serif' + (e.note ? '' : ' untitled') }, shown)));
  }
  const journal = h('div', { class: 'detail-journal' });
  function showJournal() {
    const text = e.journal || '';
    journal.replaceChildren(text
      ? h('button', { class: 'journal-btn', 'aria-label': 'Edit journal', onClick: () => edit('journal') }, h('p', { class: 'journal-text' }, text))
      : h('button', { class: 'journal-btn journal-empty', onClick: () => edit('journal') }, JOURNAL_PLACEHOLDER));
  }
  showTitle();
  showJournal();

  const backBtn = h('button', { class: 'icon-btn', 'aria-label': 'Back to diary', onClick: () => app.navigate('diary') }, icon('back', { size: 'lg' }));
  const cancelBtn = h('button', { class: 'text-btn cancel-btn', hidden: true, onClick: () => cancel() }, 'Cancel');
  const shareBtn = h('button', { class: 'icon-btn', 'aria-label': 'Share', onClick: () => { player.stop(); sheet = openShareSheet(app, { painting: e.painting, note: e.note, date: e.date, audio: e.audio, durationSec: e.durationSec }); } }, icon('share'));
  const meta = h('div', { class: 'detail-meta' }, h('div', { class: 'caps' }, longDate(e.date)), title);
  const scroll = h('div', { class: 'detail-scroll' }, journal);
  const el = h('div', { class: 'detail', 'data-screen': 'detail', 'data-mode': mode },
    h('div', { class: 'navrow' },
      backBtn, cancelBtn,
      h('div', { class: 'nav-actions' }, shareBtn, del, editBtn)),
    h('div', { class: 'art-pad' }, painting.el),
    meta,
    scroll,
    h('div', { class: 'detail-dock' }, player.el));

  // ── layout ────────────────────────────────────────────────────────────────
  let lockedUntil = 0; // no new layout change while the artwork is moving
  function setMode(next) {
    mode = next;
    const compact = next !== 'expanded';
    el.dataset.mode = next;
    el.classList.toggle('compact', compact);
    el.classList.toggle('editing', next === 'edit');
    painting.el.classList.toggle('r45', !compact);
    painting.el.classList.toggle('r32', compact);
    // The landscape card opens the portrait artwork again.
    if (next === 'compact') { painting.el.setAttribute('role', 'button'); painting.el.tabIndex = 0; painting.el.setAttribute('aria-label', 'View the painting'); }
    else { painting.el.removeAttribute('role'); painting.el.removeAttribute('tabindex'); painting.el.removeAttribute('aria-label'); }
  }
  // Moves to a state; the artwork morphs when its size changes, and the
  // date, title and journal glide with it.
  function go(next, apply = () => {}) {
    const resize = (mode === 'expanded') !== (next === 'expanded');
    if (!resize) { setMode(next); apply(); return; }
    lockedUntil = performance.now() + MORPH_MS;
    if (next === 'expanded') scroll.scrollTop = 0;
    restingSince = performance.now();
    morph(painting.el, () => { setMode(next); apply(); }, { follow: [meta, scroll] });
  }
  const collapse = () => { if (mode === 'expanded') go('compact'); };
  const expand = () => { if (mode === 'compact') go('expanded'); };
  setMode('expanded');

  const openArt = (ev) => {
    if (mode !== 'compact') return;
    if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    expand();
  };
  painting.el.addEventListener('click', openArt);
  painting.el.addEventListener('keydown', openArt);

  // ── scroll gestures: wheel / trackpad, touch, keys ──────────────────────
  // In the expanded state nothing scrolls: a gesture toward the journal turns
  // the page compact, and the journal takes the rest of it. In the compact
  // state the journal scrolls (also when the gesture starts on the artwork or
  // title), and a fresh pull past its top expands the artwork again.
  const atTop = () => scroll.scrollTop <= 0;
  // Since when the journal has rested at its top. A gesture counts as
  // starting there only after a moment's rest, so the one that scrolled it
  // up (even a single wheel notch, scrolled before its event arrives) can't
  // also expand the artwork.
  let restingSince = performance.now();
  scroll.addEventListener('scroll', () => { restingSince = atTop() ? (restingSince ?? performance.now()) : null; }, { passive: true });
  const rested = () => atTop() && restingSince != null && performance.now() - restingSince > 200;
  const decide = (travel, startedAtTop) => {
    if (performance.now() < lockedUntil) return false;
    const intent = scrollIntent({ mode, travel, startedAtTop, atTop: atTop() });
    if (intent === 'collapse') collapse();
    else if (intent === 'expand') expand();
    return !!intent;
  };

  let wheel = { last: 0, travel: 0, startedAtTop: false };
  function onWheel(ev) {
    if (ev.ctrlKey) return; // pinch zoom
    const now = performance.now();
    if (now - wheel.last > 220) wheel = { last: now, travel: 0, startedAtTop: rested() }; // a new gesture
    wheel.last = now;
    const dy = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? scroll.clientHeight : 1);
    if (mode !== 'expanded' && !scroll.contains(ev.target)) scroll.scrollTop += dy;
    wheel.travel += dy;
    if (decide(wheel.travel, wheel.startedAtTop)) wheel.travel = 0;
  }

  let touch = null;
  function onTouchStart(ev) {
    if (ev.touches.length !== 1) { touch = null; return; }
    touch = { y: ev.touches[0].clientY, startedAtTop: rested(), inScroll: scroll.contains(ev.target), from: scroll.scrollTop, done: false };
  }
  function onTouchMove(ev) {
    if (!touch || ev.touches.length !== 1) return;
    const travel = touch.y - ev.touches[0].clientY;
    if (!touch.done && decide(travel, touch.startedAtTop)) { touch.done = true; return; }
    // A drag on the fixed artwork or title scrolls the journal too.
    if (mode !== 'expanded' && !touch.inScroll && !touch.done) { scroll.scrollTop = touch.from + travel; ev.preventDefault(); }
  }

  const typing = () => /^(TEXTAREA|INPUT)$/.test(document.activeElement?.tagName || '');
  function onKey(ev) {
    if (typing() || ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey || app.root.querySelector('.share-layer')) return; // a sheet is open
    if (document.querySelectorAll('[data-screen]').length > 1) return; // mid-navigation
    const down = ev.key === 'ArrowDown' || ev.key === 'PageDown' || (ev.key === ' ' && !ev.shiftKey);
    const up = ev.key === 'ArrowUp' || ev.key === 'PageUp' || ev.key === 'Home' || (ev.key === ' ' && ev.shiftKey);
    if (!down && !up) return;
    if (/^(BUTTON|A)$/.test(document.activeElement?.tagName || '') && ev.key === ' ') return;
    ev.preventDefault();
    if (mode === 'expanded') { if (down) collapse(); return; }
    if (up && atTop()) { decide(-Infinity, true); return; }
    const page = ev.key.startsWith('Page') || ev.key === ' ';
    if (ev.key === 'Home') scroll.scrollTop = 0;
    else scroll.scrollBy?.({ top: (down ? 1 : -1) * (page ? scroll.clientHeight * 0.85 : 48), behavior: 'smooth' });
  }

  el.addEventListener('wheel', onWheel, { passive: true });
  el.addEventListener('touchstart', onTouchStart, { passive: true });
  // Only a drag outside the journal is ever cancelled (it scrolls the
  // journal instead), so only there may touchmove block scrolling; inside
  // it the journal scrolls without waiting for script.
  scroll.addEventListener('touchmove', onTouchMove, { passive: true });
  for (const part of el.children) if (part !== scroll) part.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('keydown', onKey);

  // ── editing ───────────────────────────────────────────────────────────────
  // Both fields at once, the creation flow's own (underlined title held to
  // TITLE_MAX characters with its counter; a borderless multi-line journal).
  // What is typed stays while the keyboard closes and opens again; Save keeps
  // it, Cancel (or Escape) lets it go.
  function edit(focus = 'title') {
    if (mode === 'edit') return;
    const journalF = journalField({ value: e.journal || '', onEscape: () => cancel() });
    const titleF = titleField({ value: e.note || '', enterkeyhint: 'next', onEnter: () => journalF.input.focus(), onEscape: () => cancel() });
    fields = { title: titleF, journal: journalF };
    const top = scroll.scrollTop;
    go('edit', () => { title.replaceChildren(titleF.el); journal.replaceChildren(journalF.el); });
    requestAnimationFrame(() => { scroll.scrollTop = top; }); // after the journal field has grown to its text
    editBtn.textContent = 'Save';
    editBtn.classList.add('save');
    editingBar(true);
    const input = (focus === 'journal' ? journalF : titleF).input;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function editingBar(on) {
    backBtn.hidden = shareBtn.hidden = on;
    cancelBtn.hidden = !on;
  }
  const cancel = () => leave();

  // Back to the compact view, showing what is saved.
  function leave() {
    if (mode !== 'edit' || saving) return;
    fields = null;
    if (el.contains(document.activeElement)) document.activeElement.blur?.();
    editBtn.textContent = 'Edit';
    editBtn.classList.remove('save');
    editingBar(false);
    go('compact', () => { showTitle(); showJournal(); });
    fitKeyboard();
  }

  async function save() {
    if (mode !== 'edit' || saving || !fields) return;
    const note = fields.title.value.trim(), text = fields.journal.value.trim();
    if (note === (e.note || '') && text === (e.journal || '')) { leave(); return; }
    const busy = (on) => {
      saving = on;
      fields.title.input.readOnly = fields.journal.input.readOnly = on;
      editBtn.disabled = cancelBtn.disabled = on;
      editBtn.textContent = on ? 'Saving…' : 'Save';
    };
    busy(true);
    try {
      const next = { ...e, note, journal: text };
      await app.updateEntry(next);
      e = next;
      busy(false);
      leave();
    } catch {
      busy(false);
      app.toast('Couldn’t save just now. Please try again.');
    }
  }

  // ── the on-screen keyboard ──────────────────────────────────────────────
  // While a field is written in on a phone, the page fits the part of the
  // screen above the keyboard, so Save and the field stay in view: the
  // artwork slides up to a sliver under the top bar and the docked player
  // steps aside until the keyboard closes (it keeps playing).
  const vv = globalThis.visualViewport;
  const coarse = !!globalThis.matchMedia?.('(pointer: coarse)').matches;
  let fullH = vv?.height || 0;
  function fitKeyboard() {
    if (!vv || !coarse) return;
    const writing = mode === 'edit' && typing() && el.contains(document.activeElement);
    if (!writing) fullH = vv.height;
    const open = writing && vv.height < fullH * 0.8;
    // the artwork slides up under the top bar, leaving a sliver, so the
    // fields get the room above the keyboard
    if (open) el.style.setProperty('--art-h', `${painting.el.offsetHeight}px`);
    el.classList.toggle('kb', open);
    el.style.top = open ? `${vv.pageTop}px` : '';
    el.style.height = open ? `${vv.height}px` : '';
    el.style.bottom = open ? 'auto' : '';
  }
  vv?.addEventListener('resize', fitKeyboard);
  vv?.addEventListener('scroll', fitKeyboard);
  el.addEventListener('focusin', fitKeyboard);
  el.addEventListener('focusout', () => setTimeout(fitKeyboard, 0));

  app.dev.onArtworkOpen?.(e); // ?dev panel only
  return {
    el,
    destroy() {
      app.dev.onArtworkClose?.(e);
      document.removeEventListener('keydown', onKey);
      vv?.removeEventListener('resize', fitKeyboard);
      vv?.removeEventListener('scroll', fitKeyboard);
      sheet?.close(); clearTimeout(confirmT); player.destroy(); painting.destroy();
    },
  };
}

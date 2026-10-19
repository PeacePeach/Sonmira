// The writing fields shared by Sing (after the painting) and the detail page:
// the title, an underline-only line held to TITLE_MAX characters, and the
// optional journal, an underline-only multi-line field that grows as it fills.
//
// The title limit is enforced in script, not with maxlength: maxlength counts
// UTF-16 units (an emoji counts twice) and Safari cuts Chinese IME text while
// it is still being composed. Here the limit waits for the composition to be
// committed, then counts characters.

import { h } from './dom.js';

export const TITLE_MAX = 30;
export const TITLE_PLACEHOLDER = 'What was this moment?';
export const JOURNAL_PLACEHOLDER = 'Write about this moment...';

const chars = (s) => Array.from(s ?? '');
export const charCount = (s) => chars(s).length;

/**
 * The field's text after an edit, held to `max` characters. What was just
 * inserted (it ends at the caret) is trimmed from its end, so a paste keeps
 * what fits. Text already longer than `max` (a title from before the limit)
 * is kept: it can be shortened, never lengthened.
 * @param {{value: string, caret?: number, prev?: string, max: number}} edit
 * @returns {{value: string, caret: number}}
 */
export function limitEdit({ value, caret = value.length, prev = '', max }) {
  const n = charCount(value);
  const allowed = Math.max(max, charCount(prev));
  if (n <= allowed) return { value, caret };
  const head = chars(value.slice(0, caret));
  const keep = head.slice(0, Math.max(0, head.length - (n - allowed))).join('');
  let out = keep + value.slice(caret);
  if (charCount(out) > allowed) out = chars(out).slice(0, allowed).join('');
  return { value: out, caret: Math.min(keep.length, out.length) };
}

// Grows a textarea to fit its text (the borders included).
const fitTo = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`; };

// Keeps a field in view above the on-screen keyboard while it is written in.
function keepInView(el) {
  let t = null;
  const reveal = () => { clearTimeout(t); t = setTimeout(() => { if (document.activeElement === el) el.scrollIntoView?.({ block: 'nearest' }); }, 280); };
  el.addEventListener('focus', reveal);
  el.addEventListener('input', reveal);
}

/**
 * The title: the existing underline caption input, one paragraph (Enter
 * finishes, pasted line breaks become spaces), with a quiet n/30 counter
 * while it is being edited.
 * @param {{value?: string, label?: string, enterkeyhint?: string, onInput?: (v: string) => void, onEnter?: () => void, onEscape?: () => void}} o
 */
export function titleField({ value = '', label = 'Title of this painting', enterkeyhint = 'done', onInput = () => {}, onEnter = null, onEscape = null } = {}) {
  const count = h('div', { class: 'char-count tabular', id: `cc-${Math.random().toString(36).slice(2, 8)}`, 'aria-hidden': 'true' });
  const input = h('textarea', {
    class: 'caption-input', placeholder: TITLE_PLACEHOLDER, rows: '1', 'aria-label': label,
    'aria-describedby': count.id, enterkeyhint, spellcheck: 'false',
  });
  input.value = value;
  let prev = value, composing = false;
  const paint = () => { count.textContent = `${charCount(input.value)}/${TITLE_MAX}`; };
  const commit = () => {
    if (/[\r\n]/.test(input.value)) input.value = input.value.replace(/\s*[\r\n]+\s*/g, ' ');
    const r = limitEdit({ value: input.value, caret: input.selectionEnd ?? input.value.length, prev, max: TITLE_MAX });
    if (r.value !== input.value) { input.value = r.value; try { input.setSelectionRange(r.caret, r.caret); } catch {} }
    prev = input.value;
    paint(); fitTo(input); onInput(input.value);
  };
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; commit(); });
  input.addEventListener('input', (e) => {
    if (composing || e.isComposing) { paint(); fitTo(input); return; } // committed at compositionend
    commit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // Enter that confirms an IME candidate
    if (e.key === 'Enter') { e.preventDefault(); onEnter ? onEnter() : input.blur(); }
    else if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); }
  });
  keepInView(input);
  paint();
  requestAnimationFrame(() => fitTo(input));
  const el = h('div', { class: 'title-field' }, input, count);
  return { el, input, get value() { return input.value; } };
}

/**
 * The optional journal: several paragraphs, no limit beyond the storage's.
 * @param {{value?: string, label?: string, onInput?: (v: string) => void, onEscape?: () => void}} o
 */
export function journalField({ value = '', label = 'Journal (optional)', onInput = () => {}, onEscape = null } = {}) {
  const input = h('textarea', { class: 'journal-input', placeholder: JOURNAL_PLACEHOLDER, rows: '4', 'aria-label': label, enterkeyhint: 'enter' });
  input.value = value;
  input.addEventListener('input', () => { fitTo(input); onInput(input.value); });
  if (onEscape) input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); onEscape(); } });
  keepInView(input);
  requestAnimationFrame(() => fitTo(input));
  return { el: input, input, get value() { return input.value; } };
}

// In-app banners (Han, 21 Oct): one quiet component for success, information,
// warnings and errors, so every message the app shows looks and behaves the
// same. Not iOS system notifications.
//
//   showBanner(root, 'Signed out. Your diary is still here.', { kind: 'success' })
//
// - Below the top bar, so it never covers the screen's actions (the record
//   button, Save, Create painting) or hides behind the keyboard.
// - One at a time: a new banner replaces the one showing.
// - Its time on screen follows its length, a little longer for warnings and
//   errors; a tap dismisses it sooner.
// - Fades and settles in a few pixels; with Reduce Motion, only fades (styles.css).

import { h } from './dom.js';
import { icon } from './icons.js';

export const BANNER_KINDS = ['success', 'info', 'warning', 'error'];
const ICONS = { success: 'check', info: 'info', warning: 'warning', error: 'error' };
const EXIT_MS = 180;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Time to read it: about 2 s for a few words, at most about 5 s.
export function bannerDuration(msg, kind = 'info') {
  const n = String(msg ?? '').length;
  return kind === 'error' || kind === 'warning' ? clamp(3000 + 30 * n, 3000, 5500) : clamp(2000 + 30 * n, 2000, 5000);
}

let current = null;

export function showBanner(root, msg, { kind = 'info', ms } = {}) {
  if (!BANNER_KINDS.includes(kind)) kind = 'info';
  current?.dismiss(true);
  const urgent = kind === 'error';
  // .toast stays for the tests and anything that looks for the app's message.
  const el = h('div', { class: `banner banner-${kind} toast`, role: urgent ? 'alert' : 'status', 'aria-live': urgent ? 'assertive' : 'polite', 'data-kind': kind },
    icon(ICONS[kind], { size: 'sm', class: 'banner-icon' }), h('span', { class: 'banner-text' }, msg));
  let timer = null, gone = false;
  const handle = {
    el,
    dismiss(now = false) {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      if (current === handle) current = null;
      if (now) { el.remove(); return; }
      el.classList.add('out');
      setTimeout(() => el.remove(), EXIT_MS);
    },
  };
  el.addEventListener('click', () => handle.dismiss());
  current = handle;
  root.append(el);
  timer = setTimeout(() => handle.dismiss(), ms ?? bannerDuration(msg, kind));
  return handle;
}

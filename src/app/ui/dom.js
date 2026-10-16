// Tiny DOM helpers — no framework.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') typeof v === 'string' ? (el.style.cssText = v) : Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

const INK = '#1F1D1A';
export const icons = {
  plus: () => svg(`<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 2v18M2 11h18" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round"/></svg>`),
  calendar: () => svg(`<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="1.5" y="2.5" width="17" height="15.5" rx="2.5" stroke="${INK}" stroke-width="1.3" fill="none"/><path d="M1.5 7h17" stroke="${INK}" stroke-width="1.3"/></svg>`),
  list: () => svg(`<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="1.5" y="2" width="17" height="6.5" rx="2" stroke="${INK}" stroke-width="1.3" fill="none"/><rect x="1.5" y="11.5" width="17" height="6.5" rx="2" stroke="${INK}" stroke-width="1.3" fill="none"/></svg>`),
  dots: () => svg(`<svg width="20" height="4" viewBox="0 0 20 4" aria-hidden="true"><circle cx="2" cy="2" r="1.6" fill="${INK}"/><circle cx="10" cy="2" r="1.6" fill="${INK}"/><circle cx="18" cy="2" r="1.6" fill="${INK}"/></svg>`),
  back: () => svg(`<svg width="10" height="18" viewBox="0 0 10 18" aria-hidden="true"><path d="M9 1L1 9l8 8" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
  prev: () => svg(`<svg width="9" height="16" viewBox="0 0 9 16" aria-hidden="true"><path d="M8 1L1 8l7 7" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
  next: () => svg(`<svg width="9" height="16" viewBox="0 0 9 16" aria-hidden="true"><path d="M1 1l7 7-7 7" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
  close: () => svg(`<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2l12 12M14 2L2 14" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/></svg>`),
  mic: () => svg(`<svg width="22" height="30" viewBox="0 0 22 30" aria-hidden="true"><rect x="6" y="1" width="10" height="18" rx="5" stroke="#FFFFFF" stroke-width="1.5" fill="none"/><path d="M2 14a9 9 0 0018 0M11 23v6" stroke="#FFFFFF" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`),
  play: () => svg(`<svg width="13" height="15" viewBox="0 0 13 15" aria-hidden="true"><path d="M1 1l11 6.5L1 14z" fill="${INK}"/></svg>`),
  pause: () => svg(`<svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="0" width="3.2" height="14" fill="${INK}"/><rect x="7.8" y="0" width="3.2" height="14" fill="${INK}"/></svg>`),
  share: () => svg(`<svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M9 1.5v12M4.8 5.6L9 1.5l4.2 4.1" stroke="${INK}" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 8.5H3.5a1.5 1.5 0 00-1.5 1.5v8.5A1.5 1.5 0 003.5 20h11a1.5 1.5 0 001.5-1.5V10a1.5 1.5 0 00-1.5-1.5H12" stroke="${INK}" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`),
  chevron: () => svg(`<svg width="7" height="12" viewBox="0 0 7 12" aria-hidden="true"><path d="M1 1l5 5-5 5" stroke="#C2BBB0" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`),
};

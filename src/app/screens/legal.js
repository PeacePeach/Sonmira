// Privacy Policy and Terms of Service. The text lives in ../legal/content.js,
// shared with the public /privacy and /terms pages.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { LEGAL } from '../legal/content.js';

export const DOCS = LEGAL;

// Paragraphs only, so the existing prose styles apply: headings are bold
// paragraphs and list items are bulleted ones.
export function legalProse(d) {
  const para = (b) => (typeof b === 'string' ? [h('p', {}, b)] : b.list.map((t) => h('p', {}, `• ${t}`)));
  return [
    ...d.intro.map((t) => h('p', {}, t)),
    ...(d.summary ? [h('p', {}, h('strong', {}, 'In short')), ...para({ list: d.summary })] : []),
    ...d.sections.flatMap((sec) => [h('p', {}, h('strong', {}, sec.heading)), ...sec.blocks.flatMap(para)]),
  ];
}

export function mountLegal(app, { doc }) {
  const d = DOCS[doc] || DOCS.privacy;
  const el = h('div', { class: 'settings legal', 'data-screen': 'legal' },
    h('div', { class: 'navrow' }, h('button', { class: 'icon-btn', 'aria-label': 'Back to settings', onClick: () => app.navigate('settings') }, icon('back', { size: 'lg' })), h('div')),
    h('h1', {}, d.title),
    h('div', { class: 'draft caps' }, `Last updated ${d.updated}`),
    h('div', { class: 'prose' }, legalProse(d)));
  return { el };
}

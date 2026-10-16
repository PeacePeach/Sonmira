// Privacy policy and Terms — honest prototype drafts, clearly marked.

import { h, icons } from '../ui/dom.js';

const DOCS = {
  privacy: {
    title: 'Privacy policy',
    body: [
      'Sonmira is a personal diary. In this prototype, your recordings, notes and paintings are stored only in this browser, on this device.',
      'Nothing is uploaded. There are no accounts, analytics or advertising.',
      'The microphone is used only while you are singing, after you tap to begin.',
      'Clearing this site’s data in your browser removes your diary permanently. Backup is not available yet.',
    ],
  },
  terms: {
    title: 'Terms',
    body: [
      'Sonmira is an early prototype offered for testing. Features may change and entries may be lost when the prototype is updated.',
      'The watercolor paintings shown are reference artworks used as stand-ins while painting generation is in development.',
      'Final terms will be published before release.',
    ],
  },
};

export function mountLegal(app, { doc }) {
  const d = DOCS[doc] || DOCS.privacy;
  const el = h('div', { class: 'settings legal', 'data-screen': 'legal' },
    h('div', { class: 'navrow' }, h('button', { class: 'icon-btn', 'aria-label': 'Back to settings', onClick: () => app.navigate('settings') }, icons.back()), h('div')),
    h('h1', {}, d.title),
    h('div', { class: 'draft caps' }, 'Prototype draft'),
    h('div', { class: 'prose' }, d.body.map((p) => h('p', {}, p))));
  return { el };
}

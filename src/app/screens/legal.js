// Privacy policy and Terms — honest prototype drafts, clearly marked.

import { h, icons } from '../ui/dom.js';

export const DOCS = {
  privacy: {
    title: 'Privacy policy',
    body: [
      'Sonmira is a personal diary. Your diary (recordings, notes and paintings) is stored only in this browser, on this device.',
      'To make a painting, your recording and note are sent to Sonmira’s painting service and to OpenAI, which listens for the words and paints the image. OpenAI handles them under its API data policy and does not use them to train its models.',
      'Sonmira’s painting service keeps the finished painting and the reading of your words for 24 hours, so a painting isn’t lost if the app closes while it is being made. It keeps no recordings.',
      'An anonymous install id and your invitation code are used only to limit how many paintings can be made. There are no accounts, analytics or advertising.',
      'The microphone is used only while you are singing, after you tap to begin.',
      'Clearing this site’s data in your browser removes your diary permanently. Backup is not available yet.',
      'Purchases are handled by Apple. Sonmira never sees your payment details. In this prototype, purchases are simulated and nothing is charged.',
    ],
  },
  terms: {
    title: 'Terms',
    body: [
      'Sonmira is an early prototype offered for testing. Features may change and entries may be lost when the prototype is updated.',
      'The watercolor paintings shown are reference artworks used as stand-ins while painting generation is in development.',
      'Your first three paintings are free. After that, Daily Ritual is a monthly subscription that includes one new painting each day; unused days don’t carry over. It renews automatically until you cancel in your Apple ID settings, at least 24 hours before renewal. Little Moments is a one-time purchase of 10 paintings that never expire.',
      'A painting is counted only when it is made. If making one fails, nothing is used. Cancelling a subscription never removes paintings you’ve already kept.',
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

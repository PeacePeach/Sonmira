// Privacy policy and Terms — honest prototype drafts, clearly marked.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export const DOCS = {
  privacy: {
    title: 'Privacy policy',
    body: [
      'Sonmira is a personal diary. Here is what stays on your device, what is sent to make a painting, and what Sonmira’s server keeps.',
      'Stays on this device: your diary, meaning every recording, note and painting you keep, is stored only in this browser, on this device. It is not backed up or synced, and signing in doesn’t change that.',
      'Sent to make a painting: your recording goes to Sonmira’s painting service and on to OpenAI, which writes down any words you sing. An OpenAI language model then reads those words for their mood and imagery. A short description of what to paint, taken from your words or, when there are none, from your note, is sent to OpenAI to paint the image. Your note is sent only in that case. OpenAI handles all of this under its API data policy and does not use it to train its models.',
      'Kept on Sonmira’s server: your recording is never stored. The words it heard, how they were read, the description sent for painting and the finished painting are kept for 24 hours, so a painting isn’t lost if the app closes while it is being made, and are then deleted.',
      'To limit how many paintings can be made and to keep your balance, the server also keeps an anonymous install id, your invitation code, daily counts, the paintings you have left and your purchases.',
      'An account is optional. If you sign in with Apple, the server links that anonymous id to a coded form of your Apple ID, so your paintings left and purchases can be found again. We never ask for your name or email, and your diary is not part of your account. You can delete your account in Settings → Account.',
      'There are no analytics or advertising.',
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
    h('div', { class: 'navrow' }, h('button', { class: 'icon-btn', 'aria-label': 'Back to settings', onClick: () => app.navigate('settings') }, icon('back', { size: 'lg' })), h('div')),
    h('h1', {}, d.title),
    h('div', { class: 'draft caps' }, 'Prototype draft'),
    h('div', { class: 'prose' }, d.body.map((p) => h('p', {}, p))));
  return { el };
}

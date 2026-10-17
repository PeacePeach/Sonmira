// Privacy policy and Terms — honest prototype drafts, clearly marked.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export const DOCS = {
  privacy: {
    title: 'Privacy policy',
    body: [
      'Sonmira is a personal diary. Here is what stays on your device, what is sent to make a painting, and what Sonmira’s server keeps.',
      'Stays on this device: your diary, meaning every recording, note and painting you keep, and any painting you haven’t kept yet. It is stored only in this app on this device, is not backed up or synced, and signing in doesn’t change that.',
      'Sent to make a painting, each time you tap to create one: your recording goes to Sonmira’s painting service and on to OpenAI, which writes down any words you sing. An OpenAI language model then reads those words for their mood and imagery. OpenAI’s image model receives a short description of what to paint, taken from your words or, when none were heard, from your note, along with a description of your voice (how steady it was, its feeling and its motif). Your note is sent only in that case.',
      'OpenAI processes all of this under its API terms: it is not used to train OpenAI’s models, and OpenAI may keep it for up to 30 days to watch for abuse.',
      'Kept on Sonmira’s server: your recording is never stored. The words it heard, how they were read, the description sent for painting and the finished painting are kept for 24 hours, so a painting isn’t lost if the app closes while it is being made, and are then deleted.',
      'To limit how many paintings can be made, the server uses an anonymous id for this install, a coded form of your invitation code and your network address, with counts that expire within a day. Its logs keep only the first characters of the id.',
      'For your paintings and purchases, the server keeps a balance under that anonymous id: free paintings used, paintings you have left, whether Daily Ritual is active, and Apple’s transaction numbers. Apple handles payment, and Sonmira never sees your payment details.',
      'An account is optional. If you sign in with Apple, the server links that anonymous id to a coded form of your Apple ID, so your balance and purchases can be found again. We never ask for your name or email, and your diary is not part of your account. Deleting your account in Settings → Account removes that link, your balance and your invitation place.',
      'There are no analytics or advertising.',
      'The microphone is used only while you are singing, after you tap to begin.',
      'Deleting the app, or clearing Sonmira’s data in your browser, removes your diary permanently. Backup is not available yet.',
      'Development previews only simulate purchases and Sign in with Apple, and nothing is charged there. In the iPhone app, purchases are made through Apple.',
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

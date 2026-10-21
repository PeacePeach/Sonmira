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
      'For your paintings and purchases, the server keeps a balance under that anonymous id: free paintings used, Daily Ritual credits and Little Moments paintings you have left, the dates your Daily Ritual subscription is paid for (to count its daily credits), and Apple’s transaction numbers. Apple handles payment, and Sonmira never sees your payment details.',
      'An account is optional. If you sign in with Apple, the server links that anonymous id to a coded form of your Apple ID, so your balance and purchases can be found again. Signing in never asks for your name or email, and your diary is not part of your account. Deleting your account in Settings → Account removes that link, your balance and your invitation place.',
      'If you send us a message from Settings → Contact & Feedback, it is emailed to the Sonmira team with the email you choose to give for our reply, whether you’re using the app or the web, and your iOS version. Nothing from your diary is included. We keep these messages for up to 180 days.',
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
      'Your first three paintings are free.',
      'Daily Ritual is an auto-renewing monthly subscription, at the price shown in the App Store for your country before you confirm. Payment is charged to your Apple ID when you confirm, and the subscription renews automatically each month unless you turn off auto-renew in your Apple ID settings at least 24 hours before the end of the current period. Your Apple ID is charged for the renewal within 24 hours before the period ends. You can manage or cancel it in your Apple ID settings at any time.',
      'While Daily Ritual is paid for, you receive one painting credit per day: one when the subscription starts, then one every 24 hours. Credits are never given in advance. Unused credits roll over, up to a balance of 30; while you hold 30, no new credit is added. You can use several credits on the same day.',
      'If you cancel, Daily Ritual stays active, and credits keep arriving, until the end of the period you have paid for. After the subscription ends, no new credits are added, and the credits you have already received never expire. If you subscribe again, you keep them and daily credits start again, up to a balance of 30. If Apple refunds a Daily Ritual payment, the credits that payment earned and that you haven’t used are removed.',
      'Little Moments is a one-time purchase of 10 paintings, at the price shown in the App Store. They never expire, are not part of the 30-credit limit, and can be used as soon as you buy them. If Apple refunds a Little Moments purchase, its unused paintings are removed.',
      'Every credit or painting you have makes one painting, and Sonmira uses them in the order that keeps the most for you. A painting is counted only when it is made: if making one fails, the credit is returned, and trying the same recording again never uses a second credit. Cancelling never removes paintings you’ve already kept, and your diary, recordings and sharing never need a purchase.',
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

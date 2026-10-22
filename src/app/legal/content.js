// Sonmira's Privacy Policy and Terms of Service: the one source for the app's
// legal screen and sheet (src/app/screens/legal.js, paywall/legal-sheet.js)
// and the public pages /privacy and /terms (scripts/build-legal.mjs writes
// privacy/index.html and terms/index.html from this file; a test checks they
// are current).
//
// Every statement about data must match the code. Retention periods quoted
// here come from: server/protect/config.js (24 h results), server/protect/
// index.js (invitation seat 1 year, rate counters), api/generate.js
// (reference history 1 year, look history 90 days), server/billing/ledger.js
// (balance and transaction records 5 years after the last change).
//
// A document is { title, updated, intro[], sections: [{ heading, blocks }] };
// a block is a paragraph (string) or { list: [string] }. Plain text only:
// the public pages turn email addresses and https:// URLs into links.

export const UPDATED = 'October 22, 2026';
export const CONTACT = 'sonmirasupport@gmail.com';
export const PUBLIC_URLS = { privacy: 'https://sonmira.vercel.app/privacy', terms: 'https://sonmira.vercel.app/terms' };
const APPLE_EULA = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

export const PRIVACY = {
  title: 'Privacy Policy',
  updated: UPDATED,
  intro: [
    'Sonmira (“Sonmira”, “we”, “us”) is a personal singing diary: you sing a short song and Sonmira turns it into a watercolor painting with the help of AI. This policy explains what information the Sonmira iPhone app and the Sonmira web app handle, where it is kept, who processes it, how long it is kept, and the choices you have.',
    `This policy is also published at ${PUBLIC_URLS.privacy}.`,
  ],
  summary: [
    'Your diary (recordings, notes, titles, journal entries and paintings) is stored only on your device.',
    'When you create a painting, your recording is sent to our server and to OpenAI to understand your words and paint the picture. Sonmira does not store your recording on its servers.',
    'Our server keeps a finished painting and the words it heard for 24 hours, so a painting isn’t lost if the app closes, and then deletes them.',
    'We use a random, anonymous identifier instead of your name or email. Sign in with Apple is optional.',
    'There are no ads and no analytics, and we do not sell your personal information.',
  ],
  sections: [
    {
      heading: '1. Information stored only on your device',
      blocks: [
        'Your diary is stored in the app’s storage on your device. This includes your recordings, any notes, titles and journal entries you write, your paintings, and paintings you have not kept yet (drafts). It is not uploaded to our servers, not backed up by Sonmira and not synced between devices, and signing in does not change that. Deleting the app, or clearing Sonmira’s data in your browser, permanently removes your diary. Sonmira does not currently offer a backup.',
        'The app also stores a few settings on your device, and the iPhone app keeps your anonymous identifier (see section 4) in your iCloud Keychain so it survives a reinstall.',
        'The microphone is used only while you are singing, after you tap to begin. When you choose Save to Photos or Share, the painting or video goes only where you send it. Sonmira asks for permission to add to your photo library and does not read it.',
      ],
    },
    {
      heading: '2. Audio recordings and how they are processed',
      blocks: [
        'Each time you tap to create a painting:',
        { list: [
          'Your recording is sent over an encrypted connection to Sonmira’s server and on to OpenAI, whose speech recognition model writes down any words you sing.',
          'The words, if any were heard, are read by an OpenAI language model for their mood and imagery.',
          'OpenAI’s image model receives a short text description of what to paint, taken from your words or, when no words were heard, from your note, together with a description of your voice (for example how steady it was, its feeling and its motif) and one of Sonmira’s own reference artworks. Your note is sent only in that case. Your recording itself is not sent to the image model.',
        ] },
        'Your voice is also analyzed on your device to measure qualities such as pitch and steadiness; only the resulting measurements, not the sound, are sent for painting. We do not use your recording to identify you.',
        'Sonmira does not store your recording on its servers. OpenAI processes this information as our service provider under its API terms. According to OpenAI’s published API data policies, data sent through its API is not used to train OpenAI’s models by default, and OpenAI may retain it for up to 30 days to monitor for abuse, or longer where it is legally required to. OpenAI’s retention is governed by OpenAI, not by Sonmira.',
      ],
    },
    {
      heading: '3. Lyrics and generated paintings',
      blocks: [
        'So that a painting isn’t lost if the app closes while it is being made, Sonmira’s server keeps, for 24 hours, the words transcribed from your recording, how they were read, the description sent for painting, and the finished painting. After 24 hours they expire and are deleted automatically. Your kept paintings live in your diary on your device.',
        'To vary your paintings, the server also keeps a short history of which of Sonmira’s reference artworks and painting styles were used for your recent paintings, linked to your anonymous identifier. This history contains no words, recordings or images. The reference history expires one year after it last changes, and the style history 90 days after it last changes.',
      ],
    },
    {
      heading: '4. Anonymous identifiers, accounts and security records',
      blocks: [
        'Sonmira does not ask for your name, email address or phone number to use the app. Each installation has a random anonymous identifier. It is used to count paintings, attach purchases to your balance, apply limits and keep the 24-hour results described above.',
        { list: [
          'Invitation codes. While access requires an invitation code, the server keeps a coded (hashed) form of the code your device used, linked to your anonymous identifier, for up to one year.',
          'Abuse, fraud and cost limits. The server counts requests per anonymous identifier, per invitation code and per network (IP) address. The counters for your network address expire within about an hour, and the others within two days.',
          'Sign in with Apple (optional). If you sign in, the server links your anonymous identifier to a keyed, coded (hashed) form of your Apple user identifier, so your balance and purchases can be found again on a new iPhone. We never ask Apple for your name or email. Your diary is not part of your account. This link is kept until you delete your account.',
          'Server logs. Our servers record technical events, for example whether a request succeeded, how long it took, your anonymous identifier or part of it, and purchase transaction identifiers. They do not contain your recordings, words or paintings. Logs are kept by our hosting provider for the period its service retains them.',
        ] },
      ],
    },
    {
      heading: '5. Free paintings, subscriptions, purchases and refunds',
      blocks: [
        'New users receive a small number of free paintings. Sonmira also offers in-app purchases of paintings and an auto-renewing subscription. All payments are processed by Apple. Sonmira never receives your payment card or billing details.',
        'To keep your balance accurate, the server keeps a record linked to your anonymous identifier: the free paintings you have used, the paintings and subscription credits you have left, the paid periods of your subscription, and Apple’s transaction identifiers. Apple’s signed transaction information is verified on our server, and Apple may notify our server when a subscription renews, ends or is refunded.',
        `Refunds are handled by Apple under its policies; you can request one at https://reportaproblem.apple.com. When Apple refunds a purchase, the unused paintings or credits it provided are removed from your balance. You can manage or cancel a subscription in your Apple ID settings. Deleting the app or your Sonmira account does not cancel a subscription.`,
        'The balance record expires five years after it last changes, unless it is deleted sooner with your account (see section 8). The records that tie each Apple transaction to an anonymous identifier, and that note when one identifier’s balance was merged into another (for example by Restore Purchases or signing in), are kept for five years after they were last written, including after account deletion, so that a purchase cannot be claimed twice or credited to the wrong person.',
      ],
    },
    {
      heading: '6. How we use information',
      blocks: [
        'We use the information described above only to:',
        { list: [
          'create your paintings and deliver them to you;',
          'count free paintings, apply purchases and subscriptions, and restore them on a new device;',
          'prevent abuse, fraud and unexpected costs, and keep the service secure and working;',
          'answer you when you contact us; and',
          'meet legal obligations.',
        ] },
        'We do not use your information for advertising, we do not track you across other companies’ apps or websites, and we do not sell your personal information or share it for cross-context behavioral advertising.',
      ],
    },
    {
      heading: '7. Service providers',
      blocks: [
        'We share information only with service providers that help us run Sonmira, and only for the purposes above:',
        { list: [
          'OpenAI: speech recognition, reading the words, and painting (see section 2).',
          'Vercel: hosts the Sonmira website, the web content of the iPhone app, and our servers. Like most hosts, it receives standard request information, such as your IP address and device type, and keeps operational logs.',
          'Upstash (through Vercel): the database that holds the server-side records described in this policy.',
          'Apple: App Store payments, subscriptions and refunds, Sign in with Apple, and iCloud Keychain.',
          'Google Fonts: the app’s typefaces are loaded from Google’s servers, which receive your IP address and browser information when they are loaded.',
        ] },
        'These providers process information under their own terms and privacy policies. They are based in the United States, so your information may be processed and stored there, including if you live in Canada, and may be accessible to authorities there under local law. We may also disclose information if required by law, or to protect the rights, safety or property of our users, Sonmira or others.',
      ],
    },
    {
      heading: '8. Your choices, deletion and rights',
      blocks: [
        { list: [
          'Your diary. You can delete any entry in the app, and deleting the app removes your whole diary from that device.',
          'Delete your account. If you signed in with Apple, you can delete your account in Settings → Account. Sonmira then asks Apple to revoke its Sign in with Apple access and deletes from our database your account link, your balance (including unused paintings and credits), your invitation place and any stored 24-hour results. You can also choose to erase the diary on that device. Deleting your account does not cancel a subscription.',
          'What may remain after deletion. Some records are not removed by account deletion and expire on their own: the records that tie Apple transactions and merged balances to your anonymous identifier (five years, as described in section 5), the reference and style history (one year and 90 days), request counters (up to two days), our hosting provider’s logs, and copies held by OpenAI or Apple under their own policies. We keep these only for the purposes described in this policy, such as preventing fraud and meeting legal obligations.',
          'Without an account, your server-side information is tied only to a random identifier that we cannot link to your name or email, so we may not be able to find it from an email request. Most of it expires on its own as described above.',
          `Privacy requests. Depending on where you live, including Canada and several U.S. states, you may have the right to request access to or correction of your personal information, to ask us to delete it, to withdraw consent, or to complain about how it is handled. To make a request, email ${CONTACT}. We may need information to confirm that the request is yours, and we will respond as required by applicable law. We will not treat you differently for making a request. If you are in Canada, you may also contact the Office of the Privacy Commissioner of Canada or your provincial privacy commissioner.`,
        ] },
        'Using Sonmira does not mean you give up any privacy rights you have under applicable law.',
      ],
    },
    {
      heading: '9. Data security',
      blocks: [
        'Information sent between the app and our servers is encrypted in transit (HTTPS). Service keys stay on our servers and never reach the app. We store coded (hashed) forms of Apple user identifiers and invitation codes rather than the originals, and access to paid features is protected by signed tokens and limits. No method of transmission or storage is completely secure, so we cannot guarantee absolute security.',
      ],
    },
    {
      heading: '10. Children’s privacy',
      blocks: [
        'Sonmira is not directed to children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal information, please contact us and we will take reasonable steps to delete what we can identify.',
      ],
    },
    {
      heading: '11. Changes to this policy',
      blocks: [
        'We may update this policy as Sonmira changes. We will post the new version in the app and on this page and change the “Last updated” date. Where the law requires your consent to a change, we will ask for it.',
      ],
    },
    {
      heading: '12. Contact us',
      blocks: [
        `For privacy questions or requests, email ${CONTACT}.`,
      ],
    },
  ],
};

export const TERMS = {
  title: 'Terms of Service',
  updated: UPDATED,
  intro: [
    'These Terms of Service (“Terms”) govern your use of the Sonmira iPhone app and web app (together, “Sonmira”), provided by Sonmira (“we”, “us”). By using Sonmira you agree to these Terms. If you do not agree, please do not use Sonmira.',
    `These Terms are also published at ${PUBLIC_URLS.terms}. Our Privacy Policy (${PUBLIC_URLS.privacy}) explains how we handle your information.`,
  ],
  sections: [
    {
      heading: '1. What Sonmira is',
      blocks: [
        'Sonmira is a personal singing diary. You record a short song, and Sonmira uses AI services to create a watercolor-style painting inspired by it. Sonmira is for personal, non-commercial use.',
        'Sonmira is in early release. Access may require an invitation code, and features, limits and availability may change.',
      ],
    },
    {
      heading: '2. Eligibility',
      blocks: [
        'You must be at least 13 years old to use Sonmira. If you are under the age of majority where you live, you may use Sonmira, and make purchases, only with the permission of a parent or guardian.',
      ],
    },
    {
      heading: '3. Your content',
      blocks: [
        'Your recordings, notes, titles and journal entries remain yours. You give us permission to process them, and to have our service providers process them, only as needed to create your paintings and run Sonmira, as described in our Privacy Policy.',
        'You are responsible for what you record and write. Please record only your own voice, or others with their permission, and do not use Sonmira for anything unlawful, harmful or infringing.',
      ],
    },
    {
      heading: '4. AI-generated paintings',
      blocks: [
        'Paintings are created by AI from your singing and words. Results are unpredictable: a painting may not match what you sang or meant, the words may be misheard, and similar paintings may be made for other people. We do not guarantee any particular result, style, quality or likeness.',
        'As between you and Sonmira, you may use the paintings Sonmira creates for you for any lawful purpose, and we claim no ownership of them. Because they are generated by AI, they may not be protected by copyright, and we cannot promise that they are free of rights held by others.',
        'Paintings are inspired by Sonmira’s own reference artworks, which remain ours. You may not extract or reuse those reference artworks themselves.',
      ],
    },
    {
      heading: '5. Your diary is stored only on your device',
      blocks: [
        'Your diary (recordings, notes and paintings) is stored only on your device. Sonmira does not back it up or sync it, and signing in does not change that. If you delete the app, clear its data, lose or replace your device, or if your device’s storage fails, your diary may be lost permanently and we cannot recover it. Please save or share anything you want to keep, for example with Save to Photos.',
      ],
    },
    {
      heading: '6. Free paintings, purchases and subscriptions',
      blocks: [
        'Your first three paintings are free.',
        'Daily Ritual is an auto-renewing monthly subscription, at the price shown in the App Store for your country before you confirm. Payment is charged to your Apple ID when you confirm, and the subscription renews automatically each month unless you turn off auto-renew in your Apple ID settings at least 24 hours before the end of the current period. Your Apple ID is charged for the renewal within 24 hours before the period ends. You can manage or cancel it in your Apple ID settings at any time.',
        'While Daily Ritual is paid for, you receive one painting credit per day: one when the subscription starts, then one every 24 hours. Credits are never given in advance. Unused credits roll over, up to a balance of 30; while you hold 30, no new credit is added. You can use several credits on the same day.',
        'If you cancel, Daily Ritual stays active, and credits keep arriving, until the end of the period you have paid for. After the subscription ends, no new credits are added, and the credits you have already received never expire. If you subscribe again, you keep them and daily credits start again, up to a balance of 30. If Apple refunds a Daily Ritual payment, the credits that payment earned and that you haven’t used are removed.',
        'Little Moments is a one-time purchase of 10 paintings, at the price shown in the App Store. They never expire, are not part of the 30-credit limit, and can be used as soon as you buy them. If Apple refunds a Little Moments purchase, its unused paintings are removed.',
        'Every credit or painting you have makes one painting, and Sonmira uses them in the order that keeps the most for you. A painting is counted only when it is made: if making one fails, the credit is returned, and trying the same recording again never uses a second credit. Cancelling never removes paintings you’ve already kept, and your diary, recordings and sharing never need a purchase.',
        'Paintings and credits are a license to use Sonmira. They have no cash value and cannot be sold, transferred or exchanged for money, except where the law requires otherwise. Deleting your Sonmira account permanently removes your unused paintings and credits.',
      ],
    },
    {
      heading: '7. Payments, cancellations and refunds',
      blocks: [
        'All purchases are made through Apple and are subject to Apple’s terms. Apple handles payment, cancellations and refunds; Sonmira cannot issue refunds directly. To request a refund, visit https://reportaproblem.apple.com. Nothing in these Terms limits any refund or cancellation rights you have under applicable consumer protection law.',
      ],
    },
    {
      heading: '8. Acceptable use',
      blocks: [
        'Please do not misuse Sonmira. For example, do not try to get around painting limits, invitation codes or payments; interfere with or overload our servers; access Sonmira by automated means; reverse engineer it except where the law allows; or use it to create unlawful, harmful or infringing content. We may limit, suspend or end access for anyone who does, and where reasonable we will tell you why.',
      ],
    },
    {
      heading: '9. Service availability and changes',
      blocks: [
        'We work to keep Sonmira available, but it may be interrupted, slowed or paused, for example for maintenance, because of a problem with one of our service providers, or when a daily limit has been reached. We may change, add or remove features, and we may stop offering Sonmira. If we stop offering it, we will give reasonable notice where we can and will handle any unused paid paintings or credits as required by applicable law.',
      ],
    },
    {
      heading: '10. Third-party services',
      blocks: [
        'Sonmira relies on services from other companies, including Apple, OpenAI, Vercel and Upstash. We are not responsible for those services, which are provided under their own terms.',
        `If you use the iPhone app, Apple’s Licensed Application End User License Agreement (${APPLE_EULA}) also applies. Apple is not responsible for Sonmira or its content and has no obligation to provide support for it.`,
      ],
    },
    {
      heading: '11. Disclaimers',
      blocks: [
        'To the extent permitted by applicable law, Sonmira is provided “as is” and “as available”, without warranties of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose and non-infringement. Some jurisdictions do not allow these exclusions, so they may not apply to you, and they do not affect any warranties or guarantees that cannot be excluded under consumer protection law.',
      ],
    },
    {
      heading: '12. Limitation of liability',
      blocks: [
        'To the extent permitted by applicable law, Sonmira will not be liable for indirect, incidental, special, consequential or punitive damages, or for loss of data, including a lost diary, arising from your use of Sonmira. To the extent permitted by applicable law, our total liability for any claim relating to Sonmira is limited to the greater of the amount you paid for Sonmira in the 12 months before the claim and CAD $50.',
        'These limits do not apply to liability that cannot be limited under applicable law, such as liability for gross negligence, intentional misconduct, or death or personal injury caused by negligence, and they do not limit rights you have as a consumer that cannot be waived.',
      ],
    },
    {
      heading: '13. Ending your use',
      blocks: [
        'You can stop using Sonmira at any time and delete your account in Settings → Account. Deleting your account does not cancel a subscription; please cancel it in your Apple ID settings. Sections of these Terms that by their nature should continue, such as sections 4, 11, 12 and 14, continue after you stop using Sonmira.',
      ],
    },
    {
      heading: '14. Governing law',
      blocks: [
        'These Terms are governed by the laws of the Province of Alberta and the federal laws of Canada that apply there, without regard to conflict of laws rules. Subject to the next sentence, disputes will be resolved in the courts of Alberta. If you are a consumer, you keep the protection of any mandatory laws of the place where you live, and you may bring a claim in the courts where you live if those laws allow it.',
      ],
    },
    {
      heading: '15. Changes to these Terms',
      blocks: [
        'We may update these Terms as Sonmira changes. We will post the new version in the app and on this page and change the “Last updated” date. Changes apply from that date and do not affect purchases made before it. If you do not agree with a change, you can stop using Sonmira.',
      ],
    },
    {
      heading: '16. General',
      blocks: [
        'If any part of these Terms is found unenforceable, the rest remains in effect. Our not enforcing a part of these Terms is not a waiver. These Terms, together with our Privacy Policy, are the whole agreement between you and Sonmira about Sonmira.',
      ],
    },
    {
      heading: '17. Contact us',
      blocks: [
        `Questions about these Terms? Email ${CONTACT}.`,
      ],
    },
  ],
};

export const LEGAL = { privacy: PRIVACY, terms: TERMS };

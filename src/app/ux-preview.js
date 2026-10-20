// UX Preview: a temporary, token-free way to try the post-recording flow.
//
//   ?ux-preview   on localhost or a Vercel preview deployment only
//
// It runs the bundled mock engine (sample paintings, no network) with the
// sample voice, leaves the paintings ledger untouched, and labels every
// screen "Mock · UX Preview" so a sample painting is never mistaken for a
// real one. The invitation check, the AI engine and billing are not changed:
// nothing here calls them. It never turns on on the released site, in the
// iOS app, or on any other host, whatever the URL says.

import { h } from './ui/dom.js';
import { RELEASE_HOST } from './native/platform.js';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
// Vercel preview deployments of this project (sonmira-git-<branch>-…, sonmira-<hash>-…).
const VERCEL_PREVIEW = /^sonmira-[a-z0-9-]+\.vercel\.app$/;

/** Whether this host may run the UX Preview (the URL still has to ask for it). */
export function uxPreviewAllowed({ hostname = '', native = false } = {}) {
  if (native || !hostname || hostname === RELEASE_HOST) return false;
  return LOCAL.has(hostname) || VERCEL_PREVIEW.test(hostname);
}

/** True when the URL asks for the UX Preview and this host allows it. */
export function wantsUxPreview({ search = '', hostname = '', native = false } = {}) {
  return new URLSearchParams(search).has('ux-preview') && uxPreviewAllowed({ hostname, native });
}

/**
 * Paintings are free and uncounted in the preview: the ledger (the browser's
 * simulated wallet) is never reserved, spent or released.
 */
export function previewBilling(billing) {
  return {
    ...billing,
    status: () => ({ ...billing.status(), canCreate: true }),
    reserve: () => true,
    commit: () => true,
    release: () => {},
  };
}

/** The label over every screen. */
export function previewBadge() {
  injectStyle();
  return h('div', { class: 'ux-preview-badge', role: 'note', 'data-ux-preview': '' }, 'Mock · UX Preview — sample painting, not AI');
}

let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  document.head.append(h('style', {}, `
.ux-preview-badge { position: absolute; top: 4px; left: 50%; transform: translateX(-50%); z-index: 900; pointer-events: none; white-space: nowrap;
  font: 600 10px/1 var(--sans); letter-spacing: .04em; color: #fff; background: #B4532A; border-radius: 8px; padding: 3px 8px; }
`));
}

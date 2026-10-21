// When a scroll gesture on the detail page changes its layout: the expanded
// (portrait) artwork gives way to the compact (landscape) one as soon as the
// reader scrolls up into the journal, and comes back only when a new gesture
// pulls down while the journal is already at its top. The momentum of a
// fling that brings the journal back to the top doesn't expand it; only a
// fresh pull does. Pure, so it is tested without a browser.

export const COLLAPSE_AT = 16; // px of scroll toward the journal
export const EXPAND_AT = 28;   // px of pull past the journal's top

/**
 * @param {{mode: 'expanded'|'compact'|'edit', travel: number, startedAtTop: boolean, atTop: boolean}} g
 *   travel: how far this gesture has moved the content up (positive, toward
 *   the end of the journal) or pulled it down (negative), in px.
 * @returns {'collapse'|'expand'|null}
 */
export function scrollIntent({ mode, travel, startedAtTop, atTop }) {
  if (mode === 'expanded') return travel >= COLLAPSE_AT ? 'collapse' : null;
  if (mode === 'compact') return startedAtTop && atTop && travel <= -EXPAND_AT ? 'expand' : null;
  return null; // editing stays compact
}

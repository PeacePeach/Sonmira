// The artwork's size change, shared by Sing (preview → detail-size artwork →
// thumbnail) and the detail page (portrait ↔ landscape): the card is moved to
// its new layout (apply) and animated from its old size and place, so the
// change reads as the same artwork growing or shrinking. Width and height are
// animated rather than scaled, so the artwork is never stretched: object-fit
// keeps its own proportions. Nodes passed as `follow` slide from their old
// place to the new one alongside it. Reduce Motion skips the animation.

export const MORPH_MS = 560;
export const MORPH_EASING = 'cubic-bezier(.2, .7, .2, 1)';

export const reduceMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {HTMLElement} node the card that changes size
 * @param {() => void} apply moves it (and anything else) to the new layout
 * @param {{follow?: HTMLElement[]}} [o]
 */
export function morph(node, apply, { follow = [] } = {}) {
  const a = node.getBoundingClientRect(), aw = node.offsetWidth, ah = node.offsetHeight;
  const before = follow.map((n) => n.getBoundingClientRect());
  apply();
  if (reduceMotion() || !node.animate || !aw) return;
  const b = node.getBoundingClientRect(), bw = node.offsetWidth, bh = node.offsetHeight;
  const k = bw ? b.width / bw : 1; // the desktop frame may be scaled (fitStage)
  const timing = { duration: MORPH_MS, easing: MORPH_EASING };
  node.getAnimations?.().forEach((x) => x.cancel());
  node.animate([
    { width: `${aw}px`, height: `${ah}px`, transform: `translate(${(a.left - b.left) / k}px, ${(a.top - b.top) / k}px)` },
    { width: `${bw}px`, height: `${bh}px`, transform: 'translate(0, 0)' },
  ], timing);
  follow.forEach((n, i) => {
    n.getAnimations?.().forEach((x) => x.cancel());
    const r = n.getBoundingClientRect();
    const dx = (before[i].left - r.left) / k, dy = (before[i].top - r.top) / k;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], timing);
  });
}

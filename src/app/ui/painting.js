// Renders a Painting (contract shape) as the design's watercolor card:
// displaced wash strokes underneath, artwork on top, paper grain over all.
// The wash is drawn on the GPU (wash.js) where it can be, and is taken out
// of rendering once the opaque artwork covers it.

import { h, svg } from './dom.js';
import { createWash } from './wash.js';

// One object URL per artwork blob for the whole session, so the diary, the
// detail page and the creation flow share one decoded image instead of
// decoding the same JPEG again on every visit.
const artURLs = new WeakMap();
function artURL(blob) {
  let url = artURLs.get(blob);
  if (!url) { url = URL.createObjectURL(blob); artURLs.set(blob, url); }
  return url;
}
/** Lets go of a deleted painting's artwork URL. */
export function releaseArtwork(artwork) {
  const url = artwork?.blob && artURLs.get(artwork.blob);
  if (url) { URL.revokeObjectURL(url); artURLs.delete(artwork.blob); }
}

const f3 = (n) => n.toFixed(3);

// One wash: a translucent body, pigment pooled into a darker, fairly crisp
// rim (the dried edge of a watercolour wash), then clear paper. The #wc
// filter roughens that rim into an irregular, feathered edge and settles
// granulation into it; overlapping washes multiply like glazes.
function strokeStyle(b) {
  const L = b.l, C = Math.min(0.2, b.c * 1.15), H = b.hue.toFixed(1), A = Math.min(0.95, b.a);
  const col = (l, c, a) => `oklch(${f3(l)} ${f3(c)} ${H} / ${f3(a)})`;
  return {
    left: b.x + '%', top: b.y + '%', width: b.w + '%', height: b.h + '%',
    borderRadius: b.br,
    background: `radial-gradient(closest-side, ${col(L + 0.03, C, A * 0.5)} 0%, ${col(L, C, A * 0.62)} 55%, ${col(L - 0.05, C + 0.01, A * 0.8)} 76%, ${col(L - 0.13, C + 0.03, Math.min(1, A * 1.35))} 86%, ${col(L - 0.06, C, A * 0.5)} 90%, ${col(L, C, 0)} 94%)`,
  };
}

// Each wash drifts slowly on its own phase (alive / developing states).
function driftVars(d, i) {
  const r = (k) => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  d.style.setProperty('--dx', `${((r(1) - 0.5) * 14).toFixed(1)}%`);
  d.style.setProperty('--dy', `${((r(2) - 0.5) * 14).toFixed(1)}%`);
  d.style.setProperty('--dur', `${(5 + r(3) * 4).toFixed(2)}s`);
  d.style.setProperty('--delay', `${(-r(4) * 8).toFixed(2)}s`);
  d.style.setProperty('--spread', (1.12 + r(5) * 0.12).toFixed(3));
}

/**
 * @param {{ratio?: '32'|'45', strokes?: any[], artwork?: any, useFocus?: boolean, lazy?: boolean}} opts
 */
export function createPainting({ ratio = '32', strokes = [], artwork = null, useFocus = true, lazy = false } = {}) {
  const wash = h('div', { class: 'wash' });
  // The grain: a bitmap baked once (html.grain-baked, wash.js), else the SVG filter.
  const grain = h('div', { class: 'grain', 'aria-hidden': 'true' }, svg(`<svg><rect width="100%" height="100%" filter="url(#grain)"/></svg>`));
  const el = h('div', { class: `painting r${ratio}` }, wash, grain);
  let art = null;
  const gpu = createWash(wash, el);

  function addStroke(s, bloom = false) {
    if (!s) return;
    if (gpu) { gpu.add(s, bloom); return; }
    const d = h('div', { class: 'stroke' + (bloom ? ' bloom' : ''), style: strokeStyle(s) });
    d.style.setProperty('--rot', (s.rot || 0) + 'deg');
    driftVars(d, wash.childElementCount);
    wash.append(d);
  }
  function setStrokes(list) {
    if (gpu) { gpu.set(list); return; }
    wash.textContent = ''; (list || []).forEach((s) => addStroke(s));
  }

  // Voice → the wash breathes with it (recording): level 0..1, smoothed here
  // and eased by CSS (.painting .wash transition). 0 lets it settle.
  let voice = 0;
  function setVoice(level) {
    voice = level <= 0 ? 0 : voice + (Math.min(1, level) - voice) * 0.3;
    wash.style.scale = (1 + voice * 0.035).toFixed(4);
    wash.style.opacity = (0.86 + voice * 0.14).toFixed(3);
    if (level <= 0) { wash.style.scale = ''; wash.style.opacity = ''; }
  }

  // Once the artwork (always opaque) is decoded and fully faded in, the wash
  // under it can't be seen: .covered takes it out of rendering.
  function cover(img) {
    const loaded = new Promise((r) => { if (img.complete && img.naturalWidth) r(); else img.addEventListener('load', r, { once: true }); });
    loaded.then(() => img.decode?.()).then(() => { if (art === img && !img.classList.contains('hidden')) el.classList.add('covered'); }, () => {});
  }
  // A saved painting's artwork is usually decoded at once (artURL): the wash
  // waits a moment for it before being drawn, and is drawn only if it's late.
  function awaitArt(img) {
    el.classList.add('art-pending');
    const done = () => { if (art === img) el.classList.remove('art-pending'); };
    if (!lazy) setTimeout(done, 400); // a lazy one waits until it is near the screen and loads
    img.addEventListener('load', () => img.decode?.().then(done, done), { once: true });
    img.addEventListener('error', done, { once: true });
  }
  // Resolves once the artwork is decoded and on its way in (fade), so a
  // caller can keep its loading state until then.
  function setArtwork(a, { fade = false } = {}) {
    if (art) { art.remove(); art = null; }
    el.classList.remove('covered', 'art-pending');
    if (!a) return Promise.resolve();
    let src = a.src;
    if (a.kind === 'image' && a.blob) src = artURL(a.blob);
    if (!src) return Promise.resolve();
    art = h('img', { class: 'art' + (fade ? ' hidden' : ''), alt: '', src, decoding: 'async', loading: lazy ? 'lazy' : 'eager' });
    if (useFocus && a.focus) art.style.objectPosition = a.focus;
    el.insertBefore(art, grain);
    const img = art;
    if (!fade) { awaitArt(img); cover(img); }
    return new Promise((resolve) => {
      const shown = () => { img.removeEventListener('transitionend', shown); if (art === img) cover(img); };
      const show = () => requestAnimationFrame(() => requestAnimationFrame(() => {
        img.classList.remove('hidden');
        img.addEventListener('transitionend', shown);
        setTimeout(shown, 2000); // in case the fade ends unseen
        resolve();
      }));
      if (!fade) { resolve(); return; }
      img.complete ? show() : img.addEventListener('load', show, { once: true });
      img.addEventListener('error', show, { once: true });
    });
  }

  setStrokes(strokes);
  setArtwork(artwork);
  return { el, addStroke, setStrokes, setArtwork, setVoice, destroy() { gpu?.destroy(); } };
}

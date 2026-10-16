// Renders a Painting (contract shape) as the design's watercolor card:
// displaced wash strokes underneath, artwork on top, paper grain over all.

import { h, svg } from './dom.js';

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
  const grain = svg(`<svg class="grain" aria-hidden="true"><rect width="100%" height="100%" filter="url(#grain)"/></svg>`);
  const el = h('div', { class: `painting r${ratio}` }, wash, grain);
  let art = null, urls = [];

  function addStroke(s, bloom = false) {
    if (!s) return;
    const d = h('div', { class: 'stroke' + (bloom ? ' bloom' : ''), style: strokeStyle(s) });
    d.style.setProperty('--rot', (s.rot || 0) + 'deg');
    driftVars(d, wash.childElementCount);
    wash.append(d);
  }
  function setStrokes(list) { wash.textContent = ''; (list || []).forEach((s) => addStroke(s)); }

  // Voice → the wash breathes with it (recording): level 0..1, smoothed here
  // and eased by CSS (.painting .wash transition). 0 lets it settle.
  let voice = 0;
  function setVoice(level) {
    voice = level <= 0 ? 0 : voice + (Math.min(1, level) - voice) * 0.3;
    wash.style.scale = (1 + voice * 0.035).toFixed(4);
    wash.style.opacity = (0.86 + voice * 0.14).toFixed(3);
    if (level <= 0) { wash.style.scale = ''; wash.style.opacity = ''; }
  }

  // Resolves once the artwork is decoded and on its way in (fade), so a
  // caller can keep its loading state until then.
  function setArtwork(a, { fade = false } = {}) {
    if (art) { art.remove(); art = null; }
    if (!a) return Promise.resolve();
    let src = a.src;
    if (a.kind === 'image' && a.blob) { src = URL.createObjectURL(a.blob); urls.push(src); }
    if (!src) return Promise.resolve();
    art = h('img', { class: 'art' + (fade ? ' hidden' : ''), alt: '', src, decoding: 'async', loading: lazy ? 'lazy' : 'eager' });
    if (useFocus && a.focus) art.style.objectPosition = a.focus;
    el.insertBefore(art, grain);
    const img = art;
    return new Promise((resolve) => {
      const show = () => requestAnimationFrame(() => requestAnimationFrame(() => { img.classList.remove('hidden'); resolve(); }));
      if (!fade) { resolve(); return; }
      img.complete ? show() : img.addEventListener('load', show, { once: true });
      img.addEventListener('error', show, { once: true });
    });
  }

  setStrokes(strokes);
  setArtwork(artwork);
  return { el, addStroke, setStrokes, setArtwork, setVoice, destroy() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; } };
}

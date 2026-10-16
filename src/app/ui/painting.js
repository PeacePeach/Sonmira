// Renders a Painting (contract shape) as the design's watercolor card:
// displaced wash strokes underneath, artwork on top, paper grain over all.

import { h, svg } from './dom.js';

const f3 = (n) => n.toFixed(3);

function strokeStyle(b) {
  const L = b.l, C = b.c, H = b.hue.toFixed(1), A = Math.min(0.95, b.a);
  return {
    left: b.x + '%', top: b.y + '%', width: b.w + '%', height: b.h + '%',
    borderRadius: b.br,
    background: `radial-gradient(closest-side, oklch(${f3(L)} ${f3(C)} ${H} / ${f3(A)}) 0%, oklch(${f3(L)} ${f3(C)} ${H} / ${f3(A * 0.75)}) 60%, oklch(${f3(L - 0.1)} ${f3(C + 0.02)} ${H} / ${f3(Math.min(1, A * 1.3))}) 86%, oklch(${f3(L)} ${f3(C)} ${H} / 0) 100%)`,
  };
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
    wash.append(d);
  }
  function setStrokes(list) { wash.textContent = ''; (list || []).forEach((s) => addStroke(s)); }

  function setArtwork(a, { fade = false } = {}) {
    if (art) { art.remove(); art = null; }
    if (!a) return;
    let src = a.src;
    if (a.kind === 'image' && a.blob) { src = URL.createObjectURL(a.blob); urls.push(src); }
    if (!src) return;
    art = h('img', { class: 'art' + (fade ? ' hidden' : ''), alt: '', src, decoding: 'async', loading: lazy ? 'lazy' : 'eager' });
    if (useFocus && a.focus) art.style.objectPosition = a.focus;
    el.insertBefore(art, grain);
    if (fade) {
      const show = () => requestAnimationFrame(() => requestAnimationFrame(() => art && art.classList.remove('hidden')));
      art.complete ? show() : art.addEventListener('load', show, { once: true });
      art.addEventListener('error', show, { once: true });
    }
  }

  setStrokes(strokes);
  setArtwork(artwork);
  return { el, addStroke, setStrokes, setArtwork, destroy() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; } };
}

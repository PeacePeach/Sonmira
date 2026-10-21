// The design's playback row: 48 pt outlined play/pause, 2 pt track,
// elapsed on the left and a label on the right.

import { h } from './dom.js';
import { icon } from './icons.js';
import { clock } from '../format.js';

/**
 * @param {{blob: Blob|null, durationSec: number, right?: string}} opts
 */
export function createPlayer({ blob, durationSec, right = '' }) {
  const fill = h('div', { class: 'fill' });
  const elapsed = h('span', {}, clock(0));
  const rightEl = h('span', {}, right || clock(durationSec));
  const btn = h('button', { class: 'play-btn', 'aria-label': 'Play recording' }, icon('play'));
  const el = h('div', { class: 'player' }, btn, h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'track' }, fill), h('div', { class: 'times tabular' }, elapsed, rightEl)));

  let audio = null, url = null, iv = null, playing = false;
  const dur = Math.max(0.1, durationSec || 0.1);

  if (!blob) { btn.disabled = true; btn.setAttribute('aria-label', 'No recording'); }

  function paint(t) {
    fill.style.transform = `scaleX(${Math.min(1, t / dur).toFixed(4)})`;
    elapsed.textContent = clock(Math.min(t, dur));
  }
  function setPlaying(p) {
    playing = p;
    btn.replaceChildren(icon(p ? 'pause' : 'play'));
    btn.setAttribute('aria-label', p ? 'Pause recording' : 'Play recording');
    clearInterval(iv);
    if (p) iv = setInterval(() => audio && paint(audio.currentTime), 100);
  }
  function fail() {
    setPlaying(false);
    btn.disabled = true;
    rightEl.textContent = 'Can’t play this recording here';
  }
  function ensureAudio() {
    if (audio) return audio;
    url = URL.createObjectURL(blob);
    audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;
    audio.addEventListener('ended', () => { setPlaying(false); paint(dur); });
    audio.addEventListener('error', fail);
    return audio;
  }

  btn.addEventListener('click', () => {
    if (!blob) return;
    const a = ensureAudio();
    if (playing) { a.pause(); setPlaying(false); return; }
    if (a.ended || a.currentTime >= dur - 0.05) a.currentTime = 0;
    const p = a.play();
    setPlaying(true);
    if (p && p.catch) p.catch((e) => { if (e && e.name === 'NotSupportedError') fail(); else setPlaying(false); });
  });

  return {
    el,
    setRight(t) { rightEl.textContent = t; },
    stop() { if (audio) audio.pause(); setPlaying(false); },
    destroy() { clearInterval(iv); if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } if (url) URL.revokeObjectURL(url); audio = null; url = null; },
  };
}

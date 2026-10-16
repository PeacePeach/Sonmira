// Developer-only panel, loaded only when the URL has ?dev.
// Lets you force the completeness level, paint with a synthetic voice, seed
// the diary with sample entries and open the engine gallery. Nothing here is
// reachable from the user-facing UI.

import { h } from './ui/dom.js';
import { dayKey } from './format.js';
import { clearEntries } from './storage.js';
import { COMPLETENESS } from '../engine/contract.js';

const SAMPLES = [
  [0, 'Humming on the walk home', 'gathered', 262, 12],
  [0, 'A line from the song in the café', 'resolved', 220, 9],
  [-3, 'Rain on the window', 'resolved', 165, 15],
  [-6, 'Happy birthday, Mia', 'resolved', 392, 14],
  [-8, 'Lullaby, half remembered', 'gathered', 196, 13],
  [-10, 'Testing the high note', 'loose', 523, 6],
  [-12, 'Still half asleep', 'loose', 247, 7],
  [-14, 'Singing in the car with the windows down', 'resolved', 294, 15],
];

function tone(sr, seconds, hz) {
  const n = Math.round(sr * seconds), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = hz * (1 + 0.006 * Math.sin(t * 2 * Math.PI * 5)) * (1 + 0.06 * Math.sin(t * 0.7));
    ph += (2 * Math.PI * f) / sr;
    out[i] = 0.12 * Math.min(1, t * 4, (seconds - t) * 4) * (Math.sin(ph) + 0.35 * Math.sin(2 * ph));
  }
  return out;
}

function wav(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s * 0x7fff, true));
  return new Blob([buf], { type: 'audio/wav' });
}

async function seed(app) {
  const sr = 22050;
  for (const [offset, note, completeness, hz, secs] of SAMPLES) {
    const samples = tone(sr, secs, hz);
    const s = app.engine.createLiveSession({ sampleRate: sr, maxSeconds: 30 });
    const hop = sr / 10;
    for (let i = 2048; i <= samples.length; i += hop) s.push(samples.subarray(i - 2048, i));
    const analysis = s.finish();
    const painting = await app.engine.generate({ analysis, note, audioBlob: null, overrides: { completeness } });
    const d = new Date(); d.setDate(d.getDate() + offset);
    await app.addEntry({ id: 'sample-' + Math.random().toString(36).slice(2), createdAt: d.getTime() + secs, date: dayKey(d), note, durationSec: secs, audio: wav(samples, sr), analysis, painting });
  }
}

export function mountDevPanel(app) {
  const sel = h('select', { onChange: (e) => { app.dev.completeness = e.target.value || null; } },
    h('option', { value: '' }, 'auto (from voice)'), COMPLETENESS.map((c) => h('option', { value: c }, c)));
  const sim = h('input', { type: 'checkbox', onChange: (e) => { app.dev.simulate = e.target.checked; } });
  const refresh = () => app.current?.name === 'diary' ? app.navigate('diary') : null;
  document.body.append(h('details', { class: 'devpanel' },
    h('summary', {}, `dev · ${app.engine.id}`),
    h('label', {}, 'completeness ', sel),
    h('label', {}, sim, ' sample voice (no mic)'),
    h('button', { onClick: async () => { await seed(app); refresh(); } }, 'add sample entries'),
    h('button', { onClick: async () => { if (confirm('Clear the whole diary?')) { await clearEntries(); app.entries = []; refresh(); } } }, 'clear diary'),
    h('div', { style: 'margin-top:6px' }, h('a', { href: 'dev/gallery.html' + location.search, target: '_blank' }, 'engine gallery ↗')),
    h('div', { style: 'margin-top:6px;opacity:.7' }, 'engine: ', h('a', { href: '?dev&engine=mock' }, 'mock'), ' · ', h('a', { href: '?dev&engine=real' }, 'real'))));
}

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

export async function seed(app) {
  if (app.engine.paid && !confirm(`This makes ${SAMPLES.length} paid image generations. Continue?`)) return;
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
  const diag = h('div', { class: 'devdiag', style: 'margin-top:8px;border-top:1px solid #555;padding-top:6px;word-break:break-all' }, 'last generation: none yet');
  const sel = h('select', { onChange: (e) => { app.dev.completeness = e.target.value || null; } },
    h('option', { value: '' }, 'auto (from voice)'), COMPLETENESS.map((c) => h('option', { value: c }, c)));
  const sim = h('input', { type: 'checkbox', onChange: (e) => { app.dev.simulate = e.target.checked; } });
  // Temporary: the labelled lyrics-completeness cases through the server's
  // text model (no audio, no image; about 16 short text calls).
  const evalOut = h('div', { class: 'deveval', style: 'margin-top:6px;word-break:break-word' });
  const evalBtn = h('button', { onClick: async () => {
    evalBtn.disabled = true; evalOut.replaceChildren(h('div', {}, 'running lyrics evaluation…'));
    try {
      const res = await fetch('/api/understand', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'eval' }) });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { evalOut.replaceChildren(h('div', {}, `blocked: ${j?.code ?? `http_${res.status}`}${j?.status ? ` (OpenAI ${j.status})` : ''}, ${j?.error ?? 'no response'}`)); return; }
      const word = (b) => (b == null ? 'error' : b ? 'complete' : 'incomplete');
      evalOut.replaceChildren(h('div', {}, `${j.passed}/${j.total} pass · ${j.model} · ${(j.ms / 1000).toFixed(1)} s`),
        ...j.results.map((r) => h('div', { 'data-pass': String(r.pass), style: `margin-top:4px;${r.pass ? '' : 'color:#e66'}` },
          `${r.pass ? '✓' : '✗'} ${r.text} · expected ${word(r.expected)} · actual ${word(r.actual)}`,
          h('div', { style: 'opacity:.7' }, r.error ? `error ${r.error}` : `${r.model.structure}, unfinished ${r.model.unfinished}, linked ${r.model.linked}, model says ${r.model.phraseComplete} (${r.model.confidence})${r.overridden ? ', overridden' : ''}`))));
      console.info('[sonmira] lyrics evaluation', j);
    } catch (e) { evalOut.replaceChildren(h('div', {}, `blocked: ${e.message}`)); } finally { evalBtn.disabled = false; }
  } }, 'Run lyrics evaluation');
  const only = h('input', { type: 'checkbox', onChange: (e) => { app.dev.analyzeOnly = e.target.checked; } });
  const refresh = () => app.current?.name === 'diary' ? app.navigate('diary') : null;
  document.body.append(h('details', { class: 'devpanel' },
    h('summary', {}, `dev · ${app.engine.id}`),
    h('label', {}, 'completeness ', sel),
    h('label', {}, sim, ' sample voice (no mic)'),
    h('label', {}, only, ' analyze only (no image call)'),
    h('button', { onClick: async () => { await seed(app); refresh(); } }, 'add sample entries'),
    evalBtn, evalOut,
    h('button', { onClick: async () => { if (confirm('Clear the whole diary?')) { await clearEntries(); app.entries = []; refresh(); } } }, 'clear diary'),
    h('div', { style: 'margin-top:6px' }, h('a', { href: 'dev/gallery.html' + location.search, target: '_blank' }, 'engine gallery ↗')),
    h('div', { style: 'margin-top:6px;opacity:.7' }, 'engine: ', h('a', { href: '?dev&engine=ai' }, 'ai'), ' · ', h('a', { href: '?dev&engine=real' }, 'real'), ' · ', h('a', { href: '?dev&engine=mock' }, 'mock')),
    diag));
  // Last generation: how the recording was understood and what made the
  // painting. Ids and measurements only; no keys or storage URLs reach here.
  app.dev.onGeneration = (g) => {
    const rows = (pairs) => pairs.filter(([, v]) => v !== undefined).map(([k, v]) => h('div', {}, `${k}: ${v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : v}`));
    const section = (title, pairs, open = false) => h('details', open ? { open: '' } : {}, h('summary', {}, title), ...rows(pairs));
    const u = g?.understanding;
    const out = [h('div', { style: 'opacity:.7' }, 'last generation')];
    if (!g) out.push(...rows([['engine', app.engine.id], ['provider', 'none (local renderer)']]));
    else {
      if (g.error) out.push(...rows([['error', g.error], ['status', g.status], ['detail', g.detail]]));
      if (u) {
        const q = u.singing?.quality, v = u.singing?.vocal, t = u.transcript, l = u.lyrics, s = u.semantics;
        out.push(section(`decision: ${u.tier}${u.tierSource === 'override' ? ' (forced)' : ''}`, [['tier', u.tier], ['stage', u.decision?.stage], ['reason', u.decision?.reason], ['decided tier', u.decision?.tier]], true));
        out.push(section('audio', [['duration', u.audio?.durationSec], ['sounding s', u.audio?.soundingSec], ['voiced s', u.audio?.voicedSec], ['voiced ratio', u.audio?.voicedRatio], ['pauses', u.audio?.pauses], ['pitch continuity', u.audio?.pitchContinuity], ['median Hz', u.audio?.medianHz], ['dynamic dB', u.audio?.dynamicRangeDb],
          ['sung', v?.sung], ...(v?.sungChecks ?? []).map((c) => [`  ${c.ok ? '✓' : '✗'} ${c.id}`, `${c.value} (need ${c.need})`]),
          ['notes', v?.noteCount], ['note s', v?.noteSec], ['sustained ratio', v?.sustainedRatio], ['ending', v?.ending]]));
        out.push(section('lyrics', [['requested', u.wordsRequested], ['skipped', u.wordsSkipped ?? undefined], ['transcript', t?.text], ['asr confidence', t?.asrConfidence], ['words / lexical / vocables', t ? `${t.wordCount} / ${t.lexicalWords} / ${t.nonLexicalWords}` : null], ['hallucination', t?.hallucination],
          ['asr model', t?.model], ['lexical', l?.lexical], ['coherent', l?.coherent], ['structure', l ? `${l.structure ?? '—'}, unfinished ${l.unfinished}, linked ${l.linked}` : null], ['missing', l?.missing || undefined],
          ['model says complete', l ? `${l.phraseComplete} (${l.completionConfidence})` : null], ['why', l?.completionReason], ['text model', l?.model],
          ['gate', u.gate ? `${u.gate.pass ? 'PASS' : 'FAIL'} (confidence ${u.gate.confidence})` : null], ['failed checks', u.gate?.failed?.join(', ')],
          ...(u.gate?.checks ?? []).map((c) => [`  ${c.ok ? '✓' : '✗'} ${c.id}`, `${typeof c.value === 'object' ? JSON.stringify(c.value) : c.value} (need ${c.need})`])]));
        out.push(section('singing', [['score', q?.score], ['confidence', q?.confidence], ['strong', q?.strong], ...Object.entries(q?.components ?? {}).map(([k, c]) => [k, c]), ['unavailable', q?.unavailable?.join('; ')], ['expression', u.expression]]));
        out.push(section('semantics', [['source', s?.source], ['why', s?.reason], ['concept', s?.concept?.text], ['theme', s?.concept?.theme?.join(', ')], ['imagery', s?.concept?.imagery?.join(', ')], ['figurative', s?.concept?.figurative], ['mood', u.emotion?.value + ' · ' + u.emotion?.source], ['motif', u.motif?.value + ' · ' + u.motif?.source]]));
      }
      if (!g.error) out.push(section('generation', [['engine', app.engine.id], ['provider', g.provider], ['model', g.model], ['quality', g.quality], ['tier', g.tier], ['family', g.family], ['subject from', g.subjectSource],
        ['reference', g.reference], ['ref sent', g.referenceSent], ['library', g.libraryVersion], ['seed', g.seed], ['time', g.ms ? `${(g.ms / 1000).toFixed(1)} s` : null]], true));
      else out.push(...rows([['engine', app.engine.id]]));
    }
    diag.replaceChildren(...out);
    console.info('[sonmira] generation', g);
  };
}

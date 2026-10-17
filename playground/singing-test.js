// Singing test: nine guided takes recorded in the page and classified by the
// same decision the app makes (src/engine/understand.js):
//   words  → transcription + lyrics reading on the server (/api/understand)
//   stage 1: lyrical-completion gate → stage 2: singing control → tier
// Each take shows the tier, why, and the whole-take measurements, next to
// what the singer expected before singing and what they judge after
// listening back. The expected and judged tiers are labels to compare with,
// not ground truth: the point is to see where the thresholds sit against
// real voices. Takes stay in this browser (IndexedDB) with their audio and
// the server's word reading, so re-analysis after a code change is free.

import { understandTake } from '../src/engine/understand.js';
import { pitchTrack } from '../src/engine/analysis/pitchtrack.js';
import { SINGING_CALIBRATION } from '../src/engine/analysis/singing.js';
import { GATE_CALIBRATION } from '../src/engine/interpret/lyrics.js';
import { wordsAudio } from '../src/engine/engines/ai.js';

const MAX_SEC = 30;
const TIERS = ['loose', 'gathered', 'resolved'];
const TIER_LABEL = { loose: 'Loose', gathered: 'Gathered', resolved: 'Resolved' };

export const TAKES = [
  { slot: 1, title: 'Hum, no words', ask: 'Hum a melody you like for 15–20 s. No words at all.', expect: 'loose' },
  { slot: 2, title: 'Speak the words', ask: 'Say one complete lyric line in your normal speaking voice, twice. Don’t sing.', expect: 'loose' },
  { slot: 3, title: 'Unfinished line', ask: 'Sing the start of a line and stop in the middle of it, as if you forgot the rest.', expect: 'loose' },
  { slot: 4, title: 'Casual line', ask: 'Sing a complete line of a familiar song casually, the way you sing to yourself, with breaks.', expect: 'gathered' },
  { slot: 5, title: 'Falls apart', ask: 'Sing a complete line steadily, then let the melody drift and wander for the second half.', expect: 'gathered' },
  { slot: 6, title: 'Hesitant start', ask: 'Start unsure, searching for the first notes, then sing the rest of the line steadily.', expect: 'gathered' },
  { slot: 7, title: 'Your best line', ask: 'Sing one complete line, sustained and in tune, as well as you can.', expect: 'resolved' },
  { slot: 8, title: 'Take 4, sung well', ask: 'Sing the same song as take 4, this time as well as you can.', expect: 'resolved' },
  { slot: 9, title: 'Slow, with vibrato', ask: 'A slow song with long notes and your natural vibrato.', expect: 'resolved' },
];

// Plain words for every check the decision uses.
const CHECK_TEXT = {
  transcribed: 'Words were heard',
  lexical_words: 'Enough real words',
  mostly_words: 'Mostly words, not “la la” or “mm”',
  asr_confident: 'The transcription was confident',
  sung: 'Sung on held notes, not spoken',
  word_rate: 'Words at a singing pace',
  language_model: 'The words could be read',
  lexical_meaning: 'The words mean something together',
  phrase_complete: 'A complete phrase, not cut off',
  score: 'Singing score (settled notes)',
  confidence: 'Enough clear singing to be sure',
  stability: 'Notes held steady',
  intonation: 'Notes on one consistent tuning',
  transitions: 'Clean moves between notes',
  controlled_share: 'Controlled across the whole take',
  weakest_windows: 'Weakest stretches still controlled',
  weak_windows: 'Few weak stretches',
  key_drift: 'The key doesn’t slide',
  rhythm: 'Rhythm not extremely broken',
  coherence: 'No erratic leaps',
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (x, d = 2) => (x == null || typeof x !== 'number' || Number.isNaN(x) ? (x == null ? '—' : String(x)) : Number(x).toFixed(d));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

// ---------- storage (this browser only) ----------
const DB = 'sonmira-singing-test', STORE = 'takes';
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'slot' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}
const saveTake = (t) => tx('readwrite', (s) => s.put(t));
const loadTakes = () => tx('readonly', (s) => s.getAll());
const clearTakes = () => tx('readwrite', (s) => s.clear());

// state: slot → { slot, expected, judged, comment, blob, mime, words, recordedAt }
// view:  slot → { u (understanding), track, durationSec, error, busy }
const state = new Map();
const view = new Map();
const labelFor = (slot) => TAKES.find((t) => t.slot === slot);

// ---------- audio ----------
async function decode(blob) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const buf = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
  const n = Math.min(buf.length, Math.round(MAX_SEC * buf.sampleRate));
  const mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
  return { samples: mono, sampleRate: buf.sampleRate, durationSec: n / buf.sampleRate };
}
// The words are sent exactly as the app sends them (16 kHz mono WAV, wordsAudio).
async function toBase64(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// Recording with the app's own microphone settings (src/app/recorder.js),
// so the test hears what the app hears.
let rec = null;
async function startRecording(slot) {
  if (rec) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
  } catch (err) {
    view.set(slot, { ...view.get(slot), error: `Microphone not available (${err.message || err}). Allow the microphone for this page in the browser’s site settings, then try again.` });
    renderTake(slot);
    return;
  }
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  await ac.resume?.();
  const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser();
  an.fftSize = 2048; src.connect(an);
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const t0 = performance.now(), buf = new Float32Array(an.fftSize);
  let raf = 0;
  rec = {
    slot,
    stop: () => new Promise((res) => {
      cancelAnimationFrame(raf);
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); ac.close().catch(() => {}); res(new Blob(chunks, { type: mr.mimeType || type || 'audio/webm' })); };
      mr.stop();
    }),
  };
  const card = $(`take-${slot}`);
  const tick = () => {
    const s = (performance.now() - t0) / 1000;
    card.querySelector('.timer').textContent = `${Math.min(s, MAX_SEC).toFixed(1)} / ${MAX_SEC} s`;
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (const v of buf) sum += v * v;
    card.querySelector('.meter > div').style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 400)}%`;
    if (s >= MAX_SEC) stopRecording(); else raf = requestAnimationFrame(tick);
  };
  // One blob at stop, no timeslice: Safari's fragmented MP4 chunks can decode
  // as only their first fragment.
  mr.start();
  rec.t0 = t0;
  tick();
  syncRecButtons();
}
async function stopRecording() {
  if (!rec) return;
  const r = rec; rec = null;
  const recordedSec = (performance.now() - r.t0) / 1000;
  const blob = await r.stop();
  syncRecButtons();
  const card = $(`take-${r.slot}`);
  card.querySelector('.meter > div').style.width = '0';
  const t = state.get(r.slot);
  Object.assign(t, { wordsSkipped: false, blob, mime: blob.type, bytes: blob.size, recordedSec: Math.min(MAX_SEC, recordedSec), words: null, recordedAt: new Date().toISOString(), judged: '' });
  await saveTake(t);
  await analyse(r.slot);
}
function syncRecButtons() {
  for (const { slot } of TAKES) {
    const b = $(`take-${slot}`)?.querySelector('.recbtn');
    if (!b) continue;
    const mine = rec?.slot === slot;
    b.textContent = mine ? '■ Stop' : state.get(slot)?.blob ? '● Record again' : '● Record';
    b.classList.toggle('recording', mine);
    b.disabled = Boolean(rec) && !mine;
  }
}

// ---------- the decision ----------
// The words are fetched once per recording (one transcription, plus one short
// text call when there are real words) and saved with the take; afterwards
// re-analysis reuses them and nothing is billed. A failed transcription is
// shown as such and tried again on the next analysis, never read as "no words".
async function analyse(slot) {
  const t = state.get(slot);
  if (!t?.blob) return;
  await serverChecked;
  const fetchWords = wordsAvailable && !t.words && !t.wordsSkipped;
  view.set(slot, { busy: fetchWords ? 'Listening to the words and measuring the singing…' : 'Measuring the singing…' });
  renderTake(slot);
  renderSummary();
  try {
    const audio = await decode(t.blob);
    let wordsError = null;
    const words = !fetchWords ? (t.words ? async () => t.words : null) : async () => {
      try {
        const wav = await wordsAudio(t.blob);
        const r = await fetch('/api/understand', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: await toBase64(wav), mime: 'audio/wav' }) });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.code === 'not_configured' ? 'the server has no OpenAI key for transcription' : `${j?.code || `HTTP ${r.status}`}${j?.error ? `: ${j.error}` : ''}`);
        t.words = { transcript: j.transcript, lyrics: j.lyrics };
        return t.words;
      } catch (e) {
        wordsError = e.message || String(e);
        return null;
      }
    };
    let u = await understandTake({ samples: audio.samples, sampleRate: audio.sampleRate, words });
    if (fetchWords && !u.wordsRequested) t.wordsSkipped = true; // too little sound: no call was made
    await saveTake(t);
    const noWords = !t.words && !t.wordsSkipped;
    if (noWords) u = singingOnly(u, wordsError ? `transcription failed: ${wordsError}` : 'this server has no transcription key');
    view.set(slot, { u, track: pitchTrack(audio.samples, audio.sampleRate), durationSec: audio.durationSec });
  } catch (err) {
    view.set(slot, { error: `This take couldn’t be analysed (${err.message || err}).` });
  }
  renderTake(slot);
  renderSummary();
}

// Without the words (no transcription on this server, or it failed), the
// decision is made from the singing alone, as if the words had passed: not
// sung → Loose, sung → Gathered, confidently strong → Resolved. The words
// checks are left out and the result is marked as singing only.
function singingOnly(u, why) {
  const sung = u.singing?.vocal?.sung, q = u.singing?.quality;
  const decision = !sung ? { tier: 'loose', stage: 1, reason: 'not sung on held notes' }
    : q?.strong ? { tier: 'resolved', stage: 2, reason: 'confidently strong singing' }
    : { tier: 'gathered', stage: 2, reason: 'sung, but not confidently strong' };
  return { ...u, tier: decision.tier, decision, gate: { ...u.gate, checks: (u.gate?.checks ?? []).filter((c) => c.id === 'sung') }, wordsChecked: false, wordsWhy: why };
}

// A take the analysis barely heard is a recording problem, not a tier result.
function soundProblem(t, v) {
  const a = v.u.audio ?? {}, rec = t.recordedSec, dec = v.durationSec;
  const where = `${t.mime || 'unknown type'}, ${Math.round((t.bytes ?? t.blob?.size ?? 0) / 1024)} KB`;
  if (rec && dec < rec - 1) return `this browser decoded only ${fmt(dec, 1)} s of the ${fmt(rec, 1)} s recorded (${where}). Please tell Claude which browser and device you used.`;
  if ((a.soundingSec ?? 0) < 1) return `only ${fmt(a.soundingSec ?? 0, 1)} s of sound reached the analysis in ${fmt(dec, 1)} s (${where}), so there was almost nothing to analyse. Play the take back: if it is silent or very faint, the browser is using another microphone or the input level is very low.`;
  return null;
}

// Why this tier, in plain words, from the checks that decided it.
function explain(u) {
  const g = u.gate, q = u.singing?.quality;
  const val = (c) => (c.value == null || c.value === '' ? '' : ` (${typeof c.value === 'number' ? fmt(c.value) : c.value})`);
  if (u.tier === 'loose') {
    const failed = (g?.checks ?? []).filter((c) => !c.ok);
    return { head: u.wordsChecked === false ? 'Loose, because the take is not sung on held notes.' : 'Loose, because the take is not a complete sung phrase.', lines: failed.map((c) => `✗ ${CHECK_TEXT[c.id] || c.id}${val(c)}`) };
  }
  const sc = q?.strongChecks ?? [];
  if (u.tier === 'gathered') {
    return { head: u.wordsChecked === false ? 'Gathered: sung, but the singing is not consistently strong enough for Resolved.' : 'Gathered: a complete sung phrase, but the singing is not consistently strong enough for Resolved.', lines: sc.filter((c) => !c.ok).map((c) => `✗ ${CHECK_TEXT[c.id] || c.id}: ${fmt(c.value)}, needs ${c.need}`) };
  }
  const tight = closest(sc, 3);
  return { head: u.wordsChecked === false ? 'Resolved: every singing check passed.' : 'Resolved: a complete sung phrase, and every singing check passed.', lines: tight.map((c) => `✓ ${CHECK_TEXT[c.id] || c.id}: ${fmt(c.value)}, needs ${c.need}`) };
}

// Numeric margin of a check from its need text (≥ x or ≤ x).
function margin(c) {
  const m = /([≥≤])\s*(-?[\d.]+)/.exec(c.need || '');
  if (!m || typeof c.value !== 'number') return null;
  const th = Number(m[2]);
  return m[1] === '≥' ? c.value - th : th - c.value;
}
const closest = (checks, n) => checks.filter((c) => margin(c) != null).sort((a, b) => margin(a) - margin(b)).slice(0, n);

// Where the decision and the singer's label disagree, and what drove it.
function disagreement(t, u) {
  const ref = t.judged || t.expected;
  if (!ref || !u || ref === u.tier) return null;
  const by = TIERS.indexOf(u.tier) - TIERS.indexOf(ref);
  const sc = u.singing?.quality?.strongChecks ?? [];
  const gate = u.gate?.checks ?? [];
  if (by < 0) {
    if (u.tier === 'loose') return { dir: 'lower', drivers: gate.filter((c) => !c.ok).map((c) => c.id) };
    return { dir: 'lower', drivers: sc.filter((c) => !c.ok).map((c) => c.id) };
  }
  if (u.tier === 'resolved') return { dir: 'higher', drivers: closest(sc, 3).map((c) => c.id) };
  return { dir: 'higher', drivers: ['gate passed'] };
}

// ---------- rendering ----------
function pill(tier, extra = '') { return tier ? `<span class="tier ${tier}">${TIER_LABEL[tier]}${extra}</span>` : '<span class="tier none">—</span>'; }
const tierSelect = (cls, value, blank) => `<select class="${cls}">${blank ? `<option value="">${blank}</option>` : ''}${TIERS.map((x) => `<option value="${x}"${value === x ? ' selected' : ''}>${TIER_LABEL[x]}</option>`).join('')}</select>`;

function metricsTable(u) {
  const s = u.singing, q = s?.quality, C = q?.components ?? {}, P = C.performance ?? {}, a = u.audio ?? {};
  const rows = [
    ['Length / sound / pitched voice', `${fmt(a.durationSec, 1)} s / ${fmt(a.soundingSec, 1)} s / ${fmt(a.voicedSec, 1)} s`],
    ['Held notes', s ? `${s.vocal.noteCount} notes, ${fmt(s.vocal.noteSec, 1)} s = ${pct(s.vocal.sustainedRatio)} of pitched voice` : '—'],
    ['Controlled over the whole take', P.controlledShare == null ? '—' : `${pct(P.controlledShare)} (notes ${fmt(P.labels?.note, 1)} s, slides ${fmt(P.labels?.bend, 1)} s, phrase edges ${fmt(P.labels?.edge, 1)} s, unstable ${fmt(P.labels?.unstable, 1)} s)`],
    ['2-second stretches', P.windows ? `${P.windows.length}; weakest quarter at ${pct(P.windowP25)}; ${pct(P.weakWindowShare)} weak` : '—'],
    ['Key drift', P.tuning ? `${fmt(P.tuning.driftCents, 0)} cents` : '—'],
    ['Score / confidence', q ? `${fmt(q.score)} / ${fmt(q.confidence)} (evidence ${fmt(q.evidence)} × consistency ${fmt(q.consistency)})` : '—'],
    ['Steadiness in notes', C.stability ? `${fmt(C.stability.score)} · wobble ${fmt(C.stability.wobbleCents, 0)}¢, drift ${fmt(C.stability.driftCentsPerSec, 0)}¢/s, jitter ${fmt(C.stability.jitterCents, 0)}¢, vibrato in ${pct(C.stability.vibratoShare)} of notes` : 'not measured'],
    ['Tuning consistency', C.intonation ? `${fmt(C.intonation.score)} · off the singer’s own grid by ${fmt(C.intonation.deviationCents, 0)}¢` : 'not measured'],
    ['Note transitions', C.transitions ? `${fmt(C.transitions.score)} · ${C.transitions.count} moves, overshoot ${fmt(C.transitions.meanOvershootCents, 0)}¢` : 'not measured'],
    ['Pitch range / dynamics', `${fmt(s?.expression?.pitchRangeCents, 0)}¢ / ${fmt(a.dynamicRangeDb, 0)} dB`],
  ];
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function checksList(title, checks) {
  if (!checks?.length) return '';
  return `<h4>${title}</h4><table class="checks">${checks.map((c) => `<tr class="${c.ok ? 'ok' : 'no'}"><td>${c.ok ? '✓' : '✗'}</td><td>${esc(CHECK_TEXT[c.id] || c.id)}<div class="hint">${esc(c.id)}</div></td><td>${esc(typeof c.value === 'number' ? fmt(c.value) : c.value)}</td><td class="hint">${esc(c.need)}</td></tr>`).join('')}</table>`;
}

// Pitch over time, with each 2-second stretch of voiced time shaded by how
// controlled it was (green ≥ 60 %, amber 50–60 %, red below).
function drawTimeline(canvas, v) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 600, H = 120;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);
  const dur = Math.max(1, v.durationSec), x = (t) => (t / dur) * W;
  const P = v.u.singing?.quality?.components?.performance;
  for (const w of P?.windows ?? []) {
    g.fillStyle = w.controlled >= 0.6 ? 'rgba(88,150,110,.22)' : w.controlled >= 0.5 ? 'rgba(200,150,60,.25)' : 'rgba(190,80,70,.25)';
    g.fillRect(x(w.t0), 0, Math.max(2, x(w.t1) - x(w.t0)), H);
  }
  const cs = v.track.frames.filter((f) => f.cents != null).map((f) => f.cents);
  if (!cs.length) return;
  const lo = Math.min(...cs) - 100, hi = Math.max(...cs) + 100, y = (c) => H - 6 - ((c - lo) / (hi - lo)) * (H - 12);
  g.fillStyle = '#3d4148';
  for (const f of v.track.frames) if (f.cents != null) g.fillRect(x(f.t), y(f.cents), 1.5, 1.5);
}

function renderTake(slot) {
  const card = $(`take-${slot}`), t = state.get(slot), v = view.get(slot) ?? {}, meta = labelFor(slot);
  const out = card.querySelector('.out');
  card.querySelector('.player').hidden = !t.blob;
  const player = card.querySelector('.player audio');
  if (t.blob && player.dataset.at !== String(t.recordedAt)) { if (player.src) URL.revokeObjectURL(player.src); player.src = URL.createObjectURL(t.blob); player.dataset.at = String(t.recordedAt); }
  card.querySelector('.rerun').hidden = !t.blob;
  card.querySelector('.judge').hidden = !t.blob;
  syncRecButtons();
  if (v.busy) { out.innerHTML = `<p class="hint">${esc(v.busy)}</p>`; return; }
  if (v.error) { out.innerHTML = `<p class="err">${esc(v.error)}</p>`; return; }
  if (!v.u) { out.innerHTML = t.blob ? '<p class="hint">Not analysed yet.</p>' : `<p class="hint">Not recorded yet. Suggested expectation: ${TIER_LABEL[meta.expect]}.</p>`; return; }
  const u = v.u, why = explain(u), tr = u.transcript, d = disagreement(t, u);
  const sound = soundProblem(t, v);
  const words = u.wordsChecked === false ? `<em>not checked (${esc(u.wordsWhy)}). The tier comes from the singing alone, as if the words formed a complete phrase.</em>`
    : !u.wordsRequested ? `<em>${esc(u.wordsSkipped || 'not transcribed')}</em>`
    : tr?.text ? `“${esc(tr.text)}” <span class="hint">(${tr.lexicalWords} words, confidence ${fmt(tr.asrConfidence)}${tr.hallucination ? ', known transcription hallucination' : ''})</span>` : '<em>no words heard</em>';
  const ly = u.lyrics;
  out.innerHTML = `
    <div class="verdict">${pill(u.tier)} <span class="hint">${u.wordsChecked === false ? 'singing only, words not checked' : `stage ${u.decision.stage} · ${u.decision.stage === 1 ? 'words gate' : 'singing control'}`}</span></div>
    ${sound ? `<p class="disagree"><b>Recording problem:</b> ${esc(sound)}</p>` : ''}
    <p class="why"><b>${esc(why.head)}</b></p>
    ${why.lines.length ? `<ul class="whylist">${why.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${d ? `<p class="disagree">${d.dir === 'lower' ? 'Lower' : 'Higher'} than your ${t.judged ? 'judgement' : 'expectation'} (${TIER_LABEL[t.judged || t.expected]}). Driven by: ${d.drivers.map((x) => esc(CHECK_TEXT[x] || x)).join(', ')}.</p>` : ''}
    <p class="words"><b>Words:</b> ${words}${ly && !ly.error ? `<br><span class="hint">Reading: ${esc(ly.structure ?? '—')}, phrase complete ${ly.phraseComplete ? 'yes' : 'no'} (${fmt(ly.completionConfidence)})${ly.unfinished ? ', unfinished' : ''}</span>` : ''}</p>
    <canvas class="timeline"></canvas>
    <p class="hint legend">Pitch over the take. Shading: each 2 s of singing, <span class="g">controlled</span> · <span class="a">borderline</span> · <span class="r">weak</span>.</p>
    <details><summary>Whole-take measurements</summary>${metricsTable(u)}</details>
    <details><summary>Every check</summary>${checksList('Stage 1 · words gate', u.gate?.checks)}${checksList('Stage 2 · singing control (Resolved needs all)', u.decision.stage === 2 ? u.singing?.quality?.strongChecks : null)}${u.decision.stage === 1 ? '<p class="hint">Stage 2 not reached; the singing checks are in the calibration table below.</p>' : ''}</details>`;
  drawTimeline(out.querySelector('.timeline'), v);
}

function renderSummary() {
  const busy = TAKES.filter(({ slot }) => view.get(slot)?.busy).length, failed = TAKES.filter(({ slot }) => view.get(slot)?.error).length;
  if ($('stCopy')) { $('stCopy').disabled = busy > 0; $('stCopy').textContent = busy ? `Analysing… ${busy} left` : 'Copy results for Claude'; }
  if ($('stProgress')) $('stProgress').textContent = busy ? `Analysing your takes: ${busy} left.` : failed ? `${failed} take${failed > 1 ? 's' : ''} couldn’t be analysed; see the red message on ${failed > 1 ? 'those cards' : 'that card'}.` : '';
  const rows = TAKES.map(({ slot, title }) => {
    const t = state.get(slot), u = view.get(slot)?.u;
    const ref = t.judged || t.expected;
    const agree = !u ? '' : !ref ? '' : ref === u.tier ? '<span class="ok">agrees</span>' : '<span class="no">differs</span>';
    return `<tr><td>${slot}</td><td>${esc(title)}</td><td>${pill(t.expected)}</td><td>${u ? pill(u.tier) : view.get(slot)?.error ? '<span class="no">error</span>' : t.blob ? '…' : '<span class="hint">not recorded</span>'}</td><td>${t.judged ? pill(t.judged) : '<span class="hint">—</span>'}</td><td>${agree}</td></tr>`;
  }).join('');
  const done = TAKES.filter(({ slot }) => view.get(slot)?.u);
  const agreeN = done.filter(({ slot }) => { const t = state.get(slot); return (t.judged || t.expected) === view.get(slot).u.tier; }).length;
  $('stSummary').innerHTML = `<div class="scroll"><table class="sumtable"><tr><th>#</th><th>Take</th><th>You expected</th><th>Engine</th><th>Your judgement</th><th></th></tr>${rows}</table></div>
    <p class="hint">${done.length} of 9 recorded · engine agrees with your label on ${agreeN} of ${done.length}. Your judgement after listening counts over your expectation when you give one.</p>`;
  renderCalibration();
}

// Every measured value against its threshold, one column per take: shows
// where a line would have to move to fit the voices.
function renderCalibration() {
  const done = TAKES.filter(({ slot }) => view.get(slot)?.u);
  if (!done.length) { $('stCalib').innerHTML = '<p class="hint">Appears once takes are recorded.</p>'; return; }
  const col = ({ slot }) => view.get(slot).u;
  const ids = [...new Set(done.flatMap((s) => [...(col(s).gate?.checks ?? []), ...(col(s).singing?.quality?.strongChecks ?? [])].map((c) => c.id)))];
  const cell = (u, id) => {
    const c = [...(u.gate?.checks ?? []), ...(u.singing?.quality?.strongChecks ?? [])].find((x) => x.id === id);
    if (!c) return '<td class="hint">—</td>';
    if (id === 'sung' && u.singing) return `<td class="${c.ok ? 'ok' : 'no'}" title="${esc(c.need)}">${pct(u.singing.vocal.sustainedRatio)} held</td>`;
    const v = typeof c.value === 'number' ? fmt(c.value) : String(c.value ?? '').slice(0, 22);
    return `<td class="${c.ok ? 'ok' : 'no'}" title="${esc(c.need)}">${esc(v)}</td>`;
  };
  const needOf = (id) => { for (const s of done) { const c = [...(col(s).gate?.checks ?? []), ...(col(s).singing?.quality?.strongChecks ?? [])].find((x) => x.id === id); if (c) return c.need; } return ''; };
  $('stCalib').innerHTML = `<div class="scroll"><table class="calib"><tr><th>Check</th><th>Needs</th>${done.map(({ slot }) => { const t = state.get(slot); return `<th>${slot}<div>${pill(col({ slot }).tier)}</div><div class="hint">you: ${esc(TIER_LABEL[t.judged || t.expected] ?? '—')}</div></th>`; }).join('')}</tr>
    ${ids.map((id) => `<tr><td>${esc(CHECK_TEXT[id] || id)}</td><td class="hint">${esc(needOf(id))}</td>${done.map((s) => cell(col(s), id)).join('')}</tr>`).join('')}</table></div>
    <p class="hint">Green passes, red fails. Rows above “Singing score” decide Loose; the rest decide Gathered vs Resolved. Singing checks are shown for every take, even when stage 2 wasn’t reached.</p>`;
}

// Compact results (no audio) to paste into the project thread.
function resultsJson() {
  const takes = TAKES.map(({ slot, title }) => {
    const t = state.get(slot), u = view.get(slot)?.u;
    const v = view.get(slot) ?? {};
    if (!u || v.error) return { slot, title, expected: t.expected, judged: t.judged || null, recorded: Boolean(t.blob), mime: t.mime ?? null, bytes: t.bytes ?? null, recordedSec: t.recordedSec ?? null, state: v.busy ? 'still analysing' : v.error ? 'error' : 'not analysed', error: v.error ?? null };
    const q = u.singing?.quality, C = q?.components ?? {}, P = C.performance ?? {};
    return {
      slot, title, expected: t.expected, judged: t.judged || null, comment: t.comment || null,
      engine: u.tier, stage: u.decision.stage, reason: u.decision.reason, wordsChecked: u.wordsChecked !== false,
      audio: u.audio, mime: t.mime, bytes: t.bytes ?? null, recordedSec: t.recordedSec ?? null, decodedSec: view.get(slot).durationSec,
      words: u.transcript ? { text: u.transcript.text, lexicalWords: u.transcript.lexicalWords, asrConfidence: u.transcript.asrConfidence, hallucination: u.transcript.hallucination } : (u.wordsSkipped || null),
      reading: u.lyrics ? { structure: u.lyrics.structure, phraseComplete: u.lyrics.phraseComplete, completionConfidence: u.lyrics.completionConfidence, unfinished: u.lyrics.unfinished, linked: u.lyrics.linked, lexical: u.lyrics.lexical, coherent: u.lyrics.coherent } : null,
      gate: (u.gate?.checks ?? []).map((c) => [c.id, c.ok ? 1 : 0, c.value]),
      strong: (q?.strongChecks ?? []).map((c) => [c.id, c.ok ? 1 : 0, c.value]),
      vocal: u.singing ? { voicedSec: u.singing.vocal.voicedSec, notes: u.singing.vocal.noteCount, noteSec: u.singing.vocal.noteSec, sustainedRatio: u.singing.vocal.sustainedRatio } : null,
      quality: q ? { score: q.score, confidence: q.confidence, evidence: q.evidence, consistency: q.consistency } : null,
      components: {
        stability: C.stability && { score: C.stability.score, wobble: C.stability.wobbleCents, drift: C.stability.driftCentsPerSec, jitter: C.stability.jitterCents, vibrato: C.stability.vibratoShare },
        intonation: C.intonation && { score: C.intonation.score, dev: C.intonation.deviationCents },
        transitions: C.transitions && { score: C.transitions.score, n: C.transitions.count, overshoot: C.transitions.meanOvershootCents },
        control: C.control && { score: C.control.score }, rhythm: C.rhythm && { score: C.rhythm.score }, coherence: C.coherence && { score: C.coherence.score },
      },
      performance: { controlledShare: P.controlledShare, labels: P.labels, windowP25: P.windowP25, weakWindowShare: P.weakWindowShare, drift: P.tuning?.driftCents, windows: (P.windows ?? []).map((w) => [w.t0, w.t1, w.controlled]) },
      expression: u.expression,
    };
  });
  return JSON.stringify({ kind: 'sonmira-singing-test', version: 1, at: new Date().toISOString(), browser: navigator.userAgent, calibration: { singing: SINGING_CALIBRATION.strong, performance: SINGING_CALIBRATION.strongPerformance, sung: SINGING_CALIBRATION.sung, gate: GATE_CALIBRATION }, takes });
}

async function copyResults() {
  const busy = TAKES.filter(({ slot }) => view.get(slot)?.busy).length;
  if (busy) { $('stCopyHint').textContent = `${busy} take${busy > 1 ? 's are' : ' is'} still being analysed. Wait until every card shows a result, then copy.`; return; }
  const text = resultsJson(), box = $('stCopyBox');
  try {
    await navigator.clipboard.writeText(text);
    $('stCopyHint').textContent = 'Copied. Paste it into the Sonmira thread.';
    box.hidden = true;
  } catch {
    box.hidden = false; box.value = text; box.select();
    $('stCopyHint').textContent = 'Copying was blocked here: the text is selected below, copy it and paste it into the thread.';
  }
}

// ---------- page ----------
function takeCard({ slot, title, ask }) {
  const t = state.get(slot);
  return `<article class="card take" id="take-${slot}">
    <header><h3>${slot} · ${esc(title)}</h3><label class="exp">Before singing, you expect ${tierSelect('expected', t.expected)}</label></header>
    <p class="ask">${esc(ask)}</p>
    <div class="rec"><button class="primary recbtn">● Record</button><span class="timer">0.0 / ${MAX_SEC} s</span></div>
    <div class="meter"><div></div></div>
    <div class="player" hidden><audio controls preload="metadata"></audio></div>
    <div class="out"></div>
    <div class="judge" hidden>
      <label>After listening back, this take deserves ${tierSelect('judged', t.judged, 'not judged yet')}</label>
      <input type="text" class="comment" placeholder="Optional note, e.g. “I was off-key at the end”" value="${esc(t.comment || '')}">
    </div>
    <button class="ghost rerun" hidden title="Re-measure with the current code and the saved word reading; no paid call">Re-analyse (free)</button>
  </article>`;
}

let started = false;
export async function initSingingTest() {
  if (started) return;
  started = true;
  const saved = await loadTakes().catch(() => []);
  for (const m of TAKES) state.set(m.slot, { slot: m.slot, expected: m.expect, judged: '', comment: '', blob: null, words: null, ...(saved.find((s) => s.slot === m.slot) || {}) });
  $('stTakes').innerHTML = TAKES.map(takeCard).join('');
  for (const { slot } of TAKES) {
    const card = $(`take-${slot}`), t = state.get(slot);
    card.querySelector('.recbtn').addEventListener('click', () => (rec?.slot === slot ? stopRecording() : startRecording(slot)));
    card.querySelector('.expected').addEventListener('change', (e) => { t.expected = e.target.value; saveTake(t); renderTake(slot); renderSummary(); });
    card.querySelector('.judged').addEventListener('change', (e) => { t.judged = e.target.value; saveTake(t); renderTake(slot); renderSummary(); });
    card.querySelector('.comment').addEventListener('change', (e) => { t.comment = e.target.value; saveTake(t); });
    card.querySelector('.rerun').addEventListener('click', () => analyse(slot));
    renderTake(slot);
  }
  renderSummary();
  $('stCopy').addEventListener('click', copyResults);
  $('stClear').addEventListener('click', async () => {
    if (!confirm('Delete all nine takes and their recordings from this browser?')) return;
    await clearTakes();
    started = false; state.clear(); view.clear();
    initSingingTest();
  });
  serverChecked = checkServer();
  // Saved takes are re-measured with the current code (free: the saved word
  // reading is reused, nothing is sent).
  for (const { slot } of TAKES) if (state.get(slot).blob) await analyse(slot);
}

let wordsAvailable = false, serverChecked = null;
async function checkServer() {
  try {
    const r = await fetch('/api/understand');
    const j = r.ok ? await r.json() : null;
    wordsAvailable = Boolean(j?.configured);
    $('stServer').textContent = j?.configured
      ? `Words are transcribed on the server with ${j.transcribeModel} and read with ${j.textModel}: about $0.004 per take, under $0.05 for all nine. No image is generated.`
      : 'This deployment can’t transcribe (no OpenAI key on the server), so the words aren’t checked: each tier comes from the singing alone, as if the words formed a complete phrase. Nothing is billed.';
  } catch {
    $('stServer').textContent = 'No transcription server here, so the words aren’t checked: each tier comes from the singing alone. Nothing is billed.';
  }
}

window.__singingTest = { state, view, resultsJson };

// Sonmira Watercolor Engine Playground.
//
// Records or loads a take, runs the real analysis (src/engine/analysis) and
// the real generator (src/engine/generate.js) in a worker, shows the painting
// beside what the engine measured and decided, and keeps every run in
// IndexedDB for side-by-side comparison. No values here are mocked: the only
// things the page adds are the developer overrides, which go to the engine's
// own override parameters.

import { EMOTIONS, MOTIFS, CALIBRATION } from '../src/engine/interpret/index.js';
import { PIGMENTS } from '../src/engine/art/palettes.js';
import { FAMILIES } from '../src/engine/direct/families.js';
import { REFERENCE_LIBRARY } from '../src/engine/direct/references.js';
import { checkLeakage } from '../src/engine/direct/leakage.js';
import { saveRun, deleteRun, listRuns } from './store.js';
import { initSingingTest } from './singing-test.js';

const MAX_SEC = 30;
const W = 720, H = 900;
const $ = (id) => document.getElementById(id);
const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- worker ----------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let nextId = 1;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  data.ok ? p.resolve(data) : p.reject(new Error(data.error));
};
worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker failed')); pending.clear(); };
const call = (msg, transfer = []) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  worker.postMessage({ id, ...msg }, transfer);
});

// ---------- state ----------
// clip: { blob, name, source: 'mic'|'upload', samples, sampleRate, durationSec, truncated }
let clip = null;
let analysis = null; // { features, ms } for the current clip
let busy = false;

for (const e of EMOTIONS) $('ovEmotion').add(new Option(e, e));
for (const m of MOTIFS) $('ovMotif').add(new Option(m, m));
for (const [id, f] of Object.entries(FAMILIES)) $('ovFamily').add(new Option(`${f.tier} · ${f.label}`, id));
// A pinned reference brings its own family (and so its tier's family rules).
const ACTIVE_REFS = REFERENCE_LIBRARY.filter((e) => e.active && FAMILIES[e.family]).sort((a, b) => (a.id < b.id ? -1 : 1));
for (const e of ACTIVE_REFS) $('ovReference').add(new Option(`${e.id} · ${FAMILIES[e.family].label}`, e.id));
$('ovReference').addEventListener('change', () => {
  const e = ACTIVE_REFS.find((x) => x.id === $('ovReference').value);
  if (e) { $('ovFamily').value = e.family; if ($('ovTier').value !== FAMILIES[e.family].tier) { $('ovTier').value = FAMILIES[e.family].tier; $('posRow').hidden = true; } }
});
$('ovFamily').addEventListener('change', () => {
  const e = ACTIVE_REFS.find((x) => x.id === $('ovReference').value);
  if (e && e.family !== $('ovFamily').value) $('ovReference').value = 'auto';
});

function setStatus(text) { $('status').textContent = text || ''; }
function setBusy(b) {
  busy = b;
  $('paintBtn').disabled = b;
  $('tiersBtn').disabled = b || !clip;
  $('artwork').classList.toggle('busy', b);
}

// ---------- audio in ----------
let actx = null;
const audioCtx = () => (actx ||= new AudioContext());

async function decode(blob) {
  const buf = await audioCtx().decodeAudioData(await blob.arrayBuffer());
  const n = Math.min(buf.length, Math.round(MAX_SEC * buf.sampleRate));
  const mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += ch[i] / buf.numberOfChannels;
  }
  return { samples: mono, sampleRate: buf.sampleRate, durationSec: n / buf.sampleRate, truncated: buf.length > n, fullSec: buf.length / buf.sampleRate };
}

async function setClip(blob, name, source) {
  setStatus('Decoding audio…');
  try {
    const d = await decode(blob);
    clip = { blob, name, source, ...d };
    analysis = null;
    $('clip').hidden = false;
    $('clipName').textContent = `${name} · ${d.durationSec.toFixed(1)} s${d.truncated ? ` (first ${MAX_SEC} s of ${d.fullSec.toFixed(1)} s)` : ''} · ${d.sampleRate} Hz`;
    $('player').src = URL.createObjectURL(blob);
    setStatus('Ready. Press Analyze & paint.');
  } catch (err) {
    clip = null;
    $('clip').hidden = true;
    setStatus(`This browser could not decode ${name} (${err.message || err}). WAV always works; M4A needs Chrome, Safari or Edge.`);
  }
  setBusy(false);
}

function clearClip() {
  clip = null; analysis = null;
  $('clip').hidden = true;
  $('player').removeAttribute('src');
  $('fileInput').value = '';
  setBusy(false);
}

$('fileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) setClip(f, f.name, 'upload');
});

// Recording: raw voice (no echo cancellation, noise suppression or AGC, which
// would flatten dynamics and smear pitch), auto-stop at 30 s.
let rec = null;
async function startRecording() {
  clearClip();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (err) {
    setStatus(`Microphone not available: ${err.message || err}. Allow microphone access for this page in the browser's site settings, then try again.`);
    return;
  }
  const ctx = audioCtx();
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  src.connect(an);
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const t0 = performance.now();
  const buf = new Float32Array(an.fftSize);
  let raf = 0;
  const tick = () => {
    const s = (performance.now() - t0) / 1000;
    $('timer').textContent = `${Math.min(s, MAX_SEC).toFixed(1)} / ${MAX_SEC} s`;
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (const v of buf) sum += v * v;
    $('meterFill').style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 400)}%`;
    if (s >= MAX_SEC) stopRecording(); else raf = requestAnimationFrame(tick);
  };
  rec = {
    stop: () => new Promise((res) => {
      cancelAnimationFrame(raf);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        src.disconnect();
        res(new Blob(chunks, { type: mr.mimeType || type || 'audio/webm' }));
      };
      mr.stop();
    }),
  };
  mr.start(250);
  tick();
  $('recBtn').textContent = '■ Stop';
  $('recBtn').classList.add('recording');
  setStatus('Recording… sing or hum, then press Stop.');
}
async function stopRecording() {
  if (!rec) return;
  const r = rec; rec = null;
  $('recBtn').textContent = '● Record';
  $('recBtn').classList.remove('recording');
  $('meterFill').style.width = '0';
  const blob = await r.stop();
  const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
  await setClip(blob, `recording-${new Date().toLocaleTimeString().replace(/\W/g, '')}.${ext}`, 'mic');
}
$('recBtn').addEventListener('click', () => (rec ? stopRecording() : startRecording()));
$('retryBtn').addEventListener('click', () => startRecording());

// ---------- overrides ----------
$('ovTier').addEventListener('change', () => { $('posRow').hidden = $('ovTier').value !== 'custom'; });
$('ovPos').addEventListener('input', () => { $('posOut').textContent = Number($('ovPos').value).toFixed(2); });
$('rollSeed').addEventListener('click', () => { $('seed').value = String((Math.random() * 2 ** 32) >>> 0); });

function readOverrides() {
  const tier = $('ovTier').value;
  const seedStr = $('seed').value.trim();
  const seed = /^\d+$/.test(seedStr) ? Number(seedStr) >>> 0 : undefined;
  return {
    tier,
    position: tier === 'custom' ? Number($('ovPos').value) : null,
    emotion: $('ovEmotion').value === 'auto' ? null : $('ovEmotion').value,
    motif: $('ovMotif').value === 'auto' ? null : $('ovMotif').value,
    family: $('ovFamily').value === 'auto' ? null : $('ovFamily').value,
    reference: $('ovReference').value === 'auto' ? null : $('ovReference').value,
    seed,
  };
}
const controlOverride = (ov) => (ov.tier === 'custom' ? ov.position : ov.tier === 'auto' ? undefined : ov.tier);

// ---------- engine ----------
async function analyze() {
  if (!clip) return null;
  if (!analysis) {
    setStatus('Analysing the voice…');
    const samples = clip.samples.slice(); // keep our copy; the worker gets its own
    const r = await call({ op: 'analyze', samples, sampleRate: clip.sampleRate }, [samples.buffer]);
    analysis = { features: r.features, ms: r.ms };
  }
  return analysis;
}

const engineOpts = (a, ov, control) => ({
  features: a?.features ?? null,
  noteText: $('note').value,
  vocalControlOverride: control,
  emotionOverride: ov.emotion ?? undefined,
  motifOverride: ov.motif ?? undefined,
  familyOverride: ov.family ?? undefined,
  seed: ov.seed,
  width: W, height: H,
});

async function paint(ov, control) {
  const a = await analyze();
  return $('provider').value === 'procedural' ? paintProcedural(a, ov, control) : paintAI(a, ov, control, $('provider').value);
}

async function paintProcedural(a, ov, control) {
  setStatus('Painting with the procedural renderer…');
  const r = await call({ op: 'paint', opts: engineOpts(a, ov, control) });
  const canvas = document.createElement('canvas');
  canvas.width = r.image.width; canvas.height = r.image.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.image.rgba.buffer), r.image.width, r.image.height), 0, 0);
  const png = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const meta = { ...r.meta, provider: 'procedural', providerLabel: 'Procedural renderer (JS, no AI)' };
  return { meta, canvas, png, features: a?.features ?? null, ms: { analyze: a?.ms ?? null, paint: r.ms } };
}

// Layers A–C run here (same code as the procedural path); the server builds
// the prompt from the spec and calls the provider with its own key.
// The Playground has no lyrics step, so the note (when given) is the subject,
// exactly as in the app when the words are not reliable; with no note,
// Gathered and Resolved paint an atmosphere of the motif.
async function paintAI(a, ov, control, provider) {
  const plan = await call({ op: 'plan', opts: engineOpts(a, ov, control) });
  const noteText = $('note').value.trim();
  const concept = noteText ? { text: noteText, theme: [], imagery: [], figurative: [], source: 'note' } : null;
  const spec = { ...plan.spec, concept, soundOnly: !concept && plan.spec.completeness === 'loose', ...(ov.reference ? { reference: ov.reference } : {}) };
  setStatus(`Generating with ${provider}… this usually takes 20–60 s.`);
  const t0 = performance.now();
  const resp = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, spec }) });
  const g = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` }));
  if (!g.ok) throw new Error(g.error || `HTTP ${resp.status}`);
  const img = new Image();
  img.src = g.image;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const png = await (await fetch(g.image)).blob();
  const meta = {
    ...plan.summary, focus: '50% 50%', method: `ai:${g.provider}/${g.model}`,
    family: g.family ?? plan.summary.family, familyLabel: g.familyLabel ?? plan.summary.familyLabel, familyRefs: g.familyRefs ?? plan.summary.familyRefs, swatches: g.swatches ?? plan.summary.swatches,
    provider: g.provider, providerLabel: `OpenAI ${g.model} (${g.quality})`, model: g.model, quality: g.quality, size: g.size, prompt: g.prompt, usage: g.usage ?? null,
    reference: g.reference ?? null, referenceSent: g.referenceSent ?? null, subjectSource: g.subjectSource ?? null, subject: g.subject ?? null,
    settings: g.settings ?? null, composition: g.composition ?? null, promptCheck: g.promptCheck ?? null, seed: g.seed ?? plan.summary.seed,
  };
  return { meta, canvas, png, features: a?.features ?? null, ms: { analyze: a?.ms ?? null, paint: performance.now() - t0, provider: g.ms } };
}

function makeRun(res, ov, groupId, label) {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    groupId: groupId ?? null,
    label: label ?? null,
    clip: clip ? { name: clip.name, source: clip.source, durationSec: clip.durationSec, truncated: clip.truncated, sampleRate: clip.sampleRate, type: clip.blob.type } : null,
    audio: clip?.blob ?? null,
    note: $('note').value,
    overrides: { ...ov, seed: ov.seed ?? null },
    features: res.features,
    result: res.meta,
    png: res.png,
    ms: res.ms,
    engine: res.meta.method,
  };
}

async function guarded(fn) {
  if (busy) return;
  setBusy(true);
  try { await fn(); } catch (err) { console.error(err); setStatus(`Something failed: ${err.message || err}`); }
  setBusy(false);
}

$('paintBtn').addEventListener('click', () => guarded(async () => {
  const ov = readOverrides();
  const res = await paint(ov, controlOverride(ov));
  const run = makeRun(res, ov);
  await saveRun(run);
  showArtwork([{ canvas: res.canvas, caption: captionFor(res.meta), run }]);
  showResults(run);
  setStatus(`Done in ${fmt((res.ms.analyze ?? 0) / 1000, 1)} s analysis + ${fmt(res.ms.paint / 1000, 1)} s painting. Saved to the library.`);
  refreshLibrary();
}));

// Same audio, note, emotion, motif and seed at the three tier presets, so
// only the vocal-control mapping differs.
$('tiersBtn').addEventListener('click', () => guarded(async () => {
  const ov = readOverrides();
  const groupId = crypto.randomUUID();
  const out = [];
  let seed = ov.seed, first = null;
  for (const tier of ['loose', 'gathered', 'resolved']) {
    const o = { ...ov, tier, position: null, seed };
    const res = await paint(o, tier);
    seed = res.meta.seed;
    first ||= res;
    const run = makeRun(res, { ...o, seed }, groupId, `tier comparison: ${tier}`);
    await saveRun(run);
    const mine = res.features && res.meta.interpretation.controlScore != null && measuredTierOf(res.meta.interpretation.controlScore) === tier;
    out.push({ canvas: res.canvas, caption: captionFor(res.meta, mine ? ' · this take' : ''), run });
    showArtwork(out, true);
  }
  showResults(out[0].run, { compareTiers: true });
  setStatus(`Painted all three tiers with seed ${seed}. The measured control for this take is shown on the right.`);
  refreshLibrary();
}));

const measuredTierOf = (score) => (score >= CALIBRATION.resolvedAt ? 'resolved' : score >= CALIBRATION.gatheredAt ? 'gathered' : 'loose');
function captionFor(m, extra = '') {
  return `<span><span style="text-transform:capitalize">${esc(m.tier)}<b>${extra}</b></span> · ${esc(m.providerLabel || 'Procedural renderer (JS, no AI)')}${m.familyLabel && m.provider !== 'procedural' ? ` · ${esc(m.familyLabel)}` : ''}</span><span>position ${fmt(m.stylePosition)} · seed ${m.seed}</span>`;
}
function showArtwork(items, trio = false) {
  const el = $('artwork');
  const paired = items.some((x) => x.run?.result?.reference);
  el.className = `artwork${paired ? ' paired' : trio ? ' trio' : ''}`;
  el.replaceChildren(...items.map(({ canvas, caption, run }) => {
    if (run?.result?.reference) return pairView(run, canvas);
    const f = document.createElement('figure');
    const c = document.createElement('figcaption');
    c.innerHTML = caption;
    f.append(canvas, c);
    return f;
  }));
}

// ---------- reference ↔ output ----------
// The reference comes from /api/reference by id (the server reads it from
// the private store; no storage URL reaches this page). Object URLs are
// cached per id for the session.
const refUrls = new Map();
function referenceUrl(id) {
  if (!refUrls.has(id)) {
    refUrls.set(id, fetch(`/api/reference?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok && r.headers.get('content-type')?.startsWith('image/') ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => URL.createObjectURL(b))
      .catch((e) => { refUrls.delete(id); throw e; }));
  }
  return refUrls.get(id);
}

const SUBJECT_FROM = { lyrics: 'the lyrics', note: 'the note', sound: 'the sound only', atmosphere: 'an atmosphere of the motif (no words, no note)', family: 'the family' };
function settingsList(r) {
  const m = r.result, st = m.settings ?? {}, x = st.expression;
  const pc = m.promptCheck;
  const check = !pc ? '—' : pc.verdict === 'ok' ? 'clean' : `${pc.verdict}: ${[...pc.people, ...pc.leaks.map((l) => l.word), ...pc.unrequested.map((l) => l.word)].map(esc).join(', ')}`;
  return `<dl class="kv">
    <dt>Reference</dt><dd><b>${esc(m.reference)}</b>${m.referenceSent === false ? ' <span class="warn">not sent</span>' : ''}</dd>
    <dt>Style family</dt><dd>${esc(m.familyLabel)} <span class="hint">${esc(m.family)}</span></dd>
    <dt>Tier</dt><dd>${esc(st.tier ?? m.tier)}</dd>
    <dt>Emotion · motif</dt><dd>${esc(st.emotion ?? m.emotion)} · ${esc(st.motif ?? m.motif)}</dd>
    <dt>Energy</dt><dd>${esc(st.energy ?? m.energy ?? '—')}${x ? ` · ${esc([x.range, x.flow, x.dynamics, x.vibrato ? 'vibrato' : null].filter(Boolean).join(' / '))}` : ''}</dd>
    <dt>Subject</dt><dd><b>${esc(m.subject ?? '—')}</b><div class="hint">from ${esc(SUBJECT_FROM[m.subjectSource] ?? m.subjectSource ?? '—')}</div></dd>
    <dt>Composition</dt><dd>${m.composition ? esc(`${m.composition.viewpoint}; focus ${m.composition.placement}; ${m.composition.scale}; ${m.composition.staging}`) : '—'}</dd>
    <dt>Seed</dt><dd>${m.seed}</dd>
    <dt>Model</dt><dd>${esc(m.model ?? '—')} · ${esc(m.quality ?? '—')} · ${esc(m.size ?? '—')}</dd>
    <dt>Prompt check</dt><dd>${check}</dd>
    <dt>Made</dt><dd>${new Date(r.createdAt).toLocaleString()}</dd>
  </dl>`;
}
function pairView(r, canvas = null) {
  const el = document.createElement('div');
  el.className = 'pair';
  const ref = document.createElement('figure');
  const refImg = document.createElement('img');
  refImg.alt = `Reference ${r.result.reference}`;
  ref.append(refImg, Object.assign(document.createElement('figcaption'), { textContent: `Reference · ${r.result.reference}` }));
  referenceUrl(r.result.reference).then((u) => { refImg.src = u; }).catch((e) => { ref.classList.add('missing'); ref.querySelector('figcaption').textContent = `Reference ${r.result.reference} unavailable (${e.message})`; });
  const out = document.createElement('figure');
  let art = canvas;
  if (!art) { art = document.createElement('img'); const u = URL.createObjectURL(r.png); urls.push(u); art.src = u; }
  out.append(art, Object.assign(document.createElement('figcaption'), { textContent: `Generated · ${r.result.tier} · ${r.result.familyLabel ?? r.result.family}` }));
  const meta = document.createElement('div');
  meta.className = 'pairmeta';
  meta.innerHTML = settingsList(r);
  meta.append(leakageReview(r));
  el.append(ref, out, meta);
  return el;
}

// Image-level leakage check, with no paid call: a reviewer writes what the
// painting shows; it is compared with the words (note or lyrics) and with
// what this reference depicts (leakage.js). Saved with the run.
const VERDICT = { ok: 'no leakage found', review: 'objects the words do not name', leak: 'leakage' };
function leakageReview(r) {
  const box = document.createElement('div');
  box.className = 'review';
  box.innerHTML = `<label>What the painting shows <input type="text" placeholder="e.g. moon, silver path on water, two rowboats with ropes"></label><div class="verdict"></div>`;
  const input = box.querySelector('input'), out = box.querySelector('.verdict');
  const show = (text) => {
    if (!text.trim()) { out.textContent = ''; out.className = 'verdict'; return null; }
    const res = checkLeakage({ depicted: text, note: r.note, reference: r.result.reference, family: r.result.family });
    const items = [...res.people.map((p) => `person: ${p}`), ...res.leaks.map((l) => `from ${res.from}: ${l.word}`), ...res.unrequested.map((l) => `not in the words: ${l.word}`)];
    out.className = `verdict ${res.verdict}`;
    out.textContent = `${VERDICT[res.verdict]}${items.length ? ` · ${items.join(', ')}` : ''}`;
    return res;
  };
  input.value = r.review?.depicted ?? '';
  show(input.value);
  input.addEventListener('change', async () => {
    const res = show(input.value);
    r.review = input.value.trim() ? { depicted: input.value.trim(), verdict: res.verdict, people: res.people, leaks: res.leaks, unrequested: res.unrequested, at: Date.now() } : null;
    await saveRun(r).catch(() => {});
  });
  return box;
}

// ---------- results ----------
function warningsFor(run, compareTiers) {
  const f = run.features, m = run.result, w = [];
  const it = m.interpretation;
  if (!f) w.push('No audio was given, so vocal control was not measured. The painting uses the default or the override.');
  else {
    if ((f.activity?.soundingSec ?? 0) < 0.3) w.push('The take is essentially silent. Check the input level or microphone permission.');
    else if ((f.activity?.voicedSec ?? 0) < CALIBRATION.minVoicedSec) w.push(`Less than ${CALIBRATION.minVoicedSec} s of clearly pitched sound, so the painting is kept loose.`);
    if (m.controlConfidence < 0.5) w.push(`Low confidence (${fmt(m.controlConfidence)}): too little clear pitch to trust the measurement, so the score is pulled toward ${CALIBRATION.prior}.`);
    if (run.clip?.truncated) w.push(`Only the first ${MAX_SEC} s were analysed.`);
  }
  if (compareTiers) w.push('Tier comparison: the three paintings use the Loose, Gathered and Resolved presets. The score below is what this take measured.');
  else if (it.sources.completeness === 'override') w.push('Vocal control is set by a developer override. The measured score is shown for reference only.');
  return w;
}

function bar(label, v) {
  return `<dt>${label}</dt><dd>${fmt(v)}<div class="bar"><i style="width:${Math.round((v ?? 0) * 100)}%"></i></div></dd>`;
}

function showResults(run, { compareTiers = false } = {}) {
  const m = run.result, it = m.interpretation, f = run.features, s = it.signals;
  const srcName = { voice: 'from the voice', note: 'from the note', default: 'default', override: 'override' };
  const measuredTier = it.controlScore == null || !f ? '—' : measuredTierOf(it.controlScore);
  const pig = m.swatches && m.provider !== 'procedural'
    ? m.swatches.map((p) => `<span style="--c:${p.hex}">${esc(p.name)}</span>`).join('')
    : (m.pigments || []).map((p) => `<span style="--c:${PIGMENTS[p]}">${p}</span>`).join('');
  $('results').innerHTML = `
    <h2>Analysis${run.clip ? ` · ${esc(run.clip.name)}` : ''}</h2>
    ${warningsFor(run, compareTiers).map((t) => `<p class="warn">${esc(t)}</p>`).join('')}
    <div class="big">
      <div><div class="lab">Vocal control</div><div class="val">${compareTiers ? 'all three' : esc(m.tier)}</div><div class="src">${compareTiers ? 'tier comparison' : srcName[it.sources.completeness]}</div></div>
      <div><div class="lab">Emotion</div><div class="val">${esc(m.emotion)}</div><div class="src">${srcName[it.sources.emotion]}</div></div>
      <div><div class="lab">Motif</div><div class="val">${esc(m.motif)}</div><div class="src">${srcName[it.sources.motif]}${it.secondaryMotif ? ` · also ${esc(it.secondaryMotif)}` : ''}</div></div>
    </div>
    <dl class="kv">
      <dt>Control score</dt><dd>${f ? `${fmt(m.controlScore)} → ${measuredTier}` : 'not measured'}</dd>
      <dt>Confidence</dt><dd>${f ? fmt(m.controlConfidence) : '—'}</dd>
      <dt>Painted at</dt><dd>${compareTiers ? 'style positions 0, 0.5 and 1' : `style position ${fmt(m.stylePosition)}`} (0 loose · 0.5 gathered · 1 resolved)</dd>
    </dl>
    ${s ? `<div class="sect"><h3>Signals behind the score</h3><dl class="kv">
      ${bar('Sustain', s.sustain)}${bar('Continuity', s.continuity)}${bar('Flow', s.flow)}
    </dl><p class="hint">Thresholds: gathered ≥ ${CALIBRATION.gatheredAt}, resolved ≥ ${CALIBRATION.resolvedAt}.</p></div>` : ''}
    ${f ? `<div class="sect"><h3>Measurements</h3><dl class="kv">
      <dt>Length</dt><dd>${fmt(f.durationSec, 1)} s</dd>
      <dt>Pitched sound</dt><dd>${fmt(f.activity.voicedSec, 1)} s (${Math.round((f.activity.voicedRatio ?? 0) * 100)}% of sounding)</dd>
      <dt>Pauses</dt><dd>${f.pauses.count} (longest ${fmt(f.pauses.longestSec, 1)} s)</dd>
      <dt>Phrases</dt><dd>${f.phrases?.count ?? '—'}${f.phrases?.meanSec ? ` · mean ${fmt(f.phrases.meanSec, 1)} s` : ''}</dd>
      <dt>Median pitch</dt><dd>${f.pitch.medianHz ? `${fmt(f.pitch.medianHz, 0)} Hz` : '—'}</dd>
      <dt>Pitch range</dt><dd>${fmt(f.pitch.rangeSemitones, 1)} semitones</dd>
      <dt>Pitch continuity</dt><dd>${fmt(f.pitch.continuity)}</dd>
      <dt>Pitch clarity</dt><dd>${fmt(f.clarity?.mean)}</dd>
      <dt>Onsets</dt><dd>${f.onsets?.count ?? '—'} · regularity proxy ${fmt(f.onsets?.regularityProxy)}</dd>
      <dt>Dynamic range</dt><dd>${fmt(f.energy?.dynamicRangeDb, 1)} dB</dd>
    </dl></div>` : ''}
    <div class="sect"><h3>Painting</h3><dl class="kv">
      <dt>Pigments</dt><dd><div class="swatches">${pig}</div></dd>
      <dt>Seed</dt><dd>${m.seed}</dd>
      ${m.familyLabel && m.provider !== 'procedural' ? `<dt>Style family</dt><dd>${esc(m.familyLabel)}${m.familyRefs ? `<div class="hint">from ${esc(m.familyRefs.join(', '))}</div>` : ''}</dd>` : ''}
      <dt>Provider</dt><dd>${esc(m.providerLabel || 'Procedural renderer (JS, no AI)')}</dd>
      <dt>Method</dt><dd>${esc(m.method)}</dd>
      ${m.energy ? `<dt>Energy</dt><dd>${esc(m.energy)}</dd>` : ''}
      ${m.prompt ? `<dt>Prompt</dt><dd><details><summary>show</summary><pre class="prompt">${esc(m.prompt)}</pre></details></dd>` : ''}
      <dt>Note</dt><dd>${run.note ? esc(run.note) : '<span class="hint">none</span>'}</dd>
    </dl></div>`;
}

// ---------- library & compare ----------
const selected = new Set();
let urls = [];
const download = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const runJson = (r) => {
  const { audio, png, ...rest } = r;
  return new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' });
};
const runName = (r) => `sonmira-${new Date(r.createdAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${r.result.tier}`;

function runCard(r, { compact = false } = {}) {
  const url = URL.createObjectURL(r.png); urls.push(url);
  const m = r.result, f = r.features, it = m.interpretation;
  const el = document.createElement('div');
  el.className = `run${!compact && selected.has(r.id) ? ' sel' : ''}`;
  el.innerHTML = `
    <img src="${url}" alt="">
    <div class="t">${esc(m.tier)} · ${esc(m.emotion)} · ${esc(m.motif)}</div>
    ${m.reference ? `<div class="m">reference <b>${esc(m.reference)}</b> · ${esc(m.familyLabel)}</div>` : ''}
    <div class="m prov">${esc(m.providerLabel || 'Procedural renderer (JS, no AI)')}</div>
    <div class="m">${new Date(r.createdAt).toLocaleString()}${r.label ? ` · ${esc(r.label)}` : ''}</div>
    <div class="m">${r.clip ? `${esc(r.clip.name)} (${r.clip.source})` : 'no audio'}</div>
    <dl class="kv" style="margin-top:6px">
      <dt>Control</dt><dd>${f ? `${fmt(m.controlScore)} · conf ${fmt(m.controlConfidence)}` : '—'}</dd>
      <dt>Tier source</dt><dd>${it.sources.completeness}</dd>
      <dt>Position</dt><dd>${fmt(m.stylePosition)}</dd>
      <dt>Emotion</dt><dd>${it.sources.emotion}</dd>
      <dt>Motif</dt><dd>${it.sources.motif}</dd>
      <dt>Seed</dt><dd>${m.seed}</dd>
      ${compact && f ? `<dt>Pitched</dt><dd>${fmt(f.activity.voicedSec, 1)} s</dd>
      <dt>Continuity</dt><dd>${fmt(f.pitch.continuity)}</dd>
      <dt>Pauses</dt><dd>${f.pauses.count}</dd>
      <dt>Range</dt><dd>${fmt(f.pitch.rangeSemitones, 1)} st</dd>` : ''}
      ${compact ? `<dt>Note</dt><dd>${esc(r.note) || '—'}</dd>` : ''}
    </dl>
    ${compact ? '' : `<div class="row">
      <label class="pick"><input type="checkbox" ${selected.has(r.id) ? 'checked' : ''}> compare</label>
      <button data-a="load">Load</button>
      <button data-a="png">PNG</button>
      <button data-a="json">JSON</button>
      ${r.audio ? '<button data-a="audio">Audio</button>' : ''}
      <button data-a="del">Delete</button>
    </div>`}`;
  if (!compact) {
    el.querySelector('input').addEventListener('change', (e) => {
      e.target.checked ? selected.add(r.id) : selected.delete(r.id);
      el.classList.toggle('sel', e.target.checked);
      $('compareBtn').disabled = !canCompare();
    });
    el.querySelector('.row').addEventListener('click', async (e) => {
      const a = e.target.dataset?.a;
      if (a === 'png') download(r.png, `${runName(r)}.png`);
      if (a === 'json') download(runJson(r), `${runName(r)}.json`);
      if (a === 'audio') download(r.audio, r.clip?.name || `${runName(r)}.audio`);
      if (a === 'del') { await deleteRun(r.id); selected.delete(r.id); refreshLibrary(); }
      if (a === 'load') loadRun(r);
    });
  }
  return el;
}

let runsCache = [];
// One run with a reference is already a comparison (reference ↔ output).
const canCompare = () => selected.size >= 2 || runsCache.some((r) => selected.has(r.id) && r.result.reference);
async function refreshLibrary() {
  urls.forEach(URL.revokeObjectURL); urls = [];
  runsCache = await listRuns().catch(() => []);
  $('libCount').textContent = runsCache.length ? `(${runsCache.length})` : '';
  $('runs').replaceChildren(...runsCache.map((r) => runCard(r)));
  for (const id of [...selected]) if (!runsCache.some((r) => r.id === id)) selected.delete(id);
  $('compareBtn').disabled = !canCompare();
  if (!$('compare').hidden) renderCompare();
}
// Runs painted from a reference compare as rows of reference ↔ output with
// their settings; other runs keep the compact card.
function renderCompare() {
  const picked = runsCache.filter((r) => selected.has(r.id)).sort((a, b) => a.createdAt - b.createdAt);
  const paired = picked.filter((r) => r.result.reference), plain = picked.filter((r) => !r.result.reference);
  const grid = document.createElement('div');
  grid.className = 'compare-cards';
  grid.replaceChildren(...plain.map((r) => runCard(r, { compact: true })));
  $('compare').replaceChildren(...paired.map((r) => pairView(r)), ...(plain.length ? [grid] : []));
  $('compare').classList.toggle('paired', paired.length > 0);
  $('compare').hidden = picked.length < 1 || (picked.length < 2 && !paired.length);
}
// Imports runs made elsewhere (e.g. a validation script) from a JSON bundle
// { kind: 'sonmira-runs', runs: [run with png as a data URL] }, so they can
// be compared here like runs painted in this page. Imported runs are
// selected for comparison.
async function importRuns(file) {
  const data = JSON.parse(await file.text());
  if (data?.kind !== 'sonmira-runs' || !Array.isArray(data.runs)) throw new Error('not a Sonmira runs file');
  let n = 0;
  for (const r of data.runs) {
    if (typeof r?.id !== 'string' || !r.result || typeof r.png !== 'string' || !r.png.startsWith('data:image/')) continue;
    const png = await (await fetch(r.png)).blob();
    await saveRun({ ...r, png, audio: null, imported: { from: file.name, at: Date.now() } });
    selected.add(r.id); n++;
  }
  await refreshLibrary();
  if (n) { renderCompare(); $('compare').scrollIntoView({ behavior: 'smooth' }); }
  return n;
}
$('importRuns').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { const n = await importRuns(f); $('libHint').textContent = `Imported ${n} run${n === 1 ? '' : 's'} from ${f.name}; they are selected for comparison below.`; }
  catch (err) { $('libHint').textContent = `Could not import ${f.name}: ${err.message}`; }
  e.target.value = '';
});
$('compareBtn').addEventListener('click', () => { renderCompare(); $('compare').scrollIntoView({ behavior: 'smooth' }); });
$('clearSel').addEventListener('click', () => { selected.clear(); $('compare').hidden = true; refreshLibrary(); });

// Restores a saved run into the studio: same audio, note and overrides, so it
// can be repainted or varied.
async function loadRun(r) {
  switchView('studio');
  $('note').value = r.note || '';
  const ov = r.overrides || {};
  $('ovTier').value = ov.tier || 'auto';
  $('posRow').hidden = ov.tier !== 'custom';
  if (ov.position != null) { $('ovPos').value = ov.position; $('posOut').textContent = Number(ov.position).toFixed(2); }
  $('ovEmotion').value = ov.emotion || 'auto';
  $('ovMotif').value = ov.motif || 'auto';
  $('ovFamily').value = ov.family || 'auto';
  $('ovReference').value = ov.reference || 'auto';
  $('seed').value = String(r.result.seed);
  const prov = r.result.provider || 'procedural';
  if (!$('provider').querySelector(`option[value=${prov}]`)?.disabled) $('provider').value = prov;
  if (r.audio) await setClip(r.audio, r.clip?.name || 'saved take', r.clip?.source || 'upload');
  else clearClip();
  const img = new Image(); img.src = URL.createObjectURL(r.png);
  showArtwork([{ canvas: img, caption: captionFor(r.result), run: r }]);
  showResults(r);
  setStatus('Loaded from the library with its seed. Press Analyze & paint to repaint it.');
}

function switchView(v) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === v);
  $('studio').hidden = v !== 'studio';
  $('library').hidden = v !== 'library';
  $('refs').hidden = v !== 'refs';
  $('validation').hidden = v !== 'validation';
  $('singing').hidden = v !== 'singing';
  if (v === 'validation') loadValidation();
  if (v === 'singing') initSingingTest();
}

// ---------- validation runs ----------
// Saved validation runs (playground/validation/*.json and their images),
// shown as reference ↔ output pairs. Open directly with ?view=validation.
let validationShown = false;
async function loadValidation() {
  if (validationShown) return;
  validationShown = true;
  const box = $('valSets');
  try {
    const { sets } = await (await fetch('validation/index.json', { cache: 'no-cache' })).json();
    const shown = await Promise.all(sets.map(async (file) => {
      const v = await (await fetch(`validation/${file}`, { cache: 'no-cache' })).json();
      const runs = await Promise.all(v.runs.map(async (r) => ({ ...r, png: await (await fetch(r.image)).blob() })));
      const sec = document.createElement('section');
      sec.className = 'valset';
      const h = document.createElement('h2');
      h.textContent = v.title;
      const grid = document.createElement('div');
      grid.className = 'compare paired';
      grid.replaceChildren(...runs.map((r) => pairView(r)));
      if (v.limitations?.length) {
        const lim = document.createElement('div');
        lim.className = 'limitations';
        lim.innerHTML = `<h3>Known limitations</h3><ul>${v.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
        sec.append(h, lim);
      } else sec.append(h);
      sec.append(...(v.strips ?? []).map((st) => tierStrip(st, runs)), grid);
      return sec;
    }));
    box.replaceChildren(...shown);
  } catch (e) {
    validationShown = false;
    const h = document.createElement('h2');
    h.textContent = `Could not load the validation runs: ${e.message}`;
    box.replaceChildren(h);
  }
}

// Same words and seed at each tier, the generated images side by side.
function tierStrip(st, runs) {
  const box = document.createElement('div');
  box.className = 'tierstrip';
  const h = document.createElement('h3');
  h.textContent = st.title;
  const row = document.createElement('div');
  row.className = 'tierrow';
  for (const id of st.runs) {
    const r = runs.find((x) => x.id === id);
    if (!r) continue;
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    const u = URL.createObjectURL(r.png); urls.push(u); img.src = u;
    img.alt = `${r.result.tier} · ${r.result.familyLabel ?? r.result.family}`;
    fig.append(img, Object.assign(document.createElement('figcaption'), { textContent: `${r.result.tier} · ${r.result.familyLabel ?? r.result.family} · ${r.result.reference}` }));
    row.append(fig);
  }
  box.append(h, row);
  return box;
}

// ---------- reference check ----------
// The server reads every reference in its registry; each thumbnail is then
// loaded the way the comparison loads it (/api/reference by id).
async function checkReferences() {
  $('refCheckBtn').disabled = true;
  $('refSummary').className = 'refsummary';
  $('refSummary').textContent = 'Reading every reference on the server…';
  $('refGrid').replaceChildren();
  try {
    const r = await fetch('/api/reference?check=1');
    const c = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!c.items) throw new Error(c.error || `HTTP ${r.status}`);
    const shown = await Promise.all(c.items.map(async (it) => {
      const card = document.createElement('figure');
      card.className = `refcard ${it.ok ? '' : 'bad'}`;
      card.dataset.id = it.id;
      const img = document.createElement('img');
      let displayed = false;
      if (it.ok && it.active) {
        try { img.src = await referenceUrl(it.id); await img.decode(); displayed = true; } catch { /* reported below */ }
      }
      card.classList.toggle('bad', !(it.ok && (displayed || !it.active)));
      const fam = FAMILIES[it.family];
      card.append(img, Object.assign(document.createElement('figcaption'), {
        innerHTML: `<b>${esc(it.id)}</b> ${it.active ? '' : '<span class="hint">(inactive)</span>'}<br>${esc(fam ? `${fam.tier} · ${fam.label}` : it.family ?? 'no family')}<br>${it.ok ? `${Math.round(it.bytes / 1024)} KB · ${esc(it.mime)}${it.active && !displayed ? ' · <span class="warn">did not display</span>' : ''}` : `<span class="warn">${esc(it.error || 'failed')}</span>`}`,
      }));
      $('refGrid').append(card);
      return it.active && it.ok && displayed;
    }));
    $('refGrid').replaceChildren(...[...$('refGrid').children].sort((x, y) => (x.dataset.id < y.dataset.id ? -1 : 1)));
    const okCount = shown.filter(Boolean).length;
    const all = okCount === c.active && c.ok;
    const reg = c.storeRegistry;
    $('refSummary').className = `refsummary ${all ? 'good' : 'bad'}`;
    $('refSummary').textContent = `${okCount} of ${c.active} active references load and display from this deployment's store (${c.store}), checked against the app's tested list${c.failed?.length ? `. Image missing or unreadable: ${c.failed.join(', ')}` : ''}.${reg ? ` For information, the store's own list has ${reg.entries} entries${reg.missing.length ? `, lacks ${reg.missing.join(', ')}` : ''}${reg.otherFamily.length ? `, files ${reg.otherFamily.join(', ')} under another family` : ''}${reg.extraActive.length ? `, has extra ${reg.extraActive.join(', ')}` : ''}; it no longer affects which reference is painted.` : ''}`;
  } catch (e) {
    $('refSummary').className = 'refsummary bad';
    $('refSummary').textContent = `Reference check failed: ${e.message}`;
  }
  $('refCheckBtn').disabled = false;
}
$('refCheckBtn').addEventListener('click', checkReferences);
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => switchView(t.dataset.view));

async function checkProviders() {
  const opt = $('provider').querySelector('option[value=openai]');
  try {
    const r = await fetch('/api/generate');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const p = (await r.json()).providers?.openai;
    if (p?.configured) { $('providerHint').textContent = `OpenAI is configured on the server (${p.model}, ${p.quality} quality). Each AI painting is billed to that account.`; return; }
    opt.disabled = true;
    $('providerHint').textContent = 'OpenAI is not configured: add OPENAI_API_KEY to the server environment. The procedural renderer still works.';
  } catch {
    opt.disabled = true;
    $('providerHint').textContent = 'No generation server here, so only the procedural renderer is available.';
  }
}

setBusy(false);
const startView = new URLSearchParams(location.search).get('view');
if (['library', 'refs', 'validation', 'singing'].includes(startView)) switchView(startView);
checkProviders();
refreshLibrary();
window.__playground = { ready: true };

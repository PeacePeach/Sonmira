// Sing (create): ready → singing → preview → generating → result → save.
// Talks to the engine only through the contract: createLiveSession / generate.
//
// After the painting arrives the result is two steps on one screen, one
// continuous motion: the small preview grows into the detail page's artwork
// (expanded: listen, then Next), then shrinks to a thumbnail beside the
// player while the title and the optional journal take the space (journal:
// Save). The same painting, player and audio carry through both steps.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createPainting } from '../ui/painting.js';
import { illustration } from '../ui/illustration.js';
import { createPlayer } from '../ui/player.js';
import { createRecorder, MicError } from '../recorder.js';
import { clock, dayKey, longDate } from '../format.js';
import { openShareSheet } from '../share/sheet.js';
import { openPaywall } from '../paywall/paywall.js';
import { usesLabel } from '../paywall/copy.js';
import { takeOf } from '../drafts/index.js';
import { withGenerationKey, guardMessage } from '../protect/client.js';
import { MAX_SECONDS } from '../settings.js';
import { titleField, journalField } from '../ui/text-field.js';
import { morph as morphCard } from '../ui/morph.js';

const SINGING_LINES = ['Keep going…', 'Let it out.', 'Softly, softly.', 'That’s it.'];
const FINDING = 'Finding the shape of your song…';
// Loading copy for the processing steps an engine reports (onStage). An
// engine that reports none keeps the neutral FINDING line throughout.
const STAGE_COPY = {
  listening: (i) => (i?.words ? 'Listening to your words…' : 'Listening…'),
  feeling: () => 'Finding the feeling…',
  painting: () => 'Letting colours take shape…',
};
const MIN_LINE_MS = 1400; // each line stays readable; steps are never invented

const MIC_COPY = {
  denied: ['The microphone is off.', 'Sonmira needs to hear you to paint. Allow microphone access for this page in your browser settings, then try again.'],
  notfound: ['No microphone found.', 'Connect a microphone, or open Sonmira on your phone.'],
  busy: ['The microphone is busy.', 'Another app may be using it. Close it, then try again.'],
  insecure: ['The microphone needs a secure page.', 'Open Sonmira from localhost or an https:// address.'],
  unsupported: ['This browser can’t record.', 'Try Safari on iPhone, or a recent Chrome.'],
  error: ['Something interrupted the microphone.', 'Please try again.'],
};

// params.draft: the key of a draft to return to (from the diary's "waiting" sheet).
export function mountSing(app, { draft: draftKey = null } = {}) {
  const maxSeconds = MAX_SECONDS;
  const painting = createPainting({ ratio: '32' });
  const fill = h('div', { class: 'rec-fill' });
  const tLabel = h('span', {}, clock(0));
  const progress = h('div', {}, h('div', { class: 'rec-track' }, fill), h('div', { class: 'rec-times tabular' }, tLabel, h('span', {}, clock(maxSeconds))));
  // Share appears in the top bar only once a painting exists (result state).
  const shareBtn = h('button', { class: 'icon-btn', 'aria-label': 'Share', hidden: true, onClick: () => {
    player?.stop();
    sheet = openShareSheet(app, { painting: result, note: noteDraft.trim(), date: dayKey(), audio: take.audio, durationSec: take.durationSec });
  } }, icon('share'));
  const navRight = h('div', { class: 'spacer44' }, shareBtn);
  const phaseHost = h('div', { style: 'flex:1;display:flex;flex-direction:column;min-height:0' });
  // Beside the thumbnail in the journal step: the result's player.
  const canvasSide = h('div', { class: 'canvas-side' });
  const canvas = h('div', { class: 'sing-canvas' }, painting.el, progress, canvasSide);
  const el = h('div', { class: 'sing', 'data-screen': 'sing' },
    h('div', { class: 'navrow' },
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: close }, icon('close')),
      h('span', { class: 'date' }, longDate(dayKey())),
      navRight),
    canvas,
    phaseHost);

  // take state
  let phase = 'ready', sheet = null, recorder = null, session = null, take = null, result = null, player = null, timers = [], noteDraft = '', journalDraft = '';
  let hint = '';
  let usesEl = null;
  // When the take was sung (a draft opened later keeps its own day).
  let takeDate = null, takeCreatedAt = null;
  // What Create painting will use, kept current if a purchase lands meanwhile.
  const offBilling = app.billing.onChange(() => { if (usesEl) usesEl.textContent = usesLabel(app.billing.status()); });

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const show = (node) => { player?.destroy(); player = null; shareBtn.hidden = true; smallCanvas(); phaseHost.replaceChildren(node); };
  const setProgress = (t) => { fill.style.transform = `scaleX(${Math.min(1, t / maxSeconds).toFixed(4)})`; tLabel.textContent = clock(t); };

  // ── ready ────────────────────────────────────────────────────────────────
  function ready() {
    phase = 'ready';
    progress.style.display = '';
    setProgress(0);
    show(h('div', { class: 'phase centered', 'data-phase': 'ready' },
      h('div', { style: 'text-align:center' },
        h('h1', { class: 'serif' }, 'Sing a moment.'),
        hint ? h('div', { class: 'soft-warning', style: 'margin-top:10px' }, hint)
          : h('div', { class: 'lede' }, 'A hum, a line, a lullaby. The color follows your voice.')),
      h('div', { class: 'mic-stack' },
        h('button', { class: 'mic-btn', 'aria-label': 'Start recording', onClick: startSinging }, icon('mic', { size: 'lg', tone: 'inverse' })),
        h('span', { class: 'mic-label' }, `Tap to begin · up to ${maxSeconds} seconds`))));
  }

  // ── singing ──────────────────────────────────────────────────────────────
  function startSinging() {
    if (phase !== 'ready') return;
    phase = 'starting';
    hint = '';
    painting.setStrokes([]); painting.setArtwork(null);
    painting.el.classList.add('alive'); // the washes live until the artwork covers them
    const line = h('div', { class: 'line serif' }, SINGING_LINES[0]);
    const note = h('div', { class: 'hint' }, 'Waiting for the microphone…');
    const halo = h('div', { class: 'halo' });
    show(h('div', { class: 'phase centered', 'data-phase': 'singing' },
      h('div', { style: 'text-align:center' }, line, note),
      h('div', { class: 'mic-stack' },
        h('div', { class: 'halo-wrap' }, halo, h('button', { class: 'mic-btn', 'aria-label': 'Stop recording', onClick: stopSinging }, h('div', { class: 'stop-square' }))),
        h('span', { class: 'mic-label' }, 'Tap to finish'))));

    recorder = createRecorder({
      maxSeconds,
      simulate: app.dev.simulate || app.dev.preview,
      onReady: (sampleRate) => {
        session = app.engine.createLiveSession({ sampleRate, maxSeconds });
        phase = 'singing';
        note.textContent = app.dev.preview ? 'Preview: a sample voice sings, the microphone isn’t available here' : app.dev.simulate ? 'Listening (sample voice)' : 'Listening';
      },
      onFrame: (samples, t) => {
        if (phase !== 'singing') return;
        setProgress(t);
        line.textContent = SINGING_LINES[Math.floor(t / 3.5) % SINGING_LINES.length];
        let sig;
        try { sig = session.push(samples); } catch (e) { console.warn('[sonmira] engine push failed', e); return; }
        painting.addStroke(sig.stroke, true);
        painting.setVoice(sig.level);
        halo.style.transform = `scale(${(1 + sig.level * 0.55).toFixed(3)})`;
      },
      onLimit: stopSinging,
      onInterrupted: stopSinging,
    });
    recorder.start().catch((e) => {
      recorder = null;
      if (phase === 'gone') return;
      micError(e instanceof MicError ? e.kind : 'error');
    });
  }

  async function stopSinging() {
    if (phase !== 'singing') return;
    phase = 'stopping';
    painting.setVoice(0); // the wash settles as the voice stops
    const rec = await recorder.stop();
    recorder = null;
    if (phase === 'gone') return;
    let analysis;
    try { analysis = session.finish(); }
    catch (e) { console.warn('[sonmira] engine finish failed', e); analysis = { durationSec: rec.durationSec, flags: { silent: false, tooShort: rec.durationSec < 1.5 }, wash: [] }; }
    session = null;
    if (analysis.flags.tooShort || rec.durationSec < 1) {
      hint = 'That was very short. Hold a note a little longer.';
      painting.setStrokes([]);
      return ready();
    }
    // key: one per take, so a retried generation is never counted twice, and
    // never paid twice (it is also the painting service's idempotency key).
    takeDate = dayKey(); takeCreatedAt = Date.now();
    take = { key: app.billing.newKey(), audio: rec.blob, durationSec: Math.round(rec.durationSec * 10) / 10, analysis };
    preview();
  }

  // ── preview ──────────────────────────────────────────────────────────────
  function preview() {
    phase = 'preview';
    progress.style.display = 'none';
    const p = createPlayer({ blob: take.audio, durationSec: take.durationSec });
    show(h('div', { class: 'phase form', 'data-phase': 'preview' },
      h('div', {},
        take.analysis.flags.silent
          ? h('div', { class: 'soft-warning' }, 'We could barely hear you. Sing again a little closer, or keep going as it is.')
          : h('div', { class: 'caps' }, `${clock(take.durationSec)} · Listen back`),
        h('div', { class: 'take-player' }, p.el)),
      h('div', { class: 'actions' },
        usesEl = h('div', { class: 'uses', 'data-uses': '' }, usesLabel(app.billing.status())),
        h('button', { class: 'pill', onClick: generate }, 'Create painting'),
        h('button', { class: 'quiet-btn', onClick: singAgain }, 'Sing again'))));
    player = p;
  }

  // ── generating ───────────────────────────────────────────────────────────
  // The card keeps the take's own wash and slowly "develops" (CSS only:
  // .painting.developing) while the engine works; the line follows the real
  // processing steps; a hairline shows activity without a percentage.
  // The same card and wash as the recording: 'developing' slows it into a
  // long diffusion; 'resting' holds it where it is (error) without a jump.
  const developing = (on) => { painting.el.classList.toggle('developing', on); painting.el.classList.remove('resting'); };
  const resting = () => painting.el.classList.add('resting');

  // Shows each reported step in order, each readable for at least
  // MIN_LINE_MS (a quick step such as "feeling" still gets its line while
  // the next one is already running).
  function captions(line) {
    const born = performance.now();
    let shownAt = born, queue = [], timer = null, last = line.textContent;
    const pump = () => {
      timer = null;
      if (!queue.length) return;
      const wait = MIN_LINE_MS - (performance.now() - shownAt);
      if (wait > 0) { timer = setTimeout(pump, wait); timers.push(timer); return; }
      const text = queue.shift();
      shownAt = performance.now() + 450;
      line.style.opacity = '0';
      later(() => { line.textContent = text; line.style.opacity = '1'; }, 450);
      if (queue.length) { timer = setTimeout(pump, MIN_LINE_MS + 450); timers.push(timer); }
    };
    return {
      set(text) {
        if (text === last) return;
        last = text;
        // The first step reported at once replaces the neutral line directly.
        if (performance.now() - born < 300 && !queue.length) { line.textContent = text; return; }
        queue.push(text);
        if (!timer) pump();
      },
      stop() { clearTimeout(timer); timer = null; queue = []; },
    };
  }

  async function generate() {
    if (phase !== 'preview') return;
    // Set a painting aside; it's only counted once the painting exists.
    // A saved recording (a draft) may already have a painting counted or held
    // for it on the server that this copy of the wallet can't see: its hold
    // was handed back at a restart, or the answer never arrived. Where the
    // server counts paintings it decides, and refuses (no_paintings) only a
    // take it has neither counted, nor held, nor can pay for.
    if (!app.billing.reserve(take.key) && !(take.draft && app.billing.serverCounts)) {
      openPaywall(app, { from: 'sing', onContinue: () => { if (phase === 'preview') generate(); } });
      return;
    }
    usesEl = null;
    phase = 'generating';
    // The take this run paints, even if Sing is closed or sung again meanwhile.
    const run = take, note = noteDraft.trim();
    // The recording is kept before any paid call (a failed write never blocks painting).
    await app.drafts.begin(run, { note, date: takeDate ?? dayKey() });
    run.draft = true;
    if (phase !== 'generating') return;
    const line = h('div', { class: 'line serif', role: 'status', 'aria-live': 'polite' }, FINDING);
    const track = h('div', { class: 'develop-track', 'aria-hidden': 'true' }, h('div', { class: 'develop-run' }));
    show(h('div', { class: 'drying', 'data-phase': 'generating' }, h('div', { class: 'drying-inner' }, line, track)));
    developing(true);
    const cap = captions(line);
    const started = performance.now();
    try {
      result = await withGenerationKey(run.key, () => app.engine.generate({
        analysis: run.analysis, note, audioBlob: run.audio,
        overrides: { ...(app.dev.completeness ? { completeness: app.dev.completeness } : {}), ...(app.dev.analyzeOnly ? { analyzeOnly: true } : {}) },
        onStage: (stage, info) => { if (phase === 'generating' && STAGE_COPY[stage]) cap.set(STAGE_COPY[stage](info)); },
      }));
    } catch (e) {
      // No silent fallback: say what happened and keep the take for a retry.
      if (e?.code !== 'analyze_only') console.warn('[sonmira] engine generate failed', e);
      app.dev.onGeneration?.({ error: e.code || e.message, status: e.status, detail: e.detail, understanding: e.understanding });
      // Nothing was made: the reservation goes back, the take stays a draft.
      app.billing.release(run.key);
      app.drafts.failed(run.key, e?.code);
      cap.stop();
      if (phase !== 'generating') return;
      resting();
      if (e?.code === 'analyze_only') analyzed();
      else generationError(e);
      // Nothing counted or held for this take, and nothing left: the usual offer.
      if (e?.code === 'no_paintings') openPaywall(app, { from: 'sing', onContinue: () => { if (phase === 'gen-error' && take === run) { phase = 'preview'; generate(); } } });
      return;
    }
    app.dev.onGeneration?.(result.generation);
    cap.stop();
    // The painting exists: it stays a draft until Keep it, even if Sing was
    // closed meanwhile (then it is counted when the draft is first opened).
    app.drafts.ready(run.key, result, note);
    if (phase !== 'generating') return;
    const wait = Math.max(0, 1300 - (performance.now() - started));
    later(async () => {
      // The loading state stays until the artwork is decoded; then it fades
      // in over the developing wash (existing 1.6 s .art transition).
      await painting.setArtwork(result.artwork, { fade: true });
      if (phase !== 'generating') return;
      track.classList.add('done');
      line.style.opacity = '0';
      later(() => { line.textContent = result.interpretation.dryingLine; line.style.opacity = '1'; }, 450);
      later(() => { painting.setStrokes(result.wash); developing(false); painting.el.classList.remove('alive'); }, 1700); // under the opaque artwork
      later(showResult, 2000);
    }, wait);
  }

  // Dev "analyze only" (set only from the ?dev panel): the decision is made
  // and shown in the dev panel; the main UI stays neutral and product-like.
  function analyzed() {
    phase = 'gen-error';
    show(h('div', { class: 'phase centered', 'data-phase': 'analyzed' },
      h('div', { class: 'error-copy' }, h('h1', { class: 'serif', style: 'font-size:30px' }, 'Analysis complete')),
      h('div', { class: 'actions', style: 'width:100%' },
        h('button', { class: 'pill', onClick: () => { phase = 'preview'; generate(); } }, 'Run again'),
        h('button', { class: 'quiet-btn', onClick: singAgain }, 'Sing again'))));
  }

  // ── result ───────────────────────────────────────────────────────────────
  // The painting card moves between its sizes with the shared artwork morph
  // (ui/morph.js), the same one the detail page uses.
  const morph = (apply) => morphCard(painting.el, apply);

  // The card's three sizes: the recording/preview card (3:2), the detail
  // page's artwork (expanded, 4:5 at the detail page's margins), and the
  // journal thumbnail (3:2). The artwork follows the detail page in the
  // expanded size (centred) and the original preview elsewhere (its focus).
  function layout(mode) {
    canvas.classList.toggle('expanded', mode === 'expanded');
    canvas.classList.toggle('compact', mode === 'compact');
    painting.el.classList.toggle('r45', mode === 'expanded');
    painting.el.classList.toggle('r32', mode !== 'expanded');
    const art = painting.el.querySelector('.art');
    if (art) art.style.objectPosition = mode === 'expanded' ? '' : (result?.artwork?.focus || '');
    // The thumbnail opens the expanded artwork again (what was written stays).
    if (mode === 'compact') { painting.el.setAttribute('role', 'button'); painting.el.tabIndex = 0; painting.el.setAttribute('aria-label', 'View the painting'); }
    else { painting.el.removeAttribute('role'); painting.el.removeAttribute('tabindex'); painting.el.removeAttribute('aria-label'); }
  }
  function smallCanvas() { if (canvas.classList.contains('expanded') || canvas.classList.contains('compact')) { layout('small'); canvasSide.replaceChildren(); } }
  const thumbOpen = (ev) => {
    if (phase !== 'result' || !canvas.classList.contains('compact')) return;
    if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    expanded();
  };
  painting.el.addEventListener('click', thumbOpen);
  painting.el.addEventListener('keydown', thumbOpen);

  let resultPlayer = null, resultCaps = '';
  function showResult() {
    if (phase !== 'generating') return;
    phase = 'result';
    // The painting is here: count it. A wash-only fallback isn't a painting.
    if (result.engineId === 'fallback') app.billing.release(take.key);
    else app.billing.commit(take.key);
    const it = result.interpretation;
    const right = it.voiceLabel ? `${clock(take.durationSec)} · ${it.voiceLabel}` : clock(take.durationSec);
    resultCaps = `${clock(take.durationSec)} · ${it.summary}`;
    show(h('div'));
    // One player for both steps: moving its element between them keeps the
    // recording playing.
    player = resultPlayer = createPlayer({ blob: take.audio, durationSec: take.durationSec, right });
    shareBtn.hidden = false;
    expanded();
  }

  // Step 2: the artwork at the detail page's size, the recording, Next.
  function expanded() {
    if (phase !== 'result') return;
    morph(() => { layout('expanded'); canvasSide.replaceChildren(); });
    phaseHost.replaceChildren(h('div', { class: 'phase form step-in', 'data-phase': 'result', 'data-step': 'expanded' },
      h('div', {},
        h('div', { class: 'caps' }, resultCaps),
        h('div', { class: 'take-player' }, resultPlayer.el)),
      h('div', { class: 'actions' },
        h('button', { class: 'pill', onClick: journal }, 'Next'),
        h('button', { class: 'quiet-btn', onClick: singAgain }, 'Sing again'))));
  }

  // Step 3: a thumbnail beside the player; the title and journal below.
  function journal() {
    if (phase !== 'result') return;
    const journalF = journalField({ value: journalDraft, onInput: (v) => { journalDraft = v; keepWriting(); } });
    const titleF = titleField({ value: noteDraft, enterkeyhint: 'next', onInput: (v) => { noteDraft = v; keepWriting(); }, onEnter: () => journalF.input.focus() });
    const keep = h('button', { class: 'pill', onClick: () => save(keep) }, 'Save');
    morph(() => { layout('compact'); canvasSide.replaceChildren(resultPlayer.el); });
    phaseHost.replaceChildren(h('div', { class: 'phase form writing step-in', 'data-phase': 'result', 'data-step': 'journal' },
      h('div', { class: 'writing-fields' }, titleF.el, journalF.el),
      h('div', { class: 'actions' }, keep, h('button', { class: 'quiet-btn', onClick: singAgain }, 'Sing again'))));
    el.scrollTop = 0;
  }

  // What is written is kept with the draft as it is typed, so a reload or a
  // closed app before Save doesn't lose it.
  let writeT = null;
  const writeDraft = () => { clearTimeout(writeT); writeT = null; if (phase === 'result' && take) app.drafts.setNote(take.key, noteDraft.trim(), journalDraft); };
  const keepWriting = () => { clearTimeout(writeT); writeT = setTimeout(writeDraft, 500); };

  async function save(keep) {
    if (phase !== 'result') return;
    phase = 'saving';
    keep.disabled = true;
    player?.stop();
    // The entry's id comes from the take key, so keeping twice can't make two.
    const entry = {
      createdAt: takeCreatedAt ?? Date.now(),
      date: takeDate ?? dayKey(),
      note: noteDraft.trim(),
      journal: journalDraft.trim(),
      durationSec: take.durationSec,
      audio: take.audio,
      analysis: take.analysis,
      painting: result,
    };
    try {
      await app.drafts.keep(take.key, entry, (e) => app.addEntry(e));
    } catch (e) {
      console.warn('[sonmira] save failed', e);
      phase = 'result';
      keep.disabled = false;
      app.toast('This painting couldn’t be saved on this device. Storage may be full or blocked. Please try again.');
      return;
    }
    app.ui.view = 'list'; app.ui.selDay = null;
    phase = 'gone';
    app.navigate('diary');
  }

  // ── errors / reset ───────────────────────────────────────────────────────
  function generationError(e) {
    phase = 'gen-error';
    show(h('div', { class: 'phase centered', 'data-phase': 'error', 'data-kind': 'generation', 'data-code': e?.code || 'error' },
      h('div', { class: 'error-copy' },
        h('h1', { class: 'serif', style: 'font-size:30px' }, 'The painting didn’t come through.'),
        h('div', { class: 'lede' }, guardMessage(e?.code) ?? (e?.name === 'GenerationError' ? e.message : 'Something went wrong while painting. Please try again.'))),
      h('div', { class: 'actions', style: 'width:100%' },
        h('button', { class: 'pill', onClick: () => { phase = 'preview'; generate(); } }, 'Try again'),
        h('button', { class: 'quiet-btn', onClick: singAgain }, 'Sing again'))));
  }

  function micError(kind) {
    phase = 'error';
    const [title, body] = MIC_COPY[kind] || MIC_COPY.error;
    show(h('div', { class: 'phase centered', 'data-phase': 'error', 'data-kind': kind },
      h('div', { class: 'error-copy' }, illustration('mic-off'), h('h1', { class: 'serif', style: 'font-size:30px' }, title), h('div', { class: 'lede' }, body)),
      h('div', { class: 'actions', style: 'width:100%' },
        h('button', { class: 'pill', onClick: () => ready() }, 'Try again'),
        h('button', { class: 'quiet-btn', onClick: close }, 'Back to diary'))));
  }

  function singAgain() {
    timers.forEach(clearTimeout); timers = [];
    // A take that never got its painting is let go; a painted one stays a
    // draft until it is kept or discarded, with what was written for it.
    if (take && !result) app.drafts.discard(take.key).catch(() => {});
    if (take && result && phase === 'result') writeDraft();
    take = null; result = null; hint = ''; takeDate = null; takeCreatedAt = null; noteDraft = ''; journalDraft = '';
    painting.setStrokes([]); painting.setArtwork(null); developing(false); painting.el.classList.remove('alive');
    ready();
  }

  function close() { app.navigate('diary'); }

  // A take in progress ends cleanly if the app is backgrounded (call, lock).
  const onHide = () => { if (document.hidden && phase === 'singing') stopSinging(); if (document.hidden && writeT) writeDraft(); };
  document.addEventListener('visibilitychange', onHide);

  // ── a draft, opened from the diary ──────────────────────────────────────
  async function resume(key) {
    phase = 'resuming';
    const d = await app.drafts.get(key).catch(() => null);
    if (phase !== 'resuming') return;
    if (!d) return ready();
    take = { ...takeOf(d), draft: true }; noteDraft = d.note || ''; journalDraft = d.journal || ''; takeDate = d.date ?? null; takeCreatedAt = d.createdAt ?? null;
    progress.style.display = 'none';
    painting.setStrokes(d.painting?.wash ?? d.analysis?.wash ?? []);
    if (d.status === 'ready' && d.painting) {
      // This artwork has already been generated (and charged server-side).
      // Reopening it to save must never require another free painting or credit.
      // showResult() commits any existing local hold idempotently.
      result = d.painting;
      await painting.setArtwork(result.artwork);
      if (phase !== 'resuming') return;
      phase = 'generating';
      return showResult();
    }
    preview();
    // It was still painting when Sonmira closed: carry on. The painting
    // service returns the painting it already made for this take, if any.
    if (d.status === 'painting') generate();
  }

  if (draftKey) resume(draftKey); else ready();
  return {
    el,
    destroy() {
      if (phase === 'generating' && take) app.billing.release(take.key);
      writeDraft();
      phase = 'gone';
      offBilling();
      sheet?.close();
      document.removeEventListener('visibilitychange', onHide);
      timers.forEach(clearTimeout);
      recorder?.cancel();
      player?.destroy();
      painting.destroy();
    },
  };
}

// Sing (create): ready → singing → preview → generating → result → save.
// Talks to the engine only through the contract: createLiveSession / generate.

import { h, icons } from '../ui/dom.js';
import { createPainting } from '../ui/painting.js';
import { illustration } from '../ui/illustration.js';
import { createPlayer } from '../ui/player.js';
import { createRecorder, MicError } from '../recorder.js';
import { clock, dayKey, longDate } from '../format.js';
import { openShareSheet } from '../share/sheet.js';
import { openPaywall } from '../paywall/paywall.js';
import { usesLabel } from '../paywall/copy.js';

const SINGING_LINES = ['Keep going…', 'Let it out.', 'Softly, softly.', 'That’s it.'];
const FINDING = 'Finding the shape of your song…';
const newKey = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const MIC_COPY = {
  denied: ['The microphone is off.', 'Sonmira needs to hear you to paint. Allow microphone access for this page in your browser settings, then try again.'],
  notfound: ['No microphone found.', 'Connect a microphone, or open Sonmira on your phone.'],
  busy: ['The microphone is busy.', 'Another app may be using it. Close it, then try again.'],
  insecure: ['The microphone needs a secure page.', 'Open Sonmira from localhost or an https:// address.'],
  unsupported: ['This browser can’t record.', 'Try Safari on iPhone, or a recent Chrome.'],
  error: ['Something interrupted the microphone.', 'Please try again.'],
};

export function mountSing(app) {
  const maxSeconds = app.settings.maxSeconds;
  const painting = createPainting({ ratio: '32' });
  const fill = h('div', { class: 'rec-fill' });
  const tLabel = h('span', {}, clock(0));
  const progress = h('div', {}, h('div', { class: 'rec-track' }, fill), h('div', { class: 'rec-times tabular' }, tLabel, h('span', {}, clock(maxSeconds))));
  // Share appears in the top bar only once a painting exists (result state).
  const shareBtn = h('button', { class: 'icon-btn', 'aria-label': 'Share', hidden: true, onClick: () => {
    player?.stop();
    sheet = openShareSheet(app, { painting: result, note: noteDraft.trim(), date: dayKey(), audio: take.audio, durationSec: take.durationSec });
  } }, icons.share());
  const navRight = h('div', { class: 'spacer44' }, shareBtn);
  const phaseHost = h('div', { style: 'flex:1;display:flex;flex-direction:column;min-height:0' });
  const el = h('div', { class: 'sing', 'data-screen': 'sing' },
    h('div', { class: 'navrow' },
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: close }, icons.close()),
      h('span', { class: 'date' }, longDate(dayKey())),
      navRight),
    h('div', { class: 'sing-canvas' }, painting.el, progress),
    phaseHost);

  // take state
  let phase = 'ready', sheet = null, recorder = null, session = null, take = null, result = null, player = null, timers = [], noteDraft = '';
  let hint = '';
  let usesEl = null;
  // What Create painting will use, kept current if a purchase lands meanwhile.
  const offBilling = app.billing.onChange(() => { if (usesEl) usesEl.textContent = usesLabel(app.billing.status()); });

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const show = (node) => { player?.destroy(); player = null; shareBtn.hidden = true; phaseHost.replaceChildren(node); };
  const setProgress = (t) => { fill.style.width = `${Math.min(100, (t / maxSeconds) * 100)}%`; tLabel.textContent = clock(t); };

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
        h('button', { class: 'mic-btn', 'aria-label': 'Start recording', onClick: startSinging }, icons.mic()),
        h('span', { class: 'mic-label' }, `Tap to begin · up to ${maxSeconds} seconds`))));
  }

  // ── singing ──────────────────────────────────────────────────────────────
  function startSinging() {
    if (phase !== 'ready') return;
    phase = 'starting';
    hint = '';
    painting.setStrokes([]); painting.setArtwork(null);
    const line = h('div', { class: 'line serif' }, SINGING_LINES[0]);
    const note = h('div', { class: 'hint' }, 'Waiting for the microphone…');
    const halo = h('div', { class: 'halo', style: { background: 'oklch(0.78 0.1 240 / 0.55)' } });
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
        halo.style.transform = `scale(${(1 + sig.level * 0.55).toFixed(3)})`;
        halo.style.background = `oklch(0.78 0.1 ${sig.hue.toFixed(0)} / 0.55)`;
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
    // key: one per take, so a retried generation is never counted twice.
    take = { key: newKey(), audio: rec.blob, durationSec: Math.round(rec.durationSec * 10) / 10, analysis };
    preview();
  }

  // ── preview ──────────────────────────────────────────────────────────────
  function preview() {
    phase = 'preview';
    progress.style.display = 'none';
    const input = noteInput();
    const p = createPlayer({ blob: take.audio, durationSec: take.durationSec });
    show(h('div', { class: 'phase form', 'data-phase': 'preview' },
      h('div', {},
        take.analysis.flags.silent
          ? h('div', { class: 'soft-warning' }, 'We could barely hear you. Sing again a little closer, or keep going as it is.')
          : h('div', { class: 'caps' }, `${clock(take.durationSec)} · Listen back`),
        h('div', { style: 'margin-top:16px' }, p.el),
        input),
      h('div', { class: 'actions' },
        usesEl = h('div', { class: 'uses', 'data-uses': '' }, usesLabel(app.billing.status())),
        h('button', { class: 'pill', onClick: generate }, 'Create painting'),
        h('button', { class: 'quiet-btn', onClick: singAgain }, 'Sing again'))));
    player = p;
  }

  function noteInput() {
    return h('input', {
      class: 'caption-input', placeholder: 'What was this moment?', value: noteDraft, maxlength: '140',
      'aria-label': 'A note about this moment (optional)', enterkeyhint: 'done',
      onInput: (e) => { noteDraft = e.target.value; },
      onKeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    });
  }

  // ── generating ───────────────────────────────────────────────────────────
  async function generate() {
    if (phase !== 'preview') return;
    // Set a painting aside; it's only counted once the painting exists.
    if (!app.billing.reserve(take.key)) {
      openPaywall(app, { from: 'sing', onContinue: () => { if (phase === 'preview') generate(); } });
      return;
    }
    usesEl = null;
    phase = 'generating';
    const line = h('div', { class: 'line serif' }, FINDING);
    show(h('div', { class: 'drying', 'data-phase': 'generating' }, line));
    const started = performance.now();
    try {
      result = await app.engine.generate({
        analysis: take.analysis, note: noteDraft.trim(), audioBlob: take.audio,
        overrides: app.dev.completeness ? { completeness: app.dev.completeness } : {},
      });
    } catch (e) {
      console.warn('[sonmira] engine generate failed', e);
      app.billing.release(take.key);
      if (phase === 'generating') generationFailed();
      return;
    }
    // Closed while painting: nothing was shown, so nothing is counted.
    if (phase !== 'generating') { app.billing.release(take.key); return; }
    app.billing.commit(take.key);
    const wait = Math.max(0, 1300 - (performance.now() - started));
    later(() => {
      line.style.opacity = '0';
      later(() => { line.textContent = result.interpretation.dryingLine; line.style.opacity = '1'; }, 450);
      painting.setStrokes(result.wash);
      painting.setArtwork(result.artwork, { fade: true });
      later(showResult, 2000);
    }, wait);
  }

  // ── result ───────────────────────────────────────────────────────────────
  function showResult() {
    if (phase !== 'generating') return;
    phase = 'result';
    const it = result.interpretation;
    const right = it.voiceLabel ? `${clock(take.durationSec)} · ${it.voiceLabel}` : clock(take.durationSec);
    const p = createPlayer({ blob: take.audio, durationSec: take.durationSec, right });
    const keep = h('button', { class: 'pill', onClick: save }, 'Keep it');
    show(h('div', { class: 'phase form', 'data-phase': 'result' },
      h('div', {},
        h('div', { class: 'caps' }, `${clock(take.durationSec)} · ${it.summary}`),
        noteInput(),
        h('div', { style: 'margin-top:26px' }, p.el)),
      h('div', { class: 'actions' }, keep, h('button', { class: 'quiet-btn', onClick: singAgain }, 'Sing again'))));
    player = p;
    shareBtn.hidden = false;

    async function save() {
      if (phase !== 'result') return;
      phase = 'saving';
      keep.disabled = true;
      player?.stop();
      const entry = {
        id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
        date: dayKey(),
        note: noteDraft.trim(),
        durationSec: take.durationSec,
        audio: take.audio,
        analysis: take.analysis,
        painting: result,
      };
      try {
        await app.addEntry(entry);
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
  }

  // ── errors / reset ───────────────────────────────────────────────────────
  function micError(kind) {
    phase = 'error';
    const [title, body] = MIC_COPY[kind] || MIC_COPY.error;
    show(h('div', { class: 'phase centered', 'data-phase': 'error', 'data-kind': kind },
      h('div', { class: 'error-copy' }, illustration('mic-off', 's'), h('h1', { class: 'serif', style: 'font-size:30px' }, title), h('div', { class: 'lede' }, body)),
      h('div', { class: 'actions', style: 'width:100%' },
        h('button', { class: 'pill', onClick: () => ready() }, 'Try again'),
        h('button', { class: 'quiet-btn', onClick: close }, 'Back to diary'))));
  }

  // The painting didn't come through. Nothing was counted and the take is kept.
  function generationFailed() {
    phase = 'gen-error';
    painting.setArtwork(null);
    show(h('div', { class: 'phase centered', 'data-phase': 'gen-error' },
      h('div', { class: 'error-copy' },
        h('h1', { class: 'serif', style: 'font-size:30px' }, 'The painting didn’t come through.'),
        h('div', { class: 'lede' }, 'Nothing was used. Your song is still here, so you can try again.')),
      h('div', { class: 'actions', style: 'width:100%' },
        h('button', { class: 'pill', onClick: () => { phase = 'preview'; generate(); } }, 'Try again'),
        h('button', { class: 'quiet-btn', onClick: preview }, 'Back to my song'))));
  }

  function singAgain() {
    timers.forEach(clearTimeout); timers = [];
    take = null; result = null; hint = '';
    painting.setStrokes([]); painting.setArtwork(null);
    ready();
  }

  function close() { app.navigate('diary'); }

  // A take in progress ends cleanly if the app is backgrounded (call, lock).
  const onHide = () => { if (document.hidden && phase === 'singing') stopSinging(); };
  document.addEventListener('visibilitychange', onHide);

  ready();
  return {
    el,
    destroy() {
      if (phase === 'generating' && take) app.billing.release(take.key);
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

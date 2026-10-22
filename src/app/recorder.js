// Microphone capture: MediaRecorder for the audio file, AnalyserNode for the
// ~100 ms frames handed to the engine's live session.
//
// start() must be called directly from a tap handler: the AudioContext is
// created synchronously so iOS Safari lets it run.

export class MicError extends Error {
  /** @param {'insecure'|'unsupported'|'denied'|'notfound'|'busy'|'error'} kind */
  constructor(kind, cause) { super(kind); this.kind = kind; this.cause = cause; }
}

const FRAME = 2048;
const TICK_MS = 100;

function pickMime() {
  if (!window.MediaRecorder?.isTypeSupported) return '';
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function mapError(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return new MicError('denied', e);
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return new MicError('notfound', e);
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return new MicError('busy', e);
  return new MicError('error', e);
}

/**
 * @param {{maxSeconds:number, simulate?:boolean,
 *   onReady?:(sampleRate:number)=>void,
 *   onFrame:(samples:Float32Array, elapsedSec:number)=>void,
 *   onLimit:()=>void, onInterrupted?:()=>void}} opts
 */
export function createRecorder(opts) {
  let ctx = null, stream = null, analyser = null, mr = null, chunks = [], iv = null, t0 = 0, elapsed = 0, stopped = false;
  let sim = null; // { chunks: Float32Array[], phase, t }
  const frame = new Float32Array(FRAME);

  async function start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new MicError('unsupported');
    ctx = new AC();
    ctx.resume?.().catch(() => {});

    if (opts.simulate) {
      sim = { chunks: [], phase: 0, t: 0 };
    } else {
      if (!window.isSecureContext) { cleanup(); throw new MicError('insecure'); }
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { cleanup(); throw new MicError('unsupported'); }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
      } catch (e) { cleanup(); throw mapError(e); }
      if (stopped) { cleanup(); return; }
      stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => opts.onInterrupted?.()));
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = FRAME;
      src.connect(analyser);
      const mimeType = pickMime();
      try { mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); }
      catch { mr = new MediaRecorder(stream); }
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.start(500);
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    }
    opts.onReady?.(ctx.sampleRate);
    t0 = performance.now();
    iv = setInterval(tick, TICK_MS);
  }

  function tick() {
    elapsed = (performance.now() - t0) / 1000;
    if (sim) synth(elapsed); else analyser.getFloatTimeDomainData(frame);
    opts.onFrame(frame, elapsed);
    if (elapsed >= opts.maxSeconds) opts.onLimit();
  }

  // Developer "sample voice": a gentle sung phrase so the whole pipeline can
  // be exercised without a microphone. Never offered in the user UI.
  function synth(t) {
    const sr = ctx.sampleRate, n = Math.round(sr * TICK_MS / 1000);
    // Dev only (test Preview): replay a recording file as the voice, so a
    // Beta take goes through the app's exact pipeline. The file itself is
    // the take's audio (stop() below).
    const vf = opts.voiceFile;
    if (vf) {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++, sim.t += 1 / sr) out[i] = vf.samples[Math.floor(sim.t * vf.sampleRate)] ?? 0;
      sim.chunks.push(out);
      const all = sim.chunks.length * n;
      for (let i = 0; i < FRAME; i++) { const k = all - FRAME + i, c = Math.floor(k / n); frame[i] = k >= 0 ? sim.chunks[c][k - c * n] : 0; }
      if (sim.t >= vf.samples.length / vf.sampleRate) setTimeout(() => opts.onLimit(), 0);
      return;
    }
    const notes = [220, 247, 262, 247, 220, 196, 220, 262, 294, 262];
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      sim.t += 1 / sr;
      const note = notes[Math.floor(sim.t / 0.9) % notes.length];
      const hz = note * (1 + 0.006 * Math.sin(sim.t * 2 * Math.PI * 5.2));
      sim.phase += (2 * Math.PI * hz) / sr;
      const env = 0.55 + 0.45 * Math.sin(Math.min(1, (sim.t % 0.9) / 0.15) * Math.PI / 2) * (sim.t % 0.9 > 0.8 ? 0.3 : 1);
      out[i] = 0.12 * env * (Math.sin(sim.phase) + 0.35 * Math.sin(2 * sim.phase) + 0.15 * Math.sin(3 * sim.phase));
    }
    sim.chunks.push(out);
    const all = sim.chunks.length * n;
    for (let i = 0; i < FRAME; i++) {
      const k = all - FRAME + i, c = Math.floor(k / n);
      frame[i] = k >= 0 ? sim.chunks[c][k - c * n] : 0;
    }
  }

  function cleanup() {
    clearInterval(iv); iv = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    stream = null; analyser = null;
  }

  /** @returns {Promise<{blob: Blob|null, durationSec: number}>} */
  async function stop() {
    stopped = true;
    clearInterval(iv); iv = null;
    const durationSec = Math.min(opts.maxSeconds, elapsed);
    let blob = null;
    if (mr && mr.state !== 'inactive') {
      await new Promise((res) => { mr.addEventListener('stop', res, { once: true }); try { mr.stop(); } catch { res(); } });
    }
    if (chunks.length) blob = new Blob(chunks, { type: mr?.mimeType || chunks[0].type || 'audio/mp4' });
    if (sim) blob = opts.voiceFile ? opts.voiceFile.blob : encodeWav(sim.chunks, ctx.sampleRate);
    cleanup();
    return { blob, durationSec };
  }

  function cancel() { stopped = true; try { if (mr && mr.state !== 'inactive') mr.stop(); } catch {} cleanup(); }

  return { start, stop, cancel };
}

function encodeWav(chunks, sampleRate) {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, len * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

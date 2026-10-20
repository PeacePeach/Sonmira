// Share as video: 1080×1920 (9:16) MP4 with the original recording and the
// composition of card.js drawVideoCard, plus a quiet audio-responsive
// waveform under the painting. Everything runs
// on the device (canvas + Web Audio + MediaRecorder); nothing is uploaded.
// Encoding is real-time, so a 12 s recording takes about 12 s to export.

import { COLORS, ensureFonts, loadArtwork } from './compose.js';
import { drawVideoCard, VIDEO } from './card.js';

export const MAX_VIDEO_SECONDS = 30;
const FPS = 30;
const BARS = 48;

/** The MP4 type this browser can record, or null (then video is not offered). */
export function videoMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  if (!HTMLCanvasElement.prototype.captureStream || !(window.AudioContext || window.webkitAudioContext)) return null;
  return ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs="avc1.42E01E, mp4a.40.2"', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

export class VideoExportError extends Error {
  /** @param {'decode'|'record'|'interrupted'|'aborted'} kind */
  constructor(kind, cause) { super(kind); this.kind = kind; this.cause = cause; }
}

function envelope(buffer, seconds, n) {
  const data = buffer.getChannelData(0), len = Math.min(data.length, Math.floor(seconds * buffer.sampleRate));
  const out = new Float32Array(n), step = Math.max(1, Math.floor(len / n));
  for (let i = 0; i < n; i++) {
    let s = 0; const a = i * step, b = Math.min(len, a + step);
    for (let k = a; k < b; k += 4) s += data[k] * data[k];
    out[i] = Math.sqrt(s / Math.max(1, (b - a) / 4));
  }
  const peak = Math.max(1e-4, ...out);
  for (let i = 0; i < n; i++) out[i] = 0.12 + 0.88 * Math.sqrt(out[i] / peak);
  return out;
}

// The still layer and the waveform, drawn the same for the export and its preview.
async function composition(item) {
  const [img] = await Promise.all([loadArtwork(item.painting?.artwork), ensureFonts()]);
  const base = document.createElement('canvas');
  base.width = VIDEO.W; base.height = VIDEO.H;
  const { wave } = drawVideoCard(base.getContext('2d'), { painting: item.painting, img, note: item.note, date: item.date, createdAt: item.createdAt, durationSec: Math.min(MAX_VIDEO_SECONDS, item.durationSec) });
  // Bars already heard are ink; the bar being heard breathes with the live level.
  const draw = (ctx, env, at, level) => {
    ctx.drawImage(base, 0, 0);
    const gap = wave.w / BARS, cy = wave.y + wave.h / 2;
    for (let i = 0; i < BARS; i++) {
      const current = i === Math.floor(at);
      const bh = Math.max(4, env[i] * wave.h * (current ? 0.75 + level * 0.5 : 1));
      ctx.fillStyle = i < at ? 'rgba(31,29,26,0.62)' : COLORS.track;
      ctx.beginPath();
      ctx.roundRect(wave.x + i * gap + gap * 0.3, cy - bh / 2, gap * 0.4, bh, gap * 0.2);
      ctx.fill();
    }
  };
  return { draw };
}

/** The video's first frame as a JPEG: the share sheet's preview of the video. */
export async function renderVideoPoster(item) {
  const [{ draw }, buffer] = await Promise.all([composition(item), decodeQuietly(item.audio)]);
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO.W; canvas.height = VIDEO.H;
  const env = buffer ? envelope(buffer, Math.min(MAX_VIDEO_SECONDS, buffer.duration), BARS) : new Float32Array(BARS).fill(0.4);
  draw(canvas.getContext('2d'), env, 0, 0);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('poster-encode-failed'))), 'image/jpeg', 0.9));
}

// The recording, decoded without a tap (for the waveform's shape), or null.
async function decodeQuietly(audio) {
  try {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    return audio && OAC ? await new OAC(1, 1, 44100).decodeAudioData(await audio.arrayBuffer()) : null;
  } catch { return null; }
}

/** Must be called from a tap so iOS lets audio run. */
export function createExportAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  ctx.resume?.().catch(() => {});
  return ctx;
}

/**
 * @param {{painting:any, note?:string, date:string, audio:Blob, durationSec:number}} item
 * @param {{audioContext: AudioContext, onProgress?:(t:number, total:number)=>void, signal?:AbortSignal}} opts
 * @returns {Promise<Blob>}
 */
export async function renderShareVideo(item, { audioContext: ac, onProgress, signal }) {
  const mimeType = videoMimeType();
  if (!mimeType) throw new VideoExportError('record');

  let buffer;
  try { buffer = await ac.decodeAudioData(await item.audio.arrayBuffer()); }
  catch (e) { ac.close().catch(() => {}); throw new VideoExportError('decode', e); }
  const total = Math.min(MAX_VIDEO_SECONDS, buffer.duration);

  // Static layer drawn once; each frame adds only the waveform.
  const { draw } = await composition(item);
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO.W; canvas.height = VIDEO.H;
  const ctx = canvas.getContext('2d');

  const src = ac.createBufferSource();
  src.buffer = buffer;
  const analyser = ac.createAnalyser();
  analyser.fftSize = 512;
  const dest = ac.createMediaStreamDestination();
  src.connect(analyser); analyser.connect(dest);
  const live = new Float32Array(analyser.fftSize);

  // Waveform = the recording's loudness envelope, one bar per slice.
  const env = envelope(buffer, total, BARS);

  function frame(t) {
    analyser.getFloatTimeDomainData(live);
    let sum = 0; for (let i = 0; i < live.length; i++) sum += live[i] * live[i];
    draw(ctx, env, (t / total) * BARS, Math.min(1, Math.sqrt(sum / live.length) * 5));
  }
  frame(0);

  const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  let rec;
  try { rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 }); }
  catch (e) { ac.close().catch(() => {}); throw new VideoExportError('record', e); }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    let done = false, t0 = 0, iv = null;
    const finish = (err) => {
      if (done) return; done = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onHide);
      signal?.removeEventListener('abort', onAbort);
      try { src.stop(); } catch {}
      const close = () => { stream.getTracks().forEach((t) => t.stop()); ac.close().catch(() => {}); };
      if (err) { try { rec.state !== 'inactive' && rec.stop(); } catch {} close(); reject(err); return; }
      rec.onstop = () => {
        close();
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType });
        blob.size ? resolve(blob) : reject(new VideoExportError('record'));
      };
      try { rec.stop(); } catch (e) { close(); reject(new VideoExportError('record', e)); }
    };
    const onAbort = () => finish(new VideoExportError('aborted'));
    // Backgrounding pauses timers and audio, which would corrupt the export.
    const onHide = () => { if (document.hidden) finish(new VideoExportError('interrupted')); };
    signal?.addEventListener('abort', onAbort);
    document.addEventListener('visibilitychange', onHide);
    rec.onerror = (e) => finish(new VideoExportError('record', e.error));

    rec.start(1000);
    t0 = ac.currentTime;
    src.start(0, 0, total);
    src.onended = () => setTimeout(() => finish(), 250);
    iv = setInterval(() => {
      const t = Math.min(total, ac.currentTime - t0);
      frame(t);
      onProgress?.(t, total);
    }, 1000 / FPS);
  });
}

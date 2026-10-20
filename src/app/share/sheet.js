// The Share sheet: a quiet bottom panel with a choice of three formats
// (Feed 3:4, Story 9:16, Square 1:1), a preview of the card, Share (the
// system share sheet), Save image (in the iOS app: Save to Photos, for the
// image and the video), and an optional video export. Files are made on the
// device; nothing is uploaded or regenerated.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { clock } from '../format.js';
import { renderShareCard, FORMATS, DEFAULT_FORMAT } from './card.js';
import { createExportAudioContext, renderShareVideo, renderVideoPoster, videoMimeType, VideoExportError } from './video.js';
import { canShareFiles, deliverFile, saveFile, fileName } from './deliver.js';
import { saveToPhotos } from './photos.js';
import { isNativeIOS } from '../native/platform.js';

const VIDEO_ERRORS = {
  decode: 'This recording can’t be turned into a video on this device. You can still share the image.',
  record: 'The video couldn’t be made on this device. You can still share the image.',
  interrupted: 'The video stopped because Sonmira went to the background. Keep it open and try again.',
};

// WeChat's share extension offers only Chat and Favorites; Moments posts
// come from the photo library, so the app saves there and says so.
export const SAVED_TO_PHOTOS = 'Saved to Photos';
export const TOAST_MS = 2000;
const PHOTOS_ERRORS = {
  denied: 'Sonmira can’t add to Photos. Turn it on in Settings → Sonmira → Photos, then try again.',
  unavailable: 'Save to Photos needs the latest Sonmira from TestFlight. Update the app, then try again.',
  failed: 'It couldn’t be saved to Photos. Please try again.',
};
// the reason, for a beta tester's report: the native error code or message
const reason = (e) => { const c = e?.cause?.code || e?.cause?.message || ''; return c ? ` (${String(c).slice(0, 60)})` : ''; };

/**
 * @param {any} app
 * @param {{painting:any, note?:string, date:string, createdAt?:number, audio:Blob|null, durationSec:number}} item
 */
export function openShareSheet(app, item) {
  const canVideo = !!(item.audio && videoMimeType());
  const sharesNatively = canShareFiles(new File([new Blob(['x'], { type: 'image/jpeg' })], 'probe.jpg', { type: 'image/jpeg' }));
  // The hosted preview can neither open the share sheet nor download files,
  // so there the sheet shows the finished file in place instead.
  const showInPlace = !!app.dev?.preview && !sharesNatively;
  const verb = sharesNatively || showInPlace ? 'Share' : 'Save';
  // In the iOS app Save always means Photos (never the share sheet); in a browser it is a download.
  const photos = isNativeIOS();

  let state = 'preparing'; // preparing | image | exporting | video
  let imageFile = null, videoFile = null, previewUrl = null, posterUrl = null, liveCanvas = null, posterAsked = false, videoUrl = null, abort = null, closed = false;
  let format = DEFAULT_FORMAT;
  const made = {}; // format -> Promise<{ file, url }>, each drawn once

  const preview = h('img', { class: 'share-preview card', alt: 'Share card preview' });
  // While the video is made, the canvas being recorded is the preview (the
  // painting painting itself); then the finished video plays in place.
  const videoEl = h('video', { class: 'share-preview card', playsinline: true, preload: 'metadata', 'aria-label': 'Video preview' });
  videoEl.style.aspectRatio = '9 / 16';
  // No player controls over the picture (they covered the bottom of it):
  // a tap plays or pauses, and a quiet play mark shows while paused.
  const playBtn = h('button', { class: 'share-play', 'aria-label': 'Play video' }, icon('play'));
  const tapToPlay = (v) => {
    v.addEventListener('click', () => (v.paused ? v.play().catch(() => {}) : v.pause()));
    const sync = () => { if (v.isConnected) playBtn.hidden = !v.paused; };
    for (const e of ['play', 'pause', 'ended', 'emptied']) v.addEventListener(e, sync);
    v.show = () => { playBtn.onclick = () => v.play().catch(() => {}); playBtn.hidden = !v.paused; return [v, playBtn]; };
    return v;
  };
  tapToPlay(videoEl);
  const formatBtns = Object.entries(FORMATS).map(([key, f]) => h('button', {
    class: 'share-format', role: 'radio', 'data-format': key, onClick: () => choose(key),
  }, h('span', {}, f.label), h('span', { class: 'share-format-hint' }, f.hint)));
  const formats = h('div', { class: 'share-formats', role: 'radiogroup', 'aria-label': 'Format' }, formatBtns);
  const previewBox = h('div', { class: 'share-preview-box' }, preview);
  const message = h('div', { class: 'share-message', role: 'status' });
  const fill = h('div', { class: 'rec-fill' });
  const progressLabel = h('span', {}, '');
  const progress = h('div', { class: 'share-progress', hidden: true },
    h('div', { class: 'caps' }, 'Preparing video'),
    h('div', { class: 'rec-track' }, fill),
    h('div', { class: 'rec-times tabular' }, progressLabel, h('span', {}, clock(Math.min(30, item.durationSec)))));
  const primary = h('button', { class: 'pill', 'data-primary': '', disabled: true, onClick: onPrimary }, 'Preparing…');
  // Save sits beside Share, for the image and the video, wherever Share opens the system sheet; elsewhere the primary already saves.
  const saveBtn = h('button', { class: 'pill light', 'data-save': '', hidden: true, onClick: () => save(state === 'video' ? videoFile : imageFile) }, photos ? 'Save to Photos' : 'Save image');
  let saving = false;
  const secondary = h('button', { class: 'quiet-btn', onClick: onSecondary, hidden: !canVideo }, `Make a video · ${clock(Math.min(30, item.durationSec))}`);

  const panel = h('div', { class: 'share-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share' },
    h('div', { class: 'share-head' }, h('span'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: close }, icon('close'))), // no title: the formats lead
    formats, previewBox, progress, message,
    h('div', { class: 'actions' }, h('div', { class: 'share-main' }, primary, saveBtn), secondary));
  const scrim = h('div', { class: 'share-scrim', onClick: close });
  // Saved to Photos: a small toast with a check that fades after ~2 s.
  const toast = h('div', { class: 'share-toast', role: 'status', hidden: true }, icon('check', { size: 'sm' }), h('span', {}, SAVED_TO_PHOTOS));
  let toastTimer;
  const savedToast = () => {
    clearTimeout(toastTimer);
    toast.hidden = true; void toast.offsetWidth; toast.hidden = false; // restart the fade on a second save
    toastTimer = setTimeout(() => { toast.hidden = true; }, TOAST_MS);
  };
  const el = h('div', { class: 'share-layer', 'data-share': '' }, scrim, panel, toast);
  app.root.append(el);

  function render() {
    for (const b of formatBtns) {
      const on = b.dataset.format === format;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
      b.disabled = state === 'exporting' || state === 'video';
    }
    formats.hidden = state === 'exporting' || state === 'video';
    saveBtn.hidden = !(photos || (sharesNatively && !showInPlace));
    saveBtn.disabled = saving || !(state === 'image' || state === 'video');
    saveBtn.textContent = saving ? 'Saving…' : photos ? 'Save to Photos' : state === 'video' || state === 'exporting' ? 'Save video' : 'Save image';
    progress.hidden = state !== 'exporting';
    primary.disabled = state === 'preparing' || state === 'exporting';
    primary.textContent = state === 'preparing' ? 'Preparing…'
      : state === 'exporting' ? 'Preparing video…'
      : state === 'video' ? `${verb} video` : `${verb} image`;
    secondary.hidden = !canVideo && state !== 'video';
    secondary.textContent = state === 'exporting' ? 'Cancel'
      : state === 'video' ? `${verb} image instead` : `Make a video · ${clock(Math.min(30, item.durationSec))}`;
    showPreview();
  }

  function showPreview() {
    if (showInPlace && ![preview, videoEl, liveCanvas].includes(previewBox.firstChild)) return; // the file shown in place
    const vid = state === 'exporting' || state === 'video';
    if (state === 'video' && videoUrl) {
      if (previewBox.firstChild !== videoEl) previewBox.replaceChildren(...videoEl.show());
    } else if (state === 'exporting' && liveCanvas) {
      if (previewBox.firstChild !== liveCanvas) previewBox.replaceChildren(liveCanvas);
    } else if (previewBox.firstChild !== preview) { videoEl.pause(); previewBox.replaceChildren(preview); }
    const src = vid ? posterUrl : previewUrl;
    if (src && preview.getAttribute('src') !== src) preview.src = src;
    preview.style.aspectRatio = vid ? '9 / 16' : `${FORMATS[format].W} / ${FORMATS[format].H}`;
  }
  const say = (t) => { message.textContent = t || ''; };

  // Each format is drawn when first chosen (the default right away), so the
  // Share tap can open the system sheet instantly.
  function make(key) {
    return (made[key] ??= renderShareCard(item, key).then((blob) => ({
      file: new File([blob], fileName(item.date, 'jpg', key), { type: 'image/jpeg' }),
      url: URL.createObjectURL(blob),
    })));
  }
  function choose(key) {
    if (state === 'exporting' || state === 'video' || !FORMATS[key]) return;
    format = key;
    if (state !== 'retry-image') state = 'preparing';
    say(''); render();
    make(key).then(({ file, url }) => {
      if (closed || format !== key) return;
      imageFile = file; previewUrl = url;
      state = 'image'; render();
    }).catch((e) => {
      console.warn('[sonmira] share image failed', e);
      delete made[key];
      if (closed || format !== key) return;
      say('The image couldn’t be prepared on this device. Please try again.');
      primary.textContent = 'Try again'; primary.disabled = false; state = 'retry-image';
    });
  }
  choose(DEFAULT_FORMAT);

  async function send(file) {
    say('');
    if (showInPlace) {
      const url = URL.createObjectURL(file);
      const media = file.type.startsWith('video')
        ? tapToPlay(h('video', { class: 'share-preview story', src: url, playsinline: true, autoplay: true }))
        : h('img', { class: 'share-preview', src: url, alt: 'Share card' });
      previewBox.replaceChildren(...(media.show ? media.show() : [media]));
      say('This preview can’t open the share sheet. This is the file it would share.');
      return;
    }
    try {
      const r = await deliverFile(file);
      if (r === 'saved') say(file.type.startsWith('video') ? 'Video saved.' : 'Image saved.');
      if (r === 'shared') close();
    } catch (e) {
      console.warn('[sonmira] share failed', e);
      say('Sharing didn’t open. Please try again.');
    }
  }

  async function save(file) {
    if (!file || saving) return;
    say('');
    const what = file.type.startsWith('video') ? 'video' : 'image';
    if (!photos) {
      try { if (await saveFile(file) === 'saved') say(`${what === 'video' ? 'Video' : 'Image'} saved.`); }
      catch (e) { console.warn('[sonmira] save failed', e); say(`The ${what} couldn’t be saved. Please try again.`); }
      return;
    }
    saving = true; render();
    try { await saveToPhotos(file); savedToast(); }
    catch (e) {
      console.warn('[sonmira] save to Photos failed', e);
      say((PHOTOS_ERRORS[e?.kind] || PHOTOS_ERRORS.failed) + (e?.kind === 'denied' ? '' : reason(e)));
    } finally {
      saving = false;
      if (!closed) render();
    }
  }

  function onPrimary() {
    if (state === 'retry-image') { choose(format); return; }
    if (state === 'image' && imageFile) send(imageFile);
    else if (state === 'video' && videoFile) send(videoFile);
  }

  function onSecondary() {
    secondary.blur(); // it changes meaning (Make a video → Cancel → Share image instead); no focus ring carried over
    if (state === 'exporting') { abort?.abort(); return; }
    if (state === 'video') { if (imageFile) send(imageFile); return; }
    if (state !== 'image') return;
    startVideo();
  }

  function startVideo() {
    say('');
    if (videoFile) { state = 'video'; render(); return; }
    const audioContext = createExportAudioContext(); // inside the tap, for iOS
    abort = new AbortController();
    if (!posterAsked) {
      posterAsked = true;
      renderVideoPoster(item).then((b) => { posterUrl = URL.createObjectURL(b); videoEl.poster = posterUrl; if (!closed) showPreview(); },
        (e) => { posterAsked = false; console.warn('[sonmira] video poster failed', e); });
    }
    state = 'exporting'; fill.style.width = '0%'; progressLabel.textContent = clock(0); render();
    renderShareVideo(item, {
      audioContext, signal: abort.signal,
      onCanvas: (c) => { if (closed || state !== 'exporting') return; c.className = 'share-preview card'; c.style.aspectRatio = '9 / 16'; c.setAttribute('aria-label', 'Video preview'); liveCanvas = c; showPreview(); },
      onProgress: (t, total) => { fill.style.width = `${Math.min(100, (t / total) * 100)}%`; progressLabel.textContent = clock(t); },
    }).then((blob) => {
      if (closed) return;
      videoFile = new File([blob], fileName(item.date, 'mp4'), { type: blob.type.split(';')[0] || 'video/mp4' });
      videoUrl = URL.createObjectURL(videoFile); videoEl.src = videoUrl; liveCanvas = null;
      state = 'video'; render();
    }).catch((e) => {
      if (closed) return;
      liveCanvas = null; state = 'image'; render();
      if (!(e instanceof VideoExportError) || e.kind !== 'aborted') {
        console.warn('[sonmira] video export failed', e);
        say(VIDEO_ERRORS[e?.kind] || VIDEO_ERRORS.record);
      }
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(toastTimer);
    abort?.abort();
    videoEl.pause();
    el.classList.add('leaving');
    setTimeout(() => { el.remove(); for (const u of [posterUrl, videoUrl]) u && URL.revokeObjectURL(u); for (const p of Object.values(made)) p.then(({ url }) => URL.revokeObjectURL(url), () => {}); }, 220);
  }

  render();
  return { close };
}

// The Share sheet: a quiet bottom panel with a choice of three formats
// (Feed 3:4, Story 9:16, Square 1:1), a preview of the card, Share (the
// system share sheet), Save image, and an optional video export. Files are
// made on the device; nothing is uploaded or regenerated.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { clock } from '../format.js';
import { renderShareCard, FORMATS, DEFAULT_FORMAT } from './card.js';
import { createExportAudioContext, renderShareVideo, videoMimeType, VideoExportError } from './video.js';
import { canShareFiles, deliverFile, saveFile, fileName } from './deliver.js';

const PREVIEW_H = 320; // css px, the same for every format (.share-preview.card)

const VIDEO_ERRORS = {
  decode: 'This recording can’t be turned into a video on this device. You can still share the image.',
  record: 'The video couldn’t be made on this device. You can still share the image.',
  interrupted: 'The video stopped because Sonmira went to the background. Keep it open and try again.',
};

/**
 * @param {any} app
 * @param {{painting:any, note?:string, date:string, audio:Blob|null, durationSec:number}} item
 */
export function openShareSheet(app, item) {
  const canVideo = !!(item.audio && videoMimeType());
  const sharesNatively = canShareFiles(new File([new Blob(['x'], { type: 'image/jpeg' })], 'probe.jpg', { type: 'image/jpeg' }));
  // The hosted preview can neither open the share sheet nor download files,
  // so there the sheet shows the finished file in place instead.
  const showInPlace = !!app.dev?.preview && !sharesNatively;
  const verb = sharesNatively || showInPlace ? 'Share' : 'Save';

  let state = 'preparing'; // preparing | image | exporting | video
  let imageFile = null, videoFile = null, previewUrl = null, abort = null, closed = false;
  let format = DEFAULT_FORMAT;
  const made = {}; // format -> Promise<{ file, url }>, each drawn once

  const preview = h('img', { class: 'share-preview card', alt: 'Share card preview' });
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
  const primary = h('button', { class: 'pill', disabled: true, onClick: onPrimary }, 'Preparing…');
  // Save image sits under Share wherever Share opens the system sheet; elsewhere the primary already saves.
  const saveBtn = h('button', { class: 'quiet-btn', 'data-save': '', hidden: true, onClick: () => imageFile && save(imageFile) }, 'Save image');
  const secondary = h('button', { class: 'quiet-btn', onClick: onSecondary, hidden: !canVideo }, `Make a video · ${clock(Math.min(30, item.durationSec))}`);

  const panel = h('div', { class: 'share-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share' },
    h('div', { class: 'share-head' }, h('span', { class: 'serif share-title' }, 'Share'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: close }, icon('close'))),
    formats, previewBox, progress, message,
    h('div', { class: 'actions' }, primary, saveBtn, secondary));
  const scrim = h('div', { class: 'share-scrim', onClick: close });
  const el = h('div', { class: 'share-layer', 'data-share': '' }, scrim, panel);
  app.root.append(el);

  function render() {
    for (const b of formatBtns) {
      const on = b.dataset.format === format;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
      b.disabled = state === 'exporting' || state === 'video';
    }
    formats.hidden = state === 'exporting' || state === 'video';
    saveBtn.hidden = !(sharesNatively && !showInPlace && state === 'image');
    progress.hidden = state !== 'exporting';
    primary.disabled = state === 'preparing' || state === 'exporting';
    primary.textContent = state === 'preparing' ? 'Preparing…'
      : state === 'exporting' ? 'Preparing video…'
      : state === 'video' ? `${verb} video` : `${verb} image`;
    secondary.hidden = !canVideo && state !== 'video';
    secondary.textContent = state === 'exporting' ? 'Cancel'
      : state === 'video' ? `${verb} image instead` : `Make a video · ${clock(Math.min(30, item.durationSec))}`;
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
    preview.style.width = `${Math.round((PREVIEW_H * FORMATS[key].W) / FORMATS[key].H)}px`;
    if (state !== 'retry-image') state = 'preparing';
    say(''); render();
    make(key).then(({ file, url }) => {
      if (closed || format !== key) return;
      imageFile = file; previewUrl = url; preview.src = url;
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
        ? h('video', { class: 'share-preview story', src: url, controls: true, playsinline: true, autoplay: true })
        : h('img', { class: 'share-preview', src: url, alt: 'Share card' });
      previewBox.replaceChildren(media);
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
    say('');
    try { await saveFile(file); say('Image saved.'); } catch (e) { console.warn('[sonmira] save failed', e); say('The image couldn’t be saved. Please try again.'); }
  }

  function onPrimary() {
    if (state === 'retry-image') { choose(format); return; }
    if (state === 'image' && imageFile) send(imageFile);
    else if (state === 'video' && videoFile) send(videoFile);
  }

  function onSecondary() {
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
    state = 'exporting'; fill.style.width = '0%'; progressLabel.textContent = clock(0); render();
    renderShareVideo(item, {
      audioContext, signal: abort.signal,
      onProgress: (t, total) => { fill.style.width = `${Math.min(100, (t / total) * 100)}%`; progressLabel.textContent = clock(t); },
    }).then((blob) => {
      if (closed) return;
      videoFile = new File([blob], fileName(item.date, 'mp4'), { type: blob.type.split(';')[0] || 'video/mp4' });
      state = 'video'; render();
    }).catch((e) => {
      if (closed) return;
      state = 'image'; render();
      if (!(e instanceof VideoExportError) || e.kind !== 'aborted') {
        console.warn('[sonmira] video export failed', e);
        say(VIDEO_ERRORS[e?.kind] || VIDEO_ERRORS.record);
      }
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    abort?.abort();
    el.classList.add('leaving');
    setTimeout(() => { el.remove(); for (const p of Object.values(made)) p.then(({ url }) => URL.revokeObjectURL(url), () => {}); }, 220);
  }

  render();
  return { close };
}

// Save to Photos in the share sheet, as the iOS app shows it: Chromium at
// iPhone size with a stand-in for Capacitor and the SonmiraPhotos plugin
// (ios/App/App/SonmiraPhotosPlugin.swift), which records each saved file.
// Covers the image and the MP4 (with its audio, in sync), Share and Save to
// Photos side by side and on screen without scrolling for both (also on a
// small iPhone), the video's preview matching the exported MP4, Photos access
// denied, and an older app build without the plugin (falls back to the
// system share sheet). No AI, nothing uploaded. SHOTS=dir saves screenshots.
//
//   npm i -D playwright   (once; CHROMIUM_PATH=/opt/pw-browsers/chromium in cloud sessions)
//   node server.js &  then  node tests/e2e/save-photos.mjs

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const exe = process.env.CHROMIUM_PATH;
const wav = readFileSync(fileURLToPath(new URL('./hum.wav', import.meta.url)));
const SAVED = 'Saved to Photos. Open WeChat → Moments to post.';
const SHOTS = process.env.SHOTS;
const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const SMALL = { width: 375, height: 667 }; // iPhone SE
const LARGE = { width: 393, height: 852 }; // iPhone 15

function fakeIOS({ plugin = true, deny = false } = {}) {
  window.__photos = []; window.__shared = [];
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => { window.__shared.push(d.files[0]); };
  const open = {};
  let n = 0;
  const photos = {
    async begin({ kind, ext }) { const id = `f${++n}`; open[id] = { kind, ext, parts: [] }; return { id }; },
    async append({ id, data }) { open[id].parts.push(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))); },
    async finish({ id }) {
      const f = open[id]; delete open[id];
      if (deny) throw Object.assign(new Error('Photos access is off for Sonmira.'), { code: 'denied' });
      window.__photos.push(new File(f.parts, `saved.${f.ext}`, { type: f.kind === 'video' ? 'video/mp4' : 'image/jpeg' }));
    },
    async discard({ id }) { delete open[id]; },
  };
  const missing = new Proxy({}, { get: () => async () => { throw Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }); } });
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: (name) => plugin && name === 'SonmiraPhotos',
    registerPlugin: (name) => (name === 'SonmiraPhotos' && plugin ? photos : missing),
  };
}

// Decodes a saved file in the page: size for images, size + audio for videos.
const inspect = (page, list) => page.evaluate(async (list) => {
  for (let i = 0; i < 50 && !window[list].length; i++) await new Promise((r) => setTimeout(r, 100));
  const f = (window.__last = window[list].pop());
  if (!f) return null;
  const url = URL.createObjectURL(f);
  const out = { type: f.type, size: f.size };
  if (f.type.startsWith('image')) {
    const im = new Image(); im.src = url; await im.decode();
    return Object.assign(out, { width: im.naturalWidth, height: im.naturalHeight });
  }
  const v = document.createElement('video'); v.muted = true; v.src = url;
  await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('video unplayable')); });
  const buf = await new AudioContext().decodeAudioData(await f.arrayBuffer());
  const d = buf.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return Object.assign(out, { width: v.videoWidth, height: v.videoHeight, audioRms: Math.sqrt(s / d.length) });
}, list);

async function openSheet(browser, opts, viewport = LARGE) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(fakeIOS, opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.route(BASE + '__save-photos', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/styles.css"><body><div id="root" style="position:relative;height:100vh;overflow:hidden"></div>' }));
  await page.route(BASE + '__hum.wav', (r) => r.fulfill({ contentType: 'audio/wav', body: wav }));
  await page.goto(BASE + '__save-photos');
  await page.evaluate(async () => {
    const { openShareSheet } = await import('/src/app/share/sheet.js');
    const audio = await (await fetch('/__hum.wav')).blob();
    // a painting stand-in with detail, so the preview and the export can be compared
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1280;
    const g = c.getContext('2d');
    for (let i = 0; i < 12; i++) { g.fillStyle = `hsl(${i * 30} 60% 60%)`; g.fillRect(0, i * 107, 1024, 107); }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    openShareSheet({ root: document.getElementById('root') }, { painting: { wash: [], artwork: { kind: 'image', blob } }, note: 'Rain on the window', date: '2026-10-20', audio, durationSec: 4 });
  });
  await page.waitForSelector('[data-share] .pill:not([disabled])');
  return { ctx, page };
}

const message = (page) => page.textContent('[data-share] .share-message');

// Share and Save: side by side, fully on screen, enabled; returns their boxes.
async function mainButtons(page, viewport) {
  await page.waitForTimeout(450); // the sheet's slide-in
  const boxes = [];
  for (const sel of ['[data-share] [data-primary]', '[data-share] [data-save]']) {
    const b = await page.locator(sel).boundingBox();
    assert.ok(b, `${sel} is shown`);
    assert.ok(b.y >= 0 && b.y + b.height <= viewport.height, `${sel} is on screen without scrolling (bottom ${Math.round(b.y + b.height)} of ${viewport.height})`);
    boxes.push(b);
  }
  assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 1, `Share and Save to Photos sit on one row (${JSON.stringify(boxes)})`);
  assert.equal(await page.evaluate(() => document.querySelector('[data-share] .share-panel').scrollTop), 0);
  return boxes;
}

// A frame of the exported MP4 next to the sheet's preview of it: the mean
// difference per channel over the whole 1080×1920 frame, and over the top
// (all the text) only.
const compareVideoToPreview = (page) => page.evaluate(async () => {
  const f = window.__last;
  const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(f);
  await new Promise((r) => { v.onloadeddata = r; });
  v.currentTime = 0.5; await new Promise((r) => { v.onseeked = r; });
  const poster = new Image(); poster.src = document.querySelector('[data-share] video').poster; await poster.decode();
  const px = (src) => { const c = document.createElement('canvas'); c.width = 270; c.height = 480; const g = c.getContext('2d'); g.drawImage(src, 0, 0, 270, 480); return g.getImageData(0, 0, 270, 480).data; };
  const a = px(v), b = px(poster);
  const diff = (y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < 270; x++) for (let k = 0; k < 3; k++) { const i = (y * 270 + x) * 4 + k; s += Math.abs(a[i] - b[i]); n++; } return s / n; };
  // ink in the top third: the text is drawn there, above the painting
  let ink = 0; for (let y = 60; y < 160; y++) for (let x = 0; x < 270; x++) { const i = (y * 270 + x) * 4; if (a[i] < 150 && a[i + 1] < 150) ink++; }
  return { all: diff(0, 480), top: diff(0, 160), ink, posterSize: [poster.naturalWidth, poster.naturalHeight] };
});

// Audio and picture end together, and the audio is the recording's.
const syncCheck = (page) => page.evaluate(async () => {
  const f = window.__last;
  const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(f);
  await new Promise((r) => { v.onloadedmetadata = r; });
  if (v.duration === Infinity) { v.currentTime = 1e6; await new Promise((r) => { v.ontimeupdate = r; }); }
  const ac = new AudioContext();
  const got = await ac.decodeAudioData(await f.arrayBuffer());
  const src = await ac.decodeAudioData(await (await fetch('/__hum.wav')).arrayBuffer());
  const rms = (b, t0, t1) => { const d = b.getChannelData(0), a = Math.floor(t0 * b.sampleRate), z = Math.min(d.length, Math.floor(t1 * b.sampleRate)); let s = 0; for (let i = a; i < z; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, z - a)); };
  // loudness envelope in 100 ms steps, and the lag that best lines them up
  const env = (b, n) => Array.from({ length: n }, (_, i) => rms(b, i * 0.1, i * 0.1 + 0.1));
  const n = Math.floor(Math.min(got.duration, src.duration, 30) * 10) - 5;
  const eg = env(got, n + 5), es = env(src, n);
  let best = 0, lag = 0;
  for (let l = 0; l <= 5; l++) { let s = 0; for (let i = 0; i < n; i++) s += eg[i + l] * es[i]; if (s > best) { best = s; lag = l; } }
  return { video: v.duration, audio: got.duration, source: Math.min(30, src.duration), lagMs: lag * 100, rmsRatio: rms(got, 0, n / 10) / rms(src, 0, n / 10) };
});

async function run() {
  const browser = await chromium.launch({ executablePath: exe, args: ['--disable-webgl', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // image, then video, saved to Photos
    {
      const { ctx, page } = await openSheet(browser, {});
      assert.equal((await page.textContent('[data-share] [data-save]')).trim(), 'Save to Photos');
      assert.equal((await page.textContent('[data-share] [data-primary]')).trim(), 'Share image', 'the system Share stays');
      const imageButtons = await mainButtons(page, LARGE);
      await shot(page, 'sheet-image');
      await page.click('[data-share] [data-save]');
      await page.waitForFunction((t) => document.querySelector('[data-share] .share-message')?.textContent === t, SAVED);
      const img = await inspect(page, '__photos');
      assert.equal(img.type, 'image/jpeg');
      assert.deepEqual([img.width, img.height], [1080, 1440], 'the full-size feed card');
      assert.equal(await page.evaluate(() => window.__shared.length), 0, 'saving does not open the share sheet');

      await page.click('[data-share] .quiet-btn:has-text("Make a video")');
      await page.waitForSelector('[data-share] .share-preview-box img[src^="blob:"]');
      assert.equal((await page.textContent('[data-share] [data-save]')).trim(), 'Save to Photos', 'while the video is made, Save stays put (disabled)');
      assert.ok(await page.isDisabled('[data-share] [data-save]'));
      await shot(page, 'sheet-video-exporting');
      await page.waitForSelector('[data-share] .pill:has-text("Share video")', { timeout: 45000 });
      assert.equal((await page.textContent('[data-share] [data-save]')).trim(), 'Save to Photos', 'Save to Photos is offered for the video too');
      const videoButtons = await mainButtons(page, LARGE);
      for (const i of [0, 1]) assert.ok(Math.abs(videoButtons[i].y - imageButtons[i].y) < 1, 'the buttons stay put between the image and the video');
      assert.ok(await page.isVisible('[data-share] .share-preview-box video[poster^="blob:"]'), 'the finished video plays in the preview');
      await shot(page, 'sheet-video');
      await page.click('[data-share] [data-save]');
      await page.waitForFunction((t) => document.querySelector('[data-share] .share-message')?.textContent === t, SAVED, { timeout: 15000 });
      const vid = await inspect(page, '__photos');
      assert.equal(vid.type, 'video/mp4');
      assert.deepEqual([vid.width, vid.height], [1080, 1920]);
      assert.ok(vid.audioRms > 0.01, 'the saved video keeps its audio');
      const cmp = await compareVideoToPreview(page);
      assert.deepEqual(cmp.posterSize, [1080, 1920], 'the preview is drawn at the video’s size');
      assert.ok(cmp.ink > 200, `the exported video shows the text above the painting (${cmp.ink} ink pixels)`);
      assert.ok(cmp.top < 6, `the exported video's text matches the preview (mean difference ${cmp.top.toFixed(2)})`);
      assert.ok(cmp.all < 12, `the exported video matches the preview (mean difference ${cmp.all.toFixed(2)})`);
      const sync = await syncCheck(page);
      assert.ok(Math.abs(sync.audio - sync.source) < 0.5, `all of the recording is in the video (${sync.audio.toFixed(2)} s of ${sync.source.toFixed(2)} s)`);
      assert.ok(Math.abs(sync.video - sync.audio) < 0.5, `picture and sound are the same length (${sync.video.toFixed(2)} s, ${sync.audio.toFixed(2)} s)`);
      assert.ok(sync.lagMs <= 100, `the sound starts with the picture (lag ${sync.lagMs} ms)`);
      assert.ok(sync.rmsRatio > 0.7 && sync.rmsRatio < 1.4, `the sound keeps its level (×${sync.rmsRatio.toFixed(2)})`);
      await ctx.close();
      console.log('ok - image and video saved to Photos; the video matches its preview');
      console.log(`   video vs preview: mean diff ${cmp.all.toFixed(2)} (text area ${cmp.top.toFixed(2)}); sound ${sync.audio.toFixed(2)} s, picture ${sync.video.toFixed(2)} s, lag ${sync.lagMs} ms, level ×${sync.rmsRatio.toFixed(2)}`);
    }
    // a small iPhone: Share and Save still on screen, image and video
    {
      const { ctx, page } = await openSheet(browser, {}, SMALL);
      await mainButtons(page, SMALL);
      await shot(page, 'sheet-image-small');
      await page.click('[data-share] .quiet-btn:has-text("Make a video")');
      // the label speaks of the video as soon as it is being made, never of the image
      await page.waitForSelector('[data-share] .share-progress:not([hidden])');
      await page.waitForSelector('[data-share] .pill:has-text("Share video")', { timeout: 45000 });
      await mainButtons(page, SMALL);
      await shot(page, 'sheet-video-small');
      await ctx.close();
      console.log('ok - small iPhone: Share and Save on screen');
    }
    // Photos access denied
    {
      const { ctx, page } = await openSheet(browser, { deny: true });
      await page.click('[data-share] [data-save]');
      await page.waitForFunction(() => /Settings → Sonmira → Photos/.test(document.querySelector('[data-share] .share-message')?.textContent));
      assert.ok(!(await message(page)).includes('Saved'), 'no false confirmation');
      assert.ok(await page.isEnabled('[data-share] [data-save]'), 'can try again');
      await ctx.close();
      console.log('ok - Photos access denied');
    }
    // TestFlight build 3 and older: no plugin, the old Save image (share sheet)
    {
      const { ctx, page } = await openSheet(browser, { plugin: false });
      assert.equal((await page.textContent('[data-share] [data-save]')).trim(), 'Save image');
      await page.click('[data-share] [data-save]');
      const shared = await inspect(page, '__shared');
      assert.equal(shared?.type, 'image/jpeg', 'opens the system share sheet, whose first row is Save Image');
      assert.ok(!(await message(page)).includes('Photos'));
      await page.click('[data-share] .quiet-btn:has-text("Make a video")');
      await page.waitForSelector('[data-share] .share-progress:not([hidden])');
      assert.equal((await page.textContent('[data-share] [data-save]')).trim(), 'Save video', 'while the video is made, the button already speaks of the video');
      await ctx.close();
      console.log('ok - older app build keeps the share sheet');
    }
  } finally { await browser.close(); }
}

run().catch((e) => { console.error(e); process.exit(1); });

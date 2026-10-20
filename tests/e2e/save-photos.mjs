// Save to Photos in the share sheet, as the iOS app shows it: Chromium at
// iPhone size with a stand-in for Capacitor and the SonmiraPhotos plugin
// (ios/App/App/SonmiraPhotosPlugin.swift), which records each saved file.
// Covers the image and the MP4 (with its audio), Photos access denied, and an
// older app build without the plugin (falls back to the system share sheet).
// No AI, nothing uploaded.
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
  const f = window[list].pop();
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

async function openSheet(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(fakeIOS, opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.route(BASE + '__save-photos', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="/styles.css"><body><div id="root" style="position:relative;height:100vh"></div>' }));
  await page.route(BASE + '__hum.wav', (r) => r.fulfill({ contentType: 'audio/wav', body: wav }));
  await page.goto(BASE + '__save-photos');
  await page.evaluate(async () => {
    const { openShareSheet } = await import('/src/app/share/sheet.js');
    const audio = await (await fetch('/__hum.wav')).blob();
    openShareSheet({ root: document.getElementById('root') }, { painting: { wash: [] }, note: 'Rain on the window', date: '2026-10-20', audio, durationSec: 4 });
  });
  await page.waitForSelector('[data-share] .pill:not([disabled])');
  return { ctx, page };
}

const message = (page) => page.textContent('[data-share] .share-message');

async function run() {
  const browser = await chromium.launch({ executablePath: exe, args: ['--disable-webgl', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // image, then video, saved to Photos
    {
      const { ctx, page } = await openSheet(browser, {});
      assert.equal((await page.textContent('[data-share] [data-save]')).trim(), 'Save to Photos');
      assert.equal((await page.textContent('[data-share] .pill')).trim(), 'Share image', 'the system Share stays');
      await page.click('[data-share] [data-save]');
      await page.waitForFunction((t) => document.querySelector('[data-share] .share-message')?.textContent === t, SAVED);
      const img = await inspect(page, '__photos');
      assert.equal(img.type, 'image/jpeg');
      assert.deepEqual([img.width, img.height], [1080, 1440], 'the full-size feed card');
      assert.equal(await page.evaluate(() => window.__shared.length), 0, 'saving does not open the share sheet');

      await page.click('[data-share] .quiet-btn:has-text("Make a video")');
      await page.waitForSelector('[data-share] .pill:has-text("Share video")', { timeout: 45000 });
      assert.ok(await page.isVisible('[data-share] [data-save]'), 'Save to Photos is offered for the video too');
      await page.click('[data-share] [data-save]');
      await page.waitForFunction((t) => document.querySelector('[data-share] .share-message')?.textContent === t, SAVED, { timeout: 15000 });
      const vid = await inspect(page, '__photos');
      assert.equal(vid.type, 'video/mp4');
      assert.deepEqual([vid.width, vid.height], [1080, 1920]);
      assert.ok(vid.audioRms > 0.01, 'the saved video keeps its audio');
      await ctx.close();
      console.log('ok - image and video saved to Photos');
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
      await ctx.close();
      console.log('ok - older app build keeps the share sheet');
    }
  } finally { await browser.close(); }
}

run().catch((e) => { console.error(e); process.exit(1); });

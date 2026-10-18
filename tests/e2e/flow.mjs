// End-to-end check in Chromium at iPhone size with a fake microphone that
// "sings" tests/e2e/hum.wav. Covers the 11 prototype requirements plus the
// mic-denied and too-short edge cases.
//
//   npm i -D playwright && npx playwright install chromium   (once)
//   node server.js &  then  npm run e2e        (SHOTS=dir saves screenshots)
// The default engine (ai) calls /api/generate; here it is answered in the
// browser by a stand-in, so the run makes no paid generations.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5173/';
const ENGINE = process.env.ENGINE_ID ? `engine=${process.env.ENGINE_ID}` : '';
const SHOTS = process.env.SHOTS;
const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const exe = process.env.CHROMIUM_PATH;

const viewport = { width: 393, height: 852 }; // iPhone 15
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const advanced = (page, sel) => page.waitForFunction((s) => document.querySelector(s)?.textContent !== '0:00', sel, { timeout: 5000 });
// Inspects the last file handed to the share sheet (and decodes its audio).
const lastShared = (page) => page.evaluate(async () => {
  for (let i = 0; i < 50 && !window.__shared.length; i++) await new Promise((r) => setTimeout(r, 100));
  const f = window.__shared.pop();
  const url = URL.createObjectURL(f);
  const out = { name: f.name, type: f.type, size: f.size };
  if (f.type.startsWith('image')) {
    const im = new Image(); im.src = url; await im.decode();
    Object.assign(out, { width: im.naturalWidth, height: im.naturalHeight });
  } else {
    const v = document.createElement('video'); v.muted = true; v.src = url;
    await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('video unplayable')); });
    if (v.duration === Infinity) { v.currentTime = 1e6; await new Promise((r) => { v.ontimeupdate = r; }); }
    Object.assign(out, { width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    const ac = new AudioContext();
    const buf = await ac.decodeAudioData(await f.arrayBuffer());
    const d = buf.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    out.audioRms = Math.sqrt(s / d.length);
  }
  return out;
});
const url = (q = '') => BASE + '?' + [ENGINE, q].filter(Boolean).join('&');

async function run() {
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // The API is mocked below, so any install token will do (no invitation sheet).
  await ctx.addInitScript(() => { /* the API is mocked: a stand-in token for this device's id (protect/client.js) */ let a = null; try { a = JSON.parse(localStorage.getItem('sonmira.account')); } catch {} if (!a?.id) { a = { id: 'e2e-device-00000001', token: null, user: null, since: null }; localStorage.setItem('sonmira.account', JSON.stringify(a)); } localStorage.setItem('sonmira.access', `v1.${btoa(JSON.stringify({ i: a.id }))}.mock`); });
  // Stand-in for the system share sheet: records what would be shared.
  await ctx.addInitScript(() => {
    window.__shared = [];
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = async (d) => { window.__shared.push(d.files[0]); };
  });
  // Stand-in for the server's OpenAI pipeline (no paid calls): records what
  // the app sends and answers like /api/generate. FAIL_NEXT makes one call fail.
  const apiCalls = [];
  let failNext = false;
  const jpg = (await import('node:fs')).readFileSync(fileURLToPath(new URL('../../assets/art/impression-1.png', import.meta.url))).toString('base64');
  await ctx.route('**/api/generate', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    apiCalls.push(body);
    if (failNext) { failNext = false; return route.fulfill({ status: 502, json: { ok: false, error: 'upstream', code: 'provider_error' } }); }
    return route.fulfill({ json: { ok: true, provider: 'openai', model: 'gpt-image-2', quality: 'medium', size: '1024x1536', ms: 1, family: 'R5-light-as-subject', familyLabel: 'Light as subject', reference: 'resolved_04', referenceSent: true, libraryVersion: 'test', seed: body.spec?.seed, prompt: 'P', image: `data:image/png;base64,${jpg}` } });
  });
  // /api/understand: the recording is a hum, so no words.
  const understandCalls = [];
  await ctx.route('**/api/understand', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    understandCalls.push({ mime: body.mime, bytes: body.audio?.length ?? 0 });
    return route.fulfill({ json: { ok: true, transcript: { text: '', wordCount: 0, lexicalWords: 0, distinctLexicalWords: 0, nonLexicalWords: 0, lexicalRatio: 0, musicTags: 0, hallucination: false, asrConfidence: null, model: 'mock' }, lyrics: null, ms: 1 } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // fresh diary
  await page.goto(url());
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('sonmira'); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-screen=diary] .empty');
  await page.waitForTimeout(400);
  await shot(page, '01-diary-empty');

  // 1. start recording
  await page.click('.fab');
  await page.waitForSelector('[data-phase=ready]');
  await page.waitForTimeout(500);
  await shot(page, '02-sing-ready');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await page.waitForTimeout(4200);
  await shot(page, '03-singing');
  // 2. stop
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
  await page.waitForTimeout(300);
  await shot(page, '04-preview');
  // 3. play back
  await page.click('[data-phase=preview] .play-btn');
  await advanced(page, '[data-phase=preview] .times span'); // preview playback advances
  // 4. retry, then record again to the time limit (20 s, fixed)
  await page.click('text=Sing again');
  await page.waitForSelector('[data-phase=ready]');
  assert.match(await page.textContent('.mic-label'), /up to 20 seconds/);
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=preview]', { timeout: 26000 });
  const recorded = await page.textContent('[data-phase=preview] .caps');
  assert.match(recorded, /0:(19|20)/, 'auto-stop at 20 s, got ' + recorded);
  // 5. note
  await page.fill('.caption-input', 'Rain on the window');
  // 6. generate (the first attempt fails: a clear error, no substitute painting, then a retry)
  const engineQ = process.env.ENGINE_ID || 'ai';
  if (engineQ === 'ai') {
    failNext = true;
    await page.click('text=Create painting');
    await page.waitForSelector('[data-phase=error][data-kind=generation]', { timeout: 8000 });
    assert.ok(!(await page.$('.painting img.art')), 'no artwork is shown when generation fails');
    await shot(page, '05-generation-error');
    await page.waitForTimeout(600); // let the error screen settle, as a person would
    await page.click('[data-kind=generation] .pill');
  } else {
    await page.click('text=Create painting');
  }
  await page.waitForSelector('[data-phase=generating]');
  await page.waitForTimeout(400);
  await shot(page, '05-generating');
  await page.waitForSelector('[data-phase=result]', { timeout: 8000 });
  await page.waitForTimeout(1600);
  await shot(page, '06-result');
  // 7. result contents
  assert.equal(await page.inputValue('.caption-input'), 'Rain on the window');
  assert.ok(await page.$('.painting img.art'), 'result shows artwork');
  if (engineQ === 'ai') {
    assert.equal(apiCalls.length, 2, 'one failed and one successful generation request');
    const s = apiCalls[1].spec;
    assert.ok(['loose', 'gathered', 'resolved'].includes(s.completeness) && Number.isInteger(s.seed) && typeof s.motif === 'string', 'spec from the real analysis: ' + JSON.stringify(s));
    assert.ok(understandCalls.length >= 1 && understandCalls.every((c) => c.bytes > 0), 'the recording was sent for transcription');
    assert.equal(s.completeness, 'loose', 'a hum with no words is Loose');
    // No sung words, so the note carries the feeling (a Loose painting still depicts nothing).
    assert.deepEqual(s.concept, { text: 'Rain on the window', theme: [], imagery: [], figurative: [], source: 'note' }, 'the note is the subject');
    assert.ok(!s.soundOnly, 'not sound-only when there is a note');
    // How it was sung, measured in the browser, for the art direction of every tier.
    assert.ok(s.performance?.version === 1 && s.performance.passages.length > 0 && typeof s.performance.global.pitchRangeSt === 'number', 'performance measured: ' + JSON.stringify(s.performance));
  }
  await page.fill('.caption-input', 'Rain on the window, again');

  // share right after generating: image, then video
  await page.click('[data-screen=sing] [aria-label="Share"]');
  await page.waitForSelector('[data-share] .pill:not([disabled])');
  await page.waitForTimeout(400);
  await shot(page, '06b-share-sheet');
  await page.click('[data-share] .pill');
  const img = await lastShared(page);
  assert.equal(img.type, 'image/jpeg');
  assert.deepEqual([img.width, img.height], [1080, 1440], 'the default share image is the 3:4 feed card');
  await page.waitForSelector('[data-share]', { state: 'detached' });
  for (const [format, size] of [['story', [1080, 1920]], ['square', [1080, 1080]]]) {
    await page.click('[data-screen=sing] [aria-label="Share"]');
    await page.click(`[data-share] [data-format=${format}]`);
    await page.waitForSelector(`[data-share] [data-format=${format}][aria-checked=true]`);
    await page.waitForSelector('[data-share] .pill:not([disabled])');
    await page.click('[data-share] .pill');
    const card = await lastShared(page);
    assert.deepEqual([card.width, card.height], size, `the ${format} card`);
    await page.waitForSelector('[data-share]', { state: 'detached' });
  }
  // Save image downloads the chosen card (in the iOS app it opens the share sheet's Save Image)
  await page.click('[data-screen=sing] [aria-label="Share"]');
  await page.waitForSelector('[data-share] .pill:not([disabled])');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-share] [data-save]')]);
  assert.match(download.suggestedFilename(), /^sonmira-\d{4}-\d{2}-\d{2}-feed\.jpg$/);
  assert.match(await page.textContent('[data-share] .share-message'), /Image saved/);
  await page.click('[data-share] [aria-label=Close]');
  await page.waitForSelector('[data-share]', { state: 'detached' });
  await page.click('[data-screen=sing] [aria-label="Share"]');
  await page.waitForSelector('[data-share] .pill:not([disabled])');
  await page.click('text=Make a video');
  await page.waitForSelector('[data-share] .share-progress:not([hidden])');
  await page.waitForTimeout(1500);
  await shot(page, '06c-share-video-progress');
  await page.waitForSelector('[data-share] .pill:has-text("Share video")', { timeout: 30000 });
  await page.click('[data-share] .pill');
  const vid = await lastShared(page);
  assert.match(vid.type, /^video\/mp4/);
  assert.deepEqual([vid.width, vid.height], [1080, 1920], 'video is 9:16');
  assert.ok(vid.duration > 18 && vid.duration < 22, 'video keeps the recording length, got ' + vid.duration);
  assert.ok(vid.audioRms > 0.01, 'video carries the original audio');
  await page.waitForSelector('[data-share]', { state: 'detached' });
  assert.equal(await page.inputValue('.caption-input'), 'Rain on the window, again', 'sharing leaves the result as it was');
  // 8. save
  await page.click('text=Keep it');
  await page.waitForSelector('[data-screen=diary] .entry');
  await page.waitForTimeout(600);
  await shot(page, '07-diary-one');
  assert.equal(await page.textContent('.entry .cap'), 'Rain on the window, again');
  // 9. open entry, 10. replay
  await page.click('.entry');
  await page.waitForSelector('[data-screen=detail]');
  await page.waitForTimeout(500);
  await page.click('[data-screen=detail] .play-btn');
  await advanced(page, '[data-screen=detail] .times span'); // detail playback advances
  // share a saved entry
  await page.click('[data-screen=detail] [aria-label="Share"]');
  await page.waitForSelector('[data-share] .pill:not([disabled])');
  await page.click('[data-share] .pill');
  assert.equal((await lastShared(page)).type, 'image/jpeg');
  await page.waitForSelector('[data-share]', { state: 'detached' });
  await shot(page, '08-detail');
  // 11. reload keeps it
  await page.reload();
  await page.waitForSelector('[data-screen=diary] .entry');
  await page.click('.entry');
  await page.waitForSelector('[data-screen=detail]');
  await page.click('[data-screen=detail] .play-btn');
  await advanced(page, '[data-screen=detail] .times span'); // audio survives reload
  await page.click('[aria-label="Back to diary"]');

  // calendar + settings
  await page.click('[aria-label="Show calendar"]');
  await page.waitForTimeout(300);
  await shot(page, '09-calendar');
  await page.click('[aria-label="Show list"]');
  await page.click('[aria-label="Settings"]');
  await page.waitForSelector('[data-screen=settings]');
  assert.doesNotMatch(await page.textContent('[data-screen=settings]'), /Recording length/, 'the length is fixed, not a setting');
  await page.waitForTimeout(300);
  await shot(page, '10-settings');
  await page.click('text=Privacy policy');
  await page.waitForSelector('[data-screen=legal]');
  await shot(page, '11-privacy');
  await page.click('[aria-label="Back to settings"]');
  await page.click('[aria-label="Back to diary"]');

  // too-short take goes back to ready with a hint
  await page.click('.fab');
  await page.click('[aria-label="Start recording"]');
  await page.waitForSelector('[data-phase=singing]');
  await page.waitForTimeout(500);
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=ready] .soft-warning');
  await shot(page, '12-too-short');

  // delete with confirm
  await page.click('[aria-label="Close"]');
  await page.click('.entry');
  await page.click('text=Delete');
  await page.click('text=Delete this painting?');
  await page.waitForSelector('[data-screen=diary] .empty');
  await ctx.close();

  // mic denied
  const denied = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await denied.newPage();
  await p2.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await p2.goto(url());
  await p2.click('.fab');
  await p2.click('[aria-label="Start recording"]');
  await p2.waitForSelector('[data-phase=error][data-kind=denied]');
  await p2.waitForTimeout(400);
  await shot(p2, '13-mic-denied');
  await denied.close();

  await browser.close();
  assert.deepEqual(errors, [], 'no page errors');
  console.log('e2e: all checks passed');
}

run().catch((e) => { console.error(e); process.exit(1); });

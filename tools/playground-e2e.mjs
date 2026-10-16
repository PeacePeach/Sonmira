// Browser check of the Playground: upload (WAV, MP3, M4A where the browser
// decodes it), analyse and paint, three-tier comparison, overrides, fake-mic
// recording, library persistence across reload, compare, load and download.
//
//   npm run playground -- --no-open &   then   node tools/playground-e2e.mjs
//   (needs playwright and ffmpeg; SHOTS=dir keeps the screenshots)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const wav = fileURLToPath(new URL('../tests/e2e/hum.wav', import.meta.url));
const S = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'sonmira-pg-'));
for (const ext of ['mp3', 'm4a']) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, `${S}/hum.${ext}`]);
const BASE = process.env.BASE || 'http://localhost:5180/playground/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(BASE);
await page.waitForFunction(() => window.__playground?.ready);
const status = (re, t = 60000) => page.waitForFunction((r) => new RegExp(r).test(document.getElementById('status').textContent), re.source, { timeout: t });
const st = () => page.textContent('#status');

for (const f of ['hum.m4a', 'hum.mp3', 'hum.wav']) { // last one stays loaded
  await page.setInputFiles('#fileInput', f === 'hum.wav' ? wav : `${S}/${f}`);
  await status(/Ready|could not/);
  console.log(f, '→', await st(), '|', await page.textContent('#clipName'));
}
await page.click('#paintBtn');
await status(/Done|failed/);
console.log(await st());
console.log((await page.innerText('#results')).replace(/\n+/g, ' | ').slice(0, 900));
await page.screenshot({ path: `${S}/1-upload.png`, fullPage: true });

await page.click('#tiersBtn');
await status(/Painted all three|failed/, 120000);
console.log(await st());
await page.screenshot({ path: `${S}/2-tiers.png`, fullPage: true });

// overrides
await page.selectOption('#ovTier', 'custom');
await page.fill('#ovPos', '0.8'); await page.dispatchEvent('#ovPos', 'input');
await page.selectOption('#ovEmotion', 'melancholic');
await page.selectOption('#ovMotif', 'water');
await page.fill('#seed', '12345');
await page.click('#paintBtn'); await status(/Done|failed/);
const r = await page.innerText('#results');
assert.match(r, /override/); assert.match(r, /12345/); assert.match(r, /melancholic/i);
await page.selectOption('#ovTier', 'auto'); await page.selectOption('#ovEmotion', 'auto'); await page.selectOption('#ovMotif', 'auto'); await page.fill('#seed', '');

// mic recording (fake device plays hum.wav)
await page.click('#recBtn');
await page.waitForTimeout(4500);
const timer = await page.textContent('#timer');
await page.click('#recBtn');
await status(/Ready|could not/);
console.log('mic', timer, '→', await page.textContent('#clipName'));
await page.fill('#note', 'quiet evening by the lake, a little sad');
await page.click('#paintBtn'); await status(/Done|failed/);
console.log((await page.innerText('#results')).replace(/\n+/g, ' | ').slice(0, 700));
await page.screenshot({ path: `${S}/3-mic.png`, fullPage: true });

// library + compare, persisted across reload
await page.reload(); await page.waitForFunction(() => window.__playground?.ready);
await page.click('.tab[data-view=library]');
await page.waitForSelector('.run');
const n = await page.locator('#runs .run').count();
console.log('library runs after reload', n);
assert.equal(n, 6);
const boxes = page.locator('#runs .run input[type=checkbox]');
for (const i of [0, 1, 2, 3]) await boxes.nth(i).check();
await page.click('#compareBtn');
await page.waitForSelector('#compare .run');
console.log('compare columns', await page.locator('#compare .run').count());
await page.screenshot({ path: `${S}/4-compare.png`, fullPage: true });
// load back into studio
await page.locator('#runs .run button[data-a=load]').nth(0).click();
await status(/Loaded/);
console.log('load →', await page.inputValue('#seed'), await page.inputValue('#note'));
const dl = page.waitForEvent('download');
await page.click('.tab[data-view=library]');
await page.locator('#runs .run button[data-a=json]').nth(0).click();
console.log('download', (await dl).suggestedFilename());

// AI provider path, with the server mocked (no key, no cost): the page must
// send the spec, show the returned image and label it with the provider.
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xe8dfd0:s=96x120', '-frames:v', '1', `${S}/ai.jpg`]);
const { readFileSync } = await import('node:fs');
const jpg = readFileSync(`${S}/ai.jpg`).toString('base64');
const ai = await ctx.newPage();
ai.on('pageerror', (e) => errors.push(String(e)));
let sentSpec = null;
await ai.route('**/api/generate', (route) => {
  const r = route.request();
  if (r.method() === 'GET') return route.fulfill({ json: { providers: { openai: { configured: true, model: 'gpt-image-1', quality: 'medium', size: '1024x1536' } } } });
  sentSpec = JSON.parse(r.postData()).spec;
  return route.fulfill({ json: { ok: true, provider: 'openai', model: 'gpt-image-1', quality: 'medium', ms: 1234, prompt: 'PROMPT', image: `data:image/jpeg;base64,${jpg}` } });
});
await ai.goto(BASE);
await ai.waitForFunction(() => window.__playground?.ready);
await ai.waitForFunction(() => /configured on the server/.test(document.getElementById('providerHint').textContent));
await ai.selectOption('#provider', 'openai');
await ai.setInputFiles('#fileInput', wav);
await ai.waitForFunction(() => /Ready/.test(document.getElementById('status').textContent));
await ai.selectOption('#ovTier', 'resolved');
await ai.click('#paintBtn');
await ai.waitForFunction(() => /Done|failed/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
console.log('ai →', await ai.textContent('#status'));
assert.equal(sentSpec.completeness, 'resolved');
assert.match(await ai.innerText('#artwork'), /OpenAI gpt-image-1/);
assert.match(await ai.innerText('#results'), /Provider\s+OpenAI gpt-image-1/);
await ai.click('.tab[data-view=library]');
assert.match(await ai.locator('#runs .run').first().innerText(), /OpenAI gpt-image-1/);
assert.match(await page.locator('#runs .run').first().innerText(), /Procedural renderer/);
console.log('errors', errors);
await browser.close();
assert.deepEqual(errors, []);

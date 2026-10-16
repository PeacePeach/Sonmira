// Browser check of the Playground's reference ↔ output comparison, with NO
// paid generation: /api/generate is answered in the browser by a stub that
// echoes the requested spec (reference pinned or drawn), while
// /api/reference is the real handler reading the local reference folder.
//
//   SONMIRA_REFS_DIR=… npm run playground -- --no-open &
//   node tests/e2e/playground-compare.mjs      (SHOTS=dir keeps screenshots;
//   OUTPUTS=dir uses <dir>/<reference>-generated.jpg as the stub's images)

import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { direct, checkPrompt } from '../../src/engine/direct/index.js';

const wav = fileURLToPath(new URL('./hum.wav', import.meta.url));
const S = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'sonmira-cmp-'));
const BASE = process.env.BASE || 'http://localhost:5180/playground/';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const imageFor = (id) => {
  const f = process.env.OUTPUTS && join(process.env.OUTPUTS, `${id}-generated.jpg`);
  return f && existsSync(f) ? `data:image/jpeg;base64,${readFileSync(f).toString('base64')}` : `data:image/png;base64,${PNG}`;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const generated = [];
await page.route('**/api/generate', async (route) => {
  const req = route.request();
  if (req.method() === 'GET') return route.fulfill({ json: { providers: { openai: { configured: true, model: 'stub', quality: 'medium', size: '1024x1536' } }, references: 'local' } });
  const { spec } = JSON.parse(req.postData());
  const d = direct(spec);
  generated.push(spec);
  return route.fulfill({ json: { ok: true, provider: 'openai', model: 'stub', quality: 'medium', size: '1024x1536', ms: 1, prompt: d.prompt, family: d.family, familyLabel: d.familyLabel, familyRefs: d.refs,
    subjectSource: d.subjectSource, subject: d.subject, reference: d.reference.id, referenceSent: true, seed: d.seed, swatches: d.swatches,
    settings: { tier: d.level, emotion: spec.emotion, motif: spec.motif, energy: spec.energy.value, expression: spec.expression ?? null }, promptCheck: checkPrompt(d), image: imageFor(d.reference.id) } });
});
await page.goto(BASE);
await page.waitForFunction(() => window.__playground?.ready);
const status = (re) => page.waitForFunction((r) => new RegExp(r).test(document.getElementById('status').textContent), re.source, { timeout: 60000 });
await page.setInputFiles('#fileInput', wav);
await status(/Ready/);
await page.selectOption('#provider', 'openai');
await page.fill('#note', 'Moonlight spreading across a calm sea at night, a single silver path of light on the water.');
await page.selectOption('#ovEmotion', 'tender');
await page.selectOption('#ovMotif', 'water');
await page.fill('#seed', '1');

// Same note, emotion, motif and seed; only the pinned reference changes.
for (const id of ['resolved_01', 'resolved_12', 'resolved_06']) {
  await page.selectOption('#ovReference', id);
  assert.equal(await page.inputValue('#ovTier'), 'resolved');
  await page.evaluate(() => { document.getElementById('status').textContent = ''; });
  await page.click('#paintBtn');
  await status(/Done|failed/);
  assert.match(await page.textContent('#status'), /Done/);
  await page.waitForFunction(() => document.querySelector('#artwork .pair img')?.complete && document.querySelector('#artwork .pair img').naturalWidth > 0, null, { timeout: 15000 });
  const meta = await page.innerText('#artwork .pairmeta');
  assert.match(meta, new RegExp(`Reference\\s+${id}`));
  assert.match(meta, /Subject from\s+the note/);
  assert.match(meta, /Prompt check\s+clean/);
}
assert.deepEqual(generated.map((s) => s.reference), ['resolved_01', 'resolved_12', 'resolved_06']);
assert.ok(generated.every((s) => s.concept?.source === 'note' && s.seed === 1 && s.emotion === 'tender' && s.motif === 'water' && s.completeness === 'resolved'));
await page.screenshot({ path: `${S}/studio-pair.png`, fullPage: true });

await page.click('.tab[data-view=library]');
await page.waitForSelector('.run');
for (const box of await page.$$('.run input[type=checkbox]')) await box.check();
await page.click('#compareBtn');
await page.waitForFunction(() => document.querySelectorAll('#compare .pair').length === 3 && [...document.querySelectorAll('#compare .pair figure:first-child img')].every((i) => i.naturalWidth > 0), null, { timeout: 15000 });
const rows = await page.$$eval('#compare .pairmeta', (els) => els.map((e) => e.innerText.match(/Reference\s+(\S+)/)[1]));
assert.deepEqual(rows, ['resolved_01', 'resolved_12', 'resolved_06']);
const srcs = await page.$$eval('#compare .pair img', (els) => els.map((e) => e.src));
assert.ok(srcs.every((s) => s.startsWith('blob:')), 'images are object URLs, no storage URL in the page');
await page.fill('#compare .pair:nth-child(2) .review input', 'a moon and its path on turquoise water, four rowboats moored with ropes');
await page.press('#compare .pair:nth-child(2) .review input', 'Tab');
assert.match(await page.textContent('#compare .pair:nth-child(2) .verdict'), /leakage · from resolved_12: rowboats, from resolved_12: ropes/);
await page.fill('#compare .pair:nth-child(3) .review input', 'a moon over a calm lavender sea, a path of moonlight');
await page.press('#compare .pair:nth-child(3) .review input', 'Tab');
assert.match(await page.textContent('#compare .pair:nth-child(3) .verdict'), /no leakage found/);
await page.locator('#compare').screenshot({ path: `${S}/library-compare.png` });

await page.setViewportSize({ width: 390, height: 900 });
await page.locator('#compare .pair').first().screenshot({ path: `${S}/compare-phone.png` });
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal scroll at phone width');
assert.deepEqual(errors, []);
console.log(`ok: 3 pinned references painted (stubbed), compared side by side; screenshots in ${S}`);
await browser.close();

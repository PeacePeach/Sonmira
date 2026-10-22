// Public legal pages (App Store Connect Privacy Policy URL and Terms) and the
// in-app legal text: /privacy and /terms are static pages reached without
// login, generated from the same source the app shows, and / stays the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { renderLegalPage, PAGES } from '../scripts/build-legal.mjs';
import { LEGAL, CONTACT } from '../src/app/legal/content.js';

const root = new URL('../', import.meta.url);
const vercel = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
const page = (kind) => readFile(new URL(PAGES[kind], root), 'utf8');

test('vercel.json serves /privacy and /terms from the static pages, and never rewrites /', () => {
  for (const kind of ['privacy', 'terms']) assert.ok(vercel.rewrites.some((r) => r.source === `/${kind}` && r.destination === `/${kind}/index.html`), kind);
  for (const r of [...vercel.rewrites, ...(vercel.redirects ?? [])]) assert.notEqual(r.source, '/');
});

test('the committed pages are generated from src/app/legal/content.js (run node scripts/build-legal.mjs)', async () => {
  for (const kind of Object.keys(PAGES)) assert.equal(await page(kind), renderLegalPage(kind), kind);
});

test('privacy policy covers the required topics', () => {
  const text = JSON.stringify(LEGAL.privacy);
  for (const topic of ['OpenAI', 'Lyrics', 'anonymous identifier', 'subscription', 'Refunds', '24 hours', 'Apple', 'Vercel', 'Upstash', 'Google Fonts', 'What may remain after deletion', 'Data security', 'Delete your account', 'Children', 'Changes to this policy', 'does not mean you give up any privacy rights']) {
    assert.ok(text.includes(topic), topic);
  }
  assert.doesNotMatch(text, /Prototype draft|immediately|permanently delete all/i);
});

test('terms cover the required topics, with Alberta law and no blanket waivers', () => {
  const text = JSON.stringify(LEGAL.terms);
  for (const topic of ['personal singing diary', 'AI-generated paintings', 'Service availability', 'stored only on your device', 'auto-renewing monthly subscription', 'reportaproblem.apple.com', 'Disclaimers', 'Limitation of liability', 'Province of Alberta', 'consumer protection law', 'Licensed Application End User License Agreement']) {
    assert.ok(text.includes(topic), topic);
  }
  assert.doesNotMatch(text, /class action|arbitration|(?<!CAD )\$\d/i, 'no class waiver or arbitration; no App Store price');
});

test('pages have the contact mailto:, link each other and load no app code', async () => {
  for (const kind of Object.keys(PAGES)) {
    const html = await page(kind);
    assert.match(html, new RegExp(`<a [^>]*href="mailto:${CONTACT.replace('.', '\\.')}"`));
    for (const href of ['/support', '/privacy', '/terms']) assert.ok(html.includes(`href="${href}"`), `${kind} links ${href}`);
    assert.match(html, /name="viewport" content="width=device-width/);
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /\/api\//);
  }
});

test('local server answers /privacy, /terms, /support and / with 200', async (t) => {
  const port = 5900 + Math.floor(Math.random() * 300);
  const proc = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const get = async (path) => {
    for (let i = 0; i < 50; i++) {
      try { return await fetch(`http://127.0.0.1:${port}${path}`); } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('server did not start');
  };
  for (const [path, title] of [['/privacy', 'Privacy Policy'], ['/privacy/', 'Privacy Policy'], ['/terms', 'Terms of Service'], ['/terms/', 'Terms of Service'], ['/support', 'Sonmira Support']]) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), new RegExp(title), path);
  }
  assert.match(await (await get('/')).text(), /<title>Sonmira<\/title>/);
});

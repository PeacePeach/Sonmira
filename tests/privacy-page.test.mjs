// Public Privacy Policy (App Store Connect Privacy Policy URL): /privacy is a
// static page reached without login, next to /support, and / stays the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = new URL('../', import.meta.url);
const vercel = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
const html = await readFile(new URL('privacy/index.html', root), 'utf8');

test('vercel.json serves /privacy from the static page', () => {
  assert.ok(vercel.rewrites.some((r) => r.source === '/privacy' && r.destination === '/privacy/index.html'));
  for (const r of [...vercel.rewrites, ...(vercel.redirects ?? [])]) assert.notEqual(r.source, '/');
});

test('privacy page covers the required topics, has the contact mailto: and loads no app code', () => {
  assert.match(html, /<title>Sonmira Privacy Policy<\/title>/);
  assert.match(html, /<a [^>]*href="mailto:sonmirasupport@gmail\.com"[^>]*>sonmirasupport@gmail\.com<\/a>/);
  for (const topic of ['OpenAI', 'Lyrics', 'anonymous identifier', 'subscription', 'Refunds', '24 hours', 'Service providers', 'Data security', 'Delete your account', 'Children', 'Changes to this policy']) {
    assert.ok(html.includes(topic), topic);
  }
  assert.match(html, /name="viewport" content="width=device-width/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /\/api\//);
});

test('local server answers /privacy, /support and / with 200', async (t) => {
  const port = 5900 + Math.floor(Math.random() * 300);
  const proc = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const get = async (path) => {
    for (let i = 0; i < 50; i++) {
      try { return await fetch(`http://127.0.0.1:${port}${path}`); } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('server did not start');
  };
  for (const path of ['/privacy', '/privacy/']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /Privacy Policy/);
  }
  assert.match(await (await get('/support')).text(), /Sonmira Support/);
  const app = await (await get('/')).text();
  assert.match(app, /<title>Sonmira<\/title>/);
});

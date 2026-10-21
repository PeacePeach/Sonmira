// Public Support page (App Store Connect Support URL): /support is a static
// page reached without login, and the app at / is left as it was.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = new URL('../', import.meta.url);
const vercel = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
const html = await readFile(new URL('support/index.html', root), 'utf8');

test('vercel.json serves /support from the static page, and touches nothing else', () => {
  assert.deepEqual(vercel.rewrites, [{ source: '/support', destination: '/support/index.html' }]);
  for (const r of [...vercel.rewrites, ...(vercel.redirects ?? [])]) assert.notEqual(r.source, '/');
});

test('support page has the title, text and a mailto: link, and loads no app code', () => {
  assert.match(html, /<title>Sonmira Support<\/title>/);
  assert.match(html, /<h1>Sonmira Support<\/h1>/);
  assert.match(html, /Need help or have feedback\? We'd love to hear from you\./);
  assert.match(html, /<a [^>]*href="mailto:sonmirasupport@gmail\.com"[^>]*>sonmirasupport@gmail\.com<\/a>/);
  assert.match(html, /name="viewport" content="width=device-width/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /\/api\//);
});

test('local server answers /support and / with 200', async (t) => {
  const port = 5600 + Math.floor(Math.random() * 300);
  const proc = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  t.after(() => proc.kill());
  const get = async (path) => {
    for (let i = 0; i < 50; i++) {
      try { return await fetch(`http://127.0.0.1:${port}${path}`); } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('server did not start');
  };
  for (const path of ['/support', '/support/']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /Sonmira Support/);
  }
  const app = await get('/');
  assert.equal(app.status, 200);
  const body = await app.text();
  assert.match(body, /<title>Sonmira<\/title>/);
  assert.doesNotMatch(body, /Sonmira Support/);
});

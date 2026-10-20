// The app and its API on one local server, the way Vercel runs them: static
// files plus api/*.js through a Vercel-style request/response shim. Used by
// tests/e2e/readiness.mjs; also handy by hand:
//
//   SONMIRA_FAKE_PROVIDER=1 SONMIRA_TOKEN_SECRET=dev-secret-0123456789abcdef \
//   SONMIRA_INVITE_CODES=LOCAL-TEST-01 node tests/e2e/guarded-server.mjs
//
// With SONMIRA_FAKE_PROVIDER=1 nothing paid is ever called (server/dev/fake-openai.js).
// Every guard decision is also kept for GET /__test/guard-log (tests only).

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.PORT || 5190);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wav': 'audio/wav' };

const guardLog = [];
const log = console.log;
console.log = (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('{"evt":"sonmira.guard"')) { guardLog.push(JSON.parse(a[0])); if (!process.env.QUIET) log(...a); return; }
  log(...a);
};

const API = ['generate', 'understand', 'session', 'reference', 'billing/status', 'billing/transactions'];
const handlers = Object.fromEntries(await Promise.all(API.map(async (n) => [n, (await import(`../../api/${n}.js`)).default])));

async function api(req, res, name) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = raw; }
  const shim = {
    setHeader: (k, v) => res.setHeader(k, v),
    getHeader: (k) => res.getHeader(k),
    status(code) { res.statusCode = code; return shim; },
    json(obj) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); return shim; },
    send(b) { res.end(b); return shim; },
    end(b) { res.end(b); return shim; },
  };
  const query = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  await handlers[name]({ method: req.method, url: req.url, headers: req.headers, socket: req.socket, query, body }, shim);
}

const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__test/guard-log') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(guardLog)); return; }
    const name = path.startsWith('/api/') ? path.slice(5) : null;
    if (name && API.includes(name)) { await api(req, res, name); return; }
    const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end(String(e));
  }
});
server.listen(PORT, '127.0.0.1', () => log(`guarded server on http://localhost:${PORT}/`));

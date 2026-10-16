// Starts the Watercolor Engine Playground on this machine and opens it in the
// default browser.
//
//   npm run playground            → http://localhost:5180/playground/
//   PORT=6000 npm run playground
//   npm run playground -- --no-open
//
// Serves only the playground page and the engine sources it imports, on
// localhost only (the microphone is allowed on localhost without https).

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = ['playground', 'src'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Same function the Vercel preview runs, so AI providers work locally too
// when their keys are in this shell's environment (e.g. OPENAI_API_KEY).
async function api(req, res, name) {
  const { default: handle } = await import(`../api/${name}.js`);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const shim = {
    setHeader: (k, v) => res.setHeader(k, v),
    status(code) { res.statusCode = code; return shim; },
    json(obj) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); },
    end: (body) => res.end(body),
  };
  const query = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  await handle({ method: req.method, url: req.url, query, body: raw ? JSON.parse(raw) : {} }, shim);
}

async function handler(req, res) {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/api/generate' || path === '/api/reference' || path === '/api/understand') { await api(req, res, path.slice(5)); return; }
    if (path === '/' || path === '/playground') { res.writeHead(302, { location: '/playground/' }).end(); return; }
    const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
    const top = file.slice(ROOT.length).split(sep)[0];
    if (!file.startsWith(ROOT) || !ALLOWED.includes(top)) { res.writeHead(404).end('Not found'); return; }
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(500).end(String(e)); }
}

function listen(port, tries = 10) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && tries > 1 && !process.env.PORT) resolve(listen(port + 1, tries - 1));
      else reject(e);
    });
    server.listen(port, '127.0.0.1', () => resolve(port));
  });
}

const port = await listen(Number(process.env.PORT || 5180));
const url = `http://localhost:${port}/playground/`;
console.log(`Sonmira Watercolor Engine Playground: ${url}`);
console.log('Press Ctrl+C to stop.');
if (!process.argv.includes('--no-open')) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  execFile(cmd, args, (err) => { if (err) console.log(`Open ${url} in your browser.`); });
}

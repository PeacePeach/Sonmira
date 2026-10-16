// Zero-dependency static server for the prototype.
//   node server.js                → http://localhost:5173
//   node server.js --https        → https on your LAN (self-signed; needs openssl)
//   PORT=8080 node server.js
// The microphone only works on localhost or https, so use --https (or a
// tunnel) to test on an iPhone over Wi-Fi.

import http from 'node:http';
import https from 'node:https';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const useHttps = process.argv.includes('--https');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8' };

async function handler(req, res) {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(500).end(String(e)); }
}

const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

async function cert() {
  const dir = join(ROOT, '.cert');
  const key = join(dir, 'key.pem'), crt = join(dir, 'cert.pem');
  if (!existsSync(key)) {
    await mkdir(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '365', '-subj', '/CN=sonmira.local'], { stdio: 'ignore' });
  }
  return { key: await readFile(key), cert: await readFile(crt) };
}

const server = useHttps ? https.createServer(await cert(), handler) : http.createServer(handler);
server.listen(PORT, '0.0.0.0', () => {
  const proto = useHttps ? 'https' : 'http';
  console.log(`Sonmira running at ${proto}://localhost:${PORT}`);
  for (const ip of lan) console.log(`  on your network: ${proto}://${ip}:${PORT}`);
  if (!useHttps) console.log('  (iPhone over Wi-Fi needs https for the microphone: node server.js --https)');
});

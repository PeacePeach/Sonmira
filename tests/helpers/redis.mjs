// A throwaway redis-server and a tiny RESP client, so the guard's Lua
// scripts run against real Redis in tests. Skipped when redis-server is not
// installed (CI without it still runs the in-memory suite).

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

export function hasRedis() {
  try { return spawnSync('redis-server', ['--version']).status === 0; } catch { return false; }
}

export async function startRedis() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const c = await connect(port); return { exec: c.exec, stop: () => { c.close(); proc.kill(); } }; } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  proc.kill();
  throw new Error('redis-server did not start');
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0);
    const waiting = [];
    sock.on('error', reject);
    sock.on('connect', () => resolve({
      exec: (cmd) => new Promise((res, rej) => {
        waiting.push({ res, rej });
        sock.write(`*${cmd.length}\r\n` + cmd.map((a) => { const s = String(a); return `$${Buffer.byteLength(s)}\r\n${s}\r\n`; }).join(''));
      }),
      close: () => sock.destroy(),
    }));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const r = parse(buf, 0);
        if (!r) break;
        buf = buf.subarray(r.end);
        const w = waiting.shift();
        if (r.value instanceof Error) w.rej(r.value); else w.res(r.value);
      }
    });
  });
}

function parse(b, i) {
  const nl = b.indexOf('\r\n', i);
  if (nl < 0) return null;
  const t = String.fromCharCode(b[i]), line = b.toString('utf8', i + 1, nl), next = nl + 2;
  if (t === '+') return { value: line, end: next };
  if (t === '-') return { value: new Error(line), end: next };
  if (t === ':') return { value: Number(line), end: next };
  if (t === '$') {
    const n = Number(line);
    if (n < 0) return { value: null, end: next };
    if (b.length < next + n + 2) return null;
    return { value: b.toString('utf8', next, next + n), end: next + n + 2 };
  }
  if (t === '*') {
    const n = Number(line);
    if (n < 0) return { value: null, end: next };
    const out = []; let at = next;
    for (let k = 0; k < n; k++) { const r = parse(b, at); if (!r) return null; out.push(r.value); at = r.end; }
    return { value: out, end: at };
  }
  throw new Error(`bad RESP type ${t}`);
}

// Jong Jumble server: static files + 1v1 rooms over WebSocket (path /ws).
// Usage: npm start   (PORT env var overrides js/config.js MULTIPLAYER.port)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MULTIPLAYER } from '../js/config.js';
import { createRoomManager } from './rooms.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || MULTIPLAYER.port;
const PUBLIC = ['index.html', 'manifest.webmanifest', 'css', 'js', 'sprites', 'assets']; // only these are served

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  rel = normalize(rel);
  if (rel.startsWith('..') || !PUBLIC.includes(rel.split(sep)[0])) return send(res, 404, 'Not found');
  const file = join(ROOT, rel);
  try {
    if (!(await stat(file)).isFile()) return send(res, 404, 'Not found');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    send(res, 404, 'Not found');
  }
}

function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') return send(res, 200, 'ok');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res);
});

// ------------------------------------------------------------------ 1v1 WebSocket rooms

const rooms = createRoomManager();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const client = rooms.connect((msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    client.handle(msg);
  });
  ws.on('close', () => client.close());
});

// Drop connections that stopped answering (closed laptops, dead proxies) so rooms get cleaned up.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Jong Jumble running at http://localhost:${PORT}`);
});

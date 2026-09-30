// Static file server for the game. Multiplayer (WebSocket rooms) will be added here in phase 6.
// Usage: npm start   (PORT env var overrides js/config.js MULTIPLAYER.port)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MULTIPLAYER } from '../js/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || MULTIPLAYER.port;
const PUBLIC = ['index.html', 'css', 'js', 'sprites', 'assets']; // only these are served

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
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

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`Mahjong Rows running at http://localhost:${PORT}`);
});

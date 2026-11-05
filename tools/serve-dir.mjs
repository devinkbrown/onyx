// SPDX-License-Identifier: AGPL-3.0-or-later
// Minimal static file server with SPA fallback (unknown paths serve
// index.html) for local preview and Playwright e2e.
//
// Usage: node tools/serve-dir.mjs <rootDir> <port>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2];
const PORT = Number(process.argv[3] ?? '8080');
if (!ROOT || !Number.isFinite(PORT)) {
  console.error('FAIL: usage: node tools/serve-dir.mjs <rootDir> <port>');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

http
  .createServer((req, res) => {
    let file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (req.url.split('?')[0] === '/') file = path.join(ROOT, 'index.html');
    try {
      if (req.url.split('?')[0] !== '/' && (!fs.existsSync(file) || fs.statSync(file).isDirectory())) {
        file = path.join(ROOT, 'index.html');
      }
    } catch {
      file = path.join(ROOT, 'index.html');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/`));
